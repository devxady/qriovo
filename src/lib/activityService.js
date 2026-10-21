import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../config/firebase.js'

// These are explicitly client-reported events. They are useful for operational
// visibility, but cannot prove that a human performed the action.
export async function trackSuccessfulLogin(user, authMethod = 'email') {
  if (!db || !user?.uid) return false
  const stats = doc(db, 'userStats', user.uid)
  const event = doc(collection(db, 'activityEvents'))
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(stats)
    if (!snapshot.exists()) throw new Error('Activity tracking is not initialized for this account.')
    const loginCount = Number(snapshot.data().loginCount)
    if (!Number.isSafeInteger(loginCount) || loginCount < 0) throw new Error('Activity tracking needs reconciliation.')
    transaction.update(stats, {
      loginCount: loginCount + 1,
      lastLoginAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityType: 'login',
      lastActivityEventId: event.id,
      updatedAt: serverTimestamp(),
    })
    transaction.set(event, {
      userId: user.uid,
      type: 'login',
      authMethod: ['email', 'google'].includes(authMethod) ? authMethod : 'other',
      createdAt: serverTimestamp(),
    })
  })
  return true
}
