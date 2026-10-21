import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as signJwt } from 'node:crypto'
import { handleRequest, verifyFirebaseIdToken } from '../worker/index.js'

const projectId = 'demo-qriovo'
const origin = 'http://localhost:5173'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

function derElement(tag, value) {
  const bytes = Buffer.from(value)
  if (bytes.length < 128) return Buffer.concat([Buffer.from([tag, bytes.length]), bytes])
  const encodedLength = []
  let remaining = bytes.length
  while (remaining > 0) { encodedLength.unshift(remaining & 255); remaining >>>= 8 }
  return Buffer.concat([Buffer.from([tag, 0x80 | encodedLength.length, ...encodedLength]), bytes])
}

function derSequence(...children) { return derElement(0x30, Buffer.concat(children)) }

const certAlgorithm = derSequence(derElement(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b])), derElement(0x05, Buffer.alloc(0)))
const validity = derSequence(derElement(0x17, Buffer.from('260101000000Z')), derElement(0x17, Buffer.from('270101000000Z')))
const certificateDer = derSequence(
  derSequence(derElement(0x02, Buffer.from([1])), certAlgorithm, derSequence(), validity, derSequence(), publicKey.export({ format: 'der', type: 'spki' })),
  certAlgorithm,
  derElement(0x03, Buffer.from([0, 1])),
)
const testCertificate = `-----BEGIN CERTIFICATE-----\n${certificateDer.toString('base64')}\n-----END CERTIFICATE-----`

function makeSignedIdToken(claims, signingKey = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic-cert' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const message = `${header}.${payload}`
  return `${message}.${signJwt('RSA-SHA256', Buffer.from(message), signingKey).toString('base64url')}`
}

const accounts = new Map([
  ['owner-one', { localId: 'owner-one', email: 'etesting969@gmail.com', disabled: false, customAttributes: JSON.stringify({ superAdmin: true }), validSince: '0', createdAt: String(Date.now() - 1000000), lastLoginAt: String(Date.now() - 1000), emailVerified: true }],
  ['owner-two', { localId: 'owner-two', email: 'owner-two@example.test', disabled: false, customAttributes: JSON.stringify({ superAdmin: true }), validSince: '0', createdAt: String(Date.now() - 900000), lastLoginAt: String(Date.now() - 2000), emailVerified: true }],
  ['normal-user', { localId: 'normal-user', email: 'private-user@example.test', disabled: false, customAttributes: '', validSince: '0', createdAt: String(Date.now() - 800000), lastLoginAt: '', emailVerified: false }],
  ['unapproved-admin', { localId: 'unapproved-admin', email: 'unapproved@example.test', disabled: false, customAttributes: JSON.stringify({ superAdmin: true }), validSince: '0' }],
])
const requestLog = []
const env = {
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_WEB_API_KEY: 'fake-api-key',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'synthetic-worker@example.test',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKeyPem,
  ALLOWED_ORIGINS: origin,
  OWNER_1_UID: 'owner-one',
  OWNER_2_UID: 'owner-two',
  OWNER_2_EMAIL: 'owner-two@example.test',
}

