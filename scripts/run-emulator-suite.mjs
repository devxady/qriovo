import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const allowedSuites = new Set(['test-migration-emulator.mjs', 'test-super-admin-emulator.mjs'])
const targetName = String(process.argv[2] || '')
if (!allowedSuites.has(targetName)) throw new Error('Specify one approved emulator suite; production rules and Firebase resources are never targeted.')

const rulesPath = resolve(root, 'firestore.rules')
const rulesFile = `.qriovo-emulator-rules-${process.pid}.rules`
const configFile = `.qriovo-emulator-config-${process.pid}.json`
const testRulesPath = resolve(root, rulesFile)
const testConfigPath = resolve(root, configFile)
const emulatorConfigHome = resolve(root, `.qriovo-emulator-xdg-${process.pid}`)
const targetScript = resolve(root, 'scripts', targetName)

try {
  const sourceRules = await readFile(rulesPath, 'utf8')
  const testRules = sourceRules
    .replaceAll('__OWNER_1_FIREBASE_UID__', 'synthetic-owner-one')
    .replaceAll('__OWNER_2_FIREBASE_UID__', 'synthetic-owner-two')
  if (testRules.includes('__OWNER_1_FIREBASE_UID__') || testRules.includes('__OWNER_2_FIREBASE_UID__')) throw new Error('Could not resolve test-only Super Admin UIDs.')
  await writeFile(testRulesPath, testRules, 'utf8')
  await writeFile(testConfigPath, JSON.stringify({
    firestore: { rules: rulesFile, indexes: 'firestore.indexes.json' },
    emulators: { auth: { port: 9099 }, firestore: { port: 8080 }, ui: { enabled: false } },
  }, null, 2), 'utf8')

  const firebaseCli = resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js')
  const command = `node "${targetScript}"`
  const result = spawnSync(process.execPath, [firebaseCli, 'emulators:exec', '--config', configFile, '--project', 'demo-qriovo', '--only', 'auth,firestore', command], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, XDG_CONFIG_HOME: emulatorConfigHome, GCLOUD_PROJECT: 'demo-qriovo', FIREBASE_PROJECT_ID: 'demo-qriovo' },
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await Promise.all([
    rm(testRulesPath, { force: true }),
    rm(testConfigPath, { force: true }),
    rm(emulatorConfigHome, { recursive: true, force: true }),
  ])
}
