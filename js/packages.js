checkAccess(['admin', 'billing_staff', 'receptionist']);

var DEFAULT_PACKAGES = [
    { code: 'PKG-ND', name: 'Normal Delivery Package', price: 35000, inclusions: 'Labour room\nDelivery\n2-day ward stay\nRoutine medicines\nNewborn check', extras: 'NICU, blood, implants, extra days', active: true },
    { code: 'PKG-LSCS', name: 'LSCS Package', price: 65000, inclusions: 'OT charges\nSurgeon & anaesthetist\n3-day stay\nRoutine medicines\nNewborn check', extras: 'NICU, blood, implants, extra days', active: true },
    { code: 'PKG-ANC', name: 'ANC Care Package', price: 12000, inclusions: '8 ANC visits\nBasic labs panel\n2 USG\nPregnancy diet counselling', extras: 'High-risk investigations, admission', active: true }
];

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    ensureDefaults().then(listenPackages);
    document.getElementById('pkAddBtn').onclick = function () {
        document.getElementById('pkEditId').value = '';
        document.getElementById('pkForm').reset();
        document.getElementById('pkActive').value = 'true';
        loadServiceCatalogOptions(document.getElementById('pkServiceSelect'));
        document.getElementById('pkModal').classList.add('active');
    };
    document.getElementById('pkAddServiceBtn').onclick = function () {
        var sel = document.getElementById('pkServiceSelect');
        var name = sel && sel.value;
        if (!name) { showToast('Select a service first.', 'warning'); return; }
        var ta = document.getElementById('pkInclusions');
        var lines = (ta.value || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (lines.indexOf(name) === -1) lines.push(name);
        ta.value = lines.join('\n');
        showToast('Added: ' + name, 'success');
    };
    document.getElementById('pkForm').onsubmit = savePackage;
});

function ensureDefaults() {
    return db.collection('carePackages').limit(1).get().then(function (snap) {
        if (!snap.empty) return null;
        var batch = db.batch();
        DEFAULT_PACKAGES.forEach(function (p) {
            var ref = db.collection('carePackages').doc(p.code);
            batch.set(ref, Object.assign({}, p, {
                branchId: 'main',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }));
        });
        return batch.commit();
    });
}

function listenPackages() {
    db.collection('carePackages').onSnapshot(function (snap) {
        var rows = [];
        snap.forEach(function (doc) { var p = doc.data(); p._id = doc.id; rows.push(p); });
        rows.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
        var body = document.getElementById('pkBody');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#888;">No packages.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(function (p) {
            return '<tr><td><code>' + escapeHtml(p.code || '') + '</code></td><td>' + escapeHtml(p.name || '') + '</td><td>' + formatCurrency(p.price || 0) + '</td><td style="max-width:240px;white-space:pre-wrap;font-size:12px;">' + escapeHtml(p.inclusions || '') + '</td><td style="max-width:180px;font-size:12px;">' + escapeHtml(p.extras || '') + '</td><td>' + (p.active === false ? 'No' : 'Yes') + '</td><td><button class="btn-secondary" style="padding:4px 8px;font-size:12px;" type="button" onclick=\'editPkg(' + JSON.stringify({ _id: p._id, code: p.code, name: p.name, price: p.price, inclusions: p.inclusions, extras: p.extras, active: p.active !== false }).replace(/'/g, "&#39;") + ')\'>Edit</button></td></tr>';
        }).join('');
    });
}

window.editPkg = function (p) {
    document.getElementById('pkEditId').value = p._id || '';
    document.getElementById('pkCode').value = p.code || '';
    document.getElementById('pkName').value = p.name || '';
    document.getElementById('pkPrice').value = p.price || 0;
    document.getElementById('pkInclusions').value = p.inclusions || '';
    document.getElementById('pkExtras').value = p.extras || '';
    document.getElementById('pkActive').value = p.active === false ? 'false' : 'true';
    loadServiceCatalogOptions(document.getElementById('pkServiceSelect'));
    document.getElementById('pkModal').classList.add('active');
};

function savePackage(e) {
    e.preventDefault();
    var id = document.getElementById('pkEditId').value;
    var data = {
        code: document.getElementById('pkCode').value.trim().toUpperCase(),
        name: document.getElementById('pkName').value.trim(),
        price: parseFloat(document.getElementById('pkPrice').value) || 0,
        inclusions: document.getElementById('pkInclusions').value,
        extras: document.getElementById('pkExtras').value,
        active: document.getElementById('pkActive').value === 'true',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    var ref = id ? db.collection('carePackages').doc(id) : db.collection('carePackages').doc(data.code);
    ref.set(data, { merge: true }).then(function () {
        showToast('Package saved. Use code in Billing item description or Apply Package.', 'success');
        document.getElementById('pkModal').classList.remove('active');
    }).catch(function (err) { showToast(err.message, 'error'); });
}

// Helper used by billing page
window.loadCarePackages = function () {
    return db.collection('carePackages').get().then(function (snap) {
        var list = [];
        snap.forEach(function (doc) {
            var p = doc.data();
            if (p.active === false) return;
            list.push(Object.assign({ id: doc.id }, p));
        });
        return list;
    });
};
