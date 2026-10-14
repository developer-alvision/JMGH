/*
 * Provider secrets are deliberately not stored in the browser or Firestore.
 * Set them only when the respective integration is ready to go live:
 * firebase functions:secrets:set RAZORPAY_KEY_ID
 * firebase functions:secrets:set RAZORPAY_KEY_SECRET
 * firebase functions:secrets:set AISENSY_API_KEY
 * firebase functions:secrets:set AISENSY_BILL_TEMPLATE
 * firebase functions:secrets:set SENDGRID_API_KEY
 * firebase functions:secrets:set SENDGRID_FROM_EMAIL
 */
const admin = require('firebase-admin');
const crypto = require('crypto');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
// Import FieldValue directly to avoid emulator-specific issues where
// FieldValue can be undefined before the first db call.
const { FieldValue, Timestamp: FsTimestamp } = require('firebase-admin/firestore');

setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();
const db = admin.firestore();

const REGION = 'asia-south1';
const STAFF_ROLES = ['admin', 'owner', 'doctor', 'nurse', 'receptionist', 'billing_staff', 'pharmacist', 'lab_technician'];
exports.applyHospitalPolicy = onCall({ region: REGION }, async (request) => {
  await requireRole(request, ['admin']);
  const { policy } = require('./hospital-policy.cjs');
  const ref = db.collection('hospitalSettings').doc('main');
  const settings = await ref.get();
  if (settings.exists && settings.get('hospitalPolicyVersion') === policy.version) return { applied: false, version: policy.version };
  const batch = db.batch();
  policy.departments.forEach(name => batch.set(db.collection('departments').doc(name.toLowerCase()), { name, isActive: true }, { merge: true }));
  policy.labs.concat(policy.imaging).forEach(item => batch.set(db.collection('serviceCatalog').doc('JYO-' + item.id), { ...item, code: 'JYO-' + item.id, isActive: true, hospitalPolicyVersion: policy.version }, { merge: true }));
  batch.set(ref, { hospitalPolicyVersion: policy.version, opFeePolicy: policy.fees, policyAppliedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { applied: true, version: policy.version, services: policy.labs.length + policy.imaging.length };
});

// A yearly per-type counter and the immutable certificate commit together.
// A stable request ID makes network retries return the same issued document.
exports.issueHospitalCertificate = onCall({ region: REGION }, async (request) => {
  const identity = await requireRole(request, ['admin', 'doctor', 'nurse', 'receptionist']);
  const input = request.data || {};
  const types = { birth: { prefix: 'BC', roles: ['admin', 'doctor', 'nurse', 'receptionist'] }, delivery: { prefix: 'DC', roles: ['admin', 'doctor', 'nurse'] }, medical: { prefix: 'MC', roles: ['admin', 'doctor'] }, fitness: { prefix: 'FC', roles: ['admin', 'doctor'] } };
  const type = types[input.type];
  if (!type || !type.roles.includes(identity.role)) throw new HttpsError('permission-denied', 'This role cannot issue this certificate type.');
  if (typeof input.patientDocId !== 'string' || !input.patientDocId || input.patientDocId.includes('/')) throw new HttpsError('invalid-argument', 'Select a valid patient.');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)) throw new HttpsError('invalid-argument', 'A valid issuance request ID is required.');
  const data = input.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 30000) throw new HttpsError('invalid-argument', 'Certificate details are invalid or too long.');
  const required = { birth: ['babyGender', 'dateOfBirth', 'fatherName', 'conductedBy'], delivery: ['deliveryDate', 'deliveryType', 'conductedBy'], medical: ['age', 'examinedOn', 'diagnosis', 'restFrom', 'restTo'], fitness: ['age', 'examinedOn', 'fitFor'] };
  if (required[input.type].some(key => data[key] === undefined || data[key] === null || String(data[key]).trim() === '')) throw new HttpsError('invalid-argument', 'Complete the required certificate fields.');
  if (data.restFrom && data.restTo && data.restTo < data.restFrom || data.fitFrom && data.validUntil && data.validUntil < data.fitFrom) throw new HttpsError('invalid-argument', 'Certificate date range is invalid.');
  const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date()));
  const prefix = 'JYO/' + type.prefix + '/' + year + '/';
  const prior = await db.collection('certificates').where('certificateType', '==', input.type).get();
  let priorMax = 0;
  prior.forEach(doc => { const number = String(doc.get('certificateNo') || ''); if (number.startsWith(prefix) && /^\d+$/.test(number.slice(prefix.length))) priorMax = Math.max(priorMax, Number(number.slice(prefix.length))); });
  const certRef = db.collection('certificates').doc(input.requestId);
  const counterRef = db.collection('certificateCounters').doc(type.prefix + '-' + year);
  return db.runTransaction(async transaction => {
    const existing = await transaction.get(certRef);
    if (existing.exists) {
      if (existing.get('recordedBy') !== actorOf(request) || existing.get('patientDocId') !== input.patientDocId || existing.get('certificateType') !== input.type) throw new HttpsError('permission-denied', 'Issuance request belongs to another record.');
      return { id: certRef.id, certificateNo: existing.get('certificateNo'), alreadyIssued: true };
    }
    const counter = await transaction.get(counterRef);
    const patient = await transaction.get(db.collection('patients').doc(input.patientDocId));
    if (!patient.exists) throw new HttpsError('not-found', 'Patient record was not found.');
    const sequence = Math.max(priorMax, counter.exists ? Number(counter.get('count')) || 0 : 0) + 1;
    const certificateNo = prefix + String(sequence).padStart(5, '0');
    transaction.set(counterRef, { count: sequence, year, certificateType: input.type }, { merge: true });
    transaction.set(certRef, { certificateNo, certificateType: input.type, patientId: patient.get('patientId') || '', patientDocId: patient.id, patientName: patient.get('name') || '', data,
      issuedByName: data.issuedByName || identity.staff.name || actorOf(request), issuedByQualification: data.issuedByQualification || identity.staff.specialisation || 'Medical Officer',
      issuedByRegistration: data.issuedByRegistration || identity.staff.registrationNo || '', issuedByRole: identity.role, recordedBy: actorOf(request), status: 'issued', createdAt: FieldValue.serverTimestamp() });
    return { id: certRef.id, certificateNo, alreadyIssued: false };
  });
});
const BILLING_ROLES = ['admin', 'receptionist', 'billing_staff', 'pharmacist'];
const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const aiSensyApiKey = defineSecret('AISENSY_API_KEY');
const aiSensyBillTemplate = defineSecret('AISENSY_BILL_TEMPLATE');
const sendGridApiKey = defineSecret('SENDGRID_API_KEY');
const sendGridFromEmail = defineSecret('SENDGRID_FROM_EMAIL');
const biometricDeviceToken = defineSecret('BIOMETRIC_DEVICE_TOKEN');
const msg91AuthKey = defineSecret('MSG91_AUTH_KEY');
const msg91SenderId = defineSecret('MSG91_SENDER_ID');
const abdmClientId = defineSecret('ABDM_CLIENT_ID');
const abdmClientSecret = defineSecret('ABDM_CLIENT_SECRET');
const backupBucket = defineSecret('BACKUP_BUCKET');
const calendarFeedSecret = defineSecret('CALENDAR_FEED_SECRET');

