const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, collection, getDocs, Timestamp, serverTimestamp } = require('firebase/firestore');
const { ref, uploadBytes } = require('firebase/storage');

// Opt in only when emulator services are running. The isolated project never
// clears the developer's demo database or accesses a production project.
const enabled = process.env.FIRESTORE_EMULATOR_HOST;
let env;
const projectId = 'demo-rules-jyothsna-hms';
before(async () => {
  if (!enabled) return;
  const [host, port] = enabled.split(':');
  env = await initializeTestEnvironment({ projectId,
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') },
    ...(process.env.FIREBASE_STORAGE_EMULATOR_HOST ? { storage: {
      host: process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[0],
      port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[1]),
      rules: fs.readFileSync(path.join(__dirname, '../../storage.rules'), 'utf8')
    } } : {})
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const rows = {
      'patients/p': { patientId: 'SA-001', name: 'Patient', phone: '9000000000' },
      'staff/admin': { role: 'admin', isActive: true, email: 'admin@example.test' },
      'staff/doctor': { role: 'doctor', isActive: true, email: 'doctor@example.test' },
      'staff/nurse': { role: 'nurse', isActive: true, email: 'nurse@example.test' },
      'staff/pharmacist': { role: 'pharmacist', isActive: true, email: 'pharmacist@example.test' },
      'staff/billing_staff': { role: 'billing_staff', isActive: true, email: 'billing_staff@example.test' },
      'staff/lab_technician': { role: 'lab_technician', isActive: true, email: 'lab_technician@example.test' },
      'staff/owner': { role: 'owner', isActive: true },
      'staff/disabled': { role: 'doctor', isActive: false },
      'staff/stale': { role: 'admin', isActive: true, sourceStaffDocId: 'disabled' },
      'bills/b': { billId: 'OPD-001', grandTotal: 100, amountPaid: 0, balanceDue: 100 },
      'beds/b': { ward: 'General', status: 'available' },
      'prescriptions/rx': { status: 'pending', diagnosis: 'original' },
      'appointments/consult-appointment': { patientId: 'SA-001', status: 'scheduled' },
      'opTokens/consult-token': { patientId: 'SA-001', status: 'serving' },
      'hospitalSettings/main': { hospitalName: 'Hospital', integrations: { internal: true } },
      'publicHospital/main': { hospitalName: 'Hospital' },
      'opTokens/t': { patientName: 'Private', patientId: 'SA-001', date: '2026-01-01' },
      'publicQueue/t': { tokenNo: 1, status: 'waiting', date: '2026-01-01' },
      'patientPortalAccess/p': { hash: 'secret' }
    };
    await Promise.all(Object.entries(rows).map(([key, value]) => setDoc(doc(db, key), value)));
  });
});
after(async () => { if (env) await env.cleanup(); });
function dbAs(uid) { return env.authenticatedContext(uid, { email: uid + '@example.test' }).firestore(); }
const ruleTest = (name, callback) => test(name, { skip: !enabled }, callback);

ruleTest('public pages access projections but cannot read patient, staff, queue or integration data', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'publicHospital/main')));
  await assertSucceeds(getDocs(collection(db, 'publicQueue')));
  for (const key of ['staff/admin', 'patients/p', 'opTokens/t', 'hospitalSettings/main', 'patientPortalAccess/p']) {
    await assertFails(getDoc(doc(db, key)));
  }
  await assertFails(getDoc(doc(dbAs('outsider'), 'staff/admin')));
});

ruleTest('staff cannot escalate identity; inactive source profile immediately revokes permission', async () => {
  const db = dbAs('doctor');
  await assertSucceeds(updateDoc(doc(db, 'staff/doctor'), { activeSessionId: 'new-session' }));
  await assertFails(updateDoc(doc(db, 'staff/doctor'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'staff/doctor'), { sourceStaffDocId: 'admin' }));
  await assertFails(getDoc(doc(dbAs('stale'), 'patients/p')));
  await assertFails(setDoc(doc(dbAs('outsider'), 'staff/outsider'), { role: 'admin', isActive: true }));
});

