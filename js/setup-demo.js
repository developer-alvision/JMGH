/*
 * RICH CLINICAL DEMO SEED
 *
 * Ten patients with two to three months of history, built so every screen
 * in the app has something real to show: antenatal journeys with LMP and
 * EDD, vitals on every consultation, labs and imaging sitting at each
 * status, prescriptions waiting at the pharmacy counter, and one patient
 * in each care level — OPD, IPD, ICU, ER and theatre.
 *
 * Loaded by setup.html alongside setup.js and reuses its helpers
 * (ensureSignedIn, demoPad, logToConsole, commitInChunks).
 */

function rdDate(daysAgo) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function rdStamp(daysAgo, hour) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour == null ? 10 : hour, 0, 0, 0);
    return firebase.firestore.Timestamp.fromDate(d);
}

function rdEdd(lmpStr) {
    var d = new Date(lmpStr + 'T00:00:00');
    d.setDate(d.getDate() + 280);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function rdPad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = '0' + s;
    return s;
}

function rdLog(msg, type) {
    if (typeof logToConsole === 'function') logToConsole(msg, type || 'info');
    else console.log(msg);
}

// The payments ledger pins the actor: security rules reject any row whose
// recordedBy is not the signed-in user, so seeded receipts must be stamped
// with whoever is running the seeder rather than a made-up cashier.
function rdActor() {
    var u = firebase.auth().currentUser;
    return (u && (u.email || u.uid)) || 'admin@example.local';
}

var RD_DOCS = [
    { id: 'doctor-005', name: 'Dr. Meena Iyer', dept: 'Obstetrics' },
    { id: 'doctor-002', name: 'Dr. Priya Sharma', dept: 'Gynaecology' },
    { id: 'doctor-001', name: 'Dr. Vamsi Krishna', dept: 'General' }
];

var RD_PATIENTS = [
    { n: 1, name: 'Ananya Reddy', age: 27, blood: 'O+', phone: '9800000001', doc: 0, dept: 'Antenatal Care', status: 'opd',
      preg: { weeks: 10, gravida: 2, para: 1, abortions: 0, highRisk: false, reason: '' }, story: 'anc_early' },
    { n: 2, name: 'Bhavani Sharma', age: 31, blood: 'A+', phone: '9800000002', doc: 0, dept: 'Antenatal Care', status: 'opd',
      preg: { weeks: 24, gravida: 3, para: 1, abortions: 1, highRisk: true, reason: 'Previous pre-eclampsia' }, story: 'anc_highrisk' },
    { n: 3, name: 'Chaitra Rao', age: 29, blood: 'B+', phone: '9800000003', doc: 0, dept: 'Antenatal Care', status: 'opd',
      preg: { weeks: 37, gravida: 2, para: 0, abortions: 0, highRisk: false, reason: '' }, story: 'anc_term' },
    { n: 4, name: 'Divya Menon', age: 26, blood: 'O+', phone: '9800000004', doc: 0, dept: 'Obstetrics', status: 'admitted',
      preg: { weeks: 39, gravida: 2, para: 1, abortions: 0, highRisk: false, reason: '' }, story: 'in_labour' },
    { n: 5, name: 'Esha Fatima', age: 33, blood: 'AB+', phone: '9800000005', doc: 0, dept: 'Obstetrics', status: 'admitted',
      preg: { weeks: 40, gravida: 3, para: 2, abortions: 0, highRisk: true, reason: 'Two previous LSCS' }, story: 'post_lscs' },
    { n: 6, name: 'Gayatri Nair', age: 30, blood: 'B-', phone: '9800000006', doc: 1, dept: 'Obstetrics', status: 'icu',
      preg: { weeks: 34, gravida: 1, para: 0, abortions: 0, highRisk: true, reason: 'Severe pre-eclampsia' }, story: 'icu' },
    { n: 7, name: 'Harika Devi', age: 24, blood: 'A-', phone: '9800000007', doc: 1, dept: 'Emergency', status: 'emergency',
      preg: { weeks: 8, gravida: 1, para: 0, abortions: 0, highRisk: true, reason: 'First trimester bleeding' }, story: 'er' },
    { n: 8, name: 'Indu Prasad', age: 36, blood: 'O-', phone: '9800000008', doc: 1, dept: 'Gynaecology', status: 'opd',
      preg: null, story: 'gynae' },
    { n: 9, name: 'Jyothi Kumari', age: 28, blood: 'B+', phone: '9800000009', doc: 0, dept: 'Obstetrics', status: 'opd',
      preg: null, story: 'postnatal' },
    { n: 10, name: 'Keerthi Varma', age: 34, blood: 'A+', phone: '9800000010', doc: 2, dept: 'General', status: 'opd',
      preg: null, story: 'general' }
];

// Exactly as requested: 5 expired, 2 out of stock, 2 near expiry, 1 healthy.
var RD_MEDS = [
    { id: 'rd-med-01', name: 'Amoxycillin 500mg', generic: 'Amoxycillin Trihydrate 500mg', cat: 'Antibiotic', stock: 120, price: 8, expDays: -62, batch: 'AMX-2401' },
    { id: 'rd-med-02', name: 'Metronidazole 400mg', generic: 'Metronidazole 400mg', cat: 'Antibiotic', stock: 90, price: 4, expDays: -31, batch: 'MTZ-2402' },
    { id: 'rd-med-03', name: 'Ranitidine 150mg', generic: 'Ranitidine HCl 150mg', cat: 'Antacid', stock: 60, price: 3, expDays: -95, batch: 'RAN-2312' },
    { id: 'rd-med-04', name: 'Cefixime 200mg', generic: 'Cefixime Trihydrate 200mg', cat: 'Antibiotic', stock: 45, price: 14, expDays: -18, batch: 'CFX-2403' },
    { id: 'rd-med-05', name: 'Diclofenac 50mg', generic: 'Diclofenac Sodium 50mg', cat: 'Analgesic', stock: 75, price: 3.5, expDays: -47, batch: 'DIC-2404' },
    { id: 'rd-med-06', name: 'Oxytocin injection', generic: 'Oxytocin 10 IU/ml', cat: 'Uterotonic', stock: 0, price: 52, expDays: 420, batch: 'OXY-2601' },
    { id: 'rd-med-07', name: 'Anti-D injection', generic: 'Anti-D Immunoglobulin 300mcg', cat: 'Immunoglobulin', stock: 0, price: 2500, expDays: 380, batch: 'AND-2601' },
    { id: 'rd-med-08', name: 'Iron + Folic Acid', generic: 'Ferrous Ascorbate + Folic Acid', cat: 'Supplement', stock: 240, price: 6, expDays: 12, batch: 'IFA-2605' },
    { id: 'rd-med-09', name: 'Calcium + Vitamin D3', generic: 'Calcium Carbonate + Vitamin D3', cat: 'Supplement', stock: 180, price: 7, expDays: 25, batch: 'CAL-2606' },
    { id: 'rd-med-10', name: 'Folic Acid 5mg', generic: 'Folic Acid 5mg', cat: 'Vitamin', stock: 600, price: 5, expDays: 545, batch: 'FOL-2701' }
];

// Only these three are sellable, so every prescription is priced off them.
var RD_SELLABLE = ['Iron + Folic Acid', 'Calcium + Vitamin D3', 'Folic Acid 5mg'];

var RD_VITALS = [
    { bp: '118/76', pulse: '82', temperature: '98.4', weight: '58', height: '158', spo2: '99' },
    { bp: '126/84', pulse: '88', temperature: '98.6', weight: '62', height: '160', spo2: '98' },
    { bp: '148/96', pulse: '96', temperature: '99.1', weight: '68', height: '156', spo2: '97' },
    { bp: '110/70', pulse: '78', temperature: '98.2', weight: '55', height: '162', spo2: '99' }
];