function requireSignedIn(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
}

// Reads the caller's role from /staff/{uid}. The browser cannot forge this
// because the UID document is only ever written by the Admin SDK.
async function requireRole(request, roles) {
  requireSignedIn(request);
  let staff = await db.collection('staff').doc(request.auth.uid).get();
  if (!staff.exists || staff.get('isActive') !== true) {
    throw new HttpsError('permission-denied', 'This staff account is not active.');
  }
  if (staff.get('sourceStaffDocId') && staff.get('sourceStaffDocId') !== staff.id) {
    staff = await db.collection('staff').doc(staff.get('sourceStaffDocId')).get();
  }
  const role = staff.exists ? String(staff.get('role') || '') : '';
  const isActive = staff.exists && staff.get('isActive') === true;
  if (!isActive || !roles.includes(role)) {
    throw new HttpsError('permission-denied', 'Your role is not allowed to perform this action.');
  }
  return { role: role, staff: staff.data() };
}

function actorOf(request) {
  return (request.auth && (request.auth.token.email || request.auth.uid)) || 'unknown';
}

async function integrationEnabled(name) {
  const settings = await db.collection('hospitalSettings').doc('main').get();
  return Boolean(settings.exists && settings.get('integrations.' + name + '.enabled'));
}

async function getBill(billDocId) {
  if (typeof billDocId !== 'string' || !billDocId) {
    throw new HttpsError('invalid-argument', 'A bill is required.');
  }
  const ref = db.collection('bills').doc(billDocId);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpsError('not-found', 'Bill not found.');
  return { ref, doc, bill: doc.data() };
}

function outstandingAmount(bill) {
  const total = Number(bill.grandTotal || 0);
  // Older pharmacy rows recorded only paymentStatus or balanceDue.
  const paid = bill.amountPaid != null ? Number(bill.amountPaid)
    : bill.balanceDue != null ? total - Number(bill.balanceDue)
      : bill.paymentStatus === 'paid' ? total : 0;
  if (!Number.isFinite(total) || !Number.isFinite(paid) || total < 0 || paid < 0) {
    throw new HttpsError('failed-precondition', 'Bill amounts must be valid before accepting payment.');
  }
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

exports.createRazorpayOrder = onCall({ region: 'asia-south1', secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
  await requireRole(request, BILLING_ROLES);
  if (!(await integrationEnabled('razorpay'))) {
    throw new HttpsError('failed-precondition', 'Razorpay is currently on hold.');
  }
  const { ref, bill } = await getBill((request.data || {}).billDocId);
  if (bill.status === 'cancelled' || bill.paymentStatus === 'cancelled') throw new HttpsError('failed-precondition', 'A cancelled bill cannot be paid.');
  const amount = outstandingAmount(bill);
  if (amount <= 0) throw new HttpsError('failed-precondition', 'This bill has no outstanding balance.');

  const auth = Buffer.from(razorpayKeyId.value() + ':' + razorpayKeySecret.value()).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100), currency: 'INR',
      receipt: String(bill.billId || ref.id).slice(0, 40),
      notes: { billDocId: ref.id, billId: String(bill.billId || '') }
    })
  });
  if (!response.ok) throw new HttpsError('internal', 'Razorpay could not create the payment order.');
  const order = await response.json();
  await db.collection('paymentAttempts').doc(order.id).set({
    provider: 'razorpay', billDocId: ref.id, billId: bill.billId || ref.id,
    amount, status: 'created', createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.token.email || request.auth.uid
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayKeyId.value(), billName: bill.billId || ref.id };
});

exports.verifyRazorpayPayment = onCall({ region: 'asia-south1', secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
  await requireRole(request, BILLING_ROLES);
  const data = request.data || {};
  if (!/^order_[a-zA-Z0-9]+$/.test(data.orderId || '') || !/^pay_[a-zA-Z0-9]+$/.test(data.paymentId || '') || !/^[a-fA-F0-9]{64}$/.test(data.signature || '')) throw new HttpsError('invalid-argument', 'Incomplete payment verification data.');
  const attemptRef = db.collection('paymentAttempts').doc(data.orderId);
  const expected = crypto.createHmac('sha256', razorpayKeySecret.value()).update(data.orderId + '|' + data.paymentId).digest('hex');
  const receivedSignature = String(data.signature);
  if (receivedSignature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSignature))) {
    throw new HttpsError('permission-denied', 'Payment verification failed.');
  }

  // A checkout signature authenticates the IDs, but does not prove capture.
  const auth = Buffer.from(razorpayKeyId.value() + ':' + razorpayKeySecret.value()).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/payments/' + data.paymentId, {
    headers: { Authorization: 'Basic ' + auth }
  });
  if (!response.ok) throw new HttpsError('unavailable', 'Unable to confirm payment with Razorpay. Please retry.');
  const payment = await response.json();
  if (payment.order_id !== data.orderId || payment.status !== 'captured' || payment.currency !== 'INR') {
    throw new HttpsError('failed-precondition', 'The payment has not been captured for this order.');
  }

  await db.runTransaction(async (tx) => {
    const attempt = await tx.get(attemptRef);
    if (!attempt.exists) throw new HttpsError('not-found', 'Payment attempt not found.');
    if (attempt.get('status') === 'verified') {
      if (attempt.get('paymentId') !== data.paymentId) throw new HttpsError('already-exists', 'This order has already been credited.');
      return;
    }
    const billRef = db.collection('bills').doc(attempt.get('billDocId'));
    const billDoc = await tx.get(billRef);
    if (!billDoc.exists) throw new HttpsError('not-found', 'Bill not found.');
    const bill = billDoc.data();
    const amount = Number(attempt.get('amount') || 0);
    if (!Number.isFinite(amount) || amount <= 0 || payment.amount !== Math.round(amount * 100)) {
      throw new HttpsError('failed-precondition', 'Payment amount does not match the order.');
    }
    const grandTotal = Number(bill.grandTotal || 0);
    const alreadyPaid = bill.amountPaid != null ? Number(bill.amountPaid) : grandTotal - outstandingAmount(bill);
    const newAmountPaid = Math.round((alreadyPaid + amount) * 100) / 100;
    const newBalance = Math.max(0, Math.round((grandTotal - newAmountPaid) * 100) / 100);
    const details = Object.assign({}, bill.paymentDetails || {});
    details.Razorpay = { amount: (Number(details.Razorpay && details.Razorpay.amount) || 0) + amount, paymentId: data.paymentId, orderId: data.orderId };
    const methods = Array.from(new Set([].concat(bill.paymentMethods || [], ['Razorpay'])));
    const update = { amountPaid: newAmountPaid, balanceDue: newBalance, paymentStatus: newBalance <= 0 ? 'paid' : 'partial', paymentMethods: methods, paymentDetails: details, lastPaymentAt: FieldValue.serverTimestamp() };
    tx.set(billRef, update, { merge: true });
    if (bill.patientDocId) tx.set(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billRef.id), update, { merge: true });
    tx.set(db.collection('payments').doc('RZP-' + data.paymentId), { paymentId: 'RZP-' + data.paymentId, provider: 'razorpay', billDocId: billRef.id, billId: bill.billId || billRef.id, patientId: bill.patientId || '', amount, razorpayOrderId: data.orderId, razorpayPaymentId: data.paymentId, createdAt: FieldValue.serverTimestamp(), recordedBy: request.auth.token.email || request.auth.uid });
    tx.update(attemptRef, { status: 'verified', paymentId: data.paymentId, verifiedAt: FieldValue.serverTimestamp() });
  });
  return { verified: true };
});

