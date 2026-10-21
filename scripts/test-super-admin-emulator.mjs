import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { activateOwnerClaims, retireLegacyClaims, verifyOwnerAllowlist } from './manage-super-admin-claim.mjs'

const projectId = 'demo-qriovo'
const authHost = '127.0.0.1:9099'
const firestoreHost = '127.0.0.1:8080'
if ((process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) || (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== projectId)) {
  throw new Error('Refusing to run Super Admin tests outside the demo-qriovo project.')
}
process.env.GCLOUD_PROJECT = projectId
process.env.FIREBASE_PROJECT_ID = projectId
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost

const app = initializeApp({ projectId }, `qriovo-super-admin-emulator-${Date.now()}`)
const auth = getAuth(app)
const db = getFirestore(app)
const owner1Uid = 'synthetic-owner-one'
const owner2Uid = 'synthetic-owner-two'
const owner2Email = 'owner-two@example.test'
const syntheticPassword = 'EmulatorOnly-password-123!'

async function clearEmulators() {
  const [firestore, accounts] = await Promise.all([
    fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' }),
    fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' }),
  ])
  assert.equal(firestore.status, 200)
  assert.equal(accounts.status, 200)
}

async function createUser(uid, email, displayName, claims = {}) {
  const user = await auth.createUser({ uid, email, displayName })
  await auth.updateUser(uid, { password: syntheticPassword })
  if (Object.keys(claims).length) await auth.setCustomUserClaims(uid, claims)
  return user
}

async function tokenFor(email) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: syntheticPassword, returnSecureToken: true }),
  })
  assert.equal(response.ok, true, JSON.stringify(await response.clone().json()))
  return (await response.json()).idToken
}

