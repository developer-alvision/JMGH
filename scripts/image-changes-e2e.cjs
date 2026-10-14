'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../test-results');
fs.mkdirSync(out, { recursive: true });
async function main() {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    const errors = [], results = [];
    page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
    const suffix = Date.now().toString();
    try {
        await page.goto('http://127.0.0.1:5000/');
        await page.locator('#email').fill('admin@jyothsna.test');
        await page.locator('#password').fill('DemoHospital123!');
        await page.locator('#loginBtn').click();
        await page.waitForURL('**/dashboard.html', { timeout: 60000 });
        assert.equal(await page.evaluate(() => firebase.app().options.projectId), 'demo-jyothsna-hms');
        await page.goto('http://127.0.0.1:5000/patients.html');
        await page.locator('#addNewBtn').click();
        await page.locator('#patientName').fill('Image Check ' + suffix);
        await page.locator('#patientPhone').fill('987' + suffix.slice(-7));
        await page.locator('#patientGender').selectOption('Female');
        await page.locator('#femalePatientDetails').waitFor({ state: 'visible' });
        await page.locator('#patientMaritalStatus').selectOption('Married');
        await page.locator('#patientSpouseName').fill('Test partner');
        await page.locator('#patientFemaleHistory').fill('Recorded by test patient');
        assert.equal(await page.locator('#patientBlood').inputValue(), '');
        assert.equal(await page.locator('#patientBlood').getAttribute('required'), null);
        await page.locator('#patientDoctor').selectOption('local-doctor');
        await page.locator('#patientDepartment').selectOption('Gynaecology');
        assert.deepEqual(await page.locator('#patientDepartment option').evaluateAll(options => options.map(option => option.value).filter(Boolean)), ['Gynaecology', 'Surgery']);
        await page.screenshot({ path: path.join(out, 'female-patient-details.png'), fullPage: true });
        await page.locator('#savePatientBtn').click();
        await page.waitForFunction(() => !document.getElementById('addPatientModal').classList.contains('active'));
        const patient = await page.evaluate(async name => {
            const rows = await db.collection('patients').where('name', '==', name).get();
            return { docId: rows.docs[0].id, ...rows.docs[0].data() };
        }, 'Image Check ' + suffix);
        assert.equal(patient.maritalStatus, 'Married'); assert.equal(patient.bloodGroup, ''); assert.equal(patient.spouseName, 'Test partner');
        results.push('Female details persist, unknown blood group accepted, only two departments');
        await page.goto('http://127.0.0.1:5000/appointments.html');
        await page.waitForFunction(() => typeof getHospitalOPFee === 'function' && document.querySelector('.sidebar-nav a'));
        const initialFee = await page.evaluate(async p => getHospitalOPFee(p, { id: 'local-doctor', name: 'Dr. Demo Jyothsna' }, todayIso(), { phone: true }), patient);
        assert.equal(initialFee.amount, 400);
        results.push('History-based fee lookup and ₹100 phone OP surcharge');
        await page.locator('#btnOpenBookModal').click();
        await page.locator('#bookingDoctor').selectOption('local-doctor');
        await page.evaluate(p => selectPatientForBooking(p.docId, p.patientId, p.name, p.phone, p.age, p.gender), patient);
        await page.locator('#bookingPhoneOP').check();
        await page.waitForFunction(() => document.getElementById('bookingOpFee').value === '400');
        const slot = await page.locator('#bookingTime').evaluate(select => Array.from(select.options).find(option => option.value && !option.disabled).value);
        await page.locator('#bookingTime').selectOption(slot);
        await page.locator('#saveBookingBtn').click();
        await page.waitForFunction(() => !document.getElementById('bookingModal').classList.contains('active'));
        const booking = await page.evaluate(async p => {
            const appointments = await db.collection('appointments').where('patientId', '==', p.patientId).get();
            const appointment = appointments.docs[0];
            const bill = await db.collection('bills').doc(appointment.data().opBillDocId).get();
            const receipts = await db.collection('payments').where('billDocId', '==', bill.id).get();
            return { id: appointment.id, appointment: appointment.data(), bill: bill.data(), receipts: receipts.docs.map(doc => doc.data()) };
        }, patient);
        assert.equal(booking.appointment.opFee, 400); assert.equal(booking.bill.amountPaid, 400);
        assert.equal(booking.receipts.length, 1); assert.equal(booking.receipts[0].amount, 400);
        results.push('Booking commits the ₹400 invoice and single payment receipt together');
        await page.goto('http://127.0.0.1:5000/consultation.html?patientId=' + patient.patientId);
        await page.locator('#labTestsGrid .lab-check').first().waitFor();
        assert.equal(await page.locator('#amt_lab_CBC').inputValue(), '300');
        assert.equal(await page.locator('#amt_lab_Thyroid').inputValue(), '500');
        assert.equal(await page.locator('#amt_lab_TSH').inputValue(), '600');
        assert.equal(await page.locator('#imagingTestsGrid .img-check').count(), 5); // four priced tests + custom
        for (const code of ['PCOS', 'HYPO', 'INF', 'UTI']) {
            await page.evaluate(code => applyClinicalTemplate(code), code);
            assert.ok((await page.locator('#diagnosis').inputValue()).length > 0);
        }
        assert.ok((await page.locator('#advice').inputValue()).includes('no fixed 3–4 litre target'));
        const savedConsultation = await page.evaluate(async ({ patient, booking, suffix }) => {
            const consultationId = 'CONS-IMAGE-' + suffix;
            await triggerDownstreamActions({ consultationId, patientId: patient.patientId, patientDocId: patient.docId,
                patientName: patient.name, doctorId: 'local-doctor', doctorName: 'Dr. Demo Jyothsna', department: 'Gynaecology',
                appointmentId: booking.id, prescription: [], labOrders: [], imagingOrders: [], status: 'completed' });
            const saved = await db.collection('consultations').doc(consultationId).get();
            const bill = await db.collection('bills').doc(saved.data().billDocId).get();
            return { consultation: saved.data(), bill: bill.data() };
        }, { patient, booking, suffix });
        assert.equal(savedConsultation.bill.grandTotal, 0);
        assert.equal(savedConsultation.consultation.opBaseFee, 300);
        results.push('Completing a booked consultation does not charge the OP fee twice');
        results.push('All photo prices and PCOS/hypothyroid/infertility/corrected UTI templates');
        await page.screenshot({ path: path.join(out, 'consultation-prices-templates.png'), fullPage: true });
        await page.goto('http://127.0.0.1:5000/certificates.html');
        await page.waitForFunction(() => typeof callFunction === 'function' && document.querySelector('.sidebar-nav a'));
        const certificate = await page.evaluate(async ({ patient, suffix }) => {
            const args = { type: 'medical', patientDocId: patient.docId, requestId: 'CERT-TEST-' + suffix,
                data: { age: 30, examinedOn: todayIso(), diagnosis: 'Test only', restFrom: todayIso(), restTo: todayIso() } };
            const [first, retry] = await Promise.all([callFunction('issueHospitalCertificate', args), callFunction('issueHospitalCertificate', args)]);
            const second = await callFunction('issueHospitalCertificate', { ...args, requestId: args.requestId + '-next' });
            return { first, retry, second };
        }, { patient, suffix });
        assert.equal(certificate.first.certificateNo, certificate.retry.certificateNo);
        assert.equal(Number(certificate.second.certificateNo.split('/').pop()), Number(certificate.first.certificateNo.split('/').pop()) + 1);
        assert.equal(await page.locator('#certNumberInput').getAttribute('readonly'), '');
        results.push('Certificate numbers allocated atomically; concurrent retry returns same serial');
        await page.goto('http://127.0.0.1:5000/lab-reports.html');
        assert.ok((await page.locator('#labPdfFile').getAttribute('accept')).includes('image/png'));
        const upload = await page.evaluate(async suffix => {
            const object = firebase.storage().ref('reports/image-checks/' + suffix + '.png');
            const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
            await object.put(bytes, { contentType: 'image/png' });
            return { url: await object.getDownloadURL(), metadata: await object.getMetadata() };
        }, suffix);
        assert.equal(upload.metadata.contentType, 'image/png'); assert.ok(upload.url.includes('127.0.0.1:9199'));
        results.push('Scanned photo upload passes actual Storage rules and returns a download URL');
        await page.goto('http://127.0.0.1:5000/imaging.html');
        assert.deepEqual(await page.locator('#imgType option').evaluateAll(options => options.map(option => option.value)), ['Ultrasound', 'ECG', 'CTG']);
        assert.ok((await page.locator('#reportPdfFile').getAttribute('accept')).includes('image/jpeg'));
        await page.goto('http://127.0.0.1:5000/billing.html');
        await page.waitForFunction(() => typeof addChargeRow === 'function' && document.querySelector('.sidebar-nav a'));
        await page.evaluate(() => addChargeRow());
        const row = page.locator('#chargeTableBody tr').last();
        await row.locator('.item-category').evaluate(select => { select.value = 'lab_cbc'; select.dispatchEvent(new Event('change')); });
        assert.equal(await row.locator('.item-price').inputValue(), '300');
        await row.locator('.item-category').evaluate(select => { select.value = 'img_vaginalscan'; select.dispatchEvent(new Event('change')); });
        assert.equal(await row.locator('.item-price').inputValue(), '550');
        results.push('Billing selects canonical lab/imaging prices');
        assert.deepEqual(errors, []);
        console.log('PASS: ' + results.join('; '));
    } finally {
        fs.writeFileSync(path.join(out, 'image-changes-results.json'), JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
        await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
