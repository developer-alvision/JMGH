# Jyothsna Maternity Hospital

The changes requested in the October photos are documented in [IMAGE-CHANGES.md](IMAGE-CHANGES.md). Run `npm run test:images` with the local app running to verify those features.

A Firebase web application for patient registration, appointments and OP queue, clinical consultations, maternity care, admissions, pharmacy, billing, reports, staff and hospital administration. Changes use Firestore listeners and transactions so connected staff see current records.

## Run locally

Requirements: Node.js 22 or later and Java 21 or later.

```powershell
npm ci
npm --prefix functions ci
npm run setup:java  # Windows only; skip if Java 21+ is installed
npm start
```

Open **http://127.0.0.1:5000**. The start command builds the app, starts Firebase Auth, Firestore, Functions and Storage emulators, and seeds demonstration records once. The local project is `demo-jyothsna-hms`; localhost cannot connect to the live hospital database. External communications and payment integrations are disabled locally. First startup requires internet to download the emulator runtimes. Firebase browser libraries are included in the build; fonts/icons and optional external integrations may still require internet.

Local sign-in: **admin@jyothsna.test / DemoHospital123!**. Other test accounts use the same password: `doctor`, `nurse`, `receptionist`, `billing_staff`, `pharmacist`, `lab_technician`, and `owner` at `@jyothsna.test`. These accounts exist only in the local emulators. Sample patient names are prefixed with “Demo”.

Stop using Ctrl+C to save local data in `.emulator-data`; subsequent runs import it. `npm run seed` preserves an existing seed. If a port is already in use, stop the previous local app before starting another. Ports: app 5000, functions 5001, database 8080, authentication 9099, storage 9199. Local services bind to loopback, not the LAN.

## Verification

```powershell
npm run check        # syntax and missing local page assets
npm test             # focused transaction regression tests
npm run build        # production files in dist/
npm run test:e2e     # with npm start running; uses Chrome or bundled Chromium
npm run test:rules   # database/storage permissions against isolated demo project
```

The browser checks run against local emulators only and create test records. Test evidence is saved to `test-results/`. Database permission tests have their own command documented with the test file and use a separate demo project. Real provider integrations require their own sandbox acceptance checks.

## Deployment

The existing project is **YOUR-FIREBASE-PROJECT-ID**. Firebase Hosting deploys only `dist/`; local seed tools, tests, server sources and credentials are excluded.

```powershell
npx firebase login
npm run check
npm test
npm run build
npm run deploy
```

Website: https://YOUR-FIREBASE-PROJECT-ID.web.app

The default deployment builds nine core functions in `functions/core.cjs`; it requires no optional payment or messaging secrets. Provider integrations remain in `functions/index.js` and can be deployed with `node scripts/deploy.cjs --all-local-functions` after their secrets are configured.

Functions are in `asia-south1`. Configure billing, email/WhatsApp/SMS, backup buckets and the associated provider secrets before enabling those integrations. See [INTEGRATIONS.md](INTEGRATIONS.md). A deployment does not prove provider delivery or backup restoration; these require valid provider accounts and acceptance checks.

Staff accounts must have an active `/staff/{auth.uid}` profile with an allowed role. Existing legacy profiles are synchronized by `syncStaffUid` at login. New staff are created by an administrator from Staff. Never use the local demo seed against production; it is intentionally locked to the emulator project.

The patient portal requires a PIN assigned by authorized staff. The public queue displays tokens and doctors without publishing patient identities. Production clinical workflows, fees and document templates should be reviewed by hospital staff before operational use.
