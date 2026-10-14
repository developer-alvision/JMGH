// ==========================================
// OP QUEUE & VITALS TRIAGE JS
// ==========================================

checkAccess(['admin', 'receptionist', 'doctor', 'nurse']);

var qUser = null;
var qTokens = [];
var qAppointments = [];
var allDoctorsList = [];
var qDoctorId = '';
var qSelectedPatientDocId = '';
var isOpQuickPatient = false;

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    qUser = user;
    
    loadDoctors().then(function (docs) {
        allDoctorsList = docs;
        var sel = document.getElementById('qDoctor');
        var vitalsDocSel = document.getElementById('vitalsDoctorSelect');
        
        var optionsHtml = '<option value="">All Doctors</option>' + docs.map(function (d) {
            return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + ' (' + escapeHtml(d.department || 'OPD') + ')</option>';
        }).join('');
        
        sel.innerHTML = optionsHtml;
        if (vitalsDocSel) {
            vitalsDocSel.innerHTML = docs.map(function (d) {
                return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + ' (' + escapeHtml(d.department || 'OPD') + ')</option>';
            }).join('');
        }
        
        if ((user.role || '').toLowerCase() === 'doctor') {
            const myDoc = docs.find(d => d.name === user.name || d.id === user.docId || d.id === user.uid);
            if (myDoc) {
                sel.value = myDoc.id;
            } else {
                sel.value = user.docId || user.uid;
            }
            sel.disabled = true;
        }
        qDoctorId = sel.value;
        sel.onchange = function () { 
            qDoctorId = sel.value;
            renderAllQueues();
        };
    });

    listenTodayData();
    setupOpEventListeners();
});

function todayKey() { return todayIso(); }

// Listen to both opTokens and appointments for today
function listenTodayData() {
    const today = todayKey();
    
    // 1. Listen to opTokens for today
    db.collection('opTokens').where('date', '==', today)
        .onSnapshot(function (snap) {
            qTokens = [];
            snap.forEach(function (doc) {
                var t = doc.data(); t._id = doc.id;
                if (window.hmsBranch && !hmsBranch.matches(t)) return;
                qTokens.push(t);
            });
            renderAllQueues();
        }, function (err) {
            console.warn('opTokens snapshot error:', err);
        });

    // 2. Listen to appointments for today
    db.collection('appointments').where('appointmentDate', '==', today)
        .onSnapshot(function (snap) {
            qAppointments = [];
            snap.forEach(function (doc) {
                var a = doc.data(); a._id = doc.id;
                if (a.status !== 'cancelled') {
                    qAppointments.push(a);
                }
            });
            renderAllQueues();
        }, function (err) {
            console.warn('appointments snapshot error:', err);
        });
}

