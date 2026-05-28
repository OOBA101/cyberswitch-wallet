let requestCounter = 0

// Poll storage until response appears
const pollForResponse = (storageKey: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const maxWait = 300000 // 5 minutes
    const interval = 600
    let elapsed = 0

    const poll = setInterval(() => {
      elapsed += interval

      if (elapsed > maxWait) {
        clearInterval(poll)
        reject(new Error('Request timed out'))
        return
      }

      try {
        if (!chrome?.runtime?.id) return // Extension context lost, keep trying

        chrome.storage.local.get([storageKey], (res: any) => {
          try {
            if (chrome.runtime.lastError) return

            const val = res?.[storageKey]
            if (val === undefined || val === null) return
            if (typeof val.ts !== 'number') return

            clearInterval(poll)

            // Clean up
            try { chrome.storage.local.remove([storageKey]) } catch {}

            if (val.error) {
              const err = new Error(val.error.message || 'Request failed')
              ;(err as any).code = val.error.code
              reject(err)
            } else {
              resolve(val.result)
            }
          } catch {}
        })
      } catch {
        // Keep polling even if context briefly lost
      }
    }, interval)
  })
}

// Send message to background (fire and forget — we poll for response)
const sendToBackground = (method: string, params: any[], requestId: string) => {
  try {
    if (!chrome?.runtime?.id) return
    chrome.runtime.sendMessage(
      {
        type: 'CYBERSWITCH_PROVIDER_REQUEST',
        payload: { method, params, requestId },
      },
      () => {
        // Ignore response — we poll storage instead
        try { if (chrome.runtime.lastError) {} } catch {}
      }
    )
  } catch {}
}

// Bridge messages from injected page script to background
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.type !== 'CYBERSWITCH_PAGE_REQUEST') return

  const { method, params, requestId: pageReqId } = event.data

  // Create a unique background request ID
  const bgReqId = `req_${Date.now()}_${++requestCounter}`

  // Fire request to background
  sendToBackground(method, params || [], bgReqId)

  // Poll storage for the response
  const storageKey = `cs_resp_${bgReqId}`

  pollForResponse(storageKey)
    .then(result => {
      window.postMessage({
        type: 'CYBERSWITCH_PAGE_RESPONSE',
        requestId: pageReqId,
        result,
      }, '*')
    })
    .catch(error => {
      window.postMessage({
        type: 'CYBERSWITCH_PAGE_RESPONSE',
        requestId: pageReqId,
        error: {
          code: (error as any).code || 4001,
          message: error.message || 'Request failed',
        },
      }, '*')
    })
})

// Forward chain/account changes from background to page
chrome.runtime.onMessage.addListener((message: any) => {
  try {
    if (message.type === 'CYBERSWITCH_CHAIN_CHANGED') {
      window.postMessage({ type: 'CYBERSWITCH_CHAIN_CHANGED', chainId: message.chainId }, '*')
    }
    if (message.type === 'CYBERSWITCH_ACCOUNTS_CHANGED') {
      window.postMessage({ type: 'CYBERSWITCH_ACCOUNTS_CHANGED', accounts: message.accounts }, '*')
    }
  } catch {}
})

// Inject the page-level provider script
function injectScript() {
  try {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('injected.js')
    script.onload = () => script.remove()
    ;(document.head || document.documentElement).appendChild(script)
  } catch (e) {
    console.error('[CyberSwitch] Injection failed:', e)
  }
}

injectScript()