var RD_LABS = ['CBC Complete Blood Count', 'Blood Group and Rh Typing', 'HbA1c', 'Thyroid Profile (T3 T4 TSH)', 'Urine Routine', 'OGTT (Pregnancy 75g)'];
var RD_SCANS = ['Obstetric USG - Dating Scan', 'Obstetric USG - Anomaly Scan', 'Obstetric USG - Growth Scan', 'Pelvic Ultrasound'];
var RD_VISIT_DAYS = [75, 45, 12];

// The payments ledger is append-only in the security rules: a receipt can be
// created but never updated. A plain re-run therefore fails on every payment
// row it already wrote, so those are skipped when they exist rather than
// rewritten — the seeder stays re-runnable without weakening the rule.
async function rdCommit(writes) {
    var appendOnly = writes.filter(function (w) { return w.ref.parent && w.ref.parent.id === 'payments'; });
    var existing = {};
    if (appendOnly.length) {
        var checks = await Promise.all(appendOnly.map(function (w) {
            return w.ref.get().then(function (d) { return d.exists ? w.ref.path : null; }, function () { return null; });
        }));
        checks.forEach(function (p) { if (p) existing[p] = true; });
    }

    var pending = writes.filter(function (w) { return !existing[w.ref.path]; });
    var skipped = writes.length - pending.length;
    if (skipped) rdLog('Skipped ' + skipped + ' existing payment receipt(s) — ledger is append-only', 'warn');

    var i = 0;
    while (i < pending.length) {
        var batch = db.batch();
        pending.slice(i, i + 400).forEach(function (w) { batch.set(w.ref, w.data, { merge: true }); });
        await batch.commit();
        i += 400;
    }
}

