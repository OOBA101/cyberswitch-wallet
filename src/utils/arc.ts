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

    const response = await fetch(
      `${ARC_EXPLORER_API}/addresses/${address}/transactions`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        mode: 'cors',
      }
    )

    clearTimeout(timeout)

    if (!response.ok) {
      console.error("TX fetch error:", response.status)
      return []
    }

    const data = await response.json()
    return data?.items || []
  } catch (error: any) {
    // CORS or network error — fail silently, don't crash the app
    if (error?.name === 'AbortError') {
      console.warn("TX fetch timed out")
    } else {
      console.warn("TX fetch unavailable:", error?.message)
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