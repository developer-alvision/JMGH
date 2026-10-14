checkAccess(['admin', 'doctor', 'nurse', 'receptionist']);

var mcAncPatients = [];
var mcBirthRows = [];
var mcUser = null;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    mcUser = user;
    document.getElementById('mcVacDate').value = todayIso();
    wireMcTabs();
    loadMcAnc();
    loadMcVaccines();
    loadMcBirthReg();
});

function wireMcTabs() {
    document.querySelectorAll('[data-mc-tab]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('[data-mc-tab]').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            ['anc', 'vaccines', 'birthreg'].forEach(function (id) {
                var el = document.getElementById('mcTab-' + id);
                if (el) el.style.display = btn.getAttribute('data-mc-tab') === id ? 'block' : 'none';
            });
        });
    });
    var search = document.getElementById('mcAncSearch');
    if (search) search.addEventListener('input', renderMcAnc);
    document.getElementById('mcAddVaccineBtn').onclick = openMcVaccineModal;
    document.getElementById('mcVaccineForm').onsubmit = saveMcVaccine;
    document.getElementById('mcExportBirthCsv').onclick = exportMcBirthCsv;
    mountPatientSearch({
        inputId: 'mcVacMotherSearch',
        resultsId: 'mcVacMotherSearchResults',
        onSelect: function (p) {
            document.getElementById('mcVacMotherId').value = p.patientId || '';
            document.getElementById('mcVacMotherSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
        }
    });
}

function loadMcAnc() {
    db.collection('patients').where('isPregnant', '==', true).onSnapshot(function (snap) {
        mcAncPatients = [];
        snap.forEach(function (doc) {
            var p = doc.data();
            p._docId = doc.id;
            if (window.hmsBranch && !hmsBranch.matches(p)) return;
            mcAncPatients.push(p);
        });
        var today = todayIso();
        var month = today.slice(0, 7);
        var due = mcAncPatients.filter(function (p) { return p.nextVisitDate && p.nextVisitDate <= today; });
        var edd = mcAncPatients.filter(function (p) { return p.edd && String(p.edd).slice(0, 7) === month; });
        var high = mcAncPatients.filter(function (p) { return p.highRisk; });
        setText('mcPregnantCount', mcAncPatients.length);
        setText('mcDueCount', due.length);
        setText('mcEddCount', edd.length);
        setText('mcHighRiskCount', high.length);
        renderMcAnc();
    }, function (err) {
        showToast('ANC board: ' + err.message, 'error');
    });
}

