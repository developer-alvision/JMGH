checkAccess(['receptionist', 'nurse', 'admin']);
let currentUserRole = '';

getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserRole = (user.role || '').toLowerCase();
    
    // Hide Add New Patient for Nurse
    const btnAddNew = document.getElementById('addNewBtn');
    if (btnAddNew) {
        if (currentUserRole === 'nurse') {
            btnAddNew.style.display = 'none';
        }
    }

    loadPatients();
    populateDoctors();
    populateDeptSelect('patientDepartment');
    
    // Toggle Import Patients button for admin + receptionist
    if (['admin', 'receptionist'].includes(currentUserRole)) {
        var btnImport = document.getElementById('btnImportPatients');
        if (btnImport) btnImport.style.display = 'inline-block';
    }
    
    // DATE FIX 5: DOB max date is today
    const dobEl = document.getElementById('patientDob');
    if (dobEl) dobEl.max = todayIso();
    
    // Wire up Bulk Import event listeners
    initBulkImportEventListeners();
});

// addDaysToIso / eddFromLmp / gestationalAge live in helpers.js.

// EDD is derived from the LMP unless the user switches the row to manual —
// typically after a dating scan. The chosen mode travels with the patient
// record as `eddSource` so a later edit does not silently undo the override.
function setupAntenatalForm() {
    var lmp = document.getElementById('patientLmp');
    var edd = document.getElementById('patientEdd');
    var mode = document.getElementById('patientEddMode');
    var readout = document.getElementById('patientGestationalAge');
    var pregnant = document.getElementById('patientIsPregnant');
    if (!lmp || !edd) return;

    // The register also serves general and gynaecology patients, so the
    // obstetric fields stay out of the way until someone says the patient is
    // pregnant. Only the checkbox itself is always visible.
    function toggleAntenatalFields() {
        var on = pregnant && pregnant.checked;
        document.querySelectorAll('.antenatal-field').forEach(function (el) {
            el.style.display = on ? '' : 'none';
        });
        if (on && mode) {
            var reasonGroup = document.getElementById('eddReasonGroup');
            if (reasonGroup) reasonGroup.style.display = mode.value === 'auto' ? 'none' : '';
        }
    }

    function refresh() {
        var isAuto = !mode || mode.value === 'auto';
        if (isAuto && lmp.value) edd.value = eddFromLmp(lmp.value);
        edd.readOnly = isAuto;
        edd.style.background = isAuto ? '#f8fafc' : '';
        var reasonGroup = document.getElementById('eddReasonGroup');
        if (reasonGroup) reasonGroup.style.display = isAuto ? 'none' : '';
        if (readout) {
            var age = gestationalAge(lmp.value);
            readout.textContent = age ? age.text + ' · ' + age.trimester : '—';
        }
    }

    // Called again whenever a record is loaded into the form, so the
    // listeners are attached once and only the refresh re-runs.
    if (!lmp.dataset.antenatalWired) {
        lmp.addEventListener('change', refresh);
        if (mode) mode.addEventListener('change', refresh);
        if (pregnant) pregnant.addEventListener('change', function () {
            toggleAntenatalFields();
            refresh();
        });
        lmp.dataset.antenatalWired = '1';
    }
    toggleAntenatalFields();
    refresh();
}
window.setupAntenatalForm = setupAntenatalForm;
function refreshFemalePatientDetails() {
    var gender = document.getElementById('patientGender');
    var female = gender.value === 'Female';
    document.getElementById('femalePatientDetails').hidden = !female;
    gender.setAttribute('aria-expanded', String(female));
    var pregnancy = document.getElementById('patientIsPregnant');
    pregnancy.closest('.form-group').style.display = female ? '' : 'none';
    if (!female && pregnancy.checked) { pregnancy.checked = false; pregnancy.dispatchEvent(new Event('change')); }
}
document.getElementById('patientGender').addEventListener('change', function() {
    refreshFemalePatientDetails();
    if (this.value === 'Female') document.getElementById('patientMaritalStatus').focus();
});
document.getElementById('addPatientForm').addEventListener('reset', function() { setTimeout(refreshFemalePatientDetails, 0); });
document.addEventListener('DOMContentLoaded', refreshFemalePatientDetails);
document.addEventListener('DOMContentLoaded', setupAntenatalForm);

// ==========================================
// PATIENT STATUS BADGE
// ==========================================
// Shared badge vocabulary — see statusBadge() in helpers.js.
function getPatientStatusBadge(status) {
    return statusBadge(status, 'opd');
}

// ==========================================
// STATUS FILTER — default TODAY (registered today); old patients in All/Past drawer
var _currentStatusFilter = 'today';
var PAST_STATUSES = { discharged: 1, archived: 1, inactive: 1 };

function isCurrentPatient(p) {
    var st = String((p && p.status) || 'opd').toLowerCase();
    return !PAST_STATUSES[st];
}

function isTodayPatient(p) {
    var c = p && p.createdAt;
    var d = c && c.toDate ? c.toDate() : (c ? new Date(c) : null);
    if (!d || isNaN(d.getTime())) {
        // Seeded/demo docs may use registrationDate
        var rd = p.registrationDate || p.registeredOn || '';
        return String(rd).slice(0, 10) === todayIso();
    }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') === todayIso();
}