async function firestoreRequest(path, idToken) {
  return fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents${path}`, { headers: { Authorization: `Bearer ${idToken}` } })
}

async function updateProfileFields(uid, idToken, fields) {
  const params = new URLSearchParams()
  for (const field of Object.keys(fields)) params.append('updateMask.fieldPaths', field)
  const restFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { stringValue: value }]))
  return fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?${params}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: restFields }),
  })
}

async function verifyPublicSignupIsNormal() {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'public-signup@example.test', password: syntheticPassword, returnSecureToken: true }),
  })
  assert.equal(response.ok, true)
  const signedUp = await response.json()
  const account = await auth.getUser(signedUp.localId)
  assert.equal(account.customClaims?.admin, undefined)
  assert.equal(account.customClaims?.superAdmin, undefined)
  const profileUrl = `projects/${projectId}/databases/(default)/documents/users/${signedUp.localId}`
  const statsUrl = `projects/${projectId}/databases/(default)/documents/userStats/${signedUp.localId}`
  const nullValue = { nullValue: 'NULL_VALUE' }
  const timestampTransforms = ['activityTrackingStartedAt', 'createdAt', 'updatedAt'].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }))
  const initialized = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${signedUp.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [
      { update: { name: profileUrl, fields: { name: { stringValue: 'Public Signup User' }, email: { stringValue: 'public-signup@example.test' } } }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] },
      { update: { name: statsUrl, fields: {
        qrCount: { integerValue: '0' }, loginCount: { integerValue: '0' }, lastLoginAt: nullValue, lastActivityAt: nullValue,
        lastQrCreatedAt: nullValue, lastActivityType: nullValue, lastActivityQrId: nullValue, lastActivityEventId: nullValue,
      } }, currentDocument: { exists: false }, updateTransforms: timestampTransforms },
    ] }),
  })
  assert.equal(initialized.status, 200, await initialized.clone().text())
  const profile = (await db.doc(`users/${signedUp.localId}`).get()).data()
  const stats = (await db.doc(`userStats/${signedUp.localId}`).get()).data()
  assert.equal(profile.name, 'Public Signup User')
  assert.equal(profile.email, 'public-signup@example.test')
  assert.ok(profile.createdAt)
  assert.equal(stats.qrCount, 0)
  assert.equal(stats.loginCount, 0)
  assert.equal(stats.lastActivityAt, null)
  console.log('PASS: public Firebase Auth signup gets no admin claims and creates its own profile and initial stats through Firestore rules.')
  return signedUp.localId
}

async function verifyOwnerMigrationAndReadBoundaries(normalUid) {
  await createUser(owner1Uid, 'etesting969@gmail.com', 'Approved Owner One', { admin: true, superAdmin: true, retainedClaim: 'preserved' })
  await createUser(owner2Uid, owner2Email, 'Approved Owner Two', { admin: true })
  await createUser('unapproved-super-admin', 'unapproved@example.test', 'Unapproved', { admin: true, superAdmin: true, retainedClaim: 'preserved' })
  await db.doc(`userStats/${normalUid}`).update({ qrCount: 1 })
  const privateQr = { userId: normalUid, name: 'Private test QR', content: 'private synthetic payload' }
  await db.doc('qrCodes/private-synthetic-qr').set(privateQr)

  const initial = await verifyOwnerAllowlist({ auth, owner1Uid, owner2Uid, owner2Email })
  assert.equal(initial.unapprovedSuperAdmins.length, 1)
  const activated = await activateOwnerClaims({ auth, db, owner1Uid, owner2Uid, owner2Email })
  assert.deepEqual(activated.map((entry) => entry.changed), [false, true])
  assert.equal((await auth.getUser(owner1Uid)).customClaims.admin, true, 'legacy claims remain during the staged access transition')
  assert.equal((await auth.getUser(owner2Uid)).customClaims.superAdmin, true)
  assert.equal((await auth.getUser(owner2Uid)).customClaims.admin, true)

  const ownerToken = await tokenFor('etesting969@gmail.com')
  assert.equal((await firestoreRequest(`/users/${normalUid}`, ownerToken)).status, 200)
  assert.equal((await firestoreRequest(`/userStats/${normalUid}`, ownerToken)).status, 200)
  assert.equal((await firestoreRequest('/qrCodes/private-synthetic-qr', ownerToken)).status, 403)
  const adminNameUpdate = await updateProfileFields(normalUid, ownerToken, { name: 'Updated by Owner' })
  assert.equal(adminNameUpdate.status, 200, await adminNameUpdate.clone().text())
  assert.equal((await db.doc(`users/${normalUid}`).get()).get('name'), 'Updated by Owner')
  const adminEmailUpdate = await updateProfileFields(normalUid, ownerToken, { email: 'changed@example.test' })
  assert.equal(adminEmailUpdate.status, 403, 'Super Admin profile management is limited to display names')

  const normalToken = await tokenFor('public-signup@example.test')
  assert.equal((await firestoreRequest(`/users/${normalUid}`, normalToken)).status, 200, 'normal user may read own profile')
  const ownNameUpdate = await updateProfileFields(normalUid, normalToken, { name: 'Updated by User' })
  assert.equal(ownNameUpdate.status, 200)
  await db.doc('users/other-user').set({ name: 'Other User', email: 'other@example.test', createdAt: new Date() })
  const otherNameUpdate = await updateProfileFields('other-user', normalToken, { name: 'Changed by User' })
  assert.equal(otherNameUpdate.status, 403, 'normal user cannot edit another profile name')
  assert.equal((await firestoreRequest(`/userStats/${owner1Uid}`, normalToken)).status, 403, 'normal user cannot read owner stats')
  assert.equal((await firestoreRequest('/users/some-other-user', normalToken)).status, 403, 'normal user cannot read another profile')

  const staleAdminToken = await tokenFor('unapproved@example.test')
  assert.equal((await firestoreRequest(`/users/${normalUid}`, staleAdminToken)).status, 403, 'unapproved UID with stale Admin and Super Admin claims is denied by the hard UID allowlist')
  const staleAdminEdit = await updateProfileFields(normalUid, staleAdminToken, { name: 'Unauthorized' })
  assert.equal(staleAdminEdit.status, 403, 'unapproved stale claims cannot edit profiles')
  const cleanup = await retireLegacyClaims({ auth, db, owner1Uid, owner2Uid, owner2Email })
  assert.equal(cleanup.length, 3)
  const owner1Claims = (await auth.getUser(owner1Uid)).customClaims
  const owner2Claims = (await auth.getUser(owner2Uid)).customClaims
  const unapprovedClaims = (await auth.getUser('unapproved-super-admin')).customClaims
  assert.equal(owner1Claims.superAdmin, true)
  assert.equal(owner1Claims.admin, undefined)
  assert.equal(owner1Claims.retainedClaim, 'preserved')
  assert.equal(owner2Claims.superAdmin, true)
  assert.equal(owner2Claims.admin, undefined)
  assert.equal(unapprovedClaims.superAdmin, undefined)
  assert.equal(unapprovedClaims.admin, undefined)
  assert.equal(unapprovedClaims.retainedClaim, 'preserved')
  assert.deepEqual((await db.doc('qrCodes/private-synthetic-qr').get()).data(), privateQr, 'role migration must preserve QR documents')
  console.log('PASS: exact two-owner activation, temporary legacy compatibility, allowlisted monitoring, name-only Super Admin profile edits, normal-user ownership, stale claim denial, safe claim cleanup and QR payload isolation.')
}

try {
  await clearEmulators()
  const normalUid = await verifyPublicSignupIsNormal()
  await verifyOwnerMigrationAndReadBoundaries(normalUid)
  console.log('All final two-role Super Admin emulator checks passed against demo-qriovo only.')
} finally { await deleteApp(app) }
