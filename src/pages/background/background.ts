const WALLETS_KEY = 'cyberswitch_wallets'
const ACTIVE_KEY = 'cyberswitch_active'
const CONNECTED_SITES_KEY = 'cyberswitch_connected_sites'
const ARC_CHAIN_ID = '0x4CE052'
const ARC_RPC = 'https://rpc.testnet.arc.network'

console.log('[CyberSwitch Background Started]', new Date().toISOString())

// ── Clear ALL transient request state on startup ──
// This is the key fix — stale cs_* keys from previous sessions
// cause "duplicate queued" and block new connections entirely.
// Wallet data uses cyberswitch_* prefix and is NOT affected.
chrome.storage.local.get(null, (res: any) => {
  const transientKeys = Object.keys(res).filter(k =>
    k.startsWith('cs_')
  )
  if (transientKeys.length > 0) {
    chrome.storage.local.remove(transientKeys)
    console.log('[CyberSwitch] Cleared', transientKeys.length, 'stale transient keys on startup')
  }
})

// ── Keep alive via alarms ─────────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') chrome.runtime.getPlatformInfo(() => {})
})

chrome.runtime.onSuspend.addListener(() => {
  console.log('[CyberSwitch] Worker suspending')
})

// ── Storage helpers ───────────────────────────
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

// ── Pending request tracking ──────────────────
const encodeOrigin = (origin: string) =>
  origin.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)

const getPendingReqsKey = (origin: string) =>
  `cs_pending_reqs_${encodeOrigin(origin)}`

const addPendingReqId = async (origin: string, requestId: string): Promise<void> => {
  const key = getPendingReqsKey(origin)
  const existing: string[] = (await storage.get(key)) || []
  if (!existing.includes(requestId)) {
    await storage.set(key, [...existing, requestId])
  }
}

const getPendingReqIds = async (origin: string): Promise<string[]> =>
  (await storage.get(getPendingReqsKey(origin))) || []

const clearPendingReqIds = async (origin: string): Promise<void> =>
  storage.remove(getPendingReqsKey(origin))

const isOriginPending = async (origin: string): Promise<boolean> => {
  const reqs = await getPendingReqIds(origin)
  return reqs.length > 0
}

// ── Resolve ALL pending requests for an origin ─
const resolveAllPendingReqs = async (
  origin: string,
  result: any,
  error: any = null
): Promise<void> => {
  const reqIds = await getPendingReqIds(origin)
  console.log('[CyberSwitch] Resolving', reqIds.length, 'pending requests for', origin)
  await Promise.all(
    reqIds.map(reqId =>
      storage.set(`cs_resp_${reqId}`, {
        result: error ? null : result,
        error,
        ts: Date.now()
      })
    )
  )
  await clearPendingReqIds(origin)
}

