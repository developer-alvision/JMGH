'use strict';
// This script is deliberately incapable of seeding the live project.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-jyothsna-hms' });
const db = admin.firestore();
const now = admin.firestore.Timestamp.now();
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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
  batch.set(db.doc('hospitalSettings/main'), { hospitalName: 'Jyothsna Maternity Hospital', name: 'Jyothsna Maternity Hospital', address: 'Local demonstration — configure your hospital address', phone: '', email: '', integrations: {}, createdAt: now });
  batch.set(db.doc('publicHospital/main'), { hospitalName: 'Jyothsna Maternity Hospital', name: 'Jyothsna Maternity Hospital' });
  ['Obstetrics', 'Gynaecology', 'Paediatrics', 'General', 'Emergency', 'NICU'].forEach(name => batch.set(db.collection('departments').doc(name.toLowerCase()), { name, headDoctor: '', description: '', createdAt: now }));
  for (let index = 1; index <= 3; index++) {
    const patientId = `SA-${new Date().getFullYear()}-${String(index).padStart(5, '0')}`;
    const name = ['Demo Ananya', 'Demo Kavya', 'Demo Meera'][index - 1];
    const phone = '900000000' + index;
    batch.set(db.doc('patients/demo-patient-' + index), { patientId, name, nameLower: name.toLowerCase(), phone, age: 26 + index, dob: `${1999-index}-05-12`, gender: 'Female', bloodGroup: 'O+', address: 'Demonstration record', department: 'Obstetrics', doctor: 'Dr. Jyothsna', doctorName: 'Dr. Jyothsna', doctorId: 'local-doctor', status: 'opd', isPregnant: index < 3, lmp: date, edd: '', highRisk: false, allergies: '', createdAt: now, registeredBy: 'admin@jmgh.in' });
    batch.set(db.doc('patientIndex/' + phone), { patientId, name, nameLower: name.toLowerCase(), phone, docId: 'demo-patient-' + index });
  }
  batch.set(db.doc('patientCounter/counter'), { count: 3 });
  for (let index = 1; index <= 6; index++) batch.set(db.doc('beds/demo-bed-' + index), { bedNumber: 'G-' + index, ward: 'General', bedType: 'General', status: 'available', dailyRate: 1500, chargesPerDay: 1500, patientId: '', patientName: '', createdAt: now });
  const services = [{ name: 'Consultation', category: 'Consultation', price: 500 }, { name: 'Complete Blood Count', category: 'Lab', price: 350 }, { name: 'Obstetric Ultrasound', category: 'Imaging', price: 1200 }];
  services.forEach((service, index) => batch.set(db.doc('serviceCatalog/demo-' + index), { ...service, code: 'DEMO-' + index, isActive: true }));
  batch.set(db.doc('pharmacy/demo-paracetamol'), { name: 'Demo Paracetamol 500 mg', medicineName: 'Demo Paracetamol 500 mg', nameLower: 'demo paracetamol 500 mg', genericName: 'Paracetamol', category: 'Tablet', stock: 100, minStock: 10, unitPrice: 2, sellingPrice: 2, price: 2, mrp: 2, purchasePrice: 1, batchNo: 'DEMO-001', batchNumber: 'DEMO-001', expiryDate: '2028-12-31', gstRate: 0, createdAt: now });
  batch.set(db.doc('_local/seed'), { version: 1, createdAt: now });
  await batch.commit();
  console.log('Seeded local staff, patients, beds, service catalog and medicine inventory.');
}
seed().then(() => admin.app().delete()).catch(error => { console.error(error.message); process.exitCode = 1; });
