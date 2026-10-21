import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'

const projectId = 'demo-qriovo'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const firestoreHost = '127.0.0.1:8080'
const authHost = '127.0.0.1:9099'
const firestoreRest = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`
const authRest = `http://${authHost}/identitytoolkit.googleapis.com/v1`

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error(`Refusing emulator tests with unexpected GCLOUD_PROJECT: ${process.env.GCLOUD_PROJECT}`)
}
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== projectId) {
  throw new Error(`Refusing emulator tests with unexpected FIREBASE_PROJECT_ID: ${process.env.FIREBASE_PROJECT_ID}`)
}

process.env.GCLOUD_PROJECT = projectId
process.env.FIREBASE_PROJECT_ID = projectId
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost

const app = initializeApp({ projectId }, `qriovo-migration-emulator-${Date.now()}`)
const adminAuth = getAuth(app)
const db = getFirestore(app)
const migrationScript = resolve(root, 'scripts/migrate-user-stats.mjs')
const timestamp = (date) => Timestamp.fromDate(new Date(date))

async function resetEmulators() {
  const firestoreResponse = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })
  if (!firestoreResponse.ok) throw new Error(`Could not clear emulator Firestore: ${firestoreResponse.status} ${await firestoreResponse.text()}`)

  const authResponse = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' })
  if (!authResponse.ok) throw new Error(`Could not clear emulator Auth: ${authResponse.status} ${await authResponse.text()}`)
}

async function addAuthUser(uid, email, displayName = uid) {
  return adminAuth.createUser({ uid, email, displayName, password: 'EmulatorOnly-password-123!' })
}

function qrRecord(userId, id, index = 0) {
  const createdAt = timestamp(`2024-01-${String((index % 27) + 1).padStart(2, '0')}T12:00:00.000Z`)
  const updatedAt = timestamp(`2024-02-${String((index % 27) + 1).padStart(2, '0')}T12:00:00.000Z`)
  return {
    userId,
    name: `Saved code ${id}`,
    type: 'Text',
    content: JSON.stringify({ privatePayload: `synthetic-emulator-payload-${id}` }),
    design: {
      foreground: '#17251C', background: '#FFFFFF', pattern: 'rounded',
      cornerSquare: 'extra-rounded', cornerDot: 'dot', size: 512,
      margin: 16, errorCorrection: 'Q', gradient: false,
    },
    createdAt,
    updatedAt,
  }
}

function runMigration({ resume = false, interruptAfterBatches } = {}) {
  const env = {
    ...process.env,
    GCLOUD_PROJECT: projectId,
    FIREBASE_PROJECT_ID: projectId,
    FIRESTORE_EMULATOR_HOST: firestoreHost,
    FIREBASE_AUTH_EMULATOR_HOST: authHost,
  }
  delete env.GOOGLE_APPLICATION_CREDENTIALS
  delete env.QRI_MIGRATION_EMULATOR_INTERRUPT_AFTER_BATCHES
  if (interruptAfterBatches !== undefined) {
    env.QRI_MIGRATION_EMULATOR_INTERRUPT_AFTER_BATCHES = String(interruptAfterBatches)
  }

  const args = [migrationScript, '--emulator', ...(resume ? ['--resume'] : [])]
  const confirmation = `${resume ? 'RESUME' : 'MIGRATE'} ${projectId}\n`
  return spawnSync(process.execPath, args, {
    cwd: root,
    env,
    input: confirmation,
    encoding: 'utf8',
    timeout: 120_000,
  })
}

