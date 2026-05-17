import { ethers } from 'ethers'

const WALLETS_KEY = 'cyberswitch_wallets'
const ACTIVE_KEY = 'cyberswitch_active'

export interface WalletData {
  address: string
  privateKey: string
  mnemonic: string
  name: string
}

const isChrome = typeof chrome !== 'undefined' && !!chrome.storage

const store = {
  get: (key: string): Promise<any> => {
    if (isChrome) return new Promise(r => chrome.storage.local.get([key], res => r(res[key])))
    const d = localStorage.getItem(key)
    return Promise.resolve(d ? JSON.parse(d) : null)
  },
  set: (key: string, value: any): void => {
    if (isChrome) chrome.storage.local.set({ [key]: value })
    else localStorage.setItem(key, JSON.stringify(value))
  },
  remove: (key: string): void => {
    if (isChrome) chrome.storage.local.remove([key])
    else localStorage.removeItem(key)
  }
}

export const createWallet = (name: string): WalletData => {
  const w = ethers.Wallet.createRandom()
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || '', name }
}

export const importWallet = (mnemonic: string, name: string): WalletData => {
  const w = ethers.Wallet.fromPhrase(mnemonic)
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || '', name }
}

export const loadWallets = (): Promise<WalletData[]> =>
  store.get(WALLETS_KEY).then(d => d || [])

export const saveWallets = (wallets: WalletData[]): void =>
  store.set(WALLETS_KEY, wallets)

export const loadActiveIndex = (): Promise<number> =>
  store.get(ACTIVE_KEY).then(d => d ?? 0)

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