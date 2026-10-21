function resolveApiBaseUrl(value) {
  const candidate = String(value || '').trim().replace(/\/+$/, '')
  if (!candidate) return ''
  try {
    const url = new URL(candidate)
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) return ''
    return candidate
  } catch { return '' }
}

const apiBaseUrl = resolveApiBaseUrl(import.meta.env?.VITE_SUPER_ADMIN_API_BASE_URL)
export const superAdminApiConfigured = Boolean(apiBaseUrl)

const errorMessages = {
  'auth/required': 'Your session could not be verified. Sign in again and retry.',
  'permission-denied': 'Your Super Admin access was not accepted by the trusted service.',
  'invalid-argument': 'Check the submitted details and try again.',
  'unavailable': 'The trusted Super Admin service is temporarily unavailable.',
}

async function requestSuperAdminApi(user, path, baseUrl = apiBaseUrl) {
  const safeBaseUrl = resolveApiBaseUrl(baseUrl)
  if (!safeBaseUrl) {
    const error = new Error('The trusted Super Admin service is not configured. Auth metadata is unavailable.')
    error.code = 'super-admin/backend-not-configured'
    throw error
  }
  if (!user) {
    const error = new Error(errorMessages['auth/required'])
    error.code = 'auth/required'
    throw error
  }

  const token = await user.getIdToken(true)
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const response = await fetch(`${safeBaseUrl}/v1/super-admin${path}`, {
    method: 'GET',
    headers,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const code = typeof payload.code === 'string' ? payload.code : 'unavailable'
    const error = new Error(errorMessages[code] || errorMessages.unavailable)
    error.code = code
    throw error
  }
  return payload
}

function publicAuthSummary(row = {}) {
  return {
    uid: typeof row.uid === 'string' ? row.uid : '',
    role: row.role === 'superAdmin' ? 'superAdmin' : 'normal',
    disabled: row.disabled === true,
    emailVerified: row.emailVerified === true,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    lastSignInAt: typeof row.lastSignInAt === 'string' ? row.lastSignInAt : '',
  }
}

export async function getManagedAuthSummaries(user, uids = [], baseUrl = apiBaseUrl) {
  const uniqueUids = [...new Set(uids.filter((uid) => typeof uid === 'string' && uid.length > 0))].slice(0, 25)
  if (!uniqueUids.length) return []
  const params = new URLSearchParams({ uids: uniqueUids.join(',') })
  const payload = await requestSuperAdminApi(user, `/users/auth?${params}`, baseUrl)
  return Array.isArray(payload.users) ? payload.users.map(publicAuthSummary).filter((row) => row.uid) : []
}

export async function getSuperAdminOwners(user, baseUrl = apiBaseUrl) {
  const payload = await requestSuperAdminApi(user, '/owners', baseUrl)
  return {
    owners: Array.isArray(payload.owners) ? payload.owners.slice(0, 2).map((row, index) => ({
      slot: index === 0 ? 'Owner 1' : 'Owner 2',
      email: typeof row.email === 'string' ? row.email : '',
      uid: typeof row.uid === 'string' ? row.uid : '',
      status: typeof row.status === 'string' ? row.status : 'Unavailable',
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      lastSignInAt: typeof row.lastSignInAt === 'string' ? row.lastSignInAt : '',
      approved: true,
    })) : [],
  }
}
