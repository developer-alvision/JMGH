checkAccess(['admin', 'billing_staff', 'receptionist', 'owner']);

var clUser = null;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    clUser = user;
    document.getElementById('clAddBtn').onclick = function () {
        document.getElementById('clEditId').value = '';
        document.getElementById('clForm').reset();
        document.getElementById('clPatientSearch').value = '';
        document.getElementById('clModalTitle').textContent = 'New claim';
        loadServiceCatalogOptions(document.getElementById('clPackageSelect'));
        document.getElementById('clModal').classList.add('active');
    };
    document.getElementById('clForm').onsubmit = saveClaim;
    document.getElementById('clPackageSelect').onchange = function () {
        if (this.value) document.getElementById('clPackage').value = this.value;
    };
    mountPatientSearch({
        inputId: 'clPatientSearch',
        resultsId: 'clPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('clPatientId').value = p.patientId || '';
            document.getElementById('clPatientName').value = p.name || '';
            document.getElementById('clPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
        }
    });
    listenClaims();
});

function listenClaims() {
    db.collection('insuranceClaims').orderBy('createdAt', 'desc').limit(200).onSnapshot(function (snap) {
        var rows = [];
        snap.forEach(function (doc) {
            var c = doc.data(); c._id = doc.id;
            if (window.hmsBranch && !hmsBranch.matches(c)) return;
            rows.push(c);
        });
        renderClaims(rows);
    }, function () {
        db.collection('insuranceClaims').limit(200).get().then(function (snap) {
            var rows = [];
            snap.forEach(function (doc) { var c = doc.data(); c._id = doc.id; rows.push(c); });
            renderClaims(rows);
        });
    });
}

function renderClaims(rows) {
    var open = rows.filter(function (c) { return c.status !== 'settled' && c.status !== 'rejected'; });
    var pre = rows.filter(function (c) { return c.status === 'preauth_pending'; });
    var approved = rows.reduce(function (s, c) { return s + (Number(c.approvedAmount) || 0); }, 0);
    document.getElementById('clOpen').textContent = open.length;
    document.getElementById('clPreauth').textContent = pre.length;
    document.getElementById('clApproved').textContent = formatCurrency(approved);
    var body = document.getElementById('clBody');
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;">No claims yet.</td></tr>';
        return;
    }
    body.innerHTML = rows.map(function (c) {
        return '<tr><td>' + escapeHtml(c.claimNo || c._id.slice(0, 8)) + '</td><td>' + escapeHtml(c.patientName || '') + '<div class="cell-sub">' + escapeHtml(c.patientId || '') + '</div></td><td>' + escapeHtml(c.insurer || '') + '</td><td>' + escapeHtml(c.billNo || '—') + '</td><td>' + formatCurrency(c.claimedAmount || 0) + '</td><td>' + formatCurrency(c.approvedAmount || 0) + '</td><td>' + escapeHtml((c.status || '').replace(/_/g, ' ')) + '</td><td><button class="btn-secondary" style="padding:4px 8px;font-size:12px;" onclick=\'editClaim(' + JSON.stringify(c).replace(/'/g, "&#39;") + ')\'>Edit</button></td></tr>';
    }).join('');
}

window.editClaim = function (c) {
    if (typeof c === 'string') try { c = JSON.parse(c); } catch (e) { return; }
    document.getElementById('clEditId').value = c._id || '';
    document.getElementById('clPatientId').value = c.patientId || '';
    document.getElementById('clPatientName').value = c.patientName || '';
    document.getElementById('clPatientSearch').value = (c.patientName || '') + (c.patientId ? (' — ' + c.patientId) : '');
    document.getElementById('clBillNo').value = c.billNo || '';
    document.getElementById('clInsurer').value = c.insurer || '';
    document.getElementById('clPolicy').value = c.policyId || '';
    document.getElementById('clPreauthNo').value = c.preauthNo || '';
    document.getElementById('clClaimed').value = c.claimedAmount || 0;
    document.getElementById('clApprovedAmt').value = c.approvedAmount || 0;
    document.getElementById('clStatus').value = c.status || 'preauth_pending';
    document.getElementById('clPackage').value = c.packageName || '';
    document.getElementById('clNotes').value = c.notes || '';
    document.getElementById('clModalTitle').textContent = 'Update claim';
    loadServiceCatalogOptions(document.getElementById('clPackageSelect'), c.packageName || '').then(function () {
        var sel = document.getElementById('clPackageSelect');
        if (c.packageName && sel) sel.value = c.packageName;
    });
    document.getElementById('clModal').classList.add('active');
};

function saveClaim(e) {
    e.preventDefault();
    var id = document.getElementById('clEditId').value;
    var data = window.hmsBranch ? hmsBranch.stamp({}) : {};
    data.patientId = document.getElementById('clPatientId').value.trim();
    data.patientName = document.getElementById('clPatientName').value.trim();
    data.billNo = document.getElementById('clBillNo').value.trim();
    data.insurer = document.getElementById('clInsurer').value.trim();
    data.policyId = document.getElementById('clPolicy').value.trim();
    data.preauthNo = document.getElementById('clPreauthNo').value.trim();
    data.claimedAmount = parseFloat(document.getElementById('clClaimed').value) || 0;
    data.approvedAmount = parseFloat(document.getElementById('clApprovedAmt').value) || 0;
    data.status = document.getElementById('clStatus').value;
    data.packageName = document.getElementById('clPackage').value.trim()
        || (document.getElementById('clPackageSelect') && document.getElementById('clPackageSelect').value) || '';
    data.notes = document.getElementById('clNotes').value.trim();
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.updatedBy = (clUser && (clUser.name || clUser.email)) || '';
    var p;
    if (id) {
        p = db.collection('insuranceClaims').doc(id).set(data, { merge: true });
    } else {
        data.claimNo = 'CLM-' + Date.now().toString().slice(-8);
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        data.createdBy = data.updatedBy;
        p = db.collection('insuranceClaims').add(data);
    }
    p.then(function () {
        showToast('Claim saved.', 'success');
        document.getElementById('clModal').classList.remove('active');
    }).catch(function (err) { showToast(err.message, 'error'); });
}
