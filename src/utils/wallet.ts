import { ethers } from 'ethers'

const WALLETS_KEY = 'cyberswitch_wallets'
const ACTIVE_KEY = 'cyberswitch_active'
const PASSWORD_KEY = 'cyberswitch_password'

export interface WalletData {
  address: string
  privateKey: string
  mnemonic: string
  name: string
}

const isChromeExtension = (): boolean => {
  try {
    return typeof (globalThis as any).chrome !== 'undefined' &&
      !!(globalThis as any).chrome?.storage?.local
  } catch { return false }
}

const chromeStorage = () => (globalThis as any).chrome?.storage?.local

const store = {
  get: (key: string): Promise<any> => {
    if (isChromeExtension()) {
      return new Promise(r => chromeStorage().get([key], (res: any) => r(res[key])))
    }
    const d = localStorage.getItem(key)
    return Promise.resolve(d ? JSON.parse(d) : null)
  },
  set: (key: string, value: any): void => {
    if (isChromeExtension()) chromeStorage().set({ [key]: value })
    else localStorage.setItem(key, JSON.stringify(value))
  },
  remove: (key: string): void => {
    if (isChromeExtension()) chromeStorage().remove([key])
    else localStorage.removeItem(key)
  }
}

// ── Password helpers ──────────────────────────
const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'cyberswitch_salt_v1')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export const setPassword = async (password: string): Promise<void> => {
  const hash = await hashPassword(password)
  store.set(PASSWORD_KEY, hash)
}

export const verifyPassword = async (password: string): Promise<boolean> => {
  const stored = await store.get(PASSWORD_KEY)
  if (!stored) return true // no password set
  const hash = await hashPassword(password)
  return hash === stored
}

export const hasPassword = (): Promise<boolean> =>
  store.get(PASSWORD_KEY).then(p => !!p)

export const removePassword = (): void => store.remove(PASSWORD_KEY)

// ── Wallet helpers ────────────────────────────
export const createWallet = (name: string): WalletData => {
  const w = ethers.Wallet.createRandom()
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || '', name }
}

export const importWallet = (mnemonic: string, name: string): WalletData => {
  const w = ethers.Wallet.fromPhrase(mnemonic)
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || '', name }
}

export const loadWallets = (): Promise<WalletData[]> =>
  store.get(WALLETS_KEY).then((d: any) => d || [])

export const saveWallets = (wallets: WalletData[]): void =>
  store.set(WALLETS_KEY, wallets)

export const loadActiveIndex = (): Promise<number> =>
  store.get(ACTIVE_KEY).then((d: any) => d ?? 0)

export const saveActiveIndex = (index: number): void =>
  store.set(ACTIVE_KEY, index)

export const addWallet = async (wallet: WalletData): Promise<{ wallets: WalletData[]; index: number }> => {
  const wallets = await loadWallets()
  wallets.push(wallet)
  saveWallets(wallets)
  const index = wallets.length - 1
  saveActiveIndex(index)
  return { wallets, index }
}

export const deleteWalletAtIndex = async (index: number): Promise<{ wallets: WalletData[]; newIndex: number }> => {
  const wallets = await loadWallets()
  wallets.splice(index, 1)
  saveWallets(wallets)
  const newIndex = Math.max(0, index - 1)
  saveActiveIndex(newIndex)
  return { wallets, newIndex }
}

export const deleteWallet = (): void => {
  store.remove(WALLETS_KEY)
  store.remove(ACTIVE_KEY)
}