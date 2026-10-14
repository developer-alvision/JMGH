// ==========================================
// JMGH HMS - CLINICAL CONSULTATION JS
// ==========================================

checkAccess(['doctor', 'admin']);

let currentUserEmail = '';
let currentDoctorName = '';
let currentDoctorId = '';
let currentDoctor = null;
let currentDoctorDept = 'General';
let allMedicines = [];

let currentPatient = null;
let patientId = '';
let appointmentId = '';
let activeConsultationId = '';
let consultationSaving = false;
let consultationReady = false;

// Common Lab Tests List with default OPD prices
const COMMON_LAB_TESTS = window.HOSPITAL_POLICY ? HOSPITAL_POLICY.labs : [];

// Common Imaging Scans List with default prices
const COMMON_IMAGING_TESTS = window.HOSPITAL_POLICY ? HOSPITAL_POLICY.imaging : [];

// Page Load
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    
    // Parse URL params
    const params = new URLSearchParams(window.location.search);
    patientId = params.get('patientId');
    appointmentId = params.get('appointmentId');
    const tokenIdParam = params.get('tokenId');
    const consultationIdParam = params.get('consultationId');
    
    if (!patientId) {
        showToast('No Patient ID supplied.', 'error');
        setTimeout(() => { window.location.href = 'doctor-dashboard.html'; }, 1000);
        return;
    }
    
    // Set Profile Link
    document.getElementById('lnkViewProfile').href = `patient-profile.html?id=${patientId}`;
    
    // Load Doctor Details
    db.collection('staff').where('email', '==', currentUserEmail).get().then(snap => {
        if (!snap.empty) {
            currentDoctor = snap.docs[0].data();
            currentDoctorId = currentDoctor.uid || user.uid || snap.docs[0].id;
            currentDoctorName = currentDoctor.name;
            currentDoctorDept = currentDoctor.department || 'General';
        } else {
            // Admin or other unlisted user fallback
            currentDoctorName = user.displayName || user.email || 'Administrator';
            currentDoctorId = user.uid || 'admin';
            currentDoctorDept = 'General';
        }
        
        // Load Grids & Patient records
        renderDiagnosticGrids();
        const patientLoad = loadPatient(patientId);
        loadPreviousConsultations(patientId);
        loadAllMedicines();
        activeConsultationId = consultationIdParam || (appointmentId ? 'CONS-' + appointmentId : db.collection('consultations').doc().id);
        Promise.all([patientLoad, prefillsFromOpQueue(tokenIdParam, activeConsultationId)])
            .then(function () { consultationReady = true; })
            .catch(function (err) { showToast('Unable to load consultation: ' + err.message, 'error'); });
    }).catch(function (err) { showToast('Unable to load doctor: ' + err.message, 'error'); });
});

// Setup Checkboxes and dynamic input toggle
function renderDiagnosticGrids() {
    const labGrid = document.getElementById('labTestsGrid');
    const imgGrid = document.getElementById('imagingTestsGrid');
    
    // 1. Lab grid
    labGrid.innerHTML = '';
    COMMON_LAB_TESTS.forEach(test => {
        const item = document.createElement('div');
        item.className = 'test-item';
        item.innerHTML = `
            <label>
                <input type="checkbox" class="lab-check" data-name="${test.name}" value="${test.id}" onchange="toggleTestAmount(this)">
                <span>${test.name}</span>
            </label>
            <input type="number" class="amount-input" id="amt_lab_${test.id}" value="${test.price}">
        `;
        labGrid.appendChild(item);
    });
    
    // Custom Lab
    const customLab = document.createElement('div');
    customLab.className = 'test-item';
    customLab.style.gridColumn = 'span 2';
    customLab.innerHTML = `
        <label>
            <input type="checkbox" class="lab-check custom-test-check" data-name="Custom Lab" value="CustomLab" onchange="toggleTestAmount(this)">
            <input type="text" placeholder="Custom Lab Test Name" id="name_lab_CustomLab" class="rx-input" style="height:28px; font-size:0.8rem; width:80%;" readonly>
        </label>
        <input type="number" class="amount-input" id="amt_lab_CustomLab" value="300">
    `;
    labGrid.appendChild(customLab);
    
    // 2. Imaging grid
    imgGrid.innerHTML = '';
    COMMON_IMAGING_TESTS.forEach(test => {
        const item = document.createElement('div');
        item.className = 'test-item';
        item.innerHTML = `
            <label>
                <input type="checkbox" class="img-check" data-name="${test.name}" value="${test.id}" onchange="toggleTestAmount(this)">
                <span>${test.name}</span>
            </label>
            <input type="number" class="amount-input" id="amt_img_${test.id}" value="${test.price}">
        `;
        imgGrid.appendChild(item);
    });
    
    // Custom Imaging
    const customImg = document.createElement('div');
    customImg.className = 'test-item';
    customImg.style.gridColumn = 'span 2';
    customImg.innerHTML = `
        <label>
            <input type="checkbox" class="img-check custom-test-check" data-name="Custom Imaging" value="CustomImg" onchange="toggleTestAmount(this)">
            <input type="text" placeholder="Custom Imaging Scan Name" id="name_img_CustomImg" class="rx-input" style="height:28px; font-size:0.8rem; width:80%;" readonly>
        </label>
        <input type="number" class="amount-input" id="amt_img_CustomImg" value="1000">
    `;
    imgGrid.appendChild(customImg);
}

function toggleTestAmount(chk) {
    const isCustom = chk.classList.contains('custom-test-check');
    const type = chk.classList.contains('lab-check') ? 'lab' : 'img';
    const amtInput = document.getElementById(`amt_${type}_${chk.value}`);
    const nameInput = isCustom ? document.getElementById(`name_${type}_${chk.value}`) : null;
    
    if (chk.checked) {
        amtInput.style.display = 'block';
        if (nameInput) {
            nameInput.removeAttribute('readonly');
            nameInput.focus();
            nameInput.setAttribute('required', 'true');
        }
    } else {
        amtInput.style.display = 'none';
        if (nameInput) {
            nameInput.setAttribute('readonly', 'true');
            nameInput.value = '';
            nameInput.removeAttribute('required');
        }
    }
}
window.toggleTestAmount = toggleTestAmount;

// Follow-up Section display toggling
document.getElementById('followUpRequired').addEventListener('change', function() {
    const checked = this.checked;
    const dateGrp = document.getElementById('followUpDateGroup');
    const notesGrp = document.getElementById('followUpNotesGroup');
    const dateInput = document.getElementById('followUpDate');
    
    if (checked) {
        dateGrp.style.display = 'flex';
        notesGrp.style.display = 'flex';
        dateInput.setAttribute('required', 'true');
    } else {
        dateGrp.style.display = 'none';
        notesGrp.style.display = 'none';
        dateInput.removeAttribute('required');
        dateInput.value = '';
        document.getElementById('followUpNotes').value = '';
    }
});

// ==========================================
// 3. MEDICINE ROWS BUILDER & AUTOCOMPLETE
// ==========================================
let rxRowCount = 0;

function refreshDrugSafetyAlerts() {
    if (!window.drugSafety) return;
    var names = [];
    document.querySelectorAll('#prescriptionTableBody .med-name').forEach(function (input) {
        if (input.value && input.value.trim()) names.push(input.value.trim());
    });
    var hits = drugSafety.checkList(names);
    var pregnant = !!(currentPatient && currentPatient.isPregnant);
    drugSafety.renderBanner(document.getElementById('drugSafetyBanner'), hits, pregnant);
}
window.refreshDrugSafetyAlerts = refreshDrugSafetyAlerts;

document.getElementById('btnAddMedRow').addEventListener('click', addPrescriptionRow);

