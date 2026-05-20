// ─────────────────────────────────────────────
// CyberSwitch Content Script
// Injects window.ethereum into every webpage
// ─────────────────────────────────────────────

const sendToBackground = (method: string, params?: any[]): Promise<any> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'CYBERSWITCH_PROVIDER_REQUEST',
        payload: { method, params: params || [] },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (response?.error) {
          const err = new Error(response.error.message)
          ;(err as any).code = response.error.code
          reject(err)
          return
        }
        resolve(response?.result)
      }
    )
  })
}

// ── Build the ethereum provider object ────────
const cyberswitchProvider = {
  isMetaMask: false,
  isCyberSwitch: true,
  chainId: '0x4CE052',
  networkVersion: '5042002',
  selectedAddress: null as string | null,
  _connected: false,
  _listeners: new Map<string, Function[]>(),

  // ── Event emitter ──────────────────────────
  on(event: string, handler: Function) {
    if (!this._listeners.has(event)) this._listeners.set(event, [])
    this._listeners.get(event)!.push(handler)
    return this
  },

  removeListener(event: string, handler: Function) {
    const listeners = this._listeners.get(event) || []
    this._listeners.set(event, listeners.filter(l => l !== handler))
    return this
  },

  emit(event: string, ...args: any[]) {
    const listeners = this._listeners.get(event) || []
    listeners.forEach(l => l(...args))
  },

  // ── Core EIP-1193 method ───────────────────
  async request({ method, params }: { method: string; params?: any[] }): Promise<any> {
    const result = await sendToBackground(method, params)

    // Update internal state after successful calls
    if (method === 'eth_requestAccounts' && result?.length > 0) {
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

  // ── Legacy methods (some dApps still use these) ──
  async enable(): Promise<string[]> {
    return this.request({ method: 'eth_requestAccounts' })
  },

  async send(method: string, params?: any[]): Promise<any> {
    return this.request({ method, params })
  },

  async sendAsync(
    payload: { method: string; params?: any[] },
    callback: (error: any, result: any) => void
  ) {
    try {
      const result = await this.request(payload)
      callback(null, { jsonrpc: '2.0', id: 1, result })
    } catch (error: any) {
      callback(error, null)
    }
  },

  isConnected(): boolean {
    return this._connected
  },
}

// ── Inject into window ────────────────────────
const injectProvider = () => {
  try {
    // Don't override if another wallet already exists and user hasn't chosen us
    if (!(window as any).ethereum) {
      Object.defineProperty(window, 'ethereum', {
        value: cyberswitchProvider,
        writable: false,
        configurable: false,
      })
    }

    // Always expose as cyberswitch regardless
    ;(window as any).cyberswitch = cyberswitchProvider

    // Dispatch event so dApps know a provider is available
    window.dispatchEvent(new Event('ethereum#initialized'))

    console.log('CyberSwitch wallet injected ✅')
  } catch (error) {
    console.error('CyberSwitch injection error:', error)
  }
}

// Inject immediately
injectProvider()

// Also listen for messages from the background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CYBERSWITCH_CHAIN_CHANGED') {
    cyberswitchProvider.chainId = message.chainId
    cyberswitchProvider.emit('chainChanged', message.chainId)
  }

  if (message.type === 'CYBERSWITCH_ACCOUNTS_CHANGED') {
    cyberswitchProvider.selectedAddress = message.accounts[0] || null
    cyberswitchProvider.emit('accountsChanged', message.accounts)
  }
})