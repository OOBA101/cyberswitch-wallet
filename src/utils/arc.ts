import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
}

export const getUSDCBalance = async (address: string): Promise<string> => {
  try {
    const client = createPublicClient({
      chain: arcTestnet as any,
      transport: http(),
    })
    const balance = await client.getBalance({
      address: address as `0x${string}`,
    })
    return parseFloat(formatUnits(balance, 18)).toFixed(2)
  } catch (error) {
    console.error('Balance fetch error:', error)
    return '0.00'
  }
}

export const sendUSDC = async (
  privateKey: string,
  toAddress: string,
  amount: string
): Promise<{ success: boolean; hash?: string; error?: string }> => {
  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet as any,
      transport: http(),
    })
    const hash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value: parseUnits(amount, 18),
    })
    return { success: true, hash }
  } catch (error: any) {
    console.error('Send error:', error)
    return { success: false, error: error.message }
  }
}
export const getTransactions = async (address: string): Promise<any[]> => {
  try {
    const response = await fetch(
      `https://testnet.arcscan.app/api/v2/addresses/${address}/transactions`
    )
    if (!response.ok) return []
    const data = await response.json()
    return data.items || []
  } catch (error) {
    console.error('TX fetch error:', error)
    return []
  }
}