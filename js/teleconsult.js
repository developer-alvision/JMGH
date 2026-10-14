checkAccess(['admin', 'doctor', 'receptionist']);

var tcUser = null;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    tcUser = user;
    document.getElementById('tcDate').value = todayIso();
    loadDoctors().then(function (docs) {
        document.getElementById('tcDoctor').innerHTML = docs.map(function (d) {
            return '<option value="' + escapeHtml(d.id) + '" data-name="' + escapeHtml(d.name) + '">' + escapeHtml(d.name) + '</option>';
        }).join('');
    });
    document.getElementById('tcCreateBtn').onclick = function () {
        document.getElementById('tcModal').classList.add('active');
    };
    document.getElementById('tcForm').onsubmit = createTele;
    mountPatientSearch({
        inputId: 'tcPatientSearch',
        resultsId: 'tcPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('tcPatientId').value = p.patientId || '';
            document.getElementById('tcPatientName').value = p.name || '';
            document.getElementById('tcPatientPhone').value = p.phone || '';
            document.getElementById('tcPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
        }
    });
    listenTele();
});

function roomSlug(patientId) {
    return 'jyothsna-' + String(patientId || 'visit').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
}

function buildMeetUrl(customLink, patientId) {
    var custom = (customLink || '').trim();
    if (custom) {
        if (!/^https?:\/\//i.test(custom)) custom = 'https://' + custom;
        return custom;
    }
    // Default: Google Meet new meeting entry (shareable). Custom hospital Meet link preferred.
    return 'https://meet.google.com/new';
}

function listenTele() {
    db.collection('teleconsults').orderBy('date', 'desc').limit(100).onSnapshot(function (snap) {
        var html = '';
        snap.forEach(function (doc) {
            var t = doc.data();
            t._id = doc.id;
            html += '<tr><td>' + escapeHtml(t.date || '') + ' ' + escapeHtml(t.time || '') + '</td><td>' + escapeHtml(t.patientName || '') + '<div class="cell-sub">' + escapeHtml(t.patientId || '') + '</div></td><td>' + escapeHtml(t.doctorName || '') + '</td><td>' + escapeHtml(t.status || '') + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;"><a href="' + escapeHtml(t.roomUrl || '#') + '" target="_blank" rel="noopener">' + escapeHtml(t.platform || 'Meet') + '</a></td><td style="white-space:nowrap;">'
                + '<button class="btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="navigator.clipboard.writeText(\'' + String(t.roomUrl || '').replace(/'/g, '') + '\');showToast(\'Link copied\',\'success\')">Copy</button> '
                + '<button class="btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="resendTeleWhatsApp(\'' + t._id + '\')">WhatsApp</button> '
                + '<a class="btn-primary" style="padding:4px 8px;font-size:12px;text-decoration:none;" href="consultation.html?patientId=' + encodeURIComponent(t.patientId || '') + '">Rx</a>'
                + '</td></tr>';
        });
        document.getElementById('tcBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#888;">No tele-visits yet.</td></tr>';
    }, function () {
        db.collection('teleconsults').limit(100).get().then(function (snap) {
            var html = '';
            snap.forEach(function (doc) {
                var t = doc.data();
                html += '<tr><td>' + escapeHtml(t.date || '') + '</td><td>' + escapeHtml(t.patientName || '') + '</td><td>' + escapeHtml(t.doctorName || '') + '</td><td>' + escapeHtml(t.status || '') + '</td><td><a href="' + escapeHtml(t.roomUrl || '#') + '" target="_blank">Join</a></td><td></td></tr>';
            });
            document.getElementById('tcBody').innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#888;">No tele-visits yet.</td></tr>';
        });
    });
}

function queueTeleWhatsApp(data, phone) {
    if (!phone) return Promise.resolve();
    var msg = 'Namaste ' + (data.patientName || 'Patient') + ',\n'
        + 'Your tele-consultation at Jyothsna Maternity Hospital is scheduled.\n'
        + 'Date: ' + (data.date || '') + '  Time: ' + (data.time || '') + '\n'
        + 'Doctor: ' + (data.doctorName || '') + '\n'
        + 'Purpose: ' + (data.reason || 'Tele-consult') + '\n'
        + 'Join Google Meet: ' + (data.roomUrl || '') + '\n'
        + 'Please join 5 minutes early. Keep previous reports ready.\n'
        + 'For help call hospital reception.';
    return db.collection('messageLog').add({
        channel: 'whatsapp',
        template: 'teleconsult_scheduled',
        status: 'queued',
        to: phone,
        patientId: data.patientId || '',
        patientName: data.patientName || '',
        message: msg,
        meetUrl: data.roomUrl || '',
        purpose: data.reason || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
        var wa = 'https://wa.me/91' + String(phone).replace(/\D/g, '').replace(/^91/, '') + '?text=' + encodeURIComponent(msg);
        window.open(wa, '_blank');
    });
}

window.resendTeleWhatsApp = function (id) {
    db.collection('teleconsults').doc(id).get().then(function (doc) {
        if (!doc.exists) return;
        var t = doc.data();
        var phone = t.patientPhone || prompt('Patient WhatsApp number');
        if (!phone) return;
        queueTeleWhatsApp(t, phone).then(function () {
            showToast('WhatsApp message opened / queued.', 'success');
        });
    });
};

function createTele(e) {
    e.preventDefault();
    var doctorEl = document.getElementById('tcDoctor');
    var patientId = document.getElementById('tcPatientId').value.trim();
    var customMeet = (document.getElementById('tcMeetLink') || {}).value || '';
    var roomUrl = buildMeetUrl(customMeet, patientId);
    var phone = (document.getElementById('tcPatientPhone') || {}).value || '';
    var data = window.hmsBranch ? hmsBranch.stamp({}) : {};
    data.patientId = patientId;
    data.patientName = document.getElementById('tcPatientName').value.trim();
    data.patientPhone = phone.trim();
    data.date = document.getElementById('tcDate').value;
    data.time = document.getElementById('tcTime').value;
    data.doctorId = doctorEl.value;
    data.doctorName = doctorEl.selectedOptions[0] ? doctorEl.selectedOptions[0].getAttribute('data-name') : '';
    data.reason = document.getElementById('tcReason').value.trim();
    data.platform = 'Google Meet';
    data.roomSlug = roomSlug(patientId);
    data.roomUrl = roomUrl;
    data.status = 'scheduled';
    data.createdBy = (tcUser && (tcUser.name || tcUser.email)) || '';
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    db.collection('teleconsults').add(data).then(function () {
        return db.collection('appointments').add({
            patientId: data.patientId,
            patientName: data.patientName,
            doctorId: data.doctorId,
            doctorName: data.doctorName,
            date: data.date,
            time: data.time,
            status: 'Scheduled',
            visitType: 'tele',
            teleRoomUrl: roomUrl,
            platform: 'Google Meet',
            reason: data.reason || 'Tele-consult',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            branchId: data.branchId || 'main'
        });
    }).then(function () {
        return queueTeleWhatsApp(data, phone);
    }).then(function () {
        showToast('Tele-visit scheduled. Google Meet link shared via WhatsApp.', 'success');
        document.getElementById('tcModal').classList.remove('active');
        e.target.reset();
        document.getElementById('tcDate').value = todayIso();
        if (navigator.clipboard) navigator.clipboard.writeText(roomUrl);
    }).catch(function (err) { showToast(err.message, 'error'); });
}
