# Qriovo Super Admin metadata Worker

This optional Cloudflare Worker provides read-only Firebase Authentication metadata to the Super Admin dashboard. It is local source only and is not deployed. The frontend leaves `VITE_SUPER_ADMIN_API_BASE_URL` blank until a trusted Worker URL is intentionally configured.

## Routes

- `GET /v1/super-admin/users/auth?uids=...` — return limited Auth status for up to 25 UIDs. Responses omit email addresses and credential fields.
- `GET /v1/super-admin/owners` — return status for the two fixed owner slots.
- `GET /health` — return a status response for an allowlisted origin.

Data routes require an allowed `Origin` and a valid Firebase ID token. The Worker verifies the Firebase signature, issuer, audience, expiry and authentication time, then checks the current account, claim, revocation timestamp and exact owner UID/email mapping. Only read-only GET methods are supported for data routes; the Worker cannot create Auth accounts or modify claims.

## Data and credentials

The Worker calls Identity Toolkit only to look up existing Auth accounts. It has no Firestore access, never reads QR payloads, and has no D1 binding or database requirement. Its service account should be restricted to the minimum Firebase Auth lookup permission (`firebaseauth.users.get`); it does not need user creation, claim management, Firestore/Datastore, Editor or Owner permissions.

`FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `OWNER_1_UID`, `OWNER_2_UID`, `OWNER_2_EMAIL`, and `ALLOWED_ORIGINS` are needed by the runtime. Use `worker/.dev.vars.example` only as a template for emulator-only values. Never paste production credentials into local test files or expose service-account secrets through Vite variables.

This implementation uses a user-managed RSA private key as a Worker secret to obtain an Identity Toolkit access token. Review the key-management tradeoff, access to Worker secrets, rotation and revocation before any deployment. Do not enable paid Firebase services as part of that review. Owner 1 is bound in code to `etesting969@gmail.com`; Owner 2's UID and email are supplied through the reviewed runtime allowlist. The Worker remains disabled until both owner identities and deployment configuration are reviewed.

## Local tests

The repository test suite runs the Worker in Node with synthetic signed tokens and mocked Google responses:

```powershell
npm run test:super-admin-worker
npm run test:super-admin-client
```

These tests verify auth gating, owner allowlisting, token checks, response sanitization, CORS and absence of account creation/Firestore/D1 access. They do not prove live Google IAM, Cloudflare configuration, Firebase Console state, production origins or billing status.
