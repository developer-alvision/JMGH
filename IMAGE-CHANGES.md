# Changes from the supplied October 2026 images

Implemented on 13 October 2026. The user selected the latest handwritten fee sheet and confirmed that scanner uploading means importing PDF or photo files.

- Female patient selection expands marital status, spouse/partner and menstrual/gynaecological history. These optional details are saved, editable and visible on the profile.
- Blood group is optional and defaults to unknown, including CSV imports.
- New department choices are Gynaecology and Surgery. Historical department records remain readable.
- New OP: ₹300. Review within seven days of the most recent completed visit: ₹0. After seven days, pregnancy review: ₹100. General review within one calendar month of the OP episode: ₹100; after one month through three months: ₹200; after three months: ₹300 and a new episode starts. Phone OP adds ₹100. An explicit New Visit starts a new episode. An authorized fee waiver is retained.
- Booking invoices, receipts, tokens and the appointment commit together. Consultation completion recognizes the booking invoice to prevent charging twice. Drafts/cancelled visits do not establish review eligibility.
- All 35 photographed laboratory prices are in the consultation and billing catalogs. TFT is ₹500 and TSH is ₹600 as written on the sheet. No crossed-out OP line was used.
- Imaging choices: ECG ₹500, CTG ₹500, USG Abdomen ₹500, Vaginal Scan ₹550. The imaging category selector offers ECG, CTG and Ultrasound.
- PCOS lifestyle/cycle, hypothyroid review and infertility assessment templates are available. The UTI code matches exactly rather than matching the word “Routine”. New templates use blank assessment fields and clinician-selected prescriptions.
- Scanned reports accept PDF, JPEG and PNG. Lab reports allow up to 10 MB; imaging reports must be under 20 MB. Save the scanner output as one of these files and select it in Upload Report.
- Certificates receive a yearly per-type serial, e.g. `JYO/MC/2026/00001`. The number and record commit on the server; concurrent retries return the same record. Reprint preserves the serial; cancellation does not reuse it.

The first administrator login adds the updated service catalog once. The app applies its new OP policy without resetting existing doctor fee records. Past invoices and issued documents retain their stored amounts/numbers.

Clinical reference sources used to revise the UTI and lifestyle text: [NHS pregnancy urinary symptoms](https://www.nhs.uk/pregnancy/common-symptoms/common-health-problems/), [NHS antibiotic guidance](https://www.nhs.uk/medicines/antibiotics/), [NHS Scotland PCOS guidance](https://www.rightdecisions.scot.nhs.uk/maternity-gynaecology-guidelines/gynaecology/gynaecology-guidelines/guidelines-a-z-all-gynaecology-guidelines/polycystic-ovarian-syndrome-622/). Individual treatment, examination findings and medication instructions are entered by the treating clinician.

Validation commands: `npm test`, `npm run check`, `npm run test:rules`, `npm run test:images`. Browser checks run only against local emulators and save evidence in `test-results/image-changes-results.json`.
