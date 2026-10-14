const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Optimistic transaction store: retries a conflicting read, and applies no
// staged writes when validation throws, matching the Firestore API contract.
function harness(initial = {}) {
    const data = new Map(Object.entries(initial));
    const versions = new Map();
    let sequence = 0;
    const snapshot = ref => ({ id: ref.id, ref, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
    function collection(collectionPath, filters = []) {
        return {
            doc(id = 'generated-' + (++sequence)) {
                return { id, path: collectionPath + '/' + id, get() { return Promise.resolve(snapshot(this)); },
                    collection(name) { return collection(this.path + '/' + name); } };
            },
            where(field, operator, value) { return collection(collectionPath, filters.concat([[field, value]])); },
            limit() { return this; },
            async get() {
                const docs = [...data.keys()].filter(key => key.startsWith(collectionPath + '/') && key.split('/').length === collectionPath.split('/').length + 1)
                    .map(key => snapshot(this.doc(key.split('/').pop()))).filter(doc => filters.every(([field, value]) => doc.data()[field] === value));
                return { docs, empty: docs.length === 0 };
            }
        };
    }
    const db = { collection, async runTransaction(fn) {
        for (let attempt = 0; attempt < 10; attempt++) {
            const reads = new Map();
            const writes = [];
            const tx = {
                async get(ref) { assert.equal(writes.length, 0, 'transactions read before writing'); reads.set(ref.path, versions.get(ref.path) || 0); return snapshot(ref); },
                set(ref, value, options) { writes.push([ref, structuredClone(value), !!options?.merge]); },
                update(ref, value) { writes.push([ref, structuredClone(value), true]); }
            };
            const result = await fn(tx);
            if ([...reads].some(([key, version]) => (versions.get(key) || 0) !== version)) continue;
            for (const [ref, value, merge] of writes) {
                data.set(ref.path, merge ? { ...data.get(ref.path), ...value } : value);
                versions.set(ref.path, (versions.get(ref.path) || 0) + 1);
            }
            return result;
        }
        throw new Error('Too much contention');
    } };
    const context = vm.createContext({ db, window: {}, todayIso: () => '2026-09-19',
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } }, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/pharmacy-transactions.js'), 'utf8'), context);
    return { data, db, context, save: context.window.commitPharmacySale };
}
const medicine = { medicineName: 'Test medicine', stock: 10, price: 20, expiryDate: '2027-12-31' };
const options = () => ({ patient: { docId: 'p1', patientId: 'P001', name: 'Test patient' },
    items: [{ medicineId: 'm1', medicineName: 'Test medicine', quantity: 3, unitPrice: 20 }],
    paymentMode: 'Cash', actor: 'pharmacy@example.test' });
const rows = (store, collection) => [...store].filter(([key]) => key.startsWith(collection + '/') && key.split('/').length === 2).map(([, value]) => value);

test('cash dispensing atomically records inventory, invoice, mirrored invoice, receipt and history', async () => {
    const h = harness({ 'pharmacy/m1': medicine });
    const result = await h.save(options());
    assert.equal(h.data.get('pharmacy/m1').stock, 7);
    const bill = h.data.get('bills/' + result.billDocId);
    assert.equal(bill.grandTotal, 60);
    assert.equal(bill.amountPaid, 60);
    assert.equal(bill.balanceDue, 0);
    assert.deepEqual(h.data.get('patients/p1/bills/' + result.billDocId), bill);
    assert.equal(rows(h.data, 'payments')[0].amount, 60);
    assert.equal(rows(h.data, 'dispensingHistory')[0].medicineName, medicine.medicineName);
});

test('due and insurance invoices remain outstanding and do not invent collections', async () => {
    for (const mode of ['Due', 'Insurance']) {
        const h = harness({ 'pharmacy/m1': medicine });
        await h.save({ ...options(), paymentMode: mode });
        assert.equal(rows(h.data, 'bills')[0].balanceDue, 60);
        assert.equal(rows(h.data, 'bills')[0].amountPaid, 0);
        assert.equal(rows(h.data, 'payments').length, 0);
    }
});

test('missing or mismatched linked bills leave stock and every collection unchanged', async () => {
    const h = harness({ 'pharmacy/m1': medicine, 'bills/b1': { billId: 'B001', patientId: 'OTHER' } });
    await assert.rejects(h.save({ ...options(), linkedBillId: 'missing' }), /Bill not found/);
    await assert.rejects(h.save({ ...options(), linkedBillId: 'b1' }), /another patient/);
    assert.equal(h.data.get('pharmacy/m1').stock, 10);
    assert.equal(h.data.size, 2);
});

test('expired, disposed and aggregate excessive quantities cannot dispense', async () => {
    for (const invalid of [{ expiryDate: '2020-01-01' }, { disposed: true }, { stock: 2 }]) {
        const h = harness({ 'pharmacy/m1': { ...medicine, ...invalid } });
        await assert.rejects(h.save(options()));
        assert.equal(h.data.size, 1);
    }
    const h = harness({ 'pharmacy/m1': { ...medicine, stock: 5 } });
    const request = options();
    request.items.push({ ...request.items[0] });
    await assert.rejects(h.save(request), /Insufficient stock/);
    assert.equal(h.data.get('pharmacy/m1').stock, 5);
});

test('competing counters cannot oversell after Firestore retries the conflicting read', async () => {
    const h = harness({ 'pharmacy/m1': { ...medicine, stock: 5 } });
    const results = await Promise.allSettled([h.save(options()), h.save(options())]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(h.data.get('pharmacy/m1').stock, 2);
    assert.equal(rows(h.data, 'bills').length, 1);
    assert.equal(rows(h.data, 'payments').length, 1);
});

test('prescription cannot be dispensed twice', async () => {
    const h = harness({ 'pharmacy/m1': medicine, 'prescriptions/rx1': { status: 'pending' } });
    await h.save({ ...options(), prescriptionId: 'rx1' });
    await assert.rejects(h.save({ ...options(), prescriptionId: 'rx1' }), /already been dispensed/);
    assert.equal(h.data.get('pharmacy/m1').stock, 7);
});

test('linked invoices preserve payments and recompute discounts and GST', async () => {
    const h = harness({ 'pharmacy/m1': medicine, 'bills/b1': { billId: 'B001', patientId: 'P001', patientDocId: 'p1',
        items: [], subtotal: 100, grandTotal: 99, discountPercent: 10, gstPercent: 10, amountPaid: 40, balanceDue: 59 } });
    await h.save({ ...options(), linkedBillId: 'B001', paymentMode: 'Bill Attached' });
    const bill = h.data.get('bills/b1');
    assert.equal(bill.subtotal, 160);
    assert.equal(bill.grandTotal, 158.4);
    assert.equal(bill.balanceDue, 118.4);
    assert.equal(bill.amountPaid, 40);
    assert.equal(rows(h.data, 'payments').length, 0);
});

test('counter sale generates an invoice and per-medicine history without a patient document', async () => {
    const h = harness({ 'pharmacy/m1': medicine });
    const result = await h.save({ ...options(), counter: true, patient: { name: 'Walk-in' }, discountPercent: 10 });
    assert.match(result.billNumber, /^JMH-CTR-/);
    assert.equal(rows(h.data, 'payments')[0].amount, 54);
    assert.equal([...h.data.keys()].filter(key => key.startsWith('patients/')).length, 0);
});

module.exports = { harness, rows };

function paymentHarness(initial) {
    const h = harness(initial);
    const messages = [];
    Object.assign(h.context, { currentUserEmail: 'billing@example.test',
        document: { getElementById: () => ({}) }, showToast: message => messages.push(message),
        closeRecordPaymentModal() {}, loadBills() {} });
    const source = fs.readFileSync(path.join(__dirname, '../js/billing.js'), 'utf8');
    const start = source.indexOf('function savePayment(billDocId, paymentData) {');
    const end = source.indexOf('\n// ==========================================\n// EXPORT BILLS', start);
    vm.runInContext(source.slice(start, end), h.context);
    return { ...h, messages, pay: h.context.savePayment };
}

test('split bill payments reconcile legacy balances and create ledger rows with dates and amounts', async () => {
    const h = paymentHarness({ 'bills/b1': { billId: 'B001', patientId: 'P001', patientDocId: 'p1',
        grandTotal: 100, balanceDue: 60, status: 'partial' } });
    await h.pay('b1', { cash: 10, phonepe: 20 });
    assert.equal(h.data.get('bills/b1').amountPaid, 70);
    assert.equal(h.data.get('bills/b1').balanceDue, 30);
    assert.equal(rows(h.data, 'payments').reduce((sum, row) => sum + row.amount, 0), 30);
    assert.equal(rows(h.data, 'payments')[1].paymentMethod, 'PhonePe');
    assert.equal(rows(h.data, 'payments')[1].createdAt, 'SERVER_TIME');
    assert.equal(h.data.get('patients/p1/bills/b1').balanceDue, 30);
});

test('concurrent bill payments cannot overpay a balance and failed attempts leave no ledger row', async () => {
    const h = paymentHarness({ 'bills/b1': { billId: 'B001', grandTotal: 100, balanceDue: 60, amountPaid: 40, status: 'partial' } });
    await Promise.all([h.pay('b1', { cash: 40 }), h.pay('b1', { cash: 40 })]);
    assert.equal(h.data.get('bills/b1').amountPaid, 80);
    assert.equal(h.data.get('bills/b1').balanceDue, 20);
    assert.equal(rows(h.data, 'payments').length, 1);
    assert.ok(h.messages.some(message => /exceeds the current balance/.test(message)));
});

test('negative payments and payments against cancelled bills leave records unchanged', async () => {
    const h = paymentHarness({ 'bills/b1': { billId: 'B001', grandTotal: 100, balanceDue: 100, amountPaid: 0, status: 'cancelled' } });
    await h.pay('b1', { cash: -10 });
    await h.pay('b1', { cash: 10 });
    assert.equal(h.data.size, 1);
    assert.equal(h.messages.filter(message => /Error recording/.test(message)).length, 2);
});

test('ordinary non-lab bill saves without missing globals or undefined values and records its initial receipts', async () => {
    const h = harness();
    const messages = [];
    h.db.batch = () => {
        const writes = [];
        return { set(ref, value) {
            function validate(object) {
                Object.entries(object).forEach(([key, item]) => {
                    assert.notEqual(item, undefined, 'Firestore rejects undefined ' + key);
                    if (item && typeof item === 'object') validate(item);
                });
            }
            validate(value); writes.push([ref.path, value]); return this;
        }, async commit() { writes.forEach(([key, value]) => h.data.set(key, value)); } };
    };
    const fields = { summaryGrandTotal: { textContent: '100' }, summaryBalanceDue: { textContent: '50' },
        summarySubtotal: { textContent: '100' }, summaryDiscountAmt: { textContent: '0' }, summaryGstAmt: { textContent: '0' } };
    const itemFields = { '.item-category': 'Consultation', '.item-desc': 'Consultation fee', '.item-orderedby': 'Doctor',
        '.item-qty': '1', '.item-price': '100', '.item-amount': '100' };
    const row = { querySelector: key => key === '.item-pending' ? null : { value: itemFields[key] } };
    const payment = { querySelector: () => ({ value: '30', dataset: { method: 'Cash' } }) };
    Object.assign(h.context, { selectedPatient_billing: { patientId: 'P001', docId: 'p1', name: 'Test patient' },
        billDiscount: { value: '0' }, billGst: { value: '0' }, advancePaid: { value: '20' }, _billingBedData: null,
        payMethodCheckboxes: [{ checked: true, value: 'Cash' }], currentUserEmail: 'billing@example.test',
        generateBillNumber: async () => 'B001', showToast: message => messages.push(message),
        newBillModal: { style: {} }, resetNewBillForm() {}, loadBills() {},
        document: { getElementById: id => fields[id] || (fields[id] = { value: '', disabled: false }),
            querySelector: () => ({ value: 'OPD' }),
            querySelectorAll: selector => selector === '#chargeTableBody tr' ? [row] : selector === '#paymentDynamicFields > div' ? [payment] : [] } });
    const source = fs.readFileSync(path.join(__dirname, '../js/billing.js'), 'utf8');
    const start = source.indexOf('async function saveBill(status) {');
    const end = source.indexOf("\ndocument.getElementById('saveDraftBtn').addEventListener", start);
    vm.runInContext(source.slice(start, end), h.context);
    await h.context.saveBill('Generate');
    assert.equal(rows(h.data, 'bills').length, 1, messages.join('\n'));
    assert.equal(rows(h.data, 'bills')[0].amountPaid, 50);
    assert.equal(rows(h.data, 'bills')[0].balanceDue, 50);
    assert.equal(rows(h.data, 'payments').reduce((sum, row) => sum + row.amount, 0), 50);
});

test('daily collections uses today receipts, including prior-day invoices and refunds, without counting old receipts again', () => {
    const elements = {};
    const context = vm.createContext({ console, checkAccess() {}, getCurrentUser() {},
        window: { addEventListener() {} },
        formatCurrency: value => Number(value).toFixed(2),
        document: { getElementById: id => elements[id] || (elements[id] = { addEventListener() {} }),
            querySelectorAll: () => [], querySelector: () => null } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/today-collections.js'), 'utf8'), context);
    context.applyFilterAndRender = () => {};
    context.todayRaisedBills = [{ id: 'b1', billId: 'B001', grandTotal: 100, balanceDue: 50, paymentDetails: { Cash: { amount: 50 } } }];
    context.todayPaymentBills = [{ id: 'b2', billId: 'B002', grandTotal: 200, balanceDue: 0, paymentDetails: { Cash: { amount: 200 } } }];
    context.todayPayments = [{ billDocId: 'b1', amount: 50, paymentMethod: 'Cash' },
        { billDocId: 'b2', amount: 75, paymentMethod: 'UPI' }, { billDocId: 'b2', amount: -10, paymentMethod: 'UPI' }];
    context.refreshTodayCollectionRows();
    assert.equal(elements.todayTotal.textContent, '115.00');
    assert.equal(elements.todayCash.textContent, '50.00');
    assert.equal(elements.todayUPI.textContent, '65.00');
    assert.equal(elements.todayDue.textContent, '50.00');
    assert.equal(vm.runInContext('allTodayBills.length', context), 2);
});
