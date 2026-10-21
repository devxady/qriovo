const authMessages = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/user-not-found': 'The email or password is incorrect.',
  'auth/too-many-requests': 'Too many attempts were made. Please wait a little and try again.',
  'auth/network-request-failed': 'We could not reach the account service. Check your connection and try again.',
  'auth/email-already-in-use': 'An account could not be created with these details. Try logging in or use another email address.',
  'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
  'auth/operation-not-allowed': 'Email and password sign-in is not enabled for this Firebase project.',
  'auth/configuration-not-ready': 'Account services are not configured yet. Add the Firebase Web App values to the local environment and restart the app.',
  'auth/profile-save-failed': 'Your account was created, but its profile could not be saved. You can retry profile setup below.',
  'auth/profile-name-required': 'Enter your full name to finish profile setup.',
  'resource-exhausted': 'You have reached the limit of 25 saved QR codes. Remove one from your dashboard to create space.',
  'failed-precondition': 'Your account storage counter needs administrator reconciliation before this QR action can continue.',
}

const firestoreMessages = {
  'permission-denied': 'Firebase denied this request. Check your account access and the published Firestore rules.',
  unavailable: 'Firestore is temporarily unavailable. Check your connection and try again.',
  'network-request-failed': 'We could not reach Firebase. Check your connection and try again.',
  unauthenticated: 'Your sign-in has expired. Please log in again.',
  'not-found': 'This QR code could not be found in your account.',
  'invalid-argument': 'Some QR code details are invalid. Review them and try again.',
}

export function firebaseErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error?.fieldErrors?.content) return error.fieldErrors.content
  const code = String(error?.code || '').replace(/^firebase\//, '')
  const shortCode = code.split('/').at(-1)
  return authMessages[code] || authMessages[`auth/${shortCode}`] || firestoreMessages[shortCode] || fallback
}

export function isProfileSaveError(error) {
  return error?.code === 'auth/profile-save-failed'
}
