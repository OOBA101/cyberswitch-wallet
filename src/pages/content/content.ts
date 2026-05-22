let requestCounter = 0

const pollStorage = (requestId: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const key = `cs_resp_${requestId}`
    const timeoutId = setTimeout(() => {
      clearInterval(pollId)
      reject(new Error('Request timed out'))
    }, 120000)

    const pollId = setInterval(() => {
      try {
        chrome.storage.local.get([key], (res: any) => {
          try {
            if (chrome.runtime.lastError) return
            const response = res[key]
            if (response === undefined || response === null) return
            clearInterval(pollId)
            clearTimeout(timeoutId)
            chrome.storage.local.remove([key])
            if (response.error) {
              const err = new Error(response.error.message)
              ;(err as any).code = response.error.code
              reject(err)
            } else {
              resolve(response.result)
            }
          } catch {}
        })
      } catch {
        clearInterval(pollId)
        clearTimeout(timeoutId)
        reject(new Error('Extension context lost'))
      }
    }, 600)
  })
}

const sendToBackground = (method: string, params: any[], requestId: string): void => {
  try {
    chrome.runtime.sendMessage({
      type: 'CYBERSWITCH_PROVIDER_REQUEST',
      payload: { method, params, requestId },
    }, () => { if (chrome.runtime.lastError) {} })
  } catch {}
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.type !== 'CYBERSWITCH_PAGE_REQUEST') return

  const { method, params, requestId: pageReqId } = event.data
  const bgReqId = `req_${Date.now()}_${++requestCounter}`

  sendToBackground(method, params || [], bgReqId)

  pollStorage(bgReqId)
    .then(result => {
      window.postMessage({ type: 'CYBERSWITCH_PAGE_RESPONSE', requestId: pageReqId, result }, '*')
    })
    .catch(error => {
      window.postMessage({ type: 'CYBERSWITCH_PAGE_RESPONSE', requestId: pageReqId, error: { message: error.message, code: (error as any).code } }, '*')
    })
})

chrome.runtime.onMessage.addListener((message: any) => {
  try {
    if (message.type === 'CYBERSWITCH_CHAIN_CHANGED') window.postMessage({ type: 'CYBERSWITCH_CHAIN_CHANGED', chainId: message.chainId }, '*')
    if (message.type === 'CYBERSWITCH_ACCOUNTS_CHANGED') window.postMessage({ type: 'CYBERSWITCH_ACCOUNTS_CHANGED', accounts: message.accounts }, '*')
  } catch {}
})

function injectScript() {
  try {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('injected.js')
    script.onload = () => script.remove()
    ;(document.head || document.documentElement).appendChild(script)
  } catch {}
}

injectScript()