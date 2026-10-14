'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://127.0.0.1:5000';
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, { recursive: true });

async function main() {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const failures = [], steps = [];
    let activePage;
    async function login(role) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
        const page = await context.newPage();
        activePage = page;
        page.setDefaultTimeout(25000);
        page.on('pageerror', error => failures.push({ role, url: page.url(), message: error.message }));
        page.on('console', message => {
            if (message.type() === 'error' && /permission.denied|insufficient permissions|undefined|not a function/i.test(message.text()))
                failures.push({ role, url: page.url(), message: message.text() });
        });
        page.on('dialog', dialog => dialog.dismiss());
        await page.goto(base + '/index.html');
        assert.equal(await page.evaluate(() => firebase.app().options.projectId), 'demo-jyothsna-hms', 'Tests must never target production');
        await page.locator('#email').fill(role + '@jyothsna.test');
        await page.locator('#password').fill('DemoHospital123!');
        await page.locator('#loginBtn').click();
        await page.waitForURL('**/dashboard.html', { timeout: 60000 });
        await page.locator('.sidebar-nav a').first().waitFor();
        return { page, context };
    }
    async function bills(page, field, value) {
        return page.evaluate(async ({ field, value }) => {
            const snap = await firebase.firestore().collection('bills').where(field, '==', value).get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }, { field, value });
    }
    function pass(message) { steps.push(message); console.log('PASS: ' + message); }
    try {
        const { page: billing, context: billingContext } = await login('billing_staff');
        await billing.goto(base + '/billing.html');
        await billing.locator('.sidebar-nav a').first().waitFor();
        const suffix = Date.now().toString();
        const note = 'Finance E2E ' + suffix;
        await billing.locator('#newBillBtn').click();
        await billing.locator('#billing_patientSearchInput').fill('Demo Ananya');
        await billing.locator('#billing_patientSearchResults [data-docid="demo-patient-1"]').click();
        await billing.locator('#billing_selectedPatientCard').waitFor();
        await billing.locator('.item-desc').first().fill('E2E Consultation');
        await billing.locator('.item-price').first().fill('100');
        await billing.locator('#advancePaid').fill('25');
        await billing.locator('#billNotes').fill(note);
        await billing.locator('#generateBillBtn').click();
        await billing.locator('#newBillModal').waitFor({ state: 'hidden' });
        const [bill] = await bills(billing, 'notes', note);
        assert.ok(bill, 'Ordinary bill is saved');
        assert.equal(bill.grandTotal, 100);
        assert.equal(bill.amountPaid, 25);
        assert.equal(bill.balanceDue, 75);
        pass('billing_staff creates ordinary non-lab invoice and initial payment under real rules');

        await billing.evaluate(id => openRecordPaymentModal(id), bill.id);
        await billing.locator('#splitPay_phonepe').fill('75');
        await billing.locator('#confirmPaymentBtn').click();
        await billing.locator('#recordPaymentModal').waitFor({ state: 'hidden' });
        const financial = await billing.evaluate(async id => {
            const db = firebase.firestore();
            const [billDoc, mirror, payments] = await Promise.all([
                db.collection('bills').doc(id).get(),
                db.collection('patients').doc('demo-patient-1').collection('bills').doc(id).get(),
                db.collection('payments').where('billDocId', '==', id).get()
            ]);
            return { bill: billDoc.data(), mirror: mirror.data(), payments: payments.docs.map(doc => doc.data()) };
        }, bill.id);
        assert.equal(financial.bill.paymentStatus, 'paid');
        assert.equal(financial.bill.amountPaid, 100);
        assert.equal(financial.bill.balanceDue, 0);
        assert.equal(financial.mirror.amountPaid, 100);
        assert.equal(financial.payments.reduce((sum, payment) => sum + payment.amount, 0), 100);
        assert.ok(financial.payments.some(payment => payment.paymentMethod === 'PhonePe' && payment.amount === 75));
        await billing.screenshot({ path: path.join(output, 'finance-billing.png'), fullPage: true });
        pass('later PhonePe payment reconciles invoice, patient copy and immutable payment ledger');
        await billingContext.close();

        const { page: pharmacy, context: pharmacyContext } = await login('pharmacist');
        await pharmacy.goto(base + '/pharmacy.html');
        await pharmacy.locator('.sidebar-nav a').first().waitFor();
        await pharmacy.locator('.tab-btn[data-target="inventorySection"]').click();
        await pharmacy.locator('#addMedicineBtn').click();
        const medicineName = 'Finance Test Medicine ' + suffix;
        await pharmacy.locator('#medName').fill(medicineName);
        await pharmacy.locator('#medGeneric').fill('Test inventory');
        await pharmacy.locator('#medUnit').fill('Tablet');
        await pharmacy.locator('#medStock').fill('5');
        await pharmacy.locator('#medPrice').fill('10');
        await pharmacy.locator('#medExpiry').fill('2030-12-31');
        await pharmacy.locator('#saveMedBtn').click();
        await pharmacy.locator('#medModal').waitFor({ state: 'hidden' });
        await pharmacy.locator('#inventoryTableBody').getByText(medicineName, { exact: true }).waitFor();
        pass('pharmacist creates salable inventory through the form');

        await pharmacy.locator('.tab-btn[data-target="dispenseSection"]').click();
        await pharmacy.locator('#pharma_patientSearchInput').fill('Demo Ananya');
        await pharmacy.locator('#pharma_patientSearchResults [data-docid="demo-patient-1"]').click();
        await pharmacy.locator('#pharmaPrescribedBy').selectOption('Dr. Demo Jyothsna');
        await pharmacy.locator('#dispMedicineSearch').fill(medicineName);
        await pharmacy.locator('#pharmaSuggestions .drug-suggestion-item').first().click();
        await pharmacy.locator('#dispQuantity').fill('2');
        await pharmacy.locator('#dispDays').fill('1');
        await pharmacy.locator('#btnAddDispItem').click();
        await pharmacy.locator('#dispPaymentMode').selectOption('Due');
        await pharmacy.locator('#dispenseBtn').click();
        await pharmacy.locator('.pharmacy-bill-pdf-prompt').waitFor();
        await pharmacy.locator('.pharmacy-bill-close').click();
        const due = await pharmacy.evaluate(async medicineName => {
            const db = firebase.firestore();
            const stock = await db.collection('pharmacy').where('medicineName', '==', medicineName).get();
            const history = await db.collection('dispensingHistory').where('medicineName', '==', medicineName).get();
            const record = history.docs[0].data();
            const invoice = await db.collection('bills').doc(record.billDocId).get();
            const ledger = await db.collection('payments').where('billDocId', '==', record.billDocId).get();
            return { medicineId: stock.docs[0].id, stock: stock.docs[0].data().stock, invoice: invoice.data(), payments: ledger.size };
        }, medicineName);
        assert.equal(due.stock, 3);
        assert.equal(due.invoice.amountPaid, 0);
        assert.equal(due.invoice.balanceDue, 20);
        assert.equal(due.payments, 0);
        pass('pharmacist dispensing transaction updates stock, history and due invoice without a fictitious receipt');

        await pharmacy.locator('.tab-btn[data-target="counterSaleSection"]').click();
        await pharmacy.locator('#counterSearch').fill(medicineName);
        await pharmacy.locator('#counterSuggestions .counter-pick').first().click();
        await pharmacy.locator('#counterBuyerName').fill(note);
        await pharmacy.locator('#counterSaveBtn').click();
        await pharmacy.waitForFunction(() => document.getElementById('counterBuyerName').value === '');
        const [counterBill] = await bills(pharmacy, 'patientName', note);
        assert.equal(counterBill.isCounterSale, true);
        assert.equal(counterBill.grandTotal, 10);
        assert.equal(counterBill.amountPaid, 10);
        const stock = await pharmacy.evaluate(async id => (await firebase.firestore().collection('pharmacy').doc(id).get()).data().stock, due.medicineId);
        assert.equal(stock, 2);
        await pharmacy.screenshot({ path: path.join(output, 'finance-pharmacy.png'), fullPage: true });
        pass('pharmacist counter sale creates bill and receipt and decrements inventory under real permissions');
        await pharmacyContext.close();
        assert.deepEqual(failures, [], 'Browser runtime/permission failures: ' + JSON.stringify(failures));
    } catch (error) {
        failures.push({ message: error.message });
        if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'finance-failure.png'), fullPage: true }).catch(() => {});
        throw error;
    } finally {
        fs.writeFileSync(path.join(output, 'finance-e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), steps, failures }, null, 2));
        await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
