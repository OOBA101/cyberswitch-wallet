import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import {
  createWallet, importWallet, loadWallets,
  loadActiveIndex, saveActiveIndex, addWallet,
  deleteWalletAtIndex, deleteWallet,
  setPassword, verifyPassword, hasPassword,
  removePassword
} from '../../utils/wallet.ts'
import type { WalletData } from '../../utils/wallet.ts'
import { getUSDCBalance, sendUSDC, getTransactions } from '../../utils/arc'

type Screen = 'loading' | 'locked' | 'setPassword' | 'welcome' | 'showPhrase' |
  'import' | 'dashboard' | 'send' | 'receive' | 'settings' | 'addWallet' |
  'addShowPhrase' | 'addImport' | 'confirmDelete' | 'revealPhrase' |
  'walletSwitcher' | 'txDetail' | 'approveConnect' | 'signToConnect' |
  'approveTx' | 'approveSign' | 'changePassword' | 'connectedSites'

const CyberSwitchLogo = ({ size = 40, opacity = 1 }: { size?: number; opacity?: number }) => {
  const arc = (startDeg: number, endDeg: number, R = 46, r = 20) => {
    const rad = (d: number) => (d * Math.PI) / 180
    const x1 = 50 + R * Math.cos(rad(startDeg)), y1 = 50 + R * Math.sin(rad(startDeg))
    const x2 = 50 + R * Math.cos(rad(endDeg)), y2 = 50 + R * Math.sin(rad(endDeg))
    const x3 = 50 + r * Math.cos(rad(endDeg)), y3 = 50 + r * Math.sin(rad(endDeg))
    const x4 = 50 + r * Math.cos(rad(startDeg)), y4 = 50 + r * Math.sin(rad(startDeg))
    const lg = Math.abs(endDeg - startDeg) >= 180 ? 1 : 0
    return `M${x1},${y1} A${R},${R},0,${lg},1,${x2},${y2} L${x3},${y3} A${r},${r},0,${lg},0,${x4},${y4} Z`
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ opacity }}>
      <path d={arc(108, 312)} fill="white" />
      <path d={arc(320, 344)} fill="#1a3aff" />
      <path d={arc(352, 388)} fill="white" />
      <path d={arc(36, 100)} fill="#1a3aff" />
      <circle cx="50" cy="50" r="14" fill="white" />
      <circle cx="50" cy="50" r="7" fill="#04041e" />
    </svg>
  )
}

const WatermarkBg = () => (
  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 0 }}>
    <CyberSwitchLogo size={280} opacity={0.04} />
  </div>
)

// Reusable password input with show/hide toggle
const PasswordInput = ({
  value, onChange, placeholder = 'Enter password', onKeyDown
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) => {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: '12px 44px 12px 14px', color: '#fff', fontSize: 14,
          outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const
        }}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        onClick={() => setShow(p => !p)}
        style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', color: '#7b8cde',
          fontSize: 16, padding: 4, lineHeight: 1
        }}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
}