function addPrescriptionRow() {
    rxRowCount++;
    const tbody = document.getElementById('prescriptionTableBody');
    if (!tbody) return;
    
    const tr = document.createElement('tr');
    tr.id = `rxRow_${rxRowCount}`;
    tr.innerHTML = `
        <td>
            <input type="text" class="rx-input med-name" id="medName_${rxRowCount}" required placeholder="Type drug name..." autocomplete="off" oninput="showDrugSuggestions(this, ${rxRowCount}); refreshDrugSafetyAlerts();">
            <div class="drug-suggestions" id="suggestions_${rxRowCount}"></div>
        </td>
        <td>
            <input type="text" class="rx-input" id="medDosage_${rxRowCount}" required placeholder="e.g. 500mg">
        </td>
        <td>
            <select class="rx-input" id="medFreq_${rxRowCount}" required>
                <option value="Once daily">Once daily (1-0-0)</option>
                <option value="Twice daily">Twice daily (1-0-1)</option>
                <option value="Three times daily">Three times daily (1-1-1)</option>
                <option value="Four times daily">Four times daily (1-1-1-1)</option>
                <option value="Every 8 hours">Every 8 hours</option>
                <option value="Every 6 hours">Every 6 hours</option>
                <option value="At bedtime">At bedtime</option>
                <option value="As needed">As needed (PRN)</option>
            </select>
        </td>
        <td>
            <select class="rx-input" id="medDuration_${rxRowCount}" required>
                <option value="1 day">1 day</option>
                <option value="2 days">2 days</option>
                <option value="3 days">3 days</option>
                <option value="4 days">4 days</option>
                <option value="5 days">5 days</option>
                <option value="6 days">6 days</option>
                <option value="7 days">7 days</option>
                <option value="10 days">10 days</option>
                <option value="14 days">14 days</option>
                <option value="15 days">15 days</option>
                <option value="30 days">30 days</option>
            </select>
        </td>
        <td>
            <select class="rx-input" id="medInst_${rxRowCount}">
                <option value="">No instructions</option>
                <option value="After food">After food</option>
                <option value="Before food">Before food</option>
                <option value="With food">With food</option>
                <option value="Empty stomach">Empty stomach</option>
            </select>
        </td>
        <td style="text-align:center;">
            <button type="button" class="btn-cancel" onclick="deleteMedRow(${rxRowCount})" style="padding:4px 8px; font-size:11px; border-radius:4px;"><i class="fa-solid fa-trash"></i></button>
        </td>
    `;
    tbody.appendChild(tr);
}

function deleteMedRow(rowId) {
    const tr = document.getElementById(`rxRow_${rowId}`);
    if (tr) tr.remove();
}
window.deleteMedRow = deleteMedRow;

// Load all medicines once on page load for client-side search (synced in real-time)
let pharmacyListener = null;
function loadAllMedicines() {
    if (pharmacyListener) pharmacyListener();
    pharmacyListener = db.collection('pharmacy').onSnapshot(snap => {
        allMedicines = [];
        snap.forEach(doc => {
            const data = doc.data();
            allMedicines.push({
                id: doc.id,
                medicineName: data.medicineName || '',
                genericName: data.genericName || '',
                stock: data.stock || 0,
                reorderLevel: data.reorderLevel || 20
            });
        });
    }, err => {
        console.error('Error listening to medicines for suggestions:', err);
    });
}
window.loadAllMedicines = loadAllMedicines;

