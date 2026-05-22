// ─────────────────────────────────────────────
// CyberSwitch Injected Provider
// Runs in page context (not isolated world)
// ─────────────────────────────────────────────

;(function() {
  let requestId = 0
  const pending = new Map()

  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type !== 'CYBERSWITCH_PAGE_RESPONSE') return

    const { requestId: id, result, error } = event.data
    const pending_req = pending.get(id)
    if (!pending_req) return

    if (error) {
      const err = new Error(error.message)
      err.code = error.code
      pending_req.reject(err)
    } else {
      pending_req.resolve(result)
    }
    pending.delete(id)
  })

  const sendRequest = (method, params) => {
    return new Promise((resolve, reject) => {
      const id = ++requestId
      pending.set(id, { resolve, reject })
      window.postMessage({
        type: 'CYBERSWITCH_PAGE_REQUEST',
        method,
        params: params || [],
        requestId: id
      }, '*')
      // Timeout after 30s
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error('Request timed out'))
        }
      }, 30000)
    })
  }

  const provider = {
    isMetaMask: false,
    isCyberSwitch: true,
    chainId: '0x4CE052',
    networkVersion: '5042002',
    selectedAddress: null,
    _connected: false,
    _listeners: {},

    on(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = []
      this._listeners[event].push(handler)
      return this
    },

    removeListener(event, handler) {
      if (!this._listeners[event]) return this
      this._listeners[event] = this._listeners[event].filter(l => l !== handler)
      return this
    },

    emit(event, ...args) {
      if (!this._listeners[event]) return
      this._listeners[event].forEach(l => l(...args))
    },

    async request({ method, params }) {
      const result = await sendRequest(method, params)
      if (method === 'eth_requestAccounts' && Array.isArray(result) && result.length > 0) {
        this.selectedAddress = result[0]
        this._connected = true
        this.emit('accountsChanged', result)
        this.emit('connect', { chainId: this.chainId })
      }
      if (method === 'wallet_disconnect') {
        this.selectedAddress = null
        this._connected = false
        this.emit('accountsChanged', [])
        this.emit('disconnect', { code: 4900, message: 'Disconnected' })
      }
      return result
    },

    async enable() {
      return this.request({ method: 'eth_requestAccounts' })
    },

    async send(method, params) {
      return this.request({ method, params })
    },

    async sendAsync(payload, callback) {
      try {
        const result = await this.request(payload)
        callback(null, { jsonrpc: '2.0', id: 1, result })
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
      provider.emit('chainChanged', event.data.chainId)
    }
    if (event.data?.type === 'CYBERSWITCH_ACCOUNTS_CHANGED') {
      provider.selectedAddress = event.data.accounts[0] || null
      provider.emit('accountsChanged', event.data.accounts)
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
  window.dispatchEvent(new Event('ethereum#initialized'))

  console.log('CyberSwitch wallet ready ✅')
  
  // ── EIP-6963 Multi-wallet support ─────────────
const announceProvider = () => {
  const info = {
    uuid: 'cyberswitch-wallet-v1',
    name: 'CyberSwitch Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%230d1b6e"/><circle cx="50" cy="50" r="30" fill="none" stroke="white" stroke-width="8"/><circle cx="50" cy="50" r="12" fill="white"/></svg>',
    rdns: 'com.cyberswitch.wallet'
  }

  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info, provider })
  }))
}

window.addEventListener('eip6963:requestProvider', () => {
  announceProvider()
})

announceProvider()
})()