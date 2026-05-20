// ─────────────────────────────────────────────
// CyberSwitch Background Service Worker
// Handles all wallet provider requests from dApps
// ─────────────────────────────────────────────

const WALLETS_KEY = 'cyberswitch_wallets'
const ACTIVE_KEY = 'cyberswitch_active'
const CONNECTED_SITES_KEY = 'cyberswitch_connected_sites'
const ARC_CHAIN_ID = '0x4CE052' // 5042002 in hex
const ARC_RPC = 'https://rpc.testnet.arc.network'

// ── Storage helpers ───────────────────────────
const storage = {
  get: (key: string): Promise<any> =>
    new Promise(r => chrome.storage.local.get([key], res => r(res[key]))),
  set: (key: string, value: any): Promise<void> =>
    new Promise(r => chrome.storage.local.set({ [key]: value }, r)),
}

// ── Get active wallet ─────────────────────────
const getActiveWallet = async () => {
  const [wallets, idx] = await Promise.all([
    storage.get(WALLETS_KEY),
    storage.get(ACTIVE_KEY),
  ])
  if (!wallets || wallets.length === 0) return null
  const safeIdx = Math.min(idx ?? 0, wallets.length - 1)
  return wallets[safeIdx]
}

// ── Get connected sites ───────────────────────
const getConnectedSites = async (): Promise<string[]> => {
  const sites = await storage.get(CONNECTED_SITES_KEY)
  return sites || []
}

const addConnectedSite = async (origin: string): Promise<void> => {
  const sites = await getConnectedSites()
  if (!sites.includes(origin)) {
    sites.push(origin)
    await storage.set(CONNECTED_SITES_KEY, sites)
  }
}

const removeConnectedSite = async (origin: string): Promise<void> => {
  const sites = await getConnectedSites()
  await storage.set(CONNECTED_SITES_KEY, sites.filter(s => s !== origin))
}

// ── Pending requests queue ────────────────────
const pendingRequests = new Map<string, {
  resolve: (value: any) => void
  reject: (reason: any) => void
}>()

// ── Open approval popup ───────────────────────
const openApprovalPopup = async (type: string, data: any, requestId: string) => {
  await storage.set('cyberswitch_pending_request', { type, data, requestId })

  chrome.windows.create({
    url: chrome.runtime.getURL('index.html') + `?approval=true&requestId=${requestId}`,
    type: 'popup',
    width: 400,
    height: 620,
    focused: true,
  })
}

// ── RPC call helper ───────────────────────────
const rpcCall = async (method: string, params: any[] = []): Promise<any> => {
  const response = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.result
}

// ── Main message handler ──────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload, requestId } = message

  // ── Handle approval responses from popup ──
  if (type === 'CYBERSWITCH_APPROVAL_RESPONSE') {
    const pending = pendingRequests.get(requestId)
    if (pending) {
      if (payload.approved) {
        pending.resolve(payload.result)
      } else {
        pending.reject({ code: 4001, message: 'User rejected the request' })
      }
      pendingRequests.delete(requestId)
    }
    sendResponse({ ok: true })
    return true
  }

  // ── Handle provider requests from content script ──
  if (type === 'CYBERSWITCH_PROVIDER_REQUEST') {
    handleProviderRequest(payload, sender?.origin || sender?.tab?.url || '')
      .then(result => sendResponse({ result }))
      .catch(error => sendResponse({ error: { code: error.code || -32603, message: error.message } }))
    return true
  }

  return false
})

// ── Provider request router ───────────────────
const handleProviderRequest = async (request: any, origin: string): Promise<any> => {
  const { method, params } = request

  switch (method) {

    case 'eth_chainId':
      return ARC_CHAIN_ID

    case 'net_version':
      return '5042002'

    case 'eth_accounts': {
      const sites = await getConnectedSites()
      if (!sites.includes(origin)) return []
      const wallet = await getActiveWallet()
      return wallet ? [wallet.address] : []
    }

    case 'eth_requestAccounts': {
      const sites = await getConnectedSites()
      if (sites.includes(origin)) {
        const wallet = await getActiveWallet()
        return wallet ? [wallet.address] : []
      }

      // Need approval
      return new Promise((resolve, reject) => {
        const requestId = `connect_${Date.now()}`
        pendingRequests.set(requestId, { resolve, reject })
        openApprovalPopup('connect', { origin }, requestId)
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId)
            reject({ code: 4001, message: 'Request timed out' })
          }
        }, 120000) // 2 min timeout
      })
    }

    case 'eth_sendTransaction': {
      const sites = await getConnectedSites()
      if (!sites.includes(origin)) {
        throw { code: 4100, message: 'Not connected. Call eth_requestAccounts first.' }
      }

      const txParams = params[0]
      return new Promise((resolve, reject) => {
        const requestId = `tx_${Date.now()}`
        pendingRequests.set(requestId, { resolve, reject })
        openApprovalPopup('transaction', { origin, txParams }, requestId)
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId)
            reject({ code: 4001, message: 'Request timed out' })
          }
        }, 120000)
      })
    }

    case 'wallet_switchEthereumChain': {
      const chainId = params[0]?.chainId
      if (chainId !== ARC_CHAIN_ID) {
        throw { code: 4902, message: 'CyberSwitch only supports Arc Testnet.' }
      }
      return null
    }

    case 'wallet_addEthereumChain': {
      const chainId = params[0]?.chainId
      if (chainId !== ARC_CHAIN_ID) {
        throw { code: 4902, message: 'CyberSwitch only supports Arc Testnet.' }
      }
      return null
    }

    case 'eth_getBalance': {
      return rpcCall('eth_getBalance', params)
    }

    case 'eth_blockNumber': {
      return rpcCall('eth_blockNumber', [])
    }

    case 'eth_getTransactionByHash': {
      return rpcCall('eth_getTransactionByHash', params)
    }

    case 'eth_getTransactionReceipt': {
      return rpcCall('eth_getTransactionReceipt', params)
    }

    case 'eth_call': {
      return rpcCall('eth_call', params)
    }

    case 'eth_estimateGas': {
      return rpcCall('eth_estimateGas', params)
    }

    case 'eth_gasPrice': {
      return rpcCall('eth_gasPrice', [])
    }

    case 'wallet_disconnect': {
      await removeConnectedSite(origin)
      return null
    }

    default:
      throw { code: -32601, message: `Method ${method} not supported` }
  }
}

// ── Listen for approval results ───────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CYBERSWITCH_CONNECT_APPROVED') {
    addConnectedSite(message.origin)
  }
})

console.log('CyberSwitch background worker running ✅')