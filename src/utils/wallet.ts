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

// ── Chrome/localStorage bridge ────────────────
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

// ── Crypto helpers ────────────────────────────
const buf2hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')

const hex2buf = (hex: string): ArrayBuffer => {
  const bytes = new Uint8Array(hex.match(/../g)!.map(h => parseInt(h, 16)))
  return bytes.buffer
}

const getOrCreateSalt = async (): Promise<Uint8Array> => {
  const stored = await store.get(SALT_KEY)
  if (stored) return new Uint8Array(hex2buf(stored))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  await store.set(SALT_KEY, buf2hex(salt.buffer))
  return salt
}

// Derive AES key from password using PBKDF2
const deriveKeyFromPassword = async (password: string): Promise<CryptoKey> => {
  const salt = await getOrCreateSalt()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// Get or create a device-level AES key (used when no password set)
const getOrCreateDeviceKey = async (): Promise<CryptoKey> => {
  const stored = await store.get(ENC_KEY_KEY)
  if (stored) {
    const rawKey = hex2buf(stored)
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const exported = await crypto.subtle.exportKey('raw', key)
  await store.set(ENC_KEY_KEY, buf2hex(exported))
  return key
}

// Encrypt a string → returns hex(iv + ciphertext)
const encryptString = async (text: string, key: CryptoKey): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(text)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), 12)
  return buf2hex(combined.buffer)
}

// Decrypt hex(iv + ciphertext) → string
const decryptString = async (hex: string, key: CryptoKey): Promise<string> => {
  const buf = new Uint8Array(hex2buf(hex))
  const iv = buf.slice(0, 12)
  const ciphertext = buf.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
}

// Get the current encryption key (password-derived or device key)
let _cachedKey: CryptoKey | null = null

export const getEncryptionKey = async (password?: string): Promise<CryptoKey> => {
  if (password) {
    _cachedKey = await deriveKeyFromPassword(password)
    return _cachedKey
  }
  if (_cachedKey) return _cachedKey
  const hasPwd = await hasPassword()
  if (!hasPwd) {
    _cachedKey = await getOrCreateDeviceKey()
    return _cachedKey
  }
  // Has password but none provided — use device key as fallback
  return getOrCreateDeviceKey()
}

export const setCachedKey = (key: CryptoKey) => { _cachedKey = key }
export const clearCachedKey = () => { _cachedKey = null }

// ── Password helpers ──────────────────────────
const hashPassword = async (password: string): Promise<string> => {
  const salt = await getOrCreateSalt()
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const keyMaterial = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return buf2hex(bits)
}

export const setPassword = async (password: string): Promise<void> => {
  const hash = await hashPassword(password)
  await store.set(PASSWORD_KEY, hash)
  // Re-encrypt all wallets with new password-derived key
  _cachedKey = await deriveKeyFromPassword(password)
  const wallets = await loadWallets()
  if (wallets.length > 0) await saveWallets(wallets)
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
  store.remove(PASSWORD_KEY)
  // Re-encrypt with device key
  _cachedKey = await getOrCreateDeviceKey()
  const wallets = await loadWallets()
  if (wallets.length > 0) await saveWallets(wallets)
}

// ── Wallet operations ─────────────────────────
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

    // Check if old unencrypted format
    const firstWallet = stored[0] as any
    if (firstWallet.privateKey && !firstWallet.encPrivateKey) {
      // Migrate old unencrypted wallets
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
  } catch (e) {
    console.error('loadWallets error:', e)
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