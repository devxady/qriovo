import { randomUUID } from 'node:crypto'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'

const emulatorMode = process.argv.includes('--emulator')
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || (emulatorMode ? '' : 'qrivo-db-dxa')
const isLoopbackEndpoint = (endpoint = '') => /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/.test(endpoint)

if (emulatorMode) {
  if (!projectId.startsWith('demo-')) {
    throw new Error('Emulator mode requires a Firebase project ID beginning with "demo-".')
  }
  if (!isLoopbackEndpoint(process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('Emulator mode requires FIRESTORE_EMULATOR_HOST to point to localhost, 127.0.0.1, or ::1.')
  }
  if (!isLoopbackEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
    throw new Error('Emulator mode requires FIREBASE_AUTH_EMULATOR_HOST to point to localhost, 127.0.0.1, or ::1.')
  }
} else if (projectId !== 'qrivo-db-dxa') {
  throw new Error(`Refusing to target unexpected Firebase project: ${projectId}`)
}
const resume = process.argv.includes('--resume')
const interruptAfterBatches = process.env.QRI_MIGRATION_EMULATOR_INTERRUPT_AFTER_BATCHES
const holdAfterPauseMsValue = process.env.QRI_MIGRATION_EMULATOR_HOLD_AFTER_PAUSE_MS
if (interruptAfterBatches !== undefined && !emulatorMode) {
  throw new Error('The migration interruption failpoint is available only with --emulator.')
}
if (holdAfterPauseMsValue !== undefined && !emulatorMode) {
  throw new Error('The migration lock-delay failpoint is available only with --emulator.')
}
const interruptAfterBatchCount = interruptAfterBatches === undefined ? 0 : Number(interruptAfterBatches)
if (interruptAfterBatches !== undefined && (!Number.isSafeInteger(interruptAfterBatchCount) || interruptAfterBatchCount < 1)) {
  throw new Error('QRI_MIGRATION_EMULATOR_INTERRUPT_AFTER_BATCHES must be a positive integer.')
}
const holdAfterPauseMs = holdAfterPauseMsValue === undefined ? 0 : Number(holdAfterPauseMsValue)
if (holdAfterPauseMsValue !== undefined && (!Number.isSafeInteger(holdAfterPauseMs) || holdAfterPauseMs < 1 || holdAfterPauseMs > 30_000)) {
  throw new Error('QRI_MIGRATION_EMULATOR_HOLD_AFTER_PAUSE_MS must be an integer from 1 to 30000.')
}
const appOptions = emulatorMode ? { projectId } : { credential: applicationDefault(), projectId }
const app = getApps().length ? getApp() : initializeApp(appOptions)
const adminAuth = getAuth(app)
const db = getFirestore(app)
const settingsRef = db.doc('systemSettings/qrQuota')
const runId = randomUUID()
let migrationSucceeded = false

const rl = readline.createInterface({ input, output })
const confirmation = `${resume ? 'RESUME' : 'MIGRATE'} ${projectId}`
const answer = await rl.question(`This will pause QR/activity writes and reconcile Firestore account summaries in ${projectId}. Type exactly "${confirmation}" to continue: `)
rl.close()
if (answer !== confirmation) {
  console.log('No Firestore data changed.')
  process.exit(1)
}

async function acquireWritePause() {
  await db.runTransaction(async (transaction) => {
    const settings = await transaction.get(settingsRef)
    if (settings.get('qrWritesPaused') === true && !resume) {
      throw new Error('QR and activity writes are already paused. If a previous migration stopped, review the cause and rerun with --resume.')
    }
    transaction.set(settingsRef, {
      qrWritesPaused: true,
      migrationRunId: runId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
}

function getDate(value) {
  if (!value) return null
  const date = value instanceof Timestamp ? value.toDate() : value?.toDate ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function newest(...values) {
  const dates = values.map(getDate).filter(Boolean).sort((a, b) => b.getTime() - a.getTime())
  return dates[0] || null
}

async function scanQrMetadata() {
  const byUser = new Map()
  let cursor = null
  let scanned = 0
  while (true) {
    let pageQuery = db.collection('qrCodes').select('userId', 'createdAt', 'updatedAt').orderBy(FieldPath.documentId()).limit(500)
    if (cursor) pageQuery = pageQuery.startAfter(cursor)
    const page = await pageQuery.get()
    if (page.empty) break
    for (const snapshot of page.docs) {
      const uid = snapshot.get('userId')
      if (typeof uid !== 'string' || !uid) continue
      const current = byUser.get(uid) || { qrCount: 0, latestCreatedAt: null, latestUpdatedAt: null }
      const data = snapshot.data()
      current.qrCount += 1
      current.latestCreatedAt = newest(current.latestCreatedAt, data.createdAt)
      current.latestUpdatedAt = newest(current.latestUpdatedAt, data.updatedAt, data.createdAt)
      byUser.set(uid, current)
    }
    scanned += page.size
    cursor = page.docs.at(-1)
    console.log(`Scanned QR metadata: ${scanned}`)
    if (page.size < 500) break
  }
  return { byUser, scanned }
}

async function collectAuthUsers() {
  const users = []
  let pageToken
  do {
    const page = await adminAuth.listUsers(1000, pageToken)
    users.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

async function writeUserSummaries(users, qrByUser) {
  let processed = 0
  let completedBatches = 0
  for (let offset = 0; offset < users.length; offset += 200) {
    const group = users.slice(offset, offset + 200)
    const profileRefs = group.map((user) => db.doc(`users/${user.uid}`))
    const statsRefs = group.map((user) => db.doc(`userStats/${user.uid}`))
    await db.runTransaction(async (transaction) => {
      // A resumed run must not let a still-running earlier process write stale
      // counters after the newer run has released the QR write pause.
      const settings = await transaction.get(settingsRef)
      if (settings.get('qrWritesPaused') !== true || settings.get('migrationRunId') !== runId) {
        throw new Error('Migration lock changed before this summary batch; refusing to write.')
      }

      const snapshots = await transaction.getAll(...profileRefs, ...statsRefs)
      const profileSnapshots = snapshots.slice(0, group.length)
      const statsSnapshots = snapshots.slice(group.length)

      group.forEach((user, index) => {
        const authCreatedAt = user.metadata.creationTime ? Timestamp.fromDate(new Date(user.metadata.creationTime)) : Timestamp.now()
        if (!profileSnapshots[index].exists) {
          transaction.set(profileRefs[index], {
            name: String(user.displayName || '').slice(0, 100),
            email: user.email || '',
            createdAt: authCreatedAt,
          })
        }

        const existing = statsSnapshots[index].exists ? statsSnapshots[index].data() : {}
        const saved = qrByUser.get(user.uid) || { qrCount: 0, latestCreatedAt: null, latestUpdatedAt: null }
        const latestQrCreated = newest(existing.lastQrCreatedAt, saved.latestCreatedAt)
        const latestActivity = newest(existing.lastActivityAt, saved.latestUpdatedAt, saved.latestCreatedAt)
        const existingLoginCount = Number(existing.loginCount)
        transaction.set(statsRefs[index], {
          ...existing,
          qrCount: saved.qrCount,
          loginCount: Number.isSafeInteger(existingLoginCount) && existingLoginCount >= 0 ? existingLoginCount : 0,
          lastLoginAt: existing.lastLoginAt || null,
          lastActivityAt: latestActivity ? Timestamp.fromDate(latestActivity) : null,
          lastQrCreatedAt: latestQrCreated ? Timestamp.fromDate(latestQrCreated) : null,
          lastActivityType: existing.lastActivityType || null,
          lastActivityQrId: existing.lastActivityQrId || null,
          lastActivityEventId: existing.lastActivityEventId || null,
          activityTrackingStartedAt: existing.activityTrackingStartedAt || FieldValue.serverTimestamp(),
          createdAt: existing.createdAt || authCreatedAt,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: false })
      })
    })
    processed += group.length
    completedBatches += 1
    console.log(`Reconciled Auth profiles and QR counters: ${processed}/${users.length}`)
    if (emulatorMode && interruptAfterBatchCount === completedBatches) {
      throw new Error(`Emulator-only interruption after ${completedBatches} committed summary batch(es).`)
    }
  }
}

async function releaseWritePause() {
  await db.runTransaction(async (transaction) => {
    const settings = await transaction.get(settingsRef)
    if (settings.get('migrationRunId') !== runId) throw new Error('The migration lock was changed by another process; the pause remains active.')
    transaction.set(settingsRef, {
      qrWritesPaused: false,
      migrationRunId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
}

try {
  await acquireWritePause()
  console.log('QR saves, edits, deletes and new login-event writes are now paused by Firestore rules.')
  if (emulatorMode && holdAfterPauseMs) {
    await new Promise((resolve) => setTimeout(resolve, holdAfterPauseMs))
  }
  const { byUser, scanned } = await scanQrMetadata()
  const users = await collectAuthUsers()
  await writeUserSummaries(users, byUser)
  await releaseWritePause()
  migrationSucceeded = true
  console.log(`Migration complete for ${users.length} Auth accounts. Preserved all ${scanned} QR documents; no QR payloads were loaded.`)
  console.log('The qrQuota write pause is off. Historic login events were not created; older accounts start with zero recorded logins unless real event data already existed.')
} catch (error) {
  console.error(`Migration stopped: ${error.message}`)
  console.error('The write pause remains active after a failed migration. Review the issue, then rerun: node scripts/migrate-user-stats.mjs --resume')
  process.exitCode = 1
} finally {
  if (!migrationSucceeded) console.error('Do not manually clear systemSettings/qrQuota.qrWritesPaused until reconciliation succeeds.')
}