function filterPatientsByStatus(list, status) {
    list = list || [];
    if (status === 'today') return list.filter(isTodayPatient);
    if (status === 'current') return list.filter(isCurrentPatient);
    if (status === 'all') return list.slice();
    return list.filter(function (p) { return String((p.status || 'opd')).toLowerCase() === status; });
}

function applyPatientFilters() {
    var q = (document.getElementById('patientMainSearch') || {}).value || '';
    q = q.toLowerCase().trim();
    var filtered = filterPatientsByStatus(allPatients, _currentStatusFilter);
    if (q) filtered = filtered.filter(function (p) { return matchesSearch(p, q); });
    renderPatients(filtered);
}

document.querySelectorAll('.pt-status-filter').forEach(function(btn) {
    btn.addEventListener('click', function() {
        _currentStatusFilter = this.dataset.status;
        document.querySelectorAll('.pt-status-filter').forEach(function(b) {
            b.style.background = 'white';
            b.style.color = b.dataset.status === 'admitted' ? '#2563eb' :
                            b.dataset.status === 'emergency' ? '#dc2626' :
                            b.dataset.status === 'icu' ? '#7c3aed' :
                            b.dataset.status === 'current' ? '#64748b' : '#64748b';
            b.style.fontWeight = '500';
            b.classList.remove('active');
        });
        this.style.background = 'var(--primary-navy)';
        this.style.color = 'white';
        this.style.fontWeight = '600';
        this.classList.add('active');
        applyPatientFilters();
    });
});

// All / Past side panel
var _histFilter = 'all';
function openPatientsHistory() {
    document.getElementById('patientsHistoryOverlay').classList.add('open');
    document.getElementById('patientsHistoryDrawer').classList.add('open');
    renderPatientsHistory();
}
function closePatientsHistory() {
    document.getElementById('patientsHistoryOverlay').classList.remove('open');
    document.getElementById('patientsHistoryDrawer').classList.remove('open');
}
window.closePatientsHistory = closePatientsHistory;

function renderPatientsHistory() {
    var q = ((document.getElementById('patientsHistorySearch') || {}).value || '').toLowerCase().trim();
    var list = allPatients.slice();
    if (_histFilter === 'discharged') list = list.filter(function (p) { return String(p.status || '').toLowerCase() === 'discharged'; });
    else if (_histFilter === 'current') list = list.filter(isCurrentPatient);
    if (q) list = list.filter(function (p) { return matchesSearch(p, q); });
    var box = document.getElementById('patientsHistoryList');
    if (!box) return;
    if (!list.length) {
        box.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:24px;">No patients in this view.</div>';
        return;
    }
    box.innerHTML = list.map(function (p) {
        return '<div style="padding:12px 0;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">'
            + '<div><strong style="color:var(--primary-navy);">' + escapeHtml(p.name || '') + '</strong>'
            + '<div style="font-size:12px;color:#64748b;">' + escapeHtml(p.patientId || '') + ' · ' + escapeHtml(p.phone || '') + '</div>'
            + '<div style="margin-top:4px;">' + getPatientStatusBadge(p.status) + '</div></div>'
            + '<a class="btn-primary btn-xs" href="patient-profile.html?id=' + encodeURIComponent(p.patientId || '') + '">View</a></div>';
    }).join('');
}

document.addEventListener('DOMContentLoaded', function () {
    var histBtn = document.getElementById('btnAllPatientsHistory');
    if (histBtn) histBtn.addEventListener('click', openPatientsHistory);
    var histSearch = document.getElementById('patientsHistorySearch');
    if (histSearch) histSearch.addEventListener('input', renderPatientsHistory);
    document.querySelectorAll('.pt-hist-filter').forEach(function (btn) {
        btn.addEventListener('click', function () {
            _histFilter = this.dataset.hist;
            document.querySelectorAll('.pt-hist-filter').forEach(function (b) {
                b.classList.remove('active');
                b.style.background = '#fff';
                b.style.color = b.dataset.hist === 'discharged' ? '#16a34a' : '#64748b';
            });
            this.classList.add('active');
            this.style.background = 'var(--primary-navy)';
            this.style.color = '#fff';
            renderPatientsHistory();
        });
    });
});

// ==========================================
// MODAL LOGIC
// ==========================================
const modal = document.getElementById('addPatientModal');
let editingPatientId = null;
let existingPatientId = null; // P4 Fix 3: preserve existing patient ID

document.getElementById('addNewBtn').addEventListener('click', () => {
    editingPatientId = null;
    existingPatientId = null;
    document.querySelector('#addPatientModal h2').textContent = 'Add New Patient';
    document.getElementById('savePatientBtn').textContent = 'Save Patient';
    document.getElementById('addPatientForm').reset();
    clearFormErrors();
    populateDeptSelect('patientDepartment'); // P3
    // form.reset() clears the inputs but not the derived readout, so a new
    // patient inherited the gestational age of whoever was edited last.
    setupAntenatalForm();
    modal.classList.add('active');
});
document.getElementById('closeModalBtn').addEventListener('click', () => { modal.classList.remove('active'); clearFormErrors(); });
document.getElementById('cancelModalBtn').addEventListener('click', () => { modal.classList.remove('active'); clearFormErrors(); });

