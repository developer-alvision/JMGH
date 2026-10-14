// ==========================================
// BED MANAGEMENT — js/bed-management.js
// ==========================================

checkAccess(['receptionist', 'nurse', 'admin', 'owner']);

let currentUserEmail = '';
let allBeds = [];
let activeWardFilter = 'All';
let activeStatusFilter = 'All';
let _assignBedData = null; // { docId, bedNumber, ward, dailyRate }
let _assignSelectedPatient = null;

getCurrentUser(function(user) {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    buildSidebar(user.role);
    document.getElementById('userEmail').textContent = currentUserEmail;
    loadBeds();
    setupWardFilters();
});

document.getElementById('logoutBtn').addEventListener('click', function() {
    firebase.auth().signOut().then(function() { window.location.href = 'index.html'; });
});

// ==========================================
// SEED DEFAULT BEDS
// ==========================================
var DEFAULT_BEDS = [
    { ward: 'General Ward',  bedNumber: 'A-101', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-102', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-103', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-104', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-105', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-106', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-107', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-108', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-109', dailyRate: 1000  },
    { ward: 'General Ward',  bedNumber: 'A-110', dailyRate: 1000  },
    { ward: 'Semi-Private',  bedNumber: 'B-101', dailyRate: 2000  },
    { ward: 'Semi-Private',  bedNumber: 'B-102', dailyRate: 2000  },
    { ward: 'Semi-Private',  bedNumber: 'B-103', dailyRate: 2000  },
    { ward: 'Semi-Private',  bedNumber: 'B-104', dailyRate: 2000  },
    { ward: 'Semi-Private',  bedNumber: 'B-105', dailyRate: 2000  },
    { ward: 'Private',       bedNumber: 'C-101', dailyRate: 3500  },
    { ward: 'Private',       bedNumber: 'C-102', dailyRate: 3500  },
    { ward: 'Private',       bedNumber: 'C-103', dailyRate: 3500  },
    { ward: 'Deluxe',        bedNumber: 'D-101', dailyRate: 5000  },
    { ward: 'Deluxe',        bedNumber: 'D-102', dailyRate: 5000  },
    { ward: 'ICU',           bedNumber: 'ICU-01', dailyRate: 8000 },
    { ward: 'ICU',           bedNumber: 'ICU-02', dailyRate: 8000 },
    { ward: 'ICU',           bedNumber: 'ICU-03', dailyRate: 8000 },
    { ward: 'ICU',           bedNumber: 'ICU-04', dailyRate: 8000 },
    { ward: 'Emergency',     bedNumber: 'ER-01',  dailyRate: 1500 },
    { ward: 'Emergency',     bedNumber: 'ER-02',  dailyRate: 1500 }
];

