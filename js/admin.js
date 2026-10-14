checkAccess(['admin']);
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    loadStaff();
    loadDoctorsForAdmin();
    loadAdminDepartments();
    loadSettings();
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// ==========================================
// MODALS
// ==========================================
const staffModal = document.getElementById('staffModal');
const doctorModal = document.getElementById('doctorModal');
const deptModal = document.getElementById('deptModal');

document.getElementById('closeStaffModal').addEventListener('click', closeStaffModal);
document.getElementById('cancelStaffModal').addEventListener('click', closeStaffModal);
document.getElementById('closeDoctorModal').addEventListener('click', () => doctorModal.classList.remove('active'));
document.getElementById('cancelDoctorModal').addEventListener('click', () => doctorModal.classList.remove('active'));
document.getElementById('closeDeptModal').addEventListener('click', () => deptModal.classList.remove('active'));
document.getElementById('cancelDeptModal').addEventListener('click', () => deptModal.classList.remove('active'));

let editingStaffId = null;

document.getElementById('addStaffBtn').addEventListener('click', () => {
    editingStaffId = null;
    document.getElementById('staffForm').reset();
    document.getElementById('staffModalTitle').textContent = 'Add New Staff';
    document.getElementById('staffEmail').readOnly = false;
    document.getElementById('staffPassword').required = true;
    document.getElementById('staffPassword').disabled = false;
    document.getElementById('pwdEditNote').style.display = 'none';
    document.getElementById('pwdRequiredMark').style.display = '';
    staffModal.classList.add('active');
});

function closeStaffModal() { staffModal.classList.remove('active'); editingStaffId = null; }

// ==========================================
// P2: STAFF MANAGEMENT — Secondary App for Auth creation
// ==========================================
// P2: Use secondary Firebase app to avoid signing out the admin
let secondaryApp;
function getSecondaryApp() {
    if (!secondaryApp) {
        const existing = firebase.apps.find(a => a.name === 'secondary');
        secondaryApp = existing || firebase.initializeApp(firebase.app().options, 'secondary');
        if (!existing && window.HMS_LOCAL) {
            secondaryApp.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        }
    }
    return secondaryApp;
}

