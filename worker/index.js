const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1'
const FIREBASE_CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OWNER_ONE_EMAIL = 'etesting969@gmail.com'

let firebaseCertCache = { expiresAt: 0, certificates: null }
let serviceTokenCache = { expiresAt: 0, token: '' }

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}

function jsonResponse(status, body, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Authorization'
    headers['Access-Control-Max-Age'] = '600'
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers })
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
}

function ownerConfig(env) {
  const owner1 = String(env.OWNER_1_UID || '').trim()
  const owner2 = String(env.OWNER_2_UID || '').trim()
  const owner2Email = String(env.OWNER_2_EMAIL || '').trim().toLowerCase()
  const values = [owner1, owner2].filter(Boolean)
  if (!owner1 || values.length > 2 || new Set(values).size !== values.length) throw new ApiError(503, 'unavailable')
  if (owner2 && !owner2Email) throw new ApiError(503, 'unavailable')
  return { owner1, owner2, owner2Email, uids: values }
}

function requireRuntimeConfig(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_WEB_API_KEY || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new ApiError(503, 'unavailable')
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
}

function readDerNode(bytes, offset) {
  if (offset >= bytes.length) throw new Error('Invalid certificate')
  const tag = bytes[offset]
  let cursor = offset + 1
  let length = bytes[cursor++]
  if (length & 0x80) {
    const lengthBytes = length & 0x7f
    if (lengthBytes === 0 || lengthBytes > 4 || cursor + lengthBytes > bytes.length) throw new Error('Invalid DER length')
    length = 0
    for (let index = 0; index < lengthBytes; index += 1) length = length * 256 + bytes[cursor++]
  }
  const start = cursor
  const end = start + length
  if (end > bytes.length) throw new Error('Invalid DER bounds')
  return { tag, offset, start, end, next: end }
}

function derChildren(bytes, node) {
  const children = []
  let offset = node.start
  while (offset < node.end) {
    const child = readDerNode(bytes, offset)
    children.push(child)
    offset = child.next
  }
  if (offset !== node.end) throw new Error('Invalid DER sequence')
  return children
}

function parseCertificateSpki(pem) {
  const binary = atob(pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''))
  const der = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const certificate = readDerNode(der, 0)
  const [tbs] = derChildren(der, certificate)
  const fields = derChildren(der, tbs)
  const index = fields[0]?.tag === 0xa0 ? 1 : 0
  const spki = fields[index + 5]
  if (!spki || spki.tag !== 0x30) throw new Error('Missing X.509 public key')
  return der.slice(spki.offset, spki.next)
}

async function firebasePublicCertificates(fetcher = fetch) {
  const now = Date.now()
  if (firebaseCertCache.certificates && firebaseCertCache.expiresAt > now) return firebaseCertCache.certificates
  const response = await fetcher(FIREBASE_CERTS, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new ApiError(503, 'unavailable')
  const certificates = await response.json()
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1] || 300)
  firebaseCertCache = { certificates, expiresAt: now + Math.max(60, Math.min(maxAge, 3600)) * 1000 }
  return certificates
}

export async function verifyFirebaseIdToken(token, projectId, fetcher = fetch) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new ApiError(401, 'auth/required')
  let header
  let claims
  try { header = decodeJsonSegment(parts[0]); claims = decodeJsonSegment(parts[1]) }
  catch { throw new ApiError(401, 'auth/required') }
  const now = Math.floor(Date.now() / 1000)
  if (header.alg !== 'RS256' || typeof header.kid !== 'string'
    || claims.aud !== projectId
    || claims.iss !== `https://securetoken.google.com/${projectId}`
    || typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 128
    || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now
    || !Number.isFinite(Number(claims.iat)) || Number(claims.iat) > now + 60
    || !Number.isFinite(Number(claims.auth_time)) || Number(claims.auth_time) > now + 60) {
    throw new ApiError(401, 'auth/required')
  }
  const certificates = await firebasePublicCertificates(fetcher)
  const cert = certificates[header.kid]
  if (!cert) {
    firebaseCertCache = { expiresAt: 0, certificates: null }
    throw new ApiError(401, 'auth/required')
  }
  let spki
  try { spki = parseCertificateSpki(cert) }
  catch { throw new ApiError(503, 'unavailable') }
  let publicKey
  try {
    publicKey = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  } catch { throw new ApiError(503, 'unavailable') }
  const signature = decodeBase64Url(parts[2])
  const signedContent = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedContent)
  if (!valid) throw new ApiError(401, 'auth/required')
  return claims
}