function setupOpEventListeners() {
    // Open Walk-in Modal
    var walkInBtn = document.getElementById('qWalkInBtn');
    if (walkInBtn) {
        walkInBtn.onclick = function () {
            openTakeVitalsModal(null);
        };
    }

    var nextBtn = document.getElementById('qNextBtn');
    if (nextBtn) {
        nextBtn.onclick = callNext;
    }

    // Form submit
    var form = document.getElementById('qIssueForm');
    if (form) {
        form.onsubmit = saveVitalsAndIssueToken;
    }

    // Quick patient toggle in Walk-in
    var btnToggle = document.getElementById('btnOpToggleQuickPatient');
    var btnCancel = document.getElementById('btnOpCancelQuickPatient');
    var quickSec = document.getElementById('opQuickPatientSection');
    var searchWrap = document.getElementById('opSearchInputWrap');

    if (btnToggle) {
        btnToggle.onclick = function() {
            isOpQuickPatient = true;
            quickSec.style.display = 'block';
            searchWrap.style.display = 'none';
            qSelectedPatientDocId = '';
            document.getElementById('qPatientSearch').value = '';
            var nameInput = document.getElementById('opQuickName');
            if (nameInput) nameInput.focus();
        };
    }

    if (btnCancel) {
        btnCancel.onclick = function() {
            isOpQuickPatient = false;
            quickSec.style.display = 'none';
            searchWrap.style.display = 'block';
        };
    }

    // Autocomplete patient search
    mountPatientSearch({
        inputId: 'qPatientSearch',
        resultsId: 'qPatientSearchResults',
        onSelect: function (p) {
            qSelectedPatientDocId = p.docId || '';
            document.getElementById('qPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
            
            var sumCard = document.getElementById('vitalsPatientSummaryCard');
            var nameEl = document.getElementById('vitalsCardPatientName');
            var metaEl = document.getElementById('vitalsCardPatientMeta');
            var badgeEl = document.getElementById('vitalsCardRegBadge');
            
            if (nameEl) nameEl.textContent = p.name || 'Walk-in Patient';
            if (metaEl) metaEl.textContent = 'ID: ' + (p.patientId || '—') + ' | Phone: ' + (p.phone || '—');
            if (badgeEl) {
                if (p.registrationStatus === 'pending_completion' || p.quickOp) {
                    badgeEl.textContent = 'Register Later';
                    badgeEl.style.background = '#fef3c7';
                    badgeEl.style.color = '#92400e';
                } else {
                    badgeEl.textContent = 'Registered Patient';
                    badgeEl.style.background = '#dbeafe';
                    badgeEl.style.color = '#1e40af';
                }
            }
            if (sumCard) sumCard.style.display = 'flex';
        }
    });
}

// ==========================================
// RENDER BOTH QUEUES
// ==========================================
function renderAllQueues() {
    renderVitalsPendingQueue();
    renderDoctorQueue();
}

// Stage 1: Patients Awaiting Vitals
function renderVitalsPendingQueue() {
    var filterDoc = document.getElementById('qDoctor') ? document.getElementById('qDoctor').value : '';
    
    // Find appointments & tokens pending vitals
    var pendingItems = [];

    // Check appointments for today that need vitals
    qAppointments.forEach(function (appt) {
        if (filterDoc && appt.doctorId !== filterDoc) return;
        
        // Has vitals already been taken via opTokens or appointment?
        var existingReadyToken = qTokens.find(function (t) {
            return (t.appointmentId === appt._id || (t.patientId && t.patientId === appt.patientId)) && t.vitalsRecorded === true;
        });

        if (!existingReadyToken && appt.vitalsRecorded !== true) {
            // Check if there's a token already created for this appointment
            var linkedToken = qTokens.find(function(t) { return t.appointmentId === appt._id; });
            pendingItems.push({
                type: 'appointment',
                id: appt._id,
                tokenId: linkedToken ? linkedToken._id : null,
                tokenNo: (linkedToken && linkedToken.tokenNo) ? linkedToken.tokenNo : (appt.tokenNumber || '—'),
                time: appt.timeSlot || 'Scheduled',
                patientName: appt.patientName || '—',
                patientId: appt.patientId || '—',
                patientDocId: appt.patientDocId || '',
                doctorId: appt.doctorId || '',
                doctorName: appt.doctorName || '—',
                department: appt.department || 'OPD',
                opFee: appt.opFee !== undefined ? appt.opFee : 500,
                paymentStatus: appt.paymentStatus || 'paid',
                paymentMethod: appt.paymentMethod || 'Cash',
                chiefComplaint: appt.chiefComplaint || ''
            });
        }
    });

    // Also include any opTokens that do NOT have vitals recorded yet
    qTokens.forEach(function (token) {
        if (filterDoc && token.doctorId !== filterDoc) return;
        if (token.vitalsRecorded !== true || token.status === 'vitals_pending') {
            var alreadyIn = pendingItems.some(function (p) {
                return (p.tokenId && p.tokenId === token._id) || (token.appointmentId && p.id === token.appointmentId);
            });
            if (!alreadyIn) {
                pendingItems.push({
                    type: 'token',
                    id: token.appointmentId || null,
                    tokenId: token._id,
                    tokenNo: token.tokenNo || '—',
                    time: token.issuedAtText || 'Today',
                    patientName: token.patientName || '—',
                    patientId: token.patientId || '—',
                    patientDocId: token.patientDocId || '',
                    doctorId: token.doctorId || '',
                    doctorName: token.doctorName || '—',
                    department: token.department || 'OPD',
                    opFee: token.opFee || 0,
                    paymentStatus: token.paymentStatus || 'paid',
                    paymentMethod: token.paymentMethod || 'Cash',
                    chiefComplaint: token.chiefComplaint || ''
                });
            }
        }
    });

    // Update counter badge
    var pendingBadge = document.getElementById('vitalsPendingBadge');
    if (pendingBadge) pendingBadge.textContent = pendingItems.length + ' Patient' + (pendingItems.length === 1 ? '' : 's');
    var vitalsPendingCard = document.getElementById('qVitalsPending');
    if (vitalsPendingCard) vitalsPendingCard.textContent = pendingItems.length;

    var tbody = document.getElementById('vitalsQueueBody');
    if (!tbody) return;

    if (pendingItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#64748b;"><i class="fa-solid fa-circle-check" style="color:#16a34a;margin-right:6px;"></i> All checked-in patients have completed vitals triage!</td></tr>';
        return;
    }

    tbody.innerHTML = pendingItems.map(function (item, index) {
        var feeBadge = '';
        if (item.paymentStatus === 'free') {
            feeBadge = '<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;"><i class="fa-solid fa-gift"></i> Free OP</span>';
        } else if (item.paymentStatus === 'due') {
            feeBadge = '<span style="background:#ffedd5; color:#c2410c; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;"><i class="fa-solid fa-clock"></i> ₹' + (item.opFee || 0) + ' Due</span>';
        } else {
            feeBadge = '<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;"><i class="fa-solid fa-check"></i> ₹' + (item.opFee || 0) + ' (' + escapeHtml(item.paymentMethod || 'Paid') + ')</span>';
        }

        var isQuick = (item.patientId && item.patientId.startsWith('SA-')) && (item.registrationStatus === 'pending_completion');
        var regBadge = isQuick ? '<span style="background:#fef3c7; color:#92400e; font-size:10px; padding:1px 6px; border-radius:8px; margin-left:4px;">Register Later</span>' : '';

        return '<tr>'
            + '<td><strong style="color:var(--primary-teal); font-size:14px;">#' + (item.tokenNo || (index + 1)) + '</strong><div class="cell-sub">' + escapeHtml(item.time) + '</div></td>'
            + '<td><strong>' + escapeHtml(item.patientName) + '</strong>' + regBadge + '</td>'
            + '<td><span class="id-badge">' + escapeHtml(item.patientId) + '</span></td>'
            + '<td><div><strong>' + escapeHtml(item.doctorName) + '</strong></div><div class="cell-sub">' + escapeHtml(item.department) + '</div></td>'
            + '<td>' + feeBadge + '</td>'
            + '<td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escapeHtml(item.chiefComplaint) + '">' + escapeHtml(item.chiefComplaint || '—') + '</td>'
            + '<td style="text-align:right;">'
            + '<button class="btn-primary" type="button" style="background:#0D7A70; padding:6px 12px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:6px; cursor:pointer;" onclick="triggerVitalsModal(' + index + ')">'
            + '<i class="fa-solid fa-heart-pulse"></i> Take Vitals'
            + '</button>'
            + '</td>'
            + '</tr>';
    }).join('');

    // Keep pendingItems accessible for click handlers
    window._pendingVitalsItems = pendingItems;
}

window.triggerVitalsModal = function(index) {
    if (window._pendingVitalsItems && window._pendingVitalsItems[index]) {
        openTakeVitalsModal(window._pendingVitalsItems[index]);
    }
};

// Stage 2: Doctor Queue (Ready with Vitals)
function renderDoctorQueue() {
    var filterDoc = document.getElementById('qDoctor') ? document.getElementById('qDoctor').value : '';
    
    // CRITICAL: Patients in Stage 2 MUST have vitals actually recorded!
    // If vitals are not recorded, the patient belongs in Stage 1 ONLY!
    var readyTokens = qTokens.filter(function (t) {
        if (t.vitalsRecorded !== true) return false;
        if (t.status === 'vitals_pending') return false;
        if (!['waiting', 'serving', 'done'].includes(t.status)) return false;
        if (filterDoc && t.doctorId !== filterDoc) return false;
        return true;
    });

    readyTokens.sort(function (a, b) { return (a.tokenNo || 0) - (b.tokenNo || 0); });

    var waiting = readyTokens.filter(function (t) { return t.status === 'waiting'; });
    var serving = readyTokens.filter(function (t) { return t.status === 'serving'; });
    var done = readyTokens.filter(function (t) { return t.status === 'done'; });

    var nowServingEl = document.getElementById('qNow');
    if (nowServingEl) {
        nowServingEl.textContent = serving.length ? ('T-' + serving[0].tokenNo + ' · ' + (serving[0].patientName || '')) : '—';
    }
    var waitingEl = document.getElementById('qWaiting');
    if (waitingEl) waitingEl.textContent = waiting.length;
    var doneEl = document.getElementById('qDone');
    if (doneEl) doneEl.textContent = done.length;

    var readyBadge = document.getElementById('readyQueueBadge');
    if (readyBadge) readyBadge.textContent = waiting.length + ' Waiting';

    var body = document.getElementById('qBody');
    if (!body) return;

    if (!readyTokens.length) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#888;">No patients currently in the doctor consultation queue. Record vitals above to add patients.</td></tr>';
        return;
    }

    body.innerHTML = readyTokens.map(function (t) {
        var v = t.vitals || {};
        var vitalsBadges = [];
        if (v.bp) vitalsBadges.push('<strong>BP:</strong> ' + escapeHtml(v.bp));
        if (v.pulse) vitalsBadges.push('<strong>Pulse:</strong> ' + escapeHtml(v.pulse));
        if (v.temperature || v.temp) vitalsBadges.push('<strong>Temp:</strong> ' + escapeHtml(v.temperature || v.temp) + '°F');
        if (v.weight) vitalsBadges.push('<strong>Wt:</strong> ' + escapeHtml(v.weight) + 'kg');
        if (v.spo2) vitalsBadges.push('<strong>SpO2:</strong> ' + escapeHtml(v.spo2) + '%');
        var vitalsHtml = vitalsBadges.length ? vitalsBadges.join(' | ') : '<span style="color:#94a3b8;">Pending</span>';

        var consultHref = 'consultation.html?patientId=' + encodeURIComponent(t.patientId || '')
            + '&tokenId=' + encodeURIComponent(t._id || '')
            + (t.consultationId ? ('&consultationId=' + encodeURIComponent(t.consultationId)) : '');

        var statusBadgeHtml = '';
        if (t.status === 'serving') {
            statusBadgeHtml = '<span style="background:#eff6ff; color:#1d4ed8; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;"><i class="fa-solid fa-spinner fa-spin"></i> In Cabin</span>';
        } else if (t.status === 'done') {
            statusBadgeHtml = '<span style="background:#f0fdf4; color:#15803d; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;"><i class="fa-solid fa-check"></i> Completed</span>';
        } else {
            statusBadgeHtml = '<span style="background:#fef3c7; color:#b45309; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700;"><i class="fa-regular fa-clock"></i> Waiting</span>';
        }

        return '<tr>'
            + '<td><strong style="color:var(--primary-teal); font-size:1.1rem;">T-' + t.tokenNo + '</strong></td>'
            + '<td><strong>' + escapeHtml(t.patientName || '') + '</strong><div class="cell-sub">' + escapeHtml(t.patientId || '') + '</div></td>'
            + '<td>' + escapeHtml(t.doctorName || '') + '</td>'
            + '<td style="font-size:12px; color:#334155; max-width:240px;">' + vitalsHtml + '</td>'
            + '<td>' + statusBadgeHtml + '</td>'
            + '<td>' + escapeHtml(t.issuedAtText || '') + '</td>'
            + '<td style="white-space:nowrap; text-align:right;">'
            + (t.status === 'waiting' ? '<button class="btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:600; margin-right:4px;" onclick="serveToken(\'' + t._id + '\')"><i class="fa-solid fa-bell"></i> Call</button>' : '')
            + (t.status === 'serving' ? '<button class="btn-primary" style="padding:4px 10px; font-size:12px; font-weight:600; margin-right:4px; background:#16a34a;" onclick="doneToken(\'' + t._id + '\')"><i class="fa-solid fa-check"></i> Done</button>' : '')
            + (t.patientId ? '<a class="btn-primary" style="padding:4px 10px; font-size:12px; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px; background:#0F2B5B;" href="' + consultHref + '"><i class="fa-solid fa-stethoscope"></i> Consult</a>' : '')
            + '</td></tr>';
    }).join('');
}