async function seedRichClinicalDemo() {
    if (typeof ensureSignedIn === 'function') await ensureSignedIn();
    var writes = [];
    var push = function (ref, data) { writes.push({ ref: ref, data: data }); };

    // ---------- MEDICINES + GOODS RECEIVED ----------
    RD_MEDS.forEach(function (m, i) {
        push(db.collection('pharmacy').doc(m.id), {
            medicineName: m.name, genericName: m.generic, category: m.cat,
            stock: m.stock, unitPrice: m.price, price: m.price, reorderLevel: 30,
            expiryDate: rdDate(-m.expDays), manufacturer: 'Demo Pharma Ltd',
            batchNumber: m.batch, unit: 'Tablet', disposed: false,
            branchId: 'main', createdAt: rdStamp(80, 9)
        });
        var cost = Math.max(1, Math.round(m.price * 0.7));
        var qty = m.stock || 100;
        push(db.collection('stockReceipts').doc('rd-grn-' + rdPad(i + 1)), {
            medicineId: m.id, medicineName: m.name, quantityAdded: qty,
            supplierName: ['Godavari Medicals', 'Sri Sai Distributors', 'Apex Pharma Traders'][i % 3],
            purchasePrice: cost, amount: qty * cost, batchNumber: m.batch,
            expiryDate: rdDate(-m.expDays), grnNo: 'GRN-2026-' + rdPad(i + 1, 4),
            paymentDueDate: rdDate(-15 + i), paymentStatus: i % 3 === 0 ? 'paid' : 'unpaid',
            notes: 'Opening stock purchase', addedBy: 'admin@example.local',
            branchId: 'main', addedAt: rdStamp(70 - i, 11)
        });
    });

    // ---------- PATIENTS ----------
    var people = [];
    RD_PATIENTS.forEach(function (p) {
        var docId = 'rd-pat-' + rdPad(p.n);
        // 9xxxx range: the sequential counter allocates upward from 00001, so demo
        // patients must sit outside it or they collide with real records.
        var pid = 'SA-2026-9' + rdPad(p.n, 4);
        var doc = RD_DOCS[p.doc];
        var rec = {
            patientId: pid, name: p.name, nameLower: p.name.toLowerCase(),
            phone: p.phone, age: p.age, gender: 'Female', bloodGroup: p.blood,
            dob: (new Date().getFullYear() - p.age) + '-05-14',
            address: 'Demo Colony, Hyderabad', department: p.dept,
            doctor: doc.name, doctorName: doc.name, doctorId: doc.id,
            emergencyContact: '98' + p.phone.slice(2), emergencyContactName: 'Family member',
            status: p.status, whatsAppConsent: true, smsConsent: true,
            emailConsent: p.n % 2 === 0, branchId: 'main', createdAt: rdStamp(90 - p.n, 9)
        };
        if (p.preg) {
            var lmp = rdDate(p.preg.weeks * 7);
            rec.isPregnant = true;
            rec.lmp = lmp;
            rec.edd = rdEdd(lmp);
            rec.gravida = p.preg.gravida;
            rec.para = p.preg.para;
            rec.abortions = p.preg.abortions;
            rec.highRisk = p.preg.highRisk;
            rec.highRiskReason = p.preg.reason;
            rec.gestationalWeeks = p.preg.weeks;
            rec.nextVisitDate = rdDate(-7);
        }
        push(db.collection('patients').doc(docId), rec);
        push(db.collection('patientIndex').doc(pid), {
            patientId: pid, patientDocId: docId, name: p.name,
            nameLower: p.name.toLowerCase(), phone: p.phone
        });
        people.push({ docId: docId, pid: pid, name: p.name, doc: doc, p: p });
    });

    await rdCommit(writes); writes = [];
    rdLog('10 patients (with LMP, EDD, gravida/para) and 10 medicines seeded', 'success');

    // ---------- THREE MONTHS OF HISTORY ----------
    people.forEach(function (person) {
        var p = person.p;

        RD_VISIT_DAYS.forEach(function (ago, v) {
            var day = rdDate(ago);
            var consId = 'rd-cons-' + rdPad(p.n) + '-' + (v + 1);
            var vit = RD_VITALS[(p.n + v) % RD_VITALS.length];
            var labName = RD_LABS[(p.n + v) % RD_LABS.length];
            var scanName = RD_SCANS[(p.n + v) % RD_SCANS.length];
            var last = v === RD_VISIT_DAYS.length - 1;
            var labAmt = 350 + v * 50;

            push(db.collection('consultations').doc(consId), {
                consultationId: consId, patientId: person.pid, patientName: p.name,
                patientDocId: person.docId, doctorName: person.doc.name, doctorId: person.doc.id,
                department: p.dept, visitDate: day, vitals: vit,
                chiefComplaint: p.preg ? 'Routine antenatal review' : 'General review',
                historyOfIllness: p.preg
                    ? 'G' + p.preg.gravida + 'P' + p.preg.para + ', LMP ' + rdDate(p.preg.weeks * 7) + '. '
                        + (p.preg.highRisk ? p.preg.reason : 'No complaints.')
                    : 'Reviewed for ongoing symptoms.',
                examinationFindings: p.preg
                    ? 'Fundal height corresponds to dates. FHR 142 bpm. BP ' + vit.bp + '.'
                    : 'BP ' + vit.bp + ', systemic examination normal.',
                diagnosis: p.preg
                    ? (p.preg.highRisk ? 'High-risk pregnancy - ' + p.preg.reason : 'Normal intrauterine pregnancy')
                    : (p.story === 'gynae' ? 'Uterine fibroid with menorrhagia' : 'Iron deficiency anaemia'),
                advice: p.preg
                    ? 'Continue supplements, iron-rich diet, report if reduced fetal movements.'
                    : 'Diet advice, review with reports.',
                labOrders: [{ name: labName, amount: labAmt }],
                imagingOrders: p.preg ? [{ name: scanName, amount: 900 }] : [],
                prescription: [
                    { medicine: 'Folic Acid 5mg', medicineName: 'Folic Acid 5mg', dosage: '5mg', frequency: 'Once daily', duration: '30 days', instructions: 'After breakfast' },
                    { medicine: 'Iron + Folic Acid', medicineName: 'Iron + Folic Acid', dosage: '1 tab', frequency: 'Twice daily', duration: '30 days', instructions: 'After food' }
                ],
                followUpRequired: true, followUpDate: rdDate(ago - 30),
                followUpNotes: 'Routine review', status: 'completed',
                branchId: 'main', createdAt: rdStamp(ago, 10 + v)
            });

            push(db.collection('reports').doc('rd-lab-' + rdPad(p.n) + '-' + (v + 1)), {
                reportId: 'SA-LAB-2026-' + rdPad(p.n * 10 + v, 5),
                patientId: person.pid, patientName: p.name, patientDocId: person.docId,
                type: 'lab', testName: labName, amount: labAmt, totalAmount: labAmt,
                referredBy: person.doc.name, visitDoctor: person.doc.name,
                status: last ? (p.n % 3 === 0 ? 'pending' : 'ready') : 'completed',
                billingStatus: (last && p.n % 3 === 0) ? 'unpaid' : 'paid',
                reportDate: day, consultationId: consId, source: 'doctor_order',
                reportText: 'Haemoglobin 11.2 g/dL, TLC 8200/cumm, Platelets 2.4 lakh/cumm.',
                branchId: 'main', createdAt: rdStamp(ago, 12)
            });

            if (p.preg) {
                push(db.collection('reports').doc('rd-img-' + rdPad(p.n) + '-' + (v + 1)), {
                    reportId: 'SA-IMG-2026-' + rdPad(p.n * 10 + v, 5),
                    patientId: person.pid, patientName: p.name, patientDocId: person.docId,
                    type: 'imaging', testName: scanName, imagingType: 'Ultrasound',
                    amount: 900, totalAmount: 900,
                    referredBy: person.doc.name, visitDoctor: person.doc.name,
                    status: last ? 'ready' : 'completed', billingStatus: 'paid',
                    reportDate: day, consultationId: consId,
                    accessionNumber: 'ACC-2026-' + rdPad(p.n * 10 + v, 5),
                    studyInstanceUID: '1.2.840.113619.2.55.' + (100000 + p.n * 10 + v),
                    reportText: 'Single live intrauterine gestation. Cardiac activity present. Liquor adequate.',
                    source: 'doctor_order', branchId: 'main', createdAt: rdStamp(ago, 13)
                });
            }

            var total = 500 + labAmt + (p.preg ? 900 : 0);
            var methods = [['Cash'], ['PhonePe'], ['Card'], ['Cash', 'PhonePe']][(p.n + v) % 4];
            var details = {};
            var per = Math.round((total / methods.length) * 100) / 100;
            methods.forEach(function (m, i) {
                details[m] = { amount: i === methods.length - 1 ? Math.round((total - per * (methods.length - 1)) * 100) / 100 : per };
            });
            var items = [
                { category: 'Consultation', description: 'Consultation - ' + person.doc.name, quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'Lab Test', description: labName, quantity: 1, unitPrice: labAmt, amount: labAmt }
            ];
            if (p.preg) items.push({ category: 'Imaging', description: scanName, quantity: 1, unitPrice: 900, amount: 900 });

            push(db.collection('bills').doc('rd-bill-opd-' + rdPad(p.n) + '-' + (v + 1)), {
                billId: 'SA-OPD-2026-' + rdPad(p.n * 10 + v, 5),
                patientId: person.pid, patientDocId: person.docId, patientName: p.name,
                patientPhone: p.phone, type: 'OPD', visitType: 'OPD',
                visitDoctor: person.doc.name, visitDepartment: p.dept, items: items,
                subtotal: total, grandTotal: total, amountPaid: total, balanceDue: 0,
                paymentStatus: 'paid', paymentMethods: methods, paymentDetails: details,
                billedBy: 'reception@example.local', createdBy: 'reception@example.local',
                branchId: 'main', createdAt: rdStamp(ago, 14)
            });

            push(db.collection('payments').doc('rd-pay-' + rdPad(p.n) + '-' + (v + 1)), {
                paymentId: 'PAY-RD-' + rdPad(p.n * 10 + v, 5),
                billId: 'SA-OPD-2026-' + rdPad(p.n * 10 + v, 5),
                patientId: person.pid, patientName: p.name, amount: total, totalPaid: total,
                mode: methods[0], date: day, recordedBy: rdActor(),
                branchId: 'main', createdAt: rdStamp(ago, 14)
            });
        });

        if (p.preg) {
            RD_VISIT_DAYS.forEach(function (ago, i) {
                push(db.collection('ancVisits').doc('rd-anc-' + rdPad(p.n) + '-' + (i + 1)), {
                    patientId: person.pid, patientName: p.name, visitDate: rdDate(ago),
                    gestationalWeeks: Math.max(4, p.preg.weeks - Math.round(ago / 7)),
                    weight: 56 + i * 2,
                    bpSystolic: p.preg.highRisk ? 144 : 116,
                    bpDiastolic: p.preg.highRisk ? 94 : 74,
                    fundalHeight: Math.max(0, p.preg.weeks - Math.round(ago / 7)),
                    fetalHeartRate: 142, hb: Math.round((11.4 - i * 0.2) * 10) / 10,
                    urineAlbumin: p.preg.highRisk ? 'Trace' : 'Nil',
                    complaints: i === 2 ? 'Mild pedal edema' : 'No complaints',
                    advice: p.preg.highRisk ? 'BP monitoring, low salt diet, weekly review' : 'Continue supplements',
                    nextVisitDate: rdDate(ago - 30), recordedBy: person.doc.name,
                    branchId: 'main', createdAt: rdStamp(ago, 11)
                });
            });
        }
    });

    await rdCommit(writes); writes = [];
    rdLog('3 months of consultations, labs, imaging, OPD bills, payments and ANC visits', 'success');
    return people;
}

window.seedRichClinicalDemo = seedRichClinicalDemo;