async function fetcher(requestInfo, options = {}) {
  const url = new URL(typeof requestInfo === 'string' ? requestInfo : requestInfo instanceof URL ? requestInfo.href : requestInfo.url)
  requestLog.push({ url: url.toString(), method: options.method || 'GET', body: typeof options.body === 'string' ? options.body : '' })
  if (url.href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-service-token', expires_in: 3600 })
  if (url.pathname.endsWith('/accounts:lookup')) {
    const body = JSON.parse(options.body || '{}')
    return Response.json({ users: (body.localId || []).map((uid) => accounts.get(uid)).filter(Boolean) })
  }
  throw new Error(`Unexpected Worker network request ${url}`)
}

const ownerClaims = { sub: 'owner-one', aud: projectId, iss: `https://securetoken.google.com/${projectId}`, superAdmin: true, auth_time: Math.floor(Date.now() / 1000) }
const request = (path, { claims = ownerClaims, method = 'GET', body, requestOrigin = origin } = {}) => new Request(`https://worker.example.test${path}`, {
  method,
  headers: { Origin: requestOrigin, Authorization: 'Bearer synthetic-token', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})

async function handle(requestObject, claims = ownerClaims) {
  return handleRequest(requestObject, env, { fetcher, verifyIdToken: async () => claims })
}

const userCountBefore = accounts.size
const removedCreateResponse = await handle(request('/v1/super-admin/users', { method: 'POST', body: { email: 'should-not-create@example.test' } }))
assert.equal(removedCreateResponse.status, 404, 'account-creation route is not exposed')
assert.equal(accounts.size, userCountBefore, 'the old endpoint cannot create or change Auth users')

const authMetadataResponse = await handle(request('/v1/super-admin/users/auth?uids=normal-user,owner-one,missing-user'))
assert.equal(authMetadataResponse.status, 200)
const authMetadata = await authMetadataResponse.json()
assert.deepEqual(authMetadata.users.map(({ uid, role }) => ({ uid, role })), [
  { uid: 'normal-user', role: 'normal' },
  { uid: 'owner-one', role: 'superAdmin' },
])
assert.equal(JSON.stringify(authMetadata).includes('private-user@example.test'), false, 'Auth summaries never expose user email addresses')
assert.equal(JSON.stringify(authMetadata).includes('private QR'), false, 'Auth summaries never expose QR payloads')

const ownerSettingsResponse = await handle(request('/v1/super-admin/owners'))
assert.equal(ownerSettingsResponse.status, 200)
const settings = await ownerSettingsResponse.json()
assert.equal(settings.owners.length, 2)
assert.equal(settings.owners[0].email, 'etesting969@gmail.com')
assert.equal(settings.owners[0].status, 'Active')
assert.equal(settings.owners[1].email, 'owner-two@example.test')
assert.equal(settings.owners[1].status, 'Active')

const invalidQuery = await handle(request('/v1/super-admin/users/auth?uids='))
assert.equal(invalidQuery.status, 400)
const tooManyUids = Array.from({ length: 26 }, (_, index) => `uid-${index}`).join(',')
assert.equal((await handle(request(`/v1/super-admin/users/auth?uids=${tooManyUids}`))).status, 400)

for (const claims of [
  { sub: 'normal-user', admin: true },
  { sub: 'unapproved-admin', superAdmin: true },
]) {
  const denied = await handle(request('/v1/super-admin/owners', { claims }), claims)
  assert.equal(denied.status, 403, 'only an allowlisted, currently approved owner can access metadata')
}
const ownerTwoClaims = { sub: 'owner-two', aud: projectId, iss: `https://securetoken.google.com/${projectId}`, superAdmin: true, auth_time: Math.floor(Date.now() / 1000) }
assert.equal((await handle(request('/v1/super-admin/owners', { claims: ownerTwoClaims }), ownerTwoClaims)).status, 200, 'the second approved owner remains authorized')

accounts.get('owner-one').validSince = String(Math.floor(Date.now() / 1000))
const revoked = await handle(request('/v1/super-admin/owners'), { ...ownerClaims, auth_time: 1 })
assert.equal(revoked.status, 403, 'a revoked Firebase ID token is rejected')
accounts.get('owner-one').validSince = '0'

const removedAuditResponse = await handle(request('/v1/super-admin/audit'))
assert.equal(removedAuditResponse.status, 404, 'the account-creation audit endpoint is no longer exposed')
assert.equal((await handle(request('/v1/super-admin/users/auth', { method: 'POST' }))).status, 404, 'management APIs accept no POST requests')

const deniedLegacyToken = await handleRequest(request('/v1/super-admin/owners'), env, { fetcher })
assert.equal(deniedLegacyToken.status, 401, 'malformed ID tokens are rejected by the production verifier')
const expiredPayload = { aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: 'owner-one', exp: 1, iat: 0, auth_time: 0 }
const expiredJwt = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'unused' })).toString('base64url')}.${Buffer.from(JSON.stringify(expiredPayload)).toString('base64url')}.invalid`
await assert.rejects(() => verifyFirebaseIdToken(expiredJwt, projectId, fetcher), { code: 'auth/required' })

const nowSeconds = Math.floor(Date.now() / 1000)
const verifierClaims = { aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: 'synthetic-signed-owner', exp: nowSeconds + 3600, iat: nowSeconds, auth_time: nowSeconds }
const certFetcher = async () => new Response(JSON.stringify({ 'synthetic-cert': testCertificate }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } })
const verifiedClaims = await verifyFirebaseIdToken(makeSignedIdToken(verifierClaims), projectId, certFetcher)
assert.equal(verifiedClaims.sub, verifierClaims.sub, 'a valid RSA-signed Firebase token is accepted')
const attackerKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
await assert.rejects(() => verifyFirebaseIdToken(makeSignedIdToken(verifierClaims, attackerKey), projectId, certFetcher), { code: 'auth/required' })

const wrongOrigin = await handleRequest(request('/v1/super-admin/owners', { requestOrigin: 'https://attacker.example' }), env, { fetcher })
assert.equal(wrongOrigin.status, 403, 'unapproved browser origins are rejected')
const preflight = await handleRequest(new Request('https://worker.example.test/v1/super-admin/owners', { method: 'OPTIONS', headers: { Origin: origin } }), env, { fetcher })
assert.equal(preflight.status, 204)
assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')

assert.equal('DB' in env, false, 'read-only Auth metadata does not depend on Cloudflare D1')
assert.equal(requestLog.some((entry) => entry.url.includes('/accounts?')), false, 'the Worker never invokes Auth user creation')
assert.equal(requestLog.some((entry) => entry.url.includes('firestore.googleapis.com')), false, 'the Worker does not access Firestore or QR payloads')
assert.equal(requestLog.every((entry) => !entry.url.includes('/accounts:signInWithPassword')), true, 'the Worker never signs into newly created accounts')

console.log('PASS: read-only Auth/owner APIs, fixed owner allowlist, current claim and revocation checks, Firebase token signature/expiry validation, CORS, sanitized metadata, input bounds, and absence of Auth creation, Firestore writes, D1, and QR payload access.')
