import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Copy, Download, ImagePlus, LockKeyhole, QrCode, RotateCcw, Sparkles, Upload, X, UserPlus, LogIn } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { QRCodePreview } from '../components/QRCodePreview.jsx'
import { Button, Eyebrow } from '../components/UI.jsx'
import { buildQrPayload, downloadQr, FIELDS_BY_TYPE, qrOptions, QR_TYPES, sanitizeFilename, validateQrValues } from '../lib/qr.js'
import { useAuth } from '../context/AuthContext.jsx'
import { createQrCode, getUserQrQuota, MAX_SAVED_QR_CODES } from '../lib/qrService.js'
import { firebaseErrorMessage } from '../lib/firebaseErrors.js'

const initialStyles = { foreground: '#17251C', background: '#FFFFFF', pattern: 'rounded', cornerSquare: 'extra-rounded', cornerDot: 'dot', size: 512, margin: 16, errorCorrection: 'Q', gradient: false, logoSize: 0.22 }
const initialValues = { 'Wi-Fi': { security: 'WPA', hidden: false } }
const control = (values, key) => values[key] ?? ''

export function GeneratorPage() {
  const { currentUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [type, setType] = useState('Website')
  const [valuesByType, setValuesByType] = useState(initialValues)
  const [styles, setStyles] = useState(initialStyles)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({})
  const [logo, setLogo] = useState('')
  const [logoName, setLogoName] = useState('')
  const [fileName, setFileName] = useState('qriovo-website')
  const [extension, setExtension] = useState('png')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [savePrompt, setSavePrompt] = useState(false)
  const [saveDialog, setSaveDialog] = useState(false)
  const [saveComplete, setSaveComplete] = useState(false)
  const [qrName, setQrName] = useState('')
  const [saveError, setSaveError] = useState('')
  const [quotaInfo, setQuotaInfo] = useState({ loading: false, ready: false, count: null, error: false })
  const logoInput = useRef(null)
  const values = valuesByType[type] || {}
  const fields = FIELDS_BY_TYPE[type]
  const payloadErrors = validateQrValues(type, values)
  const payload = useMemo(() => Object.keys(payloadErrors).length ? '' : buildQrPayload(type, values), [payloadErrors, type, values])
  const byteLength = payload ? new TextEncoder().encode(payload).length : 0
  const maxBytes = logo ? 1180 : ({ L: 2800, M: 2200, Q: 1550, H: 1180 }[styles.errorCorrection] || 1550)
  const previewWarning = byteLength > maxBytes ? 'This content is too long for the selected error-correction level. Shorten it or choose a lower level.' : ''
  const contrastWarning = payload && colorContrast(styles.foreground, styles.background) < 3 ? 'These colors have low contrast and may be difficult to scan. Choose a darker foreground or lighter background.' : ''
  const codeOptions = useMemo(() => qrOptions({ ...styles, data: payload, image: logo }), [styles, logo, payload])

  useEffect(() => {
    if (!location.state?.resumeQrSave) return
    try {
      const saved = JSON.parse(sessionStorage.getItem('qriovo-pending-qr-draft-v1') || 'null')
      if (saved && QR_TYPES.includes(saved.type)) {
        setType(saved.type)
        setValuesByType(saved.valuesByType || {})
        setStyles({ ...initialStyles, ...saved.styles, logoSize: Number(saved.styles?.logoSize) || initialStyles.logoSize })
        setFileName(saved.name || 'qriovo-qr-code')
        setQrName((saved.name || 'qriovo-qr-code').replace(/-/g, ' '))
        setLogo('')
        setLogoName('')
        setSaveDialog(true)
        setNotice('Your QR draft was restored after sign-in. Uploads are temporary and were not included.')
        sessionStorage.removeItem('qriovo-pending-qr-draft-v1')
      }
    } catch { setNotice('Your QR draft could not be restored. Please check the details again.') }
    navigate('/generator', { replace: true, state: null })
  }, [location.state, navigate])

  useEffect(() => {
    let active = true
    if (!currentUser) { setQuotaInfo({ loading: false, ready: false, count: null, error: false }); return () => { active = false } }
    setQuotaInfo({ loading: true, ready: false, count: null, error: false })
    getUserQrQuota(currentUser.uid)
      .then((quota) => { if (active) setQuotaInfo({ loading: false, ...quota, error: false }) })
      .catch(() => { if (active) setQuotaInfo({ loading: false, ready: false, count: null, error: true }) })
    return () => { active = false }
  }, [currentUser?.uid])

  const updateValue = (key, value) => {
    const nextValues = { ...values, [key]: value }
    setValuesByType((current) => ({ ...current, [type]: nextValues }))
    if (submitted) setErrors(validateQrValues(type, nextValues))
    setNotice('')
  }
  const updateStyle = (key, value) => setStyles((current) => ({ ...current, [key]: value }))
  const submit = (event) => {
    event.preventDefault()
    const nextErrors = validateQrValues(type, values)
    setErrors(nextErrors)
    setSubmitted(true)
    if (Object.keys(nextErrors).length) {
      setNotice('Check the highlighted fields to create your QR code.')
      return
    }
    setNotice('Your scannable QR code is ready. It has not been saved to an account.')
  }
  const changeType = (nextType) => {
    setType(nextType)
    setValuesByType((current) => ({ ...current, [nextType]: current[nextType] || (nextType === 'Wi-Fi' ? { security: 'WPA', hidden: false } : {}) }))
    setErrors({})
    setSubmitted(false)
    setNotice('')
    setFileName(`qriovo-${nextType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }
  const resetStyles = () => {
    setStyles(initialStyles)
    setLogo('')
    setLogoName('')
    if (logoInput.current) logoInput.current.value = ''
    setNotice('Design settings reset to the Qriovo defaults.')
  }
  const addLogo = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setNotice('Choose a PNG, JPG, or WebP image for the center logo.')
      event.target.value = ''
      return
    }
    if (file.size > 1_500_000) {
      setNotice('Logo files must be smaller than 1.5 MB.')
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => { setLogo(String(reader.result)); setLogoName(file.name); setStyles((current) => ({ ...current, errorCorrection: 'H' })); setNotice('Logo added. Error correction is set to High for safer scanning.') }
    reader.onerror = () => setNotice('This image could not be read. Please try another file.')
    reader.readAsDataURL(file)
  }
  const download = async () => {
    if (!payload) { setSubmitted(true); setErrors(validateQrValues(type, values)); setNotice('Add valid details before downloading.'); return }
    if (previewWarning) { setNotice(previewWarning); return }
    setBusy(true); setNotice('')
    try {
      await downloadQr({ data: payload, name: sanitizeFilename(fileName), extension, ...styles, image: logo })
      setNotice(`${extension.toUpperCase()} download started. Keep a copy; guest QR codes are not saved.`)
    } catch (error) {
      console.error('QR download failed', error)
      setNotice('The QR file could not be prepared. Check the logo and content, then try again.')
    } finally { setBusy(false) }
  }
  const copyPayload = async () => {
    if (!payload) return
    try { await navigator.clipboard.writeText(payload); setNotice('Encoded content copied to your clipboard.') }
    catch { setNotice('Clipboard access is unavailable in this browser. You can select the encoded content below.') }
  }
  const saveDraftForAuth = () => {
    try {
      sessionStorage.setItem('qriovo-pending-qr-draft-v1', JSON.stringify({ type, valuesByType, styles, name: fileName }))
    } catch { setNotice('This browser could not keep a temporary draft. Copy your content before continuing.') }
  }
  const openSave = () => {
    if (!payload || previewWarning) {
      setSubmitted(true)
      setErrors(validateQrValues(type, values))
      setNotice(previewWarning || 'Add valid details before saving.')
      return
    }
    if (currentUser && !quotaInfo.ready) {
      setNotice('Your account storage counter is not available yet. QR saving will work after the one-time administrator migration. You can still create and download this QR locally.')
      return
    }
    if (currentUser && quotaInfo.count >= MAX_SAVED_QR_CODES) {
      setNotice('You have reached the limit of 25 saved QR codes. Remove one from your dashboard to create a slot; local creation and downloads remain available.')
      return
    }
    setQrName(fileName.replace(/-/g, ' ').trim() || 'My QR code')
    setSaveError('')
    if (currentUser) setSaveDialog(true)
    else setSavePrompt(true)
  }
  const continueToAuth = (path) => {
    saveDraftForAuth()
    navigate(path, { state: { from: { pathname: '/generator', state: { resumeQrSave: true } } } })
  }
  const saveToAccount = async (event) => {
    event.preventDefault()
    if (!currentUser || !payload || previewWarning) return
    setSaveBusy(true)
    setSaveError('')
    try {
      await createQrCode(currentUser.uid, { name: qrName, type, values, design: styles })
      setQuotaInfo((quota) => quota.ready ? { ...quota, count: quota.count + 1, remaining: Math.max(0, quota.remaining - 1) } : quota)
      try { sessionStorage.removeItem('qriovo-pending-qr-draft-v1') } catch { /* Storage is optional. */ }
      setSaveDialog(false)
      setSaveComplete(true)
    } catch (error) {
      setSaveError(firebaseErrorMessage(error, 'We could not save this QR code. Please try again.'))
    } finally { setSaveBusy(false) }
  }

  return <div className="workspace-page"><div className="container workspace-container">
    <div className="workspace-heading"><div><Link className="back-link" to="/"><ArrowLeft size={15} /> Back to home</Link><Eyebrow>Make something worth scanning</Eyebrow><h1>QR code <em>studio.</em></h1><p>Create a scannable code in your browser, then style and download it. No account required.</p></div><span className="workspace-step"><span>01</span> / 03 <span className="step-separator" /> CREATE</span></div>
    <div className="generator-layout"><form className="generator-panel functional-generator" onSubmit={submit} noValidate>
      <div className="generator-panel-head"><div><span className="panel-step">STEP 01</span><h2>What are we sharing?</h2><p>Choose a format and enter the details to encode.</p></div><span className="panel-head-icon"><QrCode size={20} /></span></div>
      <div className="qr-type-tabs functional-type-tabs" role="tablist" aria-label="QR code type">{QR_TYPES.map((item) => <button key={item} type="button" role="tab" aria-selected={type === item} className={type === item ? 'active' : ''} onClick={() => changeType(item)}>{item}</button>)}</div>
      <div className="generator-fields functional-fields">{fields.map((field) => field.conditional && !field.conditional(values) ? null : <label className="field-wrap" key={field.key}>
        <span>{field.label}{field.required && <b> *</b>}</span>
        {field.select ? <span className="select-wrap"><select value={control(values, field.key) || (field.key === 'security' ? 'WPA' : field.select[0])} onChange={(event) => updateValue(field.key, event.target.value)} aria-label={field.label}>{field.select.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={16} /></span>
          : field.checkbox ? <span className="checkbox-row"><input type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => updateValue(field.key, event.target.checked)} /> Use a hidden network</span>
            : field.textarea ? <textarea value={control(values, field.key)} onChange={(event) => updateValue(field.key, event.target.value)} placeholder={field.placeholder} rows={3} aria-invalid={Boolean(errors[field.key])} />
              : <input type={field.type || 'text'} value={control(values, field.key)} onChange={(event) => updateValue(field.key, event.target.value)} placeholder={field.placeholder} aria-invalid={Boolean(errors[field.key])} autoComplete="off" />}
        {errors[field.key] && <span className="field-error" role="alert">{errors[field.key]}</span>}
      </label>)}</div>
      <div className="customize-controls"><div className="accordion-toggle functional-style-heading"><span className="accordion-title"><span className="accordion-icon"><Sparkles size={17} /></span><span><strong>Make it yours</strong><small>Live design controls</small></span></span><button type="button" className="reset-design-button" onClick={resetStyles}><RotateCcw size={14} /> Reset</button></div>
        <div className="style-controls functional-style-controls">
          <div className="functional-control-grid">
            <label className="field-wrap"><span>Dot pattern</span><select value={styles.pattern} onChange={(event) => updateStyle('pattern', event.target.value)}><option value="square">Square</option><option value="rounded">Rounded</option><option value="dots">Dots</option><option value="classy">Classy</option><option value="classy-rounded">Classy rounded</option><option value="extra-rounded">Extra rounded</option></select></label>
            <label className="field-wrap"><span>Finder corners</span><select value={styles.cornerSquare} onChange={(event) => updateStyle('cornerSquare', event.target.value)}><option value="extra-rounded">Extra rounded</option><option value="square">Square</option><option value="dot">Dot</option><option value="rounded">Rounded</option><option value="classy">Classy</option></select></label>
          </div>
          <div className="control-pair functional-colors"><label><span className="control-label-row"><span>Foreground</span><code>{styles.foreground.toUpperCase()}</code></span><span className="color-picker"><input aria-label="Foreground color" type="color" value={styles.foreground} onChange={(event) => updateStyle('foreground', event.target.value)} /><span className="color-swatch" /><span>QR modules</span></span></label><label><span className="control-label-row"><span>Background</span><code>{styles.background.toUpperCase()}</code></span><span className="color-picker"><input aria-label="Background color" type="color" value={styles.background} onChange={(event) => updateStyle('background', event.target.value)} /><span className="color-swatch swatch-white" /><span>Canvas</span></span></label></div>
          <label className="gradient-toggle"><input type="checkbox" checked={styles.gradient} onChange={(event) => updateStyle('gradient', event.target.checked)} /><span><strong>Forest gradient</strong><small>Blend your foreground into the Qriovo accent</small></span></label>
          <div className="functional-control-grid"><label className="field-wrap"><span>Output size</span><select value={styles.size} onChange={(event) => updateStyle('size', Number(event.target.value))}><option value={256}>256 × 256 px</option><option value={512}>512 × 512 px</option><option value={1024}>1024 × 1024 px</option></select></label><label className="field-wrap"><span>Quiet zone</span><select value={styles.margin} onChange={(event) => updateStyle('margin', Number(event.target.value))}><option value={0}>0 px</option><option value={8}>8 px</option><option value={16}>16 px</option><option value={32}>32 px</option></select></label></div>
          <label className="field-wrap"><span>Error correction</span><select value={styles.errorCorrection} disabled={Boolean(logo)} onChange={(event) => updateStyle('errorCorrection', event.target.value)}><option value="L">Low · 7%</option><option value="M">Medium · 15%</option><option value="Q">Quartile · 25%</option><option value="H">High · 30%</option></select>{logo && <small className="control-helper">High correction is used while a logo is present.</small>}</label>
          <div className="logo-control"><input ref={logoInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={addLogo} aria-label="Choose center logo" /><button className="upload-logo" type="button" onClick={() => logoInput.current?.click()}><ImagePlus size={18} /><span><strong>{logo ? 'Change center logo' : 'Add a center logo'}</strong><small>PNG, JPG, WebP · up to 1.5 MB</small></span><Upload size={15} /></button>{logo && <div className="logo-file-row"><span>{logoName} · {Math.round(styles.logoSize * 100)}%</span><button type="button" onClick={() => { setLogo(''); setLogoName('') }} aria-label="Remove logo"><X size={15} /></button></div>}{logo && <label className="field-wrap logo-size-control"><span>Logo size</span><input type="range" min="0.16" max="0.28" step="0.01" value={styles.logoSize} onChange={(event) => updateStyle('logoSize', Number(event.target.value))} /><small className="control-helper">Smaller logos leave more of the QR pattern visible.</small></label>}</div>
        </div>
      </div>
      <div className="generator-form-bottom functional-form-bottom"><Button type="submit">Create QR code <ArrowRight size={16} /></Button><span><LockKeyhole size={14} /> Generated locally in your browser</span></div>
      <Button type="button" variant="secondary" className="save-qr-trigger" disabled={!payload || Boolean(previewWarning) || Boolean(currentUser && quotaInfo.ready && quotaInfo.count >= MAX_SAVED_QR_CODES) || Boolean(currentUser && quotaInfo.loading)} onClick={openSave}><Check size={16} /> {currentUser && quotaInfo.ready ? `Save to dashboard · ${quotaInfo.count}/${MAX_SAVED_QR_CODES}` : currentUser ? 'Save to dashboard' : 'Save QR to your account'}</Button>
      {currentUser && quotaInfo.ready && quotaInfo.count >= 20 && quotaInfo.count < MAX_SAVED_QR_CODES && <div className="notice notice-info quota-generator-note" role="status"><CircleHelp size={16} /> You&apos;re approaching your free QR storage limit: {quotaInfo.count} of {MAX_SAVED_QR_CODES} saved.</div>}
      {currentUser && quotaInfo.ready && quotaInfo.count >= MAX_SAVED_QR_CODES && <div className="notice notice-info quota-generator-note" role="status"><CircleHelp size={16} /> You&apos;ve reached the 25-code storage limit. Existing QR codes remain editable and downloadable.</div>}
      {currentUser && !quotaInfo.loading && !quotaInfo.ready && <div className="notice notice-info quota-generator-note" role="status"><CircleHelp size={16} /> Account storage is not ready. Saved-code features need the one-time counter migration; local QR creation and downloads remain available.</div>}
      {notice && <div className={`notice ${errors && Object.keys(errors).length ? 'notice-info' : 'notice-info'}`} role="status"><CircleHelp size={17} />{notice}</div>}
    </form>
    <aside className="preview-column"><div className="preview-panel functional-preview-panel"><div className="preview-panel-head"><div><span className="panel-step">LIVE DESIGN</span><h2>{payload ? 'Ready to scan.' : 'Your QR, your way.'}</h2></div><span className="qr-type-chip">{type}</span></div><div className="preview-canvas"><span className="canvas-label">Q R I O V O&nbsp; / &nbsp;{payload ? 'LIVE QR' : 'PREVIEW'}</span><div className="preview-glow" /><div className="real-qr-frame"><QRCodePreview data={previewWarning ? '' : payload} options={codeOptions} /></div><div className="preview-caption"><strong>{payload ? 'Scannable QR code' : 'Add your details to begin'}</strong><span>{payload ? `${styles.size} × ${styles.size} px · ${byteLength} bytes` : 'The live code appears once details are valid.'}</span></div></div>
      {previewWarning && <div className="qr-warning" role="alert"><CircleHelp size={16} /> {previewWarning}</div>}
      {contrastWarning && <div className="qr-warning" role="alert"><CircleHelp size={16} /> {contrastWarning}</div>}
      {logo && payload && <div className="qr-warning"><CircleHelp size={16} /> Scan-test your logo design before printing. A logo can affect readability.</div>}
      <div className="download-controls"><label className="field-wrap"><span>File name</span><input value={fileName} onChange={(event) => setFileName(event.target.value)} onBlur={() => setFileName(sanitizeFilename(fileName))} /></label><div className="download-row"><label className="field-wrap"><span>Format</span><select value={extension} onChange={(event) => setExtension(event.target.value)}><option value="png">PNG</option><option value="svg">SVG</option></select></label><Button type="button" variant="dark" disabled={!payload || Boolean(previewWarning) || busy} onClick={download}><Download size={16} /> {busy ? 'Preparing…' : `Download ${extension.toUpperCase()}`}</Button></div><button type="button" className="copy-payload-button" disabled={!payload} onClick={copyPayload}><Copy size={15} /> Copy encoded content</button></div>
      <details className="encoded-content"><summary>View encoded content</summary><code>{payload || 'Your encoded content will appear here after the details are valid.'}</code></details>
      <div className="preview-hint"><CircleHelp size={16} /><p><strong>{currentUser ? 'Account connected' : 'Guest mode'}</strong><br />{currentUser ? 'Save this QR to your account for later editing and downloads.' : 'Your QR is generated on this device. Guest codes are not saved; sign in or register to save it.'}</p></div></div><div className="preview-side-note"><span className="side-note-symbol">✳</span><span><strong>Ready when you are</strong><small>QR content is generated in your browser. Nothing is uploaded until you choose Save.</small></span></div></aside></div>
    {savePrompt && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSavePrompt(false) }}><section className="confirm-modal save-qr-modal" role="dialog" aria-modal="true" aria-labelledby="save-required-title"><button className="modal-close" type="button" onClick={() => setSavePrompt(false)} aria-label="Close save options"><X size={19} /></button><span className="modal-icon"><LockKeyhole size={20} /></span><h2 id="save-required-title">Save this QR for later</h2><p>Your QR is ready, but saving codes requires a Qriovo account. Sign in or create a free account; your current editor details will be kept temporarily in this browser.</p><div className="save-auth-actions"><Button type="button" onClick={() => continueToAuth('/login')}><LogIn size={16} /> Log in</Button><Button type="button" variant="secondary" onClick={() => continueToAuth('/register')}><UserPlus size={16} /> Create account</Button></div></section></div>}
    {saveDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saveBusy) setSaveDialog(false) }}><form className="confirm-modal save-qr-modal" role="dialog" aria-modal="true" aria-labelledby="save-qr-title" onSubmit={saveToAccount}><button className="modal-close" type="button" onClick={() => setSaveDialog(false)} aria-label="Close save QR dialog"><X size={19} /></button><span className="modal-icon"><QrCode size={20} /></span><h2 id="save-qr-title">Save to your account</h2><p>Your {type} QR will be available in your dashboard for editing, duplication and downloads.</p><label className="field-wrap"><span>QR code name</span><input autoFocus maxLength={80} value={qrName} onChange={(event) => setQrName(event.target.value)} aria-invalid={!qrName.trim()} /></label>{logo && <div className="notice notice-info"><CircleHelp size={17} />Your uploaded logo is temporary and will not be saved. The saved QR will use its colors and pattern; you can upload the logo again after opening it.</div>}{saveError && <div className="notice notice-error" role="alert"><CircleHelp size={17} />{saveError}</div>}<div className="save-auth-actions"><Button type="button" variant="secondary" disabled={saveBusy} onClick={() => setSaveDialog(false)}>Keep editing</Button><Button type="submit" disabled={saveBusy || !qrName.trim()}>{saveBusy ? 'Saving…' : 'Save QR'} <Check size={16} /></Button></div></form></div>}
    {saveComplete && <div className="modal-backdrop" role="presentation"><section className="confirm-modal save-qr-modal" role="dialog" aria-modal="true" aria-labelledby="saved-qr-title"><span className="modal-icon"><Check size={20} /></span><h2 id="saved-qr-title">QR saved</h2><p><strong>{qrName}</strong> is now in your account. Its image can be regenerated from the saved content and design.</p><div className="save-auth-actions"><Button type="button" variant="secondary" onClick={() => setSaveComplete(false)}>Keep creating</Button><Button to="/dashboard" onClick={() => setSaveComplete(false)}>Open dashboard <ArrowRight size={16} /></Button></div></section></div>}
    <div className="generator-footnote"><span>CLIENT-SIDE QR GENERATION</span><span>No account or server required to create and download</span></div>
  </div></div>
}

function colorContrast(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.replace('#', '').match(/.{2}/g)?.map((channel) => parseInt(channel, 16) / 255) || [0, 0, 0]
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const a = luminance(foreground); const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
