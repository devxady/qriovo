import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const productionProject = 'qrivo-db-dxa'
const emulatorProject = 'demo-qriovo'
const ownerOneEmail = 'etesting969@gmail.com'

async function listAllUsers(auth) {
  const users = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    users.push(...page.users)
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

export async function verifyOwnerAllowlist({ auth, owner1Uid, owner2Uid, owner2Email }) {
  if (!owner1Uid || !owner2Uid || owner1Uid === owner2Uid || !owner2Email) throw new Error('Two distinct owner UIDs and Owner 2 email are required. No claims changed.')
  const [owner1, owner2, allUsers] = await Promise.all([
    auth.getUser(owner1Uid), auth.getUser(owner2Uid), listAllUsers(auth),
  ])
  if (String(owner1.email || '').toLowerCase() !== ownerOneEmail) throw new Error(`Owner 1 UID must resolve to ${ownerOneEmail}. No claims changed.`)
  if (String(owner2.email || '').toLowerCase() !== owner2Email.trim().toLowerCase()) throw new Error('Owner 2 UID does not match the exact owner-provided email. No claims changed.')
  if (owner1.disabled || owner2.disabled) throw new Error('An approved owner account is disabled. No claims changed.')
  const allowed = new Set([owner1Uid, owner2Uid])
  const unapprovedSuperAdmins = allUsers.filter((user) => user.customClaims?.superAdmin === true && !allowed.has(user.uid))
  return { owners: [owner1, owner2], allUsers, unapprovedSuperAdmins }
}

async function recordOwnerClaimEvent(db, uid, action) {
  if (!db) return
  await db.collection('adminManagementEvents').add({ targetUid: uid, action, actor: 'trusted-owner-operator', createdAt: FieldValue.serverTimestamp() })
}

export async function activateOwnerClaims({ auth, db, owner1Uid, owner2Uid, owner2Email }) {
  const verification = await verifyOwnerAllowlist({ auth, owner1Uid, owner2Uid, owner2Email })
  const changes = []
  for (const user of verification.owners) {
    if (user.customClaims?.superAdmin === true) { changes.push({ uid: user.uid, changed: false }); continue }
    const claims = { ...(user.customClaims || {}), superAdmin: true }
    await auth.setCustomUserClaims(user.uid, claims)
    await recordOwnerClaimEvent(db, user.uid, 'super_admin_owner_activated')
    changes.push({ uid: user.uid, changed: true })
  }
  return changes
}

export async function retireLegacyClaims({ auth, db, owner1Uid, owner2Uid, owner2Email }) {
  const verification = await verifyOwnerAllowlist({ auth, owner1Uid, owner2Uid, owner2Email })
  const ownersReady = verification.owners.every((user) => user.customClaims?.superAdmin === true)
  if (!ownersReady) throw new Error('Both approved owners must already have superAdmin:true before legacy claims are retired.')
  const ownerUids = new Set([owner1Uid, owner2Uid])
  const updates = []
  for (const user of verification.allUsers) {
    const claims = { ...(user.customClaims || {}) }
    const removeLegacyAdmin = claims.admin === true
    const removeUnapprovedOwner = claims.superAdmin === true && !ownerUids.has(user.uid)
    if (!removeLegacyAdmin && !removeUnapprovedOwner) continue
    if (removeLegacyAdmin) delete claims.admin
    if (removeUnapprovedOwner) delete claims.superAdmin
    await auth.setCustomUserClaims(user.uid, claims)
    const action = removeLegacyAdmin && removeUnapprovedOwner ? 'legacy_admin_and_unapproved_super_admin_removed' : removeLegacyAdmin ? 'legacy_admin_removed' : 'unapproved_super_admin_removed'
    await recordOwnerClaimEvent(db, user.uid, action)
    updates.push({ uid: user.uid, action })
  }
  return updates
}

function parseFlags(args) {
  const [action, ...parts] = args
  const flags = {}
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part.startsWith('--')) throw new Error(`Unexpected argument: ${part}`)
    const key = part.slice(2)
    if (key === 'emulator') flags[key] = true
    else {
      const value = parts[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
      flags[key] = value; index += 1
    }
  }
  return { action, flags }
}

