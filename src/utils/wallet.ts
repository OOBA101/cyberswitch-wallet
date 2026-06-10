import { ethers } from 'ethers'

const WALLETS_KEY = 'cyberswitch_wallets'
const ACTIVE_KEY = 'cyberswitch_active'
const PASSWORD_KEY = 'cyberswitch_password'
const ENC_KEY_KEY = 'cyberswitch_enc_key'
const SALT_KEY = 'cyberswitch_salt'

export interface WalletData {
  address: string
  privateKey: string
  mnemonic: string
  name: string
}

interface StoredWallet {
  address: string
  name: string
  encPrivateKey: string
  encMnemonic: string
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
      return new Promise(r => chromeStorage().get([key], (res: any) => r(res[key] ?? null)))
    }
    const d = localStorage.getItem(key)
    return Promise.resolve(d ? JSON.parse(d) : null)
  },
  set: (key: string, value: any): Promise<void> => {
    if (isChromeExtension()) {
      return new Promise(r => chromeStorage().set({ [key]: value }, r))
    }
    localStorage.setItem(key, JSON.stringify(value))
    return Promise.resolve()
  },
  remove: (key: string): void => {
    if (isChromeExtension()) chromeStorage().remove([key])
    else localStorage.removeItem(key)
  }
}

// ── Crypto helpers ──────────────────────────────────────
const buf2hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')

const hex2buf = (hex: string): ArrayBuffer => {
  const bytes = new Uint8Array(hex.match(/../g)!.map(h => parseInt(h, 16)))
  return bytes.buffer as ArrayBuffer  // cast to ArrayBuffer (not SharedArrayBuffer)
}

// Returns ArrayBuffer so WebCrypto APIs accept it without type errors
const getOrCreateSalt = async (): Promise<ArrayBuffer> => {
  const stored = await store.get(SALT_KEY)
  if (stored) return hex2buf(stored)
  const saltBytes = new Uint8Array(16)
  crypto.getRandomValues(saltBytes)
  const saltBuffer = saltBytes.buffer as ArrayBuffer
  await store.set(SALT_KEY, buf2hex(saltBuffer))
  return saltBuffer
}

const deriveKeyFromPassword = async (password: string): Promise<CryptoKey> => {
  const salt = await getOrCreateSalt() // ArrayBuffer — accepted by PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

const getOrCreateDeviceKey = async (): Promise<CryptoKey> => {
  const stored = await store.get(ENC_KEY_KEY)
  if (stored) {
    return crypto.subtle.importKey('raw', hex2buf(stored), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const exported = await crypto.subtle.exportKey('raw', key)
  await store.set(ENC_KEY_KEY, buf2hex(exported))
  return key
}

const encryptString = async (text: string, key: CryptoKey): Promise<string> => {
  const ivBytes = new Uint8Array(12)
  crypto.getRandomValues(ivBytes)
  const iv = ivBytes.buffer as ArrayBuffer
  const encoded = new TextEncoder().encode(text)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, encoded)
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(ivBytes, 0)
  combined.set(new Uint8Array(ciphertext), 12)
  return buf2hex(combined.buffer as ArrayBuffer)
}

const decryptString = async (hex: string, key: CryptoKey): Promise<string> => {
  const buf = new Uint8Array(hex2buf(hex))
  const iv = buf.slice(0, 12)
  const ciphertext = buf.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
}

let _cachedKey: CryptoKey | null = null

export const getEncryptionKey = async (): Promise<CryptoKey> => {
  if (_cachedKey) return _cachedKey
  const hasPwd = await hasPassword()
  if (!hasPwd) {
    _cachedKey = await getOrCreateDeviceKey()
    return _cachedKey
  }
  return getOrCreateDeviceKey()
}

export const setCachedKey = (key: CryptoKey) => { _cachedKey = key }
export const clearCachedKey = () => { _cachedKey = null }

// ── Password helpers ──────────────────────────────────────
const hashPassword = async (password: string): Promise<string> => {
  const salt = await getOrCreateSalt() // ArrayBuffer
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return buf2hex(bits as ArrayBuffer) // ← missing return was the bug
}

export const setPassword = async (password: string): Promise<void> => {
  // KEY FIX: Load wallets with CURRENT key BEFORE switching
  const currentWallets = await loadWallets()

  const hash = await hashPassword(password)
  await store.set(PASSWORD_KEY, hash)

  _cachedKey = await deriveKeyFromPassword(password)

  if (currentWallets.length > 0) await saveWallets(currentWallets)
}

export const verifyPassword = async (password: string): Promise<boolean> => {
  const stored = await store.get(PASSWORD_KEY)
  if (!stored) return true
  const hash = await hashPassword(password)
  if (hash === stored) {
    _cachedKey = await deriveKeyFromPassword(password)
    return true
  }
  return false
}

export const hasPassword = (): Promise<boolean> =>
  store.get(PASSWORD_KEY).then(p => !!p)

export const removePassword = async (): Promise<void> => {
  // KEY FIX: Load wallets with CURRENT (password) key BEFORE switching
  const currentWallets = await loadWallets()

  store.remove(PASSWORD_KEY)
  _cachedKey = await getOrCreateDeviceKey()

  if (currentWallets.length > 0) await saveWallets(currentWallets)
}

// ── Wallet operations ─────────────────────────────────────
export const createWallet = (name: string): WalletData => {
  const w = ethers.Wallet.createRandom()
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || '', name }
}

export const importWallet = (mnemonic: string, name: string): WalletData => {
  const w = ethers.Wallet.fromPhrase(mnemonic)
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || '', name }
}

