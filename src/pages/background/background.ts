// Keep service worker alive
const keepAlive = () => setInterval(chrome.runtime.getPlatformInfo, 20000)
chrome.runtime.onStartup.addListener(keepAlive)
chrome.runtime.onInstalled.addListener(keepAlive)
keepAlive()

const WALLETS_KEY = 'cyberswitch_wallets'
const ACTIVE_KEY = 'cyberswitch_active'
const CONNECTED_SITES_KEY = 'cyberswitch_connected_sites'
const ARC_CHAIN_ID = '0x4CE052'
const ARC_RPC = 'https://rpc.testnet.arc.network'

const storage = {
  get: (key: string): Promise<any> =>
    new Promise(r => {
      try { chrome.storage.local.get([key], (res: any) => r(res[key] ?? null)) }
      catch { r(null) }
    }),
  set: (key: string, value: any): Promise<void> =>
    new Promise(r => {
      try { chrome.storage.local.set({ [key]: value }, () => r()) }
      catch { r() }
    }),
  remove: (key: string): Promise<void> =>
    new Promise(r => {
      try { chrome.storage.local.remove([key], () => r()) }
      catch { r() }
    }),
}

const getActiveWallet = async () => {
  try {
    const [wallets, idx] = await Promise.all([storage.get(WALLETS_KEY), storage.get(ACTIVE_KEY)])
    if (!wallets?.length) return null
    return wallets[Math.min(idx ?? 0, wallets.length - 1)]
  } catch { return null }
}

const getConnectedSites = async (): Promise<string[]> => {
  try { return (await storage.get(CONNECTED_SITES_KEY)) || [] }
  catch { return [] }
}

const addConnectedSite = async (origin: string) => {
  try {
    const sites = await getConnectedSites()
    if (!sites.includes(origin)) await storage.set(CONNECTED_SITES_KEY, [...sites, origin])
  } catch {}
}

const removeConnectedSite = async (origin: string) => {
  try {
    const sites = await getConnectedSites()
    await storage.set(CONNECTED_SITES_KEY, sites.filter((s: string) => s !== origin))
  } catch {}
}

const rpcCall = async (method: string, params: any[] = []) => {
  const res = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.result
}

const openPopup = async () => {
  return new Promise<void>((resolve) => {
    chrome.windows.create({
      url: chrome.runtime.getURL('index.html'),
      type: 'popup',
      width: 400,
      height: 640,
      focused: true,
    }, () => resolve())
  })
}

const handleProviderRequest = async (request: any, origin: string): Promise<any> => {
  const { method, params, requestId } = request
  switch (method) {
    case 'eth_chainId': return ARC_CHAIN_ID
    case 'net_version': return '5042002'
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
      await storage.set('cs_pending', { type: 'connect', data: { origin }, requestId, ts: Date.now() })
      await openPopup()
      return 'PENDING'
    }
    case 'eth_sendTransaction': {
      const sites = await getConnectedSites()
      if (!sites.includes(origin)) throw { code: 4100, message: 'Connect first.' }
      await storage.set('cs_pending', { type: 'transaction', data: { origin, txParams: params?.[0] }, requestId, ts: Date.now() })
      await openPopup()
      return 'PENDING'
    }
    case 'eth_sign':
    case 'personal_sign': {
      const sites = await getConnectedSites()
      if (!sites.includes(origin)) throw { code: 4100, message: 'Connect first.' }
      const message = method === 'personal_sign' ? params?.[0] : params?.[1]
      await storage.set('cs_pending', { type: 'sign', data: { origin, message }, requestId, ts: Date.now() })
      await openPopup()
      return 'PENDING'
    }
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain':
      if (params?.[0]?.chainId !== ARC_CHAIN_ID) throw { code: 4902, message: 'CyberSwitch only supports Arc Testnet.' }
      return null
    case 'eth_getBalance': return rpcCall('eth_getBalance', params)
    case 'eth_blockNumber': return rpcCall('eth_blockNumber', [])
    case 'eth_getTransactionByHash': return rpcCall('eth_getTransactionByHash', params)
    case 'eth_getTransactionReceipt': return rpcCall('eth_getTransactionReceipt', params)
    case 'eth_call': return rpcCall('eth_call', params)
    case 'eth_estimateGas': return rpcCall('eth_estimateGas', params)
    case 'eth_gasPrice': return rpcCall('eth_gasPrice', [])
    case 'wallet_disconnect': await removeConnectedSite(origin); return null
    default: throw { code: -32601, message: `Method ${method} not supported` }
  }
}

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  const { type, payload } = message

  if (type === 'CYBERSWITCH_APPROVAL_RESPONSE') {
    const { requestId, approved, origin, result } = payload
    const handle = async () => {
      try {
        if (approved && requestId.startsWith('connect_') && origin) {
          await addConnectedSite(origin)
          const wallet = await getActiveWallet()
          await storage.set(`cs_resp_${requestId}`, { result: wallet ? [wallet.address] : [], error: null, ts: Date.now() })
        } else if (approved) {
          await storage.set(`cs_resp_${requestId}`, { result: result ?? null, error: null, ts: Date.now() })
        } else {
          await storage.set(`cs_resp_${requestId}`, { result: null, error: { code: 4001, message: 'User rejected the request' }, ts: Date.now() })
        }
        await storage.remove('cs_pending')
      } catch (e) {
        console.error('Approval error:', e)
        await storage.set(`cs_resp_${requestId}`, { result: null, error: { code: -32603, message: 'Internal error' }, ts: Date.now() })
      }
    }
    handle().then(() => { try { sendResponse({ ok: true }) } catch {} })
    return true
  }

  if (type === 'CYBERSWITCH_PROVIDER_REQUEST') {
    const origin = (() => {
      try { return sender?.origin || (sender?.tab?.url ? new URL(sender.tab.url).origin : 'unknown') }
      catch { return 'unknown' }
    })()
    const req = { ...payload }
    handleProviderRequest(req, origin)
      .then(async result => {
        try {
          if (result !== 'PENDING') await storage.set(`cs_resp_${req.requestId}`, { result, error: null, ts: Date.now() })
          sendResponse({ ok: true })
        } catch {}
      })
      .catch(async error => {
        try {
          await storage.set(`cs_resp_${req.requestId}`, { result: null, error: { code: error.code || -32603, message: error.message || 'Unknown error' }, ts: Date.now() })
          sendResponse({ ok: true })
        } catch {}
      })
    return true
  }

  return false
})

console.log('CyberSwitch background worker running ✅')