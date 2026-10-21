# Super Admin access and monitoring

## Role and ownership model

Qriovo has public Normal User registration and a protected Super Admin dashboard. The dashboard cannot create accounts or assign roles. Super Admin access is managed with the trusted local Firebase Admin SDK workflow in `scripts/manage-super-admin-claim.mjs`.

Exactly two owner UIDs are intended. The project owner has verified Owner 1 as `etesting969@gmail.com` (`DgXAZDj0S6NM0LrbhB7QzqzI3Az1`) and Owner 2 as `aditya07acc@gmail.com` (`raSnrlncf0hM0FhmCTsxkbN59Qq1`). The local Firestore Rules contain fail-closed UID markers, and `worker/wrangler.toml` has no owner UID values. Do not replace them with guessed identities.

No production users, claims, Firestore Rules, indexes, Worker or Cloudflare resources are modified by the local application code. Do not deploy or run a production-changing command without explicit approval.

## Dashboard routes

- `/admin` — overview
- `/admin/users` — user profiles and Auth metadata
- `/admin/users/:uid` — account statistics, metadata-only activity and permitted display-name edit
- `/admin/activity` — recent metadata-only activity
- `/admin/analytics` — aggregates of client-reported login and QR events
- `/admin/settings` — fixed, informational owner slots; no promote, replace or demote action
- `/admin/roles` and `/admin/super-admin-settings` redirect to `/admin/settings`
- `/admin/users/create` redirects to `/admin/users` to support old bookmarks

Normal Users create their own accounts through the public Register page. The form and all dashboard-specific account creation code have been removed. Public registration, login, password reset and QR management remain separate and unchanged.

## Read-only Auth metadata Worker

The optional Worker serves only:

| Method and route | Purpose |
| --- | --- |
| `GET /v1/super-admin/users/auth?uids=...` | Return sanitized Auth status for up to 25 requested UIDs |
| `GET /v1/super-admin/owners` | Return the two fixed owner slots and Auth status |

Both routes require an allowed origin and a valid Firebase ID token. The Worker verifies token signature, issuer, audience, expiry and authentication time; checks the `superAdmin` claim, current Auth state and revocation time; and confirms the caller's UID and email against the fixed owner allowlist. The response excludes passwords, tokens and normal-user emails. It never creates or updates Auth users, writes claims, accesses Firestore, reads QR payloads, or uses D1. Only GET is supported for data endpoints.

`VITE_SUPER_ADMIN_API_BASE_URL` remains because All Users and Super Admin Settings use the read-only metadata APIs. It is blank in the local example. The Worker is not deployed. Before production use, review the Google service-account credential approach, allowlist and exact minimum Firebase Auth lookup permission (`firebaseauth.users.get`). The Worker does not need Firestore, Auth user creation or custom-claim permissions.

## Manual owner claim workflow

The CLI has three supported operations: read-only `verify`, `activate`, and `retire-legacy`. It has no account-creation command, generic role editor or account deletion command.

```powershell
gcloud auth application-default login
npm run admin:super-claim -- verify --project qrivo-db-dxa --owner-1-uid DgXAZDj0S6NM0LrbhB7QzqzI3Az1 --owner-2-uid raSnrlncf0hM0FhmCTsxkbN59Qq1 --owner-2-email aditya07acc@gmail.com
npm run admin:super-claim -- activate --project qrivo-db-dxa --owner-1-uid DgXAZDj0S6NM0LrbhB7QzqzI3Az1 --owner-2-uid raSnrlncf0hM0FhmCTsxkbN59Qq1 --owner-2-email aditya07acc@gmail.com
npm run admin:super-claim -- retire-legacy --project qrivo-db-dxa --owner-1-uid DgXAZDj0S6NM0LrbhB7QzqzI3Az1 --owner-2-uid raSnrlncf0hM0FhmCTsxkbN59Qq1 --owner-2-email aditya07acc@gmail.com
```

`verify` checks both existing enabled Auth accounts, exact owner email-to-UID mappings and unapproved existing Super Admin claims. `activate` grants `superAdmin: true` only to the two verified UIDs, preserves unrelated claims and temporarily retains legacy `admin` claims. `retire-legacy` is permitted only after both owners already have the new claim; it removes legacy `admin` and unapproved stale `superAdmin` claims. Changing operations require a typed exact confirmation. Refresh both owner tokens after claim changes.

Do not run this workflow until both UIDs and emails are verified and the exact operation is approved. Keep legacy claims until the rules and dashboard access have been checked. Never assign the Super Admin role from the browser.

## Firestore authorization and privacy

`firestore.rules` fails closed until both approved owner UID markers are replaced with verified UIDs. `isSuperAdmin()` requires the signed-in user's `superAdmin: true` claim and one of those exact UIDs.

Super Admin reads are limited to user profiles, user statistics and metadata-only activity events. Super Admin profile updates can change only the display name. Rules provide no Super Admin access to `qrCodes`; QR payloads and design data remain owner-only. The owner allowlist and registration ownership checks must remain intact.

Normal User QR operations use atomic Firestore transactions with `getAfter()` checks linking the QR document, activity event and count. The 25-code ceiling is enforced in rules; client code cannot change the summary counter independently. QR mutations fail closed while `systemSettings/qrQuota.qrWritesPaused` is missing or not `false`. Over-limit existing QR documents remain preserved; create/duplicate are blocked until the account falls below the limit, while editing, downloading and deleting existing records remain available under current rules.

Composite indexes in `firestore.indexes.json` support the activity queries:

- `activityEvents(userId ASC, createdAt DESC)`
- `activityEvents(type ASC, createdAt ASC)`

## Suggested production sequence

1. Independently verify the exact UIDs and emails of the two existing owner accounts.
2. Run the read-only owner `verify` command and review its output.
3. Publish reviewed UID-bound Firestore Rules and wait for required indexes to report Enabled. Do not change the owner allowlist or QR rules beyond the reviewed values.
4. Activate `superAdmin: true` for the two verified UIDs using the CLI's exact confirmation. Refresh their ID tokens and verify dashboard reads, profile-name-only updates, private QR denial and Normal User ownership.
5. Retire legacy claims only after both owners confirm new access and all role-boundary checks pass.
6. If the Auth metadata Worker is needed, review and deploy it separately with owner UIDs, exact origin, least-privilege Auth lookup credentials and no Firestore/D1 bindings. Then configure `VITE_SUPER_ADMIN_API_BASE_URL`.
7. Website deployment is a separate approval and operation.

Do not combine these changes into one approval. If a stage fails, stop and preserve existing Auth and Firestore data. The production sequence above is guidance, not evidence that any step has been run.

## Emulator and build checks

```powershell
npm run test:super-admin-emulator
npm run test:super-admin-worker
npm run test:super-admin-client
npm run test:migration-emulator
npm run build
```

The Super Admin emulator suite uses only `demo-qriovo` with synthetic UIDs, temporary rules and emulator Auth/Firestore data. It checks public signup/profile initialization, owner claim boundaries, metadata reads, display-name-only updates, and QR payload denial. Worker tests use synthetic signed tokens and mocked Google APIs. These checks do not verify Firebase Console state, production index readiness, Cloudflare settings, live IAM or production owner access.