export const loadWallets = async (): Promise<WalletData[]> => {
  try {
    const stored: StoredWallet[] | null = await store.get(WALLETS_KEY)
    if (!stored || stored.length === 0) return []

    const firstWallet = stored[0] as any
    if (firstWallet.privateKey && !firstWallet.encPrivateKey) {
      console.log('Migrating unencrypted wallets...')
      const wallets: WalletData[] = stored as any
      await saveWallets(wallets)
      return wallets
    }

    const key = await getEncryptionKey()
    const wallets: WalletData[] = await Promise.all(
      stored.map(async (w) => ({
        address: w.address,
        name: w.name,
        privateKey: await decryptString(w.encPrivateKey, key),
        mnemonic: await decryptString(w.encMnemonic, key),
      }))
    )
    return wallets
  } catch (e: any) {
    console.error('loadWallets error:', e, e?.name, e?.message)
    return []
  }
}

export const saveWallets = async (wallets: WalletData[]): Promise<void> => {
  try {
    const key = await getEncryptionKey()
    const stored: StoredWallet[] = await Promise.all(
      wallets.map(async (w) => ({
        address: w.address,
        name: w.name,
        encPrivateKey: await encryptString(w.privateKey, key),
        encMnemonic: await encryptString(w.mnemonic, key),
      }))
    )
    await store.set(WALLETS_KEY, stored)
  } catch (e) {
    console.error('saveWallets error:', e)
  }
}

export const loadActiveIndex = (): Promise<number> =>
  store.get(ACTIVE_KEY).then((d: any) => d ?? 0)

export const saveActiveIndex = (index: number): void => {
  store.set(ACTIVE_KEY, index)
}

export const addWallet = async (wallet: WalletData): Promise<{ wallets: WalletData[]; index: number }> => {
  const wallets = await loadWallets()
  wallets.push(wallet)
  await saveWallets(wallets)
  const index = wallets.length - 1
  saveActiveIndex(index)
  return { wallets, index }
}

export const deleteWalletAtIndex = async (index: number): Promise<{ wallets: WalletData[]; newIndex: number }> => {
  const wallets = await loadWallets()
  wallets.splice(index, 1)
  await saveWallets(wallets)
  const newIndex = Math.max(0, index - 1)
  saveActiveIndex(newIndex)
  return { wallets, newIndex }
}

export const deleteWallet = (): void => {
  store.remove(WALLETS_KEY)
  store.remove(ACTIVE_KEY)
  store.remove(ENC_KEY_KEY)
  store.remove(SALT_KEY)
  store.remove(PASSWORD_KEY)
  _cachedKey = null
}