function seedDefaultBeds() {
    var batch = db.batch();
    DEFAULT_BEDS.forEach(function(bed) {
        var ref = db.collection('beds').doc();
        batch.set(ref, {
            bedNumber: bed.bedNumber,
            ward: bed.ward,
            dailyRate: bed.dailyRate,
            status: 'available',
            notes: '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    });
    batch.commit().then(function() {
        showToast('Bed board initialised with ' + DEFAULT_BEDS.length + ' default beds.', 'success');
    }).catch(function(err) {
        showToast('Error seeding beds: ' + err.message, 'error');
    });
}

// ==========================================
// LOAD BEDS (REAL-TIME)
// ==========================================
function loadBeds() {
    var grid = document.getElementById('bedGrid');
    if (!grid) return;
    grid.innerHTML = '<div style="text-align:center;padding:50px;color:#888;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Loading beds...</div>';

    db.collection('beds').orderBy('ward').orderBy('bedNumber').onSnapshot(function(snap) {
        if (snap.empty) {
            seedDefaultBeds();
            return;
        }
        allBeds = [];
        snap.forEach(function(doc) {
            allBeds.push(Object.assign({ docId: doc.id }, doc.data()));
        });
        renderSummaryBar(allBeds);
        renderBedBoard(allBeds);
    }, function(err) {
        console.error('Bed load error:', err);
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:red;"><i class="fa-solid fa-circle-exclamation"></i> Error: ' + err.message + '</div>';
    });
}
window.loadBeds = loadBeds;

// ==========================================
// SUMMARY BAR
// ==========================================
function renderSummaryBar(beds) {
    var counts = { available: 0, occupied: 0, cleaning: 0, reserved: 0 };
    var total = beds.length;
    beds.forEach(function(b) {
        var s = (b.status || 'available').toLowerCase();
        if (counts[s] !== undefined) counts[s]++;
    });
    var pct = total > 0 ? Math.round(counts.occupied / total * 100) : 0;

    var pills = [
        { label: 'Total Beds', value: total, icon: 'fa-bed', bg: '#f8fafc', border: '#e2e8f0', color: '#0F2B5B' },
        { label: 'Occupied', value: counts.occupied, icon: 'fa-user-injured', bg: '#FFF1F2', border: '#FECACA', color: '#dc2626' },
        { label: 'Available', value: counts.available, icon: 'fa-check-circle', bg: '#F0FDF4', border: '#86EFAC', color: '#16a34a' },
        { label: 'Cleaning', value: counts.cleaning, icon: 'fa-broom', bg: '#FEFCE8', border: '#FDE047', color: '#ca8a04' },
        { label: 'Reserved', value: counts.reserved, icon: 'fa-bookmark', bg: '#EFF6FF', border: '#BFDBFE', color: '#2563eb' },
        { label: 'Occupancy', value: pct + '%', icon: 'fa-chart-pie', bg: 'linear-gradient(135deg,#0F2B5B,#0D7A70)', border: 'transparent', color: 'white' }
    ];

    var bar = document.getElementById('bedSummaryBar');
    if (!bar) return;
    bar.innerHTML = pills.map(function(p) {
        return '<div class="stat-pill" style="background:' + p.bg + ';border-color:' + p.border + ';">'
            + '<i class="fa-solid ' + p.icon + '" style="font-size:1.3rem;color:' + p.color + ';"></i>'
            + '<div><div style="font-size:11px;color:' + (p.color === 'white' ? 'rgba(255,255,255,0.75)' : '#64748b') + ';font-weight:500;">' + p.label + '</div>'
            + '<div style="font-size:1.4rem;font-weight:700;color:' + p.color + ';">' + p.value + '</div></div>'
            + '</div>';
    }).join('');
}

// ==========================================
// RENDER BED BOARD
// ==========================================
function renderBedBoard(beds) {
    var grid = document.getElementById('bedGrid');
    if (!grid) return;

    var filtered = activeWardFilter === 'All' ? beds : beds.filter(function(b) { return b.ward === activeWardFilter; });
    if (activeStatusFilter !== 'All') {
        filtered = filtered.filter(function(b) { return String(b.status || 'available').toLowerCase() === activeStatusFilter; });
    }
    if (!filtered.length) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:#888;">No beds found for this filter.</div>';
        return;
    }

    // Group by ward, then by status section
    var wards = {};
    filtered.forEach(function(bed) {
        if (!wards[bed.ward]) wards[bed.ward] = { available: [], occupied: [], cleaning: [], reserved: [], other: [] };
        var st = String(bed.status || 'available').toLowerCase();
        if (wards[bed.ward][st]) wards[bed.ward][st].push(bed);
        else wards[bed.ward].other.push(bed);
    });

    var statusOrder = [
        { key: 'occupied', label: 'Occupied' },
        { key: 'available', label: 'Available' },
        { key: 'reserved', label: 'Reserved' },
        { key: 'cleaning', label: 'Cleaning' },
        { key: 'other', label: 'Other' }
    ];

    var html = '';
    Object.keys(wards).sort().forEach(function(ward) {
        var total = statusOrder.reduce(function(n, s) { return n + wards[ward][s.key].length; }, 0);
        html += '<div style="margin-bottom:30px;">'
            + '<h3 class="ward-section-header"><i class="fa-solid fa-building-columns" style="color:#0D7A70;"></i>' + ward
            + ' <span style="font-size:11px;color:#64748b;font-weight:400;margin-left:4px;">(' + total + ' beds)</span></h3>';
        statusOrder.forEach(function(sec) {
            var list = wards[ward][sec.key];
            if (!list.length) return;
            html += '<div style="margin:10px 0 6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">' + sec.label
                + ' <span style="font-weight:500;">(' + list.length + ')</span></div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px;">';
            list.forEach(function(bed) {
                var style = getBedStyle(bed.status);
                html += '<div class="bed-card" onclick="openBedActionModal(\'' + bed.docId + '\')" '
                    + 'style="background:' + style.bg + ';border:2px solid ' + style.border + ';box-shadow:0 2px 6px rgba(0,0,0,0.06);">'
                    + '<div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">' + bed.ward + '</div>'
                    + '<div style="font-size:16px;font-weight:700;color:#0F2B5B;margin:3px 0;">' + bed.bedNumber + '</div>'
                    + '<div style="font-size:11px;color:#64748b;">₹' + (bed.dailyRate || 0).toLocaleString('en-IN') + '/day</div>'
                    + '<span class="bed-status-badge" style="background:' + style.badgeBg + ';color:' + style.badgeColor + ';">'
                    + '<i class="fa-solid ' + style.icon + '" style="margin-right:3px;"></i>' + capitalize(bed.status) + '</span>'
                    + (bed.status === 'occupied' && bed.patientName
                        ? '<div class="bed-patient-name" style="color:#334155;"><i class="fa-solid fa-user" style="font-size:9px;margin-right:3px;"></i>' + bed.patientName + '</div>'
                          + '<div style="font-size:9px;color:#64748b;margin-top:2px;">' + (bed.admittedAt || '') + '</div>'
                        : '')
                    + '</div>';
            });
            html += '</div>';
        });
        html += '</div>';
    });
    grid.innerHTML = html;
}

function getBedStyle(status) {
    switch ((status || 'available').toLowerCase()) {
        case 'available': return { bg: '#F0FDF4', border: '#86EFAC', badgeBg: '#16a34a', badgeColor: 'white', icon: 'fa-check-circle' };
        case 'occupied':  return { bg: '#FFF1F2', border: '#FECACA', badgeBg: '#dc2626', badgeColor: 'white', icon: 'fa-user-injured' };
        case 'cleaning':  return { bg: '#FEFCE8', border: '#FDE047', badgeBg: '#ca8a04', badgeColor: 'white', icon: 'fa-broom' };
        case 'reserved':  return { bg: '#EFF6FF', border: '#BFDBFE', badgeBg: '#2563eb', badgeColor: 'white', icon: 'fa-bookmark' };
        default:          return { bg: '#F8FAFC', border: '#E2E8F0', badgeBg: '#64748b', badgeColor: 'white', icon: 'fa-question-circle' };
    }
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ==========================================
// WARD FILTER BUTTONS
// ==========================================
function setupWardFilters() {
    document.querySelectorAll('#wardFilterBar .ward-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#wardFilterBar .ward-filter-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            activeWardFilter = btn.dataset.ward;
            renderBedBoard(allBeds);
        });
    });
    document.querySelectorAll('#statusFilterBar .status-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#statusFilterBar .status-filter-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            activeStatusFilter = btn.dataset.status;
            renderBedBoard(allBeds);
        });
    });
}

