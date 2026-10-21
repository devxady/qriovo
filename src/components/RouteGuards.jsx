import { useEffect, useState } from 'react'
import { getIdTokenResult } from 'firebase/auth'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Button } from './UI.jsx'

export function AuthLoading() {
  return <main className="auth-route-state" role="status" aria-live="polite"><span className="auth-loading-spinner" /><strong>Checking your account…</strong><p>Qriovo is securely checking your sign-in status.</p></main>
}

export function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AuthLoading />
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

export function PublicOnlyRoute({ children }) {
  const { currentUser, loading, profileSetupPending } = useAuth()
  if (loading) return <AuthLoading />
  if (currentUser && !profileSetupPending) return <Navigate to="/dashboard" replace />
  return children
}

export function AdminRoute({ children }) {
  const { currentUser, loading } = useAuth()
  const location = useLocation()
  const [status, setStatus] = useState('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    if (loading) return () => { active = false }
    if (!currentUser) { setStatus('guest'); return () => { active = false } }
    setStatus('checking')
    getIdTokenResult(currentUser, true)
      .then((token) => { if (active) setStatus(token.claims.superAdmin === true ? 'allowed' : 'denied') })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [currentUser, loading, attempt])

  if (loading || status === 'checking') return <AuthLoading />
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />
  if (status === 'allowed') return children
  return <main className="admin-access-state"><span className="admin-access-mark">Q</span><span className="eyebrow">RESTRICTED AREA</span><h1>{status === 'error' ? 'Access could not be verified.' : 'Super Admin access required.'}</h1><p>{status === 'error' ? 'Qriovo could not refresh your Firebase ID token. Check your connection, then retry.' : 'This account does not have the trusted Super Admin custom claim.'}</p><div className="admin-access-actions"><Button type="button" onClick={() => setAttempt((value) => value + 1)}>Refresh access</Button><Button to="/dashboard" variant="secondary">Return to your dashboard</Button><Link to="/">Back to Qriovo</Link></div></main>
}

export function SuperAdminRoute({ children }) {
  const { currentUser, loading } = useAuth()
  const location = useLocation()
  const [status, setStatus] = useState('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    if (loading) return () => { active = false }
    if (!currentUser) { setStatus('guest'); return () => { active = false } }
    setStatus('checking')
    getIdTokenResult(currentUser, true)
      .then((token) => {
        if (!active) return
        setStatus(token.claims.superAdmin === true ? 'allowed' : 'denied')
      })
      .catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [currentUser, loading, attempt])

  if (loading || status === 'checking') return <AuthLoading />
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />
  if (status === 'allowed') return children
  return <main className="admin-access-state"><span className="admin-access-mark">Q</span><span className="eyebrow">RESTRICTED AREA</span><h1>{status === 'error' ? 'Access could not be verified.' : 'Super Admin access required.'}</h1><p>{status === 'error' ? 'Qriovo could not refresh your Firebase ID token. Check your connection, then retry.' : 'This account does not have the Super Admin custom claim required to manage users.'}</p><div className="admin-access-actions"><Button type="button" onClick={() => setAttempt((value) => value + 1)}>Refresh access</Button><Button to="/admin" variant="secondary">Return to Super Admin Dashboard</Button><Link to="/">Back to Qriovo</Link></div></main>
}
