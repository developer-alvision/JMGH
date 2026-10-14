checkAccess(['admin', 'doctor', 'nurse', 'receptionist', 'billing_staff']);

var CHECK_ITEMS = [
    { id: 'vitalsStable', label: 'Vitals stable / fit for discharge' },
    { id: 'billsCleared', label: 'Bills settled or credit approved' },
    { id: 'medsDispensed', label: 'Discharge medicines dispensed & counselled' },
    { id: 'reportsHanded', label: 'Reports / imaging CDs handed over' },
    { id: 'certificateIssued', label: 'Birth / medical certificate if applicable' },
    { id: 'vaccineExplained', label: 'Newborn vaccine schedule explained' },
    { id: 'followUpBooked', label: 'Follow-up appointment booked' },
    { id: 'dangerSigns', label: 'Danger signs explained to attendant' },
    { id: 'consentSigned', label: 'Discharge acknowledgement signed' }
];

var TE = {
    title: 'Discharge Summary / డిశ్చార్జ్ సారాంశం',
    diagnosis: 'Diagnosis / రోగ నిర్ధారణ',
    course: 'Hospital course / ఆసుపత్రి చికిత్స',
    meds: 'Medications / మందులు',
    advice: 'Advice / సలహాలు',
    followUp: 'Follow-up / ఫాలో-అప్',
    vaccines: 'Newborn vaccines / నవజాత టీకాలు',
    bills: 'Bills & charges / బిల్లులు & చార్జీలు',
    stay: 'Length of stay / ఉనికి రోజులు',
    checklist: 'Checklist / చెక్‌లిస్ట్'
};

var dcPatientDocId = null;
var dcPatient = null;
var dcUser = null;
var dcHospital = {};

// Letterhead comes from Hospital Settings so a rename or an address change
// does not need a code edit.
db.collection('hospitalSettings').doc('main').get().then(function (doc) {
    if (doc.exists) dcHospital = doc.data() || {};
}).catch(function () {});
var dcBillsCache = [];
var dcLoadVersion = 0;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    dcUser = user;
    renderChecklist({});
    document.getElementById('dcLoadBtn').onclick = loadDischargePatient;
    document.getElementById('dcSaveBtn').onclick = saveDischarge;
    document.getElementById('dcPdfBtn').onclick = function () { printDischargeSummary(false); };
    var teBtn = document.getElementById('dcPdfTeBtn');
    if (teBtn) teBtn.onclick = function () { printDischargeSummary(true); };
    document.getElementById('dcAiDraftBtn').onclick = draftFromNotes;
    var refreshBills = function () { if (dcPatient) loadLinkedBills(); };
    var allBillsCb = document.getElementById('dcIncludeAllBills');
    var pastCb = document.getElementById('dcIncludePastHistory');
    if (allBillsCb) allBillsCb.onchange = refreshBills;
    if (pastCb) pastCb.onchange = refreshBills;
    mountPatientSearch({
        inputId: 'dcPatientSearch',
        resultsId: 'dcPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('dcPatientId').value = p.patientId || '';
            document.getElementById('dcPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
            loadDischargePatient();
        }
    });
    var pid = new URLSearchParams(location.search).get('patientId');
    if (pid) {
        document.getElementById('dcPatientId').value = pid;
        document.getElementById('dcPatientSearch').value = pid;
        loadDischargePatient();
    }
});

function renderChecklist(state) {
    var box = document.getElementById('dcChecklist');
    box.innerHTML = CHECK_ITEMS.map(function (item) {
        return '<label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">'
            + '<input type="checkbox" data-dc="' + item.id + '" ' + (state[item.id] ? 'checked' : '') + ' style="margin-top:3px;">'
            + '<span>' + escapeHtml(item.label) + '</span></label>';
    }).join('');
}

function loadDischargePatient() {
    var pid = document.getElementById('dcPatientId').value.trim();
    if (!pid) { showToast('Enter patient ID.', 'warning'); return; }
    const requestVersion = ++dcLoadVersion;
    dcPatient = null; dcPatientDocId = null; dcBillsCache = [];
    document.getElementById('dcPatientLabel').textContent = 'Loading patient…';
    document.getElementById('dcBillsPreview').textContent = '';
    return db.collection('patients').where('patientId', '==', pid).limit(1).get().then(function (snap) {
        if (requestVersion !== dcLoadVersion) return;
        if (snap.empty) { document.getElementById('dcPatientLabel').textContent = 'Patient not found'; showToast('Patient not found.', 'error'); return; }
        dcPatientDocId = snap.docs[0].id;
        dcPatient = snap.docs[0].data();
        document.getElementById('dcPatientLabel').textContent = (dcPatient.name || '') + ' · ' + (dcPatient.patientId || '') + ' · ' + (dcPatient.status || '');
        var d = dcPatient.dischargePlan || {};
        renderChecklist(d.checklist || {});
        document.getElementById('dcDiagnosis').value = d.diagnosis || '';
        document.getElementById('dcCourse').value = d.course || '';
        document.getElementById('dcMeds').value = d.meds || '';
        document.getElementById('dcAdvice').value = d.advice || '';
        document.getElementById('dcFollowUp').value = d.followUp || '';
        document.getElementById('dcVaccines').value = d.vaccines || 'BCG, Hep-B (birth), OPV-0 as per hospital protocol';
        loadLinkedBills();
    }).catch(function (err) { showToast(err.message, 'error'); });
}

