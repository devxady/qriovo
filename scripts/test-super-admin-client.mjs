import assert from 'node:assert/strict'
import * as superAdminService from '../src/lib/superAdminService.js'

const { getManagedAuthSummaries, getSuperAdminOwners, superAdminApiConfigured } = superAdminService
assert.equal(superAdminApiConfigured, false, 'the API stays unavailable unless a valid Vite base URL is configured')
assert.equal(superAdminService.createManagedUser, undefined, 'the client exposes no dashboard account-creation API')
let fetchCalled = false
globalThis.fetch = async () => { fetchCalled = true; throw new Error('fetch must not run without a configured URL') }
const user = { getIdToken: async (forceRefresh) => { assert.equal(forceRefresh, true); return 'synthetic-id-token' } }
await assert.rejects(() => getSuperAdminOwners(user), /trusted Super Admin service is not configured/)
assert.equal(fetchCalled, false, 'an unconfigured browser must not make a privileged request')
assert.deepEqual(await getManagedAuthSummaries(user, []), [], 'an empty request does not call the backend')

let seenRequest
globalThis.fetch = async (url, options) => {
  seenRequest = { url, options }
  return new Response(JSON.stringify({ users: [
    { uid: 'one', role: 'superAdmin', disabled: false, createdAt: '2026-01-01T00:00:00.000Z', lastSignInAt: '2026-02-01T00:00:00.000Z', email: 'private@example.test', idToken: 'private' },
    { uid: 'two', role: 'admin', disabled: true, customClaims: { admin: true } },
  ] }), { status: 200 })
}
const summaries = await getManagedAuthSummaries(user, ['one', 'one', 'two', '', 'three'], 'https://management.example.test/')
assert.equal(seenRequest.url, 'https://management.example.test/v1/super-admin/users/auth?uids=one%2Ctwo%2Cthree')
assert.equal(seenRequest.options.method, 'GET')
assert.equal(seenRequest.options.body, undefined)
assert.equal(seenRequest.options.credentials, 'omit')
assert.equal(seenRequest.options.cache, 'no-store')
assert.equal(seenRequest.options.headers.Authorization, 'Bearer synthetic-id-token')
assert.deepEqual(summaries, [
  { uid: 'one', role: 'superAdmin', disabled: false, emailVerified: false, createdAt: '2026-01-01T00:00:00.000Z', lastSignInAt: '2026-02-01T00:00:00.000Z' },
  { uid: 'two', role: 'normal', disabled: true, emailVerified: false, createdAt: '', lastSignInAt: '' },
])
assert.equal(JSON.stringify(summaries).includes('private@example.test'), false, 'Auth summaries must exclude email and token fields')

globalThis.fetch = async (url, options) => {
  seenRequest = { url, options }
  return new Response(JSON.stringify({ owners: [
    { uid: 'owner-one', email: 'etesting969@gmail.com', status: 'Active', createdAt: '2020-01-01T00:00:00.000Z' },
    { uid: 'owner-two', email: 'owner-two@example.test', status: 'Active' },
    { uid: 'third', email: 'third@example.test' },
  ] }), { status: 200 })
}
const ownerData = await getSuperAdminOwners(user, 'https://management.example.test')
assert.equal(seenRequest.url, 'https://management.example.test/v1/super-admin/owners')
assert.equal(seenRequest.options.method, 'GET')
assert.equal(seenRequest.options.body, undefined)
assert.equal(ownerData.owners.length, 2, 'the frontend must never render a third owner slot')
assert.equal(ownerData.owners[0].slot, 'Owner 1')
assert.equal(ownerData.owners[1].slot, 'Owner 2')

globalThis.fetch = async () => new Response(JSON.stringify({ code: 'permission-denied', message: 'do not display backend internals' }), { status: 403 })
await assert.rejects(() => getSuperAdminOwners(user, 'https://management.example.test'), (error) => {
  assert.equal(error.code, 'permission-denied')
  assert.match(error.message, /Super Admin access was not accepted/)
  assert.doesNotMatch(error.message, /backend internals/)
  return true
})

console.log('PASS: dashboard account-creation API is absent; unconfigured service stays fail-closed; only sanitized Auth summaries and the two approved owner slots use refreshed-token GET requests.')
