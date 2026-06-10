import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const ARC_RPC = "https://rpc.testnet.arc.network"
export const ARC_EXPLORER_API = "https://testnet.arcscan.app/api/v2"

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC] },
  },
} as const

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC, {
    timeout: 20000,
    retryCount: 3,
    retryDelay: 1000,
  }),
})

const balanceCache = new Map<string, { balance: string; timestamp: number }>()
const BALANCE_CACHE_TIME = 8000

const isValidAddress = (address: string) =>
  /^0x[a-fA-F0-9]{40}$/.test(address)

export const getUSDCBalance = async (address: string): Promise<string> => {
  try {
    if (!isValidAddress(address)) return "0.00"

    const cached = balanceCache.get(address)
    if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TIME) {
      return cached.balance
    }

    const balance = await publicClient.getBalance({
      address: address as `0x${string}`,
    })

    const formatted = parseFloat(formatUnits(balance, 18)).toFixed(2)
    balanceCache.set(address, { balance: formatted, timestamp: Date.now() })
    return formatted
  } catch (error) {
    console.error("Balance fetch error:", error)
    return "0.00"
  }
}

export const sendUSDC = async (
  privateKey: string,
  toAddress: string,
  amount: string
): Promise<{ success: boolean; hash?: string; error?: string }> => {
  try {
    if (!privateKey.startsWith("0x"))
      return { success: false, error: "Invalid private key format" }
    if (!isValidAddress(toAddress))
      return { success: false, error: "Invalid recipient address" }

    const parsedAmount = Number(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0)
      return { success: false, error: "Invalid amount" }

    const account = privateKeyToAccount(privateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(ARC_RPC, {
        timeout: 20000,
        retryCount: 3,
        retryDelay: 1000,
      }),
    })

    const value = parseUnits(amount, 18)
    const hash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value,
    })

    balanceCache.delete(account.address)
    return { success: true, hash }
  } catch (error: any) {
    console.error("Send error:", error)
    return {
      success: false,
      error: error?.shortMessage || error?.message || "Transaction failed",
    }
  }
}

export const getTransactions = async (address: string): Promise<any[]> => {
  try {
    if (!isValidAddress(address)) return []

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const fetchOpts = {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    }

    // Fetch both sent (from) and received (to) transactions separately
    // then merge — some ArcScan deployments only return outgoing by default
    const [sentRes, receivedRes] = await Promise.allSettled([
      fetch(`${ARC_EXPLORER_API}/addresses/${address}/transactions?filter=from`, fetchOpts),
      fetch(`${ARC_EXPLORER_API}/addresses/${address}/transactions?filter=to`, fetchOpts),
    ])

    clearTimeout(timeout)

    const allItems: any[] = []
    const seenHashes = new Set<string>()

    for (const res of [sentRes, receivedRes]) {
      if (res.status === 'fulfilled' && res.value.ok) {
        const data = await res.value.json()
        const items = data?.items || []
        for (const tx of items) {
          const hash = tx.hash || tx.tx_hash
          if (hash && !seenHashes.has(hash)) {
            seenHashes.add(hash)
            allItems.push(tx)
          }
        }
      }
    }

    // If filter params not supported, fall back to unfiltered
    if (allItems.length === 0) {
      const fallback = await fetch(
        `${ARC_EXPLORER_API}/addresses/${address}/transactions`,
        { headers: { 'Accept': 'application/json' } }
      )
      if (fallback.ok) {
        const data = await fallback.json()
        return data?.items || []
      }
    }

    // Sort by timestamp descending (most recent first)
    allItems.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return tb - ta
    })

    return allItems

  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn('TX fetch timed out')
    } else {
      console.warn('TX fetch unavailable:', error?.message)
    }
    return []
  }
}

export const checkArcRpcHealth = async (): Promise<{
  ok: boolean
  blockNumber?: bigint
  latencyMs?: number
}> => {
  try {
    const start = performance.now()
    const blockNumber = await publicClient.getBlockNumber()
    const end = performance.now()
    return { ok: true, blockNumber, latencyMs: Math.round(end - start) }
  } catch (error) {
    console.error("RPC health check failed:", error)
    return { ok: false }
  }
}