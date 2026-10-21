import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Activity, ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarClock, CircleHelp, Clock3, Database, QrCode, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { Button, Eyebrow } from '../components/UI.jsx'
import { formatAdminDate, getAdminActivity, getAdminAnalytics, getAdminOverview, getAdminUserDetail, inactivityStatus, listAdminUsers, updateAdminUserName } from '../lib/adminService.js'
import { firebaseErrorMessage } from '../lib/firebaseErrors.js'
import { getManagedAuthSummaries, superAdminApiConfigured } from '../lib/superAdminService.js'

const prettyNumber = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : '—'
const valueOrUnavailable = (value) => value === null || value === undefined ? 'Unavailable' : prettyNumber(value)

export function AdminDashboardPage() {
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true); setError('')
    try { setOverview(await getAdminOverview()) }
    catch (cause) { setError(firebaseErrorMessage(cause, 'Super Admin statistics could not be loaded. Confirm the Firestore rules and indexes are published.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const cards = overview ? [
    ['Registered users', overview.totalUsers, 'Profiles available to Super Admins', <Users size={18} />],
    ['Saved QR codes', overview.savedQrCodes, 'Current reconciled account total', <QrCode size={18} />],
    ['Recorded login events', overview.totalRecordedLogins, 'Client-reported since tracking began', <Activity size={18} />],
    ['Successful logins today', overview.successfulLoginsToday, 'Client-reported events today', <CalendarClock size={18} />],
    ['Unique users · 30 days', overview.uniqueLoginUsers30, 'Accounts with a recorded login', <Users size={18} />],
    ['Meaningful activity · 7 days', overview.activeUsers7, 'Unique accounts by latest activity', <Activity size={18} />],
    ['Meaningful activity · 30 days', overview.activeUsers30, 'Unique accounts by latest activity', <Activity size={18} />],
    ['Inactive · 6+ months', overview.inactive6Months, 'Known last activity is older than six months', <Clock3 size={18} />],
    ['Re-verification candidates', overview.inactive12Months, 'Informational: known activity is 12+ months old', <ShieldCheck size={18} />],
    ['Average saved per user', overview.averageQrsPerUser.toFixed(2), 'Based on registered profile count', <Database size={18} />],
    ['Approaching QR limit', overview.approachingLimit, 'Accounts with 20–24 saved QR codes', <ArrowUpRight size={18} />],
    ['At or over QR limit', overview.atOrOverLimit, 'Existing records are preserved', <ArrowDownRight size={18} />],
  ] : []
  return <section className="admin-content">
    <div className="admin-page-intro"><div><Eyebrow>ADMINISTRATION</Eyebrow><h2>Account activity at a glance</h2><p>Read-only monitoring from Firestore profile, summary and event records. QR payloads are never queried here.</p></div><Button type="button" variant="secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh data'}</Button></div>
    {error && <AdminError message={error} retry={load} />}
    {loading && !overview ? <AdminLoading label="Loading account aggregates…" /> : null}
    {overview && <>
      <div className="admin-metric-grid">{cards.map(([label, value, helper, icon]) => <MetricCard key={label} label={label} value={prettyNumber(value)} helper={helper} icon={icon} />)}</div>
      <div className="admin-notice-grid"><article className="admin-info-panel"><span className="admin-info-icon"><Activity size={18} /></span><div><h3>Login reporting is client-reported</h3><p>Counts begin after rollout and only include successful sign-in callbacks recorded by the app. They are not tamper-resistant and do not include historical logins.</p></div></article><article className="admin-info-panel"><span className="admin-info-icon"><Database size={18} /></span><div><h3>QR total is a document count</h3><p>This is the sum of reconciled account counters. It is not an estimate of Firestore storage size or bandwidth.</p></div></article></div>
      <div className="admin-data-footer"><span>Last requested {formatAdminDate(overview.lastUpdatedAt, { timeStyle: 'short' })}</span><span>One-time aggregate queries · no live listeners</span></div>
    </>}
  </section>
}

export function AdminUsersPage() {
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [sort, setSort] = useState('newest')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [cursorHistory, setCursorHistory] = useState([null])
  const [result, setResult] = useState({ rows: [], cursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const cursor = cursorHistory[page - 1] || null
  const load = async () => {
    setLoading(true); setError('')
    try {
      const nextResult = await listAdminUsers({ cursor, search: submittedSearch, sort })
      setResult(nextResult)
    }
    catch (cause) { setError(firebaseErrorMessage(cause, 'User records could not be loaded. Confirm Super Admin read access and Firestore indexes.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [page, submittedSearch, sort])
  const visibleRows = useMemo(() => result.rows.filter((user) => {
    const state = inactivityStatus(user.stats?.lastActivityAt).label
    if (statusFilter === 'active') return state === 'Active'
    if (statusFilter === 'six') return state === 'Inactive 6+ months'
    if (statusFilter === 'twelve') return state === 'Inactive 12+ months'
    if (statusFilter === 'unknown') return state === 'Activity unavailable'
    return true
  }), [result.rows, statusFilter])
  const submitSearch = (event) => { event.preventDefault(); setPage(1); setCursorHistory([null]); setSubmittedSearch(search.trim()) }
  const resetList = () => { setSearch(''); setSubmittedSearch(''); setSort('newest'); setStatusFilter('all'); setPage(1); setCursorHistory([null]) }
  const nextPage = () => {
    if (!result.hasMore || !result.cursor) return
    setCursorHistory((history) => [...history.slice(0, page), result.cursor])
    setPage((current) => current + 1)
  }

  return <section className="admin-content">
    <div className="admin-page-intro"><div><Eyebrow>USER MONITORING</Eyebrow><h2>Registered accounts</h2><p>Profile and aggregate activity only. Super Admins may update display names; login details, account status and QR payloads stay protected.</p></div><span className="admin-readonly-pill"><ShieldCheck size={15} /> Limited access</span></div>
    <div className="admin-table-controls"><form className="admin-search" onSubmit={submitSearch}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name prefix or exact email" aria-label="Search users by name prefix or exact email" /><button type="submit">Search</button></form><label className="admin-select"><span>Sort</span><select value={sort} onChange={(event) => { setPage(1); setCursorHistory([null]); setSort(event.target.value) }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option></select></label><label className="admin-select"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="six">Inactive 6+ months</option><option value="twelve">Inactive 12+ months</option><option value="unknown">Activity unavailable</option></select></label><button className="admin-reset" type="button" onClick={resetList}>Reset</button></div>
    {error && <AdminError message={error} retry={load} />}
    {loading ? <AdminLoading label="Loading user page…" /> : !error && <>
      <div className="admin-table-summary"><span>{submittedSearch ? `Search results for “${submittedSearch}”` : `Page ${page} · up to ${result.rows.length} accounts`}</span><span>Status filtering applies to this page.</span></div>
      <div className="admin-table-scroll"><table className="admin-users-table"><colgroup><col className="admin-users-col-user" /><col className="admin-users-col-registered" /><col className="admin-users-col-logins" /><col className="admin-users-col-qrs" /><col className="admin-users-col-last-qr" /><col className="admin-users-col-activity" /><col className="admin-users-col-status" /><col className="admin-users-col-details" /></colgroup><thead><tr><th>User</th><th>Registered</th><th>Login events*</th><th>Saved QRs</th><th>Last QR created</th><th>Last activity</th><th>Activity status</th><th>Details</th></tr></thead><tbody>
        {visibleRows.map((user) => { const state = inactivityStatus(user.stats?.lastActivityAt); return <tr key={user.id}><td><strong>{user.name || 'Unnamed account'}</strong><small>{user.email || 'Email unavailable'}</small></td><td>{formatAdminDate(user.createdAt)}</td><td className="admin-mono">{valueOrUnavailable(user.stats?.loginCount)}</td><td><span className="admin-usage-value">{user.stats ? `${prettyNumber(user.stats.qrCount)} / 25` : 'Unreconciled'}</span></td><td>{formatAdminDate(user.stats?.lastQrCreatedAt)}</td><td>{formatAdminDate(user.stats?.lastActivityAt)}</td><td><StatusBadge state={state} /></td><td><Link className="admin-row-link" to={`/admin/users/${user.id}`}>Details <ArrowUpRight size={14} /></Link></td></tr> })}
        {!visibleRows.length && <tr><td colSpan="8" className="admin-empty-cell">No accounts match this page and status filter.</td></tr>}
      </tbody></table></div>
      <div className="admin-pagination"><span>* Successful login totals are client-reported. Historical totals were not reconstructed.</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button><strong>{page}</strong><button type="button" disabled={!result.hasMore || loading} onClick={nextPage}>Next</button></div></div>
    </>}
  </section>
}

export function AdminUserDetailPage() {
  const { currentUser } = useAuth()
  const { uid } = useParams()
  const [detail, setDetail] = useState(null)
  const [authSummary, setAuthSummary] = useState(null)
  const [profileName, setProfileName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [profileNotice, setProfileNotice] = useState('')
  const [profileError, setProfileError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try {
      const loadedDetail = await getAdminUserDetail(uid)
      setDetail(loadedDetail)
      setProfileName(loadedDetail.profile?.name || '')
      setEditingName(false)
      setProfileNotice('')
      setProfileError('')
      setAuthSummary(null)
      if (superAdminApiConfigured) {
        try { setAuthSummary((await getManagedAuthSummaries(currentUser, [uid]))[0] || null) }
        catch { setAuthSummary(null) }
      }
    }
    catch (cause) { setError(firebaseErrorMessage(cause, 'Account details could not be loaded. Confirm administrator read access and the activity index.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [uid, currentUser])
  const saveName = async (event) => {
    event.preventDefault()
    setProfileError(''); setProfileNotice('')
    const cleanName = profileName.trim()
    if (cleanName.length < 2 || cleanName.length > 100) { setProfileError('Enter a display name between 2 and 100 characters.'); return }
    setSavingName(true)
    try {
      const updatedName = await updateAdminUserName(uid, cleanName)
      setDetail((current) => current ? { ...current, profile: { ...current.profile, name: updatedName } } : current)
      setProfileName(updatedName)
      setEditingName(false)
      setProfileNotice('Display name updated.')
    } catch (cause) { setProfileError(firebaseErrorMessage(cause, 'Display name could not be updated. Confirm Super Admin access and retry.')) }
    finally { setSavingName(false) }
  }
  const state = inactivityStatus(detail?.stats?.lastActivityAt)
  return <section className="admin-content">
    <Link className="admin-back-inline" to="/admin/users"><ArrowLeft size={15} /> Back to users</Link>
    {error && <AdminError message={error} retry={load} />}
    {loading ? <AdminLoading label="Loading account details…" /> : detail && !detail.profile ? <div className="admin-error-panel"><CircleHelp size={18} /><span>This Firebase Auth account does not have a profile record. Run the one-time account reconciliation script, then refresh.</span></div> : detail && <>
      <div className="admin-user-heading"><div className="admin-user-avatar">{String(detail.profile.name || detail.profile.email || 'U').slice(0, 1).toUpperCase()}</div><div><Eyebrow>ACCOUNT DETAILS · LIMITED PROFILE EDITS</Eyebrow><h2>{detail.profile.name || 'Unnamed account'}</h2><p>{detail.profile.email || 'Email unavailable'} <span>·</span> UID <code>{uid}</code></p></div><div className="admin-user-heading-actions"><StatusBadge state={state} />{!editingName && <Button type="button" variant="secondary" onClick={() => { setProfileName(detail.profile.name || ''); setEditingName(true); setProfileError(''); setProfileNotice('') }}>Edit display name</Button>}</div></div>
      {editingName && <form className="admin-profile-edit" onSubmit={saveName}><label htmlFor="admin-profile-name">Display name</label><input id="admin-profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} autoFocus required /><div><Button type="submit" disabled={savingName}>{savingName ? 'Saving…' : 'Save name'}</Button><Button type="button" variant="secondary" disabled={savingName} onClick={() => { setProfileName(detail.profile.name || ''); setEditingName(false); setProfileError('') }}>Cancel</Button></div></form>}
      {profileError && <div className="admin-error-panel" role="alert">{profileError}</div>}{profileNotice && <div className="admin-success-panel" role="status">{profileNotice}</div>}
      <div className="admin-detail-grid"><MetricCard label="Account role" value={authSummary ? (authSummary.role === 'superAdmin' ? 'Super Admin' : 'Normal User') : 'Unavailable'} helper="Resolved by the trusted Auth service" icon={<ShieldCheck size={18} />} /><MetricCard label="Auth status" value={authSummary ? (authSummary.disabled ? 'Disabled' : 'Enabled') : 'Unavailable'} helper={authSummary ? (authSummary.emailVerified ? 'Email verified' : 'Email not verified') : 'Trusted backend metadata is unavailable'} icon={<Users size={18} />} /><MetricCard label="Account created" value={formatAdminDate(authSummary?.createdAt || detail.profile.createdAt)} helper="Firebase Auth creation time where available" icon={<CalendarClock size={18} />} /><MetricCard label="Last Auth sign-in" value={formatAdminDate(authSummary?.lastSignInAt, { timeStyle: 'short' })} helper="Firebase Authentication metadata" icon={<Activity size={18} />} /><MetricCard label="Last successful login*" value={formatAdminDate(detail.stats?.lastLoginAt, { timeStyle: 'short' })} helper={`${valueOrUnavailable(detail.stats?.loginCount)} client-reported events · tracking since ${formatAdminDate(detail.stats?.activityTrackingStartedAt)}`} icon={<Activity size={18} />} /><MetricCard label="Saved QR codes" value={detail.stats ? `${prettyNumber(detail.stats.qrCount)} / 25` : 'Not reconciled'} helper={detail.stats ? `${Math.max(0, 25 - Number(detail.stats.qrCount || 0))} slots remaining` : 'Requires one-time reconciliation'} icon={<QrCode size={18} />} /><MetricCard label="Last QR created" value={formatAdminDate(detail.stats?.lastQrCreatedAt, { timeStyle: 'short' })} helper="Timestamp from the account summary" icon={<QrCode size={18} />} /><MetricCard label="Last meaningful activity" value={formatAdminDate(detail.stats?.lastActivityAt, { timeStyle: 'short' })} helper={detail.stats?.lastActivityType ? `Most recent type: ${detail.stats.lastActivityType}` : 'No known activity timestamp'} icon={<Clock3 size={18} />} /></div>
      <article className="admin-panel admin-activity-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">RECENT EVENTS</span><h3>Account activity</h3></div><span className="admin-subtle-pill">Latest {detail.activity.length} events</span></div><p className="admin-panel-description">Best-effort client events. QR content and encoded values are not shown.</p>{detail.activity.length ? <ul className="admin-event-list">{detail.activity.map((event) => <li key={event.id}><span className={`admin-event-icon ${event.type === 'login' ? 'event-login' : ''}`}><Activity size={15} /></span><div><strong>{eventLabel(event)}</strong><small>{event.type === 'login' ? `Authentication method: ${event.authMethod || 'Unavailable'}` : 'QR metadata only'}</small></div><time>{formatAdminDate(event.createdAt, { timeStyle: 'short' })}</time></li>)}</ul> : <div className="admin-empty-inline">No activity events have been recorded since tracking started.</div>}<div className="admin-recent-qr"><h4>Recent QR creation timestamps</h4>{detail.qrActivity.length ? <ul>{detail.qrActivity.map((event) => <li key={event.id}><span>{event.type === 'qr_duplicate' ? 'Duplicated QR saved' : 'QR saved'}</span><time>{formatAdminDate(event.createdAt, { timeStyle: 'short' })}</time></li>)}</ul> : <p>No QR save events have been recorded since tracking started.</p>}</div></article>
      <p className="admin-footnote">* Login and activity events are written by the browser after successful actions. They are not independently verified. No historic login records are inferred.</p>
    </>}
  </section>
}

export function AdminActivityPage() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try {
      setEvents(await getAdminActivity())
    }
    catch (cause) { setError(firebaseErrorMessage(cause, 'Activity events could not be loaded. Confirm Super Admin read access.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  return <section className="admin-content">
    <div className="admin-page-intro"><div><Eyebrow>ACTIVITY MONITORING</Eyebrow><h2>Recent account events</h2><p>Metadata only from login and saved QR activity. Event records are client-reported and may be incomplete.</p></div><Button type="button" variant="secondary" onClick={load} disabled={loading}><RefreshCw size={15} />{loading ? 'Refreshing…' : 'Refresh activity'}</Button></div>
    {error && <AdminError message={error} retry={load} />}
    {loading ? <AdminLoading label="Loading recent events…" /> : !error && <>
      <article className="admin-panel admin-activity-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">LATEST USER EVENTS</span><h3>{events.length} records</h3></div><span className="admin-subtle-pill">QR payloads excluded</span></div>{events.length ? <ul className="admin-event-list">{events.map((event) => <li key={event.id}><span className={`admin-event-icon ${event.type === 'login' ? 'event-login' : ''}`}><Activity size={15} /></span><div><strong>{eventLabel(event)}</strong><small>UID {event.userId || 'Unavailable'}{event.type === 'login' ? ` · Authentication method: ${event.authMethod || 'Unavailable'}` : ' · QR metadata only'}</small></div><time>{formatAdminDate(event.createdAt, { timeStyle: 'short' })}</time></li>)}</ul> : <div className="admin-empty-inline">No account activity events have been recorded.</div>}</article>
    </>}
  </section>
}

export function AdminAnalyticsPage() {
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try { setDays(await getAdminAnalytics()) }
    catch (cause) { setError(firebaseErrorMessage(cause, 'Analytics could not be loaded. Confirm Super Admin access and the activity event index.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const maxValue = Math.max(1, ...days.flatMap((day) => [day.logins, day.qrSaved]))
  const totalLogins = days.reduce((total, day) => total + day.logins, 0)
  const totalQrSaved = days.reduce((total, day) => total + day.qrSaved, 0)
  return <section className="admin-content">
    <div className="admin-page-intro"><div><Eyebrow>ACTIVITY ANALYTICS</Eyebrow><h2>Seven-day activity</h2><p>Daily totals from successful sign-in callbacks and QR save events recorded by the client.</p></div><Button type="button" variant="secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh data'}</Button></div>
    {error && <AdminError message={error} retry={load} />}
    {loading ? <AdminLoading label="Loading daily aggregates…" /> : !error && <>
      <div className="admin-analytics-summary"><MetricCard label="Login events · 7 days" value={prettyNumber(totalLogins)} helper="Client-reported successful sign-ins" icon={<Activity size={18} />} /><MetricCard label="QR saves · 7 days" value={prettyNumber(totalQrSaved)} helper="Creates and duplicates recorded by the app" icon={<QrCode size={18} />} /><MetricCard label="Reporting window" value="7 days" helper="Calendar days in your local timezone" icon={<CalendarClock size={18} />} /></div>
      <article className="admin-panel admin-chart-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">DAILY EVENTS</span><h3>Logins and QR saves</h3></div><span className="admin-subtle-pill">Client-reported</span></div><div className="admin-chart-legend"><span><i className="legend-login" /> Successful login events</span><span><i className="legend-qr" /> QR creates and duplicates</span></div><div className="admin-bars" role="img" aria-label="Bar chart of daily login and QR save events for the past seven days">{days.map((day) => <div className="admin-bar-day" key={day.date.toISOString()}><div className="admin-bar-stack"><span className="admin-bar login-bar" style={{ height: `${Math.max(day.logins ? 5 : 0, day.logins / maxValue * 100)}%` }} title={`${day.logins} login events`} /><span className="admin-bar qr-bar" style={{ height: `${Math.max(day.qrSaved ? 5 : 0, day.qrSaved / maxValue * 100)}%` }} title={`${day.qrSaved} QR saves`} /></div><strong>{prettyNumber(day.logins + day.qrSaved)}</strong><small>{day.date.toLocaleDateString(undefined, { weekday: 'short' })}</small><time>{day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>)}</div><div className="admin-chart-note"><CircleHelp size={16} /> These counts start after activity tracking was enabled. Browser events can be incomplete or manipulated; they are operational indicators, not audited evidence.</div></article>
      <article className="admin-panel admin-method-panel"><div className="admin-panel-heading"><div><span className="admin-kicker">HOW TO READ THIS</span><h3>Metric boundaries</h3></div></div><div className="admin-method-grid"><div><strong>Saved QR count</strong><p>Uses reconciled `userStats.qrCount` values maintained atomically with each allowed QR create or delete. Existing records are not removed.</p></div><div><strong>Storage size</strong><p>Physical Firestore storage and bandwidth are not exposed by these client aggregate queries. Review Firebase Console usage and billing dashboards for those measurements.</p></div><div><strong>Login trust</strong><p>Firebase Auth confirms the successful sign-in, but the browser reports the event. A trusted event receiver would require a privileged server component.</p></div></div></article>
    </>}
  </section>
}

function MetricCard({ label, value, helper, icon }) { return <article className="admin-metric-card"><div className="admin-metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{helper}</small></article> }
function StatusBadge({ state }) { return <span className={`admin-status status-${state.tone}`}>{state.label}</span> }
function AdminLoading({ label }) { return <div className="admin-loading"><span className="auth-loading-spinner" />{label}</div> }
function AdminError({ message, retry }) { return <div className="admin-error-panel" role="alert"><CircleHelp size={18} /><span>{message}</span><button type="button" onClick={retry}><RefreshCw size={14} /> Retry</button></div> }
function eventLabel(event) {
  if (event.type === 'login') return 'Successful login recorded'
  if (event.type === 'qr_create') return 'QR code saved'
  if (event.type === 'qr_duplicate') return 'QR code duplicated'
  if (event.type === 'qr_edit') return 'Saved QR code edited'
  if (event.type === 'qr_delete') return 'Saved QR code deleted'
  return 'Account activity'
}