// ── Wallet helpers ────────────────────────────
const getActiveWallet = async () => {
  try {
    const [wallets, idx] = await Promise.all([
      storage.get(WALLETS_KEY),
      storage.get(ACTIVE_KEY)
    ])
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
  try {
    await (chrome.action as any).openPopup()
    chrome.action.setBadgeText({ text: '' })
  } catch {
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#f87171' })
  }
}

// ── Clean up stale response keys every 5 min ──
setInterval(() => {
  chrome.storage.local.get(null, (res: any) => {
    const stale = Object.keys(res).filter(k =>
      k.startsWith('cs_resp_') && res[k]?.ts && (Date.now() - res[k].ts) > 300000
    )
    if (stale.length) chrome.storage.local.remove(stale)
  })
}, 300000)

// ── Provider request handler ──────────────────
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
      // Already connected — return immediately
      const sites = await getConnectedSites()
      if (sites.includes(origin)) {
        const wallet = await getActiveWallet()
        console.log('[CyberSwitch] Already connected:', origin)
        return wallet ? [wallet.address] : []
      }

      const alreadyPending = await isOriginPending(origin)
      await addPendingReqId(origin, requestId)

      if (alreadyPending) {
        console.log('[CyberSwitch] Duplicate queued for:', origin, requestId)
        return 'PENDING'
      }

      // First request for this origin — open popup
      await storage.set('cs_pending', {
        type: 'connect',
        data: { origin },
        requestId,
        ts: Date.now(),
      })

      console.log('[CyberSwitch] Opening popup for connect:', origin)
      await openPopup()
      return 'PENDING'
    }

    case 'eth_sendTransaction': {
      const sites = await getConnectedSites()
      if (!sites.includes(origin)) throw { code: 4100, message: 'Connect first.' }
      await storage.set('cs_pending', {
        type: 'transaction',
        data: { origin, txParams: params?.[0] },
        requestId,
        ts: Date.now(),
      })
      await openPopup()
      return 'PENDING'
    }

    case 'eth_sign':
    case 'personal_sign': {
      const sites = await getConnectedSites()
      if (!sites.includes(origin)) throw { code: 4100, message: 'Connect first.' }
      const message = method === 'personal_sign' ? params?.[0] : params?.[1]
      await storage.set('cs_pending', {
        type: 'sign',
        data: { origin, message },
        requestId,
        ts: Date.now(),
      })
      await openPopup()
      return 'PENDING'
    }

    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain':
      if (params?.[0]?.chainId !== ARC_CHAIN_ID)
        throw { code: 4902, message: 'CyberSwitch only supports Arc Testnet.' }
      return null

    case 'eth_getBalance': return rpcCall('eth_getBalance', params)
    case 'eth_blockNumber': return rpcCall('eth_blockNumber', [])
    case 'eth_getTransactionByHash': return rpcCall('eth_getTransactionByHash', params)
    case 'eth_getTransactionReceipt': return rpcCall('eth_getTransactionReceipt', params)
    case 'eth_call': return rpcCall('eth_call', params)
    case 'eth_estimateGas': return rpcCall('eth_estimateGas', params)
    case 'eth_gasPrice': return rpcCall('eth_gasPrice', [])

    case 'wallet_disconnect':
      await removeConnectedSite(origin)
      await clearPendingReqIds(origin)
      return null

    default:
      throw { code: -32601, message: `Method ${method} not supported` }
  }
}

// ── Main message listener ─────────────────────
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  const { type, payload } = message

  if (type === 'CYBERSWITCH_APPROVAL_RESPONSE') {
    const { approved, origin, pendingType, requestId, result } = payload

    const handle = async () => {
      try {
        if (approved && pendingType === 'connect' && origin) {
          await addConnectedSite(origin)
          const wallet = await getActiveWallet()
          const addresses = wallet ? [wallet.address] : []
          // Resolve ALL queued requests for this origin
          await resolveAllPendingReqs(origin, addresses)

        } else if (approved) {
          await storage.set(`cs_resp_${requestId}`, {
            result: result ?? null, error: null, ts: Date.now()
          })
        } else {
          if (origin && pendingType === 'connect') {
            await resolveAllPendingReqs(origin, null, {
              code: 4001, message: 'User rejected the request'
            })
          } else {
            await storage.set(`cs_resp_${requestId}`, {
              result: null,
              error: { code: 4001, message: 'User rejected the request' },
              ts: Date.now()
            })
          }
        }

        await storage.remove('cs_pending')
        chrome.action.setBadgeText({ text: '' })
        console.log('[CyberSwitch] Approval complete:', approved, pendingType, origin)

      } catch (e) {
        console.error('[CyberSwitch] Approval error:', e)
        if (origin) {
          await resolveAllPendingReqs(origin, null, {
            code: -32603, message: 'Internal error'
          })
        }
      }
    }

    handle().then(() => { try { sendResponse({ ok: true }) } catch {} })
    return true
  }

  if (type === 'CYBERSWITCH_PROVIDER_REQUEST') {
    const origin = (() => {
      try {
        return sender?.origin ||
          (sender?.tab?.url ? new URL(sender.tab.url).origin : 'unknown')
      } catch { return 'unknown' }
    })()

    const req = { ...payload }
    handleProviderRequest(req, origin)
      .then(async result => {
        try {
          if (result !== 'PENDING') {
            await storage.set(`cs_resp_${req.requestId}`, {
              result, error: null, ts: Date.now()
            })
          }
          sendResponse({ ok: true })
        } catch {}
      })
      .catch(async error => {
        try {
          if (req.method === 'eth_requestAccounts' && origin) {
            await resolveAllPendingReqs(origin, null, {
              code: error.code || -32603,
              message: error.message || 'Unknown error'
            })
          } else {
            await storage.set(`cs_resp_${req.requestId}`, {
              result: null,
              error: { code: error.code || -32603, message: error.message || 'Unknown error' },
              ts: Date.now()
            })
          }
          sendResponse({ ok: true })
        } catch {}
      })
    return true
  }

  return false
})

console.log('CyberSwitch background worker running ✅')