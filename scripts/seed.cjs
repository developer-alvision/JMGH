'use strict';
// This script is deliberately incapable of seeding the live project.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-jyothsna-hms' });
const db = admin.firestore();
const now = admin.firestore.Timestamp.now();
async function seed() {
  if ((await db.doc('_local/seed').get()).exists) { console.log('Existing local data preserved.'); return; }
  const staff = [
    { uid: 'local-admin',         email: 'admin@jmgh.in',       password: 'Jyothsnaroyal@2018', role: 'admin',         name: 'Admin',              department: 'Administration', specialisation: '',                          opFee: 0,   freeOP: false },
    { uid: 'local-doctor',        email: 'jyothsna@jmgh.in',    password: 'Jyothsna@2018',      role: 'doctor',        name: 'Dr. Jyothsna',       department: 'Obstetrics',     specialisation: 'Obstetrics & Gynaecology',  opFee: 500, freeOP: false },
    { uid: 'local-lab_technician',email: 'lab@jmgh.in',         password: 'Lab@38140',          role: 'lab_technician',name: 'Lab Technician',     department: 'Laboratory',     specialisation: '',                          opFee: 0,   freeOP: false },
    { uid: 'local-pharmacist',    email: 'pharmacy@jmgh.in',    password: 'Pharmacy@38140',     role: 'pharmacist',    name: 'Pharmacist',         department: 'Pharmacy',       specialisation: '',                          opFee: 0,   freeOP: false },
    { uid: 'local-receptionist',  email: 'reception@jmgh.in',   password: 'Receptionist@38140', role: 'receptionist',  name: 'Receptionist',       department: 'Front Desk',     specialisation: '',                          opFee: 0,   freeOP: false },
  ];
  const batch = db.batch();
  for (const s of staff) {
    try { await admin.auth().createUser({ uid: s.uid, email: s.email, password: s.password, displayName: s.name, emailVerified: true }); }
    catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
    batch.set(db.doc('staff/' + s.uid), { uid: s.uid, email: s.email, role: s.role, name: s.name, isActive: true, department: s.department, specialisation: s.specialisation, opFee: s.opFee, freeOP: s.freeOP, createdAt: now });
  }
  batch.set(db.doc('hospitalSettings/main'), { hospitalName: 'Jyothsna Maternity and General Hospital', name: 'Jyothsna Maternity and General Hospital', address: '', phone: '', email: 'admin@jmgh.in', integrations: {}, createdAt: now });
  batch.set(db.doc('publicHospital/main'), { hospitalName: 'Jyothsna Maternity and General Hospital', name: 'Jyothsna Maternity and General Hospital' });
  ['Obstetrics', 'Gynaecology', 'Paediatrics', 'General', 'Emergency', 'NICU'].forEach(name => batch.set(db.collection('departments').doc(name.toLowerCase()), { name, headDoctor: '', description: '', createdAt: now }));
  batch.set(db.doc('patientCounter/counter'), { count: 0 });
  batch.set(db.doc('_local/seed'), { version: 1, createdAt: now });
  await batch.commit();
  console.log('Initialized fresh hospital settings, departments, staff accounts, and zeroed counters.');
}
seed().then(() => admin.app().delete()).catch(error => { console.error(error.message); process.exitCode = 1; });