async function billRecipient(billDocId, field, consentField) {
  const { bill } = await getBill(billDocId);
  const patient = bill.patientDocId ? await db.collection('patients').doc(bill.patientDocId).get() : null;
  if (!patient || !patient.exists || patient.get(consentField) !== true) {
    throw new HttpsError('failed-precondition', 'Patient communication consent is required.');
  }
  const recipient = patient.get(field) || bill[field] || '';
  if (!recipient) throw new HttpsError('failed-precondition', 'Patient contact information is missing.');
  return { bill, patient: patient.data(), recipient };
}

// Normalises an Indian mobile number to the 12-digit form providers expect.
function indianMsisdn(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  return digits;
}

async function logMessage(entry) {
  try {
    await db.collection('messageLog').add(Object.assign({
      createdAt: FieldValue.serverTimestamp()
    }, entry));
  } catch (err) {
    console.error('messageLog write failed:', err);
  }
}

// AI Sensy exposes more than one API surface and the correct host and payload
// depend on the account. Both are read from hospitalSettings so the endpoint
// can be corrected without redeploying:
//   integrations.aiSensy.mode    'campaign' (default) or 'direct'
//   integrations.aiSensy.baseUrl overrides the host for either mode
async function aiSensyConfig() {
  const settings = await db.collection('hospitalSettings').doc('main').get();
  const config = (settings.exists && settings.get('integrations.aiSensy')) || {};
  return {
    mode: config.mode === 'direct' ? 'direct' : 'campaign',
    baseUrl: String(config.baseUrl || '').replace(/\/+$/, ''),
    campaignName: String(config.campaignName || '')
  };
}

async function sendAiSensyTemplate(recipient, userName, templateParams) {
  const config = await aiSensyConfig();
  const destination = indianMsisdn(recipient);
  let url;
  let body;

  if (config.mode === 'direct') {
    url = (config.baseUrl || 'https://apis.aisensy.com') + '/project-apis/v1/messages';
    body = {
      to: destination,
      type: 'template',
      template: {
        name: aiSensyBillTemplate.value(),
        language: { code: 'en' },
        components: [{ type: 'body', parameters: templateParams.map((text) => ({ type: 'text', text: String(text) })) }]
      }
    };
  } else {
    url = (config.baseUrl || 'https://backend.aisensy.com') + '/campaign/t1/api/v2';
    body = {
      apiKey: aiSensyApiKey.value(),
      campaignName: config.campaignName || aiSensyBillTemplate.value(),
      destination: destination,
      userName: String(userName || ''),
      templateParams: templateParams.map((text) => String(text))
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.mode === 'direct') headers.Authorization = 'Bearer ' + aiSensyApiKey.value();

  const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text.slice(0, 500), destination: destination };
}

exports.sendBillWhatsApp = onCall({ region: REGION, secrets: [aiSensyApiKey, aiSensyBillTemplate] }, async (request) => {
  await requireRole(request, BILLING_ROLES);
  if (!(await integrationEnabled('aiSensy'))) throw new HttpsError('failed-precondition', 'AI Sensy is currently on hold.');
  const { bill, patient, recipient } = await billRecipient((request.data || {}).billDocId, 'phone', 'whatsAppConsent');
  const result = await sendAiSensyTemplate(recipient, patient.name || bill.patientName || '', [
    patient.name || bill.patientName || '',
    bill.billId || '',
    outstandingAmount(bill).toFixed(2)
  ]);

  await logMessage({
    channel: 'whatsapp', provider: 'aiSensy', purpose: 'bill',
    billDocId: request.data.billDocId, patientId: bill.patientId || '',
    destination: result.destination, status: result.ok ? 'sent' : 'failed',
    providerStatus: result.status, providerResponse: result.body, sentBy: actorOf(request)
  });

  if (!result.ok) throw new HttpsError('internal', 'AI Sensy could not send the message (HTTP ' + result.status + ').');
  return { sent: true };
});

// ============================================================
// MSG91 SMS FALLBACK Ã¢â‚¬â€ for patients with no WhatsApp.
// Hidden in the UI until integrations.msg91.enabled is true.
// Requires a DLT-approved template; flow variables are passed
// through as ##VAR## substitutions.
// ============================================================
exports.sendPatientSms = onCall({ region: REGION, secrets: [msg91AuthKey, msg91SenderId] }, async (request) => {
  await requireRole(request, ['admin', 'receptionist', 'billing_staff', 'nurse', 'doctor']);
  if (!(await integrationEnabled('msg91'))) throw new HttpsError('failed-precondition', 'SMS delivery is currently on hold.');

  const data = request.data || {};
  const templateId = String(data.templateId || '').trim();
  const patientDocId = String(data.patientDocId || '').trim();
  if (!templateId || !patientDocId) throw new HttpsError('invalid-argument', 'A patient and a DLT template are required.');

  const patient = await db.collection('patients').doc(patientDocId).get();
  if (!patient.exists) throw new HttpsError('not-found', 'Patient not found.');
  if (patient.get('smsConsent') !== true && patient.get('whatsAppConsent') !== true) {
    throw new HttpsError('failed-precondition', 'Patient communication consent is required.');
  }
  const destination = indianMsisdn(patient.get('phone'));
  if (destination.length !== 12) throw new HttpsError('failed-precondition', 'Patient mobile number is not valid.');

  const variables = (data.variables && typeof data.variables === 'object') ? data.variables : {};
  const recipient = Object.assign({}, variables, { mobiles: destination });

  const response = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: msg91AuthKey.value(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, sender: msg91SenderId.value(), short_url: '0', recipients: [recipient] })
  });
  const text = await response.text();

  await logMessage({
    channel: 'sms', provider: 'msg91', purpose: String(data.purpose || 'general'),
    patientId: patient.get('patientId') || '', destination: destination,
    templateId: templateId, status: response.ok ? 'sent' : 'failed',
    providerStatus: response.status, providerResponse: text.slice(0, 500), sentBy: actorOf(request)
  });

  if (!response.ok) throw new HttpsError('internal', 'MSG91 could not send the SMS (HTTP ' + response.status + ').');
  return { sent: true };
});

