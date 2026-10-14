checkAccess(['admin', 'doctor', 'lab_technician', 'nurse']);

var TEMPLATES = {
    obstetric: 'OBSTETRIC ULTRASOUND REPORT\n\nPatient: {{name}} ({{id}})\nGA / LMP: {{ga}}\nIndication: {{indication}}\n\nFindings:\n- Single / Multiple intrauterine gestation: \n- Fetal heart: Present / Absent — FHR ___ bpm\n- Presentation: \n- Placenta: Location ___, grade ___, no previa\n- Liquor: Adequate / Reduced / Increased — AFI ___\n- Biometry: BPD ___ HC ___ AC ___ FL ___ EFW ___\n- Estimated fetal weight percentile: \n- Cervix / os: \n\nImpression:\n- \n\nAdvice:\n- Follow-up USG as clinically indicated.\n',
    anomaly: 'ANOMALY SCAN REPORT\n\nPatient: {{name}} ({{id}})\nGA: {{ga}}\nIndication: {{indication}}\n\nSurvey:\n- Cranium / falx / choroid / cerebellum / cisterna magna: \n- Face / lips / orbits: \n- Spine: \n- Heart (4-chamber, outflow): \n- Stomach / abdominal wall / cord insertion: \n- Kidneys / bladder: \n- Limbs / digits: \n- Placenta / liquor: \n\nImpression:\n- No major structural anomaly detected on today\'s scan / Findings as above.\n',
    nt: 'NT / FIRST TRIMESTER SCAN\n\nPatient: {{name}} ({{id}})\nGA: {{ga}}\nIndication: {{indication}}\n\n- CRL: ___ mm (GA ___)\n- NT: ___ mm\n- Nasal bone: Present / Absent\n- FHR: ___ bpm\n- Ductus venosus / tricuspid (if done): \n\nImpression:\n- \nAdvice: Correlate with dual marker / NIPT as advised.\n',
    pelvis: 'PELVIC ULTRASOUND REPORT\n\nPatient: {{name}} ({{id}})\nIndication: {{indication}}\n\nUterus: Size ___, endometrium ___, myometrium ___\nOvaries: Right ___, Left ___\nAdnexa / POD: \n\nImpression:\n- \n'
};

var usgUser = null;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    usgUser = user;
    document.getElementById('usgFillBtn').onclick = fillTemplate;
    document.getElementById('usgPdfBtn').onclick = printUsg;
    document.getElementById('usgSaveBtn').onclick = saveUsg;
    mountPatientSearch({
        inputId: 'usgPatientSearch',
        resultsId: 'usgPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('usgPatientId').value = p.patientId || '';
            document.getElementById('usgPatientName').value = p.name || '';
            document.getElementById('usgPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
            fillTemplate();
        }
    });
    fillTemplate();
});

function fillTemplate() {
    var type = document.getElementById('usgType').value;
    var tpl = TEMPLATES[type] || TEMPLATES.obstetric;
    var text = tpl
        .replace(/\{\{name\}\}/g, document.getElementById('usgPatientName').value.trim() || '________')
        .replace(/\{\{id\}\}/g, document.getElementById('usgPatientId').value.trim() || '________')
        .replace(/\{\{ga\}\}/g, document.getElementById('usgGa').value.trim() || '________')
        .replace(/\{\{indication\}\}/g, document.getElementById('usgIndication').value.trim() || '________');
    document.getElementById('usgBody').value = text;
}

function printUsg() {
    getHospitalSettings(function (settings) {
        var doc = new jspdf.jsPDF();
        doc.setFontSize(13);
        doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', 105, 16, { align: 'center' });
        doc.setFontSize(10);
        var lines = doc.splitTextToSize(document.getElementById('usgBody').value || '', 180);
        doc.text(lines, 14, 28);
        doc.save('usg-report.pdf');
    });
}

function saveUsg() {
    var patientId = document.getElementById('usgPatientId').value.trim();
    if (!patientId) { showToast('Enter patient ID to save.', 'warning'); return; }
    var data = window.hmsBranch ? hmsBranch.stamp({}) : {};
    data.patientId = patientId;
    data.patientName = document.getElementById('usgPatientName').value.trim();
    data.type = 'imaging';
    data.testName = 'USG - ' + document.getElementById('usgType').selectedOptions[0].textContent;
    data.status = 'Completed';
    data.reportText = document.getElementById('usgBody').value;
    data.reportDate = todayIso();
    data.completedBy = (usgUser && (usgUser.name || usgUser.email)) || '';
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    db.collection('reports').add(data).then(function () {
        showToast('USG report saved to imaging reports.', 'success');
    }).catch(function (err) { showToast(err.message, 'error'); });
}
