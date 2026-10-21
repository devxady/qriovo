import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from '../config/firebase.js'
import { trackSuccessfulLogin } from '../lib/activityService.js'

const AuthContext = createContext(null)

function requireFirebase() {
  if (!auth || !db) {
    const error = new Error('Firebase has not been configured for this app.')
    error.code = 'auth/configuration-not-ready'
    throw error
  }
}

async function saveUserProfile(user, name = user.displayName || '', { initializeStats = false } = {}) {
  const profileRef = doc(db, 'users', user.uid)
  const statsRef = doc(db, 'userStats', user.uid)
  const existingProfile = await getDoc(profileRef)
  const profile = { name: name.trim() }
  if (existingProfile.exists()) {
    await updateDoc(profileRef, profile)
  } else {
    const batch = writeBatch(db)
    batch.set(profileRef, { ...profile, email: user.email || '', createdAt: serverTimestamp() })
    if (initializeStats) batch.set(statsRef, initialUserStats())
    try {
      await batch.commit()
    } catch (error) {
      // During a staged rules rollout, the current published rules do not
      // know about userStats yet. Preserve profile creation under those rules;
      // the one-time Admin SDK migration will add the missing zero counter.
      if (!initializeStats || error?.code !== 'permission-denied') throw error
      await setDoc(profileRef, { ...profile, email: user.email || '', createdAt: serverTimestamp() })
    }
  }
}

function initialUserStats() {
  return {
    qrCount: 0,
    loginCount: 0,
    lastLoginAt: null,
    lastActivityAt: null,
    lastQrCreatedAt: null,
    lastActivityType: null,
    lastActivityQrId: null,
    lastActivityEventId: null,
    activityTrackingStartedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileSetupPending, setProfileSetupPending] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileName, setProfileName] = useState('')
  const profileCheckVersion = useRef(0)

  useEffect(() => {
    if (!firebaseConfigured || !auth || !db) {
      setCurrentUser(null)
      setLoading(false)
      return undefined
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const versionAtCheck = ++profileCheckVersion.current
      setCurrentUser(user)
      setLoading(false)
      if (!user) {
        setProfileSetupPending(false)
        setProfileError('')
        setProfileName('')
        return
      }
      try {
        const profile = await getDoc(doc(db, 'users', user.uid))
        if (versionAtCheck !== profileCheckVersion.current) return
        if (!profile.exists()) {
          setProfileSetupPending(true)
          setProfileError('Your account is signed in, but its profile still needs to be created.')
          setProfileName(user.displayName || '')
        } else {
          setProfileSetupPending(false)
          setProfileError('')
          setProfileName(String(profile.data().name || user.displayName || ''))
        }
      } catch {
        // A profile lookup failing must not erase or block a valid Auth session.
      }
    })
    return unsubscribe
  }, [])

  const login = useCallback(async (email, password, rememberMe = true) => {
    requireFirebase()
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
    // Never count Auth state restoration as a login. This runs only after the
    // explicit sign-in call succeeds; tracking is best-effort until a trusted
    // server-side event receiver is introduced.
    try { await trackSuccessfulLogin(credential.user, 'email') } catch { /* Auth success must not depend on optional telemetry. */ }
    return credential
  }, [])

  const register = useCallback(async (name, email, password) => {
    requireFirebase()
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
    try {
      await updateProfile(credential.user, { displayName: name.trim() })
      await saveUserProfile(credential.user, name, { initializeStats: true })
      profileCheckVersion.current += 1
      setProfileSetupPending(false)
      setProfileError('')
      setProfileName(name.trim())
      setCurrentUser(credential.user)
      try { sessionStorage.removeItem('qriovo-pending-profile-v1') } catch { /* Storage can be unavailable. */ }
      return credential
    } catch (cause) {
      setProfileSetupPending(true)
      setProfileError('Your account is active, but the profile was not saved. Retry profile setup to finish registration.')
      setProfileName(name.trim())
      try { sessionStorage.setItem('qriovo-pending-profile-v1', JSON.stringify({ uid: credential.user.uid, name: name.trim() })) } catch { /* Recovery can use the Auth display name. */ }
      const error = new Error('The Firebase account was created, but profile setup did not finish.')
      error.code = 'auth/profile-save-failed'
      error.cause = cause
      throw error
    }
  }, [])

  const retryProfileSetup = useCallback(async (nameOverride = '') => {
    requireFirebase()
    if (!auth.currentUser) throw new Error('Please sign in again to finish profile setup.')
    try {
      let recoveryName = String(nameOverride || profileName || auth.currentUser.displayName || '').trim()
      try {
        const pending = JSON.parse(sessionStorage.getItem('qriovo-pending-profile-v1') || 'null')
        if (pending?.uid === auth.currentUser.uid && pending.name) recoveryName = pending.name
      } catch { /* Use the Firebase Auth display name when storage is unavailable. */ }
      if (!recoveryName) {
        const error = new Error('Enter your full name to finish profile setup.')
        error.code = 'auth/profile-name-required'
        throw error
      }
      if (recoveryName && auth.currentUser.displayName !== recoveryName) await updateProfile(auth.currentUser, { displayName: recoveryName })
      await saveUserProfile(auth.currentUser, recoveryName, { initializeStats: true })
      profileCheckVersion.current += 1
      setProfileSetupPending(false)
      setProfileError('')
      setProfileName(recoveryName)
      setCurrentUser(auth.currentUser)
      try { sessionStorage.removeItem('qriovo-pending-profile-v1') } catch { /* Storage can be unavailable. */ }
      return true
    } catch (error) {
      setProfileSetupPending(true)
      setProfileError('Profile setup could not be completed. Check your connection and Firestore rules, then retry.')
      throw error
    }
  }, [profileName])

  const logout = useCallback(async () => {
    requireFirebase()
    await signOut(auth)
    try { sessionStorage.removeItem('qriovo-pending-qr-draft-v1') } catch { /* Storage can be unavailable. */ }
  }, [])

  const resetPassword = useCallback(async (email) => {
    requireFirebase()
    return sendPasswordResetEmail(auth, email.trim())
  }, [])

  const value = useMemo(() => ({
    currentUser,
    loading,
    configured: firebaseConfigured,
    profileSetupPending,
    profileError,
    profileName,
    login,
    register,
    logout,
    resetPassword,
    retryProfileSetup,
  }), [currentUser, loading, profileSetupPending, profileError, profileName, login, register, logout, resetPassword, retryProfileSetup])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