exports.sendBillEmail = onCall({ region: 'asia-south1', secrets: [sendGridApiKey, sendGridFromEmail] }, async (request) => {
  await requireRole(request, BILLING_ROLES);
  if (!(await integrationEnabled('email'))) throw new HttpsError('failed-precondition', 'Email delivery is currently on hold.');
  const { bill, patient, recipient } = await billRecipient((request.data || {}).billDocId, 'email', 'emailConsent');
  const amount = Number(bill.grandTotal || 0).toFixed(2);
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { Authorization: 'Bearer ' + sendGridApiKey.value(), 'Content-Type': 'application/json' }, body: JSON.stringify({ from: { email: sendGridFromEmail.value() }, personalizations: [{ to: [{ email: recipient }] }], subject: 'Hospital bill ' + String(bill.billId || ''), content: [{ type: 'text/plain', value: 'Dear ' + String(patient.name || bill.patientName || 'Patient') + ',\n\nYour hospital bill ' + String(bill.billId || '') + ' totals INR ' + amount + '.\n\nThank you.' }] }) });
  if (!response.ok) throw new HttpsError('internal', 'Email could not be sent.');
  return { sent: true };
});

function indiaDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = function (type) { return parts.find(function (part) { return part.type === type; }).value; };
  return { date: value('year') + '-' + value('month') + '-' + value('day'), minutes: Number(value('hour')) * 60 + Number(value('minute')) };
}

// Endpoint for a biometric device, its desktop bridge, or device-cloud webhook.
// POST JSON: { biometricId, timestamp, punchType: "check_in" | "check_out" }
exports.syncBiometricPunch = onRequest({ region: 'asia-south1', secrets: [biometricDeviceToken] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const suppliedToken = String(req.get('x-device-token') || req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!suppliedToken || suppliedToken !== biometricDeviceToken.value()) { res.status(401).json({ error: 'Unauthorized device' }); return; }

  const body = req.body || {};
  const biometricId = String(body.biometricId || '').trim();
  const punchType = String(body.punchType || '').trim().toLowerCase();
  const punchAt = new Date(body.timestamp);
  if (!biometricId || !['check_in', 'check_out', 'in', 'out'].includes(punchType) || Number.isNaN(punchAt.getTime())) {
    res.status(400).json({ error: 'biometricId, ISO timestamp, and punchType are required.' }); return;
  }

  try {
    const staffSnapshot = await db.collection('staff').where('biometricId', '==', biometricId).limit(1).get();
    if (staffSnapshot.empty) { res.status(404).json({ error: 'No active staff member matches this biometric ID.' }); return; }
    const staffDoc = staffSnapshot.docs[0];
    const staff = staffDoc.data();
    if (staff.isActive !== true) { res.status(403).json({ error: 'This staff account is not active.' }); return; }
    const india = indiaDateParts(punchAt);
    const attendanceRef = db.collection('attendance').doc(staffDoc.id + '_' + india.date);
    const isClockOut = punchType === 'check_out' || punchType === 'out';

    await db.runTransaction(async function (tx) {
      const existingDoc = await tx.get(attendanceRef);
      const existing = existingDoc.exists ? existingDoc.data() : null;
      if (isClockOut && (!existing || !existing.clockIn)) {
        throw new HttpsError('failed-precondition', 'Clock-in must be received before clock-out.');
      }
      const clockIn = existing && existing.clockIn ? existing.clockIn.toDate() : punchAt;
      const clockOut = isClockOut ? punchAt : (existing && existing.clockOut ? existing.clockOut.toDate() : null);
      const hours = clockOut ? Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000) : 0;
      let status = hours > 0 && hours < 4 ? 'half_day' : 'present';
      if (!isClockOut && (india.minutes > 9 * 60) && status === 'present') status = 'late';
      if (existing && existing.status === 'late' && status === 'present') status = 'late';
      tx.set(attendanceRef, {
        staffId: staffDoc.id, staffName: staff.name || '', staffEmail: staff.email || '', biometricId: staff.biometricId || biometricId,
        role: staff.role || 'unknown', date: india.date,
        clockIn: firebaseAdminTimestamp(clockIn), clockOut: clockOut ? firebaseAdminTimestamp(clockOut) : null,
        totalHours: Number(hours.toFixed(2)), status: status, source: 'biometric_live',
        notes: 'Live biometric ' + (isClockOut ? 'clock-out' : 'clock-in'),
        createdAt: existing && existing.createdAt ? existing.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(), recordedBy: 'biometric_device'
      }, { merge: true });
    });
    res.status(200).json({ ok: true, biometricId: biometricId, date: india.date, action: isClockOut ? 'clock_out' : 'clock_in' });
  } catch (err) {
    const code = err instanceof HttpsError && err.code === 'failed-precondition' ? 409 : 500;
    console.error('Biometric sync failed:', err);
    res.status(code).json({ error: err.message || 'Unable to record punch.' });
  }
});

function firebaseAdminTimestamp(date) {
  return FsTimestamp.fromDate(date);
}