// ==========================================
// TAKE VITALS MODAL LOGIC
// ==========================================
function openTakeVitalsModal(item) {
    var modal = document.getElementById('qIssueModal');
    if (!modal) return;
    
    var titleEl = document.getElementById('vitalsModalTitle');
    var searchGroup = document.getElementById('vitalsPatientSearchGroup');
    var quickSec = document.getElementById('opQuickPatientSection');
    var sumCard = document.getElementById('vitalsPatientSummaryCard');
    var docRow = document.getElementById('vitalsDoctorRow');
    
    // Reset form inputs
    ['qBp', 'qPulse', 'qTemp', 'qWeight', 'qSpo2', 'qRbs', 'qChief'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });
    isOpQuickPatient = false;
    if (quickSec) quickSec.style.display = 'none';

    if (item) {
        // Pre-selected patient from Stage 1 (Waiting for Vitals)
        document.getElementById('vitalsTargetTokenId').value = item.tokenId || '';
        document.getElementById('vitalsTargetApptId').value = item.id || '';
        document.getElementById('vitalsPatientDocId').value = item.patientDocId || '';
        
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-heart-pulse" style="color:#0D7A70; margin-right:6px;"></i> Take Vitals for ' + escapeHtml(item.patientName);
        if (searchGroup) searchGroup.style.display = 'none';
        if (docRow) docRow.style.display = 'none';
        
        // Show summary banner
        if (sumCard) sumCard.style.display = 'flex';
        document.getElementById('vitalsCardPatientName').textContent = item.patientName;
        document.getElementById('vitalsCardPatientMeta').textContent = 'ID: ' + item.patientId + ' | Doctor: ' + item.doctorName + ' (' + item.department + ')';
        
        var badge = document.getElementById('vitalsCardRegBadge');
        if (badge) {
            badge.textContent = 'Token #' + (item.tokenNo || 'New');
            badge.style.background = '#e0f2fe';
            badge.style.color = '#0369a1';
        }

        if (item.chiefComplaint) {
            var chiefInput = document.getElementById('qChief');
            if (chiefInput) chiefInput.value = item.chiefComplaint;
        }

        // Store selected doctor
        window._currentVitalsDoctorId = item.doctorId;
        window._currentVitalsDoctorName = item.doctorName;
        window._currentVitalsPatientName = item.patientName;
        window._currentVitalsPatientId = item.patientId;
    } else {
        // New walk-in
        document.getElementById('vitalsTargetTokenId').value = '';
        document.getElementById('vitalsTargetApptId').value = '';
        document.getElementById('vitalsPatientDocId').value = '';
        
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-heart-pulse" style="color:#0D7A70; margin-right:6px;"></i> Walk-in Vitals &amp; OP Token';
        if (searchGroup) searchGroup.style.display = 'block';
        if (docRow) docRow.style.display = 'block';
        if (sumCard) sumCard.style.display = 'none';
        
        document.getElementById('qPatientSearch').value = '';
        qSelectedPatientDocId = '';
        window._currentVitalsDoctorId = '';
        window._currentVitalsDoctorName = '';
        window._currentVitalsPatientName = '';
        window._currentVitalsPatientId = '';
    }

    modal.classList.add('active');
}