// ==========================================
// BED ACTION MODAL (click on a bed card)
// ==========================================
function openBedActionModal(docId) {
    var bed = allBeds.find(function(b) { return b.docId === docId; });
    if (!bed) return;

    var style = getBedStyle(bed.status);
    var title = document.getElementById('bedModalTitle');
    var body = document.getElementById('bedModalBody');
    var footer = document.getElementById('bedModalFooter');

    title.innerHTML = '<i class="fa-solid fa-bed" style="color:#0D7A70;margin-right:8px;"></i>Bed ' + bed.bedNumber;

    // Body: bed info card
    var bodyHtml = '<div style="display:flex;justify-content:space-between;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:14px;">'
        + '<div>'
        + '<div style="font-size:15px;font-weight:700;color:#0F2B5B;">' + bed.bedNumber + ' — ' + bed.ward + '</div>'
        + '<div style="font-size:12px;color:#64748b;margin-top:2px;">₹' + (bed.dailyRate || 0).toLocaleString('en-IN') + ' per day</div>'
        + '</div>'
        + '<span class="bed-status-badge" style="background:' + style.badgeBg + ';color:' + style.badgeColor + ';">' + capitalize(bed.status) + '</span>'
        + '</div>';

    if (bed.status === 'occupied' && bed.patientName) {
        bodyHtml += '<div style="background:#FFF1F2;border:1px solid #FECACA;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;">'
            + '<div style="font-weight:700;color:#b91c1c;margin-bottom:4px;"><i class="fa-solid fa-user-injured" style="margin-right:6px;"></i>Current Patient</div>'
            + '<div><strong>' + bed.patientName + '</strong> · ' + (bed.patientId || '') + '</div>'
            + '<div style="color:#64748b;font-size:12px;margin-top:3px;">Admitted: ' + (bed.admittedAt || '—') + '</div>'
            + (bed.expectedDischargeDate ? '<div style="color:#64748b;font-size:12px;">Expected Discharge: ' + bed.expectedDischargeDate + '</div>' : '')
            + '</div>';
    }

    body.innerHTML = bodyHtml;

    // Footer: action buttons per status
    var footerHtml = '';

    if (bed.status === 'available') {
        footerHtml += '<button class="bed-action-btn" style="background:#0D7A70;color:white;" onclick="openAssignPatientModal(\'' + docId + '\')">'
            + '<i class="fa-solid fa-user-plus" style="margin-right:8px;"></i>Assign Patient</button>';
        footerHtml += '<button class="bed-action-btn" style="background:#2563eb;color:white;" onclick="reserveBed(\'' + docId + '\');closeModal(\'bedActionModal\');">'
            + '<i class="fa-solid fa-bookmark" style="margin-right:8px;"></i>Mark Reserved</button>';
    }

    if (bed.status === 'reserved') {
        footerHtml += '<button class="bed-action-btn" style="background:#0D7A70;color:white;" onclick="openAssignPatientModal(\'' + docId + '\')">'
            + '<i class="fa-solid fa-user-plus" style="margin-right:8px;"></i>Assign Patient</button>';
        footerHtml += '<button class="bed-action-btn" style="background:#16a34a;color:white;" onclick="releaseBedReservation(\'' + docId + '\');closeModal(\'bedActionModal\');">'
            + '<i class="fa-solid fa-check-circle" style="margin-right:8px;"></i>Release Reservation → Available</button>';
    }

    if (bed.status === 'occupied') {
        footerHtml += '<button class="bed-action-btn" style="background:#ca8a04;color:white;" onclick="dischargePatient(\'' + docId + '\');closeModal(\'bedActionModal\');">'
            + '<i class="fa-solid fa-right-from-bracket" style="margin-right:8px;"></i>Discharge Patient → Cleaning</button>';
    }

    if (bed.status === 'cleaning') {
        footerHtml += '<button class="bed-action-btn" style="background:#16a34a;color:white;" onclick="markBedAvailable(\'' + docId + '\');closeModal(\'bedActionModal\');">'
            + '<i class="fa-solid fa-check-circle" style="margin-right:8px;"></i>Mark Available (Cleaning Done)</button>';
    }

    // Edit button always shown
    footerHtml += '<button class="bed-action-btn" style="background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;" onclick="openEditBedModal(\'' + docId + '\');closeModal(\'bedActionModal\');">'
        + '<i class="fa-solid fa-pen-to-square" style="margin-right:8px;"></i>Edit Bed Details</button>';
    footerHtml += '<button class="bed-action-btn" style="background:#f8fafc;color:#64748b;" onclick="closeModal(\'bedActionModal\')">'
        + '<i class="fa-solid fa-xmark" style="margin-right:8px;"></i>Close</button>';

    footer.innerHTML = footerHtml;
    document.getElementById('bedActionModal').style.display = 'flex';
}
window.openBedActionModal = openBedActionModal;

