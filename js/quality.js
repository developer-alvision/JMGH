checkAccess(['admin', 'doctor', 'nurse', 'owner']);

var AUDIT_ITEMS = [
    'Hand hygiene compliance observed',
    'Emergency trolley checked',
    'Labour room instruments sterile / autoclave log OK',
    'Crash cart seals intact',
    'Biomedical waste segregation correct',
    'Consent forms stocked at nursing station',
    'High-risk patient board updated',
    'Fire exit / oxygen cylinders checked',
    'Patient identification bands verified',
    'Infection control checklist signed'
];

var qUser = null;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    qUser = user;
    document.querySelectorAll('[data-qtab]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('[data-qtab]').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            ['incidents', 'consents', 'audits'].forEach(function (id) {
                document.getElementById('qtab-' + id).style.display = btn.getAttribute('data-qtab') === id ? 'block' : 'none';
            });
        });
    });
    document.getElementById('qiAdd').onclick = function () {
        document.getElementById('qiForm').reset();
        document.getElementById('qiPatientSearch').value = '';
        document.getElementById('qiModal').classList.add('active');
    };
    document.getElementById('qcAdd').onclick = function () {
        document.getElementById('qcForm').reset();
        document.getElementById('qcPatientSearch').value = '';
        document.getElementById('qcModal').classList.add('active');
    };
    document.getElementById('qiForm').onsubmit = saveIncident;
    document.getElementById('qcForm').onsubmit = saveConsent;
    document.getElementById('qaSave').onclick = saveAudit;
    mountPatientSearch({
        inputId: 'qiPatientSearch',
        resultsId: 'qiPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('qiPatientId').value = p.patientId || '';
            document.getElementById('qiPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
        }
    });
    mountPatientSearch({
        inputId: 'qcPatientSearch',
        resultsId: 'qcPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('qcPatientId').value = p.patientId || '';
            document.getElementById('qcPatientName').value = p.name || '';
            document.getElementById('qcPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
        }
    });
    renderAuditForm({});
    listenIncidents();
    listenConsents();
    loadTodayAudit();
});

function listenIncidents() {
    db.collection('incidents').orderBy('date', 'desc').limit(100).onSnapshot(function (snap) {
        var html = '';
        snap.forEach(function (doc) {
            var i = doc.data();
            html += '<tr><td>' + escapeHtml(i.date || '') + '</td><td>' + escapeHtml(i.type || '') + '</td><td>' + escapeHtml(i.patientId || '—') + '</td><td>' + escapeHtml(i.severity || '') + '</td><td>' + escapeHtml(i.status || '') + '</td><td>' + escapeHtml(i.summary || '') + '</td></tr>';
        });
        document.getElementById('qiBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px;">No incidents logged.</td></tr>';
    }, function () {
        db.collection('incidents').limit(100).get().then(function (snap) {
            var html = '';
            snap.forEach(function (doc) {
                var i = doc.data();
                html += '<tr><td>' + escapeHtml(i.date || '') + '</td><td>' + escapeHtml(i.type || '') + '</td><td>' + escapeHtml(i.patientId || '—') + '</td><td>' + escapeHtml(i.severity || '') + '</td><td>' + escapeHtml(i.status || '') + '</td><td>' + escapeHtml(i.summary || '') + '</td></tr>';
            });
            document.getElementById('qiBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px;">No incidents logged.</td></tr>';
        });
    });
}

function listenConsents() {
    db.collection('consentRecords').orderBy('date', 'desc').limit(100).onSnapshot(function (snap) {
        var html = '';
        snap.forEach(function (doc) {
            var c = doc.data();
            html += '<tr><td>' + escapeHtml(c.date || '') + '</td><td>' + escapeHtml(c.patientId || '') + ' ' + escapeHtml(c.patientName || '') + '</td><td>' + escapeHtml(c.consentType || '') + '</td><td>' + escapeHtml(c.witness || '') + '</td><td>' + escapeHtml(c.notes || '') + '</td></tr>';
        });
        document.getElementById('qcBody').innerHTML = html || '<tr><td colspan="5" style="text-align:center;color:#888;padding:16px;">No consent records.</td></tr>';
    }, function () {
        document.getElementById('qcBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:16px;">No consent records.</td></tr>';
    });
}

function saveIncident(e) {
    e.preventDefault();
    var data = window.hmsBranch ? hmsBranch.stamp({}) : {};
    data.date = todayIso();
    data.type = document.getElementById('qiType').value.trim();
    data.summary = document.getElementById('qiSummary').value.trim();
    data.severity = document.getElementById('qiSeverity').value;
    data.patientId = document.getElementById('qiPatientId').value.trim();
    data.status = 'open';
    data.reportedBy = (qUser && (qUser.name || qUser.email)) || '';
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    db.collection('incidents').add(data).then(function () {
        showToast('Incident logged.', 'success');
        document.getElementById('qiModal').classList.remove('active');
    }).catch(function (err) { showToast(err.message, 'error'); });
}

function saveConsent(e) {
    e.preventDefault();
    var data = window.hmsBranch ? hmsBranch.stamp({}) : {};
    data.date = todayIso();
    data.patientId = document.getElementById('qcPatientId').value.trim();
    data.patientName = document.getElementById('qcPatientName').value.trim();
    data.consentType = document.getElementById('qcType').value;
    data.witness = document.getElementById('qcWitness').value.trim();
    data.notes = document.getElementById('qcNotes').value.trim();
    data.recordedBy = (qUser && (qUser.name || qUser.email)) || '';
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    db.collection('consentRecords').add(data).then(function () {
        showToast('Consent recorded.', 'success');
        document.getElementById('qcModal').classList.remove('active');
    }).catch(function (err) { showToast(err.message, 'error'); });
}

function addIncident() { document.getElementById('qiAdd').click(); }
function addConsent() { document.getElementById('qcAdd').click(); }

function renderAuditForm(state) {
    document.getElementById('qaList').innerHTML = AUDIT_ITEMS.map(function (label, idx) {
        return '<label style="display:flex;gap:10px;align-items:center;margin-bottom:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;"><input type="checkbox" data-audit="' + idx + '" ' + (state[idx] ? 'checked' : '') + '> ' + escapeHtml(label) + '</label>';
    }).join('');
}

function loadTodayAudit() {
    var id = todayIso();
    db.collection('qualityAudits').doc(id).get().then(function (doc) {
        if (doc.exists) renderAuditForm(doc.data().items || {});
    });
}

function saveAudit() {
    var items = {};
    document.querySelectorAll('[data-audit]').forEach(function (cb) {
        items[cb.getAttribute('data-audit')] = cb.checked;
    });
    var done = Object.keys(items).filter(function (k) { return items[k]; }).length;
    db.collection('qualityAudits').doc(todayIso()).set({
        date: todayIso(),
        items: items,
        completedCount: done,
        total: AUDIT_ITEMS.length,
        savedBy: (qUser && (qUser.name || qUser.email)) || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        branchId: (window.hmsBranch && hmsBranch.currentId()) || 'main'
    }, { merge: true }).then(function () {
        showToast('Audit saved (' + done + '/' + AUDIT_ITEMS.length + ').', 'success');
    }).catch(function (err) { showToast(err.message, 'error'); });
}