function closeVitalsModal() {
    var modal = document.getElementById('qIssueModal');
    if (modal) modal.classList.remove('active');
}
window.closeVitalsModal = closeVitalsModal;

// Sequential patient ID generator for walk-in quick patient
async function generateOpQuickPatientId() {
    const counterRef = db.collection('patientCounter').doc('counter');
    try {
        return await db.runTransaction(async (tx) => {
            const doc = await tx.get(counterRef);
            const count = doc.exists ? (doc.data().count || 0) + 1 : 1;
            tx.set(counterRef, { count: count }, { merge: true });
            return `SA-${new Date().getFullYear()}-${String(count).padStart(5, '0')}`;
        });
    } catch (err) {
        return `SA-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    }
}

// Save Vitals and Promote to Doctor Queue
async function saveVitalsAndIssueToken(e) {
    e.preventDefault();
    
    var bp = (document.getElementById('qBp') || {}).value?.trim();
    var pulse = (document.getElementById('qPulse') || {}).value?.trim();
    var temp = (document.getElementById('qTemp') || {}).value?.trim();
    
    if (!bp || !pulse || !temp) {
        showToast('Please enter BP, Pulse, and Temperature before submitting.', 'warning');
        return;
    }

    var submitBtn = document.getElementById('btnSubmitVitals');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving vitals...';
    }

    try {
        var targetTokenId = document.getElementById('vitalsTargetTokenId').value;
        var targetApptId = document.getElementById('vitalsTargetApptId').value;
        var patientDocId = document.getElementById('vitalsPatientDocId').value;
        var patientName = window._currentVitalsPatientName;
        var patientId = window._currentVitalsPatientId;
        var doctorId = window._currentVitalsDoctorId;
        var doctorName = window._currentVitalsDoctorName;

        // Handle Walk-in if not pre-populated
        if (!patientName) {
            if (isOpQuickPatient) {
                var qName = (document.getElementById('opQuickName') || {}).value?.trim();
                var qPhone = (document.getElementById('opQuickPhone') || {}).value?.trim();
                var qAge = (document.getElementById('opQuickAge') || {}).value?.trim();
                var qGender = (document.getElementById('opQuickGender') || {}).value || 'Female';
                
                if (!qName) {
                    showToast('Please enter patient name.', 'warning');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Save Vitals &amp; Move to Doctor Queue'; }
                    return;
                }
                if (!qPhone || qPhone.length < 10) {
                    showToast('Please enter a valid 10-digit phone number.', 'warning');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Save Vitals &amp; Move to Doctor Queue'; }
                    return;
                }

                var newPid = await generateOpQuickPatientId();
                var pRef = db.collection('patients').doc();
                await pRef.set({
                    patientId: newPid,
                    name: qName,
                    nameLower: qName.toLowerCase(),
                    phone: qPhone,
                    age: Number(qAge) || null,
                    gender: qGender,
                    registrationStatus: 'pending_completion',
                    quickOp: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: (qUser && (qUser.name || qUser.email)) || ''
                });

                patientName = qName;
                patientId = newPid;
                patientDocId = pRef.id;
            } else {
                // Must have searched patient
                if (!qSelectedPatientDocId) {
                    showToast('Please select an existing patient or use Quick New Patient.', 'warning');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Save Vitals &amp; Move to Doctor Queue'; }
                    return;
                }
                var pSnap = await db.collection('patients').doc(qSelectedPatientDocId).get();
                if (pSnap.exists) {
                    var pData = pSnap.data();
                    patientName = pData.name;
                    patientId = pData.patientId;
                    patientDocId = pSnap.id;
                }
            }

            var docSel = document.getElementById('vitalsDoctorSelect');
            if (docSel && docSel.selectedOptions[0]) {
                doctorId = docSel.value;
                doctorName = docSel.selectedOptions[0].textContent;
            }
        }

        if (!doctorId) {
            var mainDoc = document.getElementById('qDoctor');
            doctorId = (mainDoc && mainDoc.value) || (allDoctorsList[0] ? allDoctorsList[0].id : 'general');
            var foundDoc = allDoctorsList.find(d => d.id === doctorId);
            doctorName = foundDoc ? foundDoc.name : 'General OP';
        }

        var vitals = {
            bp: bp,
            pulse: pulse,
            temperature: temp,
            weight: (document.getElementById('qWeight') || {}).value ? document.getElementById('qWeight').value.trim() : '',
            spo2: (document.getElementById('qSpo2') || {}).value ? document.getElementById('qSpo2').value.trim() : '',
            rbs: (document.getElementById('qRbs') || {}).value ? document.getElementById('qRbs').value.trim() : ''
        };
        var chief = (document.getElementById('qChief') || {}).value ? document.getElementById('qChief').value.trim() : '';

        // Calculate next token number
        var nextNo = qTokens.reduce(function (m, t) { return Math.max(m, t.tokenNo || 0); }, 0) + 1;
        var consultationId = 'cons-op-' + Date.now();

        var batch = db.batch();
        var tokenRef = targetTokenId ? db.collection('opTokens').doc(targetTokenId) : db.collection('opTokens').doc();

        var tokenData = {
            date: todayKey(),
            tokenNo: nextNo,
            patientName: patientName,
            patientId: patientId,
            patientDocId: patientDocId || '',
            doctorId: doctorId,
            doctorName: doctorName,
            status: 'waiting',
            vitals: vitals,
            vitalsRecorded: true,
            chiefComplaint: chief,
            consultationId: consultationId,
            issuedAt: firebase.firestore.FieldValue.serverTimestamp(),
            issuedAtText: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            createdBy: (qUser && (qUser.name || qUser.email)) || ''
        };

        if (window.hmsBranch) {
            tokenData = hmsBranch.stamp(tokenData);
        }

        if (targetTokenId) {
            batch.update(tokenRef, tokenData);
        } else {
            batch.set(tokenRef, tokenData);
        }

        // Update appointment status if mapped
        if (targetApptId) {
            batch.update(db.collection('appointments').doc(targetApptId), {
                vitalsRecorded: true,
                vitals: vitals,
                status: 'in_progress',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        // Create draft consultation note with vitals so doctor sees them immediately
        var consRef = db.collection('consultations').doc(consultationId);
        batch.set(consRef, {
            consultationId: consultationId,
            tokenId: tokenRef.id,
            tokenNo: nextNo,
            patientId: patientId,
            patientName: patientName,
            patientDocId: patientDocId || '',
            doctorId: doctorId,
            doctorName: doctorName,
            department: '',
            vitals: vitals,
            chiefComplaint: chief,
            status: 'draft',
            source: 'op_queue',
            date: todayKey(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: (qUser && (qUser.name || qUser.email)) || ''
        });

        await batch.commit();
        showToast(`Vitals recorded for ${patientName}! Patient moved to Doctor Queue (Token T-${nextNo}).`, 'success');
        closeVitalsModal();
    } catch (err) {
        console.error('Error recording vitals:', err);
        showToast('Error saving vitals: ' + err.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Save Vitals &amp; Move to Doctor Queue';
        }
    }
}

// ==========================================
// TOKEN SERVING ACTIONS
// ==========================================
window.serveToken = function (id) {
    var curDocId = document.getElementById('qDoctor').value;
    var batch = db.batch();
    qTokens.filter(function (t) { return t.status === 'serving' && (!curDocId || t.doctorId === curDocId); }).forEach(function (t) {
        batch.update(db.collection('opTokens').doc(t._id), { status: 'done' });
    });
    batch.update(db.collection('opTokens').doc(id), { status: 'serving', calledAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.commit().then(function () {
        showToast('Patient called into cabin. Click Consult to begin examination.', 'success');
    }).catch(function (err) {
        showToast(err.message, 'error');
    });
};

window.doneToken = function (id) {
    db.collection('opTokens').doc(id).update({
        status: 'done',
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
        showToast('Consultation marked completed for patient.', 'success');
    }).catch(function (err) {
        showToast(err.message, 'error');
    });
};

function callNext() {
    var curDocId = document.getElementById('qDoctor').value;
    var next = qTokens.find(function (t) {
        return t.status === 'waiting' && t.vitalsRecorded === true && (!curDocId || t.doctorId === curDocId);
    }) || qTokens.find(function (t) {
        return t.status === 'waiting' && t.vitalsRecorded === true;
    });

    if (!next) {
        showToast('No patients waiting in the doctor consultation queue.', 'info');
        return;
    }
    window.serveToken(next._id);
}
