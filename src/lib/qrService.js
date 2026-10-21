import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from '../config/firebase.js'
import { QR_TYPES, buildQrPayload, validateQrValues } from './qr.js'

export const MAX_SAVED_QR_CODES = 25
const MAX_SAVED_QR_CONTENT_LENGTH = 10_000

const patterns = ['square', 'rounded', 'dots', 'classy', 'classy-rounded', 'extra-rounded']
const cornerTypes = ['square', 'dot', 'rounded', 'classy', 'extra-rounded']
const corrections = ['L', 'M', 'Q', 'H']

function ensureDatabase() {
  if (!db) {
    const error = new Error('Firebase is not configured.')
    error.code = 'auth/configuration-not-ready'
    throw error
  }
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function cleanDesign(design = {}) {
  const color = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '') ? value.toUpperCase() : fallback
  const numeric = Number(design.size)
  const margin = Number(design.margin)
  return {
    foreground: color(design.foreground, '#17251C'),
    background: color(design.background, '#FFFFFF'),
    pattern: patterns.includes(design.pattern) ? design.pattern : 'rounded',
    cornerSquare: cornerTypes.includes(design.cornerSquare) ? design.cornerSquare : 'extra-rounded',
    cornerDot: cornerTypes.includes(design.cornerDot) ? design.cornerDot : 'dot',
    size: [256, 512, 1024].includes(numeric) ? numeric : 512,
    margin: Number.isFinite(margin) ? Math.min(32, Math.max(0, margin)) : 16,
    errorCorrection: corrections.includes(design.errorCorrection) ? design.errorCorrection : 'Q',
    gradient: Boolean(design.gradient),
  }
}

function serializeContent(type, values) {
  const errors = validateQrValues(type, values)
  if (Object.keys(errors).length) {
    const error = codedError('invalid-argument', 'QR input validation failed.')
    error.fieldErrors = errors
    throw error
  }
  const safeValues = Object.fromEntries(Object.entries(values || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null))
  const serialized = JSON.stringify({ values: safeValues, payload: buildQrPayload(type, safeValues) })
  if (serialized.length > MAX_SAVED_QR_CONTENT_LENGTH) {
    const error = codedError('invalid-argument', 'QR content is too long to save. Shorten the content to 10,000 characters or fewer.')
    error.fieldErrors = { content: error.message }
    throw error
  }
  return serialized
}

export function parseQrRecord(id, data) {
  let content
  try { content = JSON.parse(data.content) } catch { content = { payload: String(data.content || ''), values: {} } }
  const type = QR_TYPES.includes(data.type) ? data.type : 'Text'
  return {
    id,
    userId: data.userId,
    name: String(data.name || 'Untitled QR'),
    type,
    values: content?.values && typeof content.values === 'object' ? content.values : {},
    payload: typeof content?.payload === 'string' ? content.payload : String(data.content || ''),
    design: cleanDesign(data.design),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  }
}

function qrDocument(userId, { name, type, values, design }) {
  if (!userId) throw codedError('unauthenticated', 'A signed-in account is required.')
  if (!QR_TYPES.includes(type)) throw codedError('invalid-argument', 'Unsupported QR type.')
  const cleanName = String(name || '').trim().slice(0, 80)
  if (!cleanName) throw codedError('invalid-argument', 'Enter a name for this QR code.')
  return { userId, name: cleanName, type, content: serializeContent(type, values), design: cleanDesign(design) }
}

function statsRef(userId) { return doc(db, 'userStats', userId) }
function eventRef() { return doc(collection(db, 'activityEvents')) }

function ensureStats(snapshot) {
  if (!snapshot.exists()) throw codedError('failed-precondition', 'Your QR storage count needs a one-time account migration before you can save, edit, duplicate, or delete saved codes.')
  const count = Number(snapshot.data().qrCount)
  if (!Number.isSafeInteger(count) || count < 0) throw codedError('failed-precondition', 'Your saved QR count is being reconciled. Please try again later.')
  return count
}

export async function getUserQrQuota(userId) {
  ensureDatabase()
  if (!userId) return { count: 0, limit: MAX_SAVED_QR_CODES, remaining: MAX_SAVED_QR_CODES, ready: false }
  const snapshot = await getDoc(statsRef(userId))
  if (!snapshot.exists()) return { count: null, limit: MAX_SAVED_QR_CODES, remaining: null, ready: false }
  const rawCount = Number(snapshot.data().qrCount)
  if (!Number.isSafeInteger(rawCount) || rawCount < 0) return { count: null, limit: MAX_SAVED_QR_CODES, remaining: null, ready: false }
  const count = rawCount
  return { count, limit: MAX_SAVED_QR_CODES, remaining: Math.max(0, MAX_SAVED_QR_CODES - count), ready: true }
}

