import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Check, CircleHelp, Eye, EyeOff, LockKeyhole, QrCode, Sparkles } from 'lucide-react'
import { Brand, Eyebrow } from '../components/UI.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { firebaseErrorMessage, isProfileSaveError } from '../lib/firebaseErrors.js'

export function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { configured, currentUser, login, register, resetPassword, profileSetupPending, profileError, profileName, retryProfileSetup } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', acceptTerms: false })

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setNotice('')
    setFormError('')
  }
  const targetAfterAuth = () => {
    const from = location.state?.from
    if (from?.pathname) return { pathname: from.pathname, state: from.state }
    if (location.state?.resumeQrSave) return { pathname: '/generator', state: { resumeQrSave: true } }
    return { pathname: '/dashboard' }
  }
  const validate = () => {
    const next = {}
    if (isRegister && !form.name.trim()) next.name = 'Enter your full name.'
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Enter a valid email address.'
    if (!resetMode && form.password.length < 8) next.password = 'Use at least 8 characters.'
    if (isRegister && form.password !== form.confirm) next.confirm = 'Passwords do not match.'
    if (isRegister && !form.acceptTerms) next.terms = 'Please accept the terms to continue.'
    setErrors(next)
    return Object.keys(next).length === 0
  }
  const submit = async (event) => {
    event.preventDefault()
    setNotice('')
    setFormError('')
    if (!validate()) return
    setSubmitting(true)
    try {
      if (resetMode) {
        await resetPassword(form.email)
        setNotice('If an account is associated with that email, a password reset link will be sent shortly.')
      } else if (isRegister) {
        await register(form.name, form.email, form.password)
        window.dispatchEvent(new CustomEvent('qriovo-placeholder', { detail: 'Your account is ready. Welcome to Qriovo.' }))
        navigate(targetAfterAuth(), { replace: true })
      } else {
        await login(form.email, form.password, rememberMe)
        window.dispatchEvent(new CustomEvent('qriovo-placeholder', { detail: 'You are signed in. Welcome back.' }))
        navigate(targetAfterAuth(), { replace: true })
      }
    } catch (error) {
      if (resetMode && ['auth/user-not-found', 'auth/invalid-email'].includes(error?.code)) {
        setNotice('If an account is associated with that email, a password reset link will be sent shortly.')
      } else if (isProfileSaveError(error)) {
        setFormError(firebaseErrorMessage(error))
      } else {
        setFormError(firebaseErrorMessage(error, 'We could not complete this request. Please try again.'))
      }
    } finally { setSubmitting(false) }
  }
  const retryProfile = async () => {
    setSubmitting(true)
    setFormError('')
    try {
      await retryProfileSetup(profileName || form.name)
      window.dispatchEvent(new CustomEvent('qriovo-placeholder', { detail: 'Your account profile is ready.' }))
      navigate('/dashboard', { replace: true })
    } catch (error) { setFormError(firebaseErrorMessage(error, 'Profile setup could not be completed. Please retry.')) }
    finally { setSubmitting(false) }
  }

  const heading = resetMode ? 'Reset your password.' : isRegister ? 'Make room for more.' : 'Welcome back.'
  const storyCopy = isRegister ? 'A home for your QR codes, whenever you are ready.' : 'Your saved codes are waiting in your Qriovo workspace.'

  return <div className="auth-page"><aside className="auth-story"><div className="auth-story-shape auth-shape-one" /><div className="auth-story-shape auth-shape-two" /><div className="auth-story-content"><Brand light /><span className="auth-story-kicker">A LITTLE MORE THOUGHT IN EVERY SCAN</span><h2>{isRegister ? <>Good ideas<br />deserve a place<br /><em>to live.</em></> : <>Your next<br />connection is<br /><em>one scan away.</em></>}</h2><p>{storyCopy}</p><div className="auth-story-qr"><MockQrMark /><span>CREATE. CUSTOMIZE. MANAGE.</span></div><div className="auth-story-footer"><span><Check size={14} /> Free to start</span><span><Check size={14} /> No card needed</span></div></div></aside><section className="auth-form-side"><Link className="auth-back" to="/"><ArrowLeft size={15} /> Back to Qriovo</Link><div className="auth-form-wrap"><div className="auth-mobile-brand"><Brand /></div><Eyebrow>{resetMode ? 'A fresh start, sent to your inbox' : isRegister ? 'Your ideas, all in one place' : 'A good idea brought you back'}</Eyebrow><h1>{heading}</h1><p className="auth-subtitle">{resetMode ? 'Enter your email and we’ll send a reset link if an account is associated with it.' : isRegister ? 'Create a free account to keep your QR codes close at hand.' : 'Sign in to manage your saved QR codes.'}</p>
      {!configured && <div className="notice notice-info auth-config-notice" role="status"><CircleHelp size={17} /><span>Account services are not configured in this build. Add the Firebase Web App values to the local <code>.env.local</code> file and restart the dev server.</span></div>}
      {profileSetupPending && <div className="notice notice-info auth-config-notice" role="status"><CircleHelp size={17} /><span>{profileError || 'Your profile setup needs attention.'} {currentUser?.email && <strong>{currentUser.email}</strong>}</span></div>}
      {profileSetupPending && <div className="profile-recovery-form">{!profileName && !currentUser?.displayName && <AuthField label="Full name" id="profile-recovery-name" type="text" placeholder="Alex Morgan" value={form.name} onChange={(value) => update('name', value)} error={errors.name} autoComplete="name" />}<button className="button button-primary auth-submit" type="button" disabled={submitting || !configured} onClick={retryProfile}>{submitting ? 'Finishing setup…' : 'Retry profile setup'} <ArrowUpRight size={16} /></button></div>}
      {!profileSetupPending && <form onSubmit={submit} noValidate className="auth-form">
        {isRegister && <AuthField label="Full name" id="auth-name" type="text" placeholder="Alex Morgan" value={form.name} onChange={(value) => update('name', value)} error={errors.name} autoComplete="name" />}
        <AuthField label="Email address" id="auth-email" type="email" placeholder="you@example.com" value={form.email} onChange={(value) => update('email', value)} error={errors.email} autoComplete="email" />
        {!resetMode && <AuthField label="Password" id="auth-password" type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" value={form.password} onChange={(value) => update('password', value)} error={errors.password} autoComplete={isRegister ? 'new-password' : 'current-password'} trailing={<button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>} />}
        {isRegister && <AuthField label="Confirm password" id="auth-confirm" type={showPassword ? 'text' : 'password'} placeholder="Enter your password again" value={form.confirm} onChange={(value) => update('confirm', value)} error={errors.confirm} autoComplete="new-password" />}
        {isRegister && <><label className="terms-accept"><input type="checkbox" checked={form.acceptTerms} onChange={(event) => update('acceptTerms', event.target.checked)} /><span>I agree to the <Link to="/terms-and-conditions">Terms &amp; Conditions</Link> and <Link to="/privacy-policy">Privacy Policy</Link>.</span></label>{errors.terms && <span className="field-error" role="alert">{errors.terms}</span>}<PasswordStrength password={form.password} /></>}
        {!isRegister && !resetMode && <div className="auth-form-meta"><label><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> <span>Keep me logged in</span></label><button type="button" onClick={() => { setResetMode(true); setErrors({}); setFormError(''); setNotice('') }}>Forgot password?</button></div>}
        {resetMode && <button type="button" className="auth-reset-back" onClick={() => { setResetMode(false); setFormError(''); setNotice('') }}><ArrowLeft size={14} /> Back to log in</button>}
        <button className="button button-primary auth-submit" type="submit" disabled={!configured || submitting}>{submitting ? (resetMode ? 'Sending…' : isRegister ? 'Creating account…' : 'Signing in…') : resetMode ? 'Send reset link' : isRegister ? 'Create free account' : 'Log in'} <ArrowUpRight size={16} /></button>
        {formError && <div className="notice notice-error" role="alert"><CircleHelp size={17} />{formError}</div>}
        {notice && <div className="notice notice-info" role="status"><CircleHelp size={17} />{notice}</div>}
      </form>}
      {!resetMode && !profileSetupPending && <><div className="auth-divider"><span /> <small>OR</small> <span /></div><p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Qriovo?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Log in' : 'Create a free account'} <ArrowUpRight size={14} /></Link></p></>}
      <div className="auth-privacy"><LockKeyhole size={14} /> {configured ? 'Your password is handled securely by Firebase Authentication.' : 'Account forms are disabled until Firebase is configured.'}</div></div><span className="auth-copyright">© {new Date().getFullYear()} Qriovo. Made with a little care.</span></section></div>
}

function PasswordStrength({ password }) {
  const score = password ? [password.length >= 8, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length : 0
  const label = !password ? 'Use 8+ characters. A mix of letters, numbers, and symbols is stronger.' : score <= 1 ? 'Password strength: getting started' : score <= 3 ? 'Password strength: good' : 'Password strength: strong'
  return <div className="password-strength" aria-live="polite"><span className={`strength-bars strength-${score}`}>{[1, 2, 3, 4].map((part) => <i key={part} />)}</span><small>{label}</small></div>
}

function AuthField({ label, id, type, placeholder, value, onChange, error, autoComplete, trailing }) {
  return <label className="field-wrap auth-field"><span>{label}</span><span className={`auth-input-wrap ${error ? 'has-error' : ''}`}><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />{trailing}</span>{error && <span className="field-error" id={`${id}-error`} role="alert">{error}</span>}</label>
}

function MockQrMark() {
  return <span className="auth-qr-mark"><QrCode size={43} strokeWidth={1.6} /><span className="auth-qr-spark"><Sparkles size={13} /></span></span>
}
