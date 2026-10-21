# Qriovo

Qriovo is a responsive QR creation app built with React, Vite and JavaScript. Firebase Authentication and Cloud Firestore support public Normal User accounts and private saved QR codes.

## Local development

Use Node.js 22 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Fill `.env.local` with the Firebase Web App values from Firebase Console → Project settings → Your apps. `.env.local` is ignored by Git. Never put a Firebase service-account key in a `VITE_*` variable.

## User and admin access

Normal Users register themselves on `/register`, sign in on `/login`, and manage only their own saved QR codes. Each account can save up to 25 QR codes. Super Admin access is limited to the two approved owner UIDs, requires a refreshed `superAdmin: true` token, and is managed only through the trusted local Firebase Admin SDK workflow in `scripts/manage-super-admin-claim.mjs`.

## Firestore data and access

- `users/{uid}` stores the account profile. Super Admins can read profiles and update only display names. Users can update only their own display name.
- `qrCodes/{qrId}` stores private QR payload and design. Only its owner can read or change the document; Super Admins cannot read QR documents.
- `userStats/{uid}` stores the reconciled QR count and client-reported activity summary. Super Admins can read summaries; writes are constrained by the published rules.
- `activityEvents/{eventId}` stores immutable metadata-only events. QR payloads are never included.
- `systemSettings/qrQuota` controls the migration pause. Clients cannot read or write this document directly.
- `adminManagementEvents` stores trusted claim migration metadata.

The 25-code limit is enforced by Firestore Rules and atomic `getAfter()` checks. QR writes fail closed unless `systemSettings/qrQuota.qrWritesPaused` is `false`. Existing over-limit records are preserved; owners can edit, download or delete them, but cannot create or duplicate until below the limit.

### Required indexes

`firestore.indexes.json` contains the composite indexes used by activity queries:

- `activityEvents`: `userId` ascending, `createdAt` descending.
- `activityEvents`: `type` ascending, `createdAt` ascending.

Other listed profile, stats and timestamp queries use automatic single-field indexes.

## Super Admin dashboard

Routes:

- `/admin` — Overview
- `/admin/users` — All Users, Auth status, account statistics and search
- `/admin/users/:uid` — user details and permitted display-name edit
- `/admin/activity` — Activity Monitoring
- `/admin/analytics` — aggregated client-reported activity
- `/admin/settings` — two fixed, informational Super Admin owner slots
- `/admin/roles` and `/admin/super-admin-settings` redirect to `/admin/settings`
- `/admin/users/create` redirects to `/admin/users` for old links

The dashboard does not create accounts. Normal Users use public registration, and Super Admin claims are maintained through the local `admin:super-claim` command. The activity and analytics views use Firestore metadata only.

The optional Cloudflare Worker in `worker/` supports only read-only Firebase Auth metadata and fixed owner-slot lookups. It does not create users, modify claims, access Firestore, or use D1. Its `VITE_SUPER_ADMIN_API_BASE_URL` setting is used only for those remaining reads. The Worker is local and not deployed. Its service-account credential design and exact Auth lookup permission must be reviewed before any production deployment.

## Owner claim workflow

The CLI supports a read-only owner check and two explicit phases. It does not create owner accounts or accept generic role promotion/demotion:

```powershell
gcloud auth application-default login
npm run admin:super-claim -- verify --project qrivo-db-dxa --owner-1-uid DgXAZDj0S6NM0LrbhB7QzqzI3Az1 --owner-2-uid raSnrlncf0hM0FhmCTsxkbN59Qq1 --owner-2-email aditya07acc@gmail.com
npm run admin:super-claim -- activate --project qrivo-db-dxa --owner-1-uid DgXAZDj0S6NM0LrbhB7QzqzI3Az1 --owner-2-uid raSnrlncf0hM0FhmCTsxkbN59Qq1 --owner-2-email aditya07acc@gmail.com
npm run admin:super-claim -- retire-legacy --project qrivo-db-dxa --owner-1-uid DgXAZDj0S6NM0LrbhB7QzqzI3Az1 --owner-2-uid raSnrlncf0hM0FhmCTsxkbN59Qq1 --owner-2-email aditya07acc@gmail.com
```

The activation command verifies Owner 1's exact email and Owner 2's owner-provided email against their UIDs, preserves unrelated claims, grants `superAdmin: true` only to those two UIDs, and retains legacy `admin: true` temporarily. After rules and owner access have been verified, `retire-legacy` removes legacy and unapproved stale claims. Both changing commands require an exact interactive confirmation. Do not run them until both owner identities are verified and the operation is explicitly approved.

## User statistics migration

The stats migration is separate from owner role management. It targets `qrivo-db-dxa` only after typed confirmation; emulator tests use `demo-qriovo` only.

```powershell
npm run admin:migrate-stats
npm run test:migration-emulator
```

It pauses QR writes, reconciles `userStats.qrCount` from existing QR documents without deleting or rewriting QR records, then releases the pause on success. An interrupted run keeps the pause active; use the documented `--resume` procedure after reviewing the error. Do not clear `systemSettings/qrQuota.qrWritesPaused` manually.

## Local validation

```powershell
npm run test:migration-emulator
npm run test:super-admin-emulator
npm run test:super-admin-worker
npm run test:super-admin-client
npm run build
```

The emulator suites use only `demo-qriovo`, synthetic users and temporary local rules. They do not connect to `qrivo-db-dxa`. Worker tests mock Google REST responses and do not prove live Cloudflare configuration or Google IAM.

## GitHub Pages

```powershell
npm run build
npm run preview
```

Production uses the `/qriovo/` Vite base and `HashRouter` for GitHub Pages compatibility. The Actions workflow is prepared for a separately approved deployment. Expected URL: <https://devxady.github.io/qriovo/>.

## SEO and branding

The official light/dark Qriovo logos are shared through the reusable `Brand` component. The exact supplied favicon is the source for the PNG sizes, ICO and Apple Touch Icon. `public/og-image.png` is a 1200 × 630 social preview built with the official logo and Qriovo palette.

`site.config.json` is the central source for the public URL, GitHub Pages base path and indexable public routes. Set `VITE_PUBLIC_SITE_URL` in the production build environment if the final domain changes; for a custom root domain, also change `basePath` in `site.config.json` to `/`. Production builds reject localhost URLs. `npm run build` regenerates `public/robots.txt` and `public/sitemap.xml` from that configuration before bundling. Login, registration, account dashboards, QR edit pages, Super Admin pages and not-found routes receive `noindex` metadata in the React application.

The app currently uses `HashRouter` after build. Browser titles and metadata update by route after JavaScript loads, while crawlers initially receive the shared static `index.html` homepage metadata. Hash fragments are not separate HTML documents, so route-specific social previews and search indexing must be checked after deployment; for reliable page-specific crawler metadata, use route-rendered or pre-rendered HTML in a future hosting setup. The GitHub Pages project site also cannot place `robots.txt` at the host-wide `/robots.txt` path from this repository alone.