function renderMcAnc() {
    var q = (document.getElementById('mcAncSearch').value || '').toLowerCase().trim();
    var rows = mcAncPatients.filter(function (p) {
        if (!q) return true;
        return [p.name, p.patientId, p.phone, p.mobile].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    var body = document.getElementById('mcAncBody');
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;">No antenatal patients.</td></tr>';
        return;
    }
    body.innerHTML = rows.map(function (p) {
        var ga = (typeof gestationalAge === 'function' && p.lmp) ? gestationalAge(p.lmp) : null;
        var gaText = ga ? (ga.weeks + 'w ' + ga.days + 'd') : '—';
        var dueSoon = p.nextVisitDate && p.nextVisitDate <= todayIso();
        return '<tr>'
            + '<td><a href="patient-profile.html?id=' + encodeURIComponent(p.patientId || '') + '" style="color:var(--primary-teal);font-weight:600;text-decoration:none;">' + escapeHtml(p.name || '') + '</a><div class="cell-sub">' + escapeHtml(p.patientId || '') + '</div></td>'
            + '<td>' + escapeHtml(p.lmp || '—') + '<div class="cell-sub">EDD ' + escapeHtml(p.edd || '—') + '</div></td>'
            + '<td>' + escapeHtml(gaText) + '</td>'
            + '<td style="' + (dueSoon ? 'color:#b45309;font-weight:600;' : '') + '">' + escapeHtml(p.nextVisitDate || '—') + '</td>'
            + '<td>' + (p.highRisk ? '<span class="badge-status status-cancelled">High</span>' : '<span class="badge-status status-completed">Routine</span>') + '</td>'
            + '<td><a class="btn-secondary" style="padding:4px 8px;font-size:12px;" href="partograph.html?patientId=' + encodeURIComponent(p.patientId || '') + '">Labour</a></td>'
            + '</tr>';
    }).join('');
}

function loadMcVaccines() {
    db.collection('vaccinations').orderBy('givenOn', 'desc').limit(200).onSnapshot(function (snap) {
        var body = document.getElementById('mcVaccineBody');
        if (snap.empty) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;padding:20px;">No vaccine doses recorded yet.</td></tr>';
            return;
        }
        var html = '';
        snap.forEach(function (doc) {
            var v = doc.data();
            if (window.hmsBranch && !hmsBranch.matches(v)) return;
            html += '<tr><td>' + escapeHtml(v.givenOn || '') + '</td><td>' + escapeHtml(v.babyName || v.babyId || '') + '</td><td>' + escapeHtml(v.motherId || '') + '</td><td>' + escapeHtml(v.vaccine || '') + '</td><td>' + escapeHtml(v.batch || '—') + '</td><td>' + escapeHtml(v.givenBy || '') + '</td><td>' + escapeHtml(v.nextDue || '—') + '</td></tr>';
        });
        body.innerHTML = html || '<tr><td colspan="7" style="text-align:center;color:#888;padding:20px;">No doses for this branch.</td></tr>';
    }, function (err) {
        document.getElementById('mcVaccineBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#b91c1c;">' + escapeHtml(err.message) + '</td></tr>';
    });
}

function openMcVaccineModal() {
    document.getElementById('mcVaccineModal').classList.add('active');
}
function closeMcVaccineModal() {
    document.getElementById('mcVaccineModal').classList.remove('active');
}
window.closeMcVaccineModal = closeMcVaccineModal;

function saveMcVaccine(e) {
    e.preventDefault();
    const saveButton = e.target.querySelector('[type="submit"]');
    if (saveButton && saveButton.disabled) return;
    var data = window.hmsBranch ? hmsBranch.stamp({}) : {};
    // Antenatal doses (TT / Tdap / Influenza) are given to the mother, so the
    // baby fields are not required for those.
    var recipientEl = document.getElementById('mcVacRecipient');
    data.recipient = recipientEl ? recipientEl.value : 'baby';
    data.babyId = document.getElementById('mcVacBabyId').value.trim();
    data.babyName = data.babyId;
    data.motherId = document.getElementById('mcVacMotherId').value.trim();
    data.vaccine = document.getElementById('mcVacName').value;
    if (data.recipient === 'mother') {
        data.patientId = data.motherId;
        data.patientName = data.motherId;
    } else if (!data.babyId) {
        showToast('Enter the baby ID or name for a newborn dose.', 'warning');
        return;
    }
    data.givenOn = document.getElementById('mcVacDate').value;
    data.batch = document.getElementById('mcVacBatch').value.trim();
    data.nextDue = document.getElementById('mcVacNext').value || null;
    data.notes = document.getElementById('mcVacNotes').value.trim();
    data.givenBy = (mcUser && (mcUser.name || mcUser.email)) || '';
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    if (!data.givenOn || data.givenOn > todayIso()) { showToast('Dose date cannot be in the future.', 'warning'); return; }
    if (data.nextDue && data.nextDue <= data.givenOn) { showToast('Next dose date must follow the recorded dose.', 'warning'); return; }
    if (saveButton) saveButton.disabled = true;
    db.collection('vaccinations').add(data).then(function () {
        showToast('Vaccine dose recorded.', 'success');
        closeMcVaccineModal();
        e.target.reset();
        document.getElementById('mcVacDate').value = todayIso();
    }).catch(function (err) { showToast(err.message, 'error'); }).finally(function () { if (saveButton) saveButton.disabled = false; });
}

function loadMcBirthReg() {
    Promise.all([
        db.collection('deliveries').orderBy('deliveryDate', 'desc').limit(100).get(),
        db.collection('babies').limit(300).get()
    ]).then(function (res) {
        var babiesByDelivery = {};
        res[1].forEach(function (doc) {
            var b = doc.data();
            b._id = doc.id;
            var key = b.deliveryId || b.motherId || '';
            if (!babiesByDelivery[key]) babiesByDelivery[key] = [];
            babiesByDelivery[key].push(b);
        });
        mcBirthRows = [];
        res[0].forEach(function (doc) {
            var d = doc.data();
            d._id = doc.id;
            if (window.hmsBranch && !hmsBranch.matches(d)) return;
            var kids = babiesByDelivery[doc.id] || babiesByDelivery[d.patientId] || [];
            if (!kids.length) kids = [{ name: '—', sex: '—', weight: '—' }];
            kids.forEach(function (baby) {
                mcBirthRows.push({ delivery: d, baby: baby, deliveryId: doc.id });
            });
        });
        renderMcBirth();
    }).catch(function (err) {
        document.getElementById('mcBirthBody').innerHTML = '<tr><td colspan="8" style="color:#b91c1c;text-align:center;">' + escapeHtml(err.message) + '</td></tr>';
    });
}

function birthChecklistScore(reg) {
    reg = reg || {};
    var keys = ['parentsIdProof', 'addressProof', 'hospitalCertificate', 'informantDetails', 'crsFiled'];
    var done = keys.filter(function (k) { return !!reg[k]; }).length;
    return done + '/' + keys.length;
}

function renderMcBirth() {
    var body = document.getElementById('mcBirthBody');
    if (!mcBirthRows.length) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;padding:20px;">No deliveries yet.</td></tr>';
        return;
    }
    body.innerHTML = mcBirthRows.map(function (row, idx) {
        var d = row.delivery;
        var b = row.baby;
        var reg = d.birthRegistration || {};
        var status = reg.crsFiled ? 'Filed' : (reg.readyToFile ? 'Ready' : 'Pending');
        return '<tr>'
            + '<td>' + escapeHtml(d.deliveryDate || '') + '<div class="cell-sub">' + escapeHtml(d.deliveryType || '') + '</div></td>'
            + '<td>' + escapeHtml(d.patientName || d.patientId || '') + '</td>'
            + '<td>' + escapeHtml(b.name || b.babyName || 'Baby') + '</td>'
            + '<td>' + escapeHtml(b.sex || b.gender || '—') + '</td>'
            + '<td>' + escapeHtml(String(b.weight || b.birthWeight || '—')) + '</td>'
            + '<td>' + birthChecklistScore(reg) + '</td>'
            + '<td>' + escapeHtml(status) + '</td>'
            + '<td><button class="btn-secondary" style="padding:4px 8px;font-size:12px;" type="button" onclick="toggleBirthChecklist(' + idx + ')">Update</button></td>'
            + '</tr>';
    }).join('');
}