// ============================================================
// STAFF UID SYNC
// The browser used to write /staff/{uid} itself when a staff
// member signed in for the first time, which meant the rules had
// to allow a user to create their own role document. This does
// the same copy server-side, so the browser never needs write
// access to staff records.
// ============================================================
exports.syncStaffUid = onCall({ region: REGION }, async (request) => {
  requireSignedIn(request);
  const uid = request.auth.uid;
  const email = String(request.auth.token.email || '').trim().toLowerCase();
  if (!email) throw new HttpsError('failed-precondition', 'This account has no email address.');

  const uidRef = db.collection('staff').doc(uid);
  const existing = await uidRef.get();
  const matches = await db.collection('staff').where('email', '==', email).get();
  let source = existing.exists ? existing : null;
  if (existing.exists && existing.get('sourceStaffDocId')) {
    source = await db.collection('staff').doc(existing.get('sourceStaffDocId')).get();
    if (!source.exists) throw new HttpsError('permission-denied', 'The staff record has been removed. Contact an administrator.');
  } else {
    const legacy = matches.docs.filter((doc) => doc.id !== uid && !doc.get('sourceStaffDocId'));
    if (legacy.length > 1) throw new HttpsError('failed-precondition', 'Multiple staff profiles use this email. Ask an administrator to merge them.');
    if (legacy.length) source = legacy[0];
  }
  if (!source) throw new HttpsError('not-found', 'No staff record exists for this email address.');
  const data = source.data();
  if (String(data.email || '').trim().toLowerCase() !== email || (data.uid && data.uid !== uid)) {
    throw new HttpsError('permission-denied', 'This staff record belongs to a different account.');
  }
  if (source.id !== uid && !data.uid && !existing.exists && request.auth.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Ask an administrator to link your staff login, or verify your email before the first sign-in.');
  }
  if (existing.exists && existing.get('isActive') !== true && existing.get('isActive') !== 'true') {
    throw new HttpsError('permission-denied', 'This staff account is not active.');
  }
  if (data.isActive !== true && data.isActive !== 'true') {
    throw new HttpsError('permission-denied', 'This staff account is not active.');
  }

  const role = String(data.role || '').toLowerCase();
  if (!STAFF_ROLES.includes(role)) throw new HttpsError('failed-precondition', 'The staff role is not configured correctly.');
  const batch = db.batch();
  batch.set(uidRef, {
    name: data.name || '',
    email: email,
    role: role,
    department: data.department || '',
    biometricId: data.biometricId || '',
    phone: data.phone || '',
    specialisation: data.specialisation || '',
    opFee: Number(data.opFee || 0),
    freeOP: data.freeOP === true || data.freeOP === 'true',
    isActive: true,
    hasLogin: true,
    uid: uid,
    sourceStaffDocId: source.id === uid ? FieldValue.delete() : source.id,
    temporaryPassword: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  if (source.id !== uid) batch.set(source.ref, {
    uid: uid, role: role, isActive: true, hasLogin: true,
    temporaryPassword: FieldValue.delete()
  }, { merge: true });
  await batch.commit();
  return { synced: true, role: role, staffDocId: uid };
});

// Legacy source records remain authoritative while old attendance references
// are in use. Session-only writes never trigger a mirror or overwrite profiles.
exports.syncStaffProfile = onDocumentWritten({ region: REGION, document: 'staff/{staffId}' }, async (event) => {
  const after = event.data.after;
  const before = event.data.before;
  const data = after.exists ? after.data() : before.data();
  if (!data || !data.uid || data.uid === event.params.staffId || data.sourceStaffDocId) return;
  const fields = ['name', 'email', 'role', 'department', 'biometricId', 'phone', 'specialisation', 'opFee', 'freeOP', 'isActive'];
  if (after.exists && before.exists && fields.every((key) => JSON.stringify(after.get(key)) === JSON.stringify(before.get(key)))) return;
  const target = db.collection('staff').doc(data.uid);
  await db.runTransaction(async (tx) => {
    const currentSource = await tx.get(db.collection('staff').doc(event.params.staffId));
    const currentTarget = await tx.get(target);
    if (!currentTarget.exists) return;
    if (!currentSource.exists) {
      tx.update(target, { isActive: false });
      return;
    }
    const current = currentSource.data();
    if (current.uid !== data.uid) return;
    const update = { sourceStaffDocId: event.params.staffId };
    fields.forEach((key) => { if (current[key] !== undefined) update[key] = current[key]; });
    tx.set(target, update, { merge: true });
  });
});

// Public pages subscribe only to these deliberately small projections. Full
// queue records and integration configuration stay behind staff authorization.
async function publishQueueToken(tokenId) {
  const source = db.collection('opTokens').doc(tokenId);
  const target = db.collection('publicQueue').doc(tokenId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(source);
    if (!snap.exists) { tx.delete(target); return; }
    const token = snap.data();
    tx.set(target, { date: token.date || '', tokenNo: token.tokenNo || 0,
      status: token.status || 'waiting', doctorName: token.doctorName || '' });
  });
}

exports.publishQueueDisplay = onDocumentWritten({ region: REGION, document: 'opTokens/{tokenId}' },
  (event) => publishQueueToken(event.params.tokenId));

exports.publishHospitalDisplay = onDocumentWritten({ region: REGION, document: 'hospitalSettings/main' }, async () => {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection('hospitalSettings').doc('main'));
    const target = db.collection('publicHospital').doc('main');
    if (!snap.exists) { tx.delete(target); return; }
    tx.set(target, { hospitalName: String(snap.get('hospitalName') || 'Jyothsna Maternity Hospital') });
  });
});

// Run once after an upgrade (and safely on subsequent admin sign-ins) to
// populate projections for records that predate the Firestore triggers.
exports.refreshPublicDisplays = onCall({ region: REGION }, async (request) => {
  await requireRole(request, ['admin']);
  const settings = await db.collection('hospitalSettings').doc('main').get();
  if (settings.exists) await db.collection('publicHospital').doc('main').set({
    hospitalName: String(settings.get('hospitalName') || 'Jyothsna Maternity Hospital')
  });
  const tokens = await db.collection('opTokens').where('date', '==', indiaDateParts(new Date()).date).get();
  // Use the same transaction as the trigger so a stale backfill cannot
  // overwrite a more recent token update.
  for (const token of tokens.docs) {
    await publishQueueToken(token.id);
  }
  return { refreshed: true, tokens: tokens.docs.length };
});

// ============================================================
// SCHEDULED FIRESTORE BACKUP
// Runs nightly and writes a full export to the GCS bucket named
// in the BACKUP_BUCKET secret. Set a lifecycle rule on that
// bucket (see INTEGRATIONS.md) so old exports are pruned.
// ============================================================
const firestoreAdminClient = new (require('@google-cloud/firestore').v1.FirestoreAdminClient)();

