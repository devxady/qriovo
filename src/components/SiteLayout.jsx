import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Menu, X, Instagram, Linkedin, Coffee, CircleHelp, QrCode, LayoutDashboard, LogOut } from 'lucide-react'
import { Brand, Button } from './UI.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { firebaseErrorMessage } from '../lib/firebaseErrors.js'

const navItems = [['Home', '/'], ['QR Generator', '/generator'], ['Features', null]]

export function SiteLayout() {
  const { currentUser, loading: authLoading, logout, profileSetupPending, profileError } = useAuth()
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const featureNavigation = useRef(false)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    setOpen(false)
    setAccountOpen(false)
    if (featureNavigation.current) { featureNavigation.current = false; return }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [location.pathname])
  const goToFeatures = (event) => {
    event.preventDefault()
    setOpen(false)
    if (location.pathname !== '/') {
      featureNavigation.current = true
      navigate('/')
      window.setTimeout(() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }), 50)
    } else document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => {
    const show = (event) => { setNotice(event.detail); window.setTimeout(() => setNotice(''), 3600) }
    window.addEventListener('qriovo-placeholder', show)
    return () => window.removeEventListener('qriovo-placeholder', show)
  }, [])
  const isApp = location.pathname.startsWith('/dashboard')
  const handleLogout = async () => {
    try {
      await logout()
      setNotice('You are signed out.')
      navigate('/', { replace: true })
    } catch (error) { setNotice(firebaseErrorMessage(error, 'We could not sign you out. Please try again.')) }
  }
  const userName = currentUser?.displayName?.trim() || currentUser?.email || 'Account'
  const userInitial = userName.slice(0, 1).toUpperCase()

  return <div className="app-shell">
    {!isApp && <header className="site-header"><div className="header-inner"><Brand /><nav className={`main-nav ${open ? 'nav-open' : ''}`} aria-label="Main navigation">{navItems.map(([label, to]) => to ? <NavLink key={label} to={to} end={to === '/'} onClick={() => setOpen(false)}>{label}</NavLink> : <a key={label} href="#features" onClick={goToFeatures}>{label}</a>)}<div className="mobile-nav-actions">{authLoading ? <span className="account-checking">Checking account…</span> : currentUser ? <><NavLink to="/dashboard" onClick={() => setOpen(false)}>Dashboard</NavLink><Button to="/generator" onClick={() => setOpen(false)}><QrCode size={16} /> Create QR</Button><button type="button" className="mobile-logout" onClick={handleLogout}><LogOut size={15} /> Log out</button></> : <><NavLink to="/login" onClick={() => setOpen(false)}>Log in</NavLink><Button to="/register" onClick={() => setOpen(false)}>Get started <ArrowUpRight size={16} /></Button></>}<a className="coffee-link" href="https://buymeacoffee.com/devxaditya" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}><Coffee size={16} /> Buy me a coffee <ArrowUpRight size={14} /></a></div></nav><div className="header-actions">{authLoading ? <span className="account-checking">Checking account…</span> : currentUser ? <><Link className="header-login" to="/dashboard"><LayoutDashboard size={15} /> Dashboard</Link><Button to="/generator" className="header-cta"><QrCode size={15} /> Create QR</Button><div className={`account-menu ${accountOpen ? 'account-menu-open' : ''}`}><button className="account-menu-trigger" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((state) => !state)}><span>{userInitial}</span></button>{accountOpen && <div className="account-menu-panel"><div className="account-menu-identity"><strong>{userName}</strong><small>{currentUser.email}</small></div><Link to="/dashboard" onClick={() => setAccountOpen(false)}><LayoutDashboard size={15} /> Dashboard</Link><Link to="/generator" onClick={() => setAccountOpen(false)}><QrCode size={15} /> Create QR</Link><button type="button" onClick={handleLogout}><LogOut size={15} /> Log out</button></div>}</div></> : <><Link className="header-login" to="/login">Log in</Link><Button to="/register" className="header-cta">Get started <ArrowUpRight size={16} /></Button></>}<a className="coffee-link header-coffee" href="https://buymeacoffee.com/devxaditya" target="_blank" rel="noopener noreferrer" aria-label="Buy me a coffee (opens in a new tab)"><Coffee size={16} /><span>Buy me a coffee</span></a></div><button className="menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div></header>}
    {profileSetupPending && <div className="profile-setup-banner"><CircleHelp size={16} /><span>{profileError || 'Your account profile needs attention.'}</span><Link to="/register">Retry profile setup <ArrowUpRight size={14} /></Link></div>}
    <div className="site-main"><Outlet /></div>
    {!isApp && <Footer onFeatures={goToFeatures} />}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>
}

function Footer({ onFeatures }) {
  return <footer className="site-footer"><div className="footer-top container"><div className="footer-brand"><Brand light /><p>Beautiful QR codes, thoughtfully made.<br />Create. Customize. Manage.</p><div className="social-links"><a href="https://www.instagram.com/" aria-label="Instagram"><Instagram size={17} /></a><a href="https://www.linkedin.com/" aria-label="LinkedIn"><Linkedin size={17} /></a></div><a className="coffee-link footer-coffee" href="https://buymeacoffee.com/devxaditya" target="_blank" rel="noopener noreferrer"><Coffee size={16} /> Buy me a coffee <ArrowUpRight size={14} /></a></div><div className="footer-links"><div><strong>Explore</strong><Link to="/generator">QR Generator</Link><a href="#features" onClick={onFeatures}>Features</a><Link to="/about">About Qriovo</Link></div><div><strong>Account</strong><Link to="/login">Log in</Link><Link to="/register">Create an account</Link><Link to="/dashboard">Dashboard</Link></div><div><strong>Support</strong><Link to="/contact">Contact</Link><Link to="/privacy-policy">Privacy policy</Link><Link to="/terms-and-conditions">Terms &amp; conditions</Link></div></div></div><div className="footer-bottom container"><span>© {new Date().getFullYear()} Qriovo. Made for the moments that matter.</span><span className="footer-status"><i /> Free to create, always</span></div></footer>
}
