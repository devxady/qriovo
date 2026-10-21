import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CircleHelp, Download, Pencil, QrCode, RotateCcw, Save, Sparkles } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { QRCodePreview } from '../components/QRCodePreview.jsx'
import { Button, Eyebrow } from '../components/UI.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { buildQrPayload, downloadQr, FIELDS_BY_TYPE, qrOptions, validateQrValues } from '../lib/qr.js'
import { firebaseErrorMessage } from '../lib/firebaseErrors.js'
import { getUserQrCode, updateQrCode } from '../lib/qrService.js'
import { NotFoundPage } from './NotFoundPage.jsx'

const initialDesign = { foreground: '#17251C', background: '#FFFFFF', pattern: 'rounded', cornerSquare: 'extra-rounded', cornerDot: 'dot', size: 512, margin: 16, errorCorrection: 'Q', gradient: false }
const control = (values, key) => values[key] ?? ''

export function EditQrPage() {
  const { id } = useParams()
  const { currentUser } = useAuth()
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [values, setValues] = useState({})
  const [design, setDesign] = useState(initialDesign)
  const [size, setSize] = useState(512)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setRecord(null)
    setLoadError('')
    getUserQrCode(currentUser.uid, id).then((next) => {
      if (!active) return
      setRecord(next)
      setName(next.name)
      setValues(next.values || {})
      setDesign({ ...initialDesign, ...next.design })
      setSize(next.design?.size || 512)
    }).catch((error) => {
      if (!active) return
      if (error?.code === 'not-found') setLoadError('This QR code could not be found in your account.')
      else setLoadError(firebaseErrorMessage(error, 'This QR code could not be loaded.'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [currentUser.uid, id])

  const fields = record ? FIELDS_BY_TYPE[record.type] || [] : []
  const payloadErrors = record ? validateQrValues(record.type, values) : {}
  const payload = useMemo(() => record && !Object.keys(payloadErrors).length ? buildQrPayload(record.type, values) : '', [record, payloadErrors, values])
  const options = useMemo(() => qrOptions({ ...design, size, data: payload }), [design, size, payload])
  const updateValue = (key, value) => {
    const next = { ...values, [key]: value }
    setValues(next)
    setErrors(validateQrValues(record.type, next))
    setNotice('')
    setSaved(false)
  }
  const updateDesign = (key, value) => { setDesign((current) => ({ ...current, [key]: value })); setSaved(false) }
  const reset = () => {
    setName(record.name)
    setValues({ ...record.values })
    setDesign({ ...initialDesign, ...record.design })
    setSize(record.design?.size || 512)
    setErrors({})
    setNotice('Your fields were reset to the last saved version.')
    setSaved(false)
  }
  const save = async (event) => {
    event.preventDefault()
    const nextErrors = validateQrValues(record.type, values)
    if (!name.trim()) nextErrors.name = 'Add a name for this QR code.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    setNotice('')
    try {
      const nextDesign = { ...design, size }
      await updateQrCode(currentUser.uid, id, { name, type: record.type, values, design: nextDesign })
      setRecord((current) => ({ ...current, name: name.trim(), values, payload, design: nextDesign }))
      setSaved(true)
      setNotice('Your QR code was updated. Its creation date and account ownership were preserved.')
    } catch (error) { setNotice(firebaseErrorMessage(error, 'Your changes could not be saved. Please try again.')) }
    finally { setBusy(false) }
  }
  const download = async (extension) => {
    setDownloadBusy(extension)
    try {
      await downloadQr({ data: payload, name, extension, ...design, size })
      setNotice(`${extension.toUpperCase()} download started.`)
    } catch (error) { setNotice(firebaseErrorMessage(error, 'The QR file could not be prepared. Please try again.')) }
    finally { setDownloadBusy('') }
  }

  if (loading) return <main className="workspace-page"><div className="dashboard-loading" role="status"><span className="auth-loading-spinner" /> Loading your saved QR…</div></main>
  if (loadError) return loadError === 'This QR code could not be found in your account.' ? <NotFoundPage /> : <main className="workspace-page"><div className="container workspace-container"><div className="notice notice-error" role="alert"><CircleHelp size={17} />{loadError}</div><Button to="/dashboard">Back to dashboard</Button></div></main>
  if (!record) return <NotFoundPage />

  return <div className="workspace-page edit-page"><div className="container workspace-container"><div className="workspace-heading"><div><Link className="back-link" to="/dashboard"><ArrowLeft size={15} /> Back to dashboard</Link><Eyebrow>Your work, your way</Eyebrow><h1>Edit QR <em>code.</em></h1><p>Update the content or appearance of your saved QR code. The live preview follows your changes.</p></div><span className="workspace-step"><span>02</span> / 03 <span className="step-separator" /> EDIT</span></div>
    <div className="generator-layout edit-generator-layout"><form className="generator-panel edit-form-panel" onSubmit={save}><div className="generator-panel-head"><div><span className="panel-step">SAVED QR DETAILS</span><h2>Details &amp; design</h2><p>Changes are saved to your account when you choose Save.</p></div><span className="panel-head-icon"><Pencil size={19} /></span></div>
      <label className="field-wrap"><span>QR code name</span><input maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: '' })); setSaved(false) }} aria-invalid={Boolean(errors.name)} />{errors.name && <small className="field-error" role="alert">{errors.name}</small>}</label>
      <div className="field-wrap"><span>QR code type</span><div className="readonly-value"><QrCode size={17} />{record.type}<span>SAVED RECORD</span></div></div>
      <div className="generator-fields functional-fields edit-content-fields">{fields.map((field) => field.conditional && !field.conditional(values) ? null : <label className="field-wrap" key={field.key}><span>{field.label}{field.required && <b> *</b>}</span>{field.select ? <select value={control(values, field.key) || (field.key === 'security' ? 'WPA' : field.select[0])} onChange={(event) => updateValue(field.key, event.target.value)}>{field.select.map((option) => <option key={option}>{option}</option>)}</select> : field.checkbox ? <span className="checkbox-row"><input type="checkbox" checked={Boolean(values[field.key])} onChange={(event) => updateValue(field.key, event.target.checked)} /> Use a hidden network</span> : field.textarea ? <textarea value={control(values, field.key)} onChange={(event) => updateValue(field.key, event.target.value)} placeholder={field.placeholder} rows={3} aria-invalid={Boolean(errors[field.key])} /> : <input type={field.type || 'text'} value={control(values, field.key)} onChange={(event) => updateValue(field.key, event.target.value)} placeholder={field.placeholder} aria-invalid={Boolean(errors[field.key])} autoComplete="off" />}{errors[field.key] && <span className="field-error" role="alert">{errors[field.key]}</span>}</label>)}</div>
      <div className="edit-design-header"><span>DESIGN OPTIONS</span><button type="button" onClick={reset}><RotateCcw size={14} /> Reset changes</button></div>
      <label className="field-wrap"><span>Dot pattern</span><select value={design.pattern} onChange={(event) => updateDesign('pattern', event.target.value)}><option value="square">Square</option><option value="rounded">Rounded</option><option value="dots">Dots</option><option value="classy">Classy</option><option value="classy-rounded">Classy rounded</option><option value="extra-rounded">Extra rounded</option></select></label>
      <div className="control-pair functional-colors edit-colors"><label><span className="control-label-row"><span>Foreground</span><code>{design.foreground.toUpperCase()}</code></span><span className="color-picker"><input aria-label="Foreground color" type="color" value={design.foreground} onChange={(event) => updateDesign('foreground', event.target.value)} /><span className="color-swatch" /><span>QR modules</span></span></label><label><span className="control-label-row"><span>Background</span><code>{design.background.toUpperCase()}</code></span><span className="color-picker"><input aria-label="Background color" type="color" value={design.background} onChange={(event) => updateDesign('background', event.target.value)} /><span className="color-swatch swatch-white" /><span>Canvas</span></span></label></div>
      <label className="field-wrap"><span>Output size</span><select value={size} onChange={(event) => { setSize(Number(event.target.value)); setSaved(false) }}><option value={256}>256 × 256 px</option><option value={512}>512 × 512 px</option><option value={1024}>1024 × 1024 px</option></select></label>
      <label className="gradient-toggle"><input type="checkbox" checked={Boolean(design.gradient)} onChange={(event) => updateDesign('gradient', event.target.checked)} /><span><strong>Forest gradient</strong><small>Blend the foreground into the Qriovo accent</small></span></label>
      <div className="edit-note"><CircleHelp size={17} /><span>Changing a static QR code’s content creates a new QR pattern. Previously printed copies will still encode the old content.</span></div>
      <div className="edit-bottom-actions"><Button to="/dashboard" variant="secondary">Cancel</Button><Button type="submit" disabled={busy || saved}>{busy ? 'Saving…' : saved ? 'Saved' : <><Save size={16} /> Save changes</>}</Button></div>
      {notice && <div className={`notice ${notice.includes('could not') ? 'notice-error' : 'notice-info'}`} role={notice.includes('could not') ? 'alert' : 'status'}><CircleHelp size={17} />{notice}</div>}
    </form><aside className="preview-panel edit-preview-panel functional-preview-panel"><div className="preview-panel-head"><div><span className="panel-step">LIVE DESIGN PREVIEW</span><h2>{name || 'Your QR code'}</h2></div><span className="qr-type-chip">{record.type}</span></div><div className="preview-canvas"><span className="canvas-label">Q R I O V O&nbsp; / &nbsp;SAVED QR</span><div className="preview-glow" /><div className="real-qr-frame edit-real-qr-frame"><QRCodePreview data={payload} options={options} label={`${name} scannable QR preview`} /></div><div className="preview-caption"><strong>{design.pattern} · {design.foreground.toUpperCase()}</strong><span>{size} × {size} px</span></div></div><div className="preview-actions"><Button type="button" variant="dark" disabled={!payload || downloadBusy === 'png'} onClick={() => download('png')}><Download size={16} /> {downloadBusy === 'png' ? 'Preparing…' : 'Download PNG'}</Button><Button type="button" variant="secondary" disabled={!payload || downloadBusy === 'svg'} onClick={() => download('svg')}>{downloadBusy === 'svg' ? 'Preparing…' : 'Download SVG'}</Button></div><div className="preview-hint"><CircleHelp size={16} /><p><strong>Your saved QR</strong><br />Your code belongs to your signed-in account. This preview is regenerated from its saved content and design.</p></div><Button to="/generator" variant="secondary"><Sparkles size={15} /> Create another</Button></aside></div>
  </div></div>
}