async function exactConfirmation(question, expected) {
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question(`${question} Type exactly "${expected}": `)
    if (answer !== expected) throw new Error('Action not confirmed; no custom claims were changed.')
  } finally { rl.close() }
}

async function main() {
  const { action, flags } = parseFlags(process.argv.slice(2))
  const projectId = flags.project
  const owner1Uid = flags['owner-1-uid']
  const owner2Uid = flags['owner-2-uid']
  const owner2Email = flags['owner-2-email']
  if (!['verify', 'activate', 'retire-legacy'].includes(action) || !projectId || !owner1Uid || !owner2Uid || !owner2Email) {
    throw new Error('Usage: npm run admin:super-claim -- verify|activate|retire-legacy --project <id> --owner-1-uid <uid> --owner-2-uid <uid> --owner-2-email <email> [--emulator]')
  }
  if (flags.emulator) {
    if (projectId !== emulatorProject) throw new Error(`Emulator mode only accepts ${emulatorProject}.`)
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
    process.env.GCLOUD_PROJECT = emulatorProject
  } else {
    if (projectId !== productionProject) throw new Error(`This command only accepts ${productionProject}, or ${emulatorProject} with --emulator.`)
    if (action === 'activate') await exactConfirmation(`Activate only the two verified owner claims in ${projectId}.`, `ACTIVATE TWO OWNER CLAIMS ${projectId} ${owner1Uid} ${owner2Uid}`)
  }

  const app = flags.emulator
    ? initializeApp({ projectId }, `qriovo-owner-claims-emulator-${Date.now()}`)
    : initializeApp({ credential: applicationDefault(), projectId }, `qriovo-owner-claims-${Date.now()}`)
  try {
    if (app.options.projectId !== projectId) throw new Error('Admin SDK project does not match the requested project.')
    const auth = getAuth(app)
    const db = getFirestore(app)
    const verification = await verifyOwnerAllowlist({ auth, owner1Uid, owner2Uid, owner2Email })
    if (action === 'verify') {
      console.log(JSON.stringify({ owners: verification.owners.map((user) => ({ uid: user.uid, email: user.email, disabled: user.disabled, superAdmin: user.customClaims?.superAdmin === true, legacyAdmin: user.customClaims?.admin === true })), unapprovedSuperAdminUids: verification.unapprovedSuperAdmins.map((user) => user.uid) }, null, 2))
      return
    }
    if (action === 'activate') {
      const result = await activateOwnerClaims({ auth, db, owner1Uid, owner2Uid, owner2Email })
      console.log(`Owner claims processed. ${result.filter((row) => row.changed).length} claim(s) changed. Refresh both owner tokens before publishing the new rules.`)
      return
    }
    const verificationAfter = await verifyOwnerAllowlist({ auth, owner1Uid, owner2Uid, owner2Email })
    if (!verificationAfter.owners.every((user) => user.customClaims?.superAdmin === true)) throw new Error('Both approved owners must have superAdmin:true before legacy claims are retired.')
    const pending = verificationAfter.allUsers.filter((user) => user.customClaims?.admin === true || (user.customClaims?.superAdmin === true && ![owner1Uid, owner2Uid].includes(user.uid)))
    if (!flags.emulator) await exactConfirmation(`Remove legacy Admin and unapproved Super Admin claims from ${pending.length} account(s) in ${projectId}.`, `RETIRE LEGACY CLAIMS ${projectId} ${pending.length}`)
    const result = await retireLegacyClaims({ auth, db, owner1Uid, owner2Uid, owner2Email })
    console.log(`Legacy claim cleanup completed for ${result.length} account(s). User and QR documents were not changed.`)
  } finally { await app.delete() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message || 'Owner claim operation failed.'); process.exitCode = 1 })
}