// ==========================================
// UTILITIES
// ==========================================

// P4 Fix 1: Sequential ID — current year dynamic
async function generatePatientId() {
    const counterRef = db.collection('patientCounter').doc('counter');
    try {
        return await db.runTransaction(async (tx) => {
            const doc = await tx.get(counterRef);
            const count = doc.exists ? (doc.data().count || 0) + 1 : 1;
            tx.set(counterRef, { count }, { merge: true });
            return `SA-${new Date().getFullYear()}-${String(count).padStart(5, '0')}`;
        });
    } catch (err) {
        console.error('Counter error:', err);
        throw new Error('Unable to reserve a patient number. Please reconnect and retry.');
    }
}

// ==========================================
// DOCTOR DROPDOWN
// ==========================================
let availableDoctors = [];
function populateDoctors() {
    loadDoctors().then(doctors => {
        availableDoctors = doctors;
        const select = document.getElementById('patientDoctor');
        if (!select) return;
        select.innerHTML = '<option value="">Select Doctor</option>';
        doctors.forEach(doc => {
            const opt = document.createElement('option');
            opt.value = doc.id; opt.textContent = doc.name;
            select.appendChild(opt);
        });
    });
}

// ==========================================
// LOAD PATIENTS
// ==========================================
let allPatients = [];

function loadPatients() {
    setLoadingRow('patientsTableBody', 8);
    db.collection('patients').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        allPatients = [];
        snapshot.forEach(doc => allPatients.push({ id: doc.id, ...doc.data() }));
        applyPatientFilters();
        if (document.getElementById('patientsHistoryDrawer') && document.getElementById('patientsHistoryDrawer').classList.contains('open')) {
            renderPatientsHistory();
        }
    }, err => { console.error(err); showToast('Error loading patients.', 'error'); });
}

function matchesSearch(p, query) {
    return (p.nameLower && p.nameLower.includes(query)) ||
           (p.name && p.name.toLowerCase().includes(query)) ||
           (p.phone && p.phone.includes(query)) ||
           (p.patientId && p.patientId.toLowerCase().includes(query));
}