// ==========================================================
// PART 2 — today's live activity and every care level
// ==========================================================
async function seedRichOperationalDemo(people) {
    var writes = [];
    var push = function (ref, data) { writes.push({ ref: ref, data: data }); };
    var today = rdDate(0);
    var byStory = {};
    people.forEach(function (x) { byStory[x.p.story] = x; });
    var PAY_MODES = ['Cash', 'PhonePe', 'Card', 'UPI'];

    // ---------- TODAY: OP QUEUE WITH VITALS ----------
    var queue = ['anc_early', 'anc_highrisk', 'anc_term', 'gynae', 'general'];
    queue.forEach(function (story, i) {
        var person = byStory[story];
        if (!person) return;
        var vit = RD_VITALS[i % RD_VITALS.length];
        push(db.collection('opTokens').doc('rd-tok-' + rdPad(i + 1)), {
            date: today, tokenNo: i + 1, patientName: person.name, patientId: person.pid,
            patientDocId: person.docId, doctorId: person.doc.id, doctorName: person.doc.name,
            status: i === 0 ? 'serving' : (i < 3 ? 'waiting' : 'done'),
            vitals: { bp: vit.bp, pulse: vit.pulse, temp: vit.temperature, weight: vit.weight, spo2: vit.spo2 },
            vitalsRecorded: true, chiefComplaint: 'Routine review',
            issuedAtText: '09:' + rdPad(i * 12), branchId: 'main',
            createdAt: rdStamp(0, 9)
        });
    });

    // ---------- APPOINTMENTS: past, today, upcoming follow-ups ----------
    people.forEach(function (person, i) {
        var p = person.p;
        push(db.collection('appointments').doc('rd-appt-past-' + rdPad(p.n)), {
            appointmentId: 'APPT-RD-P' + rdPad(p.n), patientId: person.pid, patientName: p.name,
            patientDocId: person.docId, patientPhone: p.phone,
            doctorId: person.doc.id, doctorName: person.doc.name, department: p.dept,
            appointmentDate: rdDate(12), date: rdDate(12), timeSlot: '10:30', time: '10:30',
            tokenNumber: (i % 8) + 1, visitType: 'OPD', status: 'Completed',
            complaint: 'Routine review', branchId: 'main', createdAt: rdStamp(13, 9)
        });
        if (i < 4) {
            push(db.collection('appointments').doc('rd-appt-today-' + rdPad(p.n)), {
                appointmentId: 'APPT-RD-T' + rdPad(p.n), patientId: person.pid, patientName: p.name,
                patientDocId: person.docId, patientPhone: p.phone,
                doctorId: person.doc.id, doctorName: person.doc.name, department: p.dept,
                appointmentDate: today, date: today,
                timeSlot: rdPad(9 + i) + ':00', time: rdPad(9 + i) + ':00',
                tokenNumber: i + 1, visitType: 'OPD', status: 'Scheduled',
                complaint: 'Antenatal check', branchId: 'main', createdAt: rdStamp(1, 16)
            });
        }
        push(db.collection('appointments').doc('rd-appt-follow-' + rdPad(p.n)), {
            appointmentId: 'APPT-RD-F' + rdPad(p.n), patientId: person.pid, patientName: p.name,
            patientDocId: person.docId, patientPhone: p.phone,
            doctorId: person.doc.id, doctorName: person.doc.name, department: p.dept,
            appointmentDate: rdDate(-(2 + i)), date: rdDate(-(2 + i)),
            timeSlot: rdPad(10 + (i % 6)) + ':30', time: rdPad(10 + (i % 6)) + ':30',
            tokenNumber: i + 1, visitType: 'Follow-up', status: 'Scheduled',
            complaint: 'Follow-up review', branchId: 'main', createdAt: rdStamp(0, 12)
        });
    });

    // ---------- PRESCRIPTIONS WAITING AT THE COUNTER ----------
    people.forEach(function (person, i) {
        var p = person.p;
        var meds = [
            { medicineName: 'Iron + Folic Acid', medicine: 'Iron + Folic Acid', dosage: '1 tab', frequency: 'Twice daily', duration: '30 days', instructions: 'After food' },
            { medicineName: 'Calcium + Vitamin D3', medicine: 'Calcium + Vitamin D3', dosage: '1 tab', frequency: 'Once daily', duration: '30 days', instructions: 'At bedtime' },
            { medicineName: 'Folic Acid 5mg', medicine: 'Folic Acid 5mg', dosage: '5mg', frequency: 'Once daily', duration: '15 days', instructions: 'After breakfast' }
        ].slice(0, (i % 3) + 1);
        push(db.collection('prescriptions').doc('rd-rx-' + rdPad(p.n)), {
            prescriptionId: 'rd-rx-' + rdPad(p.n),
            consultationId: 'rd-cons-' + rdPad(p.n) + '-3',
            patientId: person.pid, patientName: p.name, patientDocId: person.docId,
            doctorName: person.doc.name, doctorId: person.doc.id,
            medicines: meds, status: i < 6 ? 'pending' : 'dispensed',
            branchId: 'main', createdAt: rdStamp(i < 6 ? 0 : 5, 11)
        });
    });

    // ---------- PHARMACY BILLS + DISPENSING HISTORY ----------
    people.slice(6).forEach(function (person, i) {
        var mode = PAY_MODES[i % PAY_MODES.length];
        var amt = 240 + i * 60;
        var details = {};
        details[mode] = { amount: amt };
        push(db.collection('bills').doc('rd-bill-ph-' + rdPad(i + 1)), {
            billId: 'SA-PH-2026-' + rdPad(i + 1, 5), billType: 'Pharmacy', type: 'PHARMACY',
            patientId: person.pid, patientDocId: person.docId, patientName: person.name,
            items: [
                { category: 'Medicine', description: 'Iron + Folic Acid x30', quantity: 30, unitPrice: 6, amount: 180 },
                { category: 'Medicine', description: 'Folic Acid 5mg', quantity: 12 + i * 12, unitPrice: 5, amount: amt - 180 }
            ],
            subtotal: amt, grandTotal: amt, amountPaid: amt, balanceDue: 0,
            paymentStatus: 'paid', paymentMethod: mode, paymentMethods: [mode], paymentDetails: details,
            billedBy: 'pharmacy@example.local', createdBy: 'pharmacy@example.local',
            branchId: 'main', createdAt: rdStamp(i, 15)
        });
        push(db.collection('dispensingHistory').doc('rd-disp-' + rdPad(i + 1)), {
            dispensingId: 'rd-disp-' + rdPad(i + 1), patientId: person.pid,
            patientDocId: person.docId, patientName: person.name,
            medicineName: 'Iron + Folic Acid', medicineId: 'rd-med-08',
            quantity: 30, qty: 30, unitPrice: 6, totalAmount: 180,
            prescribedBy: person.doc.name, dispensedBy: 'pharmacy@example.local',
            paymentMethod: mode, linkedBillId: 'SA-PH-2026-' + rdPad(i + 1, 5),
            date: rdDate(i), branchId: 'main', createdAt: rdStamp(i, 15)
        });
        push(db.collection('pharmacyLog').doc('rd-plog-' + rdPad(i + 1)), {
            dispensingId: 'rd-disp-' + rdPad(i + 1), patientId: person.pid,
            patientName: person.name, medicineName: 'Iron + Folic Acid', quantity: 30,
            dispensedBy: 'pharmacy@example.local', branchId: 'main', dispensedAt: rdStamp(i, 15)
        });
    });

    await rdCommit(writes); writes = [];
    rdLog('Today: OP queue with vitals, appointments (past/today/follow-up), Rx queue, pharmacy sales', 'success');

    // ---------- CARE LEVELS: IPD, ICU, ER, OT ----------
    var admits = [
        { story: 'in_labour', type: 'IPD', ward: 'General Ward', rate: 1000, days: 1, charge: 0,
          diag: 'Term pregnancy in active labour', running: true },
        { story: 'post_lscs', type: 'IPD', ward: 'Private', rate: 3500, days: 2, charge: 45000,
          diag: 'Post LSCS day 2', running: true },
        { story: 'icu', type: 'ICU', ward: 'ICU', rate: 6000, days: 3, charge: 0,
          diag: 'Severe pre-eclampsia — ICU care', running: true },
        { story: 'er', type: 'ER', ward: 'Emergency', rate: 1500, days: 1, charge: 0,
          diag: 'First trimester bleeding — observation', running: false }
    ];

    var bedsSnap = await db.collection('beds').get();
    var bedDocs = bedsSnap.docs;

    admits.forEach(function (a, i) {
        var person = byStory[a.story];
        if (!person) return;
        var admDate = rdDate(a.days);
        var billDocId = 'rd-bill-' + a.type.toLowerCase() + '-' + rdPad(i + 1);
        var billId = 'SA-' + a.type + '-2026-' + rdPad(i + 1, 5);
        var bedNo = ['A-101', 'C-101', 'ICU-01', 'A-105'][i];

        var items = [];
        var d;
        for (d = 0; d < a.days; d++) {
            items.push({ category: 'Bed Charges', description: 'Bed ' + bedNo + ' (' + a.ward + ') day ' + (d + 1),
                quantity: 1, unitPrice: a.rate, amount: a.rate });
        }
        items.push({ category: 'Consultation', description: 'Daily rounds - ' + person.doc.name,
            quantity: a.days, unitPrice: 600, amount: 600 * a.days });
        items.push({ category: 'Nursing', description: 'Nursing charges', quantity: a.days, unitPrice: 400, amount: 400 * a.days });
        if (a.charge) items.push({ category: 'Procedure', description: 'LSCS package', quantity: 1, unitPrice: a.charge, amount: a.charge });

        var total = items.reduce(function (s, it) { return s + it.amount; }, 0);
        var paid = a.running ? Math.round(total * 0.4) : total;
        var mode = PAY_MODES[i % PAY_MODES.length];
        var details = {};
        details[mode] = { amount: paid };

        push(db.collection('bills').doc(billDocId), {
            billId: billId, billDocId: billDocId,
            patientId: person.pid, patientDocId: person.docId, patientName: person.name,
            patientPhone: person.p.phone, type: a.type, visitType: a.type,
            visitDoctor: person.doc.name, visitDepartment: person.p.dept,
            bedNumber: bedNo, bedWard: a.ward, dailyRate: a.rate,
            admissionDate: admDate, items: items,
            subtotal: total, grandTotal: total, amountPaid: paid,
            balanceDue: total - paid,
            paymentStatus: a.running ? 'partial' : 'paid',
            paymentMethods: [mode], paymentDetails: details,
            isRunningBill: a.running, isFinalized: !a.running,
            billedBy: 'billing@example.local', createdBy: 'billing@example.local',
            branchId: 'main', createdAt: rdStamp(a.days, 8)
        });

        push(db.collection('admissions').doc('rd-adm-' + rdPad(i + 1)), {
            admissionId: 'ADM-RD-' + rdPad(i + 1), id: 'ADM-RD-' + rdPad(i + 1),
            patientId: person.pid, patientDocId: person.docId, patientName: person.name,
            admissionDate: admDate, admissionType: a.type, ward: a.ward, bedNumber: bedNo,
            doctorName: person.doc.name, diagnosis: a.diag,
            status: 'admitted', billId: billId, billDocId: billDocId,
            branchId: 'main', createdAt: rdStamp(a.days, 8)
        });

        push(db.collection('payments').doc('rd-pay-adm-' + rdPad(i + 1)), {
            paymentId: 'PAY-RD-ADM-' + rdPad(i + 1), billId: billId,
            patientId: person.pid, patientName: person.name,
            amount: paid, totalPaid: paid, mode: mode, date: admDate,
            recordedBy: rdActor(), branchId: 'main', createdAt: rdStamp(a.days, 9)
        });

        var bed = bedDocs.filter(function (bd) { return bd.id === bedNo; })[0];
        if (bed) {
            push(bed.ref, {
                status: 'occupied', patientId: person.pid, patientDocId: person.docId,
                patientName: person.name, billId: billId, billDocId: billDocId,
                activeAdmissionId: 'ADM-RD-' + rdPad(i + 1), admittedAt: admDate
            });
        }
    });

    // ---------- THEATRE ----------
    var lscs = byStory['post_lscs'];
    var termAnc = byStory['anc_term'];
    if (lscs) {
        push(db.collection('otBookings').doc('rd-ot-01'), {
            bookingId: 'rd-ot-01', patientId: lscs.pid, patientDocId: lscs.docId,
            patientName: lscs.name, procedureType: 'Emergency LSCS',
            surgeonName: lscs.doc.name, surgeonId: lscs.doc.id,
            anaesthetistName: 'Dr. Priya Sharma', otRoomId: 'OT-01', otRoomName: 'OT-01',
            scheduledDate: rdDate(2), scheduledTime: '09:30 AM', estimatedDuration: 60,
            charge: 45000, preOpNotes: 'Two previous LSCS. Consent taken. Cross-matched blood arranged.',
            postOpNotes: 'Uneventful. Shifted to Private ward.', status: 'completed',
            billId: 'SA-IPD-2026-00002', branchId: 'main', createdAt: rdStamp(3, 17)
        });
    }
    if (termAnc) {
        push(db.collection('otBookings').doc('rd-ot-02'), {
            bookingId: 'rd-ot-02', patientId: termAnc.pid, patientDocId: termAnc.docId,
            patientName: termAnc.name, procedureType: 'Elective LSCS',
            surgeonName: termAnc.doc.name, surgeonId: termAnc.doc.id,
            anaesthetistName: 'Dr. Priya Sharma', otRoomId: 'OT-01', otRoomName: 'OT-01',
            scheduledDate: today, scheduledTime: '11:00 AM', estimatedDuration: 60,
            charge: 42000, preOpNotes: 'Pre-op investigations complete. NBM from midnight.',
            status: 'scheduled', branchId: 'main', createdAt: rdStamp(1, 18)
        });
    }

    await rdCommit(writes); writes = [];
    rdLog('Care levels: IPD x2, ICU, ER, beds occupied, theatre bookings (done + scheduled)', 'success');
    return byStory;
}
window.seedRichOperationalDemo = seedRichOperationalDemo;

