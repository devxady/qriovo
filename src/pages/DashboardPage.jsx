import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, CircleHelp, Copy, Download, Grid2X2, LayoutDashboard, List, LogOut, Pencil, Plus, QrCode, Search, SlidersHorizontal, Trash2, X, ChevronDown, Eye, UserRound, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand, Button } from '../components/UI.jsx'
import { QRCodePreview } from '../components/QRCodePreview.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { QR_TYPES, downloadQr, qrOptions } from '../lib/qr.js'
import { deleteQrCode, duplicateQrCode, getUserQrQuota, listUserQrCodes, MAX_SAVED_QR_CODES } from '../lib/qrService.js'
import { firebaseErrorMessage } from '../lib/firebaseErrors.js'

const dateValue = (value) => value?.toDate ? value.toDate() : value ? new Date(value) : null
const emptyCodes = []
const formatDate = (value) => {
  const date = dateValue(value)
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : 'Just added'
}

export function DashboardPage() {
  const { currentUser, logout } = useAuth()
  const userId = currentUser?.uid || ''
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const [codes, setCodes] = useState([])
  const [loadedUserId, setLoadedUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('grid')
  const [filter, setFilter] = useState('All types')
  const [sort, setSort] = useState('newest')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [quotaInfo, setQuotaInfo] = useState({ ready: false, count: null, error: false })

  const loadQuota = async (uid = userId) => {
    if (!uid) return
    try { setQuotaInfo({ ...(await getUserQrQuota(uid)), error: false }) }
    catch { setQuotaInfo({ ready: false, count: null, error: true }) }
  }

  const loadCodes = async (uid = userId) => {
    if (!uid) return
    setLoading(true)
    setError('')
    setCodes([])
    setLoadedUserId('')
    try {
      const records = await listUserQrCodes(uid)
      if (uid === userIdRef.current) {
        setCodes(records)
        setLoadedUserId(uid)
      }
    } catch (loadError) {
      if (uid === userIdRef.current) {
        setError(firebaseErrorMessage(loadError, 'Your QR codes could not be loaded.'))
        setLoadedUserId(uid)
      }
    } finally { if (uid === userIdRef.current) setLoading(false) }
  }

  useEffect(() => {
    let active = true
    setSelected(null)
    setConfirmDelete(null)
    setBusyId('')
    setCodes([])
    setLoadedUserId('')
    setLoading(true)
    setError('')
    setQuotaInfo({ ready: false, count: null, error: false })
    listUserQrCodes(userId).then((records) => {
      if (active) { setCodes(records); setLoadedUserId(userId) }
    }).catch((loadError) => {
      if (active) { setError(firebaseErrorMessage(loadError, 'Your QR codes could not be loaded.')); setLoadedUserId(userId) }
    }).finally(() => { if (active) setLoading(false) })
    getUserQrQuota(userId).then((quota) => { if (active) setQuotaInfo({ ...quota, error: false }) }).catch(() => { if (active) setQuotaInfo({ ready: false, count: null, error: true }) })
    return () => { active = false }
  }, [userId])

  const activeCodes = loadedUserId === userId ? codes : emptyCodes
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return activeCodes.filter((code) => `${code.name} ${code.type} ${code.payload}`.toLowerCase().includes(term) && (filter === 'All types' || code.type === filter))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : (dateValue(b.createdAt)?.getTime() || 0) - (dateValue(a.createdAt)?.getTime() || 0))
  }, [activeCodes, filter, search, sort])
  const typeCount = new Set(activeCodes.map((code) => code.type)).size
  const newest = [...activeCodes].sort((a, b) => (dateValue(b.createdAt)?.getTime() || 0) - (dateValue(a.createdAt)?.getTime() || 0))[0]
  const toast = (message) => { setNotice(message); window.setTimeout(() => setNotice(''), 3600) }

  const download = async (code, extension = 'png') => {
    setBusyId(`${code.id}-${extension}`)
    try {
      await downloadQr({ data: code.payload, name: code.name, extension, ...code.design })
      toast(`${extension.toUpperCase()} download started for “${code.name}”.`)
    } catch (downloadError) {
      console.error('Saved QR download failed', downloadError)
      toast('This QR file could not be prepared. Please try again.')
    } finally { setBusyId('') }
  }
  const duplicate = async (code) => {
    setBusyId(code.id)
    try {
      await duplicateQrCode(userId, code)
      if (userId !== userIdRef.current) return
      await loadCodes(userId)
      await loadQuota(userId)
      if (userId === userIdRef.current) toast(`“${code.name}” was duplicated.`)
    } catch (duplicateError) { if (userId === userIdRef.current) toast(firebaseErrorMessage(duplicateError, 'This QR could not be duplicated.')) }
    finally { setBusyId('') }
  }
  const remove = async () => {
    if (!confirmDelete || deleting) return
    setDeleting(true)
    try {
      await deleteQrCode(userId, confirmDelete)
      if (userId !== userIdRef.current) return
      setCodes((items) => items.filter((item) => item.id !== confirmDelete.id))
      await loadQuota(userId)
      setSelected((item) => item?.id === confirmDelete.id ? null : item)
      toast(`“${confirmDelete.name}” was deleted.`)
      setConfirmDelete(null)
    } catch (deleteError) { toast(firebaseErrorMessage(deleteError, 'This QR could not be deleted. Please try again.')) }
    finally { setDeleting(false) }
  }
  const handleLogout = async () => {
    try { await logout() } catch (logoutError) { toast(firebaseErrorMessage(logoutError, 'We could not sign you out. Please try again.')) }
  }
  const dataReady = loadedUserId === userId && !loading
  const savedCount = dataReady ? activeCodes.length : null
  const remainingCount = savedCount === null ? null : Math.max(0, MAX_SAVED_QR_CODES - savedCount)
  const quotaReached = savedCount !== null && savedCount >= MAX_SAVED_QR_CODES
  const displayName = currentUser?.displayName?.trim() || currentUser?.email?.split('@')[0] || 'there'

  return <div className="dashboard-shell"><aside className="dashboard-sidebar"><Brand light /><div className="sidebar-workspace"><span className="workspace-avatar"><UserRound size={17} /></span><span><strong>{displayName}’s workspace</strong><small>Personal account</small></span></div><nav className="sidebar-nav" aria-label="Dashboard navigation"><span className="sidebar-label">WORKSPACE</span><Link className="sidebar-link active" to="/dashboard"><LayoutDashboard size={18} /> Overview</Link><Link className="sidebar-link" to="/generator"><QrCode size={18} /> Create a QR <span className="sidebar-count">+</span></Link><span className="sidebar-label sidebar-label-spaced">SUPPORT</span><Link className="sidebar-link" to="/contact"><CircleHelp size={18} /> Help &amp; support</Link></nav><div className="sidebar-bottom"><div className="sidebar-plan"><span className="plan-spark">✳</span><strong>Your QR collection</strong><p>Manage your saved codes and keep a copy ready to download.</p><Button to="/generator" variant="sidebar">Create a QR <ArrowUpRight size={14} /></Button></div><div className="sidebar-profile"><span className="profile-avatar"><UserRound size={16} /></span><span><strong>{displayName}</strong><small>{currentUser?.email}</small></span></div><button className="sidebar-logout" type="button" onClick={handleLogout}><LogOut size={16} /> Log out</button></div></aside>
    <main className="dashboard-main"><header className="dashboard-topbar"><div><span className="dash-date">YOUR Q R I O V O ACCOUNT</span><h1>Your workspace<span>.</span></h1></div><div className="dashboard-top-actions"><span className="dashboard-plan-pill"><i /> Signed in</span><Button to="/generator"><Plus size={17} /> Create QR code</Button></div></header>
      <section className="dashboard-welcome"><div><span className="welcome-overline">YOUR QR COLLECTION</span><h2>Welcome, {displayName} <span>✳</span></h2><p>Your saved codes are private to your account. Create something new or pick up where you left off.</p></div><span className="welcome-art"><QrCode size={36} /></span></section>
      <div className="stat-grid"><StatCard label="Saved QR codes" value={String(activeCodes.length).padStart(2, '0')} change={loading ? 'Loading your account' : 'In your collection'} icon={<QrCode size={18} />} /><StatCard label="QR types" value={String(typeCount).padStart(2, '0')} change="Across your collection" icon={<SlidersHorizontal size={18} />} /><StatCard label="Most recent" value={newest?.name || (loading ? 'Loading…' : '—')} change={newest ? formatDate(newest.createdAt) : 'Create your first QR'} icon={<Search size={18} />} /></div>
      <section className={`qr-quota-panel ${quotaReached ? 'quota-reached' : savedCount !== null && savedCount >= 20 ? 'quota-warning' : ''}`} aria-label="Saved QR storage usage"><div className="qr-quota-top"><div><span className="section-eyebrow-small">ACCOUNT STORAGE</span><h2>Saved QR Codes: {savedCount === null ? '—' : savedCount} / {MAX_SAVED_QR_CODES}</h2></div><strong>{remainingCount === null ? 'Checking slots…' : `${remainingCount} ${remainingCount === 1 ? 'slot' : 'slots'} remaining`}</strong></div><div className="qr-quota-track" role="progressbar" aria-label="QR storage used" aria-valuemin="0" aria-valuemax={MAX_SAVED_QR_CODES} aria-valuenow={savedCount ?? 0}><span style={{ width: `${savedCount === null ? 0 : Math.min(100, savedCount / MAX_SAVED_QR_CODES * 100)}%` }} /></div>{quotaReached ? <p className="qr-quota-message"><strong>You&apos;ve reached your limit of 25 saved QR codes.</strong> Remove an existing saved QR to create space for a new one. Editing and downloading remain available.</p> : savedCount !== null && savedCount >= 20 ? <p className="qr-quota-message">You&apos;re approaching your free QR storage limit. You can still create and download QR codes; save another after freeing a slot.</p> : !quotaInfo.ready && quotaInfo.error ? <p className="qr-quota-message">Storage controls are not available yet. The 25-code limit is enforced by Firestore; account counters may need the one-time administrator migration.</p> : !quotaInfo.ready ? <p className="qr-quota-message">Your account storage counter has not been reconciled yet. QR management will be available after the one-time migration.</p> : quotaInfo.count !== savedCount ? <p className="qr-quota-message">Your storage counter and QR records do not match. Please contact support before creating or deleting codes.</p> : <p className="qr-quota-message">Your saved QR codes are private to your account. Create and download locally without saving to use no account storage.</p>}</section>
      <section className="codes-section"><div className="codes-heading"><div><span className="section-eyebrow-small">SAVED TO YOUR ACCOUNT</span><h2>Your QR codes <span className="codes-count">{activeCodes.length}</span></h2></div><span className="demo-label saved-label">PRIVATE</span></div><div className="codes-toolbar"><label className="search-box"><Search size={17} /><input type="search" aria-label="Search QR codes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your QR codes" /></label><label className="filter-select"><SlidersHorizontal size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter QR codes by type"><option>All types</option>{QR_TYPES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></label><label className="filter-select sort-select"><span className="sort-label">Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort QR codes"><option value="newest">Newest</option><option value="name">Name A–Z</option></select><ChevronDown size={15} /></label><div className="view-toggle" aria-label="Change view"><button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button type="button" aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><List size={18} /></button></div></div>
        {error && <div className="notice notice-error dashboard-error" role="alert"><CircleHelp size={17} /><span>{error}</span><button type="button" onClick={() => loadCodes(userId)}><RefreshCw size={14} /> Retry</button></div>}
        {!dataReady && !error ? <div className="dashboard-loading" role="status"><span className="auth-loading-spinner" /> Loading your QR codes…</div> : null}
        {dataReady && !error && visible.length ? <div className={`qr-management-grid ${view === 'list' ? 'qr-management-list' : ''}`}>{visible.map((code) => <article className="management-card" key={code.id}><button type="button" className="management-preview" onClick={() => setSelected(code)} aria-label={`Preview ${code.name}`}><span className="mini-real-qr"><QRCodePreview data={code.payload} options={qrOptions({ data: code.payload, size: 256, ...code.design })} /></span><span className="preview-open-hint"><Eye size={14} /> Preview</span></button><div className="management-card-body"><div className="management-card-title"><div><h3>{code.name}</h3><span className="qr-type-chip">{code.type}</span></div></div><p className="qr-card-detail">{code.type === 'Text' ? code.payload : code.type === 'Wi-Fi' ? 'Wi-Fi access details' : code.payload}</p><div className="management-card-meta"><span>Created {formatDate(code.createdAt)}</span><span>Private</span></div><div className="management-card-actions"><Link to={`/dashboard/qr/${code.id}/edit`}><Pencil size={15} /> Edit</Link><button type="button" disabled={busyId === code.id || quotaReached} title={quotaReached ? 'Delete a saved QR code to free a slot before duplicating.' : undefined} onClick={() => duplicate(code)}><Copy size={15} /> {busyId === code.id ? 'Working…' : 'Duplicate'}</button><button type="button" aria-label={`Delete ${code.name}`} onClick={() => setConfirmDelete(code)}><Trash2 size={15} /></button><button type="button" className="card-download" disabled={busyId.startsWith(`${code.id}-`)} onClick={() => download(code, 'png')}><Download size={15} /> {busyId.startsWith(`${code.id}-`) ? 'Preparing…' : 'Download'}</button></div></div></article>)}</div> : null}
        {dataReady && !error && !visible.length && <div className="empty-state"><span className="empty-state-icon">{activeCodes.length ? <Search size={22} /> : <QrCode size={22} />}</span><h3>{activeCodes.length ? 'No codes found' : 'Your collection is ready'}</h3><p>{activeCodes.length ? 'Try a different search or QR type.' : 'Create a QR code and save it here. Your records will be available when you sign in again.'}</p>{activeCodes.length ? <button type="button" className="text-link" onClick={() => { setSearch(''); setFilter('All types') }}>Clear filters <ArrowUpRight size={15} /></button> : <Button to="/generator">Create your first QR <Plus size={16} /></Button>}</div>}
      </section><footer className="dashboard-footer"><span>Qriovo · Create. Customize. Manage.</span><span>{currentUser?.email}</span></footer>
    </main>
    {selected && dataReady && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><section className="qr-detail-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title"><button className="modal-close" type="button" onClick={() => setSelected(null)} aria-label="Close QR preview"><X size={19} /></button><span className="panel-step">SAVED QR PREVIEW · {selected.type.toUpperCase()}</span><h2 id="preview-title">{selected.name}</h2><div className="modal-qr"><QRCodePreview data={selected.payload} options={qrOptions({ data: selected.payload, size: 512, ...selected.design })} /></div><code className="modal-payload">{selected.payload}</code><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setSelected(null)}>Close</Button><Button type="button" variant="secondary" disabled={busyId === `${selected.id}-svg`} onClick={() => download(selected, 'svg')}>{busyId === `${selected.id}-svg` ? 'Preparing…' : 'Download SVG'}</Button><Button type="button" onClick={() => download(selected, 'png')} disabled={busyId === `${selected.id}-png`}><Download size={16} /> {busyId === `${selected.id}-png` ? 'Preparing…' : 'Download PNG'}</Button></div></section></div>}
    {confirmDelete && dataReady && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmDelete(null) }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><span className="modal-icon"><Trash2 size={20} /></span><h2 id="delete-title">Delete this QR code?</h2><p><strong>{confirmDelete.name}</strong> will be permanently deleted from your account. This action cannot be undone.</p><div><Button type="button" variant="secondary" disabled={deleting} onClick={() => setConfirmDelete(null)}>Keep QR</Button><Button type="button" variant="danger" disabled={deleting} onClick={remove}>{deleting ? 'Deleting…' : 'Delete permanently'}</Button></div></section></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>
}

function StatCard({ label, value, change, icon }) { return <article className="stat-card"><div className="stat-card-top"><span>{label}</span><i>{icon}</i></div><strong className={String(value).length > 12 ? 'stat-value-small' : ''}>{value}</strong><small>{change}</small></article> }
