# Integrations & operations guide

Every provider below is built, deployed and **switched off by default**. Nothing sends a message, moves
money or leaves the hospital network until an admin turns the matching switch on in
**Staff → Hospital Settings → Integrations**.

Two rules hold everywhere in this codebase:

1. **Secrets never touch the browser or Firestore.** They live only in Firebase Function secrets.
   Firestore holds public switches and endpoints — never a key.
2. **A switch only makes a feature visible.** The Function checks the same switch server-side before
   it does anything, so flipping a flag in the console cannot bypass the check.

---

## One-time deployment

```bash
cd functions && npm install
firebase deploy --only functions,firestore:rules
```

All functions are deployed to **asia-south1**. The browser calls them through `callFunction()` in
`js/helpers.js`, which names that region explicitly — the Firebase SDK would otherwise default to
`us-central1` and every call would 404.

### Secrets

Set only the ones you are ready to use, then redeploy the functions that consume them.

```bash
firebase functions:secrets:set BACKUP_BUCKET            # required — see Backups
firebase functions:secrets:set CALENDAR_FEED_SECRET     # required for calendar sync
firebase functions:secrets:set BIOMETRIC_DEVICE_TOKEN
firebase functions:secrets:set AISENSY_API_KEY
firebase functions:secrets:set AISENSY_BILL_TEMPLATE
firebase functions:secrets:set MSG91_AUTH_KEY
firebase functions:secrets:set MSG91_SENDER_ID
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set SENDGRID_FROM_EMAIL
firebase functions:secrets:set ABDM_CLIENT_ID
firebase functions:secrets:set ABDM_CLIENT_SECRET
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
```

`CALENDAR_FEED_SECRET` can be any long random string; generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
**Changing it invalidates every calendar link already handed out.**

---

## Backups — do this first

`scheduledFirestoreExport` runs at **01:30 IST every day** and writes a full export of every
collection to the bucket named in `BACKUP_BUCKET`. An admin can also take an on-demand export from
**Staff → Hospital Settings → Backups → Back up now** before any risky change. Each run is recorded in
the `backupLog` collection.

Setup:

```bash
# 1. Create the bucket (same region as Firestore)
gsutil mb -l asia-south1 gs://jyothsna-hms-backups

# 2. Let the Functions service account write exports
PROJECT=YOUR-FIREBASE-PROJECT-ID
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$PROJECT@appspot.gserviceaccount.com" \
  --role="roles/datastore.importExportAdmin"
gsutil iam ch serviceAccount:$PROJECT@appspot.gserviceaccount.com:objectAdmin \
  gs://jyothsna-hms-backups

# 3. Keep 90 days of exports, then delete
cat > lifecycle.json <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}
JSON
gsutil lifecycle set lifecycle.json gs://jyothsna-hms-backups

# 4. Store the bucket name
firebase functions:secrets:set BACKUP_BUCKET   # value: jyothsna-hms-backups
```

Restoring is `gcloud firestore import gs://jyothsna-hms-backups/firestore-backups/<timestamp>`.
**Test a restore into a scratch project at least once** — an untested backup is not a backup.

---

## Security model

`firestore.rules` enforces role scoping and field validation, not just "is signed in":

| Rule | Effect |
|---|---|
| Role comes from `/staff/{auth.uid}` | That document is written **only** by the `syncStaffUid` function, so no user can mint or escalate their own role |
| `payments` is append-only | A recorded receipt can never be edited or deleted from a browser — reverse it with a new entry |
| `certificates` is append-only | Issued certificates can only be **cancelled**, never edited or deleted, so a reprint always matches the copy the patient holds |
| `auditLog` and `logins` are append-only | The actor is pinned to the caller's own identity |
| Money and count fields are type-checked | `grandTotal`, `amountPaid`, `stock`, `totalHours` and friends must be numbers in a sane range |
| `owner` is read-only everywhere | Analytics access without any write path |
| Server-owned collections | `messageLog`, `abdmLinks`, `calendarTokens`, `backupLog`, `paymentAttempts` reject all browser writes |

---

## WhatsApp — AI Sensy *(pending confirmation)*

**Status: built, switched off, endpoint not yet confirmed.** AI Sensy exposes more than one API surface
and the right one depends on the account, so both the mode and the host are settings rather than code:

| Setting | Meaning |
|---|---|
| `mode` | `campaign` (default, posts to `backend.aisensy.com/campaign/t1/api/v2`) or `direct` (`apis.aisensy.com`) |
| `campaignName` | Campaign or template name |
| `baseUrl` | Overrides the host for either mode |

Before switching it on, confirm the endpoint and payload against AI Sensy's current documentation for
your account, set `mode`/`baseUrl` accordingly, and send one test message. Every attempt — success or
failure — is written to `messageLog` with the provider's HTTP status and response, so a misconfigured
endpoint is visible immediately rather than silently swallowed.

Requires a verified WhatsApp Business account and an approved template. The bill message passes patient
name, bill number and outstanding amount as the three body parameters.

## SMS fallback — MSG91 *(hidden until enabled)*

For patients with no WhatsApp. The function is deployed but the feature is **invisible across the
whole app** until `integrations.msg91.enabled` is true: any element tagged `data-integration="msg91"`
stays hidden, and `sendPatientSms()` refuses to call the provider.

Needs DLT-registered templates (Indian regulation). Put the template IDs in the integration settings.
Delivery is logged to `messageLog` exactly like WhatsApp.

## Consent

Both channels refuse to send until the patient record carries the matching consent:

```
whatsAppConsent: true
emailConsent: true
smsConsent: true
```

These are captured on the patient form. There is no override.