export default function Popup() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [wallets, setWallets] = useState<WalletData[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [newMnemonic, setNewMnemonic] = useState('')
  const [importPhrase, setImportPhrase] = useState('')
  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState('0.00')
  const [transactions, setTransactions] = useState<any[]>([])
  const [confirming, setConfirming] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [phraseRevealed, setPhraseRevealed] = useState(false)
  const [balances, setBalances] = useState<Record<string, string>>({})
  const [selectedTx, setSelectedTx] = useState<any>(null)
  const [pendingRequest, setPendingRequest] = useState<any>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [connectedSites, setConnectedSites] = useState<string[]>([])
  const [signatureResult, setSignatureResult] = useState('')
  const [connectedToCurrentSite, setConnectedToCurrentSite] = useState(false)
  const [currentTabOrigin, setCurrentTabOrigin] = useState('')
  const [signToConnectPending, setSignToConnectPending] = useState<any>(null)
  const [signLoading, setSignLoading] = useState(false)

  const isHandlingApproval = useRef(false)
  const shownRequestIds = useRef(new Set<string>())

  const wallet = wallets[activeIndex] || null

  const fetchWalletData = (address: string) => {
    getUSDCBalance(address).then(b => {
      setBalance(b)
      setBalances(prev => ({ ...prev, [address]: b }))
    })
    getTransactions(address).then(setTransactions)
  }

  const refreshDashboard = (address: string) => {
    fetchWalletData(address)
    setScreen('dashboard')
  }

  // ── Helper: fully load wallets and navigate to dashboard ──
  const loadAndNavigate = async (idx?: number) => {
    const ws = await loadWallets()
    if (ws.length === 0) { setScreen('welcome'); return }
    setWallets(ws)
    const safeIdx = Math.min(idx ?? activeIndex, ws.length - 1)
    setActiveIndex(safeIdx)
    ws.forEach(w => getUSDCBalance(w.address).then(b =>
      setBalances(prev => ({ ...prev, [w.address]: b }))
    ))
    refreshDashboard(ws[safeIdx].address)
  }

  // ── Init ─────────────────────────────────────────────────
  // KEY FIX: Check password FIRST.
  // If password is set, show locked screen WITHOUT loading wallets.
  // loadWallets() is only called after verifyPassword() sets _cachedKey.
  useEffect(() => {
    const ch = (globalThis as any).chrome
    if (ch?.action) ch.action.setBadgeText({ text: '' })

    const init = async () => {
      try {
        const [idx, hasPwd] = await Promise.all([
          loadActiveIndex(), hasPassword(),
        ])

        if (hasPwd) {
          // Password is set — show lock screen, do NOT call loadWallets() yet.
          // loadWallets() needs _cachedKey which only gets set in verifyPassword().
          setActiveIndex(idx)
          setScreen('locked')
          return
        }

        // No password — safe to load wallets now
        const ws = await loadWallets()
        if (ws.length === 0) { setScreen('welcome'); return }
        setWallets(ws)
        const safeIdx = Math.min(idx, ws.length - 1)
        setActiveIndex(safeIdx)
        ws.forEach(w => getUSDCBalance(w.address).then(b =>
          setBalances(prev => ({ ...prev, [w.address]: b }))
        ))

        fetchWalletData(ws[safeIdx].address)

        if (isHandlingApproval.current) return

        const hasPendingApproval = await new Promise<boolean>(resolve => {
          if (!ch?.storage?.local) { resolve(false); return }
          ch.storage.local.get(['cs_pending'], (res: any) => {
            const p = res['cs_pending']
            resolve(!!(p && Date.now() - p.ts < 120000))
          })
        })

        if (hasPendingApproval) return

        setScreen('dashboard')

      } catch (e) {
        console.error('Init error:', e)
        setScreen('welcome')
      }
    }
    init()
  }, [])

  // ── Current tab connection ────────────────────
  useEffect(() => {
    const ch = (globalThis as any).chrome
    if (!ch?.tabs || !ch?.storage?.local) return
    ch.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
      if (!tabs[0]?.url) return
      try {
        const origin = new URL(tabs[0].url).origin
        setCurrentTabOrigin(origin)
        ch.storage.local.get(['cyberswitch_connected_sites'], (res: any) => {
          const sites: string[] = res['cyberswitch_connected_sites'] || []
          setConnectedToCurrentSite(sites.includes(origin))
        })
      } catch {}
    })
  }, [screen, connectedSites])

  // ── Pending approval checker ──────────────────
  useEffect(() => {
    const ch = (globalThis as any).chrome
    if (!ch?.storage?.local) return

    const handlePendingIfNew = (pending: any) => {
      if (!pending) return
      if (Date.now() - pending.ts > 120000) return
      if (isHandlingApproval.current) return
      if (shownRequestIds.current.has(pending.requestId)) return

      if (pending.type === 'connect' && pending.data?.origin) {
        ch.storage.local.get(['cyberswitch_connected_sites'], (res: any) => {
          const sites: string[] = res['cyberswitch_connected_sites'] || []
          if (sites.includes(pending.data.origin)) return

          isHandlingApproval.current = true
          shownRequestIds.current.add(pending.requestId)
          setPendingRequest(pending)
          setScreen('approveConnect')
        })
        return
      }

      isHandlingApproval.current = true
      shownRequestIds.current.add(pending.requestId)
      setPendingRequest(pending)
      if (pending.type === 'transaction') setScreen('approveTx')
      if (pending.type === 'sign') setScreen('approveSign')
    }

    ch.storage.local.get(['cs_pending'], (res: any) => {
      handlePendingIfNew(res['cs_pending'])
    })

    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      if (attempts >= 6) { clearInterval(interval); return }
      if (isHandlingApproval.current) return
      ch.storage.local.get(['cs_pending'], (res: any) => {
        handlePendingIfNew(res['cs_pending'])
      })
    }, 10000)

    const listener = (changes: any) => {
      if (!changes['cs_pending']?.newValue) return
      if (isHandlingApproval.current) return
      handlePendingIfNew(changes['cs_pending'].newValue)
    }

    ch.storage.onChanged?.addListener(listener)
    return () => {
      clearInterval(interval)
      try { ch.storage.onChanged?.removeListener(listener) } catch {}
    }
  }, [])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  // ── Send approval response ────────────────────
  const sendApprovalResponse = async (approved: boolean, result?: any) => {
    if (!pendingRequest) return

    const ch = (globalThis as any).chrome
    if (!ch?.storage?.local) return

    const requestId = pendingRequest.requestId
    const origin = pendingRequest.data?.origin
    const pendingType = pendingRequest.type
    const storageKey = `cs_resp_${requestId}`

    isHandlingApproval.current = false

    try {
      let responsePayload: any

      if (approved && pendingType === 'connect' && origin) {
        await new Promise<void>((res, rej) => {
          ch.storage.local.get(['cyberswitch_connected_sites'], (data: any) => {
            if (ch.runtime.lastError) { rej(new Error(ch.runtime.lastError.message)); return }
            const sites: string[] = data['cyberswitch_connected_sites'] || []
            const updated = sites.includes(origin) ? sites : [...sites, origin]
            ch.storage.local.set({ cyberswitch_connected_sites: updated }, () => {
              if (ch.runtime.lastError) { rej(new Error(ch.runtime.lastError.message)); return }
              setConnectedSites(updated)
              res()
            })
          })
        })
        const addresses = wallet?.address ? [wallet.address] : []
        responsePayload = { result: addresses, error: null, ts: Date.now() }
      } else if (approved) {
        responsePayload = { result: result ?? null, error: null, ts: Date.now() }
      } else {
        responsePayload = { result: null, error: { code: 4001, message: 'User rejected the request' }, ts: Date.now() }
      }

      await new Promise<void>((res, rej) => {
        ch.storage.local.set({ [storageKey]: responsePayload }, () => {
          if (ch.runtime.lastError) { rej(new Error(ch.runtime.lastError.message)); return }
          res()
        })
      })

      await new Promise(res => setTimeout(res, 300))
      await new Promise<void>(res => ch.storage.local.remove(['cs_pending'], res))

      try {
        ch.runtime.sendMessage({
          type: 'CYBERSWITCH_APPROVAL_RESPONSE',
          payload: { requestId, approved, origin, result, pendingType }
        })
      } catch {}

    } catch (e) {
      try {
        await new Promise<void>(res => {
          ch.storage.local.set({
            [storageKey]: { result: null, error: { code: -32603, message: 'Internal error' }, ts: Date.now() }
          }, res)
        })
      } catch {}
    }

    setPendingRequest(null)
    setSignToConnectPending(null)
    setSignLoading(false)
    setScreen('dashboard')
  }

  const generateQR = async (address: string) => {
    try {
      const url = await QRCode.toDataURL(address, {
        width: 200, margin: 2,
        color: { dark: '#ffffff', light: '#0d1b6e' }
      })
      setQrDataUrl(url)
    } catch {}
  }

  const formatDate = (ts: string) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const openExplorer = (hash: string) =>
    window.open(`https://testnet.arcscan.app/tx/${hash}`, '_blank')

  const loadConnectedSites = () => {
    const ch = (globalThis as any).chrome
    if (ch?.storage?.local) {
      ch.storage.local.get(['cyberswitch_connected_sites'], (res: any) => {
        setConnectedSites(res['cyberswitch_connected_sites'] || [])
      })
    }
  }

  const disconnectSite = (origin: string) => {
    const ch = (globalThis as any).chrome
    if (ch?.storage?.local) {
      ch.storage.local.get(['cyberswitch_connected_sites'], (res: any) => {
        const sites = (res['cyberswitch_connected_sites'] || []).filter((s: string) => s !== origin)
        ch.storage.local.set({ cyberswitch_connected_sites: sites }, () => {
          setConnectedSites(sites)
          if (origin === currentTabOrigin) setConnectedToCurrentSite(false)
        })
      })
    }
  }

  // ── Lock screen ──────────────────────────────
  // KEY FIX: After verifyPassword() sets _cachedKey, THEN load wallets.
  if (screen === 'locked') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={{ ...s.logoRow, justifyContent: 'center', marginTop: 40 }}>
          <CyberSwitchLogo size={64} />
        </div>
        <h1 style={{ ...s.heroTitle, textAlign: 'center' }}>CyberSwitch</h1>
        <p style={{ ...s.bodyText, textAlign: 'center' }}>Enter your password to unlock</p>
        <div style={s.inputGroup}>
          <label style={s.label}>Password</label>
          <PasswordInput
            value={passwordInput}
            onChange={setPasswordInput}
            placeholder="Enter password"
            onKeyDown={async e => {
              if (e.key !== 'Enter') return
              const ok = await verifyPassword(passwordInput)
              if (ok) {
                setPasswordInput(''); setError('')
                await loadAndNavigate(activeIndex)
              } else setError('Incorrect password')
            }}
          />
        </div>
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btnPrimary} onClick={async () => {
          const ok = await verifyPassword(passwordInput)
          if (ok) {
            setPasswordInput(''); setError('')
            await loadAndNavigate(activeIndex)
          } else setError('Incorrect password')
        }}>Unlock</button>
      </div>
    </div>
  )

  // ── Set password ──────────────────────────────
  if (screen === 'setPassword') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={s.pageTitle}>Set Password</h2>
        </div>
        <p style={s.bodyText}>Protect your wallet with a password. Required every time you open CyberSwitch.</p>
        <div style={s.inputGroup}>
          <label style={s.label}>New Password</label>
          <PasswordInput value={passwordInput} onChange={setPasswordInput} placeholder="Min 6 characters" />
        </div>
        <div style={s.inputGroup}>
          <label style={s.label}>Confirm Password</label>
          <PasswordInput value={passwordConfirm} onChange={setPasswordConfirm} placeholder="Repeat password" />
        </div>
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btnPrimary} onClick={async () => {
          if (passwordInput.length < 6) { setError('At least 6 characters'); return }
          if (passwordInput !== passwordConfirm) { setError('Passwords do not match'); return }
          await setPassword(passwordInput)
          setPasswordInput(''); setPasswordConfirm(''); setError('')
          showSuccess('✓ Password set!'); setScreen('settings')
        }}>Set Password</button>
        <button style={s.btnGhost} onClick={() => { setPasswordInput(''); setPasswordConfirm(''); setScreen('settings') }}>← Cancel</button>
      </div>
    </div>
  )

  // ── Change password ───────────────────────────
  if (screen === 'changePassword') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={s.pageTitle}>Change Password</h2>
        </div>
        <div style={s.inputGroup}>
          <label style={s.label}>Current Password</label>
          <PasswordInput value={passwordInput} onChange={setPasswordInput} placeholder="Current password" />
        </div>
        <div style={s.inputGroup}>
          <label style={s.label}>New Password</label>
          <PasswordInput value={passwordConfirm} onChange={setPasswordConfirm} placeholder="Min 6 characters" />
        </div>
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btnPrimary} onClick={async () => {
          const ok = await verifyPassword(passwordInput)
          if (!ok) { setError('Current password is incorrect'); return }
          if (passwordConfirm.length < 6) { setError('New password too short'); return }
          await setPassword(passwordConfirm)
          setPasswordInput(''); setPasswordConfirm(''); setError('')
          showSuccess('✓ Password changed!'); setScreen('settings')
        }}>Change Password</button>
        <button style={s.btnGhost} onClick={() => setScreen('settings')}>← Cancel</button>
      </div>
    </div>
  )

  // ── Welcome ───────────────────────────────────
  if (screen === 'welcome') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.logoRow}>
          <CyberSwitchLogo size={56} />
          <div>
            <p style={s.brandName}>CyberSwitch</p>
            <p style={s.brandTagline}>Secure, Scalable and Innovative</p>
          </div>
        </div>
        <div style={s.divider} />
        <h1 style={s.heroTitle}>Your Web3 Wallet</h1>
        <p style={s.heroSub}>Send, receive and bridge USDC seamlessly on Arc network</p>
        <button style={s.btnPrimary} onClick={async () => {
          const w = createWallet('Wallet 1')
          setNewMnemonic(w.mnemonic)
          const { wallets: ws, index } = await addWallet(w)
          setWallets(ws); setActiveIndex(index)
          setScreen('showPhrase')
        }}>Create New Wallet</button>
        <button style={s.btnSecondary} onClick={() => { setError(''); setImportPhrase(''); setScreen('import') }}>
          Import Existing Wallet
        </button>
      </div>
    </div>
  )

  // ── Show phrase ───────────────────────────────
  if (screen === 'showPhrase' || screen === 'addShowPhrase') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.successBadge}>✓ Wallet Created</div>
        <h2 style={s.sectionTitle}>Save Your Recovery Phrase</h2>
        <p style={s.bodyText}>Write this down. It's the only way to recover your wallet.</p>
        <div style={s.mnemonicBox}>{newMnemonic}</div>
        <button style={s.btnOutline} onClick={() => handleCopy(newMnemonic)}>{copied ? '✓ Copied!' : '⎘  Copy Phrase'}</button>
        <button style={s.btnPrimary} onClick={() => {
          const w = wallets[activeIndex]
          if (w) refreshDashboard(w.address)
          else setScreen('dashboard')
        }}>I've saved it safely →</button>
      </div>
    </div>
  )

  // ── Import ────────────────────────────────────
  if (screen === 'import' || screen === 'addImport') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen(screen === 'import' ? 'welcome' : 'addWallet')}>←</button>
          <h2 style={s.pageTitle}>Import Wallet</h2>
        </div>
        <p style={s.bodyText}>Enter your 12 or 24-word recovery phrase</p>
        <textarea style={s.textarea} placeholder="word1 word2 word3 ..."
          value={importPhrase} onChange={e => setImportPhrase(e.target.value)} />
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btnPrimary} onClick={async () => {
          try {
            const name = `Wallet ${wallets.length + 1}`
            const w = importWallet(importPhrase.trim(), name)
            const { wallets: ws, index } = await addWallet(w)
            setWallets(ws); setActiveIndex(index)
            refreshDashboard(w.address)
            showSuccess(`✓ ${name} imported!`)
          } catch { setError('Invalid recovery phrase.') }
        }}>Import Wallet</button>
      </div>
    </div>
  )

  // ── Add wallet ────────────────────────────────
  if (screen === 'addWallet') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={s.pageTitle}>Add Wallet</h2>
        </div>
        <p style={s.bodyText}>Add another wallet to your CyberSwitch.</p>
        <button style={s.btnPrimary} onClick={async () => {
          const name = `Wallet ${wallets.length + 1}`
          const w = createWallet(name)
          setNewMnemonic(w.mnemonic)
          const { wallets: ws, index } = await addWallet(w)
          setWallets(ws); setActiveIndex(index)
          setScreen('addShowPhrase')
        }}>Create New Wallet</button>
        <button style={s.btnSecondary} onClick={() => { setError(''); setImportPhrase(''); setScreen('addImport') }}>
          Import Existing Wallet
        </button>
      </div>
    </div>
  )

  // ── Wallet switcher ───────────────────────────
  if (screen === 'walletSwitcher') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('dashboard')}>←</button>
          <h2 style={s.pageTitle}>Switch Wallet</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {wallets.map((w, i) => (
            <div key={i}
              style={{ ...s.settingsItem, borderColor: i === activeIndex ? 'rgba(26,58,255,0.5)' : undefined, background: i === activeIndex ? 'rgba(26,58,255,0.12)' : undefined }}
              onClick={() => { setActiveIndex(i); saveActiveIndex(i); setBalance(balances[w.address] || '0.00'); refreshDashboard(w.address) }}>
              <div>
                <p style={s.settingsTitle}>{w.name} {i === activeIndex ? '✓' : ''}</p>
                <p style={s.settingsSub}>{w.address.slice(0, 10)}...{w.address.slice(-6)}</p>
                <p style={{ ...s.settingsSub, color: '#4d8aff', marginTop: 2 }}>{balances[w.address] || '—'} USDC</p>
              </div>
              {i === activeIndex && <span style={{ color: '#10b981', fontSize: 18 }}>●</span>}
            </div>
          ))}
        </div>
        <button style={s.btnSecondary} onClick={() => setScreen('addWallet')}>+ Add Wallet</button>
      </div>
    </div>
  )

  // ── Receive ───────────────────────────────────
  if (screen === 'receive') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('dashboard')}>←</button>
          <h2 style={s.pageTitle}>Receive USDC</h2>
        </div>
        <p style={s.bodyText}>Share your Arc wallet address to receive USDC</p>
        <div style={s.qrPlaceholder}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt="QR Code" style={{ width: 180, height: 180, borderRadius: 8 }} />
            : <div style={s.qrInner}><CyberSwitchLogo size={48} /><p style={{ ...s.muted, fontSize: 11, marginTop: 8 }}>Tap to generate QR</p></div>
          }
        </div>
        {!qrDataUrl && <button style={s.btnSecondary} onClick={() => wallet && generateQR(wallet.address)}>Generate QR Code</button>}
        <div style={s.addressBox}>{wallet?.address}</div>
        <button style={s.btnPrimary} onClick={() => handleCopy(wallet?.address || '')}>{copied ? '✓ Copied!' : '⎘  Copy Address'}</button>
      </div>
    </div>
  )

  // ── Send ──────────────────────────────────────
  if (screen === 'send') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => { setScreen('dashboard'); setConfirming(false); setError('') }}>←</button>
          <h2 style={s.pageTitle}>Send USDC</h2>
        </div>
        {!confirming ? (
          <>
            <div style={s.inputGroup}>
              <label style={s.label}>Recipient Address</label>
              <input style={s.input} placeholder="0x..." value={sendAddress} onChange={e => setSendAddress(e.target.value)} />
            </div>
            <div style={s.inputGroup}>
              <label style={s.label}>Amount</label>
              <div style={s.amountRow}>
                <input style={{ ...s.input, flex: 1 }} placeholder="0.00" type="number" value={sendAmount} onChange={e => setSendAmount(e.target.value)} />
                <span style={s.tokenBadge}>USDC</span>
              </div>
            </div>
            <div style={s.networkRow}><span style={s.dot} /><span style={s.networkLabel}>Arc Testnet · Balance: {balance} USDC</span></div>
            {error && <p style={s.error}>{error}</p>}
            <button style={s.btnPrimary} onClick={() => {
              if (!sendAddress || !sendAmount) { setError('Please fill in all fields'); return }
              if (parseFloat(sendAmount) > parseFloat(balance)) { setError('Insufficient balance'); return }
              setError(''); setConfirming(true)
            }}>Review Transaction</button>
            <button style={s.btnGhost} onClick={() => setScreen('dashboard')}>← Back</button>
          </>
        ) : (
          <>
            <div style={s.mnemonicBox}>
              <p style={{ margin: '0 0 6px', color: '#7b8cde', fontSize: 12 }}>SENDING</p>
              <p style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 700 }}>{sendAmount} USDC</p>
              <p style={{ margin: '0 0 6px', color: '#7b8cde', fontSize: 12 }}>TO</p>
              <p style={{ margin: 0, fontSize: 11, color: '#93b4ff', wordBreak: 'break-all' }}>{sendAddress}</p>
            </div>
            {error && <p style={s.error}>{error}</p>}
            <button style={s.btnPrimary} onClick={async () => {
              const amt = sendAmount
              const result = await sendUSDC(wallet!.privateKey, sendAddress, sendAmount)
              if (result.success) {
                setSendAddress(''); setSendAmount(''); setConfirming(false)
                refreshDashboard(wallet!.address)
                showSuccess(`✓ ${amt} USDC sent!`)
                const addr = wallet!.address
                setTimeout(() => fetchWalletData(addr), 5000)
                setTimeout(() => fetchWalletData(addr), 12000)
              } else { setError(result.error || 'Transaction failed'); setConfirming(false) }
            }}>Confirm & Send</button>
            <button style={s.btnGhost} onClick={() => setConfirming(false)}>← Cancel</button>
          </>
        )}
      </div>
    </div>
  )

  // ── Transaction Detail ────────────────────────
  if (screen === 'txDetail' && selectedTx) {
    const isSent = selectedTx.from?.hash?.toLowerCase() === wallet?.address.toLowerCase()
    const amount = selectedTx.value ? (parseFloat(selectedTx.value) / 1e18).toFixed(6) : '0.000000'
    const hash = selectedTx.hash || ''
    const status = selectedTx.status === 'ok' ? 'Success' : 'Unknown'
    return (
      <div style={s.page}>
        <WatermarkBg />
        <div style={s.content}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setScreen('dashboard')}>←</button>
            <h2 style={s.pageTitle}>Transaction</h2>
          </div>
          <div style={{ alignSelf: 'center' }}>
            <div style={{ ...s.successBadge, background: status === 'Success' ? 'rgba(16,185,129,0.15)' : 'rgba(248,113,113,0.15)', color: status === 'Success' ? '#10b981' : '#f87171', border: `1px solid ${status === 'Success' ? 'rgba(16,185,129,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
              {status === 'Success' ? '✓' : '✕'} {status}
            </div>
          </div>
          <div style={{ ...s.balanceCard, padding: '20px' }}>
            <p style={s.balanceLabel}>{isSent ? 'SENT' : 'RECEIVED'}</p>
            <p style={{ ...s.balanceAmount, fontSize: 32, color: isSent ? '#f87171' : '#10b981' }}>{isSent ? '-' : '+'}{amount}</p>
            <p style={s.balanceCurrency}>USDC</p>
          </div>
          <div style={s.txDetailCard}>
            {[
              ['Type', isSent ? '↑ Sent' : '↓ Received', isSent ? '#f87171' : '#10b981'],
              ['From', `${selectedTx.from?.hash?.slice(0, 10)}...${selectedTx.from?.hash?.slice(-6)}`, '#fff'],
              ['To', `${selectedTx.to?.hash?.slice(0, 10)}...${selectedTx.to?.hash?.slice(-6)}`, '#fff'],
              ['Date', formatDate(selectedTx.timestamp), '#fff'],
              ['Gas Used', selectedTx.gas_used || '—', '#fff'],
              ['Block', `#${selectedTx.block || '—'}`, '#fff'],
            ].map(([label, value, color], i) => (
              <div key={i}>
                {i > 0 && <div style={s.txDetailDivider} />}
                <div style={s.txDetailRow}>
                  <span style={s.txDetailLabel}>{label}</span>
                  <span style={{ ...s.txDetailValue, color: color as string }}>{value}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={s.txHashBox}>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#7b8cde', letterSpacing: 0.4 }}>TRANSACTION HASH</p>
            <p style={{ margin: 0, fontSize: 11, color: '#93b4ff', wordBreak: 'break-all', lineHeight: 1.6 }}>{hash}</p>
          </div>
          <button style={s.btnPrimary} onClick={() => openExplorer(hash)}>View on Arc Explorer ↗</button>
          <button style={s.btnOutline} onClick={() => handleCopy(hash)}>{copied ? '✓ Hash Copied!' : '⎘  Copy Hash'}</button>
        </div>
      </div>
    )
  }

  // ── Settings ──────────────────────────────────
  if (screen === 'settings') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('dashboard')}>←</button>
          <h2 style={s.pageTitle}>Settings</h2>
        </div>
        {[
          { title: 'Add Wallet', sub: 'Create or import another wallet', action: () => setScreen('addWallet') },
          { title: 'Reveal Recovery Phrase', sub: `View seed phrase for ${wallet?.name}`, action: () => { setPhraseRevealed(false); setScreen('revealPhrase') } },
          { title: 'Connected Sites', sub: 'Manage dApp connections', action: () => { loadConnectedSites(); setScreen('connectedSites') } },
          { title: 'Password', sub: 'Set or change wallet password', action: async () => { const h = await hasPassword(); setPasswordInput(''); setPasswordConfirm(''); setError(''); setScreen(h ? 'changePassword' : 'setPassword') } },
        ].map((item, i) => (
          <div key={i} style={s.settingsItem} onClick={item.action}>
            <div><p style={s.settingsTitle}>{item.title}</p><p style={s.settingsSub}>{item.sub}</p></div>
            <span style={s.settingsArrow}>→</span>
          </div>
        ))}
        <div style={s.settingsItem} onClick={async () => {
          const h = await hasPassword()
          if (h) { await removePassword(); showSuccess('✓ Password removed') }
          else showSuccess('No password set')
        }}>
          <div><p style={s.settingsTitle}>Remove Password</p><p style={s.settingsSub}>Disable password protection</p></div>
          <span style={s.settingsArrow}>→</span>
        </div>
        <div style={{ ...s.settingsItem, borderColor: 'rgba(248,113,113,0.2)' }} onClick={() => setScreen('confirmDelete')}>
          <div><p style={{ ...s.settingsTitle, color: '#f87171' }}>Delete {wallet?.name}</p><p style={s.settingsSub}>Remove this wallet</p></div>
          <span style={{ ...s.settingsArrow, color: '#f87171' }}>→</span>
        </div>
      </div>
    </div>
  )

  // ── Connected sites ───────────────────────────
  if (screen === 'connectedSites') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={s.pageTitle}>Connected Sites</h2>
        </div>
        {connectedSites.length === 0
          ? <div style={s.txEmpty}><p style={s.muted}>No sites connected yet</p></div>
          : connectedSites.map((site, i) => (
            <div key={i} style={{ ...s.settingsItem, padding: '12px 16px' }}>
              <div>
                <p style={{ ...s.settingsTitle, fontSize: 12, margin: 0 }}>{site}</p>
                {site === currentTabOrigin && (
                  <p style={{ margin: '2px 0 0', fontSize: 10, color: '#10b981' }}>● Current tab</p>
                )}
              </div>
              <button style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                onClick={() => disconnectSite(site)}>Disconnect</button>
            </div>
          ))
        }
      </div>
    </div>
  )

  // ── Reveal phrase ─────────────────────────────
  if (screen === 'revealPhrase') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={s.pageTitle}>Recovery Phrase</h2>
        </div>
        {!phraseRevealed ? (
          <>
            <div style={{ ...s.mnemonicBox, borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.05)' }}>
              <p style={{ margin: '0 0 8px', fontSize: 16 }}>⚠️ Security Warning</p>
              <p style={{ margin: 0, fontSize: 12, color: '#fbbf24', lineHeight: 1.7 }}>Never share your recovery phrase with anyone — not even CyberSwitch support.</p>
            </div>
            <button style={s.btnPrimary} onClick={() => setPhraseRevealed(true)}>I Understand — Reveal Phrase</button>
            <button style={s.btnGhost} onClick={() => setScreen('settings')}>← Back</button>
          </>
        ) : (
          <>
            <p style={s.bodyText}>Keep this safe. Never share it.</p>
            <div style={s.mnemonicBox}>{wallet?.mnemonic}</div>
            <button style={s.btnOutline} onClick={() => handleCopy(wallet?.mnemonic || '')}>{copied ? '✓ Copied!' : '⎘  Copy Phrase'}</button>
            <button style={s.btnGhost} onClick={() => { setPhraseRevealed(false); setScreen('settings') }}>← Done</button>
          </>
        )}
      </div>
    </div>
  )

  // ── Confirm delete ────────────────────────────
  if (screen === 'confirmDelete') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={{ ...s.pageTitle, color: '#f87171' }}>Delete {wallet?.name}</h2>
        </div>
        <div style={{ ...s.mnemonicBox, borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
          <p style={{ margin: '0 0 8px', fontSize: 16 }}>⚠️ Cannot be undone</p>
          <p style={{ margin: 0, fontSize: 12, color: '#f87171', lineHeight: 1.7 }}>
            {wallets.length === 1 ? 'All data will be removed.' : `${wallet?.name} will be removed.`}
            {' '}Save your recovery phrase first.
          </p>
        </div>
        <button style={{ ...s.btnPrimary, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 20px rgba(220,38,38,0.4)' }}
          onClick={async () => {
            const { wallets: ws, newIndex } = await deleteWalletAtIndex(activeIndex)
            if (ws.length === 0) { deleteWallet(); setWallets([]); setScreen('welcome') }
            else { setWallets(ws); setActiveIndex(newIndex); refreshDashboard(ws[newIndex].address); showSuccess('✓ Wallet deleted') }
          }}>Yes, Delete</button>
        <button style={s.btnGhost} onClick={() => setScreen('settings')}>← Cancel</button>
      </div>
    </div>
  )

  // ── Approve Connect ───────────────────────────
  if (screen === 'approveConnect' && pendingRequest) return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={{ ...s.successBadge, background: 'rgba(26,58,255,0.15)', color: '#4d8aff', border: '1px solid rgba(26,58,255,0.3)' }}>
          🔗 Connection Request
        </div>
        <h2 style={s.sectionTitle}>Connect to Site</h2>
        <div style={s.txDetailCard}>
          {[
            ['Site', pendingRequest.data?.origin, '#4d8aff'],
            ['Wallet', wallet?.name || '', '#fff'],
            ['Address', `${wallet?.address.slice(0, 10)}...${wallet?.address.slice(-6)}`, '#fff'],
            ['Network', 'Arc Testnet', '#10b981'],
          ].map(([label, value, color], i) => (
            <div key={i}>
              {i > 0 && <div style={s.txDetailDivider} />}
              <div style={s.txDetailRow}>
                <span style={s.txDetailLabel}>{label}</span>
                <span style={{ ...s.txDetailValue, color: color as string, wordBreak: 'break-all' }}>{value}</span>
              </div>
            </div>
          ))}
        </div>
        <p style={s.bodyText}>This site is requesting access to your wallet address. It cannot move funds without explicit approval.</p>
        <button style={s.btnPrimary} onClick={() => { setSignToConnectPending(pendingRequest); setScreen('signToConnect') }}>Review & Sign →</button>
        <button style={{ ...s.btnPrimary, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 20px rgba(220,38,38,0.3)' }}
          onClick={() => sendApprovalResponse(false)}>Reject</button>
      </div>
    </div>
  )

  // ── Sign to Connect (2FA) ─────────────────────
  if (screen === 'signToConnect') {
    const currentPending = signToConnectPending || pendingRequest
    const origin = currentPending?.data?.origin || ''
    const signMessage = `CyberSwitch Wallet Authentication\n\nSite: ${origin}\nWallet: ${wallet?.address}\nTimestamp: ${new Date().toISOString()}\n\nBy signing this message you authorize CyberSwitch to connect your wallet to this site. This does not grant permission to move funds.`
    return (
      <div style={s.page}>
        <WatermarkBg />
        <div style={s.content}>
          <div style={{ ...s.successBadge, background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
            ✍️ Sign to Confirm
          </div>
          <h2 style={s.sectionTitle}>Authorize Connection</h2>
          <p style={s.bodyText}>Sign this message to prove wallet ownership. No funds will move.</p>
          <div style={s.txDetailCard}>
            {[
              ['Site', origin, '#4d8aff'],
              ['Wallet', wallet?.name || '', '#fff'],
              ['Network', 'Arc Testnet', '#10b981'],
            ].map(([label, value, color], i) => (
              <div key={i}>
                {i > 0 && <div style={s.txDetailDivider} />}
                <div style={s.txDetailRow}>
                  <span style={s.txDetailLabel}>{label}</span>
                  <span style={{ ...s.txDetailValue, color: color as string, wordBreak: 'break-all' }}>{value}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...s.mnemonicBox, maxHeight: 100, overflowY: 'auto' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#7b8cde' }}>MESSAGE TO SIGN</p>
            <p style={{ margin: 0, fontSize: 11, color: '#93b4ff', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{signMessage}</p>
          </div>
          {error && <p style={s.error}>{error}</p>}
          <button style={{ ...s.btnPrimary, opacity: signLoading ? 0.7 : 1 }}
            onClick={async () => {
              if (!wallet || signLoading) return
              setSignLoading(true); setError('')
              try {
                const { ethers } = await import('ethers')
                const signer = new ethers.Wallet(wallet.privateKey)
                await signer.signMessage(signMessage)
                await sendApprovalResponse(true)
                showSuccess('✓ Connected successfully!')
              } catch (e: any) {
                setError(e?.message || 'Signing failed')
                setSignLoading(false)
              }
            }}>
            {signLoading ? 'Signing...' : '✍️ Sign & Connect'}
          </button>
          <button style={{ ...s.btnPrimary, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 20px rgba(220,38,38,0.3)' }}
            onClick={() => { sendApprovalResponse(false); setSignToConnectPending(null) }}>Reject</button>
          <button style={s.btnGhost} onClick={() => { setSignToConnectPending(null); setScreen('approveConnect') }}>← Back</button>
        </div>
      </div>
    )
  }

  // ── Approve Transaction ───────────────────────
  if (screen === 'approveTx' && pendingRequest) {
    const tx = pendingRequest.data?.txParams || {}
    const value = tx.value ? (parseInt(tx.value, 16) / 1e18).toFixed(6) : '0.000000'
    return (
      <div style={s.page}>
        <WatermarkBg />
        <div style={s.content}>
          <div style={{ ...s.successBadge, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
            ⚡ Transaction Request
          </div>
          <h2 style={s.sectionTitle}>Confirm Transaction</h2>
          <div style={{ ...s.balanceCard, padding: '20px' }}>
            <p style={s.balanceLabel}>SENDING</p>
            <p style={{ ...s.balanceAmount, fontSize: 28 }}>{value}</p>
            <p style={s.balanceCurrency}>USDC</p>
          </div>
          <div style={s.txDetailCard}>
            {[
              ['From', `${wallet?.address.slice(0, 10)}...${wallet?.address.slice(-6)}`, '#fff'],
              ['To', `${tx.to?.slice(0, 10)}...${tx.to?.slice(-6)}`, '#fff'],
              ['Site', pendingRequest.data?.origin, '#4d8aff'],
              ['Network', 'Arc Testnet', '#10b981'],
            ].map(([label, val, color], i) => (
              <div key={i}>
                {i > 0 && <div style={s.txDetailDivider} />}
                <div style={s.txDetailRow}>
                  <span style={s.txDetailLabel}>{label}</span>
                  <span style={{ ...s.txDetailValue, color: color as string, wordBreak: 'break-all' }}>{val}</span>
                </div>
              </div>
            ))}
          </div>
          <button style={s.btnPrimary} onClick={async () => {
            if (!wallet) return
            const result = await sendUSDC(wallet.privateKey, tx.to, value)
            if (result.success) { await sendApprovalResponse(true, result.hash); showSuccess('✓ Transaction sent!') }
            else { await sendApprovalResponse(false); showSuccess(`✗ ${result.error}`) }
          }}>Confirm & Sign</button>
          <button style={{ ...s.btnPrimary, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 20px rgba(220,38,38,0.3)' }}
            onClick={() => sendApprovalResponse(false)}>Reject</button>
        </div>
      </div>
    )
  }

  // ── Approve Sign ──────────────────────────────
  if (screen === 'approveSign' && pendingRequest) {
    const message = pendingRequest.data?.message || ''
    const decodedMsg = (() => {
      try {
        if (message.startsWith('0x')) {
          const bytes = message.slice(2).match(/../g) || []
          return bytes.map((h: string) => String.fromCharCode(parseInt(h, 16))).join('') || message
        }
        return message
      } catch { return message }
    })()
    return (
      <div style={s.page}>
        <WatermarkBg />
        <div style={s.content}>
          <div style={{ ...s.successBadge, background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
            ✍️ Signature Request
          </div>
          <h2 style={s.sectionTitle}>Sign Message</h2>
          <div style={s.txDetailCard}>
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>Site</span>
              <span style={{ ...s.txDetailValue, color: '#4d8aff', wordBreak: 'break-all' }}>{pendingRequest.data?.origin}</span>
            </div>
            <div style={s.txDetailDivider} />
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>Wallet</span>
              <span style={s.txDetailValue}>{wallet?.name}</span>
            </div>
          </div>
          <div style={{ ...s.mnemonicBox, maxHeight: 120, overflowY: 'auto' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#7b8cde' }}>MESSAGE</p>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, wordBreak: 'break-all' }}>{decodedMsg}</p>
          </div>
          <p style={{ ...s.bodyText, fontSize: 11 }}>⚠️ Only sign from trusted sites. Proves identity, no funds move.</p>
          {signatureResult ? (
            <>
              <div style={s.addressBox}>{signatureResult}</div>
              <button style={s.btnOutline} onClick={() => handleCopy(signatureResult)}>{copied ? '✓ Copied!' : '⎘  Copy Signature'}</button>
              <button style={s.btnGhost} onClick={() => { setSignatureResult(''); setScreen('dashboard') }}>← Done</button>
            </>
          ) : (
            <>
              <button style={s.btnPrimary} onClick={async () => {
                if (!wallet) return
                try {
                  const { ethers } = await import('ethers')
                  const signer = new ethers.Wallet(wallet.privateKey)
                  const sig = await signer.signMessage(message.startsWith('0x') ? ethers.getBytes(message) : message)
                  setSignatureResult(sig)
                  await sendApprovalResponse(true, sig)
                  showSuccess('✓ Message signed!')
                } catch (e: any) {
                  await sendApprovalResponse(false)
                  showSuccess(`✗ ${e.message}`)
                }
              }}>Sign Message</button>
              <button style={{ ...s.btnPrimary, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 20px rgba(220,38,38,0.3)' }}
                onClick={() => sendApprovalResponse(false)}>Reject</button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Dashboard ─────────────────────────────────
  return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        {successMsg && <div style={s.successToast}>{successMsg}</div>}
        <div style={s.dashHeader}>
          <div style={{ ...s.logoRow, cursor: 'pointer' }} onClick={() => setScreen('walletSwitcher')}>
            <CyberSwitchLogo size={32} />
            <div>
              <p style={s.brandName}>CyberSwitch</p>
              <p style={{ ...s.settingsSub, marginTop: 1 }}>{wallet?.name} ▾</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={s.networkPill}><span style={s.dot} />Arc Testnet</div>
            <button style={s.settingsBtn} onClick={() => setScreen('settings')}>⚙</button>
          </div>
        </div>

        <div style={s.connectionBar} onClick={() => { loadConnectedSites(); setScreen('connectedSites') }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connectedToCurrentSite ? '#10b981' : '#f87171',
              boxShadow: connectedToCurrentSite ? '0 0 6px rgba(16,185,129,0.6)' : '0 0 6px rgba(248,113,113,0.6)',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: connectedToCurrentSite ? '#10b981' : '#f87171', fontWeight: 600 }}>
              {connectedToCurrentSite ? 'Connected to this site' : 'Not connected'}
            </span>
          </div>
          <span style={{ fontSize: 10, color: '#4a5580' }}>Manage →</span>
        </div>

        <div style={s.addressPill}>{wallet?.address.slice(0, 8)}...{wallet?.address.slice(-6)}</div>
        <div style={s.balanceCard}>
          <p style={s.balanceLabel}>Total Balance</p>
          <p style={s.balanceAmount}>{balance}</p>
          <p style={s.balanceCurrency}>USDC</p>
          <div style={s.balanceDivider} />
          <p style={s.balanceSub}>≈ ${balance} USD</p>
        </div>
        <div style={s.actionRow}>
          <button style={s.actionBtn} onClick={() => setScreen('send')}>
            <span style={s.actionIcon}>↑</span><span>Send</span>
          </button>
          <button style={s.actionBtn} onClick={() => { setQrDataUrl(''); setScreen('receive') }}>
            <span style={s.actionIcon}>↓</span><span>Receive</span>
          </button>
          <button style={s.actionBtn} onClick={() => wallet && refreshDashboard(wallet.address)}>
            <span style={s.actionIcon}>↺</span><span>Refresh</span>
          </button>
        </div>
        <div style={s.txSection}>
          <p style={s.txTitle}>Recent Transactions</p>
          {transactions.length === 0
            ? <div style={s.txEmpty}><p style={s.muted}>No transactions yet</p></div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transactions.slice(0, 5).map((tx: any, i: number) => {
                const isSent = tx.from?.hash?.toLowerCase() === wallet?.address.toLowerCase()
                const amount = tx.value ? (parseFloat(tx.value) / 1e18).toFixed(2) : '0.00'
                return (
                  <div key={i} style={{ ...s.txItem, cursor: 'pointer' }}
                    onClick={() => { setSelectedTx(tx); setScreen('txDetail') }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18, color: isSent ? '#f87171' : '#10b981' }}>{isSent ? '↑' : '↓'}</span>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{isSent ? 'Sent' : 'Received'}</p>
                        <p style={{ margin: 0, fontSize: 11, color: '#7b8cde' }}>{isSent ? tx.to?.hash?.slice(0, 8) : tx.from?.hash?.slice(0, 8)}...</p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: isSent ? '#f87171' : '#10b981' }}>{isSent ? '-' : '+'}{amount} USDC</p>
                      <p style={{ margin: 0, fontSize: 10, color: '#4a5580' }}>tap for details</p>
                    </div>
                  </div>
                )
              })}
            </div>
          }
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { width: 380, height: 600, background: 'linear-gradient(160deg, #04041e 0%, #060d3a 60%, #04041e 100%)', color: '#fff', fontFamily: "'Inter', sans-serif", position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  content: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: 20, flex: 1, overflowY: 'auto', maxHeight: '600px' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 },
  logoRow: { display: 'flex', alignItems: 'center', gap: 12 },
  brandName: { fontSize: 17, fontWeight: 700, margin: 0, letterSpacing: 0.3 },
  brandTagline: { fontSize: 10, color: '#7b8cde', margin: 0, letterSpacing: 0.5 },
  divider: { height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' },
  heroTitle: { fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: -0.5 },
  heroSub: { fontSize: 13, color: '#7b8cde', margin: 0, lineHeight: 1.6 },
  sectionTitle: { fontSize: 20, fontWeight: 700, margin: 0 },
  bodyText: { fontSize: 13, color: '#7b8cde', margin: 0, lineHeight: 1.6 },
  muted: { color: '#4a5580', margin: 0, fontSize: 13 },
  btnPrimary: { background: 'linear-gradient(135deg, #1a3aff, #0066ff)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', letterSpacing: 0.3, boxShadow: '0 4px 20px rgba(26,58,255,0.4)' },
  btnSecondary: { background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '14px 0', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  btnOutline: { background: 'transparent', color: '#4d8aff', border: '1px solid #1a3aff', borderRadius: 12, padding: '12px 0', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnGhost: { background: 'transparent', color: '#4a5580', border: 'none', padding: '8px 0', cursor: 'pointer', fontSize: 13 },
  successBadge: { background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start' },
  successToast: { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 12, padding: '12px 16px', color: '#10b981', fontSize: 13, fontWeight: 600, textAlign: 'center' },
  mnemonicBox: { background: 'rgba(26,58,255,0.1)', border: '1px solid rgba(26,58,255,0.3)', borderRadius: 12, padding: 16, fontSize: 13, lineHeight: 2, color: '#93b4ff', wordBreak: 'break-word' },
  addressBox: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, fontSize: 11, color: '#93b4ff', wordBreak: 'break-all', textAlign: 'center' },
  textarea: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', resize: 'none', height: 90, fontFamily: 'inherit' },
  input: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: '#7b8cde', fontWeight: 500, letterSpacing: 0.4 },
  amountRow: { display: 'flex', alignItems: 'center', gap: 10 },
  tokenBadge: { background: 'rgba(26,58,255,0.2)', color: '#4d8aff', border: '1px solid rgba(26,58,255,0.3)', borderRadius: 8, padding: '12px 14px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' },
  pageHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 },
  pageTitle: { fontSize: 18, fontWeight: 700, margin: 0 },
  backBtn: { background: 'rgba(255,255,255,0.07)', border: 'none', color: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qrPlaceholder: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qrInner: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  dashHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  connectionBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer' },
  networkPill: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '5px 12px', fontSize: 11, color: '#7b8cde' },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' },
  networkRow: { display: 'flex', alignItems: 'center', gap: 8 },
  networkLabel: { fontSize: 12, color: '#7b8cde' },
  addressPill: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '6px 16px', fontSize: 12, color: '#7b8cde', alignSelf: 'center' },
  balanceCard: { background: 'linear-gradient(135deg, rgba(26,58,255,0.2), rgba(0,102,255,0.1))', border: '1px solid rgba(26,58,255,0.25)', borderRadius: 16, padding: '20px', textAlign: 'center' },
  balanceLabel: { fontSize: 12, color: '#7b8cde', margin: '0 0 6px', letterSpacing: 0.5, textTransform: 'uppercase' },
  balanceAmount: { fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: -1 },
  balanceCurrency: { fontSize: 14, color: '#4d8aff', margin: '2px 0 12px', fontWeight: 600 },
  balanceDivider: { height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 0 10px' },
  balanceSub: { fontSize: 12, color: '#4a5580', margin: 0 },
  actionRow: { display: 'flex', gap: 10 },
  actionBtn: { flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 0', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  actionIcon: { fontSize: 18, color: '#4d8aff' },
  settingsBtn: { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#7b8cde', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  settingsItem: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' },
  settingsTitle: { fontSize: 14, fontWeight: 600, margin: '0 0 3px' },
  settingsSub: { fontSize: 11, color: '#7b8cde', margin: 0 },
  settingsArrow: { fontSize: 18, color: '#4d8aff' },
  txSection: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8 },
  txTitle: { fontSize: 13, fontWeight: 600, color: '#7b8cde', margin: 0, letterSpacing: 0.4, textTransform: 'uppercase' },
  txEmpty: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 20, textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  txItem: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  txDetailCard: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '4px 16px' },
  txDetailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' },
  txDetailLabel: { fontSize: 12, color: '#7b8cde' },
  txDetailValue: { fontSize: 12, color: '#fff', fontWeight: 500, textAlign: 'right', maxWidth: '60%' },
  txDetailDivider: { height: 1, background: 'rgba(255,255,255,0.05)' },
  txHashBox: { background: 'rgba(26,58,255,0.08)', border: '1px solid rgba(26,58,255,0.2)', borderRadius: 10, padding: '12px 14px' },
  error: { color: '#f87171', fontSize: 12, margin: 0 },
}