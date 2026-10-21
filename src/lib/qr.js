import QRCodeStyling from 'qr-code-styling'

export const QR_TYPES = ['Website', 'Text', 'Wi-Fi', 'WhatsApp', 'Email', 'SMS', 'Phone', 'Contact', 'UPI Payment', 'Location']

export const FIELDS_BY_TYPE = {
  Website: [{ key: 'url', label: 'Website URL', placeholder: 'https://yourwebsite.com', required: true, type: 'url' }],
  Text: [{ key: 'text', label: 'Your message', placeholder: 'Type something worth sharing…', required: true, textarea: true }],
  'Wi-Fi': [
    { key: 'ssid', label: 'Network name (SSID)', placeholder: 'Your network name', required: true },
    { key: 'security', label: 'Security', select: ['WPA', 'WEP', 'None'] },
    { key: 'password', label: 'Password', placeholder: 'Enter your Wi-Fi password', conditional: (values) => values.security !== 'None' },
    { key: 'hidden', label: 'Hidden network', checkbox: true },
  ],
  WhatsApp: [
    { key: 'phone', label: 'Phone number', placeholder: '+1 555 000 0000', required: true, type: 'tel' },
    { key: 'message', label: 'Prefilled message', placeholder: 'Hello! I found you on Qriovo.', textarea: true },
  ],
  Email: [
    { key: 'email', label: 'Email address', placeholder: 'hello@example.com', required: true, type: 'email' },
    { key: 'subject', label: 'Subject', placeholder: 'A quick note' },
    { key: 'message', label: 'Message', placeholder: 'Write a message…', textarea: true },
  ],
  SMS: [
    { key: 'phone', label: 'Phone number', placeholder: '+1 555 000 0000', required: true, type: 'tel' },
    { key: 'message', label: 'Message', placeholder: 'Write a text message…', textarea: true },
  ],
  Phone: [{ key: 'phone', label: 'Phone number', placeholder: '+1 555 000 0000', required: true, type: 'tel' }],
  Contact: [
    { key: 'name', label: 'Full name', placeholder: 'Alex Morgan', required: true },
    { key: 'organization', label: 'Organization', placeholder: 'Studio name' },
    { key: 'phone', label: 'Phone number', placeholder: '+1 555 000 0000', type: 'tel' },
    { key: 'email', label: 'Email address', placeholder: 'alex@example.com', type: 'email' },
    { key: 'website', label: 'Website', placeholder: 'https://example.com', type: 'url' },
  ],
  'UPI Payment': [
    { key: 'upiId', label: 'UPI ID', placeholder: 'name@bank', required: true },
    { key: 'payee', label: 'Payee name', placeholder: 'Your name' },
    { key: 'amount', label: 'Amount (INR)', placeholder: '250.00', type: 'number' },
    { key: 'note', label: 'Payment note', placeholder: 'What is this payment for?' },
  ],
  Location: [
    { key: 'latitude', label: 'Latitude', placeholder: '37.7749', required: true, type: 'number' },
    { key: 'longitude', label: 'Longitude', placeholder: '-122.4194', required: true, type: 'number' },
  ],
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phoneDigits = (value) => String(value || '').replace(/\D/g, '')
const escapeWifi = (value = '') => String(value).replace(/([\\;,:"'])/g, '\\$1')
const escapeVCard = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

export function validateQrValues(type, values) {
  const errors = {}
  const required = (key, label) => { if (!String(values[key] || '').trim()) errors[key] = `${label} is required.` }
  const validateEmail = (key) => { if (values[key] && !emailPattern.test(values[key].trim())) errors[key] = 'Enter a valid email address.' }
  const validateUrl = (key) => {
    if (!values[key]) return
    try {
      const url = new URL(values[key].trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch { errors[key] = 'Enter a complete URL starting with http:// or https://.' }
  }
  const validatePhone = (key) => {
    if (!values[key]) return
    const digits = phoneDigits(values[key])
    if (digits.length < 7 || digits.length > 15) errors[key] = 'Enter a phone number with 7–15 digits.'
  }
  const fields = FIELDS_BY_TYPE[type] || []
  fields.filter((field) => field.required && (!field.conditional || field.conditional(values))).forEach((field) => required(field.key, field.label))
  if (type === 'Website') validateUrl('url')
  if (type === 'Wi-Fi' && values.security !== 'None') required('password', 'Password')
  if (type === 'Email' || type === 'Contact') validateEmail('email')
  if (type === 'Contact') validateUrl('website')
  if (['Phone', 'SMS', 'WhatsApp', 'Contact'].includes(type)) validatePhone('phone')
  if (type === 'UPI Payment' && values.upiId && !/^[\w.\-]+@[\w.-]+$/.test(values.upiId.trim())) errors.upiId = 'Enter a valid UPI ID, such as name@bank.'
  if (type === 'UPI Payment' && values.amount && (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0)) errors.amount = 'Enter an amount greater than zero.'
  if (type === 'Location') {
    if (values.latitude && (!Number.isFinite(Number(values.latitude)) || Number(values.latitude) < -90 || Number(values.latitude) > 90)) errors.latitude = 'Latitude must be between −90 and 90.'
    if (values.longitude && (!Number.isFinite(Number(values.longitude)) || Number(values.longitude) < -180 || Number(values.longitude) > 180)) errors.longitude = 'Longitude must be between −180 and 180.'
  }
  return errors
}

export function buildQrPayload(type, values) {
  const value = (key) => String(values[key] || '').trim()
  switch (type) {
    case 'Website': return value('url')
    case 'Text': return value('text')
    case 'Wi-Fi': return `WIFI:T:${values.security === 'None' ? 'nopass' : values.security};S:${escapeWifi(value('ssid'))};P:${values.security === 'None' ? '' : escapeWifi(value('password'))};H:${values.hidden ? 'true' : 'false'};;`
    case 'WhatsApp': {
      const params = new URLSearchParams()
      if (value('message')) params.set('text', value('message'))
      return `https://wa.me/${phoneDigits(value('phone'))}${params.size ? `?${params.toString()}` : ''}`
    }
    case 'Email': {
      const params = new URLSearchParams()
      if (value('subject')) params.set('subject', value('subject'))
      if (value('message')) params.set('body', value('message'))
      return `mailto:${value('email')}${params.size ? `?${params.toString()}` : ''}`
    }
    case 'SMS': return `SMSTO:${value('phone')}:${value('message')}`
    case 'Phone': return `tel:${value('phone')}`
    case 'Contact': {
      const rows = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(value('name'))}`]
      if (value('organization')) rows.push(`ORG:${escapeVCard(value('organization'))}`)
      if (value('phone')) rows.push(`TEL;TYPE=CELL:${escapeVCard(value('phone'))}`)
      if (value('email')) rows.push(`EMAIL:${escapeVCard(value('email'))}`)
      if (value('website')) rows.push(`URL:${escapeVCard(value('website'))}`)
      rows.push('END:VCARD')
      return rows.join('\r\n')
    }
    case 'UPI Payment': {
      const params = new URLSearchParams({ pa: value('upiId'), cu: 'INR' })
      if (value('payee')) params.set('pn', value('payee'))
      if (value('amount')) params.set('am', Number(value('amount')).toFixed(2))
      if (value('note')) params.set('tn', value('note'))
      return `upi://pay?${params.toString()}`
    }
    case 'Location': return `geo:${value('latitude')},${value('longitude')}`
    default: return ''
  }
}

export function sanitizeFilename(name) {
  return String(name || 'qriovo-qr-code').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 64) || 'qriovo-qr-code'
}

export function qrOptions({ data, size = 512, foreground = '#17251C', background = '#FFFFFF', pattern = 'rounded', cornerSquare = 'extra-rounded', cornerDot = 'dot', margin = 16, errorCorrection = 'Q', gradient = false, image, logoSize = 0.22 }) {
  const type = ({ Classic: 'square', Rounded: 'rounded', Dots: 'dots', Classy: 'classy', 'Soft dots': 'dots', Squares: 'square' })[pattern] || pattern || 'rounded'
  const dotsOptions = gradient
    ? { type, gradient: { type: 'linear', rotation: 45, colorStops: [{ offset: 0, color: foreground }, { offset: 1, color: '#426B39' }] } }
    : { type, color: foreground }
  return {
    type: 'svg', width: size, height: size, margin, data,
    qrOptions: { errorCorrectionLevel: image ? 'H' : errorCorrection },
    dotsOptions,
    cornersSquareOptions: { type: cornerSquare, color: foreground },
    cornersDotOptions: { type: cornerDot, color: foreground },
    backgroundOptions: { color: background },
    ...(image ? { image, imageOptions: { hideBackgroundDots: true, imageSize: logoSize, margin: 4, crossOrigin: 'anonymous' } } : {}),
  }
}

export async function downloadQr({ data, name, extension = 'png', ...options }) {
  const qrCode = new QRCodeStyling(qrOptions({ data, ...options }))
  await qrCode.download({ name: sanitizeFilename(name), extension })
}
