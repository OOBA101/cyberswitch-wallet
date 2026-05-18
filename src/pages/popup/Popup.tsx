import { useState, useEffect } from 'react'
import {
  createWallet, importWallet, loadWallets,
  loadActiveIndex, saveActiveIndex, addWallet, deleteWalletAtIndex, deleteWallet
} from '../../utils/wallet.ts'
import type { WalletData } from '../../utils/wallet.ts'
import { getUSDCBalance, sendUSDC, getTransactions } from '../../utils/arc'

type Screen = 'loading' | 'welcome' | 'showPhrase' | 'import' | 'dashboard' |
  'send' | 'receive' | 'settings' | 'addWallet' | 'addShowPhrase' |
  'addImport' | 'confirmDelete' | 'revealPhrase' | 'walletSwitcher' | 'txDetail'

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

  const wallet = wallets[activeIndex] || null

  useEffect(() => {
    Promise.all([loadWallets(), loadActiveIndex()]).then(([ws, idx]) => {
      if (ws.length > 0) {
        setWallets(ws)
        const safeIdx = Math.min(idx, ws.length - 1)
        setActiveIndex(safeIdx)
        setScreen('dashboard')
        refreshDashboard(ws[safeIdx].address)
        ws.forEach(w => getUSDCBalance(w.address).then(b => setBalances(prev => ({ ...prev, [w.address]: b }))))
      } else {
        setScreen('welcome')
      }
    })
  }, [])

  const refreshDashboard = (address: string) => {
    getUSDCBalance(address).then(b => { setBalance(b); setBalances(prev => ({ ...prev, [address]: b })) })
    getTransactions(address).then(setTransactions)
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  const formatDate = (ts: string) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const openExplorer = (hash: string) => {
    window.open(`https://testnet.arcscan.app/tx/${hash}`, '_blank')
  }

  // ── Loading ───────────────────────────────────────────────
  if (screen === 'loading') return (
    <div style={s.page}><WatermarkBg /><div style={s.center}><p style={s.muted}>Loading...</p></div></div>
  )

  // ── Welcome ───────────────────────────────────────────────
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
        <button style={s.btnPrimary} onClick={() => {
          const w = createWallet('Wallet 1')
          setNewMnemonic(w.mnemonic)
          addWallet(w).then(({ wallets: ws, index }) => { setWallets(ws); setActiveIndex(index) })
          setScreen('showPhrase')
        }}>Create New Wallet</button>
        <button style={s.btnSecondary} onClick={() => { setError(''); setImportPhrase(''); setScreen('import') }}>Import Existing Wallet</button>
      </div>
    </div>
  )

  // ── Show seed phrase after creating ──────────────────────
  if (screen === 'showPhrase') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.successBadge}>✓ Wallet Created</div>
        <h2 style={s.sectionTitle}>Save Your Recovery Phrase</h2>
        <p style={s.bodyText}>Write this down and store it safely. It's the only way to recover your wallet.</p>
        <div style={s.mnemonicBox}>{newMnemonic}</div>
        <button style={s.btnOutline} onClick={() => handleCopy(newMnemonic)}>{copied ? '✓ Copied!' : '⎘  Copy Phrase'}</button>
        <button style={s.btnPrimary} onClick={() => {
          const w = wallets[activeIndex]
          if (w) refreshDashboard(w.address)
          setScreen('dashboard')
        }}>I've saved it safely →</button>
      </div>
    </div>
  )

  // ── Import ────────────────────────────────────────────────
  if (screen === 'import' || screen === 'addImport') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen(screen === 'import' ? 'welcome' : 'addWallet')}>←</button>
          <h2 style={s.pageTitle}>Import Wallet</h2>
        </div>
        <p style={s.bodyText}>Enter your 12 or 24-word recovery phrase</p>
        <textarea style={s.textarea} placeholder="word1 word2 word3 ..." value={importPhrase} onChange={(e) => setImportPhrase(e.target.value)} />
        {error && <p style={s.error}>{error}</p>}
        <button style={s.btnPrimary} onClick={() => {
          try {
            const name = `Wallet ${wallets.length + 1}`
            const w = importWallet(importPhrase.trim(), name)
            addWallet(w).then(({ wallets: ws, index }) => {
              setWallets(ws); setActiveIndex(index)
              refreshDashboard(w.address)
              setScreen('dashboard')
              showSuccess(`✓ ${name} imported successfully!`)
            })
          } catch { setError('Invalid recovery phrase. Please check and try again.') }
        }}>Import Wallet</button>
      </div>
    </div>
  )

  // ── Add wallet ────────────────────────────────────────────
  if (screen === 'addWallet') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={s.pageTitle}>Add Wallet</h2>
        </div>
        <p style={s.bodyText}>Add another wallet to your CyberSwitch.</p>
        <button style={s.btnPrimary} onClick={() => {
          const name = `Wallet ${wallets.length + 1}`
          const w = createWallet(name)
          setNewMnemonic(w.mnemonic)
          addWallet(w).then(({ wallets: ws, index }) => { setWallets(ws); setActiveIndex(index) })
          setScreen('addShowPhrase')
        }}>Create New Wallet</button>
        <button style={s.btnSecondary} onClick={() => { setError(''); setImportPhrase(''); setScreen('addImport') }}>Import Existing Wallet</button>
      </div>
    </div>
  )

  if (screen === 'addShowPhrase') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.successBadge}>✓ Wallet Created</div>
        <h2 style={s.sectionTitle}>Save Your Recovery Phrase</h2>
        <p style={s.bodyText}>Write this down and store it safely.</p>
        <div style={s.mnemonicBox}>{newMnemonic}</div>
        <button style={s.btnOutline} onClick={() => handleCopy(newMnemonic)}>{copied ? '✓ Copied!' : '⎘  Copy Phrase'}</button>
        <button style={s.btnPrimary} onClick={() => {
          const w = wallets[activeIndex]
          if (w) refreshDashboard(w.address)
          setScreen('dashboard')
          showSuccess(`✓ ${wallets[activeIndex]?.name} created!`)
        }}>I've saved it safely →</button>
      </div>
    </div>
  )

  // ── Wallet Switcher ───────────────────────────────────────
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
              onClick={() => {
                setActiveIndex(i); saveActiveIndex(i)
                setBalance(balances[w.address] || '0.00')
                refreshDashboard(w.address)
                setScreen('dashboard')
              }}>
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

  // ── Receive ───────────────────────────────────────────────
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
          <div style={s.qrInner}>
            <CyberSwitchLogo size={48} />
            <p style={{ ...s.muted, fontSize: 11, marginTop: 8 }}>QR Coming Soon</p>
          </div>
        </div>
        <div style={s.addressBox}>{wallet?.address}</div>
        <button style={s.btnPrimary} onClick={() => handleCopy(wallet?.address || '')}>{copied ? '✓ Copied!' : '⎘  Copy Address'}</button>
      </div>
    </div>
  )

  // ── Send ──────────────────────────────────────────────────
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
              <input style={s.input} placeholder="0x..." value={sendAddress} onChange={(e) => setSendAddress(e.target.value)} />
            </div>
            <div style={s.inputGroup}>
              <label style={s.label}>Amount</label>
              <div style={s.amountRow}>
                <input style={{ ...s.input, flex: 1 }} placeholder="0.00" type="number" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} />
                <span style={s.tokenBadge}>USDC</span>
              </div>
            </div>
            <div style={s.networkRow}>
              <span style={s.dot} />
              <span style={s.networkLabel}>Arc Testnet · Balance: {balance} USDC</span>
            </div>
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
                setScreen('dashboard')
                refreshDashboard(wallet!.address)
                showSuccess(`✓ ${amt} USDC sent successfully!`)
              } else {
                setError(result.error || 'Transaction failed'); setConfirming(false)
              }
            }}>Confirm & Send</button>
            <button style={s.btnGhost} onClick={() => setConfirming(false)}>← Cancel</button>
          </>
        )}
      </div>
    </div>
  )

  // ── Transaction Detail ────────────────────────────────────
  if (screen === 'txDetail' && selectedTx) {
    const isSent = selectedTx.from?.hash?.toLowerCase() === wallet?.address.toLowerCase()
    const amount = selectedTx.value ? (parseFloat(selectedTx.value) / 1e18).toFixed(6) : '0.000000'
    const hash = selectedTx.hash || ''
    const shortHash = hash ? `${hash.slice(0, 16)}...${hash.slice(-8)}` : '—'
    const status = selectedTx.status === 'ok' ? 'Success' : selectedTx.status || 'Unknown'

    return (
      <div style={s.page}>
        <WatermarkBg />
        <div style={s.content}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setScreen('dashboard')}>←</button>
            <h2 style={s.pageTitle}>Transaction</h2>
          </div>

          {/* Status badge */}
          <div style={{ alignSelf: 'center' }}>
            <div style={{ ...s.successBadge, background: status === 'Success' ? 'rgba(16,185,129,0.15)' : 'rgba(248,113,113,0.15)', color: status === 'Success' ? '#10b981' : '#f87171', border: `1px solid ${status === 'Success' ? 'rgba(16,185,129,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
              {status === 'Success' ? '✓' : '✕'} {status}
            </div>
          </div>

          {/* Amount */}
          <div style={{ ...s.balanceCard, padding: '20px' }}>
            <p style={s.balanceLabel}>{isSent ? 'SENT' : 'RECEIVED'}</p>
            <p style={{ ...s.balanceAmount, fontSize: 32, color: isSent ? '#f87171' : '#10b981' }}>
              {isSent ? '-' : '+'}{amount}
            </p>
            <p style={s.balanceCurrency}>USDC</p>
          </div>

          {/* Details */}
          <div style={s.txDetailCard}>
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>Type</span>
              <span style={{ ...s.txDetailValue, color: isSent ? '#f87171' : '#10b981' }}>{isSent ? '↑ Sent' : '↓ Received'}</span>
            </div>
            <div style={s.txDetailDivider} />
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>From</span>
              <span style={s.txDetailValue}>{selectedTx.from?.hash?.slice(0, 10)}...{selectedTx.from?.hash?.slice(-6)}</span>
            </div>
            <div style={s.txDetailDivider} />
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>To</span>
              <span style={s.txDetailValue}>{selectedTx.to?.hash?.slice(0, 10)}...{selectedTx.to?.hash?.slice(-6)}</span>
            </div>
            <div style={s.txDetailDivider} />
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>Date</span>
              <span style={s.txDetailValue}>{formatDate(selectedTx.timestamp)}</span>
            </div>
            <div style={s.txDetailDivider} />
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>Gas Used</span>
              <span style={s.txDetailValue}>{selectedTx.gas_used || '—'}</span>
            </div>
            <div style={s.txDetailDivider} />
            <div style={s.txDetailRow}>
              <span style={s.txDetailLabel}>Block</span>
              <span style={s.txDetailValue}>#{selectedTx.block || '—'}</span>
            </div>
          </div>

          {/* Hash */}
          <div style={s.txHashBox}>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#7b8cde', letterSpacing: 0.4 }}>TRANSACTION HASH</p>
            <p style={{ margin: 0, fontSize: 11, color: '#93b4ff', wordBreak: 'break-all', lineHeight: 1.6 }}>{hash}</p>
          </div>

          {/* Actions */}
          <button style={s.btnPrimary} onClick={() => openExplorer(hash)}>
            View on Arc Explorer ↗
          </button>
          <button style={s.btnOutline} onClick={() => handleCopy(hash)}>
            {copied ? '✓ Hash Copied!' : '⎘  Copy Hash'}
          </button>
        </div>
      </div>
    )
  }

  // ── Settings ──────────────────────────────────────────────
  if (screen === 'settings') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('dashboard')}>←</button>
          <h2 style={s.pageTitle}>Settings</h2>
        </div>
        <div style={s.settingsItem} onClick={() => setScreen('addWallet')}>
          <div>
            <p style={s.settingsTitle}>Add Wallet</p>
            <p style={s.settingsSub}>Create or import another wallet</p>
          </div>
          <span style={s.settingsArrow}>→</span>
        </div>
        <div style={s.settingsItem} onClick={() => { setPhraseRevealed(false); setScreen('revealPhrase') }}>
          <div>
            <p style={s.settingsTitle}>Reveal Recovery Phrase</p>
            <p style={s.settingsSub}>View seed phrase for {wallet?.name}</p>
          </div>
          <span style={s.settingsArrow}>→</span>
        </div>
        <div style={{ ...s.settingsItem, borderColor: 'rgba(248,113,113,0.2)' }} onClick={() => setScreen('confirmDelete')}>
          <div>
            <p style={{ ...s.settingsTitle, color: '#f87171' }}>Delete {wallet?.name}</p>
            <p style={s.settingsSub}>Remove this wallet from device</p>
          </div>
          <span style={{ ...s.settingsArrow, color: '#f87171' }}>→</span>
        </div>
      </div>
    </div>
  )

  // ── Reveal phrase ─────────────────────────────────────────
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
              <p style={{ margin: 0, fontSize: 12, color: '#fbbf24', lineHeight: 1.7 }}>
                Your recovery phrase gives full access to your wallet and funds. Never share it with anyone — not even CyberSwitch support. Anyone with this phrase can steal your funds. Make sure no one is watching your screen.
              </p>
            </div>
            <button style={s.btnPrimary} onClick={() => setPhraseRevealed(true)}>I Understand — Reveal Phrase</button>
            <button style={s.btnGhost} onClick={() => setScreen('settings')}>← Back to Safety</button>
          </>
        ) : (
          <>
            <p style={s.bodyText}>Keep this safe. Never share it with anyone.</p>
            <div style={s.mnemonicBox}>{wallet?.mnemonic}</div>
            <button style={s.btnOutline} onClick={() => handleCopy(wallet?.mnemonic || '')}>{copied ? '✓ Copied!' : '⎘  Copy Phrase'}</button>
            <button style={s.btnGhost} onClick={() => { setPhraseRevealed(false); setScreen('settings') }}>← Done</button>
          </>
        )}
      </div>
    </div>
  )

  // ── Confirm delete ────────────────────────────────────────
  if (screen === 'confirmDelete') return (
    <div style={s.page}>
      <WatermarkBg />
      <div style={s.content}>
        <div style={s.pageHeader}>
          <button style={s.backBtn} onClick={() => setScreen('settings')}>←</button>
          <h2 style={{ ...s.pageTitle, color: '#f87171' }}>Delete {wallet?.name}</h2>
        </div>
        <div style={{ ...s.mnemonicBox, borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
          <p style={{ margin: '0 0 8px', fontSize: 16 }}>⚠️ This cannot be undone</p>
          <p style={{ margin: 0, fontSize: 12, color: '#f87171', lineHeight: 1.7 }}>
            {wallets.length === 1
              ? 'This is your only wallet. Deleting it will remove all data from this device.'
              : `${wallet?.name} will be removed. Your other wallets will remain.`}
            {' '}Make sure you have your recovery phrase saved.
          </p>
        </div>
        <button
          style={{ ...s.btnPrimary, background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 4px 20px rgba(220,38,38,0.4)' }}
          onClick={() => {
            deleteWalletAtIndex(activeIndex).then(({ wallets: ws, newIndex }) => {
              if (ws.length === 0) {
                deleteWallet(); setWallets([]); setScreen('welcome')
              } else {
                setWallets(ws); setActiveIndex(newIndex)
                refreshDashboard(ws[newIndex].address)
                setScreen('dashboard'); showSuccess('✓ Wallet deleted')
              }
            })
          }}>
          Yes, Delete This Wallet
        </button>
        <button style={s.btnGhost} onClick={() => setScreen('settings')}>← Cancel</button>
      </div>
    </div>
  )

  // ── Dashboard ─────────────────────────────────────────────
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
          <button style={s.actionBtn} onClick={() => setScreen('receive')}>
            <span style={s.actionIcon}>↓</span><span>Receive</span>
          </button>
          <button style={s.actionBtn} onClick={() => refreshDashboard(wallet!.address)}>
            <span style={s.actionIcon}>↺</span><span>Refresh</span>
          </button>
        </div>
        <div style={s.txSection}>
          <p style={s.txTitle}>Recent Transactions</p>
          {transactions.length === 0 ? (
            <div style={s.txEmpty}><p style={s.muted}>No transactions yet</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                        <p style={{ margin: 0, fontSize: 11, color: '#7b8cde' }}>
                          {isSent ? tx.to?.hash?.slice(0, 8) : tx.from?.hash?.slice(0, 8)}...
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: isSent ? '#f87171' : '#10b981' }}>
                        {isSent ? '-' : '+'}{amount} USDC
                      </p>
                      <p style={{ margin: 0, fontSize: 10, color: '#4a5580' }}>tap for details</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { width: 380, minHeight: 560, background: 'linear-gradient(160deg, #04041e 0%, #060d3a 60%, #04041e 100%)', color: '#fff', fontFamily: "'Inter', sans-serif", position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  content: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: 24, flex: 1 },
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
  qrPlaceholder: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qrInner: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  dashHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  networkPill: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '5px 12px', fontSize: 11, color: '#7b8cde' },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' },
  networkRow: { display: 'flex', alignItems: 'center', gap: 8 },
  networkLabel: { fontSize: 12, color: '#7b8cde' },
  addressPill: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '6px 16px', fontSize: 12, color: '#7b8cde', alignSelf: 'center' },
  balanceCard: { background: 'linear-gradient(135deg, rgba(26,58,255,0.2), rgba(0,102,255,0.1))', border: '1px solid rgba(26,58,255,0.25)', borderRadius: 16, padding: '24px 20px', textAlign: 'center' },
  balanceLabel: { fontSize: 12, color: '#7b8cde', margin: '0 0 6px', letterSpacing: 0.5, textTransform: 'uppercase' },
  balanceAmount: { fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: -1 },
  balanceCurrency: { fontSize: 14, color: '#4d8aff', margin: '2px 0 12px', fontWeight: 600 },
  balanceDivider: { height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 0 10px' },
  balanceSub: { fontSize: 12, color: '#4a5580', margin: 0 },
  actionRow: { display: 'flex', gap: 10 },
  actionBtn: { flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '14px 0', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
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