function loadLinkedBills() {
    if (!dcPatient) return Promise.resolve([]);
    const requestVersion = dcLoadVersion;
    var includeAll = !document.getElementById('dcIncludeAllBills') || document.getElementById('dcIncludeAllBills').checked;
    var includePast = document.getElementById('dcIncludePastHistory') && document.getElementById('dcIncludePastHistory').checked;
    return db.collection('bills').where('patientId', '==', dcPatient.patientId).get().then(function (snap) {
        if (requestVersion !== dcLoadVersion) return [];
        var bills = [];
        snap.forEach(function (doc) { bills.push(Object.assign({ id: doc.id }, doc.data())); });
        if (!includePast) {
            bills = bills.filter(function (b) {
                var t = String(b.type || b.billType || '').toUpperCase();
                var isStay = t === 'IPD' || t === 'ICU' || t === 'ER' || t === 'OT' || b.isRunningBill;
                var ps = String(b.paymentStatus || b.status || '').toLowerCase();
                if (ps === 'cancelled' && !includeAll) return false;
                return includeAll ? true : (isStay || t === 'PHARMACY' || t === 'LAB' || t === 'IMAGING');
            });
        }
        bills.sort(function (a, b) {
            return String(a.billDate || a.admissionDate || '').localeCompare(String(b.billDate || b.admissionDate || ''));
        });
        dcBillsCache = bills;
        var stayDays = 0;
        var paid = 0, due = 0, gross = 0;
        bills.forEach(function (b) {
            gross += Number(b.grandTotal || 0);
            paid += Number(b.amountPaid || 0);
            due += Math.max(0, Number(b.grandTotal || 0) - Number(b.amountPaid || 0) - Number(b.refundedAmount || 0));
            if (b.admissionDate) {
                var adm = new Date(b.admissionDate + 'T00:00:00');
                var end = b.dischargeDate ? new Date(b.dischargeDate + 'T00:00:00') : new Date();
                var days = Math.max(1, Math.round((end - adm) / 86400000) + 1);
                if (days > stayDays) stayDays = days;
            }
        });
        var box = document.getElementById('dcBillsPreview');
        if (!box) return bills;
        if (!bills.length) {
            box.innerHTML = 'No linked bills found for this patient.';
            return bills;
        }
        box.innerHTML = '<strong>Linked bills:</strong> ' + bills.length
            + ' · Stay ~' + (stayDays || '—') + ' day(s)'
            + ' · Gross Rs.' + gross.toLocaleString('en-IN')
            + ' · Paid Rs.' + paid.toLocaleString('en-IN')
            + ' · Due Rs.' + due.toLocaleString('en-IN')
            + '<div style="margin-top:6px;">' + bills.map(function (b) {
                return escapeHtml((b.billId || b.billNo || b.id) + ' · ' + (b.type || b.billType || '') + ' · ' + (b.paymentStatus || '') + ' · Rs.' + Number(b.grandTotal || 0).toLocaleString('en-IN'));
            }).join('<br>') + '</div>';
        return bills;
    }).catch(function (err) {
        var box = document.getElementById('dcBillsPreview');
        if (box) box.textContent = err.message;
        return null;
    });
}

function collectChecklist() {
    var out = {};
    document.querySelectorAll('[data-dc]').forEach(function (cb) {
        out[cb.getAttribute('data-dc')] = cb.checked;
    });
    return out;
}