ruleTest('patient validation cannot be bypassed through the nested collection wildcard', async () => {
  await assertFails(updateDoc(doc(dbAs('pharmacist'), 'patients/p'), { name: 'Unauthorized' }));
  await assertFails(updateDoc(doc(dbAs('doctor'), 'patients/p'), { phone: null }));
  await assertSucceeds(setDoc(doc(dbAs('pharmacist'), 'patients/p/dispensing/d1'), { medicineName: 'Example' }));
});

ruleTest('doctor consultation can create only an unpaid bill; labs can change only diagnostic fields', async () => {
  const bill = { billType: 'OPD', consultationId: 'c1', grandTotal: 100, amountPaid: 0, paymentStatus: 'unpaid' };
  await assertSucceeds(setDoc(doc(dbAs('doctor'), 'bills/doctor-unpaid'), bill));
  await assertFails(setDoc(doc(dbAs('doctor'), 'bills/doctor-paid'), { ...bill, amountPaid: 100, paymentStatus: 'paid' }));
  await assertSucceeds(updateDoc(doc(dbAs('lab_technician'), 'bills/b'), { reportStatus: 'ready' }));
  await assertFails(updateDoc(doc(dbAs('lab_technician'), 'bills/b'), { grandTotal: 0 }));
  await assertFails(updateDoc(doc(dbAs('nurse'), 'bills/b'), { amountPaid: 100 }));
});

ruleTest('the actual doctor completion transaction writes all linked records once', async () => {
  const db = dbAs('doctor');
  const firestore = () => db;
  firestore.Timestamp = Timestamp;
  firestore.FieldValue = { serverTimestamp };
  const context = { firebase: { firestore }, currentDoctor: { opFee: 300 }, currentDoctorName: 'Dr Test', window: {}, console, todayIso: () => '2026-10-13' };
  const source = fs.readFileSync(path.join(__dirname, '../../js/consultation.js'), 'utf8');
  const start = source.indexOf('async function triggerDownstreamActions(consultation)');
  const end = source.indexOf('window.triggerDownstreamActions = triggerDownstreamActions;', start) + 'window.triggerDownstreamActions = triggerDownstreamActions;'.length;
  // Execute in the SDK's realm: Firestore rejects object literals created in
  // vm contexts as "custom Object" rather than plain document data.
  new Function('firebase', 'currentDoctor', 'currentDoctorName', 'window', 'console', 'todayIso', source.slice(start, end))(
    context.firebase, context.currentDoctor, context.currentDoctorName, context.window, context.console, context.todayIso);
  const consultation = { consultationId: 'integration-consultation', patientId: 'SA-001', patientDocId: 'p',
    patientName: 'Patient', doctorName: 'Dr Test', department: 'Obstetrics',
    appointmentId: 'consult-appointment', tokenId: 'consult-token',
    labOrders: [{ name: 'Haemoglobin', amount: 100 }], imagingOrders: [{ name: 'Scan', amount: 200 }],
    prescription: [{ name: 'Medicine', dosage: '1', frequency: 'daily' }] };
  await assertSucceeds(context.window.triggerDownstreamActions(consultation));
  await assertSucceeds(context.window.triggerDownstreamActions(consultation));
  const saved = await getDoc(doc(db, 'consultations/integration-consultation'));
  const bill = await getDoc(doc(db, 'bills/' + saved.data().billDocId));
  assert.equal(bill.data().grandTotal, 600);
  assert.equal(bill.data().amountPaid, 0);
  assert.equal((await getDoc(doc(db, 'billCounters/opd'))).data().count, 1);
  assert.equal((await getDoc(doc(db, 'appointments/consult-appointment'))).data().status, 'completed');
  assert.equal((await getDoc(doc(db, 'opTokens/consult-token'))).data().status, 'done');
  assert.equal((await getDoc(doc(db, 'prescriptions/RX-integration-consultation'))).data().status, 'pending');
  assert.equal((await getDoc(doc(db, 'patients/p/bills/' + bill.id))).data().grandTotal, 600);
});