async function runFirestoreExport(trigger, actor) {
  const bucket = String(backupBucket.value() || '').replace(/^gs:\/\//, '').replace(/\/+$/, '');
  if (!bucket) throw new Error('BACKUP_BUCKET secret is not set.');

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const databaseName = firestoreAdminClient.databasePath(projectId, '(default)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputUriPrefix = 'gs://' + bucket + '/firestore-backups/' + stamp;

  const [response] = await firestoreAdminClient.exportDocuments({
    name: databaseName,
    outputUriPrefix: outputUriPrefix,
    collectionIds: [] // empty means every collection
  });

  await db.collection('backupLog').add({
    trigger: trigger,
    startedBy: actor,
    outputUriPrefix: outputUriPrefix,
    operationName: response.name || '',
    status: 'started',
    createdAt: FieldValue.serverTimestamp()
  });

  return { outputUriPrefix: outputUriPrefix, operationName: response.name || '' };
}

exports.scheduledFirestoreExport = onSchedule({
  region: REGION,
  schedule: '30 1 * * *', // 01:30 every day
  timeZone: 'Asia/Kolkata',
  secrets: [backupBucket],
  retryCount: 2
}, async () => {
  try {
    const result = await runFirestoreExport('scheduled', 'cloud-scheduler');
    console.log('Firestore export started:', result.outputUriPrefix);
  } catch (err) {
    console.error('Scheduled Firestore export failed:', err);
    await db.collection('backupLog').add({
      trigger: 'scheduled', status: 'failed', error: String(err.message || err),
      createdAt: FieldValue.serverTimestamp()
    });
    throw err;
  }
});

// Lets an admin take an on-demand backup before a risky change.
exports.startFirestoreBackup = onCall({ region: REGION, secrets: [backupBucket] }, async (request) => {
  await requireRole(request, ['admin']);
  try {
    return await runFirestoreExport('manual', actorOf(request));
  } catch (err) {
    throw new HttpsError('internal', String(err.message || err));
  }
});

// ============================================================
// GOOGLE CALENDAR Ã¢â‚¬â€ subscription feed
// Doctors add one URL to Google Calendar ("From URL") and their
// appointments and theatre list appear on their phone and stay in
// sync. No OAuth consent screen and no per-user tokens to manage.
// ============================================================
function calendarTokenFor(staffId) {
  return crypto.createHmac('sha256', calendarFeedSecret.value()).update('calendar:' + staffId).digest('hex').slice(0, 40);
}

exports.getCalendarFeedUrl = onCall({ region: REGION, secrets: [calendarFeedSecret] }, async (request) => {
  const { role } = await requireRole(request, ['admin', 'doctor', 'receptionist', 'owner']);
  const staffId = String((request.data && request.data.staffId) || request.auth.uid);
  if (role !== 'admin' && staffId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only fetch your own calendar link.');
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const url = 'https://' + REGION + '-' + projectId + '.cloudfunctions.net/calendarFeed'
    + '?staffId=' + encodeURIComponent(staffId) + '&token=' + calendarTokenFor(staffId);
  return { url: url, webcalUrl: url.replace(/^https:/, 'webcal:') };
});

function icsEscape(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Accepts "14:30", "02:30 PM" and "2:30pm".
function minutesFromTimeString(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM)?/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Builds a UTC timestamp from an IST date string and minutes past midnight.
function icsStampFromIst(dateString, minutes) {
  const parts = String(dateString || '').split('-');
  if (parts.length !== 3) return null;
  const utcMs = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, (minutes || 0) - 330, 0);
  const date = new Date(utcMs);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEvent(uid, startStamp, durationMinutes, summary, description, location) {
  const start = new Date(
    startStamp.slice(0, 4) + '-' + startStamp.slice(4, 6) + '-' + startStamp.slice(6, 8) + 'T'
    + startStamp.slice(9, 11) + ':' + startStamp.slice(11, 13) + ':' + startStamp.slice(13, 15) + 'Z'
  );
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const endStamp = end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + startStamp,
    'DTSTART:' + startStamp,
    'DTEND:' + endStamp,
    'SUMMARY:' + icsEscape(summary),
    'DESCRIPTION:' + icsEscape(description),
    'LOCATION:' + icsEscape(location),
    'END:VEVENT'
  ].join('\r\n');
}

exports.calendarFeed = onRequest({ region: REGION, secrets: [calendarFeedSecret], cors: false }, async (req, res) => {
  const staffId = String(req.query.staffId || '');
  const token = String(req.query.token || '');
  if (!staffId || !token) { res.status(400).send('staffId and token are required'); return; }

  const expected = calendarTokenFor(staffId);
  if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
    res.status(401).send('Invalid calendar token'); return;
  }

  try {
    const staffDoc = await db.collection('staff').doc(staffId).get();
    if (!staffDoc.exists || staffDoc.get('isActive') !== true) { res.status(404).send('Unknown staff member'); return; }
    const doctorName = String(staffDoc.get('name') || '');

    // Two weeks back for context, eight weeks ahead for planning.
    const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10);

    const [appointments, theatre] = await Promise.all([
      db.collection('appointments')
        .where('appointmentDate', '>=', from).where('appointmentDate', '<=', to).get(),
      db.collection('otBookings')
        .where('scheduledDate', '>=', from).where('scheduledDate', '<=', to).get()
    ]);

    const events = [];

    appointments.forEach((doc) => {
      const appt = doc.data();
      if (appt.status === 'cancelled') return;
      if (appt.doctorId !== staffId && String(appt.doctorName || '').trim().toLowerCase() !== doctorName.trim().toLowerCase()) return;
      const minutes = minutesFromTimeString(appt.timeSlot);
      const stamp = icsStampFromIst(appt.appointmentDate, minutes === null ? 540 : minutes);
      if (!stamp) return;
      events.push(icsEvent(
        'appt-' + doc.id + '@jyothsna-hms',
        stamp, 15,
        'OP: ' + (appt.patientName || 'Patient') + (appt.tokenNumber ? ' (Token ' + appt.tokenNumber + ')' : ''),
        'Patient ID: ' + (appt.patientId || '') + '\nVisit: ' + (appt.visitType || '') + '\nComplaint: ' + (appt.chiefComplaint || '-'),
        appt.department || 'OPD'
      ));
    });

    theatre.forEach((doc) => {
      const booking = doc.data();
      if (booking.status === 'cancelled') return;
      const surgeon = String(booking.surgeonName || booking.surgeon || '').trim().toLowerCase();
      if (booking.surgeonId !== staffId && surgeon !== doctorName.trim().toLowerCase()) return;
      const minutes = minutesFromTimeString(booking.scheduledTime);
      const stamp = icsStampFromIst(booking.scheduledDate, minutes === null ? 540 : minutes);
      if (!stamp) return;
      events.push(icsEvent(
        'ot-' + doc.id + '@jyothsna-hms',
        stamp, 90,
        'OT: ' + (booking.procedureType || 'Procedure') + ' Ã¢â‚¬â€ ' + (booking.patientName || ''),
        'Patient ID: ' + (booking.patientId || '') + '\nAnaesthetist: ' + (booking.anaesthetistName || '-') + '\nPre-op notes: ' + (booking.preOpNotes || '-'),
        booking.otRoomName || 'Operation Theatre'
      ));
    });

    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Jyothsna Maternity Hospital//HMS//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Jyothsna HMS Ã¢â‚¬â€ ' + icsEscape(doctorName),
      'X-WR-TIMEZONE:Asia/Kolkata'
    ].concat(events).concat(['END:VCALENDAR']).join('\r\n');

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=900');
    res.status(200).send(calendar);
  } catch (err) {
    console.error('Calendar feed failed:', err);
    res.status(500).send('Unable to build calendar feed');
  }
});

