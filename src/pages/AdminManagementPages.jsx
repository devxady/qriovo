import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { Button, Eyebrow } from '../components/UI.jsx'
import { getSuperAdminOwners, superAdminApiConfigured } from '../lib/superAdminService.js'

function ManagementNotice({ children, tone = 'info' }) {
  const Icon = tone === 'error' ? AlertTriangle : ShieldCheck
  return <div className={`admin-management-notice admin-management-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={17} /><span>{children}</span></div>
}

const ownerIdentityDefaults = [
  { slot: 'Owner 1', email: 'etesting969@gmail.com', uid: 'DgXAZDj0S6NM0LrbhB7QzqzI3Az1', status: 'Live claim status unavailable', createdAt: '', lastSignInAt: '' },
  { slot: 'Owner 2', email: 'aditya07acc@gmail.com', uid: 'raSnrlncf0hM0FhmCTsxkbN59Qq1', status: 'Live claim status unavailable', createdAt: '', lastSignInAt: '' },
]

function ownerDate(value) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function SuperAdminSettingsPage() {
  const { currentUser } = useAuth()
  const [owners, setOwners] = useState(ownerIdentityDefaults)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadOwners = async () => {
    if (!superAdminApiConfigured) return
    setLoading(true); setError('')
    try {
      const result = await getSuperAdminOwners(currentUser)
      setOwners(ownerIdentityDefaults.map((slot, index) => ({ ...slot, ...(result.owners?.[index] || {}) })))
    } catch (cause) { setError(cause?.message || 'Protected owner details could not be loaded.') }
    finally { setLoading(false) }
  }
  useEffect(() => { loadOwners() }, [currentUser])

  return <section className="admin-content admin-management-content">
    <div className="admin-page-intro"><div><Eyebrow>PROTECTED ACCESS</Eyebrow><h2>Super Admin Settings</h2><p>Two fixed owner slots. Owner access can only be configured through a separate, explicitly approved setup procedure.</p></div>{superAdminApiConfigured && <Button type="button" variant="secondary" onClick={loadOwners} disabled={loading}><RefreshCw size={15} />{loading ? 'Refreshing…' : 'Refresh'}</Button>}</div>
    {!superAdminApiConfigured && <ManagementNotice>The verified owner identities are listed from local configuration. Live Firebase Auth and claim status require the trusted service.</ManagementNotice>}
    {error && <ManagementNotice tone="error">{error}</ManagementNotice>}
    <div className="admin-owner-slots">{owners.map((owner, index) => <article className="admin-management-card admin-owner-card" key={owner.slot}><div className="admin-management-card-heading"><span className="admin-management-icon"><ShieldCheck size={19} /></span><div><span className="admin-kicker">FIXED SLOT {index + 1}</span><h3>{owner.slot}</h3></div><span className="admin-protected-role"><ShieldCheck size={14} /> Protected</span></div><dl><div><dt>Email</dt><dd>{owner.email || 'Pending owner information'}</dd></div><div><dt>Account UID</dt><dd className="admin-owner-uid">{owner.uid || 'Not configured'}</dd></div><div><dt>Access status</dt><dd>{owner.status || (owner.active ? 'Active' : 'Pending configuration')}</dd></div><div><dt>Account created</dt><dd>{ownerDate(owner.createdAt)}</dd></div><div><dt>Last sign-in</dt><dd>{ownerDate(owner.lastSignInAt)}</dd></div></dl></article>)}</div>
    <article className="admin-management-card admin-owner-policy"><span className="admin-management-icon"><Users size={19} /></span><div><h3>Owner access</h3><p>This page is informational and has no promote, replace or demote actions. Managing approved Super Admin access requires the trusted local Firebase Admin SDK workflow.</p></div></article>
  </section>
}