// ==========================================
// BED STATUS TRANSITIONS
// ==========================================
function logBedAudit(bedId, bedNumber, oldStatus, newStatus) {
    db.collection('auditLog').add({
        action: 'bed_status_change',
        bedId: bedId,
        bedNumber: bedNumber,
        oldStatus: oldStatus,
        newStatus: newStatus,
        changedBy: currentUserEmail,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function(e) { console.error('Audit log error:', e); });
}

function reserveBed(docId) {
    var bed = allBeds.find(function(b) { return b.docId === docId; });
    return transitionBed(docId, 'available', {
        status: 'reserved',
        reservedBy: currentUserEmail,
        reservedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
        logBedAudit(docId, bed ? bed.bedNumber : docId, bed ? bed.status : '', 'reserved');
        showToast('Bed marked as reserved.', 'success');
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); });
}
window.reserveBed = reserveBed;

function releaseBedReservation(docId) {
    var bed = allBeds.find(function(b) { return b.docId === docId; });
    return transitionBed(docId, 'reserved', {
        status: 'available',
        reservedBy: null,
        reservedAt: null
    }).then(function() {
        logBedAudit(docId, bed ? bed.bedNumber : docId, 'reserved', 'available');
        showToast('Reservation released. Bed is now available.', 'success');
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); });
}
window.releaseBedReservation = releaseBedReservation;