function pemToBytes(pem) {
  const normalized = String(pem).replace(/\\n/g, '\n')
  const binary = atob(normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ''))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function base64Url(bytes) {
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function googleAccessToken(env, fetcher = fetch) {
  const now = Math.floor(Date.now() / 1000)
  if (serviceTokenCache.token && serviceTokenCache.expiresAt > now + 60) return serviceTokenCache.token
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3300,
  })))
  const input = `${header}.${payload}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input))
  const assertion = `${input}.${base64Url(new Uint8Array(signature))}`
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!response.ok) throw new ApiError(503, 'unavailable')
  const body = await response.json()
  if (!body.access_token || !Number.isFinite(Number(body.expires_in))) throw new ApiError(503, 'unavailable')
  serviceTokenCache = { token: body.access_token, expiresAt: now + Number(body.expires_in) }
  return body.access_token
}

async function readJson(response) {
  try { return await response.json() } catch { return {} }
}

async function identityRequest(env, path, { method = 'POST', body, apiKey = true } = {}, fetcher = fetch) {
  const token = await googleAccessToken(env, fetcher)
  const url = new URL(`${IDENTITY_TOOLKIT}/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/${path}`)
  if (apiKey) url.searchParams.set('key', env.FIREBASE_WEB_API_KEY)
  const response = await fetcher(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await readJson(response)
  if (!response.ok) {
    const status = response.status
    const serviceFailure = status >= 500 || status === 401 || status === 403 || status === 429
    throw new ApiError(serviceFailure ? 503 : 400, serviceFailure ? 'unavailable' : 'invalid-argument')
  }
  return payload
}

async function lookupAuthUsers(env, uids, fetcher = fetch) {
  if (!uids.length) return []
  const result = await identityRequest(env, 'accounts:lookup', { body: { localId: uids } }, fetcher)
  return Array.isArray(result.users) ? result.users : []
}

function parseCustomAttributes(user) {
  if (!user?.customAttributes) return {}
  try { return JSON.parse(user.customAttributes) } catch { return {} }
}

function validateRevocation(claims, user) {
  const validSince = Number(user.validSince || 0)
  return !validSince || Number(claims.auth_time) >= validSince
}

async function authenticateAdmin(request, env, fetcher = fetch, tokenVerifier = verifyFirebaseIdToken) {
  requireRuntimeConfig(env)
  const config = ownerConfig(env)
  const authorization = request.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApiError(401, 'auth/required')
  const claims = await tokenVerifier(match[1], env.FIREBASE_PROJECT_ID, fetcher)
  if (!config.uids.includes(claims.sub) || claims.superAdmin !== true) throw new ApiError(403, 'permission-denied')
  const [user] = await lookupAuthUsers(env, [claims.sub], fetcher)
  if (!user || user.disabled || !validateRevocation(claims, user)) throw new ApiError(403, 'permission-denied')
  if (parseCustomAttributes(user).superAdmin !== true) throw new ApiError(403, 'permission-denied')
  const expectedEmail = claims.sub === config.owner1 ? OWNER_ONE_EMAIL : config.owner2Email
  if (!expectedEmail || String(user.email || '').toLowerCase() !== expectedEmail) throw new ApiError(403, 'permission-denied')
  return { claims, user, config }
}

function authMetadata(user, approvedOwnerUids) {
  const claims = parseCustomAttributes(user)
  return {
    uid: user.localId,
    role: approvedOwnerUids.includes(user.localId) && claims.superAdmin === true ? 'superAdmin' : 'normal',
    disabled: user.disabled === true,
    emailVerified: user.emailVerified === true,
    createdAt: user.createdAt ? new Date(Number(user.createdAt)).toISOString() : '',
    lastSignInAt: user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : '',
  }
}

async function listUserAuthMetadata(request, env, actor, fetcher = fetch) {
  const uids = [...new Set(String(new URL(request.url).searchParams.get('uids') || '').split(',').map((uid) => uid.trim()).filter(Boolean))]
  if (!uids.length || uids.length > 25 || uids.some((uid) => uid.length > 128)) throw new ApiError(400, 'invalid-argument')
  const users = await lookupAuthUsers(env, uids, fetcher)
  const allowedOwners = ownerConfig(env).uids
  return { users: users.map((user) => authMetadata(user, allowedOwners)) }
}

async function ownerSettings(env, actor, fetcher = fetch) {
  const config = ownerConfig(env)
  const users = await lookupAuthUsers(env, config.uids, fetcher)
  const byUid = new Map(users.map((user) => [user.localId, user]))
  const owner = (slot, uid, expectedEmail) => {
    const user = uid ? byUid.get(uid) : null
    const claims = parseCustomAttributes(user)
    const verifiedEmail = user?.email && String(user.email).toLowerCase() === expectedEmail
    return {
      slot,
      uid: uid || '',
      email: user?.email || expectedEmail || '',
      status: !uid ? 'Awaiting owner-provided UID' : !user ? 'Account not found' : user.disabled ? 'Disabled' : claims.superAdmin && verifiedEmail ? 'Active' : 'Pending activation',
      createdAt: user?.createdAt ? new Date(Number(user.createdAt)).toISOString() : '',
      lastSignInAt: user?.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : '',
      active: Boolean(user && !user.disabled && claims.superAdmin === true && verifiedEmail),
    }
  }
  return { owners: [owner('Owner 1', config.owner1, OWNER_ONE_EMAIL), owner('Owner 2', config.owner2, config.owner2Email)] }
}

export async function handleRequest(request, env, dependencies = {}) {
  const fetcher = dependencies.fetcher || fetch
  const origin = request.headers.get('origin') || ''
  const origins = allowedOrigins(env)
  if (!origins.includes(origin)) return jsonResponse(403, { code: 'permission-denied' })
  if (request.method === 'OPTIONS') return jsonResponse(204, {}, origin)
  try {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '')
    if (path === '/health' && request.method === 'GET') return jsonResponse(200, { status: 'ok' }, origin)
    if (request.method !== 'GET') return jsonResponse(404, { code: 'unavailable' }, origin)
    const actor = await authenticateAdmin(request, env, fetcher, dependencies.verifyIdToken || verifyFirebaseIdToken)
    if (path === '/v1/super-admin/users/auth') return jsonResponse(200, await listUserAuthMetadata(request, env, actor, fetcher), origin)
    if (path === '/v1/super-admin/owners') return jsonResponse(200, await ownerSettings(env, actor, fetcher), origin)
    return jsonResponse(404, { code: 'unavailable' }, origin)
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503
    const code = error instanceof ApiError ? error.code : 'unavailable'
    return jsonResponse(status, { code }, origin)
  }
}
export default { fetch: handleRequest }