// Real-time suggest query drug suggestion list from in-memory allMedicines
function showDrugSuggestions(inputEl, rowId) {
    const q = inputEl.value.trim().toLowerCase();
    const dropdown = document.getElementById(`suggestions_${rowId}`);
    
    if (!q || q.length < 1) {
        dropdown.style.display = 'none';
        return;
    }
    
    const matches = allMedicines.filter(m => 
        (m.medicineName && m.medicineName.toLowerCase().includes(q)) || 
        (m.genericName && m.genericName.toLowerCase().includes(q))
    ).slice(0, 6);
    
    if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
    }
    
    let html = '';
    matches.forEach(drug => {
        const escapedName = drug.medicineName.replace(/'/g, "\\'");
        const escapedGeneric = drug.genericName.replace(/'/g, "\\'");
        const isOutOfStock = drug.stock <= 0;
        const isLowStock = !isOutOfStock && drug.stock <= (drug.reorderLevel || 20);
        
        let badgeColor = '#10b981';
        let badgeText = `In Stock (${drug.stock})`;
        if (isOutOfStock) {
            badgeColor = '#ef4444';
            badgeText = 'Out of Stock';
        } else if (isLowStock) {
            badgeColor = '#f59e0b';
            badgeText = `Low Stock (${drug.stock})`;
        }
        
        html += `
            <div class="drug-suggestion-item" onclick="selectDrugForPrescription(${rowId}, '${escapedName}', '${escapedGeneric}')">
                <strong>${drug.medicineName}</strong> <small style="color:#666;">(${drug.genericName || ''})</small>
                <span style="float:right; font-size:10px; font-weight:600; color:${badgeColor}">${badgeText}</span>
            </div>
        `;
    });
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}
window.showDrugSuggestions = showDrugSuggestions;

function selectDrugForPrescription(rowId, name, generic) {
    document.getElementById(`medName_${rowId}`).value = name;
    document.getElementById(`suggestions_${rowId}`).style.display = 'none';
}
window.selectDrugForPrescription = selectDrugForPrescription;

// Close suggestions dropdown on outside click
document.addEventListener('click', function(e) {
    document.querySelectorAll('.drug-suggestions').forEach(dropdown => {
        const rowId = dropdown.id.split('_')[1];
        const input = document.getElementById(`medName_${rowId}`);
        if (input && !input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
});

// ==========================================
// 4. LOAD PATIENT AND CLINICAL PREVIOUS HISTORY
// ==========================================
function prefillsFromOpQueue(tokenId, consultationId) {
    function applyVitals(v, chief) {
        if (!v) return;
        if (document.getElementById('vitalBP') && v.bp) document.getElementById('vitalBP').value = v.bp;
        if (document.getElementById('vitalPulse') && v.pulse) document.getElementById('vitalPulse').value = v.pulse;
        if (document.getElementById('vitalTemp') && (v.temperature || v.temp)) document.getElementById('vitalTemp').value = v.temperature || v.temp;
        if (document.getElementById('vitalWeight') && v.weight) document.getElementById('vitalWeight').value = v.weight;
        if (document.getElementById('vitalSpO2') && v.spo2) document.getElementById('vitalSpO2').value = v.spo2;
        var cc = document.getElementById('chiefComplaint');
        if (cc && chief && !cc.value) cc.value = chief;
        showToast('OP queue vitals loaded for this consultation.', 'success');
    }

    function loadDraft(id) {
        return db.collection('consultations').doc(id).get().then(function (doc) {
            if (doc.exists) {
                var d = doc.data();
                if (d.patientId && d.patientId !== patientId) throw new Error('Consultation belongs to another patient.');
                activeConsultationId = id;
                applyVitals(d.vitals || {}, d.chiefComplaint || '');
                const fields = { historyOfIllness: 'historyIllness', examinationFindings: 'examinationFindings', diagnosis: 'diagnosis', advice: 'advice', followUpDate: 'followUpDate', followUpNotes: 'followUpNotes' };
                document.getElementById('followUpRequired').checked = !!d.followUpRequired;
                document.getElementById('followUpRequired').dispatchEvent(new Event('change'));
                Object.keys(fields).forEach(function (key) { document.getElementById(fields[key]).value = d[key] || ''; });
                if (d.vitals) document.getElementById('vitalHeight').value = d.vitals.height || '';
                ['lab', 'img'].forEach(function (type) {
                    const orders = (type === 'lab' ? d.labOrders : d.imagingOrders) || [];
                    document.querySelectorAll('.' + type + '-check').forEach(function (checkbox) {
                        const order = orders.find(function (item) { return item.name === checkbox.dataset.name; });
                        if (order) { checkbox.checked = true; toggleTestAmount(checkbox); document.getElementById('amt_' + type + '_' + checkbox.value).value = order.amount; }
                    });
                    const known = type === 'lab' ? COMMON_LAB_TESTS : COMMON_IMAGING_TESTS;
                    const custom = orders.find(function (item) { return !known.some(function (test) { return test.name === item.name; }); });
                    if (custom) {
                        const checkbox = document.querySelector('.' + type + '-check.custom-test-check');
                        checkbox.checked = true; toggleTestAmount(checkbox);
                        document.getElementById('name_' + type + '_' + checkbox.value).value = custom.name;
                        document.getElementById('amt_' + type + '_' + checkbox.value).value = custom.amount;
                    }
                });
                const savedMeds = Array.isArray(d.prescription) && d.prescription.length ? d.prescription
                    : (Array.isArray(d.medicines) && d.medicines.length ? d.medicines
                    : (Array.isArray(d.medications) && d.medications.length ? d.medications
                    : (Array.isArray(d.rx) && d.rx.length ? d.rx : [])));
                if (savedMeds.length) {
                    document.getElementById('prescriptionTableBody').innerHTML = '';
                    savedMeds.forEach(function (medicine) {
                        addPrescriptionRow();
                        const rxFields = { name: 'medName', dosage: 'medDosage', frequency: 'medFreq', duration: 'medDuration', instructions: 'medInst' };
                        Object.keys(rxFields).forEach(function (key) {
                            const val = medicine[key] || medicine[key === 'name' ? 'medicineName' : key] || '';
                            const el = document.getElementById(rxFields[key] + '_' + rxRowCount);
                            if (el) {
                                if (el.tagName === 'SELECT' && val) {
                                    let optFound = false;
                                    for (let i = 0; i < el.options.length; i++) {
                                        if (el.options[i].value.toLowerCase() === val.toLowerCase()) {
                                            el.selectedIndex = i; optFound = true; break;
                                        }
                                    }
                                    if (!optFound) {
                                        const newOpt = document.createElement('option');
                                        newOpt.value = val; newOpt.textContent = val;
                                        el.appendChild(newOpt); el.value = val;
                                    }
                                } else {
                                    el.value = val;
                                }
                            }
                        });
                    });
                }
                window._linkedOpConsultationId = id;
                window._linkedOpTokenId = d.tokenId || tokenId || '';
            }
        });
    }
    if (tokenId) {
        return db.collection('opTokens').doc(tokenId).get().then(function (doc) {
            if (doc.exists) {
                var d = doc.data();
                if (d.patientId && d.patientId !== patientId) throw new Error('Queue token belongs to another patient.');
                applyVitals(d.vitals || {}, d.chiefComplaint || '');
                window._linkedOpTokenId = tokenId;
                return loadDraft(d.consultationId || consultationId);
            }
            return loadDraft(consultationId);
        });
    }
    return loadDraft(consultationId);
}
window.prefillsFromOpQueue = prefillsFromOpQueue;

function loadPatient(ptId) {
    return db.collection('patients').where('patientId', '==', ptId).get().then(snap => {
        if (snap.empty) {
            // fallback
            return db.collection('patients').doc(ptId).get();
        }
        return snap.docs[0];
    }).then(doc => {
        if (!doc.exists) throw new Error('Patient record not found.');
        currentPatient = { id: doc.id, ...doc.data() };
        window.currentConsultPatient = currentPatient;
        if (typeof refreshDrugSafetyAlerts === 'function') refreshDrugSafetyAlerts();
        
        // Calculate age
        const dob = currentPatient.dob;
        let age = '—';
        if (dob) {
            const diff = Date.now() - new Date(dob).getTime();
            age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
        }
        
        document.getElementById('barName').textContent = currentPatient.name || '—';
        document.getElementById('barId').textContent = currentPatient.patientId || '—';
        document.getElementById('barAgeGender').textContent = `${age} Yrs / ${currentPatient.gender || '—'}`;
        document.getElementById('barBlood').textContent = currentPatient.bloodGroup || '—';
        document.getElementById('barDept').textContent = currentPatient.department || '—';
        
        var docName = currentPatient.doctor || currentPatient.doctorName || currentDoctorName || '—';
        document.getElementById('barDoctor').textContent = docName;
        
        // Expose linked profiles
        document.getElementById('lnkViewProfile').href = `patient-profile.html?id=${currentPatient.patientId}`;
    }).catch(err => {
        console.error('Error loading patient details:', err);
        throw err;
    });
}

function loadPreviousConsultations(ptId) {
    const container = document.getElementById('previousConsultsContainer');
    if (!container) return;
    
    // Look up last 3 consultations
    db.collection('consultations')
        .where('patientId', '==', ptId)
        .orderBy('createdAt', 'desc')
        .limit(3)
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                container.innerHTML = '<div style="font-size:0.8rem; color:#888; text-align:center; padding:20px;">No previous consultations recorded.</div>';
                return;
            }
            
            let html = '';
            snapshot.forEach(doc => {
                const c = doc.data();
                const dateStr = c.createdAt ? formatDate(c.createdAt) : '—';
                
                let medsHtml = '';
                const rxList = Array.isArray(c.prescription) && c.prescription.length ? c.prescription
                    : (Array.isArray(c.medicines) && c.medicines.length ? c.medicines
                    : (Array.isArray(c.medications) && c.medications.length ? c.medications
                    : (Array.isArray(c.rx) && c.rx.length ? c.rx : [])));

                if (rxList.length > 0) {
                    medsHtml = '<ul style="margin: 4px 0 0 14px; font-size:11px; padding:0; list-style-type:disc;">';
                    rxList.forEach(m => {
                        const name = m.name || m.medicineName || m.item || m.drugName || 'Medicine';
                        const dosage = m.dosage || m.dose || '';
                        const freq = m.frequency || m.freq || '';
                        const dur = m.duration ? ` (${escapeHtml(m.duration)})` : '';
                        medsHtml += `<li style="margin-bottom:2px;"><strong>${escapeHtml(name)}</strong>${dosage ? ' ' + escapeHtml(dosage) : ''}${freq ? ' — ' + escapeHtml(freq) : ''}${dur}</li>`;
                    });
                    medsHtml += '</ul>';
                } else {
                    medsHtml = '<em style="color:#94a3b8;">None</em>';
                }
                
                html += `
                    <div class="history-card">
                        <div class="history-date"><i class="fa-regular fa-clock"></i> ${dateStr} by ${escapeHtml(c.doctorName || '—')}</div>
                        <div class="history-field"><label>Complaint: </label><span>${escapeHtml(c.chiefComplaint || '—')}</span></div>
                        <div class="history-field"><label>Diagnosis: </label><span>${escapeHtml(c.diagnosis || '—')}</span></div>
                        <div class="history-field"><label>Rx Prescribed: </label>${medsHtml}</div>
                    </div>
                `;
            });
            container.innerHTML = html;
        }).catch(err => {
            console.error('Error loading historical consultations:', err);
        });
}

// ==========================================
// 5. DIAGNOSTICS & PRESCRIPTION EXTRACTIONS
// ==========================================
function getSelectedLabTests() {
    const list = [];
    document.querySelectorAll('.lab-check').forEach(chk => {
        if (chk.checked) {
            const isCustom = chk.classList.contains('custom-test-check');
            let name = chk.dataset.name;
            if (isCustom) {
                name = document.getElementById(`name_lab_${chk.value}`).value.trim() || 'Custom Lab Test';
            }
            const amount = parseFloat(document.getElementById(`amt_lab_${chk.value}`).value) || 0;
            list.push({ name, amount });
        }
    });
    return list;
}

function getSelectedImagingTests() {
    const list = [];
    document.querySelectorAll('.img-check').forEach(chk => {
        if (chk.checked) {
            const isCustom = chk.classList.contains('custom-test-check');
            let name = chk.dataset.name;
            if (isCustom) {
                name = document.getElementById(`name_img_${chk.value}`).value.trim() || 'Custom Scan';
            }
            const amount = parseFloat(document.getElementById(`amt_img_${chk.value}`).value) || 0;
            list.push({ name, amount });
        }
    });
    return list;
}

function getPrescriptionData() {
    const list = [];
    document.querySelectorAll('#prescriptionTableBody tr').forEach(tr => {
        const id = tr.id.split('_')[1];
        const name = document.getElementById(`medName_${id}`).value.trim();
        const dosage = document.getElementById(`medDosage_${id}`).value.trim();
        const frequency = document.getElementById(`medFreq_${id}`).value;
        const duration = document.getElementById(`medDuration_${id}`).value.trim();
        const instructions = document.getElementById(`medInst_${id}`).value.trim();
        
        if (name) {
            list.push({ name, dosage, frequency, duration, instructions });
        }
    });
    return list;
}

// ==========================================
// 6. SAVE DRAFT & COMPLETE TRIGGERS
// ==========================================
document.getElementById('btnSaveDraft').addEventListener('click', function(e) {
    e.preventDefault();
    const chief = document.getElementById('chiefComplaint').value.trim();
    const diag = document.getElementById('diagnosis').value.trim();
    
    if (!chief || !diag) {
        showToast('Chief Complaint and Diagnosis are required even for Drafts!', 'warning');
        return;
    }
    
    saveConsultation(true);
});

const btnPrintCurrent = document.getElementById('btnPrintCurrentConsult');
if (btnPrintCurrent) {
    btnPrintCurrent.addEventListener('click', function(e) {
        e.preventDefault();
        const labOrders = getSelectedLabTests();
        const imagingOrders = getSelectedImagingTests();
        const prescription = getPrescriptionData();
        const tempConsult = {
            consultationId: activeConsultationId,
            patientId: currentPatient ? currentPatient.patientId : '',
            patientName: currentPatient ? currentPatient.name : '',
            doctorName: currentDoctorName,
            department: currentDoctorDept,
            vitals: {
                bp: document.getElementById('vitalBP').value.trim(),
                pulse: document.getElementById('vitalPulse').value,
                temperature: document.getElementById('vitalTemp').value,
                weight: document.getElementById('vitalWeight').value,
                height: document.getElementById('vitalHeight').value,
                spo2: document.getElementById('vitalSpO2').value
            },
            symptoms: document.getElementById('chiefComplaint').value.trim(),
            chiefComplaint: document.getElementById('chiefComplaint').value.trim(),
            historyOfIllness: document.getElementById('historyIllness').value.trim(),
            examinationFindings: document.getElementById('examinationFindings').value.trim(),
            diagnosis: document.getElementById('diagnosis').value.trim(),
            advice: document.getElementById('advice').value.trim(),
            labOrders: labOrders,
            imagingOrders: imagingOrders,
            prescription: prescription,
            createdAt: new Date()
        };
        if (typeof generateClinicalOPBillPDF === 'function') {
            generateClinicalOPBillPDF(activeConsultationId, { consultation: tempConsult, patient: currentPatient });
        } else if (typeof generateBilingualPrescriptionFromConsultationPDF === 'function') {
            generateBilingualPrescriptionFromConsultationPDF(tempConsult);
        }
    });
}

document.getElementById('consultationForm').addEventListener('submit', function(e) {
    e.preventDefault();
    saveConsultation(false);
});

function saveConsultation(isDraft) {
    if (consultationSaving) return;
    if (!currentPatient || !consultationReady) {
        showToast('Patient record not loaded yet.', 'warning');
        return;
    }
    
    // DATE FIX 9: Follow-up date validation
    const followUpReq = document.getElementById('followUpRequired').checked;
    const followUpDateVal = document.getElementById('followUpDate').value;
    if (!isDraft && followUpReq) {
        if (!followUpDateVal) {
            showToast('Follow-up date is required.', 'warning');
            return;
        }
        const todayStr = todayIso(); // 'YYYY-MM-DD'
        if (followUpDateVal <= todayStr) {
            showToast('Follow-up date must be in the future (greater than today).', 'warning');
            return;
        }
    }
    
    const labOrders = getSelectedLabTests();
    const imagingOrders = getSelectedImagingTests();
    if (labOrders.concat(imagingOrders).some(function (test) { return !Number.isFinite(test.amount) || test.amount < 0; })) {
        showToast('Diagnostic prices must be valid, non-negative amounts.', 'warning'); return;
    }
    consultationSaving = true;
    const saveBtn = isDraft ? document.getElementById('btnSaveDraft') : document.getElementById('btnCompleteConsult');
    document.getElementById('btnSaveDraft').disabled = true;
    document.getElementById('btnCompleteConsult').disabled = true;
    saveBtn.textContent = 'Saving...';
    
    var consultationData = {
        consultationId: activeConsultationId,
        tokenId: window._linkedOpTokenId || '',
        appointmentId: appointmentId || '',
        patientId: currentPatient.patientId,
        patientDocId: currentPatient.id,
        patientName: currentPatient.name,
        doctorName: currentDoctorName,
        doctorId: currentDoctorId,
        department: currentDoctorDept || 'General',
        vitals: {
            bp: document.getElementById('vitalBP').value.trim(),
            pulse: document.getElementById('vitalPulse').value,
            temperature: document.getElementById('vitalTemp').value,
            weight: document.getElementById('vitalWeight').value,
            height: document.getElementById('vitalHeight').value,
            spo2: document.getElementById('vitalSpO2').value
        },
        chiefComplaint: document.getElementById('chiefComplaint').value.trim(),
        historyOfIllness: document.getElementById('historyIllness').value.trim(),
        examinationFindings: document.getElementById('examinationFindings').value.trim(),
        diagnosis: document.getElementById('diagnosis').value.trim(),
        advice: document.getElementById('advice').value.trim(),
        labOrders: labOrders,
        imagingOrders: imagingOrders,
        prescription: getPrescriptionData(),
        medicines: getPrescriptionData(),
        medications: getPrescriptionData(),
        followUpRequired: document.getElementById('followUpRequired').checked,
        followUpDate: document.getElementById('followUpDate').value,
        followUpNotes: document.getElementById('followUpNotes').value.trim(),
        phoneOP: !!(document.getElementById('consultationPhoneOP') && document.getElementById('consultationPhoneOP').checked),
        status: isDraft ? 'draft' : 'completed',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    var db = firebase.firestore();
    const save = isDraft ? db.runTransaction(async function (transaction) {
        const ref = db.collection('consultations').doc(consultationData.consultationId);
        const existing = await transaction.get(ref);
        if (existing.exists && existing.data().status === 'completed') throw new Error('This consultation is already completed.');
        if (existing.exists && existing.data().patientId !== consultationData.patientId) throw new Error('Consultation patient mismatch.');
        transaction.set(ref, Object.assign({}, consultationData, { createdAt: existing.exists && existing.data().createdAt || firebase.firestore.FieldValue.serverTimestamp() }), { merge: true });
    }) : triggerDownstreamActions(consultationData);
    return save
    .then(function() {
        showToast('Consultation saved successfully', 'success');
        if (!isDraft) {
            window.location.href = 'doctor-dashboard.html';
        } else if (window.history && window.history.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.set('consultationId', activeConsultationId);
            window.history.replaceState(null, '', url.toString());
        }
    }).catch(err => {
        console.error('Error saving consultation:', err);
        showToast('Error saving consultation: ' + err.message, 'error');
    }).finally(() => {
        consultationSaving = false;
        document.getElementById('btnSaveDraft').disabled = false;
        document.getElementById('btnCompleteConsult').disabled = false;
        saveBtn.textContent = isDraft ? 'Save Draft' : 'Complete Consultation';
    });
}
window.saveConsultation = saveConsultation;

// A single transaction reserves the bill number and completes all linked records.
async function triggerDownstreamActions(consultation) {
    var db = firebase.firestore();
    var fee = typeof getHospitalOPFee === 'function' ? await getHospitalOPFee({ docId: consultation.patientDocId, patientId: consultation.patientId }, { id: consultation.doctorId, name: consultation.doctorName, freeOP: currentDoctor && currentDoctor.freeOP }, todayIso(), { phone: !!consultation.phoneOP }) : { amount: currentDoctor && currentDoctor.freeOP ? 0 : Number(currentDoctor && currentDoctor.opFee != null ? currentDoctor.opFee : 300), base: 300, surcharge: 0, reason: 'New OP', startsEpisode: true, episodeDate: todayIso(), policyVersion: '2026-10-13' };
    return db.runTransaction(async function(batch) {
        const consultationRef = db.collection('consultations').doc(consultation.consultationId);
        const savedConsultation = await batch.get(consultationRef);
        if (savedConsultation.exists && savedConsultation.data().patientId !== consultation.patientId) throw new Error('Consultation patient mismatch.');
        if (savedConsultation.exists && savedConsultation.data().status === 'completed' && savedConsultation.data().billDocId) return;
        const counterDoc = await batch.get(db.collection('billCounters').doc('opd'));
        var bookedOP = null;
        if (consultation.appointmentId) {
            const appointment = await batch.get(db.collection('appointments').doc(consultation.appointmentId));
            if (!appointment.exists || appointment.data().patientId !== consultation.patientId) throw new Error('Appointment does not match this patient.');
            if (appointment.data().status === 'cancelled') throw new Error('This appointment was cancelled.');
            if (appointment.data().status === 'completed' && appointment.data().consultationId !== consultation.consultationId) throw new Error('This appointment already has a completed consultation.');
            bookedOP = appointment.data();
        }
        var count = (counterDoc.exists ? counterDoc.data().count || 0 : 0) + 1;
        var year = new Date().getFullYear();
        var billId = 'SA-OPD-' + year + '-' + String(count).padStart(5, '0');
        
        var billRef = db.collection('bills').doc(); // Auto-generated unique doc ID
        
        // Doctor orders stay AWAITING BILLING — do NOT push to lab/imaging work queues
        // until reception bills / payment is recorded (Indian hospital billing gate).
        consultation.labOrders.forEach(function(test) {
            var reportRef = db.collection('reports').doc();
            batch.set(reportRef, {
                reportId: 'SA-LAB-' + new Date().getFullYear() + '-' + Math.floor(Math.random() * 90000 + 10000),
                patientId: consultation.patientId,
                patientName: consultation.patientName,
                patientDocId: consultation.patientDocId || '',
                testName: test.name,
                amount: test.amount,
                referredBy: consultation.doctorName,
                status: 'pending',
                type: 'lab',
                billingStatus: 'unpaid',
                source: 'doctor_order',
                linkedBillId: billId,
                billDocId: billRef.id,
                consultationId: consultation.consultationId,
                retainUntil: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000)),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        consultation.imagingOrders.forEach(function(scan) {
            var reportRef = db.collection('reports').doc();
            batch.set(reportRef, {
                reportId: 'SA-IMG-' + new Date().getFullYear() + '-' + Math.floor(Math.random() * 90000 + 10000),
                patientId: consultation.patientId,
                patientName: consultation.patientName,
                patientDocId: consultation.patientDocId || '',
                testName: scan.name,
                imagingType: scan.name,
                amount: scan.amount,
                referredBy: consultation.doctorName,
                status: 'pending',
                type: 'imaging',
                billingStatus: 'unpaid',
                source: 'doctor_order',
                linkedBillId: billId,
                billDocId: billRef.id,
                consultationId: consultation.consultationId,
                retainUntil: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000)),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        // 3. Save prescription to /prescriptions
        if (consultation.prescription.length > 0) {
            var rxRef = db.collection('prescriptions').doc('RX-' + consultation.consultationId);
            batch.set(rxRef, {
                prescriptionId: rxRef.id,
                patientId: consultation.patientId,
                patientName: consultation.patientName,
                doctorName: consultation.doctorName,
                consultationId: consultation.consultationId,
                medicines: consultation.prescription,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        var labItems = consultation.labOrders.map(function(t) {
            return { category: 'lab_custom', description: t.name, quantity: 1, unitPrice: t.amount, amount: t.amount, orderedBy: consultation.doctorName, labItem: true };
        });
        var imgItems = consultation.imagingOrders.map(function(t) {
            return { category: 'img_custom', description: t.name, quantity: 1, unitPrice: t.amount, amount: t.amount, orderedBy: consultation.doctorName, labItem: true };
        });
        var opFee = bookedOP && (bookedOP.opBillDocId || bookedOP.opFeeWaived || (bookedOP.opFee === 0 && bookedOP.paymentStatus === 'free')) ? 0 : fee.amount;
        consultation.opBaseFee = bookedOP && bookedOP.opFeePolicy ? bookedOP.opFeePolicy.base : fee.base;
        consultation.feeStartsEpisode = bookedOP && bookedOP.opFeePolicy ? bookedOP.opFeePolicy.startsEpisode : fee.startsEpisode;
        consultation.feeEpisodeDate = bookedOP && bookedOP.opFeePolicy ? bookedOP.opFeePolicy.episodeDate : fee.episodeDate;
        consultation.opFeePolicy = bookedOP && bookedOP.opFeePolicy || fee;
        consultation.opFee = opFee;
        if (!Number.isFinite(opFee) || opFee < 0) throw new Error('Doctor consultation fee is invalid.');
        var consultFee = { category: 'Consultation', description: (bookedOP && bookedOP.opBillDocId ? 'Consultation fee already invoiced at booking' : fee.reason + ' - ' + consultation.doctorName), quantity: 1, unitPrice: opFee, amount: opFee, orderedBy: consultation.doctorName };

        var allItems = [consultFee].concat(labItems).concat(imgItems);
        var subtotal = allItems.reduce(function(sum, i) { return sum + i.amount; }, 0);

        var billData = {
            billDocId: billRef.id,
            billId: billId,
            patientId: consultation.patientId,
            patientDocId: consultation.patientDocId,
            patientName: consultation.patientName,
            billType: 'OPD',
            visitDoctor: consultation.doctorName,
            visitDepartment: consultation.department,
            consultationId: consultation.consultationId,
            items: allItems,
            subtotal: subtotal,
            grandTotal: subtotal,
            amountPaid: 0,
            balanceDue: subtotal,
            paymentStatus: 'unpaid',
            reportStatus: labItems.length > 0 || imgItems.length > 0 ? 'pending' : 'not_applicable',
            labRequired: labItems.length > 0,
            labCompleted: false,
            billedBy: currentDoctorName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        batch.set(billRef, billData);
        batch.set(db.collection('patients').doc(consultation.patientDocId).collection('bills').doc(billRef.id), billData);
        batch.set(db.collection('billCounters').doc('opd'), { count: count }, { merge: true });

        // 5. Update appointment status to completed
        if (consultation.appointmentId) {
            var apptRef = db.collection('appointments').doc(consultation.appointmentId);
            batch.update(apptRef, { status: 'completed', consultationId: consultation.consultationId, completedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        if (consultation.tokenId) batch.update(db.collection('opTokens').doc(consultation.tokenId), { status: 'done', consultationId: consultation.consultationId });
        batch.set(consultationRef, Object.assign({}, consultation, {
            status: 'completed', billDocId: billRef.id, billId: billId,
            createdAt: savedConsultation.exists && savedConsultation.data().createdAt || firebase.firestore.FieldValue.serverTimestamp(),
            completedAt: firebase.firestore.FieldValue.serverTimestamp()
        }), { merge: true });
    });
}
window.triggerDownstreamActions = triggerDownstreamActions;

// ==========================================
// 8. CLINICAL TREATMENT TEMPLATES & SHORTCUTS
// ==========================================
const DEFAULT_CLINICAL_TEMPLATES = [
    {
        code: 'FEV',
        name: 'Acute Fever / Pyrexia (జ్వరం)',
        category: 'General',
        badgeBg: '#fee2e2',
        badgeColor: '#991b1b',
        diagnosis: 'Acute Febrile Illness / Pyrexia of Unknown Origin',
        findings: 'Febrile, Temp: 101°F. Pulse: 94 bpm. Throat: Mild pharyngeal congestion, tonsils normal. Chest: Clear bilaterally, normal vesicular breath sounds. Abdomen: Soft, non-tender, no organomegaly.',
        advice: '1. Rest & hydration: Drink plenty of boiled & cooled water, ORS, coconut water (రోజుకు 2-3 లీటర్ల నీరు తాగాలి).\n2. Tepid sponge bath with lukewarm water if temperature > 101°F (జ్వరం ఎక్కువైతే తడిగుడ్డతో శరీరాన్ని తుడవండి).\n3. Paracetamol 500mg SOS (when fever > 100°F) maintaining at least 6 hours gap.\n4. Light soft digestible diet (ఇడ్లీ, గంజి, పాలు, జావ తీసుకోండి; మసాలాలు నూనె పదార్థాలు మానండి).\n5. Warning Signs: Revisit hospital immediately if fever persists > 3 days, severe headache, continuous vomiting, or shortness of breath.',
        medicines: [
            { name: 'Demo Paracetamol 500 mg', dosage: '500mg', frequency: 'Three times daily', duration: '3 days', instructions: 'After food' },
            { name: 'ORS Electral Powder', dosage: '1 Sachet', frequency: 'As needed', duration: '3 days', instructions: 'With food' },
            { name: 'Vitamin C & Zinc Chewable', dosage: '500mg', frequency: 'Once daily', duration: '5 days', instructions: 'After food' }
        ]
    },
    {
        code: 'ANC1',
        name: '1st Trimester ANC & Nausea (మొదటి త్రైమాసికం)',
        category: 'Obstetrics',
        badgeBg: '#ecfdf5',
        badgeColor: '#065f46',
        diagnosis: 'G1P0A0 at 8-10 Weeks Gestation with Hyperemesis Gravidarum (Mild)',
        findings: 'General condition fair. BP 110/70 mmHg, PR 78 bpm. Pallor nil, pedal edema nil. Per abdomen: Soft, non-tender, uterus unpalpable (<12 wks). PV: deferred.',
        advice: '1. Frequent small dry meals (dry crackers/toast before getting out of bed). Avoid spicy, oily, fried foods (తక్కువ మోతాదులో ఎక్కువ సార్లు ఆహారం తీసుకోవాలి).\n2. Maintain adequate hydration with small sips of water, lemon water, buttermilk (మజ్జిగ, కొబ్బరినీళ్లు తాగండి).\n3. Do not take any unprescribed medications.\n4. Regular walking 20-30 mins daily. Avoid heavy lifting and strenuous travel.\n5. Warning Signs: Immediate consultation if severe persistent vomiting, unable to retain fluids >12 hrs, abdominal pain, or per-vaginal bleeding.',
        medicines: [
            { name: 'Tab. Folic Acid 5 mg', dosage: '5mg', frequency: 'Once daily', duration: '30 days', instructions: 'After food' },
            { name: 'Tab. Doxylamine Succinate + Pyridoxine', dosage: '10mg/10mg', frequency: 'Twice daily', duration: '15 days', instructions: 'Before food' }
        ]
    },
    {
        code: 'ANC2',
        name: 'Routine ANC Checkup (2nd/3rd Tri)',
        category: 'Obstetrics',
        badgeBg: '#eff6ff',
        badgeColor: '#1e40af',
        diagnosis: 'Single Intrauterine Pregnancy at 28 Weeks Gestation - Routine ANC Review',
        findings: 'General condition good. BP 118/74 mmHg. No pedal edema. Fundal height corresponds to gestational age (28 cm). FHR regular (144 bpm). Cephalic presentation. Liquor clinically adequate.',
        advice: '1. Daily Fetal Movement Count (DFKC) monitoring: Ensure minimum 10 fetal kicks/movements in 12 hours after meals (రోజూ శిశువు కదలికలు గమనించాలి).\n2. Sleep in left lateral position to improve placental blood flow (ఎడమ వైపు తిరిగి పడుకోవాలి).\n3. Balanced nutrition with green leafy vegetables, lentils, milk, paneer, and eggs (ఆకుకూరలు, పప్పులు, గుడ్లు తీసుకోవాలి).\n4. Strict compliance with Iron and Calcium supplements (keep 2 hrs gap between Iron & Calcium).\n5. Re-consult immediately if decreased fetal movements, leaking per vaginum, or bleeding.',
        medicines: [
            { name: 'Tab. Ferrous Ascorbate + Folic Acid', dosage: '100mg', frequency: 'Once daily', duration: '30 days', instructions: 'After food' },
            { name: 'Tab. Calcium Carbonate 500mg + Vit D3', dosage: '500mg', frequency: 'Once daily', duration: '30 days', instructions: 'After food' }
        ]
    },
    {
        code: 'PIH',
        name: 'Gestational Hypertension / PIH (రక్తపోటు)',
        category: 'High Risk',
        badgeBg: '#fef3c7',
        badgeColor: '#92400e',
        diagnosis: 'Pregnancy Induced Hypertension (PIH) / Gestational HTN without Proteinuria',
        findings: 'BP elevated 144/92 mmHg (confirmed twice). Bilateral mild pitting pedal edema (+1). Deep tendon reflexes normal, no clonus. Fundal height corresponds to dates. FHR 144 bpm regular.',
        advice: '1. Strict low-salt diet: Restrict raw salt and salty packaged snacks/pickles (ఉప్పు తక్కువగా వాడాలి).\n2. Daily BP charting at home or nearby clinic twice daily.\n3. Adequate bed rest in left lateral position (ఎడమ వైపు తిరిగి విశ్రాంతి తీసుకోండి).\n4. Review in OP clinic after 5-7 days with repeat Urine Albumin & BP chart.\n5. Danger Signs: Report to Emergency immediately if severe headache, blurred vision, epigastric pain, vomiting, or facial puffiness.',
        medicines: [
            { name: 'Tab. Labetalol 100 mg', dosage: '100mg', frequency: 'Twice daily', duration: '14 days', instructions: 'After food' },
            { name: 'Tab. Calcium Carbonate 500mg + Vit D3', dosage: '500mg', frequency: 'Twice daily', duration: '14 days', instructions: 'After food' }
        ]
    },
    {
        code: 'UTI',
        name: 'UTI / Dysuria in Pregnancy (మూత్రంలో మంట)',
        category: 'Infections',
        badgeBg: '#ede9fe',
        badgeColor: '#5b21b6',
        diagnosis: 'Suspected UTI — clinician to confirm',
        findings: 'Symptoms and duration: \nPregnancy / gestation: \nTemperature: \nAbdominal / flank examination: \nUrine test / culture findings: ',
        advice: '1. Take only medicines prescribed for this episode; the clinician selects treatment using pregnancy status, allergies and test results.\n2. If an antibiotic is prescribed, follow its directions and complete the prescribed course.\n3. Drink enough water to avoid dehydration unless your clinician has advised a fluid restriction; no fixed 3–4 litre target.\n4. Seek urgent care for fever, chills, flank/back pain, vomiting or worsening symptoms. Urinary symptoms in pregnancy need prompt medical review.\n5. Review date and urine-culture follow-up: [clinician to enter].',
        medicines: []
    },
    {
        code: 'APD',
        name: 'Gastritis & Heartburn (ఎసిడిటీ)',
        category: 'General',
        badgeBg: '#f3f4f6',
        badgeColor: '#374151',
        diagnosis: 'Gastroesophageal Reflux Disease (GERD) / Acute Gastritis',
        findings: 'Epigastric tenderness on palpation, no guarding or rigidity. Bowel sounds normal. Chest clear.',
        advice: '1. Avoid sour, spicy, fried, and citrus foods. Avoid coffee, tea, and aerated drinks (మసాలాలు, టీ, కాఫీ మానండి).\n2. Eat small frequent meals; do not keep stomach empty for long hours.\n3. Finish dinner at least 2 hours before going to sleep; keep head end of bed elevated 6 inches.\n4. Walk for 15 minutes after dinner; do not lie down immediately.',
        medicines: [
            { name: 'Tab. Pantoprazole 40 mg', dosage: '40mg', frequency: 'Once daily', duration: '7 days', instructions: 'Empty stomach' },
            { name: 'Syp. Magaldrate + Simethicone', dosage: '10ml', frequency: 'Three times daily', duration: '5 days', instructions: 'After food' }
        ]
    },
    {
        code: 'URTI',
        name: 'Viral URTI / Cold & Cough (జలుబు, దగ్గు)',
        category: 'General',
        badgeBg: '#e0f2fe',
        badgeColor: '#0369a1',
        diagnosis: 'Upper Respiratory Tract Infection (Viral Pharyngitis / Rhinorrhea)',
        findings: 'Nasal mucosal congestion. Pharyngeal wall injected, tonsils normal. Lungs: Clear, normal vesicular breath sounds.',
        advice: '1. Steam inhalation twice daily with plain hot water (రోజుకు 2 సార్లు ఆవిరి పట్టండి).\n2. Warm saline gargling 3-4 times daily for throat discomfort (గోరువెచ్చని ఉప్పునీటితో పుక్కిలించండి).\n3. Drink warm water, soups, and ginger-honey tea.\n4. Adequate rest and avoid chilled drinks and cold foods.',
        medicines: [
            { name: 'Tab. Cetirizine 10 mg', dosage: '10mg', frequency: 'At bedtime', duration: '5 days', instructions: 'After food' },
            { name: 'Syp. Cough Relief (Ambroxol)', dosage: '5ml', frequency: 'Three times daily', duration: '5 days', instructions: 'After food' },
            { name: 'Demo Paracetamol 500 mg', dosage: '500mg', frequency: 'As needed', duration: '3 days', instructions: 'After food' }
        ]
    },
    {
        code: 'ANEM',
        name: 'Iron Deficiency Anemia (రక్తహీనత)',
        category: 'Obstetrics',
        badgeBg: '#fdf2f8',
        badgeColor: '#9d174d',
        diagnosis: 'Moderate Iron Deficiency Anemia complicating Pregnancy',
        findings: 'Pallor present on conjunctiva and nail beds. PR 84 bpm, BP 110/70. Soft systolic flow murmur heard. Pedal edema nil.',
        advice: '1. Iron-rich diet: Jaggery, dates, pomegranate, raisins, spinach, beetroot, eggs (బెల్లం, ఖర్జూరం, దానిమ్మ, పాలకూర తినండి).\n2. Take Iron tablets with Vitamin C (lemon water) for optimal iron absorption.\n3. Strict caution: NEVER consume tea, coffee, or milk within 2 hours of iron tablets.\n4. Repeat Complete Blood Picture (CBP) after 4 weeks.',
        medicines: [
            { name: 'Tab. Ferrous Ascorbate + Folic Acid', dosage: '100mg', frequency: 'Twice daily', duration: '30 days', instructions: 'After food' },
            { name: 'Vitamin C & Zinc Chewable', dosage: '500mg', frequency: 'Once daily', duration: '30 days', instructions: 'After food' }
        ]
    }
];

DEFAULT_CLINICAL_TEMPLATES.push(
    { code: 'PCOS', name: 'PCOS — Healthy Lifestyle & Cycle Review', category: 'Gynaecology', badgeBg: '#fce7f3', badgeColor: '#9d174d', diagnosis: 'PCOS — assessment / follow-up', findings: 'Menstrual / cycle history: \nLMP: \nSymptoms and fertility goals: \nWeight / BMI: \nRelevant examination and investigations: ', advice: '1. Follow a balanced diet and regular physical activity suited to your health.\n2. Keep a record of periods, symptoms and prescribed medicines.\n3. Discuss prolonged gaps between periods, fertility goals and an individual care plan with the clinician.\n4. Investigations, treatment and review date: [clinician to enter].', medicines: [] },
    { code: 'HYPO', name: 'Hypothyroidism — Review', category: 'Gynaecology', badgeBg: '#e0f2fe', badgeColor: '#075985', diagnosis: 'Hypothyroidism — assessment / follow-up', findings: 'Symptoms: \nCurrent thyroid medicine / adherence: \nTSH / TFT date and result: \nPregnancy / pregnancy planning: \nExamination: ', advice: 'Current prescription and administration instructions: [clinician to enter].\nRepeat tests and review date: [clinician to enter].\nPregnancy / fertility plan: [clinician to enter].', medicines: [] },
    { code: 'INF', name: 'Infertility — Initial Assessment & Plan', category: 'Gynaecology', badgeBg: '#ecfdf5', badgeColor: '#065f46', diagnosis: 'Infertility evaluation — clinician to document', findings: 'Duration of trying to conceive: \nMenstrual and obstetric history: \nPrevious investigations / treatment: \nRelevant history for both partners: \nExamination / findings: ', advice: 'Patient and partner investigation plan: [clinician to enter].\nPreconception / lifestyle counselling: [clinician to enter].\nTreatment options, referral and review date: [clinician to enter].', medicines: [] }
);

function getAllClinicalTemplates() {
    let custom = [];
    try {
        const raw = localStorage.getItem('customClinicalTemplates');
        if (raw) custom = JSON.parse(raw);
    } catch (e) {
        console.warn('Error reading custom templates from localStorage:', e);
    }
    return DEFAULT_CLINICAL_TEMPLATES.concat(custom);
}

function setSelectValueOrAdd(selectEl, value) {
    if (!selectEl || !value) return;
    const cleanVal = String(value).trim();
    let found = false;
    for (let i = 0; i < selectEl.options.length; i++) {
        const optVal = selectEl.options[i].value.toLowerCase();
        const optTxt = selectEl.options[i].text.toLowerCase();
        if (optVal === cleanVal.toLowerCase() || optTxt.startsWith(cleanVal.toLowerCase()) || cleanVal.toLowerCase().startsWith(optVal)) {
            selectEl.selectedIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        const opt = document.createElement('option');
        opt.value = cleanVal;
        opt.textContent = cleanVal;
        selectEl.appendChild(opt);
        selectEl.value = cleanVal;
    }
}

function flashElement(el) {
    if (!el) return;
    el.classList.remove('field-flash');
    void el.offsetWidth;
    el.classList.add('field-flash');
}

function renderClinicalTemplates(filterQuery) {
    const container = document.getElementById('templatesListContainer');
    if (!container) return;

    const all = getAllClinicalTemplates();
    const q = (filterQuery || '').trim().toLowerCase();

    const filtered = q ? all.filter(t => 
        (t.code && t.code.toLowerCase().includes(q)) ||
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q)) ||
        (t.diagnosis && t.diagnosis.toLowerCase().includes(q))
    ) : all;

    if (filtered.length === 0) {
        container.innerHTML = '<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:15px 5px;">No matching templates found</div>';
        return;
    }

    let html = '';
    filtered.forEach(t => {
        const medCount = Array.isArray(t.medicines) ? t.medicines.length : 0;
        const bg = t.badgeBg || '#f1f5f9';
        const fg = t.badgeColor || '#334155';
        html += `
            <div class="tpl-card" onclick="applyClinicalTemplate('${escapeHtml(t.code || '')}')" title="Click to apply ${escapeHtml(t.name)}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="tpl-badge" style="background:${bg}; color:${fg}; border:1px solid ${fg}33;">[${escapeHtml(t.code || 'TPL')}]</span>
                    <span style="font-size:0.7rem; color:#64748b; font-weight:600;"><i class="fa-solid fa-pills" style="font-size:0.65rem;"></i> ${medCount} meds</span>
                </div>
                <div style="font-size:0.78rem; font-weight:600; color:var(--primary-navy); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(t.name)}
                </div>
                <div style="font-size:0.7rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(t.diagnosis || '')}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function applyClinicalTemplate(codeOrId) {
    if (!codeOrId) return;
    const query = String(codeOrId).trim().toUpperCase();
    const all = getAllClinicalTemplates();
    const tpl = all.find(t => (t.code && t.code.toUpperCase() === query) || (t.id && t.id.toUpperCase() === query))
        || all.find(t => t.name && t.name.toUpperCase().includes(query));

    if (!tpl) {
        showToast(`Template "${query}" not found. Available codes: FEV, ANC1, ANC2, PIH, UTI, PCOS, HYPO, INF, APD, URTI, ANEM`, 'warning');
        return;
    }

    const diagEl = document.getElementById('diagnosis');
    const examEl = document.getElementById('examinationFindings');
    const adviceEl = document.getElementById('advice');

    if (diagEl && tpl.diagnosis) {
        diagEl.value = tpl.diagnosis;
        flashElement(diagEl);
    }
    if (examEl && tpl.findings) {
        examEl.value = tpl.findings;
        flashElement(examEl);
    }
    if (adviceEl && tpl.advice) {
        adviceEl.value = tpl.advice;
        flashElement(adviceEl);
    }

    // Populate prescription table
    if (Array.isArray(tpl.medicines) && tpl.medicines.length > 0) {
        // If all existing rows are completely blank, clear them
        const currentRows = document.querySelectorAll('#prescriptionTableBody tr');
        let allBlank = true;
        currentRows.forEach(tr => {
            const id = tr.id.split('_')[1];
            const nameInput = document.getElementById(`medName_${id}`);
            if (nameInput && nameInput.value.trim()) allBlank = false;
        });
        if (allBlank) {
            document.getElementById('prescriptionTableBody').innerHTML = '';
        }

        tpl.medicines.forEach(m => {
            addPrescriptionRow();
            const currId = rxRowCount;
            const nameEl = document.getElementById(`medName_${currId}`);
            const doseEl = document.getElementById(`medDosage_${currId}`);
            const freqEl = document.getElementById(`medFreq_${currId}`);
            const durEl = document.getElementById(`medDuration_${currId}`);
            const instEl = document.getElementById(`medInst_${currId}`);

            if (nameEl) nameEl.value = m.name || '';
            if (doseEl) doseEl.value = m.dosage || '';
            if (freqEl && m.frequency) setSelectValueOrAdd(freqEl, m.frequency);
            if (durEl && m.duration) setSelectValueOrAdd(durEl, m.duration);
            if (instEl && m.instructions) setSelectValueOrAdd(instEl, m.instructions);
        });

        if (typeof refreshDrugSafetyAlerts === 'function') refreshDrugSafetyAlerts();
    }

    const codeInput = document.getElementById('templateCodeInput');
    if (codeInput) codeInput.value = tpl.code || '';

    showToast(`Template [${tpl.code || 'TPL'}] ${tpl.name} applied to Findings, Advice & Medicines!`, 'success');
}
window.applyClinicalTemplate = applyClinicalTemplate;

// Custom template medicines helper
let tplMedRowIndex = 0;
function addCustomTplMedRow() {
    tplMedRowIndex++;
    const tbody = document.getElementById('tplMedTableBody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.id = `tplMedRow_${tplMedRowIndex}`;
    tr.innerHTML = `
        <td style="padding:4px;"><input type="text" placeholder="Drug name..." class="tpl-m-name" style="width:100%; height:26px; font-size:0.75rem; border:1px solid #cbd5e1; border-radius:4px; padding:2px 4px; box-sizing:border-box;"></td>
        <td style="padding:4px;"><input type="text" placeholder="500mg" class="tpl-m-dose" style="width:100%; height:26px; font-size:0.75rem; border:1px solid #cbd5e1; border-radius:4px; padding:2px 4px; box-sizing:border-box;"></td>
        <td style="padding:4px;">
            <select class="tpl-m-freq" style="width:100%; height:26px; font-size:0.72rem; border:1px solid #cbd5e1; border-radius:4px;">
                <option value="Once daily">Once daily (1-0-0)</option>
                <option value="Twice daily">Twice daily (1-0-1)</option>
                <option value="Three times daily">Three times daily (1-1-1)</option>
                <option value="As needed">As needed (SOS)</option>
            </select>
        </td>
        <td style="padding:4px;"><input type="text" placeholder="3 days" class="tpl-m-dur" style="width:100%; height:26px; font-size:0.75rem; border:1px solid #cbd5e1; border-radius:4px; padding:2px 4px; box-sizing:border-box;"></td>
        <td style="padding:4px; text-align:center;"><button type="button" onclick="this.closest('tr').remove()" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.8rem;">✕</button></td>
    `;
    tbody.appendChild(tr);
}

// Initialise template events
document.addEventListener('DOMContentLoaded', function() {
    renderClinicalTemplates();

    // Quick Code input & button
    const codeInput = document.getElementById('templateCodeInput');
    const btnApplyCode = document.getElementById('btnApplyCode');
    if (btnApplyCode && codeInput) {
        btnApplyCode.addEventListener('click', function() {
            const val = codeInput.value.trim();
            if (val) applyClinicalTemplate(val);
        });
        codeInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = codeInput.value.trim();
                if (val) applyClinicalTemplate(val);
            }
        });
    }

    // Search filter input
    const searchInput = document.getElementById('templateSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            renderClinicalTemplates(this.value.trim());
        });
    }

    // Quick Chips
    document.querySelectorAll('.tpl-chip').forEach(chip => {
        chip.addEventListener('click', function() {
            const code = this.dataset.code;
            if (code) applyClinicalTemplate(code);
        });
    });

    // Custom Template Modal
    const btnOpenAddTpl = document.getElementById('btnOpenAddTemplateModal');
    const addTplModal = document.getElementById('addTemplateModal');
    const closeAddTpl = document.getElementById('closeAddTemplateModalBtn');
    const cancelAddTpl = document.getElementById('btnCancelAddTemplate');
    const btnAddMedRow = document.getElementById('btnAddTplMedRow');
    const addTplForm = document.getElementById('addTemplateForm');

    if (btnOpenAddTpl && addTplModal) {
        btnOpenAddTpl.addEventListener('click', function() {
            addTplModal.style.display = 'flex';
            const tbody = document.getElementById('tplMedTableBody');
            if (tbody && tbody.children.length === 0) {
                addCustomTplMedRow();
            }
        });
    }
    if (closeAddTpl && addTplModal) {
        closeAddTpl.addEventListener('click', function() { addTplModal.style.display = 'none'; });
    }
    if (cancelAddTpl && addTplModal) {
        cancelAddTpl.addEventListener('click', function() { addTplModal.style.display = 'none'; });
    }
    if (btnAddMedRow) {
        btnAddMedRow.addEventListener('click', addCustomTplMedRow);
    }
    if (addTplForm) {
        addTplForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const code = document.getElementById('tplNewCode').value.trim().toUpperCase();
            const name = document.getElementById('tplNewName').value.trim();
            const category = document.getElementById('tplNewCategory').value;
            const diagnosis = document.getElementById('tplNewDiagnosis').value.trim();
            const findings = document.getElementById('tplNewFindings').value.trim();
            const advice = document.getElementById('tplNewAdvice').value.trim();

            const medicines = [];
            document.querySelectorAll('#tplMedTableBody tr').forEach(tr => {
                const mName = tr.querySelector('.tpl-m-name')?.value.trim();
                const mDose = tr.querySelector('.tpl-m-dose')?.value.trim();
                const mFreq = tr.querySelector('.tpl-m-freq')?.value;
                const mDur = tr.querySelector('.tpl-m-dur')?.value.trim();
                if (mName) {
                    medicines.push({ name: mName, dosage: mDose, frequency: mFreq, duration: mDur, instructions: 'After food' });
                }
            });

            const newTpl = {
                code, name, category, diagnosis, findings, advice, medicines,
                badgeBg: '#e2e8f0', badgeColor: '#1e293b', isCustom: true
            };

            // Save to localStorage
            let custom = [];
            try {
                const raw = localStorage.getItem('customClinicalTemplates');
                if (raw) custom = JSON.parse(raw);
            } catch (err) {}
            // Update or push
            const idx = custom.findIndex(t => t.code === code);
            if (idx >= 0) custom[idx] = newTpl;
            else custom.push(newTpl);
            localStorage.setItem('customClinicalTemplates', JSON.stringify(custom));

            // Also persist to Firestore if available
            try {
                firebase.firestore().collection('clinicalTemplates').doc(code).set(newTpl, { merge: true }).catch(function(){});
            } catch (err) {}

            renderClinicalTemplates();
            addTplModal.style.display = 'none';
            addTplForm.reset();
            document.getElementById('tplMedTableBody').innerHTML = '';
            showToast(`Custom Template [${code}] saved successfully!`, 'success');
        });
    }

    // Load custom templates from Firestore if available
    try {
        firebase.firestore().collection('clinicalTemplates').get().then(snap => {
            if (!snap.empty) {
                let custom = [];
                snap.forEach(doc => custom.push(doc.data()));
                localStorage.setItem('customClinicalTemplates', JSON.stringify(custom));
                renderClinicalTemplates();
            }
        }).catch(function(){});
    } catch(err) {}
});