---

## PACS / DICOM — Orthanc

Radiology images belong in a PACS, not in Firebase Storage: a DICOM study is a multi-slice series that
needs a real viewer. The HMS therefore stores only the identifiers and links out.

| Setting | Example |
|---|---|
| `viewerUrl` | `https://pacs.hospital.local/ohif/viewer?StudyInstanceUIDs={studyUID}` |
| `lookupUrl` | `https://pacs.hospital.local/ohif/viewer?AccessionNumber={accession}` |
| `aeTitle` | Modality worklist AE title, shown to the technician |

When the switch is on, the imaging upload form gains **Accession number** and **Study Instance UID**
fields. An accession number is generated automatically if the technician leaves it blank — that number
is what ties the HMS order to the images the modality produces. Reports with a study then show an
**Open in PACS** button.

Because the viewer usually sits on the hospital LAN, staff must be on that network for the link to
resolve. Nothing about this integration exposes the PACS to the internet.

---

## Google Calendar sync

Doctors get their OP list and theatre list on their phone with no OAuth consent screen and no stored
refresh tokens.

- **Subscription feed** — *Sync to my calendar* on the OT Schedule, Appointments or Doctor Dashboard
  produces a personal URL. Added once to Google Calendar (Other calendars → **+** → **From URL**), it
  keeps itself up to date. The feed carries two weeks back and eight weeks ahead.
- **Per-event links** — every appointment and theatre row has a *Calendar* link for pinning a single
  event.

The feed URL contains a per-doctor HMAC derived from `CALENDAR_FEED_SECRET`; the function verifies it
in constant time and returns only that doctor's own events.

> **The feed URL contains patient names.** It is a bearer credential — treat it like a password. If one
> leaks, rotate `CALENDAR_FEED_SECRET`, which invalidates every issued link at once.

---

## ABDM / ABHA

Links a patient's national health account to their hospital record.

| Setting | Meaning |
|---|---|
| `baseUrl` | `https://dev.abdm.gov.in` for sandbox, the production host when live |
| `hipId` | Health Information Provider ID from facility registration |
| `hipName` | Facility name as registered |

Flow, from the patient profile: enter the ABHA number or address → OTP goes to the mobile registered
against that ABHA → verify → the ABHA number and address are stored on the patient record. Every link
and unlink is recorded in `abdmLinks`.

The gateway session token and the client secret stay server-side. Sandbox credentials come from the
ABDM developer portal; production access requires facility registration (HFR) and going through their
onboarding.

**Ask for the patient's consent before starting the OTP flow.**

---

## Certificates

Birth, delivery, medical (rest) and fitness certificates are issued from the **Certificates** page, or
directly from a newborn or delivery record in the patient profile.

- Serial numbers come from a yearly counter: `JYO/BC/2026/00001`.
- Every certificate is stored in `certificates` **before** the PDF is produced, so a reprint rebuilds
  the exact document that was handed over.
- A wrong certificate is **cancelled, never edited**. Reprints of a cancelled certificate carry a
  CANCELLED watermark and the register keeps the reason.
- Birth and delivery certificates prefill from the hospital's own delivery register.

Set the hospital registration number in Hospital Settings — it prints on every certificate.

> A hospital birth certificate is **not** the statutory certificate. Every certificate carries a
> footnote saying the Registrar of Births & Deaths issues the legal document. Registration with the
> civil registration system is still a separate, manual step.

---

## Pharmacy stock import

**Pharmacy → Import Stock** brings the medicine master and opening stock across from older software:
upload CSV → map columns → preview → import.

- Column names do not need to match; common names (`item`, `qty`, `closing stock`, `mfr`, `batch no`,
  `exp`) are matched automatically and anything else is mapped by hand.
- Handles quoted fields, embedded commas and the date formats Indian packages emit — `dd-mm-yyyy`,
  `dd/mm/yy`, and month-year expiry like `09/27`, which becomes the last day of that month.
- Medicines already present (matched on **name + batch**) can be skipped, topped up, or replaced.
- Rows with problems are listed by row number and never partially written.

---

## Prescriptions

All prescriptions print bilingually — English and Telugu on the same sheet. There is no English-only
path; every print button in Consultations, the Doctor Dashboard and Pharmacy routes to the same
generator, which embeds Noto Sans Telugu.

The dictionary covers frequencies (including `BD`, `TDS`, `SOS`, `HS`), `1-0-1` style schedules,
durations, dosage forms, routes and common advice. Anything it cannot translate stays in English rather
than being mangled.

---

## Live biometric attendance

CSV uploads in Attendance import known biometric layouts. For live punches, point the device webhook or
its desktop bridge at:

```
https://asia-south1-YOUR-FIREBASE-PROJECT-ID.cloudfunctions.net/syncBiometricPunch
```

```
x-device-token: <BIOMETRIC_DEVICE_TOKEN>
Content-Type: application/json

{ "biometricId": "BIO001", "timestamp": "2026-07-19T09:05:00+05:30", "punchType": "check_in" }
```

Use `check_out` for the closing punch. The endpoint writes the same `attendance` fields the Attendance
page uses and computes total hours at checkout.

---

## Online payments — Razorpay

Available from the bill's **Manage → Pay Online** menu. Order creation and signature verification both
happen server-side; the bill, the patient's bill copy and the payment ledger are updated in a single
transaction.

> **Known gap:** settlement depends on the browser calling back after checkout. If the patient's phone
> dies or the tab closes at the wrong moment, the payment succeeds at Razorpay but the bill stays
> unpaid until someone reconciles it by hand. Closing this properly needs a Razorpay webhook. It has
> not been built.
