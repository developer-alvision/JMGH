checkAccess(['admin', 'pharmacist', 'owner']);

var iaRows = [];
var iaUserEmail = '';

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    iaUserEmail = user.email || user.name || '';
    document.getElementById('iaExport').onclick = function () {
        if (typeof exportToCSV === 'function') exportToCSV(iaRows.map(function (r) {
            return {
                Medicine: r.Medicine,
                Batch: r.Batch,
                Stock: r.Stock,
                Reorder: r.Reorder,
                Expiry: r.Expiry,
                Alert: r.Alert
            };
        }), 'inventory-alerts');
    };
    var selAll = document.getElementById('iaSelectAll');
    if (selAll) {
        selAll.addEventListener('change', function () {
            document.querySelectorAll('.ia-check').forEach(function (cb) {
                cb.checked = selAll.checked;
            });
        });
    }
    var batchBtn = document.getElementById('iaBatchDispose');
    if (batchBtn) batchBtn.onclick = batchDisposeSelected;
    loadAlerts();
});

function loadAlerts() {
    db.collection('pharmacy').get().then(function (snap) {
        var today = new Date();
        var in60 = new Date(); in60.setDate(in60.getDate() + 60);
        var out = 0, low = 0, exp = 0, expired = 0;
        iaRows = [];
        snap.forEach(function (doc) {
            var m = doc.data();
            if (m.disposed === true) return;
            var stock = Number(m.stock || 0);
            var reorder = m.reorderLevel !== undefined ? Number(m.reorderLevel) : 20;
            var alert = '';
            if (stock <= 0) { alert = 'OUT OF STOCK'; out++; }
            else if (stock <= reorder) { alert = 'LOW STOCK'; low++; }
            var expStatus = '';
            if (m.expiryDate) {
                var ed = new Date(m.expiryDate);
                if (!isNaN(ed)) {
                    if (ed < today) { alert = (alert ? alert + ' + ' : '') + 'EXPIRED'; expired++; expStatus = 'expired'; }
                    else if (ed <= in60) { alert = (alert ? alert + ' + ' : '') + 'EXPIRING SOON'; exp++; expStatus = 'expiring'; }
                }
            }
            if (!alert) return;
            iaRows.push({
                id: doc.id,
                Medicine: m.name || m.medicineName || '',
                Batch: m.batchNo || m.batch || m.batchNumber || '',
                Stock: stock,
                Reorder: reorder,
                Expiry: m.expiryDate || '',
                Alert: alert,
                expStatus: expStatus,
                canDispose: expStatus === 'expired' || stock > 0
            });
        });
        document.getElementById('iaOut').textContent = out;
        document.getElementById('iaLow').textContent = low;
        document.getElementById('iaExp').textContent = exp;
        document.getElementById('iaExpired').textContent = expired;
        var body = document.getElementById('iaBody');
        var selAll = document.getElementById('iaSelectAll');
        if (selAll) selAll.checked = false;
        body.innerHTML = iaRows.length
            ? iaRows.map(function (r) {
                var color = r.Alert.indexOf('OUT') !== -1 || r.Alert.indexOf('EXPIRED') !== -1 ? '#b91c1c' : '#b45309';
                var disposeBtn = r.canDispose
                    ? '<button type="button" class="btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="disposeOneAlert(\'' + r.id + '\')">Dispose</button>'
                    : '—';
                return '<tr>'
                    + '<td><input type="checkbox" class="ia-check" data-id="' + r.id + '" ' + (r.expStatus === 'expired' ? '' : '') + '></td>'
                    + '<td>' + escapeHtml(r.Medicine) + '</td><td>' + escapeHtml(r.Batch) + '</td><td>' + r.Stock + '</td><td>' + r.Reorder + '</td><td>' + escapeHtml(r.Expiry) + '</td>'
                    + '<td style="color:' + color + ';font-weight:600;">' + escapeHtml(r.Alert) + '</td>'
                    + '<td style="white-space:nowrap;">' + disposeBtn + '</td></tr>';
            }).join('')
            : '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;">No stock or expiry alerts. Pharmacy looks healthy.</td></tr>';
    }).catch(function (err) { showToast(err.message, 'error'); });
}

function disposePharmacyPhysical(medicineId, reason) {
    var med = iaRows.find(function (r) { return r.id === medicineId; });
    return db.collection('pharmacy').doc(medicineId).update({
        stock: 0,
        stockStatus: 'disposed',
        disposed: true,
        disposedAt: firebase.firestore.FieldValue.serverTimestamp(),
        disposedBy: iaUserEmail,
        disposeReason: reason,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
        if (typeof writeAuditLog === 'function') {
            writeAuditLog({
                action: 'pharmacy_dispose_expired',
                medicineId: medicineId,
                medicineName: med ? med.Medicine : '',
                reason: reason,
                previousStock: med ? med.Stock : 0,
                staffEmail: iaUserEmail
            });
        }
    });
}

window.disposeOneAlert = function (id) {
    var reason = prompt('Physical disposal description (mandatory):');
    if (!reason || !reason.trim()) {
        showToast('Disposal cancelled — description required.', 'warning');
        return;
    }
    disposePharmacyPhysical(id, reason.trim()).then(function () {
        showToast('Stock disposed physically.', 'success');
        loadAlerts();
    }).catch(function (err) { showToast(err.message, 'error'); });
};

function batchDisposeSelected() {
    var ids = [];
    document.querySelectorAll('.ia-check:checked').forEach(function (cb) {
        ids.push(cb.getAttribute('data-id'));
    });
    if (!ids.length) {
        showToast('Select one or more items first (or use Select all).', 'warning');
        return;
    }
    var reason = prompt('Batch physical disposal description for ' + ids.length + ' item(s):');
    if (!reason || !reason.trim()) {
        showToast('Batch disposal cancelled — description required.', 'warning');
        return;
    }
    var chain = Promise.resolve();
    ids.forEach(function (id) {
        chain = chain.then(function () { return disposePharmacyPhysical(id, reason.trim() + ' [batch]'); });
    });
    chain.then(function () {
        showToast('Disposed ' + ids.length + ' item(s).', 'success');
        loadAlerts();
    }).catch(function (err) { showToast(err.message, 'error'); });
}
window.batchDisposeSelected = batchDisposeSelected;
