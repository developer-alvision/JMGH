// Project comes from js/firebase-config.js, loaded before this file.
// On localhost the emulator settings in helpers.js apply instead.
var firebaseConfig = window.FIREBASE_CONFIG || {};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
var db = firebase.firestore();
var auth = firebase.auth();

// Sign-in before seeding (Firestore rules require an authenticated admin).
// Credentials are asked for at run time and never stored in this file, so a
// known password can never be created on a live hospital project.
function ensureSignedIn() {
    var user = auth.currentUser;
    if (user) return Promise.resolve(user);

    var email = window.prompt('Administrator email for this Firebase project:');
    if (!email) return Promise.reject(new Error('Setup cancelled: no administrator email given.'));
    var password = window.prompt('Password for ' + email + ':');
    if (!password) return Promise.reject(new Error('Setup cancelled: no password given.'));

    return auth.signInWithEmailAndPassword(email, password)
        .then(function (cred) {
            logToConsole('Signed in as ' + email + ' for setup.', 'info');
            return cred.user;
        })
        .catch(function (err) {
            logToConsole('Sign-in failed: ' + err.message, 'error');
            logToConsole('Create an administrator in Firebase Console -> Authentication -> Users, then run setup again.', 'warn');
            throw err;
        });
}

// Dynamic dates for dummy data (DATE FIX 12)
var _today = new Date();
var todayStr = _today.toISOString().split('T')[0];

var _yesterday = new Date();
_yesterday.setDate(_yesterday.getDate() - 1);
var yesterdayStr = _yesterday.toISOString().split('T')[0];

var _tomorrow = new Date();
_tomorrow.setDate(_tomorrow.getDate() + 1);
var tomorrowStr = _tomorrow.toISOString().split('T')[0];

var _followUp = new Date();
_followUp.setDate(_followUp.getDate() + 7);
var followUpStr = _followUp.toISOString().split('T')[0];

// Dynamic maternity demo dates: LMP is approximately 24 weeks before today.
var _sampleLmp = new Date();
_sampleLmp.setDate(_sampleLmp.getDate() - (24 * 7));
var sampleLmpStr = _sampleLmp.toISOString().split('T')[0];
var _sampleEdd = new Date(_sampleLmp);
_sampleEdd.setDate(_sampleEdd.getDate() + 280);
var sampleEddStr = _sampleEdd.toISOString().split('T')[0];
var _sampleAncVisitOne = new Date(_today);
_sampleAncVisitOne.setDate(_sampleAncVisitOne.getDate() - 28);
var sampleAncVisitOneStr = _sampleAncVisitOne.toISOString().split('T')[0];
var _sampleAncVisitTwo = new Date(_today);
_sampleAncVisitTwo.setDate(_sampleAncVisitTwo.getDate() - 7);
var sampleAncVisitTwoStr = _sampleAncVisitTwo.toISOString().split('T')[0];
function maternityIso(weeksAgo) { var d = new Date(_today); d.setDate(d.getDate() - (weeksAgo * 7)); return d.toISOString().split('T')[0]; }
function maternityEdd(lmp) { var d = new Date(lmp + 'T00:00:00'); d.setDate(d.getDate() + 280); return d.toISOString().split('T')[0]; }
var lmp12Str = maternityIso(12), lmp24Str = maternityIso(24), lmp38Str = maternityIso(39);
var edd12Str = maternityEdd(lmp12Str), edd24Str = maternityEdd(lmp24Str), edd38Str = maternityEdd(lmp38Str);