// ==========================================================
// PART 3 — maternity records, discharge, and every other section
// ==========================================================
async function seedRichMaternityDemo(byStory) {
    var writes = [];
    var push = function (ref, data) { writes.push({ ref: ref, data: data }); };
    var today = rdDate(0);

    // ---------- PARTOGRAPHS ----------
    // One active labour charted through today, one completed with a chart
    // that crosses the alert line so the escalation banner is visible.
    var labour = byStory['in_labour'];
    if (labour) {
        push(db.collection('partographs').doc('rd-parto-active'), {
            patientId: labour.pid, patientName: labour.name, patientDocId: labour.docId,
            parity: 'G2P1', labourStart: today + 'T06:00', status: 'active',
            observations: [
                { time: today + 'T06:00', dilation: 2, effacement: '30%', descent: '-3', liquor: 'Clear', fhr: 142, contractions: 2, pulse: 84, bp: '116/74', temperature: 98.2, urineOutput: 'voided', ivFluids: 'RL 100 ml/hr', oxytocin: '', medication: '', notes: 'Admitted in early labour' },
                { time: today + 'T08:00', dilation: 4, effacement: '50%', descent: '-2', liquor: 'Clear', fhr: 140, contractions: 3, pulse: 88, bp: '118/76', temperature: 98.4, urineOutput: '120 ml', ivFluids: 'RL 100 ml/hr', oxytocin: '2 mu/min', medication: '', notes: 'Active phase reached' },
                { time: today + 'T10:00', dilation: 6, effacement: '70%', descent: '0', liquor: 'Clear', fhr: 138, contractions: 4, pulse: 92, bp: '120/78', temperature: 98.6, urineOutput: '100 ml', ivFluids: 'RL 80 ml/hr', oxytocin: '4 mu/min', medication: '', notes: 'Progressing well' },
                { time: today + 'T12:00', dilation: 8, effacement: '90%', descent: '+1', liquor: 'Clear', fhr: 144, contractions: 5, pulse: 96, bp: '124/80', temperature: 98.8, urineOutput: '80 ml', ivFluids: 'RL 80 ml/hr', oxytocin: '6 mu/min', medication: '', notes: 'Second stage approaching' }
            ],
            createdBy: labour.doc.name, branchId: 'main', createdAt: rdStamp(0, 6)
        });
    }

    var lscs = byStory['post_lscs'];
    if (lscs) {
        var lday = rdDate(2);
        push(db.collection('partographs').doc('rd-parto-arrest'), {
            patientId: lscs.pid, patientName: lscs.name, patientDocId: lscs.docId,
            parity: 'G3P2', labourStart: lday + 'T05:00', status: 'transferred',
            observations: [
                { time: lday + 'T05:00', dilation: 3, effacement: '40%', descent: '-3', liquor: 'Clear', fhr: 138, contractions: 2, pulse: 90, bp: '128/84', temperature: 98.6, urineOutput: 'voided', ivFluids: 'RL 100 ml/hr', medication: '', notes: 'Admitted with pains' },
                { time: lday + 'T07:00', dilation: 4, effacement: '50%', descent: '-3', liquor: 'Clear', fhr: 136, contractions: 3, pulse: 96, bp: '130/86', temperature: 98.8, urineOutput: '90 ml', ivFluids: 'RL 100 ml/hr', oxytocin: '2 mu/min', medication: '', notes: 'Active phase' },
                { time: lday + 'T10:00', dilation: 5, effacement: '60%', descent: '-2', liquor: 'Meconium', fhr: 108, contractions: 3, pulse: 112, bp: '138/90', temperature: 99.4, urineOutput: '60 ml', ivFluids: 'RL 100 ml/hr', oxytocin: '6 mu/min', medication: 'Inj. Ceftriaxone 1g IV', notes: 'Meconium stained liquor. Fetal bradycardia. Inform consultant.' },
                { time: lday + 'T12:00', dilation: 5, effacement: '60%', descent: '-2', liquor: 'Meconium', fhr: 104, contractions: 2, pulse: 118, bp: '142/94', temperature: 99.6, urineOutput: '40 ml', ivFluids: 'RL 100 ml/hr', oxytocin: '8 mu/min', medication: '', notes: 'Arrest of dilatation. Decision for emergency LSCS.' }
            ],
            createdBy: lscs.doc.name, branchId: 'main', createdAt: rdStamp(2, 5)
        });

        push(db.collection('deliveries').doc('rd-del-01'), {
            deliveryId: 'rd-del-01', patientId: lscs.pid, patientDocId: lscs.docId,
            patientName: lscs.name, deliveryDate: rdDate(2), deliveryTime: '09:52',
            deliveryType: 'LSCS', weeks: 40, conductedBy: lscs.doc.name,
            place: 'Hospital', motherCondition: 'Stable',
            indication: 'Arrest of dilatation with fetal distress',
            bloodLoss: '600 ml', anaesthesia: 'Spinal',
            birthRegistration: { parentsIdProof: true, addressProof: true, hospitalCertificate: true, readyToFile: true },
            branchId: 'main', createdAt: rdStamp(2, 10)
        });
        push(db.collection('babies').doc('rd-baby-01'), {
            babyId: 'rd-baby-01', deliveryId: 'rd-del-01',
            motherId: lscs.pid, motherDocId: lscs.docId, motherName: lscs.name,
            name: 'Baby of ' + lscs.name, sex: 'Female', weight: 3.1,
            apgar1: 8, apgar5: 9, dateOfBirth: rdDate(2), timeOfBirth: '09:52',
            condition: 'Healthy', branchId: 'main', createdAt: rdStamp(2, 10)
        });
        ['BCG', 'Hepatitis B - birth dose', 'OPV-0'].forEach(function (vac, i) {
            push(db.collection('vaccinations').doc('rd-vac-' + rdPad(i + 1)), {
                babyId: 'rd-baby-01', babyName: 'Baby of ' + lscs.name,
                motherId: lscs.pid, patientId: lscs.pid, patientName: 'Baby of ' + lscs.name,
                vaccineName: vac, dueDate: rdDate(2), givenDate: rdDate(2),
                status: 'given', batchNo: 'VAC-260' + (i + 1), givenBy: 'Nurse Lakshmi',
                branchId: 'main', createdAt: rdStamp(2, 11)
            });
        });
    }

    // Postnatal patient: delivered a month ago, baby on the vaccine schedule
    var postnatal = byStory['postnatal'];
    if (postnatal) {
        push(db.collection('deliveries').doc('rd-del-02'), {
            deliveryId: 'rd-del-02', patientId: postnatal.pid, patientDocId: postnatal.docId,
            patientName: postnatal.name, deliveryDate: rdDate(30), deliveryTime: '04:15',
            deliveryType: 'Normal', weeks: 39, conductedBy: postnatal.doc.name,
            place: 'Hospital', motherCondition: 'Stable', bloodLoss: '250 ml',
            birthRegistration: { parentsIdProof: true, addressProof: false, hospitalCertificate: true, readyToFile: false },
            branchId: 'main', createdAt: rdStamp(30, 6)
        });
        push(db.collection('babies').doc('rd-baby-02'), {
            babyId: 'rd-baby-02', deliveryId: 'rd-del-02',
            motherId: postnatal.pid, motherDocId: postnatal.docId, motherName: postnatal.name,
            name: 'Baby of ' + postnatal.name, sex: 'Male', weight: 2.9,
            apgar1: 9, apgar5: 10, dateOfBirth: rdDate(30), timeOfBirth: '04:15',
            condition: 'Healthy', branchId: 'main', createdAt: rdStamp(30, 6)
        });
        [
            { v: 'BCG', d: 30, s: 'given' },
            { v: 'Hepatitis B - birth dose', d: 30, s: 'given' },
            { v: 'OPV-0', d: 30, s: 'given' },
            { v: 'Pentavalent-1', d: -12, s: 'due' },
            { v: 'Rotavirus-1', d: -12, s: 'due' }
        ].forEach(function (x, i) {
            push(db.collection('vaccinations').doc('rd-vac-pn-' + rdPad(i + 1)), {
                babyId: 'rd-baby-02', babyName: 'Baby of ' + postnatal.name,
                motherId: postnatal.pid, patientId: postnatal.pid,
                patientName: 'Baby of ' + postnatal.name, vaccineName: x.v,
                dueDate: rdDate(x.d), givenDate: x.s === 'given' ? rdDate(x.d) : '',
                status: x.s, batchNo: x.s === 'given' ? 'VAC-27' + rdPad(i + 1) : '',
                givenBy: x.s === 'given' ? 'Nurse Lakshmi' : '',
                branchId: 'main', createdAt: rdStamp(30, 7)
            });
        });

        // Discharge summary for the completed postnatal stay
        push(db.collection('dischargeLogs').doc('rd-dis-01'), {
            patientId: postnatal.pid, patientDocId: postnatal.docId, patientName: postnatal.name,
            admissionDate: rdDate(31), dischargeDate: rdDate(28),
            diagnosis: 'Full term normal vaginal delivery', procedure: 'Normal delivery',
            courseInHospital: 'Delivered a healthy male baby. Post-natal period uneventful. Mother and baby stable.',
            conditionOnDischarge: 'Stable', dischargeMedication: 'Iron + Folic Acid, Calcium for 90 days',
            followUpDate: rdDate(-14), followUpNotes: 'Postnatal review in 2 weeks with baby',
            dischargedBy: postnatal.doc.name, branchId: 'main', createdAt: rdStamp(28, 11)
        });

        push(db.collection('certificates').doc('rd-cert-birth-90009'), {
            certificateNo: 'JYO/BC/2026/00001', certificateType: 'birth',
            patientId: postnatal.pid, patientName: postnatal.name,
            babyName: 'Baby of ' + postnatal.name, sex: 'Male',
            dateOfBirth: rdDate(30), timeOfBirth: '04:15', weight: 2.9,
            motherName: postnatal.name, fatherName: 'Demo Father',
            placeOfBirth: 'Hospital', issuedBy: postnatal.doc.name,
            status: 'issued', branchId: 'main', createdAt: rdStamp(28, 12)
        });
    }

    await rdCommit(writes); writes = [];
    rdLog('Maternity: partographs (active + alert-line crossing), deliveries, babies, vaccines, discharge, birth certificate', 'success');
}
window.seedRichMaternityDemo = seedRichMaternityDemo;

