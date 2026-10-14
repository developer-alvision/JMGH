const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');

function backend(initial = {}, fetchImpl = async () => { throw new Error('Unexpected provider call'); }) {
  const records = new Map(Object.entries(initial));
  const deleted = Symbol('delete');
  const snapshot = (ref) => ({ ref, id: ref.id, exists: records.has(ref.path),
    data: () => records.get(ref.path),
    get: (key) => key.split('.').reduce((value, part) => value && value[part], records.get(ref.path)) });
  function write(ref, data, options) {
    const result = { ...(options && options.merge ? records.get(ref.path) : {}), ...data };
    for (const key of Object.keys(result)) if (result[key] === deleted) delete result[key];
    records.set(ref.path, result);
  }
  function collection(name) {
    return {
      doc(id) {
        if (!id || id.includes('/')) throw new Error('Invalid document ID');
        const ref = { path: name + '/' + id, id };
        return Object.assign(ref, { get: async () => snapshot(ref),
          set: async (data, options) => write(ref, data, options),
          update: async (data) => write(ref, data, { merge: true }),
          collection: (child) => collection(ref.path + '/' + child) });
      },
      where(field, op, expected) { return query(name, [[field, op, expected]]); }
    };
  }
  function query(name, conditions) {
    return { where: (field, op, value) => query(name, [...conditions, [field, op, value]]),
      orderBy() { return this; }, limit() { return this; },
      async get() {
        const docs = [...records.keys()].filter((key) => key.startsWith(name + '/') && key.split('/').length === name.split('/').length + 1)
          .map((key) => snapshot(collection(name).doc(key.slice(name.length + 1))))
          .filter((doc) => conditions.every(([key, op, value]) => op === '==' ? doc.get(key) === value : doc.get(key) >= value));
        return { docs, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
      } };
  }
  function batch() {
    const actions = [];
    return { set: (ref, data, options) => actions.push(() => write(ref, data, options)),
      update: (ref, data) => actions.push(() => write(ref, data, { merge: true })),
      delete: (ref) => actions.push(() => records.delete(ref.path)),
      commit: async () => actions.forEach((action) => action()) };
  }
  const db = { collection, batch, async runTransaction(callback) {
    const tx = batch();
    tx.get = async (ref) => snapshot(ref);
    const result = await callback(tx);
    await tx.commit();
    return result;
  } };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => 'server-time', delete: () => deleted };
  firestore.Timestamp = { fromDate: (date) => date };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const exposed = {};
  const context = { exports: exposed, Buffer, Intl, console, process: { env: {} }, fetch: fetchImpl,
    require(name) {
      if (name === 'firebase-admin') return { initializeApp() {}, firestore };
      if (name === 'firebase-admin/firestore') return { FieldValue: firestore.FieldValue, Timestamp: firestore.Timestamp };
      if (name === 'crypto') return crypto;
      if (name === 'firebase-functions/v2/https') return { HttpsError, onCall: (_, fn) => fn, onRequest: (_, fn) => fn };
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (_, fn) => fn };
      if (name === 'firebase-functions/v2/firestore') return { onDocumentWritten: (_, fn) => fn };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'test-secret' }) };
      if (name === 'firebase-functions/v2') return { setGlobalOptions() {} };
      if (name === '@google-cloud/firestore') return { v1: { FirestoreAdminClient: class {} } };
      throw new Error('Unexpected import ' + name);
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), context);
  return { functions: exposed, records };
}

const request = (data = {}, uid = 'billing') => ({ data, auth: { uid, token: { email: uid + '@example.test' } }, rawRequest: { ip: '127.0.0.1' } });
const staff = (role) => ({ role, isActive: true, email: role + '@example.test' });

test('payment and communication functions reject anonymous and non-staff callers before provider use', async () => {
  const { functions } = backend();
  for (const name of ['createRazorpayOrder', 'verifyRazorpayPayment', 'sendBillEmail', 'sendBillWhatsApp']) {
    await assert.rejects(functions[name]({ data: {} }), { code: 'unauthenticated' });
    await assert.rejects(functions[name](request()), { code: 'permission-denied' });
  }
});

test('inactive source profile revokes an otherwise active UID role', async () => {
  const { functions } = backend({
    'staff/billing': { ...staff('billing_staff'), sourceStaffDocId: 'legacy' },
    'staff/legacy': { ...staff('billing_staff'), isActive: false }
  });
  await assert.rejects(functions.createRazorpayOrder(request({ billDocId: 'bill' })), { code: 'permission-denied' });
});

test('legacy paid pharmacy bills cannot create another payment order', async () => {
  const { functions } = backend({ 'staff/billing': staff('billing_staff'),
    'hospitalSettings/main': { integrations: { razorpay: { enabled: true } } },
    'bills/legacy': { grandTotal: 100, paymentStatus: 'paid' }
  });
  await assert.rejects(functions.createRazorpayOrder(request({ billDocId: 'legacy' })), { code: 'failed-precondition' });
});