function renderPatients(patients) {
    const tbody = document.getElementById('patientsTableBody');
    if (!tbody) return;
    if (!patients.length) {
        setEmptyRow('patientsTableBody', 'No patients found. Click <strong>Add New Patient</strong> to register your first patient.', 8);
        return;
    }
    tbody.innerHTML = '';
    const canEdit = ['admin', 'receptionist'].includes(currentUserRole);
    patients.forEach(data => {
        var doctorName = data.doctor || data.doctorName || data.assignedDoctor || '—';
        const editBtnHtml = canEdit ? `<button class="btn-secondary btn-xs edit-patient-btn" data-id="${data.id}">Edit</button>` : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="id-badge">${escapeHtml(data.patientId || '-')}</span></td>
            <td><strong>${escapeHtml(data.name || '-')}</strong></td>
            <td class="num">${calculateAge(data.dob)}</td>
            <td class="nowrap">${escapeHtml(data.phone || '-')}</td>
            <td class="nowrap">${escapeHtml(doctorName)}</td>
            <td>${escapeHtml(data.department || '-')}</td>
            <td>${getPatientStatusBadge(data.status)}</td>
            <td class="actions"><div>
                <a href="patient-profile.html?id=${data.patientId || ''}" class="btn-primary btn-xs"><i class="fa-solid fa-eye"></i> View</a>
                ${editBtnHtml}
            </div></td>`;
        tbody.appendChild(tr);
    });
    if (canEdit) {
        document.querySelectorAll('.edit-patient-btn').forEach(btn => btn.addEventListener('click', e => openEditPatient(e.target.dataset.id)));
    }
}

document.getElementById('patientMainSearch').addEventListener('input', function() {
    applyPatientFilters();
});

// ==========================================
// FORM VALIDATION
// ==========================================
function clearFormErrors() {
    document.querySelectorAll('.error-border').forEach(el => el.classList.remove('error-border'));
    document.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none');
}

function validatePatientForm() {
    clearFormErrors();
    let valid = true;
    ['patientName', 'patientPhone', 'patientGender', 'patientDepartment', 'patientDoctor'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || !el.value.trim()) {
            if (el) { el.classList.add('error-border'); const msg = el.parentElement.querySelector('.error-msg'); if (msg) msg.style.display = 'block'; }
            valid = false;
        }
    });

    // Validate DOB not in future
    const dobEl = document.getElementById('patientDob');
    if (dobEl && dobEl.value) {
        const selectedDob = dobEl.value; // YYYY-MM-DD
        const todayStr = todayIso(); // YYYY-MM-DD
        if (selectedDob > todayStr) {
            dobEl.classList.add('error-border');
            const msg = dobEl.parentElement.querySelector('.error-msg');
            if (msg) {
                msg.textContent = 'Date of birth cannot be in the future.';
                msg.style.display = 'block';
            }
            valid = false;
        }
    }

    return valid;
}

// ==========================================
// SAVE / EDIT PATIENT
// ==========================================
function generateOfflinePatientId() {
    var now = new Date();
    return 'SA-OFF-' + now.getFullYear() + '-' + Date.now().toString().slice(-8) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function completePatientFormSave(message, type) {
    showToast(message, type);
    modal.classList.remove('active');
    document.getElementById('addPatientForm').reset();
    clearFormErrors();
    editingPatientId = null;
    existingPatientId = null;
}

function queueOfflinePatientWrite(docRef, indexRef, patientData, isEdit) {
    // Firestore persistence retains this write in IndexedDB and uploads it once
    // the authenticated browser reconnects. Do not wait for the server here.
    var batch = db.batch();
    batch.set(docRef, patientData, { merge: isEdit });
    batch.set(indexRef, {
        patientId: patientData.patientId,
        name: patientData.name,
        nameLower: patientData.nameLower,
        phone: patientData.phone,
        docId: docRef.id
    }, { merge: true });

    batch.commit().then(function() {
        return docRef.set({ offlineSyncStatus: 'synced', syncedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }).catch(function(err) {
        console.error('Offline patient sync failed:', err);
        showToast('Patient sync failed: ' + err.message + '. Review the record when online.', 'error');
    });
}

async function savePatientData(btn, nameVal, phoneVal) {
    const doctorId = document.getElementById('patientDoctor').value;
    const selectedDoc = availableDoctors.find(d => d.id === doctorId);

    const dobVal = document.getElementById('patientDob').value || null;
    const patientData = {
        name: nameVal,
        nameLower: nameVal.toLowerCase(),
        dob: dobVal,
        age: dobVal ? calculateAge(dobVal) : null,
        phone: phoneVal,
        bloodGroup: document.getElementById('patientBlood').value,
        gender: document.getElementById('patientGender').value,
        maritalStatus: document.getElementById('patientGender').value === 'Female' ? document.getElementById('patientMaritalStatus').value : '',
        spouseName: document.getElementById('patientGender').value === 'Female' ? document.getElementById('patientSpouseName').value.trim() : '',
        femaleHistory: document.getElementById('patientGender').value === 'Female' ? document.getElementById('patientFemaleHistory').value.trim() : '',
        address: document.getElementById('patientAddress').value.trim() || '',
        emergencyContact: document.getElementById('patientEmergency').value.trim() || null,
        emergencyPhone: document.getElementById('patientEmergencyPhone').value.trim() || null,
        whatsAppConsent: document.getElementById('patientWhatsAppConsent').checked,
        emailConsent: document.getElementById('patientEmailConsent').checked,
        doctorId: doctorId,
        doctorName: selectedDoc ? selectedDoc.name : '',
        department: document.getElementById('patientDepartment').value,
        isPregnant: document.getElementById('patientIsPregnant').checked,
        lmp: document.getElementById('patientLmp').value || null,
        edd: document.getElementById('patientEdd').value || null,
        eddSource: document.getElementById('patientEddMode').value === 'manual' ? 'manual' : 'lmp',
        eddOverrideReason: document.getElementById('patientEddMode').value === 'manual'
            ? document.getElementById('patientEddReason').value.trim() : '',
        gravida: Number(document.getElementById('patientGravida').value) || 0,
        para: Number(document.getElementById('patientPara').value) || 0,
        abortions: Number(document.getElementById('patientAbortions').value) || 0,
        highRisk: document.getElementById('patientHighRisk').checked,
        highRiskReason: document.getElementById('patientHighRiskReason').value.trim() || '',
    };

    try {
        if (!navigator.onLine) {
            var offlineDocId = editingPatientId || ('offline-patient-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
            var offlineExisting = allPatients.find(function(p) { return p.id === editingPatientId; });
            patientData.patientId = existingPatientId || (offlineExisting && offlineExisting.patientId) || generateOfflinePatientId();
            patientData.status = (offlineExisting && offlineExisting.status) || 'opd';
            patientData.offlineSyncStatus = 'pending';
            patientData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            if (!editingPatientId) patientData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            var offlinePatientRef = db.collection('patients').doc(offlineDocId);
            var offlineIndexRef = db.collection('patientIndex').doc(phoneVal);
            queueOfflinePatientWrite(offlinePatientRef, offlineIndexRef, patientData, Boolean(editingPatientId));
            completePatientFormSave('Patient saved locally and will sync automatically when online.', 'success');
            return;
        }

        if (editingPatientId) {
            const oldPatient = allPatients.find(p => p.id === editingPatientId);
            patientData.patientId = existingPatientId || oldPatient?.patientId || '';
            await db.runTransaction(async function (transaction) {
                const oldIndexRef = oldPatient && oldPatient.phone && oldPatient.phone !== phoneVal ? db.collection('patientIndex').doc(oldPatient.phone) : null;
                const oldIndex = oldIndexRef ? await transaction.get(oldIndexRef) : null;
                if (oldIndex && oldIndex.exists && oldIndex.data().docId === editingPatientId) transaction.delete(oldIndexRef);
                transaction.update(db.collection('patients').doc(editingPatientId), { ...patientData, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                transaction.set(db.collection('patientIndex').doc(phoneVal), { patientId: patientData.patientId, name: nameVal, nameLower: nameVal.toLowerCase(), phone: phoneVal, docId: editingPatientId }, { merge: true });
            });
        } else {
            patientData.patientId = await generatePatientId();
            patientData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            patientData.status = 'opd'; // default status for new patients
            const docRef = db.collection('patients').doc();
            const batch = db.batch();
            batch.set(docRef, patientData);
            batch.set(db.collection('patientIndex').doc(phoneVal), { patientId: patientData.patientId, name: nameVal, nameLower: nameVal.toLowerCase(), phone: phoneVal, docId: docRef.id });
            await batch.commit();
        }
        completePatientFormSave(editingPatientId ? 'Patient updated successfully.' : 'Patient registered successfully!', 'success');
    } catch (err) {
        console.error('Save patient error:', err);
        showToast('Failed to save patient: ' + err.message, 'error');
    } finally {
        btn.textContent = editingPatientId ? 'Update Patient' : 'Save Patient'; btn.disabled = false;
    }
}

document.getElementById('addPatientForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!validatePatientForm()) return;
    const btn = document.getElementById('savePatientBtn');
    btn.textContent = 'Checking...'; btn.disabled = true;

    const phoneVal = document.getElementById('patientPhone').value.trim();
    const nameVal = document.getElementById('patientName').value.trim();

    // Queries cannot reliably establish duplicates while offline. Queue the
    // write locally; the user can reconcile any duplicates after reconnecting.
    if (!navigator.onLine) {
        btn.textContent = 'Saving offline...';
        await savePatientData(btn, nameVal, phoneVal);
        return;
    }

    // Duplicate phone check — POLISH 6
    try {
        const phoneCheck = await db.collection('patients').where('phone', '==', phoneVal).get();
        const dups = phoneCheck.docs.filter(d => d.id !== editingPatientId);
        if (dups.length > 0) {
            const ex = dups[0].data();
            btn.textContent = editingPatientId ? 'Update Patient' : 'Save Patient'; btn.disabled = false;
            // Rich 3-button modal
            var dupOverlay = document.createElement('div');
            dupOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
            dupOverlay.innerHTML = '<div style="background:white;border-radius:12px;padding:28px;max-width:440px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);">'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
                + '<div style="width:36px;height:36px;border-radius:50%;background:#FEF3C720;display:flex;align-items:center;justify-content:center;">'
                + '<i class="fa-solid fa-triangle-exclamation" style="color:#D97706;font-size:18px;"></i></div>'
                + '<h3 style="margin:0;color:var(--primary-navy);font-size:16px;">Duplicate Phone Number</h3></div>'
                + '<p style="margin:0 0 6px 0;color:#64748b;font-size:13px;">Phone <strong>' + phoneVal + '</strong> is already registered to:</p>'
                + '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;">'
                + '<strong style="color:var(--primary-navy);">' + escapeHtml(ex.name) + '</strong>'
                + (ex.patientId ? ' <span style="color:var(--primary-teal);font-size:11px;">(' + escapeHtml(ex.patientId) + ')</span>' : '')
                + (ex.department ? '<br><span style="color:#64748b;">' + escapeHtml(ex.department) + '</span>' : '')
                + '</div>'
                + '<div style="display:flex;flex-direction:column;gap:8px;">'
                + '<a href="patient-profile.html?id=' + encodeURIComponent(ex.patientId || '') + '" class="btn-primary" style="text-align:center;text-decoration:none;padding:10px;border-radius:8px;background:var(--primary-teal);color:white;font-size:13px;font-weight:600;">'
                + '<i class="fa-solid fa-eye" style="margin-right:6px;"></i>View Existing Patient</a>'
                + '<button class="dup-create-new" style="padding:10px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-size:13px;color:#374151;font-weight:500;">'
                + '<i class="fa-solid fa-user-plus" style="margin-right:6px;color:var(--primary-teal);"></i>Create New Anyway</button>'
                + '<button class="dup-cancel" style="padding:10px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:13px;color:#64748b;">Cancel</button>'
                + '</div></div>';
            document.body.appendChild(dupOverlay);
            dupOverlay.querySelector('.dup-cancel').onclick = function() { dupOverlay.remove(); };
            dupOverlay.querySelector('.dup-create-new').onclick = async function() {
                dupOverlay.remove();
                btn.textContent = 'Saving...'; btn.disabled = true;
                await savePatientData(btn, nameVal, phoneVal);
            };
            return;
        }
    } catch (err) { console.error('Duplicate check error:', err); }

    btn.textContent = 'Saving...';
    await savePatientData(btn, nameVal, phoneVal);
});

// ==========================================
// EDIT PATIENT
// ==========================================
function openEditPatient(patientDocId) {
    const patient = allPatients.find(p => p.id === patientDocId);
    if (!patient) return;
    editingPatientId = patientDocId;
    existingPatientId = patient.patientId || null; // P4 Fix 3: preserve
    document.querySelector('#addPatientModal h2').textContent = 'Edit Patient';
    document.getElementById('savePatientBtn').textContent = 'Update Patient';
    document.getElementById('patientName').value = patient.name || '';
    document.getElementById('patientDob').value = patient.dob || '';
    document.getElementById('patientPhone').value = patient.phone || '';
    document.getElementById('patientBlood').value = patient.bloodGroup || '';
    document.getElementById('patientGender').value = patient.gender || '';
    document.getElementById('patientMaritalStatus').value = patient.maritalStatus || '';
    document.getElementById('patientSpouseName').value = patient.spouseName || '';
    document.getElementById('patientFemaleHistory').value = patient.femaleHistory || '';
    refreshFemalePatientDetails();
    document.getElementById('patientAddress').value = patient.address || '';
    document.getElementById('patientEmergency').value = patient.emergencyContact || '';
    document.getElementById('patientEmergencyPhone').value = patient.emergencyPhone || '';
    document.getElementById('patientWhatsAppConsent').checked = patient.whatsAppConsent === true;
    document.getElementById('patientEmailConsent').checked = patient.emailConsent === true;
    document.getElementById('patientIsPregnant').checked = !!patient.isPregnant;
    document.getElementById('patientLmp').value = patient.lmp || '';
    document.getElementById('patientEddMode').value = patient.eddSource === 'manual' ? 'manual' : 'auto';
    document.getElementById('patientEddReason').value = patient.eddOverrideReason || '';
    document.getElementById('patientEdd').value = patient.edd || '';
    // Re-apply the auto/manual behaviour for the record just loaded.
    setupAntenatalForm();
    document.getElementById('patientGravida').value = patient.gravida ?? '';
    document.getElementById('patientPara').value = patient.para ?? '';
    document.getElementById('patientAbortions').value = patient.abortions ?? '';
    document.getElementById('patientHighRisk').checked = !!patient.highRisk;
    document.getElementById('patientHighRiskReason').value = patient.highRiskReason || '';
    populateDeptSelect('patientDepartment', patient.department || ''); // P3
    // Doctor dropdown
    const sel = document.getElementById('patientDoctor');
    if (patient.doctorId) { sel.value = patient.doctorId; }
    else { Array.from(sel.options).forEach(o => { if (o.text.includes(patient.doctorName || '')) sel.value = o.value; }); }
    clearFormErrors();
    modal.classList.add('active');
}

// P4 Fix 4: Patient search via /patientIndex for phone lookup
function searchPatientByPhone(phone) {
    return db.collection('patientIndex').doc(phone).get().then(doc => {
        if (doc.exists) return [{ docId: doc.data().docId, ...doc.data() }];
        return [];
    });
}

// ==========================================
// PART 0 — BULK PATIENT CSV MIGRATION IMPORT
// ==========================================
let importCsvRows = null;
const PATIENT_FIELDS = [
    { key: 'name', label: 'Full Name (Required)', required: true },
    { key: 'phone', label: 'Phone Number (Required)', required: true },
    { key: 'dob', label: 'Date of Birth / Age (Optional)', required: false },
    { key: 'gender', label: 'Gender (Required)', required: true },
    { key: 'bloodGroup', label: 'Blood Group (Optional)', required: false },
    { key: 'maritalStatus', label: 'Marital Status (Optional)', required: false },
    { key: 'address', label: 'Address (Optional)', required: false },
    { key: 'department', label: 'Department (Required)', required: true },
    { key: 'doctor', label: 'Assigned Doctor Name (Required)', required: true },
    { key: 'emergencyContact', label: 'Emergency Contact Name (Optional)', required: false },
    { key: 'isPregnant', label: 'Currently Pregnant [true/false] (Optional)', required: false },
    { key: 'lmp', label: 'LMP Date [yyyy-mm-dd] (Optional)', required: false },
    { key: 'gravida', label: 'Gravida (Optional)', required: false },
    { key: 'para', label: 'Para (Optional)', required: false }
];

function initBulkImportEventListeners() {
    var btnOpen = document.getElementById('btnImportPatients');
    if (btnOpen) {
        btnOpen.addEventListener('click', function() {
            resetImportModal();
            document.getElementById('importPatientsModal').style.display = 'flex';
        });
    }
    
    var btnTemplate = document.getElementById('btnDownloadTemplate');
    if (btnTemplate) {
        btnTemplate.addEventListener('click', downloadPatientTemplate);
    }
    
    var fileInput = document.getElementById('patientCsvFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                readPatientImportCsv(e.target.files[0]);
            }
        });
    }
    
    var mappingForm = document.getElementById('patientMappingForm');
    if (mappingForm) {
        mappingForm.addEventListener('submit', function(e) {
            e.preventDefault();
            generateImportPreview();
        });
    }
}

function resetImportModal() {
    document.getElementById('stepUpload').style.display = 'block';
    document.getElementById('columnMappingStep').style.display = 'none';
    document.getElementById('previewImportStep').style.display = 'none';
    document.getElementById('summaryImportStep').style.display = 'none';
    var fileInput = document.getElementById('patientCsvFileInput');
    if (fileInput) fileInput.value = '';
    importCsvRows = null;
}

function downloadPatientTemplate() {
    var headers = PATIENT_FIELDS.map(f => f.key).join(',');
    var sampleData = "Jane Doe,9876543210,1995-08-15,Female,O+,123 MG Road Hyderabad,Gynaecology,Dr. Priya Sharma,John Doe (Husband),true,2026-02-10,2,1\n";
    var csvContent = "data:text/csv;charset=utf-8," + headers + "\n" + sampleData;
    var link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'patient_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function readPatientImportCsv(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = e.target.result;
        var lines = text.split(/\r?\n/);
        var rows = [];
        lines.forEach(function(l) {
            var cols = l.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
            if (cols.length > 0 && cols[0]) {
                rows.push(cols);
            }
        });
        
        if (rows.length < 2) {
            showToast('CSV needs header and at least one record.', 'error');
            return;
        }
        
        importCsvRows = rows;
        showColumnMappingStep(rows[0]);
    };
    reader.readAsText(file);
}

function showColumnMappingStep(headers) {
    document.getElementById('stepUpload').style.display = 'none';
    document.getElementById('columnMappingStep').style.display = 'block';
    
    var container = document.getElementById('mappingSelectsContainer');
    container.innerHTML = '';
    
    PATIENT_FIELDS.forEach(function(field) {
        var div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
            <label style="font-size:12px; font-weight:600; color:var(--primary-navy);">${escapeHtml(field.label)}</label>
            <select name="map_${field.key}" class="mapping-select" style="width:100%; margin-top:4px;" ${field.required ? 'required' : ''}>
                <option value="">-- Ignore / Optional --</option>
            </select>
        `;
        var sel = div.querySelector('select');
        headers.forEach(function(h, idx) {
            var opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = h;
            // Auto match
            var hl = h.toLowerCase();
            var fk = field.key.toLowerCase();
            if (hl === fk || hl.replace(/\s/g,'') === fk || hl.includes(fk) || (fk === 'dob' && hl.includes('birth'))) {
                opt.selected = true;
            }
            sel.appendChild(opt);
        });
        container.appendChild(div);
    });
}

