import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const env = import.meta.env

export const requiredFirebaseEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

export const missingFirebaseEnv = requiredFirebaseEnv.filter((key) => !String(env[key] || '').trim())
export const firebaseConfigured = missingFirebaseEnv.length === 0

const app = firebaseConfigured
  ? (getApps().length ? getApp() : initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }))
  : null

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null

// Optional local-only routing so authenticated UI flows can be exercised
// against Firebase Emulator Suite without touching the configured project.
if (import.meta.env.DEV && env.VITE_USE_FIREBASE_EMULATORS === 'true' && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