function loadStaff() {
    setLoadingRow('staffTableBody', 7);
    db.collection('staff').onSnapshot(snapshot => {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '';
        if (snapshot.empty) { setEmptyRow('staffTableBody', 'No staff found. Click Add New Staff.', 7); return; }
        const linkedSources = new Set(snapshot.docs.map(doc => doc.data().sourceStaffDocId).filter(Boolean));
        snapshot.forEach(doc => {
            if (linkedSources.has(doc.id)) return;
            const data = doc.data();
            const isActive = data.isActive === true || data.isActive === 'true';
            const hasLogin = data.hasLogin === true;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(data.name || '')}</td>
                <td>${escapeHtml(data.email || '')}</td>
                <td>${escapeHtml(data.biometricId || '—')}</td>
                <td>${escapeHtml(data.role || '')}</td>
                <td>${escapeHtml(data.department || '-')}</td>
                <td><span class="status-badge ${isActive ? 'status-active' : 'status-pending'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                <td style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn-secondary edit-staff-btn" data-id="${doc.id}" style="padding:4px 10px;font-size:0.78rem;">Edit</button>
                    ${!hasLogin ? `<button class="btn-secondary create-login-btn" data-id="${doc.id}" data-email="${escapeHtml(data.email || '')}" style="padding:4px 10px;font-size:0.78rem;color:#0D7A70;border-color:#0D7A70;">Create Login</button>` : '<span style="font-size:0.75rem;color:#10b981;">✓ Login Active</span>'}
                    ${isActive ? `<button class="btn-secondary deactivate-staff-btn" data-id="${doc.id}" style="padding:4px 10px;font-size:0.78rem;color:red;border-color:red;">Deactivate</button>` : ''}
                </td>`;
            tbody.appendChild(tr);
        });
        // Wire buttons
        document.querySelectorAll('.edit-staff-btn').forEach(btn => btn.addEventListener('click', e => openEditStaff(e.target.dataset.id)));
        document.querySelectorAll('.deactivate-staff-btn').forEach(btn => btn.addEventListener('click', e => deactivateStaff(e.target.dataset.id)));
        // P2: Create Login button — uses secondary app and writes /staff/{uid} document
        document.querySelectorAll('.create-login-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const { id, email, pwd } = e.target.dataset;
                const password = pwd || prompt(`Enter a password for ${email} (min 6 chars):`);
                if (!password || password.length < 6) { showToast('Password must be at least 6 characters.', 'warning'); return; }
                e.target.textContent = 'Creating...'; e.target.disabled = true;
                getSecondaryApp().auth().createUserWithEmailAndPassword(email, password)
                    .then((cred) => {
                        const uid = cred.user.uid;
                        return db.collection('staff').doc(id).get().then(docSnap => {
                            const data = docSnap.exists ? docSnap.data() : {};
                            const uidStaffData = {
                                name: data.name || '',
                                email: email,
                                role: (data.role || 'receptionist').toLowerCase(),
                                department: data.department || '',
                                biometricId: data.biometricId || '',
                                phone: data.phone || '',
                                isActive: data.isActive === true || data.isActive === 'true',
                                hasLogin: true,
                                uid: uid,
                                sourceStaffDocId: id,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            };
                            const batch = db.batch();
                            batch.set(db.collection('staff').doc(uid), uidStaffData, { merge: true });
                            batch.update(db.collection('staff').doc(id), { hasLogin: true, temporaryPassword: firebase.firestore.FieldValue.delete(), uid: uid });
                            return batch.commit().catch(async err => {
                                await cred.user.delete();
                                throw err;
                            });
                        });
                    })
                    .then(() => showToast(`Login created successfully for ${email}`, 'success'))
                    .catch(err => { showToast('Error creating login: ' + err.message, 'error'); e.target.textContent = 'Create Login'; e.target.disabled = false; })
                    .finally(() => getSecondaryApp().auth().signOut());
            });
        });
    });
}

// PART 1: One-time migration function "Sync Staff UIDs" (Admin only)
function syncStaffUIDs() {
    const btn = document.getElementById('syncStaffUidsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing UIDs...'; }
    showToast('Starting Staff UID sync...', 'info');

    getCurrentUser(async (currentUser) => {
        try {
            const snap = await db.collection('staff').get();
            let syncedCount = 0;
            const promises = [];

            // 1. Always write/sync current admin user's UID doc
            if (currentUser && currentUser.uid) {
                const currentAdminData = {
                    name: currentUser.name || 'Admin',
                    email: currentUser.email,
                    role: (currentUser.role || 'admin').toLowerCase(),
                    department: currentUser.department || 'Administration',
                    biometricId: currentUser.biometricId || '',
                    phone: currentUser.phone || '',
                    isActive: true,
                    hasLogin: true,
                    uid: currentUser.uid,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                promises.push(db.collection('staff').doc(currentUser.uid).set(currentAdminData, { merge: true }));
                syncedCount++;
            }

            // 2. Process all staff documents in collection
            snap.forEach(docSnap => {
                const data = docSnap.data();
                let targetUid = data.uid || (data.email === currentUser.email ? currentUser.uid : null);
                // Firestore auto IDs are not Auth UIDs. Only sync a known association.
                if (data.sourceStaffDocId) return;

                if (targetUid) {
                    const uidStaffData = {
                        name: data.name || '',
                        email: data.email || '',
                        role: (data.role || 'unknown').toLowerCase(),
                        department: data.department || '',
                        biometricId: data.biometricId || '',
                        phone: data.phone || '',
                        isActive: data.isActive === true || data.isActive === 'true',
                        hasLogin: true,
                        uid: targetUid,
                        ...(docSnap.id !== targetUid ? { sourceStaffDocId: docSnap.id } : {}),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    promises.push(db.collection('staff').doc(targetUid).set(uidStaffData, { merge: true }));
                    syncedCount++;
                }
            });

            await Promise.all(promises);
            showToast(`Synced ${syncedCount} staff document(s) to /staff/{uid}!`, 'success');
        } catch (err) {
            console.error('Error syncing staff UIDs:', err);
            showToast('Error syncing staff UIDs: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync Staff UIDs'; }
        }
    });
}
window.syncStaffUIDs = syncStaffUIDs;

document.addEventListener('DOMContentLoaded', function() {
    const syncBtn = document.getElementById('syncStaffUidsBtn');
    if (syncBtn) syncBtn.addEventListener('click', syncStaffUIDs);
});

function openEditStaff(staffDocId) {
    db.collection('staff').doc(staffDocId).get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        editingStaffId = staffDocId;
        document.getElementById('staffModalTitle').textContent = 'Edit Staff';
        document.getElementById('staffName').value = data.name || '';
        document.getElementById('staffEmail').value = data.email || '';
        document.getElementById('staffEmail').readOnly = true;
        document.getElementById('staffPhone').value = data.phone || '';
        document.getElementById('staffRole').value = (data.role || 'receptionist').toLowerCase();
        document.getElementById('staffDepartment').value = data.department || '';
        document.getElementById('staffBiometricId').value = data.biometricId || '';
        document.getElementById('staffPassword').value = '';
        document.getElementById('staffPassword').required = false;
        document.getElementById('staffPassword').disabled = true;
        document.getElementById('pwdEditNote').style.display = '';
        document.getElementById('pwdRequiredMark').style.display = 'none';
        staffModal.classList.add('active');
    }).catch(err => { showToast('Error loading staff: ' + err.message, 'error'); });
}

// Update canonical and legacy UID records together so role/activation changes apply immediately.
async function updateStaffProfile(staffId, updates) {
    const snap = await db.collection('staff').doc(staffId).get();
    if (!snap.exists) throw new Error('Staff record no longer exists.');
    const data = snap.data();
    const ids = new Set([staffId, data.sourceStaffDocId, data.uid].filter(Boolean));
    const batch = db.batch();
    ids.forEach(id => batch.set(db.collection('staff').doc(id), updates, { merge: true }));
    await batch.commit();
}

// Create the Auth account and its UID profile without persisting passwords.
document.getElementById('staffForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById('saveStaffBtn');
    btn.disabled = true; btn.textContent = 'Saving...';

    if (editingStaffId) {
        // Edit: update Firestore only
        const updates = {
            name: document.getElementById('staffName').value,
            phone: document.getElementById('staffPhone').value,
            role: document.getElementById('staffRole').value,
            department: document.getElementById('staffDepartment').value,
            biometricId: document.getElementById('staffBiometricId').value.trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        updateStaffProfile(editingStaffId, updates)
            .then(() => { closeStaffModal(); showToast('Staff updated successfully.', 'success'); })
            .catch(err => { showToast('Error: ' + err.message, 'error'); })
            .finally(() => { btn.disabled = false; btn.textContent = 'Save Staff'; });
    } else {
        const email = document.getElementById('staffEmail').value.trim().toLowerCase();
        const password = document.getElementById('staffPassword').value;
        const staffData = {
            name: document.getElementById('staffName').value,
            email: email,
            phone: document.getElementById('staffPhone').value,
            role: document.getElementById('staffRole').value,
            department: document.getElementById('staffDepartment').value,
            biometricId: document.getElementById('staffBiometricId').value.trim(),
            isActive: true,
            hasLogin: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        getSecondaryApp().auth().createUserWithEmailAndPassword(email, password)
            .then(async cred => {
                try {
                    await db.collection('staff').doc(cred.user.uid).set({ ...staffData, uid: cred.user.uid });
                } catch (err) {
                    await cred.user.delete();
                    throw err;
                }
                closeStaffModal();
                showToast('Staff account created. They can sign in with the email and password you entered.', 'success');
            })
            .catch(err => { showToast('Error: ' + err.message, 'error'); })
            .finally(() => { getSecondaryApp().auth().signOut(); btn.disabled = false; btn.textContent = 'Save Staff'; });
    }
});

function deactivateStaff(uid) {
    if (confirm('Deactivate this staff member?')) {
        updateStaffProfile(uid, { isActive: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
            .then(() => showToast('Staff deactivated.', 'success'))
            .catch(err => showToast('Error: ' + err.message, 'error'));
    }
}

// ==========================================
// DOCTOR MANAGEMENT
// ==========================================
function loadDoctorsForAdmin() {
    setLoadingRow('doctorsTableBody', 6);
    db.collection('staff').where('role', '==', 'doctor').onSnapshot(snapshot => {
        const tbody = document.getElementById('doctorsTableBody');
        tbody.innerHTML = '';
        const doctors = [];
        snapshot.forEach(doc => doctors.push({ id: doc.id, ...doc.data() }));
        if (doctors.length === 0) { setEmptyRow('doctorsTableBody', 'No doctors found.', 6); return; }
        doctors.forEach(data => {
            const opFee = data.opFee || 0;
            const freeOP = data.freeOP === true || data.freeOP === 'true';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${data.name}</td>
                <td>${data.specialisation || '-'}</td>
                <td>${data.department || '-'}</td>
                <td>₹${opFee}</td>
                <td>${freeOP ? 'Yes' : 'No'}</td>
                <td><button class="btn-secondary edit-doctor-btn" data-id="${data.id}" data-spec="${data.specialisation||''}" data-fee="${opFee}" data-free="${freeOP}" style="padding:4px 10px;font-size:0.78rem;">Edit</button></td>`;
            tbody.appendChild(tr);
        });
        document.querySelectorAll('.edit-doctor-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const d = e.target.dataset;
                document.getElementById('docEditId').value = d.id;
                document.getElementById('docSpecialisation').value = d.spec;
                document.getElementById('docOpFee').value = d.fee;
                document.getElementById('docFreeOp').checked = d.free === 'true';
                doctorModal.classList.add('active');
            });
        });
    });
}