test('first staff login creates UID and source link without copying passwords', async () => {
  const { functions, records } = backend({ 'staff/legacy': { ...staff('doctor'), temporaryPassword: 'must-not-copy' } });
  const firstLogin = request({}, 'doctor');
  firstLogin.auth.token.email_verified = true;
  await functions.syncStaffUid(firstLogin);
  assert.equal(records.get('staff/doctor').sourceStaffDocId, 'legacy');
  assert.equal(records.get('staff/doctor').role, 'doctor');
  assert.equal(records.get('staff/legacy').uid, 'doctor');
  assert.equal(records.get('staff/legacy').temporaryPassword, undefined);
});

test('unverified self-signup cannot claim an unbound staff email', async () => {
  const { functions } = backend({ 'staff/legacy': staff('doctor') });
  await assert.rejects(functions.syncStaffUid(request({}, 'doctor')), { code: 'failed-precondition' });
});

test('duplicate legacy staff profiles fail closed', async () => {
  const { functions } = backend({ 'staff/a': staff('doctor'), 'staff/b': staff('doctor') });
  await assert.rejects(functions.syncStaffUid(request({}, 'doctor')), { code: 'failed-precondition' });
});

test('Razorpay requires capture and credits a captured payment only once', async () => {
  let captured = false;
  const { functions, records } = backend({ 'staff/billing': staff('billing_staff'),
    'paymentAttempts/order_123': { amount: 75, billDocId: 'bill', status: 'created' },
    'bills/bill': { grandTotal: 100, amountPaid: 25, patientDocId: 'patient' }
  }, async () => ({ ok: true, json: async () => ({ order_id: 'order_123', amount: 7500, currency: 'INR', status: captured ? 'captured' : 'authorized' }) }));
  const data = { orderId: 'order_123', paymentId: 'pay_123', signature: crypto.createHmac('sha256', 'test-secret').update('order_123|pay_123').digest('hex') };
  await assert.rejects(functions.verifyRazorpayPayment(request(data)), { code: 'failed-precondition' });
  assert.equal(records.get('bills/bill').amountPaid, 25);
  captured = true;
  await functions.verifyRazorpayPayment(request(data));
  await functions.verifyRazorpayPayment(request(data));
  assert.equal(records.get('bills/bill').amountPaid, 100);
  assert.equal(records.get('bills/bill').balanceDue, 0);
  assert.equal(records.get('payments/RZP-pay_123').amount, 75);
});

test('PIN setup stores salted credentials only in a server collection', async () => {
  const { functions, records } = backend({ 'staff/billing': staff('billing_staff'), 'patients/p': { patientId: 'SA-001' } });
  await functions.setPatientPortalPin(request({ patientDocId: 'p', pin: '123456' }));
  const access = records.get('patientPortalAccess/p');
  assert.equal(access.hash, crypto.scryptSync('123456', access.salt, 64).toString('hex'));
  assert.equal(records.get('patients/p').portalPinHash, undefined);
});

test('portal returns actual appointment/bill/report fields and upgrades legacy PINs', async () => {
  const patientId = 'SA-001';
  const { functions, records } = backend({
    'patients/p': { patientId, name: 'Test Patient', portalPinHash: crypto.createHash('sha256').update(patientId + '|1234').digest('hex') },
    'appointments/a': { patientId, appointmentDate: '2099-01-01', timeSlot: '10:30', status: 'scheduled' },
    'bills/b': { patientId, billId: 'OPD-001', grandTotal: 100, amountPaid: 20 },
    'reports/r': { patientId, uploadedReport: true, fileUrl: 'https://example.test/report.pdf' }
  });
  const result = await functions.getPatientPortalData(request({ patientId, pin: '1234' }));
  assert.equal(result.appointments[0].date, '2099-01-01');
  assert.equal(result.appointments[0].time, '10:30');
  assert.equal(result.bills[0].billNo, 'OPD-001');
  assert.equal(result.bills[0].balanceDue, 80);
  assert.equal(result.reports[0].status, 'ready');
  assert.equal(result.reports[0].downloadUrl, 'https://example.test/report.pdf');
  assert.ok(records.get('patientPortalAccess/p').salt);
  assert.equal(records.get('patients/p').portalPinHash, undefined);
});

test('portal attempts are throttled even when the patient does not exist', async () => {
  const { functions } = backend();
  for (let attempt = 0; attempt < 10; attempt++) {
    await assert.rejects(functions.getPatientPortalData(request({ patientId: 'SA-999', pin: '1234' })), { code: 'permission-denied' });
  }
  await assert.rejects(functions.getPatientPortalData(request({ patientId: 'SA-999', pin: '1234' })), { code: 'resource-exhausted' });
});

test('queue projection never exposes patient identity', async () => {
  const { functions, records } = backend({ 'opTokens/t': { date: '2026-01-01', tokenNo: 5, status: 'waiting', patientName: 'Private', patientId: 'SA-001' } });
  await functions.publishQueueDisplay({ params: { tokenId: 't' } });
  assert.deepEqual(Object.keys(records.get('publicQueue/t')).sort(), ['date', 'doctorName', 'status', 'tokenNo']);
});