ruleTest('pharmacy can allocate bill number and dispense without rewriting a prescription', async () => {
  const db = dbAs('pharmacist');
  await assertSucceeds(setDoc(doc(db, 'billCounters/pharmacy'), { count: 1 }));
  await assertSucceeds(updateDoc(doc(db, 'prescriptions/rx'), { status: 'dispensed', dispensedBy: 'pharmacist@example.test' }));
  await assertFails(updateDoc(doc(db, 'prescriptions/rx'), { diagnosis: 'changed' }));
  await assertSucceeds(updateDoc(doc(dbAs('billing_staff'), 'beds/b'), { status: 'occupied' }));
});

ruleTest('certificate serials and counter can only be created by the issuing server function', async () => {
  await assertFails(setDoc(doc(dbAs('admin'), 'certificates/browser-issued'), { certificateType: 'medical', certificateNo: 'JYO/MC/2026/00001', status: 'issued', recordedBy: 'admin@example.test' }));
  await assertFails(setDoc(doc(dbAs('doctor'), 'certificateCounters/MC-2026'), { count: 1 }));
});

ruleTest('payments are immutable and browser cannot impersonate Razorpay verification', async () => {
  const db = dbAs('billing_staff');
  await assertSucceeds(setDoc(doc(db, 'payments/manual'), { amount: 100, recordedBy: 'billing_staff@example.test' }));
  await assertFails(updateDoc(doc(db, 'payments/manual'), { amount: 1 }));
  await assertFails(setDoc(doc(db, 'payments/fake-razorpay'), { amount: 100, provider: 'razorpay' }));
  await assertFails(setDoc(doc(db, 'payments/fake-refund'), { amount: -100, type: 'refund', reason: 'x' }));
  await assertFails(getDoc(doc(dbAs('admin'), 'patientPortalAccess/p')));
});

ruleTest('owner remains read-only in clinical and billing workflows', async () => {
  await assertSucceeds(getDoc(doc(dbAs('owner'), 'patients/p')));
  await assertFails(updateDoc(doc(dbAs('owner'), 'patients/p'), { name: 'Changed' }));
  await assertFails(updateDoc(doc(dbAs('owner'), 'bills/b'), { grandTotal: 1 }));
});

test('storage rejects outsiders, non-clinical uploads and unexpected file types', {
  skip: !enabled || !process.env.FIREBASE_STORAGE_EMULATOR_HOST
}, async () => {
  // Storage's Firestore rule lookups use the suite's configured primary project.
  // Use scoped fixtures there; never clear the developer's primary database.
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const [storageHost, storagePort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
  const storageEnv = await initializeTestEnvironment({ projectId: 'demo-jyothsna-hms',
    firestore: { host, port: Number(port) }, storage: { host: storageHost, port: Number(storagePort) } });
  const fixtures = ['_rules_storage_doctor', '_rules_storage_billing'];
  try {
    await storageEnv.withSecurityRulesDisabled(async context => {
      const fixtureDb = context.firestore();
      await setDoc(doc(fixtureDb, 'staff/' + fixtures[0]), { role: 'doctor', isActive: true });
      await setDoc(doc(fixtureDb, 'staff/' + fixtures[1]), { role: 'billing_staff', isActive: true });
    });
    const upload = (uid, type) => uploadBytes(ref(storageEnv.authenticatedContext(uid).storage(), 'reports/test-' + uid), new Uint8Array([1, 2, 3]), { contentType: type });
    await assertFails(upload('_rules_storage_outsider', 'application/pdf'));
    await assertFails(upload(fixtures[1], 'application/pdf'));
    await assertFails(upload(fixtures[0], 'text/html'));
    await assertSucceeds(upload(fixtures[0], 'application/pdf'));
    await assertSucceeds(upload(fixtures[0], 'image/png'));
  } finally {
    const { deleteDoc } = require('firebase/firestore');
    await storageEnv.withSecurityRulesDisabled(async context => {
      const fixtureDb = context.firestore();
      for (const uid of fixtures) await deleteDoc(doc(fixtureDb, 'staff/' + uid));
    });
    await storageEnv.cleanup();
  }
});