document.getElementById('doctorForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const id = document.getElementById('docEditId').value;
    updateStaffProfile(id, {
        specialisation: document.getElementById('docSpecialisation').value,
        opFee: Number(document.getElementById('docOpFee').value),
        freeOP: document.getElementById('docFreeOp').checked
    }).then(() => { doctorModal.classList.remove('active'); showToast('Doctor updated.', 'success'); })
      .catch(err => showToast('Error: ' + err.message, 'error'));
});

// ==========================================
// DEPARTMENT MANAGEMENT
// ==========================================
let editingDeptId = null;

function loadAdminDepartments() {
    document.getElementById('addDeptBtn').style.display = 'none';
    setLoadingRow('deptsTableBody', 4);
    db.collection('departments').onSnapshot(snapshot => {
        const tbody = document.getElementById('deptsTableBody');
        tbody.innerHTML = '';
        if (snapshot.empty) { setEmptyRow('deptsTableBody', 'No departments. Click Add Department.', 4); return; }
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!['Gynaecology', 'Surgery'].includes(data.name)) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${data.name}</td>
                <td>${data.headDoctor || '-'}</td>
                <td>${data.description || '-'}</td>
                <td>
                    <button class="btn-secondary edit-dept-btn" data-id="${doc.id}" style="padding:4px 10px;font-size:0.78rem;">Edit</button>
                    <button class="btn-secondary delete-dept-btn" data-id="${doc.id}" data-name="${data.name}" style="padding:4px 10px;font-size:0.78rem;color:red;border-color:red;">Delete</button>
                </td>`;
            tbody.appendChild(tr);
        });
        document.querySelectorAll('.edit-dept-btn').forEach(btn => btn.addEventListener('click', e => openEditDept(e.target.dataset.id)));
        document.querySelectorAll('.delete-dept-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                if (confirm(`Delete department "${e.target.dataset.name}"?`)) {
                    db.collection('departments').doc(e.target.dataset.id).delete()
                        .then(() => showToast('Department deleted.', 'success'))
                        .catch(err => showToast('Error: ' + err.message, 'error'));
                }
            });
        });
    });
}

document.getElementById('addDeptBtn').addEventListener('click', () => {
    editingDeptId = null;
    document.getElementById('deptForm').reset();
    document.getElementById('deptEditId').value = '';
    document.getElementById('deptModalTitle').textContent = 'Add Department';
    loadDeptDoctors('');
    deptModal.classList.add('active');
});

function openEditDept(deptId) {
    db.collection('departments').doc(deptId).get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        editingDeptId = deptId;
        document.getElementById('deptEditId').value = deptId;
        document.getElementById('deptModalTitle').textContent = 'Edit Department';
        document.getElementById('deptName').value = data.name || '';
        document.getElementById('deptDescription').value = data.description || '';
        loadDeptDoctors(data.headDoctor || '');
        deptModal.classList.add('active');
    });
}

function loadDeptDoctors(selected) {
    const sel = document.getElementById('deptHeadDoctor');
    sel.innerHTML = '<option value="">None</option>';
    db.collection('staff').where('role', '==', 'doctor').get().then(snap => {
        snap.forEach(doc => {
            const opt = document.createElement('option');
            opt.value = doc.data().name; opt.textContent = doc.data().name;
            if (doc.data().name === selected) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

document.getElementById('deptForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const deptData = { name: document.getElementById('deptName').value.trim(), headDoctor: document.getElementById('deptHeadDoctor').value, description: document.getElementById('deptDescription').value.trim(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const id = document.getElementById('deptEditId').value;
    const p = id ? db.collection('departments').doc(id).update(deptData) : db.collection('departments').add({ ...deptData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    p.then(() => { deptModal.classList.remove('active'); showToast('Department saved.', 'success'); })
     .catch(err => showToast('Error: ' + err.message, 'error'));
});

// ==========================================
// HOSPITAL SETTINGS
// ==========================================
function loadSettings() {
    db.collection('hospitalSettings').doc('main').get().then(doc => {
        if (doc.exists) {
            const d = doc.data();
            document.getElementById('hsName').value = d.hospitalName || d.name || '';
            document.getElementById('hsAddress').value = d.address || '';
            document.getElementById('hsPhone').value = d.phone || '';
            document.getElementById('hsEmail').value = d.email || '';
            document.getElementById('hsGstin').value = d.gstin || '';
            document.getElementById('hsShiftStartTime').value = d.shiftStartTime || '09:00';
            const regNo = document.getElementById('hsRegistrationNo');
            if (regNo) regNo.value = d.registrationNo || '';
            var setVal = function (id, value) { var el = document.getElementById(id); if (el) el.value = value; };
            setVal('hsDrugLicence1', d.drugLicenceNo1 || '');
            setVal('hsDrugLicence2', d.drugLicenceNo2 || '');
            setVal('hsNearExpiryDays', d.nearExpiryDays || 60);
            setVal('hsFollowUpDays', d.followUpValidityDays != null ? d.followUpValidityDays : 7);
            setVal('hsGrnRequiresPo', d.grnRequiresPo === true ? 'true' : 'false');
            setVal('hsDiscountApprover', d.discountApproverRole || 'doctor');
            setVal('hsRefundApprover', d.refundApproverRole || 'doctor');
            setVal('hsPharmacyBillNote', d.pharmacyBillNote || '');
            const br = document.getElementById('hsBranches');
            if (br) {
                var branches = Array.isArray(d.branches) ? d.branches : [];
                br.value = branches.map(function (b) { return (b.id || '') + '|' + (b.name || ''); }).join('\n');
            }
        }
        renderIntegrationSettings(doc.exists ? (doc.data().integrations || {}) : {});
    });
}

// ==========================================
// INTEGRATION SWITCHES
// Only the public feature flags and endpoints live here. Keys and
// secrets belong in Function secrets and are never written to
// Firestore or shown in the browser.
// ==========================================
const INTEGRATION_DEFINITIONS = [
    { key: 'aiSensy', label: 'WhatsApp (AI Sensy)',
      note: 'Sends bills and reminders. Needs a verified WhatsApp Business account and an approved template.',
      fields: [
          { key: 'mode', label: 'API mode', type: 'select', options: ['campaign', 'direct'] },
          { key: 'campaignName', label: 'Campaign / template name', type: 'text' },
          { key: 'baseUrl', label: 'API base URL (leave blank for the default)', type: 'text' }
      ] },
    { key: 'msg91', label: 'SMS fallback (MSG91)',
      note: 'For patients without WhatsApp. Needs DLT-registered templates. Stays hidden across the app until switched on.',
      fields: [
          { key: 'billTemplateId', label: 'DLT template ID for bills', type: 'text' },
          { key: 'reminderTemplateId', label: 'DLT template ID for reminders', type: 'text' }
      ] },
    { key: 'email', label: 'Email (SendGrid)',
      note: 'Sends bills and reports. The sender address must be a verified sender identity.',
      fields: [] },
    { key: 'orthanc', label: 'PACS / DICOM (Orthanc)',
      note: 'Images stay in the PACS; the HMS stores the accession number and Study UID and links to the viewer.',
      fields: [
          { key: 'viewerUrl', label: 'Viewer URL template — use {studyUID}', type: 'text' },
          { key: 'lookupUrl', label: 'Fallback URL template — use {accession}', type: 'text' },
          { key: 'aeTitle', label: 'Modality worklist AE title', type: 'text' }
      ] },
    { key: 'abdm', label: 'ABDM / ABHA',
      note: 'National health account linking. Requires facility registration (HFR) and gateway credentials.',
      fields: [
          { key: 'baseUrl', label: 'Gateway base URL', type: 'text' },
          { key: 'hipId', label: 'HIP ID', type: 'text' },
          { key: 'hipName', label: 'HIP name', type: 'text' }
      ] },
    { key: 'razorpay', label: 'Online payments (Razorpay)',
      note: 'Collects outstanding balances online.',
      fields: [] }
];

function renderIntegrationSettings(integrations) {
    const host = document.getElementById('integrationRows');
    if (!host) return;

    host.innerHTML = INTEGRATION_DEFINITIONS.map(function(definition) {
        const current = integrations[definition.key] || {};
        const fieldsHtml = definition.fields.map(function(field) {
            const value = current[field.key] === undefined ? '' : String(current[field.key]);
            if (field.type === 'select') {
                return '<div class="form-group" style="margin:0;"><label style="font-size:12px;">' + escapeHtml(field.label) + '</label>'
                    + '<select id="int_' + definition.key + '_' + field.key + '">'
                    + field.options.map(function(option) {
                        return '<option value="' + option + '"' + (option === value ? ' selected' : '') + '>' + option + '</option>';
                    }).join('')
                    + '</select></div>';
            }
            return '<div class="form-group" style="margin:0;"><label style="font-size:12px;">' + escapeHtml(field.label) + '</label>'
                + '<input type="text" id="int_' + definition.key + '_' + field.key + '" value="' + escapeHtml(value) + '"></div>';
        }).join('');

        return '<div style="border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-bottom:12px;">'
            + '<label style="display:flex; align-items:center; gap:10px; font-weight:600; color:#0F2B5B; font-size:14px;">'
            + '<input type="checkbox" id="int_' + definition.key + '_enabled"' + (current.enabled === true ? ' checked' : '') + '> '
            + escapeHtml(definition.label) + '</label>'
            + '<p style="margin:6px 0 ' + (fieldsHtml ? '12px' : '0') + '; font-size:12.5px; color:#64748b;">' + escapeHtml(definition.note) + '</p>'
            + (fieldsHtml ? '<div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px;">' + fieldsHtml + '</div>' : '')
            + '</div>';
    }).join('');
}

const integrationsForm = document.getElementById('integrationsForm');
if (integrationsForm) {
    integrationsForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const button = document.getElementById('saveIntegrationsBtn');
        button.disabled = true;

        const integrations = {};
        INTEGRATION_DEFINITIONS.forEach(function(definition) {
            const entry = { enabled: document.getElementById('int_' + definition.key + '_enabled').checked };
            definition.fields.forEach(function(field) {
                entry[field.key] = document.getElementById('int_' + definition.key + '_' + field.key).value.trim();
            });
            integrations[definition.key] = entry;
        });

        db.collection('hospitalSettings').doc('main').set({
            integrations: integrations,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
        .then(function() { showToast('Integration settings saved. Reload other tabs to pick them up.', 'success'); })
        .catch(function(err) { showToast('Error: ' + err.message, 'error'); })
        .then(function() { button.disabled = false; });
    });
}

const runBackupBtn = document.getElementById('runBackupBtn');
if (runBackupBtn) {
    runBackupBtn.addEventListener('click', function() {
        const status = document.getElementById('backupStatus');
        runBackupBtn.disabled = true;
        status.textContent = 'Starting export...';
        callFunction('startFirestoreBackup').then(function(result) {
            status.innerHTML = 'Export started. Destination: <code>' + escapeHtml(result.outputUriPrefix) + '</code>';
            showToast('Backup started.', 'success');
        }).catch(function(err) {
            status.textContent = 'Backup could not start: ' + err.message;
            showToast(err.message || 'Backup failed to start.', 'error');
        }).then(function() { runBackupBtn.disabled = false; });
    });
}

document.getElementById('settingsForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const btn = document.getElementById('saveSettingsBtn');
    btn.textContent = 'Saving...';
    // Written under both keys: every PDF header reads `hospitalName`
    // while older screens read `name`.
    const hospitalName = document.getElementById('hsName').value;
    var branchesRaw = (document.getElementById('hsBranches') || {}).value || '';
    var branches = branchesRaw.split('\n').map(function (line) {
        line = line.trim();
        if (!line) return null;
        var parts = line.split('|');
        return { id: (parts[0] || '').trim() || 'main', name: (parts[1] || parts[0] || '').trim() };
    }).filter(Boolean);
    db.collection('hospitalSettings').doc('main').set({
        name: hospitalName,
        hospitalName: hospitalName,
        address: document.getElementById('hsAddress').value,
        phone: document.getElementById('hsPhone').value,
        email: document.getElementById('hsEmail').value,
        gstin: document.getElementById('hsGstin').value,
        registrationNo: (document.getElementById('hsRegistrationNo') || {}).value || '',
        shiftStartTime: document.getElementById('hsShiftStartTime').value,
        branches: branches,
        // Operational policy — editable here rather than fixed in code.
        drugLicenceNo1: (document.getElementById('hsDrugLicence1') || {}).value || '',
        drugLicenceNo2: (document.getElementById('hsDrugLicence2') || {}).value || '',
        nearExpiryDays: Number((document.getElementById('hsNearExpiryDays') || {}).value) || 60,
        followUpValidityDays: Number((document.getElementById('hsFollowUpDays') || {}).value) || 7,
        grnRequiresPo: ((document.getElementById('hsGrnRequiresPo') || {}).value === 'true'),
        discountApproverRole: (document.getElementById('hsDiscountApprover') || {}).value || 'doctor',
        refundApproverRole: (document.getElementById('hsRefundApprover') || {}).value || 'doctor',
        pharmacyBillNote: (document.getElementById('hsPharmacyBillNote') || {}).value || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
    .then(() => { btn.textContent = 'Save Settings'; showToast('Settings saved!', 'success'); })
    .catch(err => { btn.textContent = 'Save Settings'; showToast('Error: ' + err.message, 'error'); });
});

// ==========================================
// P9: DOCTOR PERFORMANCE REPORT — date range filter
// ==========================================
let currentReportData = [];

document.getElementById('filterReportBtn') && document.getElementById('filterReportBtn').addEventListener('click', runPerformanceReport);

// Month and range are alternatives, so choosing one clears the other —
// otherwise the range silently wins and the month picker looks broken.
document.getElementById('reportMonthFilter') && document.getElementById('reportMonthFilter').addEventListener('change', function(e) {
    if (!e.target.value) return;
    const fromEl = document.getElementById('reportFromDate');
    const toEl = document.getElementById('reportToDate');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    runPerformanceReport();
});

['reportFromDate', 'reportToDate'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', function() {
        const monthEl = document.getElementById('reportMonthFilter');
        if (monthEl) monthEl.value = '';
    });
});

function runPerformanceReport() {
    const fromEl = document.getElementById('reportFromDate');
    const toEl = document.getElementById('reportToDate');
    const monthEl = document.getElementById('reportMonthFilter');

    let fromDate, toDate;
    if (fromEl && fromEl.value && toEl && toEl.value) {
        fromDate = new Date(fromEl.value);
        toDate = new Date(toEl.value); toDate.setHours(23, 59, 59, 999);
    } else if (monthEl && monthEl.value) {
        const [yr, mo] = monthEl.value.split('-').map(Number);
        fromDate = new Date(yr, mo - 1, 1);
        toDate = new Date(yr, mo, 0, 23, 59, 59);
    } else { showToast('Select a date range or month.', 'warning'); return; }

    setLoadingRow('performanceTableBody', 7);
    db.collection('bills').get().then(snapshot => {
        const docStats = {};
        snapshot.forEach(doc => {
            const bill = doc.data();
            if (!bill.createdAt) return;
            const date = bill.createdAt.toDate ? bill.createdAt.toDate() : new Date(bill.createdAt);
            if (date < fromDate || date > toDate) return;
            const name = bill.visitDoctor || 'Unassigned';
            if (!docStats[name]) docStats[name] = { name, specialisation: bill.visitDoctorSpec || '', patients: 0, opd: 0, ipd: 0, totalRevenue: 0, consultRevenue: 0 };
            docStats[name].patients++;
            // Bills store the visit kind as `type`; `visitType` is the form
            // field name only, so reading it left OPD/IPD stuck at zero.
            const visitKind = (bill.type || bill.visitType || '').toUpperCase();
            if (visitKind === 'OPD') docStats[name].opd++;
            else if (visitKind === 'IPD' || visitKind === 'ICU') docStats[name].ipd++;
            docStats[name].totalRevenue += bill.grandTotal || 0;
            // Estimate consultation revenue from charge items
            (bill.items || []).forEach(c => {
                // Older/imported items carry no category, so fall back to the
                // description — otherwise this column is always zero.
                var cat = String(c.category || '').toLowerCase();
                var desc = String(c.description || '').toLowerCase();
                if (cat === 'consultation' || (!cat && /consult/.test(desc))) docStats[name].consultRevenue += c.amount || 0;
            });
        });

        const tbody = document.getElementById('performanceTableBody');
        tbody.innerHTML = '';
        currentReportData = Object.values(docStats);
        if (!currentReportData.length) { setEmptyRow('performanceTableBody', 'No data for selected period.', 7); return; }
        currentReportData.sort((a, b) => b.totalRevenue - a.totalRevenue).forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${s.name}</td><td>${s.specialisation || '-'}</td><td>${s.patients}</td><td>${s.opd}</td><td>${s.ipd}</td><td>₹${s.consultRevenue.toFixed(2)}</td><td>₹${s.totalRevenue.toFixed(2)}</td>`;
            tbody.appendChild(tr);
        });
    }).catch(err => { setEmptyRow('performanceTableBody', 'Error loading data.', 7); showToast('Error: ' + err.message, 'error'); });
}

document.getElementById('exportReportBtn').addEventListener('click', function() {
    if (!currentReportData.length) { showToast('No data to export.', 'warning'); return; }
    let csv = 'data:text/csv;charset=utf-8,Doctor,Specialisation,Total Patients,OPD,IPD,Consult Revenue,Total Revenue\n';
    currentReportData.forEach(r => { csv += `"${r.name}","${r.specialisation}",${r.patients},${r.opd},${r.ipd},${r.consultRevenue.toFixed(2)},${r.totalRevenue.toFixed(2)}\n`; });
    const link = document.createElement('a'); link.setAttribute('href', encodeURI(csv)); link.setAttribute('download', 'Doctor_Performance.csv');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
});