function startMigration({ resume = false, holdAfterPauseMs } = {}) {
  const env = {
    ...process.env,
    GCLOUD_PROJECT: projectId,
    FIREBASE_PROJECT_ID: projectId,
    FIRESTORE_EMULATOR_HOST: firestoreHost,
    FIREBASE_AUTH_EMULATOR_HOST: authHost,
  }
  delete env.GOOGLE_APPLICATION_CREDENTIALS
  delete env.QRI_MIGRATION_EMULATOR_INTERRUPT_AFTER_BATCHES
  delete env.QRI_MIGRATION_EMULATOR_HOLD_AFTER_PAUSE_MS
  if (holdAfterPauseMs !== undefined) env.QRI_MIGRATION_EMULATOR_HOLD_AFTER_PAUSE_MS = String(holdAfterPauseMs)

  const args = [migrationScript, '--emulator', ...(resume ? ['--resume'] : [])]
  const confirmation = `${resume ? 'RESUME' : 'MIGRATE'} ${projectId}\n`
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdin.end(confirmation)

  const result = new Promise((resolveResult) => {
    child.on('close', (status, signal) => resolveResult({ status, signal, stdout, stderr }))
  })
  const waitForOutput = async (pattern, timeoutMs = 20_000) => {
    if (pattern.test(stdout)) return
    await new Promise((resolveOutput, rejectOutput) => {
      const timeout = setTimeout(() => {
        child.stdout.off('data', check)
        rejectOutput(new Error(`Timed out waiting for migration output: ${pattern}`))
      }, timeoutMs)
      const check = () => {
        if (!pattern.test(stdout)) return
        clearTimeout(timeout)
        child.stdout.off('data', check)
        resolveOutput()
      }
      child.stdout.on('data', check)
      child.once('close', () => {
        clearTimeout(timeout)
        child.stdout.off('data', check)
        if (!pattern.test(stdout)) rejectOutput(new Error(`Migration exited before expected output.\n${stdout}\n${stderr}`))
      })
    })
  }
  return { child, result, waitForOutput }
}

function assertMigrationSucceeded(result, label) {
  assert.equal(result.error, undefined, `${label}: child process error: ${result.error?.message}`)
  assert.equal(result.status, 0, `${label}: exit=${result.status}\n${result.stdout || ''}\n${result.stderr || ''}`)
}

