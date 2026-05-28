;(function () {
  if (window.__cyberswitchLoaded) return
  window.__cyberswitchLoaded = true

  let requestId = 0
  const pending = new Map()

  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type !== 'CYBERSWITCH_PAGE_RESPONSE') return

    const { requestId: id, result, error } = event.data
    const req = pending.get(id)
    if (!req) return

    clearTimeout(req.timer)
    pending.delete(id)

    if (error) {
      const err = new Error(error.message || 'Request failed')
      err.code = error.code
      req.reject(err)
    } else {
      req.resolve(result)
    }
  })

  const sendRequest = (method, params) => {
    return new Promise((resolve, reject) => {
      const id = ++requestId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('CyberSwitch: Request timed out'))
      }, 300000) // 5 min timeout — user needs time to approve

      pending.set(id, { resolve, reject, timer })

      window.postMessage({
        type: 'CYBERSWITCH_PAGE_REQUEST',
        method,
        params: params || [],
        requestId: id,
      }, '*')
    })
  }

  const listeners = {}

  const emit = (event, ...args) => {
    const handlers = listeners[event] || []
    handlers.forEach(h => { try { h(...args) } catch {} })
  }

  const provider = {
    isMetaMask: false,
    isCyberSwitch: true,
    chainId: '0x4CE052',
    networkVersion: '5042002',
    selectedAddress: null,
    _connected: false,

    on(event, handler) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
      return this
    },

    removeListener(event, handler) {
      if (!listeners[event]) return this
      listeners[event] = listeners[event].filter(l => l !== handler)
      return this
    },

    async request({ method, params }) {
      console.log('[CyberSwitch] request:', method)

      const result = await sendRequest(method, params)

      console.log('[CyberSwitch] result:', method, result)

      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        if (Array.isArray(result) && result.length > 0) {
          const prevAddress = this.selectedAddress
          this.selectedAddress = result[0]
          this._connected = true

          if (!prevAddress) {
            emit('connect', { chainId: this.chainId })
          }
          if (prevAddress !== result[0]) {
            emit('accountsChanged', result)
          }
        }
      }

      if (method === 'wallet_disconnect') {
        this.selectedAddress = null
        this._connected = false
        emit('accountsChanged', [])
        emit('disconnect', { code: 4900, message: 'Disconnected' })
      }

      return result
    },

    // Legacy support
    async enable() {
      return this.request({ method: 'eth_requestAccounts' })
    },

    async send(methodOrPayload, params) {
      if (typeof methodOrPayload === 'string') {
        return this.request({ method: methodOrPayload, params })
      }
      return this.request(methodOrPayload)
    },

    async sendAsync(payload, callback) {
      try {
        const result = await this.request(payload)
        callback(null, { jsonrpc: '2.0', id: payload.id || 1, result })
      } catch (error) {
        callback(error, null)
      }
    },

    isConnected() {
      return this._connected
    }
  }

  // Listen for events from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type === 'CYBERSWITCH_CHAIN_CHANGED') {
      provider.chainId = event.data.chainId
      emit('chainChanged', event.data.chainId)
    }
    if (event.data?.type === 'CYBERSWITCH_ACCOUNTS_CHANGED') {
      const accounts = event.data.accounts || []
      provider.selectedAddress = accounts[0] || null
      provider.isConnected = accounts.length > 0
      emit('accountsChanged', accounts)
    }
  })

  // Inject into window
  if (!window.ethereum) {
    Object.defineProperty(window, 'ethereum', {
      value: provider,
      writable: false,
      configurable: false,
    })
  }

  window.cyberswitch = provider

  // EIP-6963
  const info = {
    uuid: 'cyberswitch-wallet-v1',
    name: 'CyberSwitch Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%230d1b6e"/><circle cx="50" cy="50" r="30" fill="none" stroke="white" stroke-width="8"/><circle cx="50" cy="50" r="12" fill="white"/></svg>',
    rdns: 'com.cyberswitch.wallet'
  }

  const announceProvider = () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider })
    }))
  }

  window.addEventListener('eip6963:requestProvider', announceProvider)
  announceProvider()

  // Fire initialized event — many dApps wait for this
  window.dispatchEvent(new Event('ethereum#initialized'))

  console.log('[CyberSwitch] Provider injected ✅', window.ethereum)
})()