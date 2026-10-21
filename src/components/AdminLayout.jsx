import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, BarChart3, LayoutDashboard, LogOut, Menu, ShieldCheck, Users, X } from 'lucide-react'
import { getIdTokenResult } from 'firebase/auth'
import { Brand, Button } from './UI.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { firebaseErrorMessage } from '../lib/firebaseErrors.js'

export function AdminLayout() {
  const { currentUser, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [notice, setNotice] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    let active = true
    setIsSuperAdmin(false)
    if (currentUser) getIdTokenResult(currentUser).then(({ claims }) => {
      if (active) setIsSuperAdmin(claims.superAdmin === true)
    }).catch(() => { if (active) setIsSuperAdmin(false) })
    return () => { active = false }
  }, [currentUser])
  const name = currentUser?.displayName?.trim() || currentUser?.email || 'Super Admin'
  const close = () => setMobileOpen(false)
  const handleLogout = async () => {
    try { await logout(); navigate('/', { replace: true }) }
    catch (error) { setNotice(firebaseErrorMessage(error, 'We could not sign you out. Please try again.')) }
  }
  return <div className="admin-shell">
    <aside className={`admin-sidebar ${mobileOpen ? 'admin-sidebar-open' : ''}`}>
      <Brand light />
      <div className="admin-sidebar-title"><ShieldCheck size={17} /><span>SUPER ADMIN CONSOLE</span></div>
      <nav className="admin-nav" aria-label="Admin navigation">
        <NavLink to="/admin" end onClick={close}><LayoutDashboard size={18} /> Overview</NavLink>
        <NavLink to="/admin/users" end onClick={close}><Users size={18} /> All users</NavLink>
        <NavLink to="/admin/activity" onClick={close}><Activity size={18} /> Activity monitoring</NavLink>
        <NavLink to="/admin/analytics" onClick={close}><BarChart3 size={18} /> Analytics</NavLink>
        {isSuperAdmin && <NavLink to="/admin/settings" onClick={close}><ShieldCheck size={18} /> Super Admin settings</NavLink>}
      </nav>
      <div className="admin-sidebar-bottom">
        <Link className="admin-back-link" to="/" onClick={close}><ArrowLeft size={15} /> Back to Qriovo</Link>
        <div className="admin-identity"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{currentUser?.email}</small></div></div>
        <button className="admin-logout" type="button" onClick={handleLogout}><LogOut size={16} /> Log out</button>
      </div>
    </aside>
    {mobileOpen && <button className="admin-nav-backdrop" type="button" aria-label="Close admin navigation" onClick={close} />}
    <main className="admin-main">
      <header className="admin-mobile-top"><Brand /><button type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X /> : <Menu />}</button></header>
      <header className="admin-topbar"><div><span className="admin-kicker">Q R I O V O&nbsp; / &nbsp;SUPER ADMIN</span><h1>{location.pathname === '/admin/settings' ? 'Super Admin settings' : location.pathname === '/admin/activity' ? 'Activity monitoring' : location.pathname === '/admin/users' ? 'All users' : location.pathname.startsWith('/admin/users/') ? 'Account details' : location.pathname === '/admin/analytics' ? 'Analytics' : 'Overview'}<span>.</span></h1></div><div className="admin-topbar-actions"><span className="admin-readonly-pill"><ShieldCheck size={15} />Read only</span><Button to="/" variant="secondary">View website <ArrowLeft size={14} /></Button></div></header>
      {notice && <div className="notice notice-error admin-layout-notice" role="alert">{notice}</div>}
      <Outlet />
    </main>
  </div>
}