function dischargePatient(docId) {
    confirmAction(
        'Discharge Patient',
        'Discharge patient and mark bed for cleaning?',
        function() { proceedDischarge(docId); },
        'Discharge',
        '#DC2626'
    );
}
window.dischargePatient = dischargePatient;

function proceedDischarge(docId) {
    const displayedBed = allBeds.find(function(b) { return b.docId === docId; });
    return db.runTransaction(async function(batch) {
    const bedRef = db.collection('beds').doc(docId);
    const snapshot = await batch.get(bedRef);
    if (!snapshot.exists || snapshot.data().status !== 'occupied') throw new Error('This bed is no longer occupied. Refresh the bed board.');
    const bed = snapshot.data();
    if (displayedBed && displayedBed.patientId !== bed.patientId) throw new Error('The patient assigned to this bed has changed. Refresh before discharging.');
    const admissionRef = bed.activeAdmissionId ? db.collection('admissions').doc(bed.activeAdmissionId) : null;
    const admission = admissionRef ? await batch.get(admissionRef) : null;
    const patientRef = bed.patientDocId ? db.collection('patients').doc(bed.patientDocId) : null;
    const patient = patientRef ? await batch.get(patientRef) : null;
    if (patient && patient.exists && patient.data().currentBedId && patient.data().currentBedId !== docId) throw new Error('Patient is assigned to another bed. Reconcile the admission first.');

    batch.update(db.collection('beds').doc(docId), {
        status: 'cleaning',
        patientId: null,
        patientDocId: null,
        patientName: null,
        admittedAt: null,
        expectedDischargeDate: null,
        billId: null,
        billDocId: null,
        activeAdmissionId: null,
        dischargedAt: firebase.firestore.FieldValue.serverTimestamp(),
        dischargedBy: currentUserEmail
    });

    // Update admission record if exists
    if (admission && admission.exists) {
        batch.update(admissionRef, {
            status: 'discharged',
            actualDischargeDate: todayIso(),
            dischargedBy: currentUserEmail,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    // Update patient status (Medium Fix 12)
    if (patient && patient.exists) {
        batch.update(patientRef, {
            status: 'discharged',
            currentBedId: null,
            currentBillId: null,
            dischargedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    return bed;
    }).then(function(bed) {
        logBedAudit(docId, bed ? bed.bedNumber : docId, 'occupied', 'cleaning');
        showToast('Patient discharged. Bed ' + (bed ? bed.bedNumber : '') + ' is now being cleaned.', 'success');
        
        if (bed.billDocId || bed.billId) showToast('Finalize the linked inpatient bill in Billing using the discharge date.', 'warning');
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); });
}
window.dischargePatient = dischargePatient;

function markBedAvailable(docId) {
    var bed = allBeds.find(function(b) { return b.docId === docId; });
    return transitionBed(docId, 'cleaning', {
        status: 'available',
        cleanedAt: firebase.firestore.FieldValue.serverTimestamp(),
        cleanedBy: currentUserEmail
    }).then(function() {
        logBedAudit(docId, bed ? bed.bedNumber : docId, 'cleaning', 'available');
        showToast('Bed ' + (bed ? bed.bedNumber : '') + ' is now available.', 'success');
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); });
}
window.markBedAvailable = markBedAvailable;

function transitionBed(docId, expectedStatus, changes) {
    return db.runTransaction(async function (transaction) {
        const ref = db.collection('beds').doc(docId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data().status !== expectedStatus) throw new Error('Bed status changed. Refresh and try again.');
        transaction.update(ref, changes);
    });
}

// ==========================================
// ASSIGN PATIENT MODAL
// ==========================================
function openAssignPatientModal(docId) {
    var bed = allBeds.find(function(b) { return b.docId === docId; });
    if (!bed) return;

    _assignBedData = { docId: docId, bedNumber: bed.bedNumber, ward: bed.ward, dailyRate: bed.dailyRate || 0 };
    _assignSelectedPatient = null;

    document.getElementById('assignBedDocId').value = docId;
    document.getElementById('assignBedInfo').innerHTML = '<i class="fa-solid fa-bed" style="color:#0D7A70;margin-right:6px;"></i>'
        + '<strong>' + bed.bedNumber + '</strong> — ' + bed.ward
        + ' · ₹' + (bed.dailyRate || 0).toLocaleString('en-IN') + '/day';
    document.getElementById('assignPatientSearch').value = '';
    document.getElementById('assignPatientDropdown').style.display = 'none';
    document.getElementById('assignSelectedPatientCard').style.display = 'none';

    // Default dates
    var today = todayIso();
    document.getElementById('assignAdmissionDate').value = today;
    document.getElementById('assignExpectedDischarge').value = '';

    closeModal('bedActionModal');
    document.getElementById('assignPatientModal').style.display = 'flex';
}
window.openAssignPatientModal = openAssignPatientModal;

function searchPatientForBed(query) {
    var dropdown = document.getElementById('assignPatientDropdown');
    if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = '<div style="padding:10px;color:#666;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    dropdown.style.display = 'block';

    var results = [];
    db.collection('patients').where('patientId', '==', query).get()
    .then(function(snap) {
        snap.forEach(function(doc) { results.push(Object.assign({ docId: doc.id }, doc.data())); });
        return db.collection('patients').orderBy('nameLower').startAt(query.toLowerCase()).endAt(query.toLowerCase() + '\uf8ff').limit(6).get();
    })
    .then(function(snap) {
        snap.forEach(function(doc) {
            if (!results.find(function(r) { return r.docId === doc.id; }))
                results.push(Object.assign({ docId: doc.id }, doc.data()));
        });
        if (!results.length) {
            dropdown.innerHTML = '<div style="padding:10px;color:#888;">No patients found.</div>';
            return;
        }
        dropdown.innerHTML = results.map(function(p) {
            return '<div onclick="selectPatientForBed(this)" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;" '
                + 'onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'white\'" '
                + 'data-docid="' + escapeHtml(p.docId) + '" data-id="' + escapeHtml(p.patientId || '') + '" data-name="' + escapeHtml(p.name || '') + '" data-phone="' + escapeHtml(p.phone || '') + '">'
                + '<strong>' + escapeHtml(p.name || 'Unknown') + '</strong> <span style="color:#0D7A70;font-size:12px;">' + escapeHtml(p.patientId || '') + '</span>'
                + '<br><small style="color:#888;">' + escapeHtml(p.phone || '') + ' | ' + escapeHtml(p.department || '') + '</small>'
                + '</div>';
        }).join('');
    })
    .catch(function(err) {
        dropdown.innerHTML = '<div style="padding:10px;color:red;">Error: ' + err.message + '</div>';
    });
}
window.searchPatientForBed = searchPatientForBed;

function selectPatientForBed(el) {
    _assignSelectedPatient = {
        docId: el.dataset.docid,
        patientId: el.dataset.id,
        name: el.dataset.name,
        phone: el.dataset.phone
    };
    document.getElementById('assignPatientSearch').value = _assignSelectedPatient.name + ' — ' + _assignSelectedPatient.patientId;
    document.getElementById('assignPatientDropdown').style.display = 'none';
    var card = document.getElementById('assignSelectedPatientCard');
    card.style.display = 'block';
    card.innerHTML = '<i class="fa-solid fa-user-check" style="color:#0D7A70;margin-right:6px;"></i>'
        + '<strong>' + escapeHtml(_assignSelectedPatient.name) + '</strong> · ' + escapeHtml(_assignSelectedPatient.patientId);
}
window.selectPatientForBed = selectPatientForBed;

let assigningPatient = false;
function confirmAssignPatient() {
    if (assigningPatient) return;
    if (!_assignSelectedPatient) { showToast('Please select a patient.', 'warning'); return; }
    if (!_assignBedData) return;

    var admissionDate = document.getElementById('assignAdmissionDate').value;
    var expectedDischarge = document.getElementById('assignExpectedDischarge').value;
    if (!admissionDate || (expectedDischarge && expectedDischarge < admissionDate)) { showToast('Enter valid admission and discharge dates.', 'warning'); return; }
    const selectedBed = Object.assign({}, _assignBedData);
    const selectedPatient = Object.assign({}, _assignSelectedPatient);
    assigningPatient = true;
    var admissionRef = db.collection('admissions').doc();
    return db.runTransaction(async function(batch) {
    const bedRef = db.collection('beds').doc(selectedBed.docId);
    const patientRef = db.collection('patients').doc(selectedPatient.docId);
    const bedSnapshot = await batch.get(bedRef);
    const patientSnapshot = await batch.get(patientRef);
    if (!bedSnapshot.exists || !['available', 'reserved'].includes(bedSnapshot.data().status)) throw new Error('This bed has already been assigned or is unavailable.');
    if (!patientSnapshot.exists) throw new Error('Patient record no longer exists.');
    if (patientSnapshot.data().currentBedId) throw new Error('Patient is already assigned to a bed. Discharge or transfer the current admission first.');
    batch.update(bedRef, {
        status: 'occupied',
        patientId: selectedPatient.patientId,
        patientDocId: selectedPatient.docId,
        patientName: selectedPatient.name,
        admittedAt: admissionDate,
        expectedDischargeDate: expectedDischarge || null,
        activeAdmissionId: admissionRef.id,
        billId: null,
        billDocId: null,
        assignedBy: currentUserEmail,
        assignedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    batch.set(admissionRef, {
        patientId: selectedPatient.patientId,
        patientDocId: selectedPatient.docId,
        patientName: selectedPatient.name,
        bedDocId: selectedBed.docId,
        bedNumber: bedSnapshot.data().bedNumber,
        ward: bedSnapshot.data().ward,
        dailyRate: bedSnapshot.data().dailyRate,
        admissionDate: admissionDate,
        expectedDischargeDate: expectedDischarge || null,
        billId: null,
        status: 'admitted',
        admittedBy: currentUserEmail,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Update patient status to admitted
    if (selectedPatient.docId) {
        batch.update(patientRef, {
            status: 'admitted',
            currentBedId: selectedBed.docId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    }).then(function() {
        logBedAudit(selectedBed.docId, selectedBed.bedNumber, 'available', 'occupied');
        showToast('Patient ' + selectedPatient.name + ' assigned to bed ' + selectedBed.bedNumber + '.', 'success');
        closeModal('assignPatientModal');
        _assignSelectedPatient = null;
        _assignBedData = null;
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); }).finally(function () { assigningPatient = false; });
}
window.confirmAssignPatient = confirmAssignPatient;

// ==========================================
// ADD NEW BED
// ==========================================
document.getElementById('addBedBtn').addEventListener('click', function() {
    document.getElementById('newBedNumber').value = '';
    document.getElementById('newBedWard').value = '';
    document.getElementById('newBedRate').value = '';
    document.getElementById('newBedNotes').value = '';
    document.getElementById('addBedModal').style.display = 'flex';
});

function saveNewBed() {
    var num = document.getElementById('newBedNumber').value.trim();
    var ward = document.getElementById('newBedWard').value;
    var rate = parseFloat(document.getElementById('newBedRate').value) || 0;
    var notes = document.getElementById('newBedNotes').value.trim();

    if (!num || !ward) { showToast('Bed number and ward are required.', 'warning'); return; }

    db.collection('beds').add({
        bedNumber: num,
        ward: ward,
        dailyRate: rate,
        notes: notes,
        status: 'available',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUserEmail
    }).then(function() {
        showToast('Bed ' + num + ' added successfully!', 'success');
        closeModal('addBedModal');
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); });
}
window.saveNewBed = saveNewBed;

// ==========================================
// EDIT BED
// ==========================================
function openEditBedModal(docId) {
    var bed = allBeds.find(function(b) { return b.docId === docId; });
    if (!bed) return;
    document.getElementById('editBedDocId').value = docId;
    document.getElementById('editBedNumber').value = bed.bedNumber || '';
    document.getElementById('editBedWard').value = bed.ward || '';
    document.getElementById('editBedRate').value = bed.dailyRate || 0;
    document.getElementById('editBedNotes').value = bed.notes || '';
    document.getElementById('editBedModal').style.display = 'flex';
}
window.openEditBedModal = openEditBedModal;

function saveEditBed() {
    var docId = document.getElementById('editBedDocId').value;
    var num = document.getElementById('editBedNumber').value.trim();
    var ward = document.getElementById('editBedWard').value;
    var rate = parseFloat(document.getElementById('editBedRate').value) || 0;
    var notes = document.getElementById('editBedNotes').value.trim();

    if (!num || !ward) { showToast('Bed number and ward are required.', 'warning'); return; }

    db.collection('beds').doc(docId).update({
        bedNumber: num,
        ward: ward,
        dailyRate: rate,
        notes: notes,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUserEmail
    }).then(function() {
        showToast('Bed updated successfully.', 'success');
        closeModal('editBedModal');
    }).catch(function(e) { showToast('Error: ' + e.message, 'error'); });
}
window.saveEditBed = saveEditBed;

// ==========================================
// ASSIGN BED FROM BILLING (called from billing.js)
// ==========================================
function assignBed(bedId, patientId, patientName, billId) {
    var today = todayIso();
    return db.collection('beds').doc(bedId).update({
        status: 'occupied',
        patientId: patientId,
        patientName: patientName,
        billId: billId,
        admittedAt: today,
        assignedBy: currentUserEmail,
        assignedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
window.assignBed = assignBed;

function releaseBed(bedId) {
    return db.collection('beds').doc(bedId).update({
        status: 'cleaning',
        patientId: null,
        patientName: null,
        billId: null,
        dischargedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
window.releaseBed = releaseBed;

// ==========================================
// UTILITY
// ==========================================
function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
}
window.closeModal = closeModal;

document.addEventListener('DOMContentLoaded', () => {
    const assignAdm = document.getElementById('assignAdmissionDate');
    const assignDis = document.getElementById('assignExpectedDischarge');
    if (assignAdm && assignDis) {
        assignAdm.addEventListener('change', () => { assignDis.min = assignAdm.value; });
        assignDis.addEventListener('change', () => {
            if (assignDis.value && assignAdm.value && assignDis.value < assignAdm.value) {
                showToast("Expected discharge date must be equal to or after admission date.", "warning");
                assignDis.value = assignAdm.value;
            }
        });
    }
});