export async function listUserQrCodes(userId) {
  ensureDatabase()
  if (!userId) return []
  const records = await getDocs(query(collection(db, 'qrCodes'), where('userId', '==', userId)))
  return records.docs.map((snapshot) => parseQrRecord(snapshot.id, snapshot.data()))
}

export async function createQrCode(userId, draft, { activityType = 'qr_create' } = {}) {
  ensureDatabase()
  const base = qrDocument(userId, draft)
  if (!['qr_create', 'qr_duplicate'].includes(activityType)) throw codedError('invalid-argument', 'Unsupported QR activity type.')
  const qrReference = doc(collection(db, 'qrCodes'))
  const stats = statsRef(userId)
  const activity = eventRef()

  await runTransaction(db, async (transaction) => {
    const statsSnapshot = await transaction.get(stats)
    const count = ensureStats(statsSnapshot)
    if (count >= MAX_SAVED_QR_CODES) throw codedError('resource-exhausted', 'You have reached the limit of 25 saved QR codes. Remove a saved QR to create space.')
    transaction.set(qrReference, { ...base, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    transaction.update(stats, {
      qrCount: count + 1,
      lastQrCreatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityType: activityType,
      lastActivityQrId: qrReference.id,
      lastActivityEventId: activity.id,
      updatedAt: serverTimestamp(),
    })
    transaction.set(activity, { userId, type: activityType, qrId: qrReference.id, createdAt: serverTimestamp() })
  })
  return qrReference.id
}

export async function getUserQrCode(userId, id) {
  ensureDatabase()
  const snapshot = await getDoc(doc(db, 'qrCodes', id))
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw codedError('not-found', 'QR code not found.')
  return parseQrRecord(snapshot.id, snapshot.data())
}

export async function updateQrCode(userId, id, draft) {
  ensureDatabase()
  const clean = qrDocument(userId, draft)
  const qrReference = doc(db, 'qrCodes', id)
  const stats = statsRef(userId)
  const activity = eventRef()
  await runTransaction(db, async (transaction) => {
    const [qrSnapshot, statsSnapshot] = await Promise.all([transaction.get(qrReference), transaction.get(stats)])
    if (!qrSnapshot.exists() || qrSnapshot.data().userId !== userId) throw codedError('not-found', 'QR code not found.')
    const count = ensureStats(statsSnapshot)
    transaction.update(qrReference, { name: clean.name, type: clean.type, content: clean.content, design: clean.design, updatedAt: serverTimestamp() })
    transaction.update(stats, {
      qrCount: count,
      lastActivityAt: serverTimestamp(),
      lastActivityType: 'qr_edit',
      lastActivityQrId: id,
      lastActivityEventId: activity.id,
      updatedAt: serverTimestamp(),
    })
    transaction.set(activity, { userId, type: 'qr_edit', qrId: id, createdAt: serverTimestamp() })
  })
}

export async function duplicateQrCode(userId, record) {
  ensureDatabase()
  const owned = await getUserQrCode(userId, record.id)
  return createQrCode(userId, {
    name: `${owned.name} copy`.slice(0, 80),
    type: owned.type,
    values: owned.values,
    design: cleanDesign(owned.design),
  }, { activityType: 'qr_duplicate' })
}

export async function deleteQrCode(userId, record) {
  ensureDatabase()
  const id = typeof record === 'string' ? record : record?.id
  const qrReference = doc(db, 'qrCodes', id)
  const stats = statsRef(userId)
  const activity = eventRef()
  await runTransaction(db, async (transaction) => {
    const [qrSnapshot, statsSnapshot] = await Promise.all([transaction.get(qrReference), transaction.get(stats)])
    if (!qrSnapshot.exists() || qrSnapshot.data().userId !== userId) throw codedError('not-found', 'QR code not found.')
    const count = ensureStats(statsSnapshot)
    if (count < 1) throw codedError('failed-precondition', 'Your saved QR count is being reconciled. Please try again later.')
    transaction.delete(qrReference)
    transaction.update(stats, {
      qrCount: count - 1,
      lastActivityAt: serverTimestamp(),
      lastActivityType: 'qr_delete',
      lastActivityQrId: id,
      lastActivityEventId: activity.id,
      updatedAt: serverTimestamp(),
    })
    transaction.set(activity, { userId, type: 'qr_delete', qrId: id, createdAt: serverTimestamp() })
  })
}