// Log to UI console
function logToConsole(message, type = 'info') {
    const consoleEl = document.getElementById('console');
    if (!consoleEl) return;
    const timeStr = new Date().toTimeString().split(' ')[0];
    let icon = '<i class="fa-solid fa-circle-info"></i>';
    let typeClass = 'log-info';
    if (type === 'success') {
        icon = '<i class="fa-solid fa-circle-check"></i>';
        typeClass = 'log-success';
    } else if (type === 'error') {
        icon = '<i class="fa-solid fa-circle-xmark"></i>';
        typeClass = 'log-error';
    } else if (type === 'warn') {
        icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
        typeClass = 'log-warn';
    }
    const line = document.createElement('div');
    line.className = 'console-line';
    line.innerHTML = `<span class="log-time">[${timeStr}]</span><span class="${typeClass}">${icon} ${message}</span>`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function log(message, type = 'info') {
    logToConsole(message, type);
}

function showCredentialsTable() {
    const credCard = document.getElementById('credentialsCard');
    if (credCard) credCard.style.display = 'block';
}

function showGoDashboardButton() {
    const sumCard = document.getElementById('summaryCard');
    if (sumCard) sumCard.style.display = 'block';
}

function clearConsole() {
    const consoleEl = document.getElementById('console');
    if (consoleEl) {
        consoleEl.innerHTML = '';
        logToConsole('Console cleared.', 'info');
    }
}

// UI Buttons Enabler/Disabler helper
function setButtonsDisabled(disabled) {
    const btns = document.querySelectorAll('.btn');
    btns.forEach(btn => btn.disabled = disabled);
}

// Setup Runner Wrapper
function runSeeder(seederFunc, label) {
    setButtonsDisabled(true);
    logToConsole(`Starting seeding for: ${label}...`, 'info');
    ensureSignedIn()
        .then(() => seederFunc())
        .then(() => {
            logToConsole(`Seeding completed successfully for: ${label}!`, 'success');
        })
        .catch(err => {
            logToConsole(`Error seeding ${label}: ${err.message}`, 'error');
            console.error(err);
        })
        .finally(() => {
            setButtonsDisabled(false);
        });
}

// ── SETUP 1: DOCTORS & STAFF ───────────────────────────────────────────────
function setupDoctors() {
    const staff = {
        'doctor-001': { name: "Dr. Vamsi Krishna", nameLower: "dr. vamsi krishna", email: "vamsi@example.local", role: "doctor", department: "Cardiology", specialisation: "Cardiologist", opFee: 500, freeOP: false, isActive: true, phone: "9876543001", biometricId: "BIO001" },
        'doctor-002': { name: "Dr. Priya Sharma", nameLower: "dr. priya sharma", email: "priya@example.local", role: "doctor", department: "Obstetrics", specialisation: "Obstetrician & Gynaecologist", opFee: 600, freeOP: false, isActive: true, phone: "9876543002", biometricId: "BIO002" },
        'doctor-003': { name: "Dr. Ravi Patel", nameLower: "dr. ravi patel", email: "ravi@example.local", role: "doctor", department: "General", specialisation: "General Physician", opFee: 300, freeOP: false, isActive: true, phone: "9876543003", biometricId: "BIO003" },
        'doctor-004': { name: "Dr. Anand Reddy", nameLower: "dr. anand reddy", email: "anand@example.local", role: "doctor", department: "Orthopaedics", specialisation: "Orthopaedic Surgeon", opFee: 700, freeOP: false, isActive: true, phone: "9876543004", biometricId: "BIO004" },
        'doctor-005': { name: "Dr. Meena Iyer", nameLower: "dr. meena iyer", email: "meena@example.local", role: "doctor", department: "Gynaecology", specialisation: "Gynaecologist", opFee: 500, freeOP: false, isActive: true, phone: "9876543005", biometricId: "BIO005" },
        'admin-001':  { name: "Hospital Administrator", email: "admin@example.local", role: "admin", department: "Administration", isActive: true, phone: "9000000001", biometricId: "BIO006" },
        'owner-001':  { name: "Hospital Owner", email: "owner@example.local", role: "owner", department: "Management", isActive: true, phone: "9000000002", biometricId: "BIO010" },
        'reception-001': { name: "Lakshmi Devi", email: "reception@example.local", role: "receptionist", department: "Administration", isActive: true, biometricId: "BIO007" },
        'nurse-001': { name: "Sister Kavitha", email: "nurse@example.local", role: "nurse", department: "Maternity Ward", isActive: true, phone: "9876500011", biometricId: "BIO011" },
        'billing-001': { name: "Ramesh Billing", email: "billing@example.local", role: "billing_staff", department: "Accounts", isActive: true, phone: "9876500012", biometricId: "BIO012" },
        'lab-001':    { name: "Suresh Kumar", email: "lab@example.local", role: "lab_technician", department: "Laboratory", isActive: true, biometricId: "BIO008" },
        'pharma-001': { name: "Anitha Reddy", email: "pharmacy@example.local", role: "pharmacist", department: "Pharmacy", isActive: true, biometricId: "BIO009" }
    };

    const batch = db.batch();
    Object.keys(staff).forEach(id => {
        const ref = db.collection('staff').doc(id);
        batch.set(ref, {
            ...staff[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    return batch.commit().then(() => {
        logToConsole('Added 9 staff members (5 doctors, 1 admin, 1 receptionist, 1 lab tech, 1 pharmacist) with Biometric IDs.', 'success');
    });
}

// ── SETUP 2: PATIENTS (15 PATIENTS) ─────────────────────────────────────────
function setupPatients() {
    const patients = {
        'patient-001': { patientId: "SA-2026-00001", name: "Rajesh Kumar", nameLower: "rajesh kumar", phone: "9876543210", dob: "1985-04-12", age: 41, gender: "Male", bloodGroup: "B+", address: "123 Jubilee Hills Hyderabad", department: "Cardiology", doctor: "Dr. Vamsi Krishna", emergencyContact: "9876543211", status: "opd" },
        'patient-002': { patientId: "SA-2026-00002", name: "Priya Singh", nameLower: "priya singh", phone: "8765432109", dob: "1990-" + todayStr.substring(5), age: new Date().getFullYear() - 1990, gender: "Female", bloodGroup: "A+", address: "456 Banjara Hills Hyderabad", department: "Neurology", doctor: "Dr. Priya Sharma", emergencyContact: "8765432100", status: "opd" },
        'patient-003': { patientId: "SA-2026-00003", name: "Mohammed Ali", nameLower: "mohammed ali", phone: "7654321098", dob: "1978-12-05", age: 47, gender: "Male", bloodGroup: "O+", address: "789 Secunderabad Hyderabad", department: "General", doctor: "Dr. Ravi Patel", emergencyContact: "7654321099", status: "admitted" },
        'patient-004': { patientId: "SA-2026-00004", name: "Sunita Devi", nameLower: "sunita devi", phone: "6543210987", dob: "1995-03-18", age: 31, gender: "Female", bloodGroup: "AB+", address: "321 Kukatpally Hyderabad", department: "Gynaecology", doctor: "Dr. Meena Iyer", emergencyContact: "6543210988", status: "opd" },
        'patient-005': { patientId: "SA-2026-00005", name: "Venkat Rao", nameLower: "venkat rao", phone: "5432109876", dob: "1965-07-30", age: 60, gender: "Male", bloodGroup: "B-", address: "654 LB Nagar Hyderabad", department: "Cardiology", doctor: "Dr. Vamsi Krishna", emergencyContact: "5432109877", status: "opd" },
        'patient-006': { patientId: "SA-2026-00006", name: "Kavitha Nair", nameLower: "kavitha nair", phone: "4321098765", dob: "2000-11-14", age: 25, gender: "Female", bloodGroup: "O-", address: "987 Madhapur Hyderabad", department: "ENT", doctor: "Dr. Anand Reddy", emergencyContact: "4321098766", status: "emergency" },
        'patient-007': { patientId: "SA-2026-00007", name: "Suresh Babu", nameLower: "suresh babu", phone: "3210987654", dob: "1972-06-25", age: 53, gender: "Male", bloodGroup: "A-", address: "147 Dilsukhnagar Hyderabad", department: "Orthopaedics", doctor: "Dr. Anand Reddy", emergencyContact: "3210987655", status: "opd" },
        
        // 8 More Patients
        'patient-008': { patientId: "SA-2026-00008", name: "Arjun Mehta", nameLower: "arjun mehta", phone: "9123456780", dob: "1988-09-15", age: 37, gender: "Male", bloodGroup: "A+", address: "258 Hitech City Hyderabad", department: "Cardiology", doctor: "Dr. Vamsi Krishna", status: "opd" },
        'patient-009': { patientId: "SA-2026-00009", name: "Deepa Krishnan", nameLower: "deepa krishnan", phone: "9234567801", dob: "1993-02-28", age: 33, gender: "Female", bloodGroup: "B+", address: "369 Ameerpet Hyderabad", department: "Gynaecology", doctor: "Dr. Meena Iyer", status: "opd" },
        'patient-010': { patientId: "SA-2026-00010", name: "Ramesh Yadav", nameLower: "ramesh yadav", phone: "9345678912", dob: "1960-11-20", age: 65, gender: "Male", bloodGroup: "O+", address: "147 Uppal Hyderabad", department: "General", doctor: "Dr. Ravi Patel", status: "opd" },
        'patient-011': { patientId: "SA-2026-00011", name: "Fatima Begum", nameLower: "fatima begum", phone: "9456789023", dob: "1982-07-08", age: 43, gender: "Female", bloodGroup: "AB-", address: "852 Tolichowki Hyderabad", department: "Neurology", doctor: "Dr. Priya Sharma", status: "admitted" },
        'patient-012': { patientId: "SA-2026-00012", name: "Srinivas Reddy", nameLower: "srinivas reddy", phone: "9567890134", dob: "1975-04-22", age: 51, gender: "Male", bloodGroup: "B+", address: "963 Mehdipatnam Hyderabad", department: "Orthopaedics", doctor: "Dr. Anand Reddy", status: "opd" },
        'patient-013': { patientId: "SA-2026-00013", name: "Lakshmi Prasad", nameLower: "lakshmi prasad", phone: "9678901245", dob: "1998-12-10", age: 27, gender: "Female", bloodGroup: "A-", address: "741 Nagole Hyderabad", department: "ENT", doctor: "Dr. Anand Reddy", status: "opd" },
        'patient-014': { patientId: "SA-2026-00014", name: "Kiran Kumar", nameLower: "kiran kumar", phone: "9789012356", dob: "1970-05-17", age: 55, gender: "Male", bloodGroup: "O-", address: "159 Alwal Hyderabad", department: "Cardiology", doctor: "Dr. Vamsi Krishna", status: "icu" },
        'patient-015': { patientId: "SA-2026-00015", name: "Anjali Gupta", nameLower: "anjali gupta", phone: "9890123467", dob: "2002-08-30", age: 23, gender: "Female", bloodGroup: "B+", address: "357 Shamshabad Hyderabad", department: "General", doctor: "Dr. Ravi Patel", status: "opd" },
        'patient-016': { patientId: "SA-2026-00016", name: "Sowmya Reddy", nameLower: "sowmya reddy", phone: "9900123478", dob: "1996-06-14", age: 30, gender: "Female", bloodGroup: "O+", address: "102 Kondapur Hyderabad", department: "Antenatal Care", doctor: "Dr. Meena Iyer", status: "opd", isPregnant: true, lmp: lmp12Str, edd: edd12Str, gravida: 2, para: 1, abortions: 0, highRisk: false, highRiskReason: "", nextVisitDate: maternityIso(2) },
        'patient-017': { patientId: "SA-2026-00017", name: "Nandini Rao", nameLower: "nandini rao", phone: "9900123479", dob: "1992-09-09", age: 33, gender: "Female", bloodGroup: "A+", address: "44 Madhapur Hyderabad", department: "Antenatal Care", doctor: "Dr. Priya Sharma", status: "opd", isPregnant: true, lmp: lmp24Str, edd: edd24Str, gravida: 3, para: 1, abortions: 1, highRisk: true, highRiskReason: "Previous pre-eclampsia", nextVisitDate: maternityIso(1) },
        'patient-018': { patientId: "SA-2026-00018", name: "Kavya Menon", nameLower: "kavya menon", phone: "9900123480", dob: "1994-01-21", age: 32, gender: "Female", bloodGroup: "B+", address: "18 Gachibowli Hyderabad", department: "Obstetrics", doctor: "Dr. Meena Iyer", status: "opd", isPregnant: true, lmp: lmp38Str, edd: edd38Str, gravida: 2, para: 1, abortions: 0, highRisk: false, highRiskReason: "", nextVisitDate: todayStr }
    };

    const batch = db.batch();
    Object.keys(patients).forEach(id => {
        const pRef = db.collection('patients').doc(id);
        const pData = {
            docId: id,
            ...patients[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        batch.set(pRef, pData);

        // Also write to patientIndex doc with ID = phone number
        const iRef = db.collection('patientIndex').doc(patients[id].phone);
        batch.set(iRef, {
            patientId: patients[id].patientId,
            name: patients[id].name,
            phone: patients[id].phone
        });
    });

    // Set Patient Counter
    const cRef = db.collection('patientCounter').doc('counter');
    batch.set(cRef, { count: 18 });

    return batch.commit().then(() => {
        logToConsole('Added 18 patients to /patients and /patientIndex. Seeding /patientCounter count = 18.', 'success');
    });
}

function setupSampleANCVisits() {
    const visits = {
        'anc-demo-001': { patientId: 'SA-2026-00016', patientName: 'Sowmya Reddy', visitDate: maternityIso(8), gestationalWeeks: 4, weight: 58.4, bpSystolic: 110, bpDiastolic: 70, fundalHeight: 0, fetalHeartRate: 0, hb: 11.8, urineAlbumin: 'Nil', complaints: 'Nausea', advice: 'Folic acid and diet advice.', nextVisitDate: maternityIso(4), recordedBy: 'Dr. Meena Iyer' },
        'anc-demo-002': { patientId: 'SA-2026-00016', patientName: 'Sowmya Reddy', visitDate: maternityIso(2), gestationalWeeks: 10, weight: 59.1, bpSystolic: 112, bpDiastolic: 72, fundalHeight: 0, fetalHeartRate: 158, hb: 11.6, urineAlbumin: 'Nil', complaints: 'No complaints', advice: 'Continue supplements.', nextVisitDate: maternityIso(2), recordedBy: 'Dr. Meena Iyer' },
        'anc-demo-003': { patientId: 'SA-2026-00017', patientName: 'Nandini Rao', visitDate: maternityIso(12), gestationalWeeks: 12, weight: 61.0, bpSystolic: 118, bpDiastolic: 76, fundalHeight: 12, fetalHeartRate: 150, hb: 11.1, urineAlbumin: 'Nil', complaints: 'Mild headache', advice: 'Monitor BP.', nextVisitDate: maternityIso(6), recordedBy: 'Dr. Priya Sharma' },
        'anc-demo-004': { patientId: 'SA-2026-00017', patientName: 'Nandini Rao', visitDate: maternityIso(4), gestationalWeeks: 20, weight: 63.2, bpSystolic: 122, bpDiastolic: 80, fundalHeight: 20, fetalHeartRate: 146, hb: 10.8, urineAlbumin: 'Trace', complaints: 'Pedal edema', advice: 'High-risk follow-up and BP monitoring.', nextVisitDate: maternityIso(1), recordedBy: 'Dr. Priya Sharma' },
        'anc-demo-005': { patientId: 'SA-2026-00018', patientName: 'Kavya Menon', visitDate: maternityIso(8), gestationalWeeks: 30, weight: 68.1, bpSystolic: 114, bpDiastolic: 74, fundalHeight: 30, fetalHeartRate: 142, hb: 11.3, urineAlbumin: 'Nil', complaints: 'No complaints', advice: 'Birth preparedness counselling.', nextVisitDate: maternityIso(4), recordedBy: 'Dr. Meena Iyer' },
        'anc-demo-006': { patientId: 'SA-2026-00018', patientName: 'Kavya Menon', visitDate: maternityIso(1), gestationalWeeks: 37, weight: 69.0, bpSystolic: 116, bpDiastolic: 76, fundalHeight: 37, fetalHeartRate: 140, hb: 11.0, urineAlbumin: 'Nil', complaints: 'Pelvic pressure', advice: 'Return immediately for labour signs.', nextVisitDate: todayStr, recordedBy: 'Dr. Meena Iyer' }
    };
    const batch = db.batch();
    Object.keys(visits).forEach(function(id) {
        batch.set(db.collection('ancVisits').doc(id), Object.assign({}, visits[id], { createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
    });
    return batch.commit().then(function() { logToConsole('Added 6 sample ANC visits for 3 pregnant patients.', 'success'); });
}

// ── SETUP 3: MEDICINES ─────────────────────────────────────────────────────
function setupMedicines() {
    const meds = {
        'med-001': { medicineName: "Calpol 500mg", genericName: "Paracetamol 500mg", category: "Analgesic", stock: 500, unitPrice: 2, reorderLevel: 50, expiryDate: "2027-12-31", manufacturer: "GSK", batchNumber: "BATCH001" },
        'med-002': { medicineName: "Augmentin 625mg", genericName: "Amoxicillin 500mg + Clavulanic Acid 125mg", category: "Antibiotic", stock: 200, unitPrice: 15, reorderLevel: 30, expiryDate: "2027-06-30", manufacturer: "GSK", batchNumber: "BATCH002" },
        'med-003': { medicineName: "Glycomet 500mg", genericName: "Metformin Hydrochloride 500mg", category: "Antidiabetic", stock: 300, unitPrice: 3, reorderLevel: 40, expiryDate: "2027-09-30", manufacturer: "USV Private Ltd", batchNumber: "BATCH003" },
        'med-004': { medicineName: "Amlopin 5mg", genericName: "Amlodipine Besylate 5mg", category: "Antihypertensive", stock: 150, unitPrice: 2.5, reorderLevel: 20, expiryDate: "2027-08-31", manufacturer: "Sun Pharma", batchNumber: "BATCH004" },
        'med-005': { medicineName: "Pan-40", genericName: "Pantoprazole Sodium 40mg", category: "Antacid", stock: 400, unitPrice: 6, reorderLevel: 50, expiryDate: "2027-10-31", manufacturer: "Alkem Labs", batchNumber: "BATCH005" },
        'med-006': { medicineName: "Azithral 500mg", genericName: "Azithromycin 500mg", category: "Antibiotic", stock: 100, unitPrice: 22, reorderLevel: 20, expiryDate: "2027-05-31", manufacturer: "Alembic", batchNumber: "BATCH006" },
        'med-007': { medicineName: "Lipvas 10mg", genericName: "Atorvastatin Calcium 10mg", category: "Statin", stock: 200, unitPrice: 8, reorderLevel: 25, expiryDate: "2027-11-30", manufacturer: "Cipla", batchNumber: "BATCH007" },
        'med-008': { medicineName: "Cetzine 10mg", genericName: "Cetirizine Dihydrochloride 10mg", category: "Antihistamine", stock: 250, unitPrice: 1.8, reorderLevel: 30, expiryDate: "2027-07-31", manufacturer: "GlaxoSmithKline", batchNumber: "BATCH008" },
        'med-009': { medicineName: "Dolo 650mg", genericName: "Paracetamol 650mg", category: "Analgesic", stock: 600, unitPrice: 3, reorderLevel: 60, expiryDate: "2027-12-31", manufacturer: "Micro Labs", batchNumber: "BATCH009" },
        'med-010': { medicineName: "Crocin 500mg", genericName: "Paracetamol 500mg", category: "Analgesic", stock: 400, unitPrice: 2.5, reorderLevel: 50, expiryDate: "2027-11-30", manufacturer: "GSK", batchNumber: "BATCH010" },
        'med-011': { medicineName: "Electral Powder", genericName: "Oral Rehydration Salts", category: "Electrolyte", stock: 200, unitPrice: 10, reorderLevel: 30, expiryDate: "2027-12-31", manufacturer: "FDC", batchNumber: "BATCH011" },
        'med-012': { medicineName: "Lantus Solostar", genericName: "Insulin Glargine 100 U/mL", category: "Antidiabetic", stock: 50, unitPrice: 450, reorderLevel: 10, expiryDate: "2026-12-31", manufacturer: "Sanofi", batchNumber: "BATCH012" },
        'med-013': { medicineName: "Oxytocin injection", genericName: "Oxytocin 10 IU", category: "Uterotonic", stock: 100, unitPrice: 50, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-014': { medicineName: "Folic Acid 5mg", genericName: "Folic Acid 5mg", category: "Vitamin", stock: 100, unitPrice: 5, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-015': { medicineName: "Iron + Folic Acid tablets", genericName: "Ferrous Ascorbate + Folic Acid", category: "Supplement", stock: 100, unitPrice: 5, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-016': { medicineName: "Calcium tablets", genericName: "Calcium + Vitamin D3", category: "Supplement", stock: 100, unitPrice: 5, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-017': { medicineName: "Progesterone 200mg", genericName: "Natural Micronized Progesterone 200mg", category: "Hormone", stock: 100, unitPrice: 50, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-018': { medicineName: "Methylergometrine injection", genericName: "Methylergometrine Maleate 0.2mg/ml", category: "Uterotonic", stock: 100, unitPrice: 50, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-019': { medicineName: "Anti-D injection", genericName: "Anti-D Immunoglobulin 300 mcg", category: "Immunoglobulin", stock: 100, unitPrice: 2500, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" },
        'med-020': { medicineName: "Betamethasone injection", genericName: "Betamethasone 4mg/ml", category: "Corticosteroid", stock: 100, unitPrice: 80, reorderLevel: 20, expiryDate: "2028-12-31", manufacturer: "Generic", batchNumber: "BATCH_MAT" }
    };

    const batch = db.batch();
    Object.keys(meds).forEach(id => {
        const ref = db.collection('pharmacy').doc(id);
        batch.set(ref, {
            ...meds[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    return batch.commit().then(() => {
        logToConsole('Added 12 medicine documents to pharmacy catalog.', 'success');
    });
}

// ── SETUP 4: BEDS (22 BEDS & OCCUPANCY) ──────────────────────────────────────
function setupBeds() {
    // Ward layout as specified by the hospital: 12 inpatient beds across
    // General ward, Twin sharing and Private room. The clinical rooms below
    // are working areas rather than ward beds, so they are not part of the 12
    // but the system still needs them to assign labour, theatre and newborn
    // care. Daily rates are placeholders — set the real tariffs on Bed Board
    // before going live.
    const beds = [];

    for (let i = 1; i <= 6; i++) {
        beds.push({ id: `GW-0${i}`, ward: 'General Ward', dailyRate: 1000, status: 'available' });
    }
    for (let i = 1; i <= 4; i++) {
        beds.push({ id: `TS-0${i}`, ward: 'Twin Sharing', dailyRate: 1800, status: 'available' });
    }
    for (let i = 1; i <= 2; i++) {
        beds.push({ id: `PR-0${i}`, ward: 'Private Room', dailyRate: 3000, status: 'available' });
    }

    // Clinical rooms (not counted in the 12 ward beds)
    beds.push({ id: 'LR-01', ward: 'Labour Room', dailyRate: 0, status: 'available' });
    beds.push({ id: 'LR-02', ward: 'Labour Room', dailyRate: 0, status: 'available' });
    beds.push({ id: 'OT-01', ward: 'Operation Theatre', dailyRate: 0, status: 'available' });
    beds.push({ id: 'NICU-01', ward: 'NICU', dailyRate: 2500, status: 'available' });
    beds.push({ id: 'NICU-02', ward: 'NICU', dailyRate: 2500, status: 'available' });
    beds.push({ id: 'ER-01', ward: 'Emergency', dailyRate: 800, status: 'available' });

    const batch = db.batch();
    beds.forEach(bed => {
        batch.set(db.collection('beds').doc(bed.id), {
            bedNumber: bed.id,
            ward: bed.ward,
            dailyRate: bed.dailyRate,
            status: bed.status,
            branchId: 'main'
        });
    });

    return batch.commit().then(() => {
        logToConsole('Beds seeded: 12 ward beds (6 General, 4 Twin Sharing, 2 Private) plus labour room, OT, NICU and emergency. Set real tariffs on Bed Board.', 'success');
    });
}

// ── SETUP 5: SAMPLE BILLS, ADMISSIONS, QUEUES & HISTORY (12 BILLS) ───────────
function setupSampleBills() {
    const bills = [
        {
            docId: 'SA-OPD-2026-00001', parentDocId: 'patient-001',
            billId: 'SA-OPD-2026-00001', patientId: 'SA-2026-00001', patientDocId: 'patient-001', patientName: 'Rajesh Kumar', patientPhone: '9876543210',
            type: 'OPD', visitDoctor: 'Dr. Vamsi Krishna', visitDepartment: 'Cardiology',
            items: [
                { category: 'Consultation', description: 'OPD Consultation Dr. Vamsi Krishna', quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'lab_cbc', description: 'CBC Complete Blood Count', quantity: 1, unitPrice: 350, amount: 350 }
            ],
            subtotal: 850, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 850,
            amountPaid: 850, balanceDue: 0, paymentStatus: 'paid', paymentMethods: ['cash'],
            paymentDetails: { 'cash': { amount: 850 } },
            reportStatus: 'pending', labRequired: true, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-OPD-2026-00002', parentDocId: 'patient-002',
            billId: 'SA-OPD-2026-00002', patientId: 'SA-2026-00002', patientDocId: 'patient-002', patientName: 'Priya Singh', patientPhone: '8765432109',
            type: 'OPD', visitDoctor: 'Dr. Priya Sharma', visitDepartment: 'Neurology',
            items: [
                { category: 'Consultation', description: 'OPD Consultation Dr. Priya Sharma', quantity: 1, unitPrice: 600, amount: 600 }
            ],
            subtotal: 600, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 600,
            amountPaid: 0, balanceDue: 600, paymentStatus: 'unpaid', paymentMethods: [],
            paymentDetails: {},
            reportStatus: 'not_applicable', labRequired: false, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-IPD-2026-00001', parentDocId: 'patient-003',
            billId: 'SA-IPD-2026-00001', patientId: 'SA-2026-00003', patientDocId: 'patient-003', patientName: 'Mohammed Ali', patientPhone: '7654321098',
            type: 'IPD', visitDoctor: 'Dr. Ravi Patel', visitDepartment: 'General',
            bedDocId: 'A-101', bedNumber: 'A-101', bedWard: 'General Ward', dailyRate: 1000, admissionDate: yesterdayStr,
            items: [
                { category: 'Bed Charges', description: 'Bed A-101 General Ward x 1 day', quantity: 1, unitPrice: 1000, amount: 1000 },
                { category: 'Consultation', description: 'IPD Consultation Dr. Ravi Patel', quantity: 1, unitPrice: 300, amount: 300 }
            ],
            subtotal: 1300, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 1300,
            advancePaid: 500, amountPaid: 500, balanceDue: 800, paymentStatus: 'partial', paymentMethods: ['cash'],
            paymentDetails: { 'cash': { amount: 500 } },
            reportStatus: 'pending', labRequired: false, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-ER-2026-00001', parentDocId: 'patient-006',
            billId: 'SA-ER-2026-00001', patientId: 'SA-2026-00006', patientDocId: 'patient-006', patientName: 'Kavitha Nair', patientPhone: '4321098765',
            type: 'ER', visitDoctor: 'Dr. Anand Reddy', visitDepartment: 'Emergency',
            bedDocId: 'ER-01', bedNumber: 'ER-01', bedWard: 'Emergency', dailyRate: 1500, admissionDate: todayStr,
            items: [
                { category: 'Consultation', description: 'Emergency Consultation', quantity: 1, unitPrice: 800, amount: 800 },
                { category: 'lab_fever', description: 'Fever Profile', quantity: 1, unitPrice: 950, amount: 950 }
            ],
            subtotal: 1750, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 1750,
            amountPaid: 0, balanceDue: 1750, paymentStatus: 'unpaid', paymentMethods: [],
            paymentDetails: {},
            reportStatus: 'pending', labRequired: true, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-OPD-2026-00003', parentDocId: 'patient-005',
            billId: 'SA-OPD-2026-00003', patientId: 'SA-2026-00005', patientDocId: 'patient-005', patientName: 'Venkat Rao', patientPhone: '5432109876',
            type: 'OPD', visitDoctor: 'Dr. Vamsi Krishna', visitDepartment: 'Cardiology',
            items: [
                { category: 'Consultation', description: 'OPD Consultation', quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'img_echo', description: 'Echo', quantity: 1, unitPrice: 1500, amount: 1500 }
            ],
            subtotal: 2000, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 2000,
            amountPaid: 0, balanceDue: 2000, paymentStatus: 'due', paymentMethods: ['insurance'],
            paymentDetails: { 'insurance': { amount: 2000, company: 'Star Health' } },
            reportStatus: 'pending', labRequired: false, billedBy: 'admin@example.local'
        },
        
        // 7 More Bills (total 12)
        {
            docId: 'SA-OPD-2026-00004', parentDocId: 'patient-008',
            billId: 'SA-OPD-2026-00004', patientId: 'SA-2026-00008', patientDocId: 'patient-008', patientName: 'Arjun Mehta', patientPhone: '9123456780',
            type: 'OPD', visitDoctor: 'Dr. Vamsi Krishna', visitDepartment: 'Cardiology',
            items: [
                { category: 'Consultation', description: 'OPD Consultation', quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'img_ecg', description: 'ECG', quantity: 1, unitPrice: 300, amount: 300 }
            ],
            subtotal: 800, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 800,
            amountPaid: 800, balanceDue: 0, paymentStatus: 'paid', paymentMethods: ['upi'],
            paymentDetails: { 'upi': { amount: 800 } },
            reportStatus: 'not_applicable', labRequired: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-OPD-2026-00005', parentDocId: 'patient-009',
            billId: 'SA-OPD-2026-00005', patientId: 'SA-2026-00009', patientDocId: 'patient-009', patientName: 'Deepa Krishnan', patientPhone: '9234567801',
            type: 'OPD', visitDoctor: 'Dr. Meena Iyer', visitDepartment: 'Gynaecology',
            items: [
                { category: 'Consultation', description: 'OPD Consultation', quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'lab_urine', description: 'Urine Routine', quantity: 1, unitPrice: 150, amount: 150 }
            ],
            subtotal: 650, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 650,
            amountPaid: 300, balanceDue: 350, paymentStatus: 'partial', paymentMethods: ['cash'],
            paymentDetails: { 'cash': { amount: 300 } },
            reportStatus: 'pending', labRequired: true, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-IPD-2026-00002', parentDocId: 'patient-011',
            billId: 'SA-IPD-2026-00002', patientId: 'SA-2026-00011', patientDocId: 'patient-011', patientName: 'Fatima Begum', patientPhone: '9456789023',
            type: 'IPD', visitDoctor: 'Dr. Priya Sharma', visitDepartment: 'Neurology',
            bedDocId: 'B-101', bedNumber: 'B-101', bedWard: 'Semi-Private', dailyRate: 2000, admissionDate: yesterdayStr,
            items: [
                { category: 'Bed Charges', description: 'Bed B-101 Semi-Private x 2 days', quantity: 2, unitPrice: 2000, amount: 4000 },
                { category: 'Consultation', description: 'IPD Consultation', quantity: 1, unitPrice: 600, amount: 600 },
                { category: 'lab_cbc', description: 'CBC', quantity: 1, unitPrice: 350, amount: 350 }
            ],
            subtotal: 4950, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 4950,
            amountPaid: 2000, balanceDue: 2950, paymentStatus: 'partial', paymentMethods: ['cash'],
            paymentDetails: { 'cash': { amount: 2000 } },
            reportStatus: 'pending', labRequired: true, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-ICU-2026-00001', parentDocId: 'patient-014',
            billId: 'SA-ICU-2026-00001', patientId: 'SA-2026-00014', patientDocId: 'patient-014', patientName: 'Kiran Kumar', patientPhone: '9789012356',
            type: 'ICU', visitDoctor: 'Dr. Vamsi Krishna', visitDepartment: 'ICU',
            bedDocId: 'ICU-01', bedNumber: 'ICU-01', bedWard: 'ICU', dailyRate: 8000, admissionDate: todayStr,
            items: [
                { category: 'Bed Charges', description: 'ICU Bed ICU-01 x 1 day', quantity: 1, unitPrice: 8000, amount: 8000 },
                { category: 'Consultation', description: 'ICU Consultation', quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'lab_cbc', description: 'CBC Urgent', quantity: 1, unitPrice: 350, amount: 350 }
            ],
            subtotal: 8850, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 8850,
            amountPaid: 5000, balanceDue: 3850, paymentStatus: 'partial', paymentMethods: ['cash'],
            paymentDetails: { 'cash': { amount: 5000 } },
            reportStatus: 'pending', labRequired: true, labCompleted: false, isEmergency: true, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-OPD-2026-00006', parentDocId: 'patient-010',
            billId: 'SA-OPD-2026-00006', patientId: 'SA-2026-00010', patientDocId: 'patient-010', patientName: 'Ramesh Yadav', patientPhone: '9345678912',
            type: 'OPD', visitDoctor: 'Dr. Ravi Patel', visitDepartment: 'General',
            items: [
                { category: 'Consultation', description: 'OPD Consultation', quantity: 1, unitPrice: 300, amount: 300 },
                { category: 'lab_bsf', description: 'Blood Sugar Fasting', quantity: 1, unitPrice: 120, amount: 120 },
                { category: 'lab_thyroid', description: 'Thyroid Profile T3 T4 TSH', quantity: 1, unitPrice: 450, amount: 450 }
            ],
            subtotal: 870, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 870,
            amountPaid: 870, balanceDue: 0, paymentStatus: 'paid', paymentMethods: ['cash'],
            paymentDetails: { 'cash': { amount: 870 } },
            reportStatus: 'pending', labRequired: true, labCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-OPD-2026-00007', parentDocId: 'patient-012',
            billId: 'SA-OPD-2026-00007', patientId: 'SA-2026-00012', patientDocId: 'patient-012', patientName: 'Srinivas Reddy', patientPhone: '9567890134',
            type: 'OPD', visitDoctor: 'Dr. Anand Reddy', visitDepartment: 'Orthopaedics',
            items: [
                { category: 'Consultation', description: 'OPD Consultation', quantity: 1, unitPrice: 700, amount: 700 },
                { category: 'img_xray_chest', description: 'X-Ray Chest', quantity: 1, unitPrice: 400, amount: 400 }
            ],
            subtotal: 1100, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 1100,
            amountPaid: 0, balanceDue: 1100, paymentStatus: 'unpaid', paymentMethods: [],
            paymentDetails: {},
            reportStatus: 'pending', labRequired: false, imagingRequired: true, imagingCompleted: false, billedBy: 'admin@example.local'
        },
        {
            docId: 'SA-OPD-2026-00008', parentDocId: 'patient-005',
            billId: 'SA-OPD-2026-00008', patientId: 'SA-2026-00005', patientDocId: 'patient-005', patientName: 'Venkat Rao', patientPhone: '5432109876',
            type: 'OPD', visitDoctor: 'Dr. Vamsi Krishna', visitDepartment: 'Cardiology',
            items: [
                { category: 'Consultation', description: 'Follow-up Consultation', quantity: 1, unitPrice: 500, amount: 500 }
            ],
            subtotal: 500, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0, grandTotal: 500,
            amountPaid: 500, balanceDue: 0, paymentStatus: 'paid', paymentMethods: ['card'],
            paymentDetails: { 'card': { amount: 500 } },
            reportStatus: 'not_applicable', labRequired: false, billedBy: 'admin@example.local'
        }
    ];

    const admissions = [
        {
            id: 'ADM-2026-00001', admissionId: 'ADM-2026-00001', patientId: 'SA-2026-00003', patientName: 'Mohammed Ali',
            bedDocId: 'A-101', bedId: 'A-101', bedNumber: 'A-101', ward: 'General Ward',
            billId: 'SA-IPD-2026-00001', admissionDate: yesterdayStr, dailyRate: 1000,
            status: 'admitted', admittedBy: 'admin@example.local'
        },
        {
            id: 'ADM-2026-00002', admissionId: 'ADM-2026-00002', patientId: 'SA-2026-00006', patientName: 'Kavitha Nair',
            bedDocId: 'ER-01', bedId: 'ER-01', bedNumber: 'ER-01', ward: 'Emergency',
            billId: 'SA-ER-2026-00001', admissionDate: todayStr, dailyRate: 1500,
            status: 'admitted', admittedBy: 'admin@example.local'
        },
        {
            id: 'ADM-2026-00003', admissionId: 'ADM-2026-00003', patientId: 'SA-2026-00011', patientName: 'Fatima Begum',
            bedDocId: 'B-101', bedId: 'B-101', bedNumber: 'B-101', ward: 'Semi-Private',
            billId: 'SA-IPD-2026-00002', admissionDate: yesterdayStr, dailyRate: 2000,
            status: 'admitted', admittedBy: 'admin@example.local'
        },
        {
            id: 'ADM-2026-00004', admissionId: 'ADM-2026-00004', patientId: 'SA-2026-00014', patientName: 'Kiran Kumar',
            bedDocId: 'ICU-01', bedId: 'ICU-01', bedNumber: 'ICU-01', ward: 'ICU',
            billId: 'SA-ICU-2026-00001', admissionDate: todayStr, dailyRate: 8000,
            status: 'admitted', isEmergency: true, admittedBy: 'admin@example.local'
        }
    ];

    const labQueues = [
        {
            id: 'SA-OPD-2026-00001-lab', billId: 'SA-OPD-2026-00001', billDocId: 'SA-OPD-2026-00001', patientId: 'SA-2026-00001', patientName: 'Rajesh Kumar',
            testName: 'CBC Complete Blood Count', amount: 350, visitDoctor: 'Dr. Vamsi Krishna', reportStatus: 'pending', isEmergency: false
        },
        {
            id: 'SA-ER-2026-00001-lab', billId: 'SA-ER-2026-00001', billDocId: 'SA-ER-2026-00001', patientId: 'SA-2026-00006', patientName: 'Kavitha Nair',
            testName: 'Fever Profile', amount: 950, visitDoctor: 'Dr. Anand Reddy', reportStatus: 'pending', isEmergency: true
        },
        {
            id: 'SA-OPD-2026-00005-lab', billId: 'SA-OPD-2026-00005', billDocId: 'SA-OPD-2026-00005', patientId: 'SA-2026-00009', patientName: 'Deepa Krishnan',
            testName: 'Urine Routine', amount: 150, visitDoctor: 'Dr. Meena Iyer', reportStatus: 'pending', isEmergency: false
        },
        {
            id: 'SA-IPD-2026-00002-lab', billId: 'SA-IPD-2026-00002', billDocId: 'SA-IPD-2026-00002', patientId: 'SA-2026-00011', patientName: 'Fatima Begum',
            testName: 'CBC', amount: 350, visitDoctor: 'Dr. Priya Sharma', reportStatus: 'pending', isEmergency: false
        },
        {
            id: 'SA-ICU-2026-00001-lab', billId: 'SA-ICU-2026-00001', billDocId: 'SA-ICU-2026-00001', patientId: 'SA-2026-00014', patientName: 'Kiran Kumar',
            testName: 'CBC Urgent', amount: 350, visitDoctor: 'Dr. Vamsi Krishna', reportStatus: 'pending', isEmergency: true
        },
        {
            id: 'SA-OPD-2026-00006-lab1', billId: 'SA-OPD-2026-00006', billDocId: 'SA-OPD-2026-00006', patientId: 'SA-2026-00010', patientName: 'Ramesh Yadav',
            testName: 'Blood Sugar Fasting', amount: 120, visitDoctor: 'Dr. Ravi Patel', reportStatus: 'pending', isEmergency: false
        },
        {
            id: 'SA-OPD-2026-00006-lab2', billId: 'SA-OPD-2026-00006', billDocId: 'SA-OPD-2026-00006', patientId: 'SA-2026-00010', patientName: 'Ramesh Yadav',
            testName: 'Thyroid Profile T3 T4 TSH', amount: 450, visitDoctor: 'Dr. Ravi Patel', reportStatus: 'pending', isEmergency: false
        }
    ];

    const imagingQueues = [
        {
            id: 'SA-OPD-2026-00007-img', billId: 'SA-OPD-2026-00007', billDocId: 'SA-OPD-2026-00007', patientId: 'SA-2026-00012', patientName: 'Srinivas Reddy',
            testName: 'X-Ray Chest', imagingType: 'X-Ray Chest', amount: 400, visitDoctor: 'Dr. Anand Reddy',
            reportStatus: 'pending', isEmergency: false
        }
    ];

    const dispensingHistory = {
        'disp-001': { patientId: 'SA-2026-00001', patientName: 'Rajesh Kumar', medicineId: 'med-001', medicineName: 'Calpol 500mg', quantity: 10, unitPrice: 2, totalAmount: 20, prescribedBy: 'Dr. Vamsi Krishna', dispensedBy: 'admin@example.local', paymentMethod: 'cash' },
        'disp-002': { patientId: 'SA-2026-00003', patientName: 'Mohammed Ali', medicineId: 'med-004', medicineName: 'Amlopin 5mg', quantity: 30, unitPrice: 6, totalAmount: 180, prescribedBy: 'Dr. Ravi Patel', dispensedBy: 'admin@example.local', paymentMethod: 'cash' },
        'disp-003': { patientId: 'SA-2026-00006', patientName: 'Kavitha Nair', medicineId: 'med-009', medicineName: 'Dolo 650mg', quantity: 5, unitPrice: 3, totalAmount: 15, prescribedBy: 'Dr. Anand Reddy', dispensedBy: 'admin@example.local', paymentMethod: 'cash' }
    };

    const batch = db.batch();

    // 1. Bills
    bills.forEach(b => {
        const bData = {
            ...b,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        delete bData.docId;
        delete bData.parentDocId;

        // Top level bill ref
        batch.set(db.collection('bills').doc(b.docId), bData);

        // Subcollection patient bill ref
        batch.set(db.collection('patients').doc(b.parentDocId).collection('bills').doc(b.docId), bData);
    });

    // 2. Admissions
    admissions.forEach(adm => {
        batch.set(db.collection('admissions').doc(adm.id), {
            ...adm,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    // 3. Lab Queue
    labQueues.forEach(lab => {
        batch.set(db.collection('labQueue').doc(lab.id), {
            ...lab,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    // 4. Imaging Queue
    imagingQueues.forEach(img => {
        batch.set(db.collection('imagingQueue').doc(img.id), {
            ...img,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    // 5. Dispensing History & Stock Update
    Object.keys(dispensingHistory).forEach(id => {
        batch.set(db.collection('dispensingHistory').doc(id), {
            ...dispensingHistory[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    // Stock updates in pharmacy catalog
    batch.update(db.collection('pharmacy').doc('med-001'), { stock: firebase.firestore.FieldValue.increment(-10) });
    batch.update(db.collection('pharmacy').doc('med-004'), { stock: firebase.firestore.FieldValue.increment(-30) });
    batch.update(db.collection('pharmacy').doc('med-009'), { stock: firebase.firestore.FieldValue.increment(-5) });

    // 6. Bill Counters
    batch.set(db.collection('billCounters').doc('opd'), { count: 8 });
    batch.set(db.collection('billCounters').doc('ipd'), { count: 2 });
    batch.set(db.collection('billCounters').doc('er'),  { count: 1 });
    batch.set(db.collection('billCounters').doc('icu'), { count: 1 });
    batch.set(db.collection('billCounters').doc('pharmacy'), { count: 0 });

    return batch.commit().then(() => {
        logToConsole('Added 12 bills (8 OPD, 2 IPD, 1 ER, 1 ICU), 4 admissions, 7 lab queue entries, 1 imaging queue entry, and 3 pharmacy dispensing transaction logs.', 'success');
    });
}

// ── SETUP 6: SETUP ALL DATA ─────────────────────────────────────────────────
async function setupHospitalSettings() {
    await db.collection('hospitalSettings').doc('main').set({
        // Real hospital identity as given in the client requirement form.
        hospitalName: 'Jyothsna Maternity and General Hospital',
        name: 'Jyothsna Maternity and General Hospital',
        address: 'II-253-D-1, Society Colony, Madanapalle',
        phone: '6303674536',
        email: 'jyothsnarayal@gmail.com',
        gstin: '', drugLicenceNo1: '', drugLicenceNo2: '',
        registrationNo: '',
        tagline: 'Compassionate care for mothers and babies',
        // Pharmacy policy — from the requirement form.
        nearExpiryDays: 60,          // "Near-Expiry Alert Period: 2 months"
        dispatchStrategy: 'FEFO',    // "FEFO (First Expiry, First Out)"
        followUpValidityDays: 7,     // "Follow-Up Validity: One week"
        discountApproverRole: 'doctor',
        refundApproverRole: 'doctor',
        // GRN policy — set true to block receiving stock without a PO number.
        grnRequiresPo: false,
        pharmacyBillNote: '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    log('Hospital settings seeded.', 'success');
}

async function verifyHospitalSettings() {
    try {
        const doc = await db.collection('hospitalSettings').doc('main').get();
        if (!doc.exists || !doc.data().hospitalName) {
            await setupHospitalSettings();
        }
    } catch (err) {
        console.error('verifyHospitalSettings error:', err);
    }
}
window.verifyHospitalSettings = verifyHospitalSettings;

async function setupDepartments() {
    const DEFAULT_DEPARTMENTS = ['General','Cardiology','Orthopaedics','Neurology','Gynaecology','Paediatrics','ENT','Ophthalmology','Dermatology','Oncology','Urology','Nephrology','Psychiatry','Dental','Emergency','ICU','Operation Theatre','Obstetrics','Antenatal Care','Postnatal Care','Neonatology','Labour Room','NICU'];
    const batch = db.batch();
    DEFAULT_DEPARTMENTS.forEach(name => {
        batch.set(db.collection('departments').doc(), {
            name: name,
            headDoctor: '',
            description: '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });
    await batch.commit();
    log('17 departments seeded.', 'success');
}

async function setupStaff() {
    await setupDoctors();
    await setupSampleAttendance();
}

function setupSampleAttendance() {
    log('Setting up sample attendance logs...', 'info');
    var batch = db.batch();
    
    // Use module-level todayStr (setup.html does not load helpers.js / todayIso)
    
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth()+1).padStart(2,'0') + '-' + String(yesterday.getDate()).padStart(2,'0');
    
    var staffDetails = [
        { id: 'doctor-001', name: "Dr. Vamsi Krishna", role: "doctor", bio: "BIO001", email: "vamsi@example.local" },
        { id: 'doctor-002', name: "Dr. Priya Sharma", role: "doctor", bio: "BIO002", email: "priya@example.local" },
        { id: 'doctor-003', name: "Dr. Ravi Patel", role: "doctor", bio: "BIO003", email: "ravi@example.local" },
        { id: 'admin-001', name: "Hospital Administrator", role: "admin", bio: "BIO006", email: "admin@example.local" },
        { id: 'reception-001', name: "Lakshmi Devi", role: "receptionist", bio: "BIO007", email: "reception@example.local" }
    ];
    
    var yIn = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 8, 50, 0);
    var yOut = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 17, 0, 0);
    
    staffDetails.forEach(function(s) {
        var ref = db.collection('attendance').doc(s.id + '_' + yesterdayStr);
        batch.set(ref, {
            staffId: s.id,
            staffName: s.name,
            staffEmail: s.email,
            biometricId: s.bio,
            role: s.role,
            date: yesterdayStr,
            clockIn: firebase.firestore.Timestamp.fromDate(yIn),
            clockOut: firebase.firestore.Timestamp.fromDate(yOut),
            totalHours: 8.17,
            status: 'present',
            source: 'import',
            notes: 'Biometric punch logged',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            recordedBy: 'system_seeder'
        });
    });
    
    var today = new Date();
    var tInOnTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 45, 0);
    var tInLate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 20, 0);
    
    batch.set(db.collection('attendance').doc('doctor-001_' + todayStr), {
        staffId: 'doctor-001',
        staffName: 'Dr. Vamsi Krishna',
        staffEmail: 'vamsi@example.local',
        biometricId: 'BIO001',
        role: 'doctor',
        date: todayStr,
        clockIn: firebase.firestore.Timestamp.fromDate(tInOnTime),
        clockOut: null,
        totalHours: 0,
        status: 'present',
        source: 'import',
        notes: '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        recordedBy: 'system_seeder'
    });
    
    batch.set(db.collection('attendance').doc('doctor-002_' + todayStr), {
        staffId: 'doctor-002',
        staffName: 'Dr. Priya Sharma',
        staffEmail: 'priya@example.local',
        biometricId: 'BIO002',
        role: 'doctor',
        date: todayStr,
        clockIn: firebase.firestore.Timestamp.fromDate(tInLate),
        clockOut: null,
        totalHours: 0,
        status: 'late',
        source: 'import',
        notes: 'Late punching',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        recordedBy: 'system_seeder'
    });
    
    batch.set(db.collection('attendance').doc('admin-001_' + todayStr), {
        staffId: 'admin-001',
        staffName: 'Admin Samuel',
        staffEmail: 'admin@example.local',
        biometricId: 'BIO006',
        role: 'admin',
        date: todayStr,
        clockIn: null,
        clockOut: null,
        totalHours: 0,
        status: 'leave',
        source: 'manual',
        notes: 'Casual leave approved',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        recordedBy: 'system_seeder'
    });
    
    return batch.commit().then(function() {
        log('Sample staff attendance records seeded successfully.', 'success');
    });
}
window.setupSampleAttendance = setupSampleAttendance;

function setupAppointments() {
    const appointments = {
        'appt-001': { appointmentId: "appt-001", patientId: "SA-2026-00001", patientName: "Rajesh Kumar", patientPhone: "9876543210", doctorId: "doctor-001", doctorName: "Dr. Vamsi Krishna", department: "Cardiology", appointmentDate: todayStr, timeSlot: "9:00 AM", visitType: "New Visit", chiefComplaint: "Chest pain and breathlessness", tokenNumber: 1, status: "completed", bookedBy: "admin@example.local" },
        'appt-002': { appointmentId: "appt-002", patientId: "SA-2026-00005", patientName: "Venkat Rao", patientPhone: "5432109876", doctorId: "doctor-001", doctorName: "Dr. Vamsi Krishna", department: "Cardiology", appointmentDate: todayStr, timeSlot: "9:30 AM", visitType: "Follow-up", chiefComplaint: "Follow-up for heart condition", tokenNumber: 2, status: "completed", bookedBy: "admin@example.local" },
        'appt-003': { appointmentId: "appt-003", patientId: "SA-2026-00002", patientName: "Priya Singh", patientPhone: "8765432109", doctorId: "doctor-002", doctorName: "Dr. Priya Sharma", department: "Neurology", appointmentDate: todayStr, timeSlot: "10:00 AM", visitType: "New Visit", chiefComplaint: "Severe headache and dizziness", tokenNumber: 1, status: "scheduled", bookedBy: "reception@example.local" },
        'appt-004': { appointmentId: "appt-004", patientId: "SA-2026-00008", patientName: "Arjun Mehta", patientPhone: "9123456780", doctorId: "doctor-001", doctorName: "Dr. Vamsi Krishna", department: "Cardiology", appointmentDate: todayStr, timeSlot: "10:30 AM", visitType: "New Visit", chiefComplaint: "High blood pressure checkup", tokenNumber: 3, status: "in_progress", bookedBy: "admin@example.local" },
        'appt-005': { appointmentId: "appt-005", patientId: "SA-2026-00010", patientName: "Ramesh Yadav", patientPhone: "9345678912", doctorId: "doctor-003", doctorName: "Dr. Ravi Patel", department: "General", appointmentDate: todayStr, timeSlot: "11:00 AM", visitType: "New Visit", chiefComplaint: "Fever and body pain", tokenNumber: 1, status: "completed", bookedBy: "reception@example.local" },
        'appt-006': { appointmentId: "appt-006", patientId: "SA-2026-00009", patientName: "Deepa Krishnan", patientPhone: "9234567801", doctorId: "doctor-005", doctorName: "Dr. Meena Iyer", department: "Gynaecology", appointmentDate: todayStr, timeSlot: "11:30 AM", visitType: "New Visit", chiefComplaint: "Regular checkup", tokenNumber: 1, status: "scheduled", bookedBy: "reception@example.local" },
        'appt-007': { appointmentId: "appt-007", patientId: "SA-2026-00012", patientName: "Srinivas Reddy", patientPhone: "9567890134", doctorId: "doctor-004", doctorName: "Dr. Anand Reddy", department: "Orthopaedics", appointmentDate: todayStr, timeSlot: "2:00 PM", visitType: "New Visit", chiefComplaint: "Knee pain and swelling", tokenNumber: 1, status: "scheduled", bookedBy: "admin@example.local" },
        'appt-008': { appointmentId: "appt-008", patientId: "SA-2026-00015", patientName: "Anjali Gupta", patientPhone: "9890123467", doctorId: "doctor-003", doctorName: "Dr. Ravi Patel", department: "General", appointmentDate: tomorrowStr, timeSlot: "9:00 AM", visitType: "Follow-up", chiefComplaint: "Follow-up after fever treatment", tokenNumber: 1, status: "scheduled", bookedBy: "reception@example.local" }
    };

    const batch = db.batch();
    Object.keys(appointments).forEach(id => {
        const ref = db.collection('appointments').doc(id);
        batch.set(ref, {
            ...appointments[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    return batch.commit().then(() => {
        log('Added 8 appointments', 'success');
    });
}
window.setupAppointments = setupAppointments;

function setupConsultations() {
    const consultations = {
        'cons-001': {
            consultationId: "cons-001",
            appointmentId: "appt-001",
            patientId: "SA-2026-00001",
            patientName: "Rajesh Kumar",
            doctorName: "Dr. Vamsi Krishna",
            doctorId: "doctor-001",
            department: "Cardiology",
            vitals: { bp: "140/90", pulse: "88", temperature: "98.6", weight: "75", height: "170", spo2: "97" },
            chiefComplaint: "Chest pain and breathlessness since 3 days",
            historyOfIllness: "Patient complains of chest pain on exertion, mild breathlessness, no fever",
            examinationFindings: "BP elevated 140/90, pulse regular, chest clear, no pedal edema",
            diagnosis: "Hypertension Grade 1, Rule out Angina",
            advice: "Avoid stress, low salt diet, regular exercise, follow up after reports",
            labOrders: [{name: "CBC Complete Blood Count", amount: 350}, {name: "Lipid Profile", amount: 500}],
            imagingOrders: [{name: "ECG", amount: 300}],
            prescription: [
                { medicine: "Amlopin 5mg", medicineName: "Amlopin 5mg", dosage: "5mg", frequency: "Once daily", duration: "30 days", instructions: "After breakfast" },
                { medicine: "Pan-40", medicineName: "Pan-40", dosage: "40mg", frequency: "Once daily", duration: "15 days", instructions: "Before food" }
            ],
            followUpRequired: true,
            followUpDate: followUpStr,
            followUpNotes: "Review after lab reports",
            status: "completed"
        },
        'cons-002': {
            consultationId: "cons-002",
            appointmentId: "appt-005",
            patientId: "SA-2026-00010",
            patientName: "Ramesh Yadav",
            doctorName: "Dr. Ravi Patel",
            doctorId: "doctor-003",
            department: "General",
            vitals: { bp: "120/80", pulse: "92", temperature: "101.2", weight: "68", height: "165", spo2: "98" },
            chiefComplaint: "Fever since 4 days, body pain, headache",
            historyOfIllness: "Fever started 4 days ago, mild body ache, no vomiting, no loose stools",
            examinationFindings: "Temp 101.2F, throat congested, no rash, abdomen soft",
            diagnosis: "Viral Fever, Rule out Dengue",
            advice: "Rest, plenty of fluids, paracetamol for fever, avoid aspirin",
            labOrders: [{name: "Fever Profile", amount: 950}, {name: "Dengue NS1", amount: 400}],
            imagingOrders: [],
            prescription: [
                { medicine: "Dolo 650mg", medicineName: "Dolo 650mg", dosage: "650mg", frequency: "Three times daily", duration: "5 days", instructions: "After food if fever" },
                { medicine: "Cetzine 10mg", medicineName: "Cetzine 10mg", dosage: "10mg", frequency: "Once daily", duration: "5 days", instructions: "At bedtime" }
            ],
            followUpRequired: true,
            followUpDate: followUpStr,
            followUpNotes: "Review if fever persists",
            status: "completed"
        }
    };

    const batch = db.batch();
    Object.keys(consultations).forEach(id => {
        const ref = db.collection('consultations').doc(id);
        batch.set(ref, {
            ...consultations[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    return batch.commit().then(() => {
        log('Added 2 consultations', 'success');
    });
}
window.setupConsultations = setupConsultations;

function setupPrescriptions() {
    const prescriptions = {
        'rx-001': {
            prescriptionId: "rx-001",
            consultationId: "cons-001",
            patientId: "SA-2026-00001",
            patientName: "Rajesh Kumar",
            doctorName: "Dr. Vamsi Krishna",
            medicines: [
                { medicineName: "Amlopin 5mg", medicine: "Amlopin 5mg", dosage: "5mg", frequency: "Once daily", duration: "30 days", instructions: "After breakfast" },
                { medicineName: "Pan-40", medicine: "Pan-40", dosage: "40mg", frequency: "Once daily", duration: "15 days", instructions: "Before food" }
            ],
            status: "pending"
        },
        'rx-002': {
            prescriptionId: "rx-002",
            consultationId: "cons-002",
            patientId: "SA-2026-00010",
            patientName: "Ramesh Yadav",
            doctorName: "Dr. Ravi Patel",
            medicines: [
                { medicineName: "Dolo 650mg", medicine: "Dolo 650mg", dosage: "650mg", frequency: "Three times daily", duration: "5 days", instructions: "After food" },
                { medicineName: "Cetzine 10mg", medicine: "Cetzine 10mg", dosage: "10mg", frequency: "Once daily", duration: "5 days", instructions: "At bedtime" }
            ],
            status: "pending"
        }
    };

    const batch = db.batch();
    Object.keys(prescriptions).forEach(id => {
        const ref = db.collection('prescriptions').doc(id);
        batch.set(ref, {
            ...prescriptions[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    return batch.commit().then(() => {
        log('Added 2 prescriptions', 'success');
    });
}
window.setupPrescriptions = setupPrescriptions;

function setupLabQueueFromConsultations() {
    const labItems = [
        { patientId: "SA-2026-00001", patientName: "Rajesh Kumar", visitDoctor: "Dr. Vamsi Krishna", testName: "CBC Complete Blood Count", amount: 350, isEmergency: false, source: "doctor_order", consultationId: "cons-001", reportStatus: "pending" },
        { patientId: "SA-2026-00001", patientName: "Rajesh Kumar", visitDoctor: "Dr. Vamsi Krishna", testName: "Lipid Profile", amount: 500, isEmergency: false, source: "doctor_order", consultationId: "cons-001", reportStatus: "pending" },
        { patientId: "SA-2026-00010", patientName: "Ramesh Yadav", visitDoctor: "Dr. Ravi Patel", testName: "Fever Profile", amount: 950, isEmergency: false, source: "doctor_order", consultationId: "cons-002", reportStatus: "pending" },
        { patientId: "SA-2026-00010", patientName: "Ramesh Yadav", visitDoctor: "Dr. Ravi Patel", testName: "Dengue NS1", amount: 400, isEmergency: false, source: "doctor_order", consultationId: "cons-002", reportStatus: "pending" }
    ];

    const imagingItems = [
        { patientId: "SA-2026-00001", patientName: "Rajesh Kumar", visitDoctor: "Dr. Vamsi Krishna", imagingType: "ECG", amount: 300, isEmergency: false, source: "doctor_order", consultationId: "cons-001", reportStatus: "pending" }
    ];

    const batch = db.batch();
    
    labItems.forEach(item => {
        const ref = db.collection('labQueue').doc();
        batch.set(ref, {
            ...item,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    imagingItems.forEach(item => {
        const ref = db.collection('imagingQueue').doc();
        batch.set(ref, {
            ...item,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    return batch.commit().then(() => {
        log('Added lab and imaging queue entries from consultations', 'success');
    });
}
window.setupLabQueueFromConsultations = setupLabQueueFromConsultations;

function setupOTBookings() {
    const bookings = {
        'ot-001': {
            bookingId: 'ot-001',
            patientId: 'SA-2026-00011',
            patientDocId: 'patient-011',
            patientName: 'Fatima Begum',
            procedureType: 'Cesarean Section',
            surgeonName: 'Dr. Vamsi Krishna',
            surgeonId: 'doctor-001',
            anaesthetistName: 'Dr. Priya Sharma',
            otRoomId: 'OT-01',
            otRoomName: 'OT-01',
            scheduledDate: todayStr,
            scheduledTime: '10:00 AM',
            charge: 45000,
            preOpNotes: 'Routine pre-op check complete.',
            status: 'scheduled',
            billId: 'SA-OT-2026-00001',
            billDocId: 'SA-OT-2026-00001'
        },
        'ot-002': {
            bookingId: 'ot-002',
            patientId: 'SA-2026-00009',
            patientDocId: 'patient-009',
            patientName: 'Deepa Krishnan',
            procedureType: 'Normal Delivery',
            surgeonName: 'Dr. Meena Iyer',
            surgeonId: 'doctor-005',
            anaesthetistName: 'Dr. Priya Sharma',
            otRoomId: 'OT-02',
            otRoomName: 'OT-02',
            scheduledDate: todayStr,
            scheduledTime: '02:00 PM',
            charge: 25000,
            preOpNotes: 'Maternity ward admission done.',
            status: 'scheduled',
            billId: 'SA-OT-2026-00002',
            billDocId: 'SA-OT-2026-00002'
        }
    };

    const bills = {
        'SA-OT-2026-00001': {
            billId: 'SA-OT-2026-00001',
            type: 'OT',
            patientId: 'SA-2026-00011',
            patientDocId: 'patient-011',
            patientName: 'Fatima Begum',
            visitDoctor: 'Dr. Vamsi Krishna',
            visitDepartment: 'Operation Theatre',
            items: [
                { category: 'OT Procedure', description: 'Cesarean Section Procedure', quantity: 1, unitPrice: 45000, amount: 45000, addedAt: todayStr + 'T10:00:00Z' }
            ],
            subtotal: 45000,
            grandTotal: 45000,
            amountPaid: 0,
            balanceDue: 45000,
            paymentStatus: 'unpaid',
            status: 'draft',
            isRunningBill: true,
            isFinalized: false,
            linkedFromBillId: 'SA-IPD-2026-00002',
            bedDocId: 'OT-01',
            bedNumber: 'OT-01'
        },
        'SA-OT-2026-00002': {
            billId: 'SA-OT-2026-00002',
            type: 'OT',
            patientId: 'SA-2026-00009',
            patientDocId: 'patient-009',
            patientName: 'Deepa Krishnan',
            visitDoctor: 'Dr. Meena Iyer',
            visitDepartment: 'Operation Theatre',
            items: [
                { category: 'OT Procedure', description: 'Normal Delivery Procedure', quantity: 1, unitPrice: 25000, amount: 25000, addedAt: todayStr + 'T14:00:00Z' }
            ],
            subtotal: 25000,
            grandTotal: 25000,
            amountPaid: 0,
            balanceDue: 25000,
            paymentStatus: 'unpaid',
            status: 'draft',
            isRunningBill: true,
            isFinalized: false,
            linkedFromBillId: 'SA-OPD-2026-00005',
            bedDocId: 'OT-02',
            bedNumber: 'OT-02'
        }
    };

    const batch = db.batch();
    
    Object.keys(bookings).forEach(id => {
        batch.set(db.collection('otBookings').doc(id), {
            ...bookings[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    Object.keys(bills).forEach(id => {
        batch.set(db.collection('bills').doc(id), {
            ...bills[id],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    batch.update(db.collection('patients').doc('patient-011'), {
        status: 'in_surgery',
        currentBillId: 'SA-OT-2026-00001',
        currentBedId: 'OT-01'
    });
    batch.update(db.collection('patients').doc('patient-009'), {
        status: 'in_surgery',
        currentBillId: 'SA-OT-2026-00002',
        currentBedId: 'OT-02'
    });

    batch.set(db.collection('billCounters').doc('OT'), { count: 2 });

    return batch.commit().then(() => {
        log('Added 2 OT Bookings and generated OT Bills', 'success');
    });
}
window.setupOTBookings = setupOTBookings;

async function setupAll() {
    setButtonsDisabled(true);
    log('Starting complete JMGH HMS setup...', 'info');
    try {
        await ensureSignedIn();
        await setupHospitalSettings();
        await setupDepartments();
        await setupStaff();
        await setupPatients();
        await setupSampleANCVisits();
        await setupMedicines();
        await setupBeds();
        await setupSampleBills();
        await setupAppointments();
        await setupConsultations();
        await setupPrescriptions();
        await setupLabQueueFromConsultations();
        await setupOTBookings();
        await setupFeatureDemoExtras();
        log('', 'info');
        log('=== SETUP COMPLETE — ALL SECTIONS FILLED ===', 'success');
        log('Core: patients, staff, meds, beds, bills, admissions, appointments, consultations, Rx, lab/imaging, OT', 'success');
        log('Maternity: ANC visits, delivery + baby, vaccines, partograph, birth-reg checklist, discharge plan', 'success');
        log('Ops: OP tokens, packages, insurance claims, quality/incidents/consents, tele-consult, USG reports', 'success');
        log('Pharmacy alerts: low-stock + near-expiry sample meds patched', 'success');
        showCredentialsTable();
        showGoDashboardButton();
    } catch(err) {
        log('Setup error: ' + err.message, 'error');
    } finally {
        setButtonsDisabled(false);
    }
}

// ── SETUP 7: CREATE FIREBASE AUTH ACCOUNTS ─────────────────────────────────
function createStaffAuthAccounts() {
    setButtonsDisabled(true);
    logToConsole('Starting staff login accounts generation...', 'info');

    ensureSignedIn().then(function() {

    // Demo logins are NOT shipped with passwords. A one-off password is asked
    // for here so no account with a published password can ever be created on
    // a hospital's live project. Each person changes it at first sign-in.
    var seedPassword = window.prompt('Set a temporary password for the sample staff accounts. Minimum 8 characters. Every user must change it at first sign-in.');
    if (!seedPassword || seedPassword.length < 8) {
        logToConsole('Staff account creation cancelled: a password of at least 8 characters is required.', 'warn');
        return;
    }

    var staffAccounts = [
        { email: 'admin@example.local', password: seedPassword, name: 'Administrator' },
        { email: 'doctor1@example.local', password: seedPassword, name: 'Dr. Sample One' },
        { email: 'doctor2@example.local', password: seedPassword, name: 'Dr. Sample Two' },
        { email: 'reception@example.local', password: seedPassword, name: 'Reception Sample' },
        { email: 'lab@example.local', password: seedPassword, name: 'Lab Sample' },
        { email: 'pharmacy@example.local', password: seedPassword, name: 'Pharmacy Sample' }
    ];
    
    var secondaryApp;
    try {
        secondaryApp = firebase.initializeApp(firebaseConfig, 'secondary');
    } catch(e) {
        secondaryApp = firebase.app('secondary');
    }
    
    var chain = Promise.resolve();
    staffAccounts.forEach(function(staff) {
        chain = chain.then(function() {
            return secondaryApp.auth()
                .createUserWithEmailAndPassword(staff.email, staff.password)
                .then(function(userCredential) {
                    var uid = userCredential.user.uid;
                    return secondaryApp.auth().signOut().then(function() {
                        return db.collection('staff').where('email', '==', staff.email).get()
                            .then(function(snap) {
                                var existingData = !snap.empty ? snap.docs[0].data() : {};
                                var defaultRole = staff.email.includes('admin') ? 'admin' : (staff.email.includes('reception') ? 'receptionist' : staff.email.includes('lab') ? 'lab_technician' : staff.email.includes('pharmacy') ? 'pharmacist' : 'doctor');
                                var role = (existingData.role || defaultRole).toLowerCase();
                                var uidStaffData = {
                                    name: existingData.name || staff.name,
                                    email: staff.email,
                                    role: role,
                                    department: existingData.department || (role === 'admin' ? 'Administration' : role === 'doctor' ? 'Cardiology' : role === 'receptionist' ? 'Administration' : role === 'lab_technician' ? 'Laboratory' : 'Pharmacy'),
                                    biometricId: existingData.biometricId || '',
                                    phone: existingData.phone || '',
                                    isActive: true,
                                    hasLogin: true,
                                    uid: uid,
                                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                };
                                return db.collection('staff').doc(uid).set(uidStaffData, { merge: true });
                            });
                    });
                })
                .then(function() {
                    logToConsole('Created Auth & Staff UID record: ' + staff.name + ' (' + staff.email + ')', 'success');
                })
                .catch(function(err) {
                    if (err.code === 'auth/email-already-in-use') {
                        logToConsole(staff.name + ' auth account already exists.', 'info');
                    } else {
                        logToConsole('Error ' + staff.name + ': ' + err.message, 'error');
                    }
                });
        });
    });
    
    chain.then(function() {
        logToConsole('All staff auth accounts processed!', 'success');
        logToConsole('All sample accounts use the password you entered. Change it at first sign-in.', 'warn');
    }).finally(() => {
        setButtonsDisabled(false);
    });
    }).catch(function(err) {
        logToConsole('Auth sign-in failed: ' + err.message, 'error');
        setButtonsDisabled(false);
    });
}

// ── CHANGE 1: SAFE PURGE (CLEAR ALL DATA) ──────────────────────────────────
async function clearAllData() {
    const confirmed = confirm("This will delete all patient and billing data but keep staff, medicines and beds. Are you sure?");
    if (!confirmed) return;

    setButtonsDisabled(true);
    logToConsole('Initializing database purge routine...', 'warn');

    try {
        await ensureSignedIn();
        // Safe collections list to clear
        const collections = [
            'patients',
            'patientIndex',
            'bills',
            'labQueue',
            'imagingQueue',
            'reports',
            'admissions',
            'dispensingHistory',
            'auditLog',
            'stockReceipts',
            'appointments',
            'consultations',
            'prescriptions',
            'otBookings',
            'ancVisits',
            'deliveries',
            'babies',
            'payments',
            'opTokens',
            'insuranceClaims',
            'vaccinations',
            'partographs',
            'dischargeLogs',
            'incidents',
            'consentRecords',
            'qualityAudits',
            'teleconsults',
            'carePackages',
            'messageLog',
            'paymentAttempts'
        ];
        
        for (const col of collections) {
            logToConsole(`Clearing collection: /${col}...`, 'info');
            const snap = await db.collection(col).get();
            const batch = db.batch();
            snap.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            logToConsole(`Purged /${col} (${snap.size} documents deleted).`, 'success');
        }

        // Clean patients subcollection bills just in case
        logToConsole('Checking patient subcollection bills...', 'info');
        const patSnap = await db.collection('patients').get();
        for (const patDoc of patSnap.docs) {
            const billSnap = await patDoc.ref.collection('bills').get();
            const subBatch = db.batch();
            billSnap.forEach(bDoc => {
                subBatch.delete(bDoc.ref);
            });
            await subBatch.commit();
        }
        logToConsole('Purged any remaining subcollection records.', 'success');

        // Reset all bed occupancy states back to available (FIX 12)
        logToConsole('Resetting all bed occupancy states to available...', 'info');
        const bedsSnap = await db.collection('beds').get();
        const bedBatch = db.batch();
        bedsSnap.forEach(bDoc => {
            bedBatch.update(bDoc.ref, {
                status: 'available',
                patientId: null,
                patientDocId: null,
                patientName: null,
                billId: null,
                billDocId: null,
                admittedAt: null,
                activeAdmissionId: null,
                assignedBy: null,
                assignedAt: null
            });
        });
        await bedBatch.commit();
        logToConsole(`Successfully reset ${bedsSnap.size} beds back to available.`, 'success');

        // Reset Counters to 0 (but never delete them)
        logToConsole('Resetting counter metrics...', 'info');
        await db.collection('patientCounter').doc('counter').set({ count: 0 });
        const countBatch = db.batch();
        ['opd', 'ipd', 'er', 'icu', 'pharmacy', 'beds', 'OT'].forEach(c => {
            countBatch.set(db.collection('billCounters').doc(c), { count: 0 });
        });
        await countBatch.commit();
        logToConsole('Reset patientCounter & billCounters metrics to 0.', 'success');

        // Hide summary card
        document.getElementById('summaryCard').style.display = 'none';

        logToConsole('JMGH HMS database successfully cleared (Staff, Medicines & Beds kept intact)!', 'success');
    } catch (err) {
        logToConsole(`Error during purge: ${err.message}`, 'error');
        console.error(err);
    } finally {
        setButtonsDisabled(false);
    }
}

async function setupFeatureDemoExtras() {
    logToConsole('Filling all module sections with demo data...', 'info');
    var soon = new Date();
    soon.setDate(soon.getDate() + 25);
    var soonStr = soon.toISOString().slice(0, 10);
    var expired = new Date();
    expired.setDate(expired.getDate() - 5);
    var expiredStr = expired.toISOString().slice(0, 10);

    // ---- Packages ----
    var packages = [
        { code: 'PKG-ND', name: 'Normal Delivery Package', price: 35000, inclusions: 'Labour room\nDelivery\n2-day ward stay\nRoutine medicines\nNewborn check', extras: 'NICU, blood, implants', active: true },
        { code: 'PKG-LSCS', name: 'LSCS Package', price: 65000, inclusions: 'OT\nSurgeon & anaesthetist\n3-day stay\nRoutine medicines', extras: 'NICU, blood', active: true },
        { code: 'PKG-ANC', name: 'ANC Care Package', price: 12000, inclusions: '8 ANC visits\nBasic labs\n2 USG', extras: 'High-risk tests', active: true }
    ];
    var pkgBatch = db.batch();
    packages.forEach(function (p) {
        pkgBatch.set(db.collection('carePackages').doc(p.code), Object.assign({}, p, { branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
    });
    await pkgBatch.commit();
    logToConsole('Packages: 3 care packages', 'success');

    // ---- Patient statuses for Current / Past ----
    var p1 = await db.collection('patients').doc('patient-001').get();
    if (p1.exists) await p1.ref.set({ status: 'discharged', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    var p18 = await db.collection('patients').doc('patient-018').get();
    if (p18.exists) {
        await p18.ref.set({
            status: 'admitted',
            portalPinHash: null,
            dischargePlan: {
                checklist: { vitalsStable: true, billsCleared: false, medsDispensed: true, reportsHanded: false, certificateIssued: false, vaccineExplained: true, followUpBooked: false, dangerSigns: true, consentSigned: false },
                diagnosis: 'Term pregnancy — LSCS planned',
                course: 'Admitted for elective LSCS. Antenatal course uneventful. Pre-op labs within normal limits.',
                meds: 'Iron, Calcium, Paracetamol SOS',
                advice: 'Watch for fever, bleeding, wound soakage. Exclusive breastfeeding.',
                followUp: tomorrowStr,
                vaccines: 'BCG, Hep-B (birth), OPV-0'
            }
        }, { merge: true });
    }
    logToConsole('Patients: 1 discharged (past) + Kavya admitted with discharge plan', 'success');

    // ---- Delivery + baby + birth registration ----
    await db.collection('deliveries').doc('delivery-demo-001').set({
        patientId: 'SA-2026-00004',
        patientName: 'Sunita Devi',
        deliveryDate: yesterdayStr,
        deliveryTime: '06:45',
        deliveryType: 'Normal',
        weeks: 39,
        conductedBy: 'Dr. Meena Iyer',
        place: 'Jyothsna Maternity Hospital',
        motherCondition: 'Stable',
        bloodLoss: 250,
        complications: '',
        notes: 'Demo delivery for birth-registration checklist',
        branchId: 'main',
        birthRegistration: {
            parentsIdProof: true,
            addressProof: true,
            hospitalCertificate: true,
            informantDetails: false,
            readyToFile: false,
            crsFiled: false,
            notes: 'Awaiting informant signature'
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('babies').doc('baby-demo-001').set({
        deliveryId: 'delivery-demo-001',
        motherId: 'SA-2026-00004',
        motherName: 'Sunita Devi',
        name: 'Baby of Sunita',
        sex: 'Female',
        weight: 2.9,
        birthWeight: 2.9,
        apgar1: 8,
        apgar5: 9,
        branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('patients').doc('patient-004').set({ status: 'postnatal', isPregnant: false }, { merge: true });
    logToConsole('Maternity: delivery + newborn + birth-reg checklist', 'success');

    // ---- Vaccinations ----
    var vacBatch = db.batch();
    [
        { babyId: 'Baby of Sunita', babyName: 'Baby of Sunita', motherId: 'SA-2026-00004', vaccine: 'BCG', givenOn: yesterdayStr, batch: 'BCG-D1', nextDue: null },
        { babyId: 'Baby of Sunita', babyName: 'Baby of Sunita', motherId: 'SA-2026-00004', vaccine: 'Hepatitis B (birth)', givenOn: yesterdayStr, batch: 'HEPB-D1', nextDue: null },
        { babyId: 'Baby of Sunita', babyName: 'Baby of Sunita', motherId: 'SA-2026-00004', vaccine: 'OPV-0', givenOn: yesterdayStr, batch: 'OPV-D0', nextDue: followUpStr }
    ].forEach(function (v, i) {
        vacBatch.set(db.collection('vaccinations').doc('vac-demo-' + (i + 1)), Object.assign({}, v, {
            givenBy: 'Nurse Demo',
            branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
    });
    await vacBatch.commit();
    logToConsole('Vaccines: 3 newborn doses', 'success');

    // ---- Partograph ----
    await db.collection('partographs').doc('parto-demo-001').set({
        patientId: 'SA-2026-00018',
        patientName: 'Kavya Menon',
        parity: 'G2P1',
        labourStart: todayStr + 'T08:00',
        status: 'active',
        createdBy: 'Dr. Meena Iyer',
        branchId: 'main',
        observations: [
            { time: todayStr + 'T08:00', dilation: 3, effacement: '40% / 2.5 cm', descent: '-2', liquor: 'Clear', fhr: 140, contractions: 2, pulse: 88, bp: '118/76', temperature: 98.4, urineOutput: '100 ml', ivFluids: 'RL 80 ml/hr', oxytocin: '', medication: '', notes: 'Labour started', recordedBy: 'Nurse' },
            { time: todayStr + 'T10:00', dilation: 5, effacement: '60% / 1.5 cm', descent: '-1', liquor: 'Clear', fhr: 138, contractions: 3, pulse: 90, bp: '120/78', temperature: 98.6, urineOutput: 'voided', ivFluids: 'RL 80 ml/hr', oxytocin: '', medication: '', notes: 'Progressing', recordedBy: 'Nurse' },
            { time: todayStr + 'T12:00', dilation: 7, effacement: '80% / 1 cm', descent: '0', liquor: 'Clear', fhr: 142, contractions: 4, pulse: 92, bp: '122/80', temperature: 98.8, urineOutput: '120 ml', ivFluids: 'RL 100 ml/hr', oxytocin: '4 mu/min', medication: 'Inj. Oxytocin infusion started', notes: 'Augmentation started', recordedBy: 'Dr. Meena Iyer' }
        ],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('Partograph: active labour chart for Kavya', 'success');

    // ---- Discharge log ----
    await db.collection('dischargeLogs').add({
        patientId: 'SA-2026-00001',
        patientName: 'Rajesh Kumar',
        patientDocId: 'patient-001',
        diagnosis: 'Stable angina — discharged on meds',
        course: 'Observed overnight, pain free.',
        meds: 'Amlodipine, Atorvastatin',
        advice: 'Follow cardiology OPD',
        followUp: tomorrowStr,
        incompleteCount: 0,
        branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('Discharge: sample discharge log', 'success');

    // ---- OP Queue tokens ----
    var tokenBatch = db.batch();
    [
        { tokenNo: 1, patientName: 'Sowmya Reddy', patientId: 'SA-2026-00016', doctorId: 'doctor-005', doctorName: 'Dr. Meena Iyer', status: 'serving' },
        { tokenNo: 2, patientName: 'Nandini Rao', patientId: 'SA-2026-00017', doctorId: 'doctor-002', doctorName: 'Dr. Priya Sharma', status: 'waiting' },
        { tokenNo: 3, patientName: 'Kavya Menon', patientId: 'SA-2026-00018', doctorId: 'doctor-005', doctorName: 'Dr. Meena Iyer', status: 'waiting' },
        { tokenNo: 4, patientName: 'Deepa Krishnan', patientId: 'SA-2026-00009', doctorId: 'doctor-005', doctorName: 'Dr. Meena Iyer', status: 'waiting' },
        { tokenNo: 5, patientName: 'Priya Singh', patientId: 'SA-2026-00002', doctorId: 'doctor-002', doctorName: 'Dr. Priya Sharma', status: 'done' }
    ].forEach(function (t) {
        tokenBatch.set(db.collection('opTokens').doc(), Object.assign({}, t, {
            date: todayStr,
            branchId: 'main',
            issuedAtText: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
    });
    await tokenBatch.commit();
    logToConsole('OP Queue: 5 tokens (serving / waiting / done)', 'success');

    // ---- Insurance claims ----
    var claimBatch = db.batch();
    [
        { claimNo: 'CLM-DEMO01', patientId: 'SA-2026-00018', patientName: 'Kavya Menon', insurer: 'Star Health', policyId: 'SH-998877', claimedAmount: 65000, approvedAmount: 58000, status: 'preauth_approved', packageName: 'LSCS Package', billNo: '' },
        { claimNo: 'CLM-DEMO02', patientId: 'SA-2026-00004', patientName: 'Sunita Devi', insurer: 'Medi Assist / HDFC Ergo', policyId: 'HE-445566', claimedAmount: 35000, approvedAmount: 35000, status: 'settled', packageName: 'Normal Delivery Package', billNo: '' },
        { claimNo: 'CLM-DEMO03', patientId: 'SA-2026-00017', patientName: 'Nandini Rao', insurer: 'Aarogyasri', policyId: 'AAR-7788', claimedAmount: 12000, approvedAmount: 0, status: 'preauth_pending', packageName: 'ANC Care Package', billNo: '' }
    ].forEach(function (c) {
        claimBatch.set(db.collection('insuranceClaims').doc(c.claimNo), Object.assign({}, c, {
            branchId: 'main',
            notes: 'Demo claim',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
    });
    await claimBatch.commit();
    logToConsole('Insurance: 3 claims (pending / approved / settled)', 'success');

    // ---- Quality / NABH ----
    await db.collection('incidents').doc('inc-demo-001').set({
        date: yesterdayStr, type: 'Near miss', summary: 'Wrong bed assigned momentarily — corrected before transfer',
        severity: 'low', patientId: 'SA-2026-00003', status: 'closed', reportedBy: 'Lakshmi Devi',
        branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('incidents').doc('inc-demo-002').set({
        date: todayStr, type: 'Delay', summary: 'OT start delayed 20 min — waiting for blood report',
        severity: 'medium', patientId: 'SA-2026-00018', status: 'open', reportedBy: 'Dr. Meena Iyer',
        branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('consentRecords').doc('consent-demo-001').set({
        date: todayStr, patientId: 'SA-2026-00018', patientName: 'Kavya Menon',
        consentType: 'LSCS', witness: 'Husband — Menon', notes: 'High-risk explained',
        recordedBy: 'Dr. Meena Iyer', branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('consentRecords').doc('consent-demo-002').set({
        date: yesterdayStr, patientId: 'SA-2026-00004', patientName: 'Sunita Devi',
        consentType: 'Delivery', witness: 'Sister', notes: '',
        recordedBy: 'Nurse Demo', branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    var auditItems = {};
    for (var i = 0; i < 10; i++) auditItems[i] = i < 8;
    await db.collection('qualityAudits').doc(todayStr).set({
        date: todayStr, items: auditItems, completedCount: 8, total: 10,
        savedBy: 'Admin Samuel', branchId: 'main',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('Quality: incidents, consents, today audit checklist', 'success');

    // ---- Tele-consult ----
    var teleSlug = 'jyothsna-demo-' + Date.now().toString(36);
    await db.collection('teleconsults').doc('tele-demo-001').set({
        patientId: 'SA-2026-00016',
        patientName: 'Sowmya Reddy',
        date: todayStr,
        time: '16:30',
        doctorId: 'doctor-005',
        doctorName: 'Dr. Meena Iyer',
        reason: 'ANC follow-up (tele)',
        roomSlug: teleSlug,
        roomUrl: 'https://meet.jit.si/' + teleSlug,
        status: 'scheduled',
        branchId: 'main',
        createdBy: 'admin@example.local',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('Tele-consult: 1 scheduled Jitsi visit', 'success');

    // ---- USG / imaging reports ----
    await db.collection('reports').doc('usg-demo-001').set({
        patientId: 'SA-2026-00017',
        patientName: 'Nandini Rao',
        type: 'imaging',
        testName: 'USG - Obstetric dating / growth',
        status: 'Completed',
        reportText: 'OBSTETRIC ULTRASOUND — Demo report\nSingle live intrauterine gestation.\nFHR present. Placenta upper segment. Liquor adequate.',
        reportDate: todayStr,
        completedBy: 'Lab Tech Demo',
        billingStatus: 'unbilled',
        totalAmount: 1200,
        branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('reports').doc('usg-demo-002').set({
        patientId: 'SA-2026-00018',
        patientName: 'Kavya Menon',
        type: 'imaging',
        testName: 'USG - Anomaly scan',
        status: 'Completed',
        reportText: 'ANOMALY SCAN — Demo\nNo major structural anomaly detected on today\'s scan.',
        reportDate: yesterdayStr,
        completedBy: 'Lab Tech Demo',
        billingStatus: 'billed',
        totalAmount: 2500,
        branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('reports').doc('lab-demo-001').set({
        patientId: 'SA-2026-00018',
        patientName: 'Kavya Menon',
        type: 'lab',
        testName: 'CBC + Blood group',
        status: 'Ready',
        reportDate: todayStr,
        billingStatus: 'unbilled',
        totalAmount: 450,
        branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('Imaging/Lab: USG templates + unbilled report for billing desk', 'success');

    // ---- Pharmacy inventory alerts (low stock / expiry) ----
    await db.collection('pharmacy').doc('med-012').set({ stock: 3, reorderLevel: 10, expiryDate: soonStr }, { merge: true });
    await db.collection('pharmacy').doc('med-006').set({ stock: 8, reorderLevel: 20, expiryDate: soonStr }, { merge: true });
    await db.collection('pharmacy').doc('med-019').set({ stock: 0, reorderLevel: 5, expiryDate: expiredStr }, { merge: true });
    logToConsole('Inventory alerts: low / out / expiring sample meds', 'success');

    // ---- Dispensing history sample ----
    await db.collection('dispensingHistory').doc('disp-demo-001').set({
        dispensingId: 'disp-demo-001',
        patientId: 'SA-2026-00016',
        patientName: 'Sowmya Reddy',
        medicineName: 'Folic Acid 5mg',
        dosage: '1-0-0',
        days: 30,
        quantity: 30,
        unitPrice: 5,
        totalAmount: 150,
        prescribedBy: 'Dr. Meena Iyer',
        dispensedBy: 'pharmacy@example.local',
        paymentMethod: 'Cash',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('Pharmacy history: 1 dispensing record', 'success');

    // ---- Certificates sample (append-only; status issued) ----
    try {
        await db.collection('certificates').doc('cert-demo-001').set({
            certificateType: 'fitness',
            certificateNo: 'JYO/FC/2026/00001',
            patientId: 'SA-2026-00009',
            patientName: 'Deepa Krishnan',
            status: 'issued',
            issuedDate: todayStr,
            recordedBy: 'admin@example.local',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        logToConsole('Certificates: 1 fitness certificate', 'success');
    } catch (certErr) {
        logToConsole('Certificates seed skipped (rules): ' + certErr.message, 'warn');
    }

    // ---- Hospital settings / branches / integrations switches visible ----
    await db.collection('hospitalSettings').doc('main').set({
        hospitalName: 'Jyothsna Maternity Hospital',
        name: 'Jyothsna Maternity Hospital',
        address: '123 MG Road, Hyderabad, Telangana 500001',
        phone: '040-12345678',
        email: 'info@jyothsna.hospital',
        gstin: '36AABCC1234D1Z5',
        registrationNo: 'HYD-MAT-2024-001',
        shiftStartTime: '09:00',
        branches: [
            { id: 'main', name: 'Jyothsna Main Campus' },
            { id: 'annexe', name: 'Jyothsna Annexe (Demo)' }
        ],
        integrations: {
            aiSensy: { enabled: false, mode: 'campaign' },
            msg91: { enabled: false },
            email: { enabled: false },
            razorpay: { enabled: false },
            abdm: { enabled: false },
            orthanc: { enabled: false }
        }
    }, { merge: true });
    logToConsole('Settings: hospital profile + 2 branches + integration switches', 'success');

    logToConsole('All module sections filled for demo.', 'success');
}

async function resetFreshDemo() {
    var ok = confirm('This CLEARS demo data and loads a fresh demo:\n• 500 OLD patients\n• 500 pharmacy medicines\n• All other sections present with MINIMAL sample data\n\nStaff accounts & bed definitions are rebuilt. Continue?');
    if (!ok) return;
    setButtonsDisabled(true);
    try {
        logToConsole('Fresh demo: clearing old data...', 'warn');
        await ensureSignedIn();
        const collections = [
            'patients','patientIndex','bills','labQueue','imagingQueue','reports','admissions','dispensingHistory',
            'auditLog','stockReceipts','appointments','consultations','prescriptions','otBookings','ancVisits',
            'deliveries','babies','payments','opTokens','insuranceClaims','vaccinations','partographs',
            'dischargeLogs','incidents','consentRecords','qualityAudits','teleconsults','carePackages','serviceCatalog',
            'pharmacy'
        ];
        for (const col of collections) {
            await clearCollectionChunked(col);
        }
        const bedsSnap = await db.collection('beds').get();
        let bi = 0;
        while (bi < bedsSnap.docs.length) {
            const bedBatch = db.batch();
            bedsSnap.docs.slice(bi, bi + 450).forEach(function (bDoc) {
                bedBatch.update(bDoc.ref, {
                    status: 'available', patientId: null, patientDocId: null, patientName: null,
                    billId: null, billDocId: null, admittedAt: null, activeAdmissionId: null
                });
            });
            await bedBatch.commit();
            bi += 450;
        }
        await db.collection('patientCounter').doc('counter').set({ count: 0 });
        const countBatch = db.batch();
        ['opd', 'ipd', 'er', 'icu', 'pharmacy', 'beds', 'OT'].forEach(c => {
            countBatch.set(db.collection('billCounters').doc(c), { count: 0 });
        });
        await countBatch.commit();

        logToConsole('Seeding: settings, staff, beds, then 500 old patients + 500 medicines + minimal modules...', 'info');
        await setupHospitalSettings();
        await setupDepartments();
        await setupStaff();
        await setupBeds();
        await seedBulkVolumeDemo(500);
        await seedDemoPortalPins();
        logToConsole('=== FRESH DEMO READY — 500 old patients + 500 medicines; rest minimal ===', 'success');
        showCredentialsTable();
        showGoDashboardButton();
    } catch (err) {
        logToConsole('Fresh demo failed: ' + err.message, 'error');
        console.error(err);
    } finally {
        setButtonsDisabled(false);
    }
}
window.resetFreshDemo = resetFreshDemo;

async function hashPortalPinBrowser(patientId, pin) {
    var raw = String(patientId || '').trim().toUpperCase() + '|' + String(pin || '').trim();
    if (window.crypto && crypto.subtle) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    // Fallback: store plaintext marker only if SubtleCrypto missing (should not happen on modern browsers)
    return 'plain:' + raw;
}

async function seedDemoPortalPins() {
    var pin = '1234';
    var snap = await db.collection('patients').limit(40).get();
    var batch = db.batch();
    var n = 0;
    for (var i = 0; i < snap.docs.length; i++) {
        var doc = snap.docs[i];
        var pid = doc.data().patientId || doc.id;
        var hash = await hashPortalPinBrowser(pid, pin);
        batch.update(doc.ref, {
            portalPinHash: hash,
            portalPinSetAt: firebase.firestore.FieldValue.serverTimestamp(),
            portalPinSetBy: 'demo_seed'
        });
        n++;
        if (n % 400 === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    if (n % 400 !== 0) await batch.commit();
    logToConsole('Portal PIN 1234 set on ' + n + ' demo patients (portal.html).', 'success');
}
window.seedDemoPortalPins = seedDemoPortalPins;
window.setupFeatureDemoExtras = setupFeatureDemoExtras;

function migrateIPDBillsToRunning() {
    var db = firebase.firestore();
    log('Starting IPD bills migration...', 'info');
    
    // Query both 'billType' and 'type' to robustly support both schemas present in the database
    var p1 = db.collection('bills').where('billType', 'in', ['IPD', 'ICU']).get();
    var p2 = db.collection('bills').where('type', 'in', ['IPD', 'ICU']).get();
    
    Promise.all([p1, p2]).then(function(results) {
        var snap1 = results[0];
        var snap2 = results[1];
        
        var docsMap = {};
        snap1.forEach(function(doc) { docsMap[doc.id] = doc; });
        snap2.forEach(function(doc) { docsMap[doc.id] = doc; });
        
        var docs = Object.values(docsMap);
        log('Found ' + docs.length + ' potential IPD/ICU bills. Processing...', 'info');
        
        var promises = [];
        docs.forEach(function(doc) {
            var bill = doc.data();
            if (bill.isFinalized) {
                log(bill.billId + ' already finalized — skipped', 'info');
                return;
            }
            var daysOfStay = 0;
            if (bill.admissionDate) {
                var adm = new Date(bill.admissionDate);
                adm.setHours(0, 0, 0, 0);
                var migNow = new Date();
                migNow.setHours(0, 0, 0, 0);
                daysOfStay = Math.max(0, Math.floor((migNow - adm) / (1000 * 60 * 60 * 24)) + 1);
            }
            var update = {
                isRunningBill: true,
                isFinalized: false,
                daysOfStay: daysOfStay,
                dailyCharges: bill.dailyCharges || [],
                additionalCharges: bill.additionalCharges || [],
                lastChargeUpdate: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            var p = doc.ref.update(update).then(function() {
                log('Migrated: ' + bill.billId + ' (' + bill.patientName + ')', 'success');
                
                // Also update patient subcollection bill if it exists
                // Use only patientDocId — patientId is a sequential ID (e.g. SA-2026-00003), not a Firestore doc key
                if (bill.patientDocId) {
                    return db.collection('patients').doc(bill.patientDocId).collection('bills').doc(doc.id).update(update)
                        .catch(function(e) {
                            // Subcollection document might not exist, swallow error
                        });
                }
            });
            promises.push(p);
        });
        
        if (promises.length === 0) {
            log('No active IPD/ICU bills found to migrate.', 'info');
            return Promise.resolve();
        }
        return Promise.all(promises);
    })
    .then(function() {
        log('Migration complete! Now refresh billing page to trigger bed charge accumulation.', 'success');
    })
    .catch(function(err) {
        log('Migration error: ' + err.message, 'error');
    });
}

window.migrateIPDBillsToRunning = migrateIPDBillsToRunning;

async function clearCollectionChunked(colName) {
    var total = 0;
    try {
        while (true) {
            var snap = await db.collection(colName).limit(450).get();
            if (snap.empty) break;
            var batch = db.batch();
            snap.forEach(function (doc) { batch.delete(doc.ref); });
            await batch.commit();
            total += snap.size;
            if (snap.size < 450) break;
        }
        logToConsole("Cleared /" + colName + " (" + total + ")", "info");
        return total;
    } catch (err) {
        logToConsole("Failed clearing /" + colName + ": " + err.message, "error");
        throw new Error("Cannot clear /" + colName + " — " + err.message);
    }
}

async function commitInChunks(writes) {
    // writes: [{ ref, data, merge? }]
    for (var i = 0; i < writes.length; i += 450) {
        var batch = db.batch();
        writes.slice(i, i + 450).forEach(function (w) {
            if (w.merge) batch.set(w.ref, w.data, { merge: true });
            else batch.set(w.ref, w.data);
        });
        await batch.commit();
    }
}

function demoPad(n, width) {
    var s = String(n);
    while (s.length < (width || 5)) s = "0" + s;
    return s;
}

function demoIsoDaysAgo(days) {
    var d = new Date(_today);
    d.setDate(d.getDate() - days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function demoIsoDaysAhead(days) {
    return demoIsoDaysAgo(-days);
}

async function seedBulkVolumeDemo(count) {
    count = count || 500;
    var MIN = 6; // minimal rows for every other section
    logToConsole('Seeding: ' + count + ' OLD patients + ' + count + ' medicines; all other sections minimal (~' + MIN + ')...', 'info');

    var firstNames = ['Ananya','Bhavani','Chitra','Divya','Esha','Fatima','Gayatri','Harini','Indu','Jyothi','Kavya','Lakshmi','Meena','Nandini','Padma','Priya','Radha','Sita','Sowmya','Tejaswi','Uma','Vasavi','Asha','Deepa','Geetha','Hema','Isha','Jaya','Keerthi','Lavanya','Madhavi','Neha','Pooja','Rani','Sandhya','Trisha','Usha','Varsha','Yamini','Zara','Rajesh','Suresh','Venkat','Kiran','Ramesh','Arjun','Mohan','Prakash','Sunil','Vikram'];
    var lastNames = ['Reddy','Rao','Sharma','Patel','Nair','Iyer','Krishnan','Menon','Gupta','Singh','Kumar','Das','Pillai','Naidu','Chowdary','Verma','Joshi','Mehta','Babu','Devi'];
    var depts = ['Obstetrics','Gynaecology','Antenatal Care','General','Pediatrics','Cardiology'];
    var doctors = ['Dr. Meena Iyer','Dr. Priya Sharma','Dr. Vamsi Krishna','Dr. Ravi Patel','Dr. Anand Reddy'];
    var doctorIds = ['doctor-005','doctor-002','doctor-001','doctor-003','doctor-004'];
    var procedures = ['Normal Delivery','LSCS','Cesarean Section','D&C','Laparoscopy','Hysterectomy','IUD Insertion','OT Charges','Epidural','ANC Visit'];
    var insurers = ['Star Health','HDFC Ergo','Aarogyasri','Medi Assist','Care Health','Niva Bupa'];
    var medBases = [
        { medicineName: 'Calpol 500mg', genericName: 'Paracetamol 500mg', category: 'Analgesic', unitPrice: 2 },
        { medicineName: 'Augmentin 625mg', genericName: 'Amoxicillin + Clavulanic Acid', category: 'Antibiotic', unitPrice: 15 },
        { medicineName: 'Folic Acid 5mg', genericName: 'Folic Acid 5mg', category: 'Vitamin', unitPrice: 5 },
        { medicineName: 'Iron + Folic Acid', genericName: 'Ferrous Ascorbate + FA', category: 'Supplement', unitPrice: 5 },
        { medicineName: 'Calcium + D3', genericName: 'Calcium + Vitamin D3', category: 'Supplement', unitPrice: 5 },
        { medicineName: 'Oxytocin injection', genericName: 'Oxytocin 10 IU', category: 'Uterotonic', unitPrice: 50 },
        { medicineName: 'Pan-40', genericName: 'Pantoprazole 40mg', category: 'Antacid', unitPrice: 6 },
        { medicineName: 'Azithral 500mg', genericName: 'Azithromycin 500mg', category: 'Antibiotic', unitPrice: 22 },
        { medicineName: 'Dolo 650mg', genericName: 'Paracetamol 650mg', category: 'Analgesic', unitPrice: 3 },
        { medicineName: 'Progesterone 200mg', genericName: 'Micronized Progesterone', category: 'Hormone', unitPrice: 50 },
        { medicineName: 'Methylergometrine inj', genericName: 'Methylergometrine 0.2mg/ml', category: 'Uterotonic', unitPrice: 50 },
        { medicineName: 'Anti-D injection', genericName: 'Anti-D Ig 300 mcg', category: 'Immunoglobulin', unitPrice: 2500 },
        { medicineName: 'Betamethasone inj', genericName: 'Betamethasone 4mg/ml', category: 'Corticosteroid', unitPrice: 80 },
        { medicineName: 'Cetzine 10mg', genericName: 'Cetirizine 10mg', category: 'Antihistamine', unitPrice: 1.8 },
        { medicineName: 'Electral Powder', genericName: 'ORS', category: 'Electrolyte', unitPrice: 10 }
    ];
    var manufacturers = ['GSK','Cipla','Sun Pharma','Alkem','Alembic','Micro Labs','Generic','USV','Sanofi','FDC'];

    // ---- 500 pharmacy medicines ----
    var medWrites = [];
    for (var mi = 1; mi <= count; mi++) {
        var base = medBases[(mi - 1) % medBases.length];
        var name = base.medicineName + (mi <= medBases.length ? '' : (' #' + mi));
        var stock = 20 + (mi % 200);
        var reorder = 10 + (mi % 20);
        var expYear = 2026 + (mi % 3);
        medWrites.push({
            ref: db.collection('pharmacy').doc('med-' + demoPad(mi, 4)),
            data: {
                medicineName: name,
                genericName: base.genericName,
                category: base.category,
                stock: stock,
                unitPrice: base.unitPrice + (mi % 7),
                reorderLevel: reorder,
                expiryDate: expYear + '-' + demoPad((mi % 12) + 1, 2) + '-28',
                manufacturer: manufacturers[mi % manufacturers.length],
                batchNumber: 'B' + demoPad(mi, 5),
                nameLower: name.toLowerCase(),
                branchId: 'main',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }
        });
    }
    if (medWrites[0]) medWrites[0].data.stock = 2;
    if (medWrites[1]) { medWrites[1].data.stock = 0; medWrites[1].data.expiryDate = demoIsoDaysAgo(10); }
    if (medWrites[2]) medWrites[2].data.expiryDate = demoIsoDaysAgo(-20);
    await commitInChunks(medWrites);
    logToConsole('Pharmacy medicines: ' + count, 'success');

    // ---- Service catalog (small) ----
    var catalogServices = [
        { code: 'SVC-ND', name: 'Normal Delivery', price: 25000 },
        { code: 'SVC-LSCS', name: 'LSCS', price: 45000 },
        { code: 'SVC-CS', name: 'Cesarean Section', price: 45000 },
        { code: 'SVC-DC', name: 'D&C', price: 15000 },
        { code: 'SVC-LAP', name: 'Laparoscopy', price: 30000 },
        { code: 'SVC-HYST', name: 'Hysterectomy', price: 40000 },
        { code: 'SVC-IUD', name: 'IUD Insertion', price: 5000 },
        { code: 'SVC-OT', name: 'OT Charges', price: 12000 },
        { code: 'SVC-EPI', name: 'Epidural', price: 8000 },
        { code: 'SVC-ANC', name: 'ANC Visit', price: 500 },
        { code: 'SVC-OPC', name: 'OP Consultation', price: 400 },
        { code: 'SVC-USG', name: 'USG Obstetric', price: 1200 },
        { code: 'SVC-LAB', name: 'Labour Room Charges', price: 5000 },
        { code: 'SVC-NICU', name: 'NICU Day Care', price: 7500 },
        { code: 'SVC-BLOOD', name: 'Blood Transfusion', price: 3500 }
    ];
    await commitInChunks(catalogServices.map(function (s) {
        return { ref: db.collection('serviceCatalog').doc(s.code), data: Object.assign({}, s, { gstPercent: 0, active: true, category: 'Clinical', branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp() }) };
    }));
    logToConsole('Service catalog: ' + catalogServices.length, 'success');

    // ---- 500 patients: 15 CURRENT (today) + 485 OLD discharged ----
    var patientsMeta = [];
    var patientWrites = [];
    var indexWrites = [];
    var CURRENT_N = 15;
    for (var i = 1; i <= count; i++) {
        var fn = firstNames[(i - 1) % firstNames.length];
        var ln = lastNames[Math.floor((i - 1) / firstNames.length) % lastNames.length];
        var pname = fn + ' ' + ln;
        var pid = 'SA-2026-' + demoPad(i, 5);
        var docId = 'patient-' + demoPad(i, 3);
        var phone = String(9000000000 + i);
        var gender = (i % 7 === 0) ? 'Male' : 'Female';
        var age = 22 + (i % 28);
        var dept = depts[i % depts.length];
        var doctor = doctors[i % doctors.length];
        var isCurrent = i <= CURRENT_N;
        var status = 'discharged';
        var isPregnant = false;
        if (isCurrent) {
            if (i <= 4) status = 'admitted';
            else if (i === 5) status = 'emergency';
            else if (i === 6) status = 'icu';
            else if (i <= 10) status = 'opd';
            else if (gender === 'Female') { status = 'opd'; isPregnant = true; }
            else status = 'opd';
        }
        var createdDate = isCurrent ? new Date() : new Date(demoIsoDaysAgo(40 + (i % 300)) + 'T10:00:00');
        var rec = {
            patientId: pid,
            name: pname,
            nameLower: pname.toLowerCase(),
            phone: phone,
            dob: (2000 - (age - 26)) + '-' + demoPad((i % 12) + 1, 2) + '-' + demoPad((i % 27) + 1, 2),
            age: age,
            gender: gender,
            bloodGroup: ['A+','B+','O+','AB+','A-','B-','O-'][i % 7],
            address: (100 + i) + ' Demo Colony Hyderabad',
            department: dept,
            doctor: doctor,
            emergencyContact: String(9100000000 + i),
            status: status,
            registrationDate: isCurrent ? todayStr : demoIsoDaysAgo(40 + (i % 300)),
            branchId: 'main',
            createdAt: firebase.firestore.Timestamp.fromDate(createdDate),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            pastVisits: [
                { date: demoIsoDaysAgo(120 + (i % 40)), type: 'OPD', doctor: doctor, note: 'Routine check' },
                { date: demoIsoDaysAgo(60 + (i % 30)), type: 'ANC', doctor: doctor, note: 'Antenatal review' }
            ]
        };
        if (status === 'discharged') {
            rec.dischargedAt = demoIsoDaysAgo(20 + (i % 100));
            rec.dischargeDate = rec.dischargedAt;
        }
        if (isPregnant) {
            var lmp = maternityIso(8 + (i % 30));
            rec.isPregnant = true;
            rec.lmp = lmp;
            rec.edd = maternityEdd(lmp);
            rec.gravida = 1 + (i % 3);
            rec.para = i % 3;
            rec.abortions = 0;
            rec.highRisk = i === 12;
            rec.highRiskReason = rec.highRisk ? 'Previous complications' : '';
            rec.nextVisitDate = maternityIso(i % 4);
            rec.department = 'Antenatal Care';
        }
        patientWrites.push({ ref: db.collection('patients').doc(docId), data: rec });
        indexWrites.push({
            ref: db.collection('patientIndex').doc(pid),
            data: { patientId: pid, patientDocId: docId, name: pname, phone: phone, nameLower: pname.toLowerCase() }
        });
        patientsMeta.push({ docId: docId, patientId: pid, name: pname, phone: phone, doctor: doctor, doctorId: doctorIds[i % doctorIds.length], status: status, gender: gender, isCurrent: isCurrent });
    }
    await commitInChunks(patientWrites);
    await commitInChunks(indexWrites);
    await db.collection('patientCounter').doc('counter').set({ count: count });
    logToConsole('Patients: ' + count + ' (' + CURRENT_N + ' current/today + ' + (count - CURRENT_N) + ' OLD discharged)', 'success');

    function pick(n) { return patientsMeta[(n - 1) % patientsMeta.length]; }

    var packages = [
        { code: 'PKG-ND', name: 'Normal Delivery Package', price: 35000, inclusions: 'Labour room\nNormal Delivery\n2-day ward stay\nRoutine medicines\nNewborn check', extras: 'NICU, blood, implants', active: true },
        { code: 'PKG-LSCS', name: 'LSCS Package', price: 65000, inclusions: 'OT Charges\nLSCS\nSurgeon & anaesthetist\n3-day stay', extras: 'NICU, blood', active: true },
        { code: 'PKG-ANC', name: 'ANC Care Package', price: 12000, inclusions: 'ANC Visit\nBasic labs\nUSG Obstetric', extras: 'High-risk tests', active: true }
    ];
    await commitInChunks(packages.map(function (p) {
        return { ref: db.collection('carePackages').doc(p.code), data: Object.assign({}, p, { branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp() }) };
    }));
    logToConsole('Packages: ' + packages.length, 'success');

    var writes = [];
    for (var n = 1; n <= MIN; n++) {
        var p = pick(n);
        var day = demoIsoDaysAgo(n);
        var proc = procedures[n % procedures.length];
        var amt = 400 + n * 50;

        writes.push({ ref: db.collection('consultations').doc('cons-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, patientDocId: p.docId,
            doctorId: p.doctorId, doctorName: p.doctor, date: day, status: 'completed',
            chiefComplaint: 'Follow-up', diagnosis: 'Clinical review', branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('prescriptions').doc('rx-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, doctorName: p.doctor, date: day,
            medicines: [{ name: 'Folic Acid 5mg', dosage: '1-0-0', days: 30, qty: 30 }],
            status: 'dispensed', branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('bills').doc('bill-ph-min-' + demoPad(n, 2)), data: {
            billId: 'SA-PH-MIN-' + demoPad(n, 2), billNo: 'SA-PH-MIN-' + demoPad(n, 2),
            billType: 'Pharmacy', type: 'Pharmacy', patientId: p.patientId, patientDocId: p.docId,
            patientName: p.name, patientPhone: p.phone, billDate: day, paymentStatus: 'Paid', paymentMode: 'UPI',
            items: [{ description: 'Pharmacy item', qty: 1, rate: amt, amount: amt }],
            subtotal: amt, discountAmount: 0, gstAmount: 0, grandTotal: amt, amountPaid: amt,
            doctorName: p.doctor, branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('otBookings').doc('ot-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, patientDocId: p.docId,
            procedureType: proc, surgeonName: p.doctor, surgeonId: p.doctorId,
            otRoomName: 'OT-' + ((n % 3) + 1), scheduledDate: n <= 3 ? todayStr : tomorrowStr,
            scheduledTime: String(8 + n).padStart(2, '0') + ':00',
            status: n === 1 ? 'in_surgery' : 'scheduled', branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('ancVisits').doc('anc-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, visitDate: day, gestationalWeeks: 12 + n * 4,
            weight: 58 + n, bpSystolic: 110 + n, bpDiastolic: 70, fetalHeartRate: 140, hb: 11,
            urineAlbumin: 'Nil', complaints: 'Nil', advice: 'Continue supplements', recordedBy: p.doctor,
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('vaccinations').doc('vac-min-' + demoPad(n, 2)), data: {
            babyId: 'Baby of ' + p.name, babyName: 'Baby of ' + p.name, motherId: p.patientId,
            vaccine: ['BCG','Hepatitis B (birth)','OPV-0'][n % 3], givenOn: day, batch: 'B-MIN-' + n,
            givenBy: 'Nurse Demo', branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('insuranceClaims').doc('CLM-MIN-' + demoPad(n, 2)), data: {
            claimNo: 'CLM-MIN-' + demoPad(n, 2), patientId: p.patientId, patientName: p.name,
            insurer: insurers[n % insurers.length], policyId: 'POL-MIN-' + n,
            claimedAmount: 35000, approvedAmount: n % 2 ? 30000 : 0,
            status: ['preauth_pending','preauth_approved','settled'][n % 3], packageName: proc,
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('teleconsults').doc('tele-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, date: todayStr, time: String(14 + n).padStart(2, '0') + ':00',
            doctorId: p.doctorId, doctorName: p.doctor, reason: 'ANC follow-up',
            roomUrl: 'https://meet.jit.si/jyothsna-min-' + n, status: 'scheduled',
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('dischargeLogs').doc('dc-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, patientDocId: p.docId,
            diagnosis: proc, course: 'Uneventful', meds: 'Iron, Calcium', advice: 'Follow up OPD',
            followUp: tomorrowStr, incompleteCount: 0, branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('consentRecords').doc('consent-min-' + demoPad(n, 2)), data: {
            date: day, patientId: p.patientId, patientName: p.name,
            consentType: ['Surgery','LSCS','Delivery'][n % 3], witness: 'Attendant', notes: 'Demo',
            recordedBy: p.doctor, branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('incidents').doc('inc-min-' + demoPad(n, 2)), data: {
            date: day, type: ['Near miss','Delay','Fall'][n % 3], summary: 'Demo incident #' + n,
            severity: ['low','medium','high'][n % 3], patientId: p.patientId,
            status: n === 1 ? 'open' : 'closed', reportedBy: 'Nurse Demo', branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('payments').doc('pay-min-' + demoPad(n, 2)), data: {
            billId: 'SA-PH-MIN-' + demoPad(n, 2), patientId: p.patientId, patientName: p.name,
            amount: amt, mode: 'UPI', date: day, branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('dispensingHistory').doc('disp-min-' + demoPad(n, 2)), data: {
            dispensingId: 'disp-min-' + demoPad(n, 2), patientId: p.patientId, patientName: p.name,
            medicineName: 'Folic Acid 5mg', qty: 10 + n, date: day, dispensedBy: 'Pharmacist Demo',
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('auditLog').doc('audit-min-' + demoPad(n, 2)), data: {
            action: 'demo.seed', details: 'Minimal demo row ' + n, user: 'admin@example.local',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(), branchId: 'main'
        }});
        writes.push({ ref: db.collection('opTokens').doc('tok-min-' + demoPad(n, 2)), data: {
            date: todayStr, tokenNo: n, patientName: p.name, patientId: p.patientId,
            doctorId: p.doctorId, doctorName: p.doctor,
            status: n === 1 ? 'serving' : (n <= 4 ? 'waiting' : 'done'),
            issuedAtText: '09:' + demoPad(n * 5, 2), branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('appointments').doc('appt-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, doctorId: p.doctorId, doctorName: p.doctor,
            date: n <= 3 ? todayStr : tomorrowStr, time: String(9 + n).padStart(2, '0') + ':00',
            status: 'Scheduled', visitType: 'OPD', branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        // Extra future appointments
        writes.push({ ref: db.collection('appointments').doc('appt-future-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, doctorId: p.doctorId, doctorName: p.doctor,
            date: demoIsoDaysAgo(-(3 + n)), time: String(10 + n).padStart(2, '0') + ':30',
            status: 'Scheduled', visitType: 'OPD', reason: 'Follow-up', branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('labQueue').doc('lab-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, testName: 'CBC', status: 'Pending',
            orderedDate: todayStr, orderedBy: p.doctor, showInReception: true, branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('imagingQueue').doc('img-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, testName: n === 1 ? '2D Echo' : 'Obstetric USG',
            status: 'Pending', orderedDate: todayStr, orderedBy: p.doctor, showInReception: true,
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('reports').doc('rep-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, type: n % 2 ? 'lab' : 'imaging',
            testName: n % 2 ? 'CBC' : (n === 2 ? '2D Echo' : 'USG Obstetric'),
            status: n === 1 ? 'Ready' : 'Completed', reportDate: yesterdayStr,
            reportText: 'Demo report #' + n, visitDoctor: p.doctor, notifyDoctor: n === 1,
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('deliveries').doc('del-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, deliveryDate: demoIsoDaysAgo(n + 2),
            deliveryType: n % 2 ? 'Normal' : 'LSCS', weeks: 38, conductedBy: p.doctor,
            place: 'Jyothsna Maternity Hospital', motherCondition: 'Stable', branchId: 'main',
            birthRegistration: { parentsIdProof: true, addressProof: true, hospitalCertificate: true, readyToFile: false },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('babies').doc('baby-min-' + demoPad(n, 2)), data: {
            deliveryId: 'del-min-' + demoPad(n, 2), motherId: p.patientId, motherName: p.name,
            name: 'Baby of ' + p.name, sex: n % 2 ? 'Female' : 'Male', weight: 2.8, apgar1: 8, apgar5: 9,
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        // Labour day must be the SAME day as the observations. Dating
        // labourStart n days before the readings produced charts spanning
        // 72 hours, which squashed every point against the right edge.
        var partoDay = (n <= 2) ? todayStr : demoIsoDaysAgo(n);
        writes.push({ ref: db.collection('partographs').doc('parto-min-' + demoPad(n, 2)), data: {
            patientId: p.patientId, patientName: p.name, parity: 'G2P1',
            labourStart: partoDay + 'T06:00',
            status: n <= 2 ? 'active' : 'completed',
            observations: [
                { time: partoDay + 'T06:00', dilation: 2, effacement: '30%', descent: '-3', liquor: 'Clear', fhr: 142, contractions: 2, pulse: 84, bp: '116/74', temperature: 98.2, urineOutput: 'voided', ivFluids: 'RL 100 ml/hr', medication: '', notes: 'Admitted in early labour' },
                { time: partoDay + 'T08:00', dilation: 4, effacement: '50%', descent: '-2', liquor: 'Clear', fhr: 140, contractions: 3, pulse: 88, bp: '118/76', temperature: 98.4, urineOutput: '120 ml', ivFluids: 'RL 100 ml/hr', oxytocin: '2 mu/min', medication: '', notes: 'Active phase' },
                { time: partoDay + 'T10:00', dilation: 6, effacement: '70%', descent: '0', liquor: 'Clear', fhr: 138, contractions: 4, pulse: 90, bp: '120/78', temperature: 98.6, urineOutput: '100 ml', ivFluids: 'RL 80 ml/hr', oxytocin: '4 mu/min', medication: '', notes: 'Progress' },
                { time: partoDay + 'T12:00', dilation: 8, effacement: '90%', descent: '+1', liquor: 'Clear', fhr: 144, contractions: 5, pulse: 96, bp: '124/80', temperature: 98.8, urineOutput: '80 ml', ivFluids: 'RL 80 ml/hr', oxytocin: '6 mu/min', medication: '', notes: 'Good progress' }
            ],
            branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
    }

    // Linked IPD / ER / ICU running bills (proper structure)
    for (var m = 1; m <= 4; m++) {
        var mp = pick(m);
        var bedNo = 'A-10' + m;
        var admDate = demoIsoDaysAgo(m + 1);
        writes.push({ ref: db.collection('admissions').doc('ADM-MIN-' + demoPad(m, 2)), data: {
            id: 'ADM-MIN-' + demoPad(m, 2), admissionId: 'ADM-MIN-' + demoPad(m, 2),
            patientId: mp.patientId, patientName: mp.name, patientDocId: mp.docId,
            admissionDate: admDate, ward: 'General Ward', bedNumber: bedNo, status: 'admitted',
            doctorName: mp.doctor, department: 'Obstetrics', branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
        writes.push({ ref: db.collection('bills').doc('bill-ipd-min-' + demoPad(m, 2)), data: {
            billId: 'SA-IPD-MIN-' + demoPad(m, 2), billNo: 'SA-IPD-MIN-' + demoPad(m, 2),
            billType: 'IPD', type: 'IPD',
            patientId: mp.patientId, patientDocId: mp.docId, patientName: mp.name, patientPhone: mp.phone,
            billDate: admDate, admissionDate: admDate, bedNumber: bedNo, ward: 'General Ward',
            paymentStatus: 'Partial', amountPaid: 5000, isRunningBill: true, isFinalized: false,
            activeBillLabel: 'IPD running · Bed ' + bedNo,
            visitDoctor: mp.doctor, doctorName: mp.doctor, visitDepartment: 'Obstetrics',
            items: [
                { description: 'Room charges (day care)', qty: m + 1, rate: 1000, amount: 1000 * (m + 1) },
                { description: 'Nursing charges', qty: 1, rate: 500, amount: 500 },
                { description: 'Pharmacy / medicines', qty: 1, rate: 1200, amount: 1200 }
            ],
            additionalCharges: [{ description: 'USG Obstetric', amount: 1200 }],
            grandTotal: 15000 + m * 1000, subtotal: 15000 + m * 1000, branchId: 'main',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
    }
    // ER + ICU sample running bills
    var erP = pick(5);
    writes.push({ ref: db.collection('bills').doc('bill-er-min-01'), data: {
        billId: 'SA-ER-MIN-01', billType: 'ER', type: 'ER', patientId: erP.patientId, patientDocId: erP.docId,
        patientName: erP.name, billDate: todayStr, admissionDate: todayStr, paymentStatus: 'Unpaid',
        isRunningBill: true, isFinalized: false, activeBillLabel: 'ER active',
        visitDoctor: erP.doctor, grandTotal: 3500, amountPaid: 0, bedNumber: 'ER-01',
        items: [{ description: 'Emergency assessment', qty: 1, rate: 1500, amount: 1500 }],
        branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }});
    var icuP = pick(6);
    writes.push({ ref: db.collection('bills').doc('bill-icu-min-01'), data: {
        billId: 'SA-ICU-MIN-01', billType: 'ICU', type: 'ICU', patientId: icuP.patientId, patientDocId: icuP.docId,
        patientName: icuP.name, billDate: yesterdayStr, admissionDate: yesterdayStr, paymentStatus: 'Partial',
        isRunningBill: true, isFinalized: false, activeBillLabel: 'ICU running · ICU-01',
        visitDoctor: icuP.doctor, grandTotal: 18000, amountPaid: 8000, bedNumber: 'ICU-01',
        items: [{ description: 'ICU day care', qty: 1, rate: 8000, amount: 8000 }],
        branchId: 'main', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }});

    for (var o = 1; o <= 5; o++) {
        var op = pick(10 + o);
        writes.push({ ref: db.collection('bills').doc('bill-opd-min-' + demoPad(o, 2)), data: {
            billId: 'SA-OPD-MIN-' + demoPad(o, 2), billType: 'OPD', type: 'OPD',
            patientId: op.patientId, patientDocId: op.docId, patientName: op.name,
            billDate: todayStr, paymentStatus: 'Paid', paymentMode: 'UPI',
            grandTotal: 400, subtotal: 400, amountPaid: 400, branchId: 'main',
            visitDoctor: op.doctor, doctorName: op.doctor,
            items: [{ description: 'OP Consultation', qty: 1, rate: 400, amount: 400 }],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }});
    }
    // Cancelled + refunded demo bills
    var cp = pick(8);
    writes.push({ ref: db.collection('bills').doc('bill-cancel-min-01'), data: {
        billId: 'SA-OPD-CANCEL-01', billType: 'OPD', type: 'OPD', patientId: cp.patientId, patientDocId: cp.docId,
        patientName: cp.name, billDate: yesterdayStr, paymentStatus: 'Cancelled', status: 'cancelled',
        grandTotal: 400, amountPaid: 0, visit: [{ description: 'OP Consultation (cancelled)', qty: 1, rate: 400, amount: 400 }],
        cancelReason: 'Patient left without consultation', branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }});
    var rp = pick(9);
    writes.push({ ref: db.collection('bills').doc('bill-refund-min-01'), data: {
        billId: 'SA-PH-REFUND-01', billType: 'Pharmacy', type: 'Pharmacy', patientId: rp.patientId, patientDocId: rp.docId,
        patientName: rp.name, billDate: yesterdayStr, paymentStatus: 'Paid', status: 'refunded',
        grandTotal: 800, amountPaid: 800, refundedAmount: 800,
        items: [{ description: 'Medicine return', qty: 1, rate: 800, amount: 800 }],
        refundReason: 'Medicine returned unused', branchId: 'main',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }});

    await commitInChunks(writes);
    await db.collection('qualityAudits').doc(todayStr).set({
        date: todayStr,
        items: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 7: true, 8: true, 9: false },
        completedCount: 8, total: 10, savedBy: 'Admin', branchId: 'main',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logToConsole('All other modules seeded with minimal samples (~' + MIN + ' each; IPD 4 / OPD 5)', 'success');

    var bedsSnap = await db.collection('beds').limit(12).get();
    var bedBatch = db.batch();
    var bi = 0;
    bedsSnap.forEach(function (bDoc) {
        if (bi >= 4) return;
        var bp = pick(bi + 1);
        bedBatch.update(bDoc.ref, {
            status: 'occupied', patientId: bp.patientId, patientDocId: bp.docId,
            patientName: bp.name, admittedAt: demoIsoDaysAgo(bi + 1)
        });
        bi++;
    });
    await bedBatch.commit();
    logToConsole('Bed board: 4 occupied sample beds', 'success');

    await seedRemainingSections();
    logToConsole('=== DEMO READY: 500 old patients + 500 medicines; every section populated ===', 'success');
}

// ==========================================================
// SECTIONS THE MAIN SEEDER LEFT EMPTY
// Without these the pharmacy GRN timeline, the owner's goods-received
// panel and the lab's custom test catalogue all render "no data", which
// makes those screens look broken during a demo.
// ==========================================================
async function seedRemainingSections() {
    var medsSnap = await db.collection('pharmacy').limit(12).get();
    var meds = medsSnap.docs.map(function (d) { return { id: d.id, data: d.data() }; });

    if (meds.length) {
        var suppliers = ['MediSupply Agencies', 'Sri Sai Distributors', 'Apex Pharma Traders', 'Godavari Medicals'];
        var grnBatch = db.batch();
        meds.slice(0, 10).forEach(function (m, i) {
            var qty = 50 + (i * 25);
            var price = Math.max(1, Math.round((m.data.price || m.data.unitPrice || 20) * 0.7));
            var daysAgo = i + 1;
            grnBatch.set(db.collection('stockReceipts').doc('grn-min-' + demoPad(i + 1, 2)), {
                medicineId: m.id,
                medicineName: m.data.medicineName || ('Medicine ' + (i + 1)),
                quantityAdded: qty,
                supplierName: suppliers[i % suppliers.length],
                purchasePrice: price,
                amount: qty * price,
                batchNumber: 'B' + (2600 + i),
                expiryDate: m.data.expiryDate || '',
                grnNo: 'GRN-2026-' + demoPad(i + 1, 4),
                paymentDueDate: demoIsoDaysAhead(15 - i),
                paymentStatus: i % 3 === 0 ? 'paid' : 'unpaid',
                notes: 'Opening stock purchase',
                addedBy: 'admin@example.local',
                branchId: 'main',
                addedAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - daysAgo * 86400000))
            });
        });
        await grnBatch.commit();
        logToConsole('Pharmacy: 10 goods-received notes (GRN timeline + owner panel)', 'success');
    }

    var catBatch = db.batch();
    var catalogue = [
        { id: 'thyroid_profile', name: 'Thyroid Profile (T3 T4 TSH)', parameters: [
            { name: 'T3', unit: 'ng/dL', min: 80, max: 200 },
            { name: 'T4', unit: 'ug/dL', min: 5.1, max: 14.1 },
            { name: 'TSH', unit: 'uIU/mL', min: 0.27, max: 4.2 }
        ]},
        { id: 'iron_studies', name: 'Iron Studies', parameters: [
            { name: 'Serum Iron', unit: 'ug/dL', min: 50, max: 170 },
            { name: 'TIBC', unit: 'ug/dL', min: 250, max: 450 },
            { name: 'Ferritin', unit: 'ng/mL', min: 12, max: 150 }
        ]},
        { id: 'ogtt_pregnancy', name: 'OGTT (Pregnancy 75g)', parameters: [
            { name: 'Fasting', unit: 'mg/dL', min: 70, max: 92 },
            { name: '1 hour', unit: 'mg/dL', min: 70, max: 180 },
            { name: '2 hour', unit: 'mg/dL', min: 70, max: 153 }
        ]}
    ];
    catalogue.forEach(function (t) {
        catBatch.set(db.collection('labTestCatalog').doc(t.id), {
            name: t.name, parameters: t.parameters, active: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });
    await catBatch.commit();
    logToConsole('Lab: 3 custom test templates in the catalogue', 'success');
}
window.seedRemainingSections = seedRemainingSections;
window.seedBulkVolumeDemo = seedBulkVolumeDemo;
window.clearCollectionChunked = clearCollectionChunked;