// ============================================================
// ABDM / ABHA
// Verification and linking of a patient's ABHA number. Every call
// goes through the gateway server-side so the client secret and
// the session token never reach the browser.
//
// hospitalSettings/main.integrations.abdm:
//   enabled   false until the facility is registered
//   baseUrl   https://dev.abdm.gov.in  (sandbox) or the production host
// ============================================================
async function abdmConfig() {
  const settings = await db.collection('hospitalSettings').doc('main').get();
  const config = (settings.exists && settings.get('integrations.abdm')) || {};
  return {
    baseUrl: String(config.baseUrl || 'https://dev.abdm.gov.in').replace(/\/+$/, ''),
    hipId: String(config.hipId || ''),
    hipName: String(config.hipName || 'Jyothsna Maternity Hospital')
  };
}

let _abdmSession = { token: null, expiresAt: 0 };

async function abdmSessionToken() {
  if (_abdmSession.token && Date.now() < _abdmSession.expiresAt - 60000) return _abdmSession.token;
  const config = await abdmConfig();
  const response = await fetch(config.baseUrl + '/gateway/v0.5/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: abdmClientId.value(), clientSecret: abdmClientSecret.value() })
  });
  if (!response.ok) throw new HttpsError('internal', 'ABDM gateway rejected the session request (HTTP ' + response.status + ').');
  const data = await response.json();
  _abdmSession = {
    token: data.accessToken,
    expiresAt: Date.now() + (Number(data.expiresIn || 1200) * 1000)
  };
  return _abdmSession.token;
}

async function abdmFetch(path, body) {
  const config = await abdmConfig();
  const token = await abdmSessionToken();
  const response = await fetch(config.baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'REQUEST-ID': crypto.randomUUID(),
      TIMESTAMP: new Date().toISOString()
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = { raw: text.slice(0, 500) }; }
  return { ok: response.ok, status: response.status, data: parsed };
}

const ABDM_ROLES = ['admin', 'receptionist', 'nurse', 'doctor'];

// Step 1 Ã¢â‚¬â€ send an OTP to the mobile number registered against the ABHA.
exports.abdmRequestOtp = onCall({ region: REGION, secrets: [abdmClientId, abdmClientSecret] }, async (request) => {
  await requireRole(request, ABDM_ROLES);
  if (!(await integrationEnabled('abdm'))) throw new HttpsError('failed-precondition', 'ABDM is currently on hold.');

  const abhaId = String((request.data && request.data.abhaId) || '').trim();
  if (!/^[0-9-]{14,17}$/.test(abhaId) && !abhaId.includes('@')) {
    throw new HttpsError('invalid-argument', 'Enter a valid ABHA number or ABHA address.');
  }

  const result = await abdmFetch('/v1/auth/init', {
    authMethod: 'MOBILE_OTP',
    healthid: abhaId,
    requester: { type: 'HIP', id: (await abdmConfig()).hipId }
  });
  if (!result.ok) throw new HttpsError('internal', 'ABDM could not send the OTP (HTTP ' + result.status + ').');
  return { txnId: result.data.txnId || result.data.transactionId || '' };
});

// Step 2 Ã¢â‚¬â€ confirm the OTP and store the verified ABHA on the patient.
exports.abdmVerifyAndLink = onCall({ region: REGION, secrets: [abdmClientId, abdmClientSecret] }, async (request) => {
  await requireRole(request, ABDM_ROLES);
  if (!(await integrationEnabled('abdm'))) throw new HttpsError('failed-precondition', 'ABDM is currently on hold.');

  const data = request.data || {};
  const txnId = String(data.txnId || '').trim();
  const otp = String(data.otp || '').trim();
  const patientDocId = String(data.patientDocId || '').trim();
  if (!txnId || !otp || !patientDocId) throw new HttpsError('invalid-argument', 'Transaction, OTP and patient are all required.');

  const patientRef = db.collection('patients').doc(patientDocId);
  const patient = await patientRef.get();
  if (!patient.exists) throw new HttpsError('not-found', 'Patient not found.');

  const result = await abdmFetch('/v1/auth/confirmWithMobileOTP', { txnId: txnId, otp: otp });
  if (!result.ok) throw new HttpsError('permission-denied', 'ABHA verification failed. Check the OTP and try again.');

  const profile = result.data || {};
  const abhaNumber = String(profile.healthIdNumber || profile.ABHANumber || '').trim();
  const abhaAddress = String(profile.healthId || profile.preferredAbhaAddress || '').trim();
  if (!abhaNumber && !abhaAddress) throw new HttpsError('internal', 'ABDM did not return an ABHA identity.');

  await patientRef.set({
    abhaNumber: abhaNumber,
    abhaAddress: abhaAddress,
    abhaVerifiedAt: FieldValue.serverTimestamp(),
    abhaVerifiedBy: actorOf(request)
  }, { merge: true });

  await db.collection('abdmLinks').add({
    patientDocId: patientDocId,
    patientId: patient.get('patientId') || '',
    abhaNumber: abhaNumber,
    abhaAddress: abhaAddress,
    action: 'verified',
    performedBy: actorOf(request),
    createdAt: FieldValue.serverTimestamp()
  });

  return { abhaNumber: abhaNumber, abhaAddress: abhaAddress, name: profile.name || '' };
});

// Removes a link at the patient's request. The audit row stays.
exports.abdmUnlink = onCall({ region: REGION }, async (request) => {
  await requireRole(request, ['admin', 'receptionist']);
  const patientDocId = String((request.data && request.data.patientDocId) || '').trim();
  if (!patientDocId) throw new HttpsError('invalid-argument', 'A patient is required.');

  const patientRef = db.collection('patients').doc(patientDocId);
  const patient = await patientRef.get();
  if (!patient.exists) throw new HttpsError('not-found', 'Patient not found.');

  await patientRef.set({
    abhaNumber: FieldValue.delete(),
    abhaAddress: FieldValue.delete(),
    abhaVerifiedAt: FieldValue.delete(),
    abhaVerifiedBy: FieldValue.delete()
  }, { merge: true });

  await db.collection('abdmLinks').add({
    patientDocId: patientDocId,
    patientId: patient.get('patientId') || '',
    previousAbhaNumber: patient.get('abhaNumber') || '',
    action: 'unlinked',
    performedBy: actorOf(request),
    createdAt: FieldValue.serverTimestamp()
  });

  return { unlinked: true };
});

// ==========================================================
// PATIENT PORTAL Ã¢â‚¬â€ PIN gated read of limited patient data.
// Staff set the PIN from the patient profile (setPatientPortalPin).
// Secrets never leave the hashed form stored on the patient doc.
// ==========================================================
function hashPortalPin(patientId, pin) {
  return crypto.createHash('sha256')
    .update(String(patientId || '').trim().toUpperCase() + '|' + String(pin || '').trim())
    .digest('hex');
}

function securePortalPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}