// ==========================================================
// PART 4 — supporting sections so nothing renders empty
// ==========================================================
async function seedRichSupportingDemo(people, byStory) {
    var writes = [];
    var push = function (ref, data) { writes.push({ ref: ref, data: data }); };
    var today = rdDate(0);

    // ---------- INSURANCE CLAIMS ----------
    [byStory['post_lscs'], byStory['icu']].forEach(function (person, i) {
        if (!person) return;
        push(db.collection('insuranceClaims').doc('rd-claim-' + rdPad(i + 1)), {
            claimNo: 'CLM-2026-' + rdPad(i + 1, 4),
            patientId: person.pid, patientName: person.name, patientDocId: person.docId,
            insurerName: ['Star Health', 'Aarogyasri'][i],
            policyNumber: 'POL-' + rdPad(90000 + i, 6),
            billId: 'SA-IPD-2026-' + rdPad(i + 2, 5),
            claimedAmount: [58000, 72000][i], approvedAmount: [52000, 0][i],
            status: ['approved', 'submitted'][i], submittedDate: rdDate(3 + i),
            notes: 'Demo claim', branchId: 'main', createdAt: rdStamp(3 + i, 12)
        });
    });

    // ---------- PACKAGES + SERVICE CATALOG ----------
    [
        { id: 'pkg-normal', name: 'Normal Delivery Package', price: 35000, inclusions: 'Delivery, 2 days stay, nursing, routine medicines, newborn care' },
        { id: 'pkg-lscs', name: 'Caesarean (LSCS) Package', price: 65000, inclusions: 'Surgery, anaesthesia, 4 days stay, nursing, medicines, newborn care' },
        { id: 'pkg-anc', name: 'Antenatal Care Package', price: 12000, inclusions: '8 antenatal visits, routine labs, 3 scans' }
    ].forEach(function (pk) {
        push(db.collection('carePackages').doc(pk.id), {
            packageName: pk.name, name: pk.name, price: pk.price, amount: pk.price,
            inclusions: pk.inclusions, active: true, branchId: 'main',
            createdAt: rdStamp(60, 10)
        });
    });
    [
        { id: 'svc-consult', name: 'Consultation', price: 500, category: 'Consultation' },
        { id: 'svc-usg', name: 'Obstetric Ultrasound', price: 900, category: 'Imaging' },
        { id: 'svc-cbc', name: 'CBC Complete Blood Count', price: 350, category: 'Lab Test' },
        { id: 'svc-nursing', name: 'Nursing charges (per day)', price: 400, category: 'Nursing' },
        { id: 'svc-lscs', name: 'LSCS procedure', price: 45000, category: 'Procedure' }
    ].forEach(function (sv) {
        push(db.collection('serviceCatalog').doc(sv.id), {
            serviceName: sv.name, name: sv.name, price: sv.price,
            amount: sv.price, category: sv.category, active: true,
            branchId: 'main', createdAt: rdStamp(60, 10)
        });
    });

    // ---------- QUALITY: INCIDENTS, CONSENTS, DAILY AUDIT ----------
    [
        { t: 'Near miss', s: 'Wrong drug nearly administered — caught at bedside check', sev: 'medium', st: 'closed' },
        { t: 'Delay', s: 'Theatre start delayed 40 minutes awaiting cross-matched blood', sev: 'low', st: 'closed' },
        { t: 'Fall', s: 'Patient slipped in ward bathroom, no injury', sev: 'medium', st: 'open' }
    ].forEach(function (inc, i) {
        push(db.collection('incidents').doc('rd-inc-' + rdPad(i + 1)), {
            date: rdDate(i * 6 + 2), type: inc.t, summary: inc.s, severity: inc.sev,
            status: inc.st, actionTaken: inc.st === 'closed' ? 'Reviewed in staff meeting; checklist reinforced.' : '',
            reportedBy: 'Nurse Lakshmi', branchId: 'main', createdAt: rdStamp(i * 6 + 2, 14)
        });
    });
    ['LSCS', 'Blood transfusion', 'Anaesthesia'].forEach(function (ct, i) {
        var person = people[(i + 4) % people.length];
        push(db.collection('consentRecords').doc('rd-consent-' + rdPad(i + 1)), {
            date: rdDate(i + 2), patientId: person.pid, patientName: person.name,
            consentType: ct, witness: 'Attendant', notes: 'Explained in local language',
            recordedBy: person.doc.name, branchId: 'main', createdAt: rdStamp(i + 2, 9)
        });
    });
    for (var q = 0; q < 5; q++) {
        push(db.collection('qualityAudits').doc('rd-audit-' + rdPad(q + 1)), {
            date: rdDate(q), handHygiene: q % 4 !== 0, sharpsDisposal: true,
            emergencyTrolley: q % 3 !== 0, biomedicalWaste: true,
            score: q % 4 === 0 ? 75 : 100,
            notes: q % 4 === 0 ? 'Hand hygiene compliance below target in ward B' : 'All checks satisfactory',
            auditedBy: 'Nurse Lakshmi', branchId: 'main', createdAt: rdStamp(q, 8)
        });
    }

    // ---------- TELECONSULT ----------
    push(db.collection('teleconsults').doc('rd-tele-01'), {
        patientId: people[0].pid, patientName: people[0].name, patientDocId: people[0].docId,
        doctorName: people[0].doc.name, doctorId: people[0].doc.id,
        scheduledDate: today, scheduledTime: '17:00',
        roomUrl: 'https://meet.jit.si/jyothsna-demo-anc-review',
        status: 'scheduled', notes: 'Antenatal review by video',
        branchId: 'main', createdAt: rdStamp(0, 10)
    });

    // ---------- ATTENDANCE ----------
    var staffSnap = await db.collection('staff').limit(16).get();
    staffSnap.docs.forEach(function (sd, i) {
        var s = sd.data();
        for (var d = 0; d < 5; d++) {
            var present = !(d === 2 && i % 5 === 0);
            push(db.collection('attendance').doc('rd-att-' + sd.id.slice(0, 8) + '-' + d), {
                staffId: sd.id, staffName: s.name || 'Staff', email: s.email || '',
                biometricId: s.biometricId || '', role: s.role || '',
                date: rdDate(d), status: present ? 'present' : 'absent',
                checkIn: present ? '09:0' + (d % 6) : '', checkOut: present ? '17:3' + (d % 6) : '',
                totalHours: present ? 8.5 : 0, branchId: 'main', createdAt: rdStamp(d, 9)
            });
        }
    });

    // ---------- LAB TEST CATALOGUE ----------
    [
        { id: 'thyroid_profile_t3_t4_tsh', name: 'Thyroid Profile (T3 T4 TSH)', params: [
            { name: 'T3', unit: 'ng/dL', min: 80, max: 200 },
            { name: 'T4', unit: 'ug/dL', min: 5.1, max: 14.1 },
            { name: 'TSH', unit: 'uIU/mL', min: 0.27, max: 4.2 }
        ]},
        { id: 'ogtt_pregnancy_75g', name: 'OGTT (Pregnancy 75g)', params: [
            { name: 'Fasting', unit: 'mg/dL', min: 70, max: 92 },
            { name: '1 hour', unit: 'mg/dL', min: 70, max: 180 },
            { name: '2 hour', unit: 'mg/dL', min: 70, max: 153 }
        ]},
        { id: 'iron_studies', name: 'Iron Studies', params: [
            { name: 'Serum Iron', unit: 'ug/dL', min: 50, max: 170 },
            { name: 'TIBC', unit: 'ug/dL', min: 250, max: 450 },
            { name: 'Ferritin', unit: 'ng/mL', min: 12, max: 150 }
        ]}
    ].forEach(function (t) {
        push(db.collection('labTestCatalog').doc(t.id), {
            name: t.name, parameters: t.params, active: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    await rdCommit(writes); writes = [];
    rdLog('Claims, packages, service catalogue, quality, tele-consult, attendance, lab catalogue', 'success');
}
window.seedRichSupportingDemo = seedRichSupportingDemo;

// ==========================================================
// ORCHESTRATOR
// ==========================================================
async function seedFullDemo() {
    if (!confirm('Load the RICH CLINICAL DEMO?\n\n' +
        '• 10 patients with 2-3 months of history (vitals, LMP, EDD)\n' +
        '• 10 medicines: 5 expired, 2 out of stock, 2 near expiry\n' +
        '• OPD / IPD / ICU / ER / OT, partographs, deliveries\n' +
        '• Appointments, follow-ups, prescriptions, labs, imaging\n\n' +
        'Existing demo rows with the same ids are overwritten. Continue?')) return;

    if (typeof setButtonsDisabled === 'function') setButtonsDisabled(true);
    try {
        if (typeof ensureSignedIn === 'function') await ensureSignedIn();
        if (typeof setupHospitalSettings === 'function') await setupHospitalSettings();
        if (typeof setupDepartments === 'function') await setupDepartments();
        if (typeof setupStaff === 'function') await setupStaff();
        if (typeof setupDoctors === 'function') await setupDoctors();
        if (typeof setupBeds === 'function') await setupBeds();

        var people = await seedRichClinicalDemo();
        var byStory = await seedRichOperationalDemo(people);
        await seedRichMaternityDemo(byStory);
        await seedRichSupportingDemo(people, byStory);
        await seedRichTodayBilling(people);

        rdLog('=== RICH DEMO READY — every section populated ===', 'success');
        if (typeof showCredentialsTable === 'function') showCredentialsTable();
        if (typeof showGoDashboardButton === 'function') showGoDashboardButton();
    } catch (err) {
        rdLog('Rich demo failed: ' + err.message, 'error');
        console.error(err);
    } finally {
        if (typeof setButtonsDisabled === 'function') setButtonsDisabled(false);
    }
}
window.seedFullDemo = seedFullDemo;

// ==========================================================
// PART 5 — today's billing activity
// The day-end cash-up screen is only meaningful when there is a day's
// takings on it, split across all three tills and several payment modes.
// ==========================================================
async function seedRichTodayBilling(people) {
    var writes = [];
    var push = function (ref, data) { writes.push({ ref: ref, data: data }); };
    var today = rdDate(0);
    var actor = rdActor();

    function payBlock(total, modes) {
        var details = {};
        var per = Math.round((total / modes.length) * 100) / 100;
        modes.forEach(function (m, i) {
            details[m] = { amount: i === modes.length - 1
                ? Math.round((total - per * (modes.length - 1)) * 100) / 100
                : per };
        });
        return details;
    }

    // Five OPD consultations billed today, paid across mixed modes
    people.slice(0, 5).forEach(function (person, i) {
        var modes = [['Cash'], ['PhonePe'], ['Card'], ['Cash', 'PhonePe'], ['PhonePe', 'Card']][i];
        var total = 500 + 350 + (person.p.preg ? 900 : 0);
        push(db.collection('bills').doc('rd-bill-today-opd-' + rdPad(i + 1)), {
            billId: 'SA-OPD-2026-9' + rdPad(i + 1, 4),
            patientId: person.pid, patientDocId: person.docId, patientName: person.name,
            patientPhone: person.p.phone, type: 'OPD', visitType: 'OPD',
            visitDoctor: person.doc.name, visitDepartment: person.p.dept,
            items: [
                { category: 'Consultation', description: 'Consultation - ' + person.doc.name, quantity: 1, unitPrice: 500, amount: 500 },
                { category: 'Lab Test', description: 'CBC Complete Blood Count', quantity: 1, unitPrice: 350, amount: 350 }
            ].concat(person.p.preg ? [{ category: 'Imaging', description: 'Obstetric USG - Growth Scan', quantity: 1, unitPrice: 900, amount: 900 }] : []),
            subtotal: total, grandTotal: total, amountPaid: total, balanceDue: 0,
            paymentStatus: 'paid', paymentMethods: modes, paymentDetails: payBlock(total, modes),
            billedBy: actor, createdBy: actor, branchId: 'main', createdAt: rdStamp(0, 9 + i)
        });
        push(db.collection('payments').doc('rd-pay-today-' + rdPad(i + 1)), {
            paymentId: 'PAY-RD-T' + rdPad(i + 1, 4),
            billId: 'SA-OPD-2026-9' + rdPad(i + 1, 4),
            patientId: person.pid, patientName: person.name,
            amount: total, totalPaid: total, mode: modes[0], date: today,
            recordedBy: actor, branchId: 'main', createdAt: rdStamp(0, 9 + i)
        });
    });

    // Two diagnostics-only bills today, so the Lab & Imaging till is not empty
    people.slice(5, 7).forEach(function (person, i) {
        var total = [1250, 900][i];
        var modes = [['Cash'], ['PhonePe']][i];
        push(db.collection('bills').doc('rd-bill-today-lab-' + rdPad(i + 1)), {
            billId: 'SA-LAB-2026-9' + rdPad(i + 1, 4),
            patientId: person.pid, patientDocId: person.docId, patientName: person.name,
            patientPhone: person.p.phone, type: 'OPD', visitType: 'OPD',
            visitDoctor: person.doc.name, visitDepartment: 'Diagnostics',
            items: i === 0
                ? [{ category: 'Lab Test', description: 'Thyroid Profile (T3 T4 TSH)', quantity: 1, unitPrice: 650, amount: 650 },
                   { category: 'Lab Test', description: 'OGTT (Pregnancy 75g)', quantity: 1, unitPrice: 600, amount: 600 }]
                : [{ category: 'Imaging', description: 'Obstetric USG - Growth Scan', quantity: 1, unitPrice: 900, amount: 900 }],
            subtotal: total, grandTotal: total, amountPaid: total, balanceDue: 0,
            paymentStatus: 'paid', paymentMethods: modes, paymentDetails: payBlock(total, modes),
            billedBy: actor, createdBy: actor, branchId: 'main', createdAt: rdStamp(0, 11 + i)
        });
        push(db.collection('payments').doc('rd-pay-today-lab-' + rdPad(i + 1)), {
            paymentId: 'PAY-RD-TL' + rdPad(i + 1, 4),
            billId: 'SA-LAB-2026-9' + rdPad(i + 1, 4),
            patientId: person.pid, patientName: person.name,
            amount: total, totalPaid: total, mode: modes[0], date: today,
            recordedBy: actor, branchId: 'main', createdAt: rdStamp(0, 11 + i)
        });
    });

    // A second pharmacy sale today on a different mode
    var ph = people[8];
    push(db.collection('bills').doc('rd-bill-today-ph-01'), {
        billId: 'SA-PH-2026-90001', billType: 'Pharmacy', type: 'PHARMACY',
        patientId: ph.pid, patientDocId: ph.docId, patientName: ph.name,
        items: [{ category: 'Medicine', description: 'Calcium + Vitamin D3 x30', quantity: 30, unitPrice: 7, amount: 210 }],
        subtotal: 210, grandTotal: 210, amountPaid: 210, balanceDue: 0,
        paymentStatus: 'paid', paymentMethod: 'Card', paymentMethods: ['Card'],
        paymentDetails: { Card: { amount: 210 } },
        billedBy: actor, createdBy: actor, branchId: 'main', createdAt: rdStamp(0, 16)
    });

    await rdCommit(writes);
    rdLog('Today: 5 OPD bills, 2 diagnostics bills, 1 extra pharmacy sale across Cash/PhonePe/Card', 'success');
}
window.seedRichTodayBilling = seedRichTodayBilling;