function assertMigrationFailed(result, label, expectedMessage) {
  assert.equal(result.error, undefined, `${label}: child process error: ${result.error?.message}`)
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded.`)
  assert.match(`${result.stdout || ''}\n${result.stderr || ''}`, expectedMessage)
}

async function expectQrCount(uid, expected) {
  const stats = await db.doc(`userStats/${uid}`).get()
  assert.equal(stats.get('qrCount'), expected, `${uid} should have reconciled qrCount=${expected}`)
}

const value = {
  string: (stringValue) => ({ stringValue }),
  integer: (integerValue) => ({ integerValue: String(integerValue) }),
  boolean: (booleanValue) => ({ booleanValue }),
  null: { nullValue: null },
  timestamp: (date) => ({ timestampValue: date.toISOString() }),
  map: (fields) => ({ mapValue: { fields } }),
}

async function requestFirestore(relativePath, token, { method = 'GET', body } = {}) {
  const response = await fetch(`${firestoreRest}${relativePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { status: response.status, body: json }
}

async function signInToken(email) {
  const response = await fetch(`${authRest}/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'EmulatorOnly-password-123!', returnSecureToken: true }),
  })
  const body = await response.json()
  assert.equal(response.status, 200, `Auth Emulator sign-in failed: ${JSON.stringify(body)}`)
  return body.idToken
}

async function seedAccount(uid, email, qrCount = 0) {
  const now = Timestamp.now()
  await db.doc(`users/${uid}`).set({ name: uid, email, createdAt: now })
  await db.doc(`userStats/${uid}`).set({
    qrCount,
    loginCount: 0,
    lastLoginAt: null,
    lastActivityAt: null,
    lastQrCreatedAt: null,
    lastActivityType: null,
    lastActivityQrId: null,
    lastActivityEventId: null,
    activityTrackingStartedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

async function qrCreationWriteSet(uid, previousStats, type = 'qr_create') {
  const qrId = randomUUID()
  const eventId = randomUUID()
  const qrPath = `projects/${projectId}/databases/(default)/documents/qrCodes/${qrId}`
  const eventPath = `projects/${projectId}/databases/(default)/documents/activityEvents/${eventId}`
  const statsPath = `projects/${projectId}/databases/(default)/documents/userStats/${uid}`
  const design = value.map({
    foreground: value.string('#17251C'),
    background: value.string('#FFFFFF'),
    pattern: value.string('rounded'),
    cornerSquare: value.string('extra-rounded'),
    cornerDot: value.string('dot'),
    size: value.integer(512),
    margin: { doubleValue: 16 },
    errorCorrection: value.string('Q'),
    gradient: value.boolean(false),
  })

  return [
    {
      update: {
        name: qrPath,
        fields: {
          userId: value.string(uid),
          name: value.string(`Emulator QR ${qrId}`),
          type: value.string('Website'),
          content: value.string('https://example.test/emulator'),
          design,
        },
      },
      currentDocument: { exists: false },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    },
    {
      update: {
        name: statsPath,
        fields: {
          qrCount: value.integer(Number(previousStats.qrCount) + 1),
          loginCount: value.integer(previousStats.loginCount),
          lastLoginAt: previousStats.lastLoginAt ? value.timestamp(previousStats.lastLoginAt.toDate()) : value.null,
          lastActivityType: value.string(type),
          lastActivityQrId: value.string(qrId),
          lastActivityEventId: value.string(eventId),
          activityTrackingStartedAt: value.timestamp(previousStats.activityTrackingStartedAt.toDate()),
          createdAt: value.timestamp(previousStats.createdAt.toDate()),
        },
      },
      currentDocument: { exists: true },
      updateTransforms: [
        { fieldPath: 'lastQrCreatedAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'lastActivityAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    },
    {
      update: {
        name: eventPath,
        fields: {
          userId: value.string(uid),
          type: value.string(type),
          qrId: value.string(qrId),
        },
      },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ]
}

async function commitQrCreation(token, uid, previousStats) {
  return requestFirestore(':commit', token, {
    method: 'POST',
    body: { writes: await qrCreationWriteSet(uid, previousStats) },
  })
}

async function testMigrationOnExistingData() {
  await resetEmulators()
  await addAuthUser('empty-user', 'empty@example.test', 'Empty Account')
  await addAuthUser('existing-user', 'existing@example.test', 'Auth Name')
  await addAuthUser('over-limit-user', 'over@example.test', 'Over Limit')

  const oldCreatedAt = timestamp('2023-04-05T06:07:08.000Z')
  const oldLastLoginAt = timestamp('2025-03-04T05:06:07.000Z')
  const originalProfile = {
    name: 'Keep This Profile Name',
    email: 'existing@example.test',
    createdAt: oldCreatedAt,
    customProfileFlag: 'preserve-me',
  }
  const originalStats = {
    qrCount: 999,
    loginCount: 7,
    lastLoginAt: oldLastLoginAt,
    lastActivityAt: oldLastLoginAt,
    lastQrCreatedAt: null,
    lastActivityType: 'login',
    lastActivityQrId: null,
    lastActivityEventId: 'legacy-event-id',
    activityTrackingStartedAt: oldCreatedAt,
    createdAt: oldCreatedAt,
    updatedAt: oldLastLoginAt,
    customSummaryField: { retained: true },
  }
  await db.doc('users/existing-user').set(originalProfile)
  await db.doc('userStats/existing-user').set(originalStats)
  await db.doc('users/over-limit-user').set({ name: 'Existing Over Limit', email: 'over@example.test', createdAt: oldCreatedAt })
  await db.doc('systemSettings/qrQuota').set({ unrelatedSetting: 'keep-this' })

  const seededQrEntries = [
    ['existing-user', 'existing-qr-1'],
    ['existing-user', 'existing-qr-2'],
    ['deleted-auth-owner', 'orphan-qr'],
  ]
  for (let index = 0; index < 27; index += 1) seededQrEntries.push(['over-limit-user', `over-qr-${index + 1}`])
  const originalQrData = new Map()
  await Promise.all(seededQrEntries.map(async ([uid, id], index) => {
    const data = qrRecord(uid, id, index)
    originalQrData.set(id, data)
    await db.doc(`qrCodes/${id}`).set(data)
  }))

  const result = runMigration()
  assertMigrationSucceeded(result, 'initial migration')
  await expectQrCount('empty-user', 0)
  await expectQrCount('existing-user', 2)
  await expectQrCount('over-limit-user', 27)

  assert.deepEqual((await db.doc('users/existing-user').get()).data(), originalProfile, 'existing user profile must remain byte-for-byte equivalent at the field level')
  const newProfile = (await db.doc('users/empty-user').get()).data()
  assert.equal(newProfile.name, 'Empty Account')
  assert.equal(newProfile.email, 'empty@example.test')
  assert.ok(newProfile.createdAt instanceof Timestamp)

  const reconciledStats = (await db.doc('userStats/existing-user').get()).data()
  assert.equal(reconciledStats.loginCount, 7)
  assert.equal(reconciledStats.lastLoginAt.toMillis(), oldLastLoginAt.toMillis())
  assert.deepEqual(reconciledStats.customSummaryField, { retained: true })
  assert.equal(reconciledStats.qrCount, 2)

  for (const [id, expected] of originalQrData) {
    assert.deepEqual((await db.doc(`qrCodes/${id}`).get()).data(), expected, `QR record ${id} must remain unchanged`)
  }
  const setting = (await db.doc('systemSettings/qrQuota').get()).data()
  assert.equal(setting.qrWritesPaused, false, 'successful reconciliation must release the write pause')
  assert.equal(setting.migrationRunId, undefined, 'successful reconciliation must clear its lock ID')
  assert.equal(setting.unrelatedSetting, 'keep-this', 'migration must preserve unrelated quota settings')

  await addAuthUser('synthetic-owner-one', 'etesting969@gmail.com', 'Approved Owner')
  await adminAuth.setCustomUserClaims('synthetic-owner-one', { superAdmin: true })
  const ownerToken = await signInToken('etesting969@gmail.com')
  const ownerClaims = JSON.parse(Buffer.from(ownerToken.split('.')[1], 'base64url').toString('utf8'))
  assert.equal(ownerClaims.superAdmin, true, 'a new emulator ID token should contain the Super Admin claim')
  assert.equal((await requestFirestore('/users/existing-user', ownerToken)).status, 200, 'an allowlisted Super Admin should read user profiles')
  assert.equal((await requestFirestore('/userStats/existing-user', ownerToken)).status, 200, 'an allowlisted Super Admin should read user summaries')
  assert.equal((await requestFirestore('/qrCodes/existing-qr-1', ownerToken)).status, 403, 'Super Admin must not read private QR payloads')

  await addAuthUser('stale-admin-user', 'stale-admin@example.test', 'Stale Admin')
  await adminAuth.setCustomUserClaims('stale-admin-user', { admin: true })
  const staleAdminToken = await signInToken('stale-admin@example.test')
  assert.equal((await requestFirestore('/users/existing-user', staleAdminToken)).status, 403, 'a stale legacy admin claim must not grant user monitoring access')

  await addAuthUser('unapproved-super-admin', 'unapproved@example.test', 'Unapproved')
  await adminAuth.setCustomUserClaims('unapproved-super-admin', { superAdmin: true })
  const unapprovedToken = await signInToken('unapproved@example.test')
  assert.equal((await requestFirestore('/users/existing-user', unapprovedToken)).status, 403, 'an unapproved UID with a stale superAdmin claim must be rejected by Firestore Rules')
  console.log('PASS: migration cases, owner read-only monitoring, stale legacy Admin denial, unapproved Super Admin UID denial and private QR payload denial.')
}

async function testPauseLockAndResume() {
  await resetEmulators()
  await addAuthUser('lock-user', 'lock@example.test', 'Lock User')
  await db.doc('systemSettings/qrQuota').set({ qrWritesPaused: true, migrationRunId: 'previous-incomplete-run' })

  const blocked = runMigration()
  assertMigrationFailed(blocked, 'second non-resume run', /already paused/)
  assert.equal((await db.doc('users/lock-user').get()).exists, false, 'blocked run must not start reconciliation')
  assert.equal((await db.doc('systemSettings/qrQuota').get()).get('migrationRunId'), 'previous-incomplete-run', 'blocked run must not take over an existing lock')

  const resumed = runMigration({ resume: true })
  assertMigrationSucceeded(resumed, 'resume after stale pause')
  assert.equal((await db.doc('systemSettings/qrQuota').get()).get('qrWritesPaused'), false, 'resume should reconcile and release pause')
  await expectQrCount('lock-user', 0)

  await addAuthUser('parallel-lock-user', 'parallel-lock@example.test', 'Parallel Lock User')
  const firstRun = startMigration({ holdAfterPauseMs: 2500 })
  await firstRun.waitForOutput(/writes are now paused/)
  const competingRun = startMigration()
  const competingResult = await competingRun.result
  assertMigrationFailed(competingResult, 'simultaneous normal migration', /already paused/)
  const firstResult = await firstRun.result
  assertMigrationSucceeded(firstResult, 'first concurrent migration')
  await expectQrCount('parallel-lock-user', 0)
  console.log('PASS: existing and simultaneous normal runs are blocked by the pause lock; explicit resume recovers and releases it.')
}

async function testInterruptedMigrationResume() {
  await resetEmulators()
  await addAuthUser('interrupted-user', 'interrupted@example.test', 'Interrupted User')
  const qr = qrRecord('interrupted-user', 'interrupted-qr', 0)
  await db.doc('qrCodes/interrupted-qr').set(qr)

  const interrupted = runMigration({ interruptAfterBatches: 1 })
  assertMigrationFailed(interrupted, 'emulator interruption', /Emulator-only interruption after 1 committed summary batch/)
  assert.equal((await db.doc('userStats/interrupted-user').get()).get('qrCount'), 1, 'the first transaction should have committed atomically before interruption')
  assert.equal((await db.doc('systemSettings/qrQuota').get()).get('qrWritesPaused'), true, 'a failed migration must leave the pause active')

  const blocked = runMigration()
  assertMigrationFailed(blocked, 'normal run after interrupted migration', /already paused/)
  const resumed = runMigration({ resume: true })
  assertMigrationSucceeded(resumed, 'resume after committed partial work')
  await expectQrCount('interrupted-user', 1)
  assert.deepEqual((await db.doc('qrCodes/interrupted-qr').get()).data(), qr, 'resume must not rewrite QR records')
  assert.equal((await db.doc('systemSettings/qrQuota').get()).get('qrWritesPaused'), false)
  console.log('PASS: interruption after a committed summary batch leaves writes paused; normal rerun is blocked; resume is idempotent.')
}

async function testPauseAndConcurrentQuotaRules() {
  await resetEmulators()
  const uid = 'quota-race-user'
  const email = 'quota-race@example.test'
  await seedAccount(uid, email, 0)
  await addAuthUser(uid, email)
  await db.doc('systemSettings/qrQuota').set({ qrWritesPaused: true })
  const userToken = await signInToken(email)
  const initialStats = (await db.doc(`userStats/${uid}`).get()).data()
  const pausedWrite = await commitQrCreation(userToken, uid, initialStats)
  assert.equal(pausedWrite.status, 403, 'QR transaction must be denied while migration pause is true')
  assert.equal((await db.doc(`userStats/${uid}`).get()).get('qrCount'), 0, 'denied transaction must not increment stats')

  await db.doc('systemSettings/qrQuota').update({ qrWritesPaused: false })
  const allowedWrite = await commitQrCreation(userToken, uid, initialStats)
  assert.equal(allowedWrite.status, 200, `QR transaction should succeed after pause release: ${JSON.stringify(allowedWrite.body)}`)
  await expectQrCount(uid, 1)

  const raceUid = 'quota-race-at-limit-user'
  const raceEmail = 'quota-race-at-limit@example.test'
  await seedAccount(raceUid, raceEmail, 24)
  await addAuthUser(raceUid, raceEmail)
  await Promise.all(Array.from({ length: 24 }, (_, index) => db.doc(`qrCodes/race-existing-${index}`).set(qrRecord(raceUid, `race-existing-${index}`, index))))
  await db.doc('systemSettings/qrQuota').set({ qrWritesPaused: false })
  const raceToken = await signInToken(raceEmail)
  const raceStats = (await db.doc(`userStats/${raceUid}`).get()).data()
  const outcomes = await Promise.all([
    commitQrCreation(raceToken, raceUid, raceStats),
    commitQrCreation(raceToken, raceUid, raceStats),
  ])
  assert.equal(outcomes.filter((outcome) => outcome.status === 200).length, 1, 'only one competing request may claim the final QR slot')
  assert.equal(outcomes.filter((outcome) => outcome.status === 403).length, 1, 'the stale-counter competing request must be rejected')
  await expectQrCount(raceUid, 25)
  assert.equal((await db.collection('qrCodes').where('userId', '==', raceUid).get()).size, 25)
  console.log('PASS: QR saves are denied during pause; concurrent last-slot writes cannot exceed the 25-code quota.')
}

try {
  await testMigrationOnExistingData()
  await testPauseLockAndResume()
  await testInterruptedMigrationResume()
  await testPauseAndConcurrentQuotaRules()
  console.log('All migration and quota emulator checks passed against project demo-qriovo. No production Firebase project was accessed.')
} finally {
  await deleteApp(app)
}