function equalHash(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string'
    && actual.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function consumePortalAttempt(patientId, ip) {
  // Limits are stored server-side, so changing browser/IP cannot reset the
  // patient limit. An IP limit also bounds scans across many patient IDs.
  const keys = ['patient:' + patientId, 'ip:' + String(ip || 'unknown')];
  const refs = keys.map((key) => db.collection('portalLoginAttempts').doc(crypto.createHash('sha256').update(key).digest('hex')));
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    snapshots.forEach((snap, index) => {
      const current = snap.exists ? snap.data() : {};
      const fresh = !current.resetAt || current.resetAt <= now;
      const count = fresh ? 0 : Number(current.count || 0);
      if (count >= (index === 0 ? 10 : 60)) {
        throw new HttpsError('resource-exhausted', 'Too many portal attempts. Try again in 15 minutes.');
      }
      tx.set(refs[index], { count: count + 1, resetAt: fresh ? now + 15 * 60 * 1000 : current.resetAt });
    });
  });
}

exports.setPatientPortalPin = onCall({ region: REGION }, async (request) => {
  await requireRole(request, ['admin', 'receptionist', 'doctor', 'nurse', 'billing_staff']);
  const data = request.data || {};
  const patientDocId = String(data.patientDocId || '').trim();
  const pin = String(data.pin || '').trim();
  if (!patientDocId) throw new HttpsError('invalid-argument', 'Patient is required.');
  if (!/^\d{4,8}$/.test(pin)) throw new HttpsError('invalid-argument', 'PIN must be 4Ã¢â‚¬â€œ8 digits.');

  const ref = db.collection('patients').doc(patientDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Patient not found.');
  const patientId = snap.get('patientId') || patientDocId;

  const salt = crypto.randomBytes(16).toString('hex');
  const batch = db.batch();
  batch.set(db.collection('patientPortalAccess').doc(patientDocId), {
    salt: salt, hash: securePortalPin(pin, salt),
    updatedAt: FieldValue.serverTimestamp()
  });
  batch.set(ref, {
    portalPinHash: FieldValue.delete(),
    portalPinSetAt: FieldValue.serverTimestamp(),
    portalPinSetBy: actorOf(request)
  }, { merge: true });
  await batch.commit();

  return { ok: true, patientId: patientId };
});

exports.getPatientPortalData = onCall({ region: REGION }, async (request) => {
  const data = request.data || {};
  const patientIdRaw = String(data.patientId || '').trim();
  const pin = String(data.pin || '').trim();
  if (!patientIdRaw || patientIdRaw.length > 80 || !/^\d{4,8}$/.test(pin)) throw new HttpsError('invalid-argument', 'A valid Patient ID and 4Ã¢â‚¬â€œ8 digit PIN are required.');
  const normalizedId = patientIdRaw.replace(/\s+/g, '').toUpperCase().replace(/^MF-/, 'SA-');
  await consumePortalAttempt(normalizedId, request.rawRequest && request.rawRequest.ip);

  const candidates = Array.from(new Set([
    patientIdRaw,
    patientIdRaw.toUpperCase(),
    patientIdRaw.replace(/^MF-/i, 'SA-'),
    patientIdRaw.replace(/^SA-/i, 'MF-'),
    patientIdRaw.replace(/\s+/g, '')
  ]));

  let doc = null;
  let patient = null;
  let patientId = patientIdRaw;
  for (const cand of candidates) {
    const snap = await db.collection('patients').where('patientId', '==', cand).limit(1).get();
    if (!snap.empty) {
      doc = snap.docs[0];
      patient = doc.data() || {};
      patientId = patient.patientId || cand;
      break;
    }
  }
  if (!doc) {
    throw new HttpsError('permission-denied', 'Invalid Patient ID or PIN. Confirm your details with reception.');
  }

  const accessRef = db.collection('patientPortalAccess').doc(doc.id);
  const access = await accessRef.get();
  const expected = patient.portalPinHash;
  const pinOk = access.exists
    ? equalHash(access.get('hash'), securePortalPin(pin, access.get('salt')))
    : expected && (equalHash(expected, hashPortalPin(patientId, pin))
      || candidates.some((c) => equalHash(expected, hashPortalPin(c, pin))));
  if (!pinOk) {
    throw new HttpsError('permission-denied', 'Invalid Patient ID or PIN. Confirm your details with reception.');
  }

  // Upgrade legacy demo / pre-migration PINs after successful verification.
  if (!access.exists) {
    const salt = crypto.randomBytes(16).toString('hex');
    const batch = db.batch();
    batch.set(accessRef, { salt: salt, hash: securePortalPin(pin, salt), updatedAt: FieldValue.serverTimestamp() });
    batch.update(doc.ref, { portalPinHash: FieldValue.delete() });
    await batch.commit();
  }

  const today = new Date();
  const todayIso = indiaDateParts(today).date;

  const [apptSnap, billSnap, reportSnap] = await Promise.all([
    db.collection('appointments').where('patientId', '==', patientId).where('appointmentDate', '>=', todayIso).orderBy('appointmentDate').limit(40).get(),
    db.collection('bills').where('patientId', '==', patientId).orderBy('createdAt', 'desc').limit(40).get(),
    db.collection('reports').where('patientId', '==', patientId).orderBy('createdAt', 'desc').limit(40).get()
  ]);

  const appointments = [];
  apptSnap.forEach((d) => {
    const a = d.data() || {};
    if ((a.appointmentDate || a.date) >= todayIso && a.status !== 'cancelled') {
      appointments.push({
        date: a.appointmentDate || a.date || '',
        time: a.timeSlot || a.time || '',
        doctorName: a.doctorName || '',
        status: a.status || '',
        visitType: a.visitType || ''
      });
    }
  });
  appointments.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const bills = [];
  billSnap.forEach((d) => {
    const b = d.data() || {};
    bills.push({
      billNo: b.billId || b.billNo || b.billNumber || d.id,
      grandTotal: b.grandTotal || 0,
      balanceDue: outstandingAmount(b),
      paymentStatus: b.paymentStatus || '',
      billDate: b.billDate || (b.createdAt && b.createdAt.toDate ? indiaDateParts(b.createdAt.toDate()).date : '')
    });
  });

  const reports = [];
  reportSnap.forEach((d) => {
    const r = d.data() || {};
    reports.push({
      type: r.type || '',
      testName: r.testName || r.scanName || '',
      status: r.reportStatus || r.status || (r.uploadedReport ? 'ready' : 'pending'),
      reportDate: r.reportDate || (r.createdAt && r.createdAt.toDate ? indiaDateParts(r.createdAt.toDate()).date : ''),
      downloadUrl: r.uploadedReport || r.reportStatus === 'ready' || r.status === 'ready' ? (r.fileUrl || r.pdfUrl || '') : ''
    });
  });

  return {
    patient: {
      patientId: patient.patientId || patientId,
      name: patient.name || '',
      edd: patient.edd || '',
      status: patient.status || '',
      dischargePlan: patient.dischargePlan || null
    },
    appointments: appointments.slice(0, 20),
    bills: bills.slice(0, 20),
    reports: reports.slice(0, 20)
  };
});
