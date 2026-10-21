import {
  collection,
  doc,
  documentId,
  endAt,
  getAggregateFromServer,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  startAt,
  sum,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../config/firebase.js'

const PAGE_SIZE = 25
const DAY_MS = 24 * 60 * 60 * 1000
const dateAtStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const timestamp = (date) => Timestamp.fromDate(date)
const count = async (target) => (await getCountFromServer(target)).data().count

function ensureAdminDatabase() {
  if (!db) {
    const error = new Error('Firebase is not configured.')
    error.code = 'auth/configuration-not-ready'
    throw error
  }
}

export function asDate(value) {
  if (!value) return null
  const date = value?.toDate ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatAdminDate(value, options = {}) {
  const date = asDate(value)
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', ...options }).format(date) : 'Unavailable'
}

export function inactivityStatus(lastActivityAt, now = new Date()) {
  const date = asDate(lastActivityAt)
  if (!date) return { label: 'Activity unavailable', tone: 'neutral', reverify: false }
  const sixMonths = new Date(now); sixMonths.setMonth(sixMonths.getMonth() - 6)
  const twelveMonths = new Date(now); twelveMonths.setMonth(twelveMonths.getMonth() - 12)
  if (date <= twelveMonths) return { label: 'Inactive 12+ months', tone: 'danger', reverify: true }
  if (date <= sixMonths) return { label: 'Inactive 6+ months', tone: 'warning', reverify: false }
  return { label: 'Active', tone: 'success', reverify: false }
}

export async function getAdminOverview() {
  ensureAdminDatabase()
  const now = new Date()
  const todayStart = dateAtStartOfDay(now)
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS)
  const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(now.getMonth() - 6)
  const twelveMonthsAgo = new Date(now); twelveMonthsAgo.setMonth(now.getMonth() - 12)
  const users = collection(db, 'users')
  const stats = collection(db, 'userStats')
  const events = collection(db, 'activityEvents')
  const loginEvents = query(events, where('type', '==', 'login'))
  const todayLogins = query(events, where('type', '==', 'login'), where('createdAt', '>=', timestamp(todayStart)))
  const statsQrSum = getAggregateFromServer(stats, { total: sum('qrCount') })
  const [totalUsers, qrTotalResult, loginTotal, loginsToday, active7, active30, inactive6, inactive12, uniqueLogin30, approaching, overLimit] = await Promise.all([
    count(users),
    statsQrSum,
    count(loginEvents),
    count(todayLogins),
    count(query(stats, where('lastActivityAt', '>=', timestamp(sevenDaysAgo)))),
    count(query(stats, where('lastActivityAt', '>=', timestamp(thirtyDaysAgo)))),
    count(query(stats, where('lastActivityAt', '<=', timestamp(sixMonthsAgo)))),
    count(query(stats, where('lastActivityAt', '<=', timestamp(twelveMonthsAgo)))),
    count(query(stats, where('lastLoginAt', '>=', timestamp(thirtyDaysAgo)))),
    count(query(stats, where('qrCount', '>=', 20), where('qrCount', '<=', 24))),
    count(query(stats, where('qrCount', '>=', 25))),
  ])
  const savedQrCodes = Number(qrTotalResult.data().total || 0)
  return {
    totalUsers,
    savedQrCodes,
    totalRecordedLogins: loginTotal,
    successfulLoginsToday: loginsToday,
    uniqueLoginUsers30: uniqueLogin30,
    activeUsers7: active7,
    activeUsers30: active30,
    inactive6Months: inactive6,
    inactive12Months: inactive12,
    approachingLimit: approaching,
    atOrOverLimit: overLimit,
    averageQrsPerUser: totalUsers ? savedQrCodes / totalUsers : 0,
    lastUpdatedAt: now,
  }
}

async function attachStats(userSnapshots) {
  const ids = userSnapshots.map((snapshot) => snapshot.id)
  const statsById = new Map()
  if (ids.length) {
    const statsQuery = query(collection(db, 'userStats'), where(documentId(), 'in', ids))
    const statsResult = await getDocs(statsQuery)
    statsResult.forEach((snapshot) => statsById.set(snapshot.id, snapshot.data()))
  }
  return userSnapshots.map((snapshot) => ({ id: snapshot.id, ...snapshot.data(), stats: statsById.get(snapshot.id) || null }))
}

export async function listAdminUsers({ cursor = null, search = '', sort = 'newest' } = {}) {
  ensureAdminDatabase()
  const users = collection(db, 'users')
  const term = String(search || '').trim().toLowerCase()
  let usersQuery
  if (term.includes('@')) {
    usersQuery = query(users, where('email', '==', term), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE))
  } else if (term) {
    usersQuery = query(users, orderBy('name'), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : [startAt(search.trim())]), endAt(`${search.trim()}\uf8ff`), limit(PAGE_SIZE))
  } else {
    const sortField = sort === 'name' ? 'name' : 'createdAt'
    const sortDirection = sort === 'oldest' ? 'asc' : 'desc'
    usersQuery = query(users, orderBy(sortField, sort === 'name' ? 'asc' : sortDirection), orderBy(documentId(), sort === 'oldest' || sort === 'name' ? 'asc' : 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE))
  }
  const snapshot = await getDocs(usersQuery)
  const rows = await attachStats(snapshot.docs)
  return { rows, cursor: snapshot.docs.at(-1) || null, hasMore: snapshot.docs.length === PAGE_SIZE, pageSize: PAGE_SIZE }
}