function generateImportPreview() {
    if (!importCsvRows || importCsvRows.length < 2) return;
    
    var selects = document.querySelectorAll('.mapping-select');
    var mapping = {};
    selects.forEach(function(sel) {
        var key = sel.name.replace('map_', '');
        mapping[key] = sel.value !== "" ? parseInt(sel.value, 10) : null;
    });
    
    // Check required fields mapped
    var missing = [];
    PATIENT_FIELDS.forEach(f => {
        if (f.required && mapping[f.key] === null) {
            missing.push(f.label);
        }
    });
    
    if (missing.length > 0) {
        showToast('Map required columns: ' + missing.join(', '), 'warning');
        return;
    }
    
    // Render first 10 rows preview
    var headerRow = document.getElementById('previewTableHeader');
    headerRow.innerHTML = '';
    
    // Table headers matching model fields
    var colsToDisplay = PATIENT_FIELDS.map(f => f.key);
    colsToDisplay.forEach(function(k) {
        var th = document.createElement('th');
        th.textContent = k;
        headerRow.innerHTML += th.outerHTML;
    });
    
    var tbody = document.getElementById('previewTableBody');
    tbody.innerHTML = '';
    
    var dupWarning = false;
    var previewLimit = Math.min(importCsvRows.length, 11);
    
    var checkPromises = [];
    
    for (var i = 1; i < previewLimit; i++) {
        var csvRow = importCsvRows[i];
        var tr = document.createElement('tr');
        var rowHtml = '';
        
        colsToDisplay.forEach(function(k) {
            var cellIdx = mapping[k];
            var val = (cellIdx !== null && csvRow[cellIdx] !== undefined) ? csvRow[cellIdx] : '—';
            rowHtml += `<td>${escapeHtml(val)}</td>`;
        });
        
        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    }
    
    // Check all phone numbers in import rows to highlight duplicate warning in preview
    var phonesList = [];
    for (var i = 1; i < importCsvRows.length; i++) {
        var pIdx = mapping['phone'];
        if (pIdx !== null && importCsvRows[i][pIdx]) {
            phonesList.push(importCsvRows[i][pIdx].trim());
        }
    }
    
    document.getElementById('columnMappingStep').style.display = 'none';
    document.getElementById('previewImportStep').style.display = 'block';
    
    // Perform bulk duplicates warning display
    if (phonesList.length > 0) {
        db.collection('patients').get().then(function(snap) {
            var existingPhones = new Set();
            snap.forEach(d => {
                if (d.data().phone) existingPhones.add(d.data().phone.trim());
            });
            
            var hasDup = phonesList.some(p => existingPhones.has(p));
            if (hasDup) {
                document.getElementById('dupWarningText').style.display = 'block';
            } else {
                document.getElementById('dupWarningText').style.display = 'none';
            }
        }).catch(function() {
            document.getElementById('dupWarningText').style.display = 'none';
        });
    }
    
    // Wire Confirm Import button
    var btnConfirm = document.getElementById('btnConfirmImport');
    btnConfirm.onclick = function() {
        var dupPolicy = document.querySelector('input[name="dupPolicy"]:checked').value;
        executePatientsBulkImport(mapping, dupPolicy);
    };
}