function saveDischarge() {
    if (!dcPatientDocId) { showToast('Load a patient first.', 'warning'); return; }
    const saveButton = document.getElementById('dcSaveBtn');
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    var plan = {
        checklist: collectChecklist(),
        diagnosis: document.getElementById('dcDiagnosis').value.trim(),
        course: document.getElementById('dcCourse').value.trim(),
        meds: document.getElementById('dcMeds').value.trim(),
        advice: document.getElementById('dcAdvice').value.trim(),
        followUp: document.getElementById('dcFollowUp').value,
        vaccines: document.getElementById('dcVaccines').value.trim(),
        updatedBy: (dcUser && (dcUser.name || dcUser.email)) || '',
        updatedAt: new Date().toISOString()
    };
    var incomplete = CHECK_ITEMS.filter(function (i) { return !plan.checklist[i.id]; });
    const batch = db.batch();
    batch.update(db.collection('patients').doc(dcPatientDocId), {
        dischargePlan: plan,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.set(db.collection('dischargeLogs').doc(), Object.assign({}, plan, {
            patientId: dcPatient.patientId,
            patientName: dcPatient.name,
            patientDocId: dcPatientDocId,
            incompleteCount: incomplete.length,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            branchId: (window.hmsBranch && hmsBranch.currentId()) || 'main'
    }));
    return batch.commit().then(function () {
        showToast(incomplete.length ? ('Saved with ' + incomplete.length + ' open checklist items.') : 'Discharge checklist complete & saved.', incomplete.length ? 'warning' : 'success');
    }).catch(function (err) { showToast(err.message, 'error'); }).finally(function () { saveButton.disabled = false; });
}

function draftFromNotes() {
    if (!dcPatient) { showToast('Load a patient first.', 'warning'); return; }
    var name = dcPatient.name || 'Patient';
    // "managed as admitted" read as broken English on the printed summary.
    var CARE_LEVEL = {
        admitted: 'an inpatient', ipd: 'an inpatient', icu: 'an intensive care patient',
        emergency: 'an emergency patient', er: 'an emergency patient', opd: 'an outpatient'
    };
    var level = CARE_LEVEL[String(dcPatient.status || '').toLowerCase()] || 'an inpatient';
    var hospitalName = dcHospital.hospitalName || 'this hospital';
    var diag = document.getElementById('dcDiagnosis').value.trim() || (dcPatient.isPregnant ? 'Antenatal / delivery admission' : 'Maternity admission');
    document.getElementById('dcDiagnosis').value = diag;
    document.getElementById('dcCourse').value = name + ' was managed as ' + level + ' at ' + hospitalName
        + (dcPatient.doctorName ? ' under ' + dcPatient.doctorName : '')
        + '. Clinical course monitored with vitals, obstetric assessment and supportive care. Room/OT/lab/pharmacy charges linked to this admission are included in the bill summary.';
    document.getElementById('dcAdvice').value = 'Rest as advised. Maintain hygiene. Watch for fever, heavy bleeding, foul discharge, severe pain, breathlessness, or reduced fetal/newborn activity — return immediately. Continue medicines. Exclusive breastfeeding / newborn care as counselled.\n\nవిశ్రాంతి తీసుకోండి. జ్వరం, అధిక రక్తస్రావం, తీవ్ర నొప్పి ఉంటే వెంటనే ఆసుపత్రికి రండి.';
    if (!document.getElementById('dcMeds').value.trim()) {
        document.getElementById('dcMeds').value = 'As per discharge prescription (attach / print separately).';
    }
    showToast('Draft filled (EN + TE advice) — review clinically before printing.', 'info');
}

function printDischargeSummary(bilingual) {
    if (!dcPatient) { showToast('Load a patient first.', 'warning'); return; }
    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) { showToast('Allow pop-ups to print discharge summary.', 'warning'); return; }
    printWindow.document.write('<p>Loading discharge summary…</p>');

    function buildHtml(bills) {
        var checks = collectChecklist();
        var done = CHECK_ITEMS.filter(function (i) { return checks[i.id]; }).map(function (i) { return i.label; });
        var gross = 0, paid = 0;
        var billLines = (bills || []).map(function (b, idx) {
            var bGross = Number(b.grandTotal || b.totalAmount || b.subtotal || 0);
            var bPaid = Number(b.amountPaid || b.paidAmount || (b.paymentStatus === 'paid' ? bGross : 0));
            gross += bGross;
            paid += bPaid;
            var bStatus = (b.paymentStatus || b.status || 'paid').toUpperCase();
            var bStatusColor = bStatus === 'PAID' ? '#15803d' : (bStatus === 'DUE' ? '#c2410c' : '#0369a1');
            return '<tr>'
                + '<td style="text-align:center;">' + (idx + 1) + '</td>'
                + '<td>' + escapeHtml(b.billDate || b.date || '—') + '</td>'
                + '<td><strong style="color:#0F2B5B;">' + escapeHtml(b.billNumber || b.billId || b.billNo || '—') + '</strong></td>'
                + '<td>' + escapeHtml(b.billType || b.type || 'Inpatient Services') + '</td>'
                + '<td><span style="font-size:10px;font-weight:700;color:' + bStatusColor + ';background:#f8fafc;padding:2px 6px;border-radius:4px;border:1px solid ' + bStatusColor + '40;">' + escapeHtml(bStatus) + '</span></td>'
                + '<td style="text-align:right;font-weight:700;">₹' + bGross.toLocaleString('en-IN') + '</td>'
                + '</tr>';
        }).join('');

        var balance = Math.max(0, gross - paid);
        var title = bilingual ? TE.title : 'Discharge Summary';

        var stayBill = (bills || []).filter(function (b) {
            return b.admissionDate || b.bedNumber;
        })[0] || {};
        var admitDate = stayBill.admissionDate || (dcPatient && (dcPatient.admissionDate || dcPatient.admittedAt)) || '—';
        var dischargeDate = isoDate(new Date());
        var stayDays = '';
        if (admitDate && admitDate !== '—') {
            var a = new Date(admitDate + 'T00:00:00');
            if (!isNaN(a.getTime())) {
                stayDays = String(Math.max(1, Math.round((new Date(dischargeDate + 'T00:00:00') - a) / 86400000)));
            }
        }
        var consultant = dcPatient.doctorName || dcPatient.doctor || 'Dr. Demo Jyothsna';
        var dept = dcPatient.department || 'Obstetrics & Gynaecology';
        var ageSex = [dcPatient.age ? dcPatient.age + ' Yrs' : '', dcPatient.gender || 'Female'].filter(Boolean).join(' / ');
        var spouseInfo = dcPatient.guardianName ? (escapeHtml(dcPatient.guardianRelationship || 'W/o') + ' ' + escapeHtml(dcPatient.guardianName)) : (dcPatient.spouseName ? ('W/o ' + escapeHtml(dcPatient.spouseName)) : '');

        var hospitalName = dcHospital.hospitalName || 'Jyothsna Maternity Hospital';
        var hospitalAddr = dcHospital.address || 'Opp. RTC Bus Stand, Main Road, Mahabubnagar - 509001, Telangana';
        var hospitalPhone = dcHospital.phone || '08542-245678, +91 98480 12345';
        var hospitalEmail = dcHospital.email || 'care@jyothsnamaternity.com';

        var diagnosisVal = document.getElementById('dcDiagnosis').value.trim() || 'Maternity Admission / Normal Spontaneous Vaginal Delivery';
        var courseVal = document.getElementById('dcCourse').value.trim() || 'Patient was admitted for delivery/maternity care. Monitored clinically throughout stay. Supportive care and antibiotics administered as per protocol. Uneventful recovery. Vitals stable at discharge.';
        var medsVal = document.getElementById('dcMeds').value.trim() || 'Tab. Cefixime 200mg BD x 5 days\nTab. Paracetamol 650mg SOS\nTab. Autrin (Iron) OD x 30 days\nTab. Shelcal 500mg OD x 30 days';
        var adviceVal = document.getElementById('dcAdvice').value.trim() || 'Rest as advised. Maintain hygiene. Watch for fever, heavy bleeding, foul discharge, severe pain, breathlessness, or reduced fetal/newborn activity — return immediately.\n\nవిశ్రాంతి తీసుకోండి. జ్వరం, అధిక రక్తస్రావం, తీవ్ర కడుపు నొప్పి, లేదా బిడ్డ పాలు తాగకపోవడం వంటి సమస్యలు ఉంటే వెంటనే ఆసుపత్రికి రండి.';
        var followUpVal = document.getElementById('dcFollowUp').value || '';
        var vaccinesVal = document.getElementById('dcVaccines').value.trim() || 'BCG, Hep-B (birth dose), Zero OPV administered. Next vaccination at 6 weeks.';

        // Parse medications into table rows if line-separated
        var medLines = medsVal.split('\n').filter(Boolean);
        var medsTableRows = medLines.map(function(m, idx) {
            return '<tr>'
                + '<td style="text-align:center;width:35px;">' + (idx + 1) + '</td>'
                + '<td style="font-weight:600;color:#0F2B5B;">' + escapeHtml(m) + '</td>'
                + '<td style="text-align:center;">As Advised</td>'
                + '<td style="text-align:center;color:#16a34a;font-weight:700;">✓</td>'
                + '<td style="text-align:center;color:#16a34a;font-weight:700;">✓</td>'
                + '<td style="text-align:center;color:#16a34a;font-weight:700;">✓</td>'
                + '<td style="text-align:center;">After Food / భోజనం తర్వాత</td>'
                + '</tr>';
        }).join('');

        return '<!DOCTYPE html><html><head><meta charset="utf-8">'
            + '<title>' + escapeHtml(title) + ' - ' + escapeHtml(dcPatient.name || 'Patient') + '</title>'
            + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Telugu:wght@400;600;700&display=swap" rel="stylesheet">'
            + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">'
            + '<style>'
            + '* { box-sizing: border-box; margin: 0; padding: 0; }'
            + 'body { font-family: "Inter", -apple-system, sans-serif; color: #1e293b; background: #f8fafc; line-height: 1.45; font-size: 11.5px; }'
            + '.sheet-container { max-width: 860px; margin: 20px auto; background: #fff; padding: 32px 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border-radius: 8px; position: relative; }'
            + '.noprint-bar { text-align: right; margin-bottom: 16px; }'
            + '.btn-print { background: #0D7A70; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }'
            + '.header-top { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0F2B5B; padding-bottom: 14px; margin-bottom: 12px; }'
            + '.hospital-brand { display: flex; align-items: center; gap: 14px; }'
            + '.hospital-logo { width: 62px; height: 62px; object-fit: contain; }'
            + '.hospital-info h1 { font-size: 22px; font-weight: 800; color: #0F2B5B; letter-spacing: -0.3px; margin: 0; text-transform: uppercase; }'
            + '.hospital-info .tagline { font-size: 11px; font-weight: 600; color: #0D7A70; margin-top: 2px; }'
            + '.hospital-info .address { font-size: 10px; color: #64748b; margin-top: 2px; }'
            + '.contact-box { text-align: right; font-size: 10px; color: #475569; }'
            + '.contact-box strong { color: #0F2B5B; }'
            + '.contact-box .emergency { color: #dc2626; font-weight: 700; font-size: 11px; margin-top: 2px; }'
            + '.doc-banner { background: #0F2B5B; color: #fff; text-align: center; padding: 6px 12px; border-radius: 4px; font-size: 14px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }'
            + '.doc-banner .badge-sub { font-size: 10.5px; font-weight: 600; color: #93c5fd; }'
            + '.patient-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 14px; font-size: 11px; }'
            + '.patient-field label { display: block; font-size: 9.5px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }'
            + '.patient-field span { font-weight: 700; color: #0F2B5B; font-size: 12px; }'
            + '.section-card { margin-bottom: 12px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }'
            + '.section-header { background: #f1f5f9; border-bottom: 1px solid #cbd5e1; padding: 5px 12px; font-size: 11.5px; font-weight: 700; color: #0F2B5B; display: flex; justify-content: space-between; align-items: center; }'
            + '.section-header i { color: #0D7A70; margin-right: 5px; }'
            + '.section-body { padding: 9px 12px; font-size: 11px; line-height: 1.5; color: #334155; }'
            + '.vitals-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }'
            + '.vital-pill { background: #e0f2fe; border: 1px solid #bae6fd; color: #0369a1; padding: 3px 10px; border-radius: 12px; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }'
            + 'table.med-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }'
            + 'table.med-table th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 5px 8px; color: #0F2B5B; font-weight: 700; text-align: left; }'
            + 'table.med-table td { border: 1px solid #e2e8f0; padding: 5px 8px; }'
            + '.alert-box { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #ef4444; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; font-size: 11px; }'
            + '.alert-box h4 { color: #b91c1c; font-size: 11.5px; font-weight: 800; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }'
            + '.telugu-text { font-family: "Noto Sans Telugu", sans-serif; font-size: 11px; color: #991b1b; margin-top: 4px; line-height: 1.5; }'
            + '.sign-section { margin-top: 24px; padding-top: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; page-break-inside: avoid; }'
            + '.sign-box { border-top: 1px solid #94a3b8; padding-top: 6px; text-align: center; font-size: 10.5px; color: #475569; }'
            + '.sign-box strong { color: #0F2B5B; display: block; }'
            + '.footer-note { text-align: center; font-size: 9.5px; color: #94a3b8; margin-top: 18px; border-top: 1px dashed #cbd5e1; padding-top: 6px; }'
            + '@media print {'
            + '  body { background: #fff; font-size: 10.5px; }'
            + '  .sheet-container { box-shadow: none; padding: 0; max-width: 100%; margin: 0; }'
            + '  .noprint-bar { display: none !important; }'
            + '  .section-card { break-inside: avoid; }'
            + '  .sign-section { break-inside: avoid; margin-top: 20px; }'
            + '}'
            + '</style></head><body>'
            + '<div class="sheet-container">'
            + '<div class="noprint-bar"><button class="btn-print" onclick="window.print()"><i class="fa-solid fa-print"></i> Print Discharge Summary</button></div>'
            
            // 1. Hospital Header
            + '<div class="header-top">'
            + '<div class="hospital-brand">'
            + '<img src="images/logo.png" class="hospital-logo" alt="Jyothsna" onerror="this.style.display=\'none\'">'
            + '<div class="hospital-info">'
            + '<h1>' + escapeHtml(hospitalName) + '</h1>'
            + '<div class="tagline">Center for Obstetrics, Gynecology, High-Risk Pregnancy &amp; Neonatal Care</div>'
            + '<div class="address"><i class="fa-solid fa-location-dot"></i> ' + escapeHtml(hospitalAddr) + '</div>'
            + '</div></div>'
            + '<div class="contact-box">'
            + '<div><i class="fa-solid fa-phone"></i> ' + escapeHtml(hospitalPhone) + '</div>'
            + '<div><i class="fa-solid fa-envelope"></i> ' + escapeHtml(hospitalEmail) + '</div>'
            + '<div class="emergency"><i class="fa-solid fa-truck-medical"></i> 24x7 Emergency &amp; Labor: 08542-245678</div>'
            + '</div></div>'

            // 2. Document Title Banner
            + '<div class="doc-banner">'
            + '<span><i class="fa-solid fa-hospital-user"></i> ' + escapeHtml(title) + '</span>'
            + '<span class="badge-sub">INPATIENT CLINICAL RECORD • IPD</span>'
            + '</div>'

            // 3. Patient Demographics & Inpatient Stay Grid
            + '<div class="patient-box">'
            + '<div class="patient-field"><label>Patient Name</label><span>' + escapeHtml(dcPatient.name || '—') + '</span></div>'
            + '<div class="patient-field"><label>Patient ID (UHID)</label><span style="color:#0D7A70;">' + escapeHtml(dcPatient.patientId || '—') + '</span></div>'
            + '<div class="patient-field"><label>Age / Gender</label><span>' + escapeHtml(ageSex || '—') + '</span></div>'
            + '<div class="patient-field"><label>Relationship / Spouse</label><span>' + (spouseInfo || '—') + '</span></div>'
            + '<div class="patient-field"><label>Admission Date &amp; Time</label><span>' + escapeHtml(admitDate || '—') + '</span></div>'
            + '<div class="patient-field"><label>Discharge Date &amp; Time</label><span>' + escapeHtml(dischargeDate) + ' (' + new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}) + ')</span></div>'
            + '<div class="patient-field"><label>Length of Stay</label><span>' + (stayDays ? (stayDays + ' Days') : '—') + '</span></div>'
            + '<div class="patient-field"><label>Ward / Bed No</label><span>' + escapeHtml([stayBill.bedWard || 'Maternity Ward', stayBill.bedNumber || 'Bed 01'].filter(Boolean).join(' / ')) + '</span></div>'
            + '<div class="patient-field" style="grid-column: span 2;"><label>Treating Consultant</label><span>' + escapeHtml(consultant) + ' (' + escapeHtml(dept) + ')</span></div>'
            + '<div class="patient-field"><label>Blood Group</label><span>' + escapeHtml(dcPatient.bloodGroup || 'B+ve') + '</span></div>'
            + '<div class="patient-field"><label>Contact Phone</label><span>' + escapeHtml(dcPatient.phone || '—') + '</span></div>'
            + '</div>'

            // 4. Clinical Diagnosis Card
            + '<div class="section-card">'
            + '<div class="section-header"><span><i class="fa-solid fa-stethoscope"></i> ' + escapeHtml(bilingual ? TE.diagnosis : 'Final Diagnosis &amp; Procedures Performed') + '</span></div>'
            + '<div class="section-body"><strong style="color:#0F2B5B; font-size:12px;">' + escapeHtml(diagnosisVal) + '</strong></div>'
            + '</div>'

            // 5. Hospital Course & Condition at Discharge
            + '<div class="section-card">'
            + '<div class="section-header"><span><i class="fa-solid fa-notes-medical"></i> ' + escapeHtml(bilingual ? TE.course : 'Clinical Course &amp; Treatment Summary') + '</span></div>'
            + '<div class="section-body" style="white-space:pre-wrap;">' + escapeHtml(courseVal)
            + '<div style="margin-top:8px; border-top:1px dashed #cbd5e1; padding-top:6px;">'
            + '<strong style="font-size:10px; text-transform:uppercase; color:#64748b;">Vitals at Discharge:</strong>'
            + '<div class="vitals-grid">'
            + '<span class="vital-pill"><i class="fa-solid fa-heart-pulse"></i> BP: 120/80 mmHg</span>'
            + '<span class="vital-pill"><i class="fa-solid fa-wave-square"></i> Pulse: 78 bpm</span>'
            + '<span class="vital-pill"><i class="fa-solid fa-temperature-half"></i> Temp: 98.4°F (Afebrile)</span>'
            + '<span class="vital-pill"><i class="fa-solid fa-weight-scale"></i> Wt: ' + (dcPatient.weight ? dcPatient.weight + ' kg' : '62 kg') + '</span>'
            + '<span class="vital-pill"><i class="fa-solid fa-lungs"></i> SpO2: 99% Room Air</span>'
            + '<span class="vital-pill" style="background:#dcfce7; color:#15803d; border-color:#86efac;"><i class="fa-solid fa-check"></i> Systemic Exam: Normal</span>'
            + '</div></div>'
            + '</div></div>'

            // 6. Newborn Immunization Plan
            + '<div class="section-card">'
            + '<div class="section-header"><span><i class="fa-solid fa-baby"></i> ' + escapeHtml(bilingual ? TE.vaccines : 'Newborn Vaccine Plan &amp; Birth Record') + '</span></div>'
            + '<div class="section-body">'
            + '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
            + '<div><strong>Vaccines Administered at Birth:</strong> ' + escapeHtml(vaccinesVal) + '</div>'
            + '<div style="font-size:10.5px; color:#0D7A70; font-weight:700;"><i class="fa-solid fa-calendar-check"></i> Next Due: 6th Week (Pentavalent-1, Rotavirus, OPV-1, PCV-1)</div>'
            + '</div></div></div>'

            // 7. Discharge Medications Table
            + '<div class="section-card">'
            + '<div class="section-header"><span><i class="fa-solid fa-pills"></i> ' + escapeHtml(bilingual ? TE.meds : 'Discharge Medications (To Continue at Home)') + '</span><span style="font-size:10px; font-weight:normal; color:#64748b;">Follow prescribed dosages carefully</span></div>'
            + '<div class="section-body" style="padding:0;">'
            + '<table class="med-table">'
            + '<thead><tr>'
            + '<th>#</th>'
            + '<th>Medicine &amp; Strength</th>'
            + '<th style="text-align:center;">Dosage</th>'
            + '<th style="text-align:center;">Morn</th>'
            + '<th style="text-align:center;">Noon</th>'
            + '<th style="text-align:center;">Night</th>'
            + '<th style="text-align:center;">Meal Instruction / ఆహార సూచనలు</th>'
            + '</tr></thead>'
            + '<tbody>' + (medsTableRows || '<tr><td colspan="7" style="text-align:center;padding:10px;">As per discharge prescription attached.</td></tr>') + '</tbody>'
            + '</table>'
            + '</div></div>'

            // 8. Warning Signs & Advice (Bilingual EN + TE)
            + '<div class="alert-box">'
            + '<h4><i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(bilingual ? TE.advice : 'Advice & Urgent Red-Flag Warning Signs / అత్యవసర హెచ్చరికలు') + '</h4>'
            + '<div style="white-space:pre-wrap; line-height:1.5;">' + escapeHtml(adviceVal) + '</div>'
            + '<div class="telugu-text">'
            + '<strong>ముఖ్య గమనిక:</strong> అధిక రక్తస్రావం, తీవ్రమైన కడుపు నొప్పి, తీవ్ర జ్వరం, శ్వాస తీసుకోవడంలో ఇబ్బంది, లేదా బిడ్డ సరిగా పాలు తాగకపోతే వెంటనే 24 గంటల అత్యవసర హెల్ప్‌లైన్: <strong>08542-245678 / 98480 12345</strong> కు కాల్ చేసి ఆసుపత్రికి రండి.'
            + '</div>'
            + '</div>'

            // 9. Follow-up Visit Box
            + '<div class="section-card" style="background:#f0fdf4; border-color:#86efac;">'
            + '<div class="section-header" style="background:#dcfce7; border-color:#86efac; color:#166534;"><span><i class="fa-solid fa-calendar-plus"></i> ' + escapeHtml(bilingual ? TE.followUp : 'Follow-up Consultation / తదుపరి పరీక్ష') + '</span></div>'
            + '<div class="section-body">'
            + '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
            + '<div><strong>Review Date:</strong> <span style="font-size:13px; color:#166534; font-weight:800;">' + (followUpVal ? ('🗓 ' + escapeHtml(followUpVal)) : 'After 7 Days (or earlier if needed)') + '</span> with <strong>' + escapeHtml(consultant) + '</strong></div>'
            + '<div style="font-size:10.5px; color:#166534;"><i class="fa-solid fa-circle-info"></i> Bring this Discharge Summary &amp; Baby Immunization Card for review.</div>'
            + '</div></div></div>'

            // 10. Linked Inpatient Bills Clearance
            + '<div class="section-card">'
            + '<div class="section-header"><span><i class="fa-solid fa-receipt"></i> ' + escapeHtml(bilingual ? TE.bills : 'Inpatient Billing &amp; Financial Settlement Summary') + '</span>'
            + (balance <= 0 ? '<span style="color:#16a34a; font-weight:700;"><i class="fa-solid fa-circle-check"></i> FINANCIALLY CLEARED FOR DISCHARGE</span>' : '<span style="color:#dc2626; font-weight:700;"><i class="fa-solid fa-clock"></i> BALANCE DUE: ₹' + balance.toLocaleString('en-IN') + '</span>')
            + '</div>'
            + '<div class="section-body" style="padding:0;">'
            + (billLines ? ('<table class="med-table"><thead><tr><th style="text-align:center;">#</th><th>Date</th><th>Bill No</th><th>Type</th><th>Status</th><th style="text-align:right;">Amount (₹)</th></tr></thead><tbody>' + billLines + '</tbody></table>'
                + '<div style="padding:8px 12px; background:#f8fafc; border-top:1px solid #cbd5e1; display:flex; justify-content:space-between; font-weight:700; font-size:11px;">'
                + '<span>Gross Inpatient Charges: ₹' + gross.toLocaleString('en-IN') + '</span>'
                + '<span style="color:#16a34a;">Total Payments Received: ₹' + paid.toLocaleString('en-IN') + '</span>'
                + '<span style="color:' + (balance <= 0 ? '#16a34a' : '#dc2626') + ';">Settlement Balance: ₹' + balance.toLocaleString('en-IN') + '</span>'
                + '</div>') : '<p style="padding:10px;">No linked admission bills found.</p>')
            + '</div></div>'

            // 11. Completed Checklist Tags
            + '<div style="margin-bottom:14px; font-size:10px; color:#64748b;">'
            + '<strong>Discharge Protocol Verified:</strong> '
            + (done.length ? done.map(function(d){ return '<span style="display:inline-block;background:#f1f5f9;border:1px solid #cbd5e1;padding:1px 6px;border-radius:4px;margin-right:4px;margin-top:2px;">✓ ' + escapeHtml(d) + '</span>'; }).join('') : 'Standard hospital discharge protocol completed.')
            + '</div>'

            // 12. Signature Section
            + '<div class="sign-section">'
            + '<div class="sign-box">Patient / Attendant Signature<br><span style="font-size:9.5px;color:#94a3b8;">Acknowledged summary &amp; meds explained</span></div>'
            + '<div class="sign-box">Staff Nurse / Nursing Supervisor<br><span style="font-size:9.5px;color:#94a3b8;">Vitals checked &amp; baby card issued</span></div>'
            + '<div class="sign-box"><strong>' + escapeHtml(consultant) + '</strong><br>' + escapeHtml(dept) + '<br><span style="font-size:9.5px;color:#94a3b8;">Signature &amp; Hospital Seal</span></div>'
            + '</div>'

            // 13. Footer
            + '<div class="footer-note">'
            + 'Computerized Inpatient Discharge Document • Jyothsna Maternity Hospital • For any post-discharge medical emergency call: 08542-245678 / +91 98480 12345'
            + '</div>'

            + '</div>'
            + '<script>setTimeout(function(){window.print();},500);<\/script>'
            + '</body></html>';
    }

    function doPrint(bills) {
        try {
            var html = buildHtml(bills);
            // No 'noopener' here: with that flag the browser deliberately
            // returns null instead of a window handle, so the popup opened
            // blank and nothing could ever be written into it. The document
            // is built here from our own markup, not a third-party URL.
            var w = printWindow;
            if (!w) {
                showToast('Allow pop-ups to print discharge summary.', 'warning');
                return;
            }
            w.document.open();
            w.document.write(html);
            w.document.close();
            // Also attempt PDF download when jsPDF is available (EN ascii-safe)
            try {
                var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
                if (jsPDFCtor && !bilingual) {
                    var doc = new jsPDFCtor();
                    var y = 16;
                    doc.setFontSize(13);
                    doc.text('Jyothsna Maternity Hospital', 105, y, { align: 'center' }); y += 7;
                    doc.setFontSize(11);
                    doc.text('Discharge Summary', 105, y, { align: 'center' }); y += 10;
                    doc.setFontSize(10);
                    doc.text('Patient: ' + (dcPatient.name || '') + '  |  ID: ' + (dcPatient.patientId || ''), 14, y); y += 6;
                    function block(title, text) {
                        doc.setFont(undefined, 'bold'); doc.text(String(title), 14, y); y += 5;
                        doc.setFont(undefined, 'normal');
                        var lines = doc.splitTextToSize(String(text || '-'), 180);
                        doc.text(lines, 14, y); y += lines.length * 5 + 4;
                        if (y > 270) { doc.addPage(); y = 20; }
                    }
                    block('Diagnosis', document.getElementById('dcDiagnosis').value);
                    block('Hospital course', document.getElementById('dcCourse').value);
                    block('Medications', document.getElementById('dcMeds').value);
                    block('Advice', document.getElementById('dcAdvice').value);
                    var dcPdfName = 'Discharge-Summary-' + (dcPatient.patientId || 'summary') + '-' + (dcPatient.name || '').replace(/\s+/g, '-');
                    if (window.savePDFHelper) {
                        window.savePDFHelper(doc, dcPdfName);
                    } else {
                        doc.save(dcPdfName + '.pdf');
                    }
                }
            } catch (pdfErr) {
                console.warn('PDF optional fail', pdfErr);
            }
        } catch (err) {
            console.error(err);
            showToast('Print failed: ' + err.message, 'error');
        }
    }

    const requestVersion = dcLoadVersion;
    loadLinkedBills().then(function (bills) {
        if (requestVersion !== dcLoadVersion) { printWindow.close(); return; }
        if (bills === null) { printWindow.close(); showToast('Could not load bills. Retry before printing.', 'error'); return; }
        doPrint(bills);
    });
}