export async function getAdminUserDetail(uid) {
  ensureAdminDatabase()
  const [profileSnapshot, statsSnapshot, activitySnapshot] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, 'userStats', uid)),
    getDocs(query(collection(db, 'activityEvents'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(25))),
  ])
  const activity = activitySnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
  const stats = statsSnapshot.exists() ? statsSnapshot.data() : null
  return {
    profile: profileSnapshot.exists() ? { uid, ...profileSnapshot.data() } : null,
    stats,
    activity,
    qrActivity: activity.filter((event) => ['qr_create', 'qr_duplicate'].includes(event.type)),
  }
}

export async function updateAdminUserName(uid, name) {
  ensureAdminDatabase()
  const value = String(name || '').trim()
  if (!uid || value.length < 2 || value.length > 100) {
    const error = new Error('Enter a display name between 2 and 100 characters.')
    error.code = 'auth/invalid-profile-name'
    throw error
  }
  await updateDoc(doc(db, 'users', uid), { name: value })
  return value
}

export async function getAdminAnalytics() {
  ensureAdminDatabase()
  const events = collection(db, 'activityEvents')
  const today = dateAtStartOfDay(new Date())
  const days = Array.from({ length: 7 }, (_, offset) => {
    const start = new Date(today.getTime() - (6 - offset) * DAY_MS)
    const end = new Date(start.getTime() + DAY_MS)
    return { date: start, loginQuery: query(events, where('type', '==', 'login'), where('createdAt', '>=', timestamp(start)), where('createdAt', '<', timestamp(end))), qrQuery: query(events, where('type', 'in', ['qr_create', 'qr_duplicate']), where('createdAt', '>=', timestamp(start)), where('createdAt', '<', timestamp(end))) }
  })
  const result = await Promise.all(days.flatMap((day) => [count(day.loginQuery), count(day.qrQuery)]))
  return days.map((day, index) => ({ date: day.date, logins: result[index * 2], qrSaved: result[index * 2 + 1] }))
}

export async function getAdminActivity() {
  ensureAdminDatabase()
  const snapshot = await getDocs(query(collection(db, 'activityEvents'), orderBy('createdAt', 'desc'), limit(100)))
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    return {
      id: entry.id,
      userId: typeof data.userId === 'string' ? data.userId : '',
      type: typeof data.type === 'string' ? data.type : 'unknown',
      authMethod: typeof data.authMethod === 'string' ? data.authMethod : '',
      qrId: typeof data.qrId === 'string' ? data.qrId : '',
      createdAt: data.createdAt || null,
    }
  })
}