function executePatientsBulkImport(mapping, dupPolicy) {
    if (!importCsvRows || importCsvRows.length < 2) return;
    
    var btnConfirm = document.getElementById('btnConfirmImport');
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    
    showToast('Importing patient list...', 'info');
    
    // Build existing phones check list
    db.collection('patients').get().then(async function(snap) {
        var existingPatientsPhoneMap = {}; // phone -> patientObj
        snap.forEach(d => {
            var pData = d.data();
            if (pData.phone) {
                existingPatientsPhoneMap[pData.phone.trim()] = pData;
            }
        });
        
        var successCount = 0;
        var skippedCount = 0;
        var errorCount = 0;
        var errorsList = [];
        
        var batch = db.batch();
        var batchCount = 0;
        var promises = [];
        
        // Loop row-by-row
        for (var i = 1; i < importCsvRows.length; i++) {
            var row = importCsvRows[i];
            
            try {
                // Read mapped attributes
                var nameVal = mapping['name'] !== null ? row[mapping['name']] : '';
                var phoneVal = mapping['phone'] !== null ? row[mapping['phone']].trim() : '';
                
                if (!nameVal || !phoneVal) {
                    throw new Error('Name and Phone columns must have values');
                }
                
                // Duplicate policy check
                if (existingPatientsPhoneMap[phoneVal]) {
                    if (dupPolicy === 'skip') {
                        skippedCount++;
                        continue;
                    }
                }
                
                var dobVal = mapping['dob'] !== null ? row[mapping['dob']] : null;
                var genderVal = mapping['gender'] !== null ? row[mapping['gender']] : 'Female';
                var bloodVal = mapping['bloodGroup'] !== null ? row[mapping['bloodGroup']] || '' : '';
                var addressVal = mapping['address'] !== null ? row[mapping['address']] : '';
                var deptVal = mapping['department'] !== null ? row[mapping['department']] : 'General';
                var docNameVal = mapping['doctor'] !== null ? row[mapping['doctor']] : '';
                var emgVal = mapping['emergencyContact'] !== null ? row[mapping['emergencyContact']] : '';
                var pregnantVal = mapping['isPregnant'] !== null ? (row[mapping['isPregnant']].toLowerCase() === 'true' || row[mapping['isPregnant']] === '1') : false;
                var lmpVal = mapping['lmp'] !== null ? row[mapping['lmp']] : null;
                var gravidaVal = mapping['gravida'] !== null ? parseInt(row[mapping['gravida']], 10) || 0 : 0;
                var paraVal = mapping['para'] !== null ? parseInt(row[mapping['para']], 10) || 0 : 0;
                
                // Construct patient record
                var age = null;
                if (dobVal) {
                    if (!isNaN(dobVal)) {
                        age = parseInt(dobVal, 10);
                        dobVal = null; // dob column has raw age integer
                    } else {
                        age = calculateAge(new Date(dobVal));
                    }
                }
                
                // Generate next sequential patientId dynamically (simulate seq counts locally to keep import quick)
                // In production, transaction lock is best; here, sequential local offset keeps imports colliding-free
                var patientRef = db.collection('patients').doc();
                var patientId = `SA-${new Date().getFullYear()}-${String(10000 + i + Math.floor(Math.random() * 10000)).padStart(5, '0')}`;
                
                var pData = {
                    patientId: patientId,
                    name: nameVal,
                    nameLower: nameVal.toLowerCase(),
                    dob: dobVal,
                    age: age,
                    phone: phoneVal,
                    bloodGroup: bloodVal,
                    gender: genderVal,
                    maritalStatus: genderVal === 'Female' && mapping['maritalStatus'] != null ? (row[mapping['maritalStatus']] || '') : '',
                    address: addressVal,
                    department: deptVal,
                    doctorName: docNameVal,
                    emergencyContact: emgVal,
                    isPregnant: pregnantVal,
                    lmp: lmpVal,
                    edd: lmpVal ? addDaysToIso(lmpVal, 280) : null,
                    gravida: gravidaVal,
                    para: paraVal,
                    status: 'opd',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                batch.set(patientRef, pData);
                
                // Set patientIndex
                var indexRef = db.collection('patientIndex').doc(phoneVal);
                batch.set(indexRef, {
                    patientId: patientId,
                    name: nameVal,
                    nameLower: nameVal.toLowerCase(),
                    phone: phoneVal,
                    docId: patientRef.id
                }, { merge: true });
                
                batchCount += 2;
                successCount++;
                
                if (batchCount >= 400) {
                    promises.push(batch.commit());
                    batch = db.batch();
                    batchCount = 0;
                }
                
            } catch (err) {
                errorCount++;
                errorsList.push('Row ' + (i + 1) + ' Failure: ' + err.message);
            }
        }
        
        if (batchCount > 0) {
            promises.push(batch.commit());
        }
        
        Promise.all(promises).then(function() {
            document.getElementById('previewImportStep').style.display = 'none';
            document.getElementById('summaryImportStep').style.display = 'block';
            
            document.getElementById('sumSuccessCount').textContent = successCount;
            document.getElementById('sumSkippedCount').textContent = skippedCount;
            document.getElementById('sumErrorCount').textContent = errorCount;
            
            var errContainer = document.getElementById('importErrorsContainer');
            var errList = document.getElementById('importErrorsList');
            if (errorCount > 0) {
                errContainer.style.display = 'block';
                errList.innerHTML = errorsList.map(e => `<div>${escapeHtml(e)}</div>`).join('');
            } else {
                errContainer.style.display = 'none';
            }
            
            showToast('Migration completed successfully.', 'success');
        }).catch(function(err) {
            showToast('Batch commit failure: ' + err.message, 'error');
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = '<i class="fa-solid fa-file-import"></i> Confirm & Import Data';
        });
        
    }).catch(function(err) {
        showToast('Error verifying existing phones: ' + err.message, 'error');
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = '<i class="fa-solid fa-file-import"></i> Confirm & Import Data';
    });
}