window.toggleBirthChecklist = function (idx) {
    var row = mcBirthRows[idx];
    if (!row) return;
    var reg = Object.assign({
        parentsIdProof: false,
        addressProof: false,
        hospitalCertificate: false,
        informantDetails: false,
        crsFiled: false,
        readyToFile: false
    }, row.delivery.birthRegistration || {});

    var overlay = document.createElement('div');
    overlay.className = 'modal active';
    overlay.innerHTML = '<div class="modal-content" style="max-width:480px;"><div class="modal-header"><h3>Birth registration checklist</h3><button class="close-btn" type="button"><i class="fa-solid fa-xmark"></i></button></div><div class="modal-body">'
        + ['parentsIdProof|Parents ID proof', 'addressProof|Address proof', 'hospitalCertificate|Hospital birth certificate issued', 'informantDetails|Informant details complete', 'readyToFile|Packet ready for registrar', 'crsFiled|Filed with CRS / municipality'].map(function (pair) {
            var p = pair.split('|');
            return '<label style="display:flex;gap:8px;align-items:center;margin-bottom:10px;"><input type="checkbox" data-k="' + p[0] + '" ' + (reg[p[0]] ? 'checked' : '') + '> ' + p[1] + '</label>';
        }).join('')
        + '<div class="form-group"><label>Registrar notes</label><textarea id="brNotes">' + escapeHtml(reg.notes || '') + '</textarea></div>'
        + '<div class="modal-footer"><button type="button" class="btn-primary" id="brSave">Save</button></div></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.close-btn').onclick = function () { overlay.remove(); };
    overlay.querySelector('#brSave').onclick = function () {
        overlay.querySelectorAll('[data-k]').forEach(function (cb) { reg[cb.getAttribute('data-k')] = cb.checked; });
        reg.notes = overlay.querySelector('#brNotes').value.trim();
        reg.updatedAt = new Date().toISOString();
        db.collection('deliveries').doc(row.deliveryId).update({ birthRegistration: reg }).then(function () {
            row.delivery.birthRegistration = reg;
            showToast('Checklist saved.', 'success');
            overlay.remove();
            renderMcBirth();
        }).catch(function (err) { showToast(err.message, 'error'); });
    };
};

function exportMcBirthCsv() {
    var rows = mcBirthRows.map(function (row) {
        var d = row.delivery;
        var b = row.baby;
        var reg = d.birthRegistration || {};
        return {
            DeliveryDate: d.deliveryDate || '',
            DeliveryType: d.deliveryType || '',
            MotherId: d.patientId || '',
            MotherName: d.patientName || '',
            BabyName: b.name || b.babyName || '',
            Sex: b.sex || b.gender || '',
            Weight: b.weight || b.birthWeight || '',
            Place: d.place || d.deliveryPlace || '',
            ConductedBy: d.conductedBy || d.doctor || '',
            CRSFiled: reg.crsFiled ? 'Yes' : 'No',
            Notes: reg.notes || ''
        };
    });
    if (typeof exportToCSV === 'function') exportToCSV(rows, 'birth-registration-export');
    else showToast('CSV helper missing.', 'error');
}

function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}
