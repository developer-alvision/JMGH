checkAccess(['pharmacist', 'admin']);
let currentUserEmail = '';
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    loadMedicines();
    setDefaultHistoryDates();
    loadDoctorsForHistory();
    // Do NOT auto-load full history on page open — only when History drawer opens
});

let allMedicines = [];
var selectedPatient_pharma = null;
let manualDispenseItems = [];
let pharmacyUnsubscribe = null;
let prescriptionQueueUnsubscribe = null;
var _lastDispenseRecord = null;

window.openPharmacyHistory = function () {
    document.getElementById('pharmacyHistoryOverlay').classList.add('open');
    document.getElementById('pharmacyHistoryDrawer').classList.add('open');
    showPharmacyDrawerTab('history');
    const fromDate = document.getElementById('histFromDate').value;
    const toDate = document.getElementById('histToDate').value;
    loadDispensingHistory(fromDate, toDate, '', '', '');
};
window.closePharmacyHistory = function () {
    document.getElementById('pharmacyHistoryOverlay').classList.remove('open');
    document.getElementById('pharmacyHistoryDrawer').classList.remove('open');
};
// The drawer now only holds dispensing history — the prescription queue is a
// main tab. This must not touch #prescriptionQueueSection: setting an inline
// display here would override the tab's .active class and hide it for good.
window.showPharmacyDrawerTab = function (tab) {
    var hist = document.getElementById('historySection');
    if (hist) hist.style.display = tab === 'queue' ? 'none' : 'block';
};

document.addEventListener('DOMContentLoaded', function () {
    var histBtn = document.getElementById('btnPharmacyHistory');
    if (histBtn) histBtn.addEventListener('click', openPharmacyHistory);
    ['printPrescriptionBtn', 'printPrescriptionBtnInline'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', printPharmacyPrescription);
    });
    var slipBtn = document.getElementById('printDispenseSlipBtn');
    if (slipBtn) slipBtn.addEventListener('click', printPharmacyDispenseSlip);
});

// Tab Switching
document.querySelectorAll('.pharmacy-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.pharmacy-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.pharmacy-section').forEach(s => s.classList.remove('active'));

        btn.classList.add('active');
        var target = document.getElementById(btn.dataset.target);
        if (target) target.classList.add('active');

        // Refresh specific tabs on activation
        if (btn.dataset.target === 'prescriptionQueueSection' && typeof loadPrescriptionQueue === 'function') {
            loadPrescriptionQueue();
        }
        if (btn.dataset.target === 'counterSaleSection' && typeof loadCounterStock === 'function') {
            loadCounterStock().then(renderCounterItems).catch(function (err) { showToast('Unable to load counter stock: ' + err.message, 'error'); });
        }
        if (btn.dataset.target === 'grnSection' && typeof loadGrnSection === 'function') {
            loadGrnSection();
        }
        if (btn.dataset.target === 'suppliersSection' && typeof loadSuppliersSection === 'function') {
            loadSuppliersSection();
        }
    });
});

function printPharmacyPrescription() {
    if (!selectedPatient_pharma) { showToast('Select a patient first.', 'warning'); return; }
    if (!manualDispenseItems.length) { showToast('Add medicines before printing.', 'warning'); return; }
    var doctor = (document.getElementById('pharmaPrescribedBy') || {}).value
        || (document.getElementById('pharma_doctorSelect') || {}).value
        || 'Pharmacist';
    var consultation = {
        consultationId: 'PH-RX-' + Date.now(),
        patientId: selectedPatient_pharma.patientId,
        patientName: selectedPatient_pharma.name,
        doctorName: doctor,
        createdAt: new Date(),
        prescription: manualDispenseItems.map(function (item) {
            return {
                name: item.medicineName,
                medicineName: item.medicineName,
                dosage: item.dosage || '',
                frequency: item.dosage || '',
                duration: (item.days ? (item.days + ' days') : ''),
                instructions: ''
            };
        })
    };
    if (typeof generateBilingualPrescriptionFromConsultationPDF === 'function') {
        generateBilingualPrescriptionFromConsultationPDF(consultation);
    } else {
        showToast('Prescription printer not loaded.', 'error');
    }
}
window.printPharmacyPrescription = printPharmacyPrescription;

function printPharmacyDispenseSlip() {
    var record = _lastDispenseRecord;
    if (!record) {
        if (!selectedPatient_pharma || !manualDispenseItems.length) {
            showToast('Dispense first, or add medicines to preview a slip.', 'warning');
            return;
        }
        record = {
            patientName: selectedPatient_pharma.name,
            patientId: selectedPatient_pharma.patientId,
            prescribedBy: (document.getElementById('pharmaPrescribedBy') || {}).value || '',
            items: manualDispenseItems,
            totalAmount: manualDispenseItems.reduce(function (s, i) { return s + (i.totalAmount || 0); }, 0),
            dispensedAt: new Date()
        };
    }
    getHospitalSettings(function (settings) {
        if (typeof createDispensingSlipPDF === 'function') createDispensingSlipPDF(record, settings);
    });
}
window.printPharmacyDispenseSlip = printPharmacyDispenseSlip;

function loadMedicines() {
    if (pharmacyUnsubscribe) {
        pharmacyUnsubscribe();
    }
    pharmacyUnsubscribe = db.collection("pharmacy").orderBy("medicineName", "asc").onSnapshot(snapshot => {
        allMedicines = [];
        snapshot.forEach(doc => {
            allMedicines.push({ id: doc.id, ...doc.data() });
        });
        renderInventory(allMedicines);
        populateDispenseDropdown(allMedicines);
        // Queue amounts are priced off this list, so refresh them once stock
        // arrives — and again whenever a price or stock figure changes.
        if (typeof loadPrescriptionQueue === 'function') loadPrescriptionQueue();
    }, error => {
        console.error("Error fetching inventory:", error);
    });
}

// Near-expiry window. The hospital asked for 2 months' warning, and it is
// read from Hospital Settings so the pharmacist can change it without a
// code release. 60 days is the agreed default until settings load.
var NEAR_EXPIRY_DAYS = 60;
// Whether a purchase order number must exist before stock can be inwarded.
// Settings-driven so the hospital can tighten this later without a release.
var GRN_REQUIRES_PO = false;
db.collection('hospitalSettings').doc('main').get().then(function (doc) {
    var d = doc.exists ? doc.data() : {};
    var n = Number(d.nearExpiryDays);
    if (n > 0) {
        NEAR_EXPIRY_DAYS = n;
        if (allMedicines.length) renderInventory(allMedicines);
    }
    GRN_REQUIRES_PO = d.grnRequiresPo === true;
    var mark = document.getElementById('grnPoRequiredMark');
    var hint = document.getElementById('grnPoHint');
    if (mark) mark.style.display = GRN_REQUIRES_PO ? '' : 'none';
    if (hint) hint.textContent = GRN_REQUIRES_PO
        ? 'A purchase order is required before stock can be received.'
        : 'Leave blank for a direct purchase without a PO.';
}).catch(function () {});

function getExpiryStatus(expiryDateStr) {
    if (!expiryDateStr) return 'normal';
    const expDate = new Date(expiryDateStr);
    const today = new Date();
    today.setHours(0,0,0,0);
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'expired';
    if (diffDays <= NEAR_EXPIRY_DAYS) return 'expiring';
    return 'normal';
}

function renderInventory(medicines) {
    const tbody = document.getElementById("inventoryTableBody");
    const expiredBody = document.getElementById("expiredStockBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (expiredBody) expiredBody.innerHTML = "";

    const active = [];
    const expired = [];
    (medicines || []).forEach(function (med) {
        if (med.disposed === true) return;
        const expStatus = getExpiryStatus(med.expiryDate);
        if (expStatus === "expired" || med.stockStatus === "expired") expired.push(med);
        else active.push(med);
    });

    if (active.length === 0) {
        tbody.innerHTML = "<tr><td colspan='8' style='text-align: center;'>No salable medicines in inventory.</td></tr>";
    }

    active.forEach(med => {
        const tr = document.createElement("tr");
        const stock = med.stock || 0;
        const reorderLevel = med.reorderLevel !== undefined ? med.reorderLevel : 20;
        let statusClass = "status-instock";
        let statusText = "In Stock";
        if (stock === 0) { statusClass = "status-outstock"; statusText = "Out of Stock"; }
        else if (stock <= reorderLevel) { statusClass = "status-lowstock"; statusText = "Low Stock"; }

        let expiryDisplay = med.expiryDate || "-";
        const expStatus = getExpiryStatus(med.expiryDate);
        if (expStatus === "expiring") {
            tr.style.backgroundColor = "#FEF9C3";
            tr.style.borderLeft = "3px solid #ca8a04";
            const expDate = new Date(med.expiryDate);
            const today = new Date();
            const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
            expiryDisplay = (med.expiryDate || "") + ' <span style="color:#ca8a04;font-weight:600;">(' + diffDays + "d)</span>";
        }

        tr.innerHTML =
            "<td>" + (med.medicineName || "-") + "</td>" +
            "<td>" + (med.genericName || "-") + "</td>" +
            "<td>" + (med.category || "-") + "</td>" +
            "<td>" + stock + "</td>" +
            "<td>" + (med.unit || "-") + "</td>" +
            "<td>" + expiryDisplay + "</td>" +
            "<td><span class=\"status-badge " + statusClass + "\">" + statusText + "</span></td>" +
            "<td>" +
            "<button class=\"btn-secondary edit-med-btn\" data-id=\"" + med.id + "\" style=\"padding:4px 8px;font-size:0.8rem;\">Edit</button> " +
            "<button class=\"btn-primary add-stock-btn\" data-id=\"" + med.id + "\" data-name=\"" + (med.medicineName || "").replace(/"/g, "&quot;") + "\" data-stock=\"" + stock + "\" style=\"padding:4px 8px;font-size:0.8rem;\">GRN / Add Stock</button> " +
            "<button class=\"btn-secondary return-agency-btn\" data-id=\"" + med.id + "\" data-name=\"" + (med.medicineName || "").replace(/"/g, "&quot;") + "\" data-stock=\"" + stock + "\" style=\"padding:4px 8px;font-size:0.8rem;\" title=\"Return unsold stock to supplier\">Return to agency</button>" +
            "</td>";
        tbody.appendChild(tr);
    });

    if (expiredBody) {
        if (!expired.length) {
            expiredBody.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#888;'>No expired stock.</td></tr>";
        } else {
            expired.forEach(function (med) {
                const tr = document.createElement("tr");
                tr.innerHTML = "<td>" + (med.medicineName || "-") + "</td>" +
                    "<td>" + (med.batchNo || med.batchNumber || "—") + " / " + (med.expiryDate || "—") + "</td>" +
                    "<td>" + (med.stock || 0) + "</td>" +
                    "<td><span class=\"status-badge status-outstock\">Expired</span></td>" +
                    "<td><button type=\"button\" class=\"btn-secondary\" style=\"padding:4px 8px;font-size:0.8rem;\" onclick=\"disposeExpiredMedicine('" + med.id + "')\">Dispose physically</button></td>";
                expiredBody.appendChild(tr);
            });
        }
    }

    document.querySelectorAll(".edit-med-btn").forEach(btn => {
        btn.addEventListener("click", e => openEditMedicine(e.currentTarget.dataset.id));
    });
    document.querySelectorAll(".add-stock-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const b = e.currentTarget;
            openAddStockModal(b.dataset.id, b.dataset.name, b.dataset.stock);
        });
    });
    document.querySelectorAll(".return-agency-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const b = e.currentTarget;
            returnStockToAgency(b.dataset.id, b.dataset.name, parseInt(b.dataset.stock, 10) || 0);
        });
    });
    if (typeof loadGrnTimeline === "function") loadGrnTimeline();
}

function populateDispenseDropdown(medicines) {
    // Hidden autocomplete input handles suggestions dynamically; dropdown not used
}

// Search functionality in Inventory
document.getElementById('inventorySearch').addEventListener('input', function(e) {
    const query = e.target.value.toLowerCase();
    const filtered = allMedicines.filter(med => 
        (med.medicineName && med.medicineName.toLowerCase().includes(query)) ||
        (med.genericName && med.genericName.toLowerCase().includes(query)) ||
        (med.category && med.category.toLowerCase().includes(query))
    );
    renderInventory(filtered);
});

// ==========================================
// ADD / EDIT MEDICINE MODAL
// ==========================================
let editingMedId = null;

document.getElementById('addMedicineBtn').addEventListener('click', () => {
    editingMedId = null;
    document.getElementById('medModalTitle').textContent = 'Add Medicine';
    document.getElementById('medForm').reset();
    document.getElementById('medModal').classList.add('active');
});

document.getElementById('closeMedModal').addEventListener('click', () => document.getElementById('medModal').classList.remove('active'));
document.getElementById('cancelMedModal').addEventListener('click', () => document.getElementById('medModal').classList.remove('active'));

function openEditMedicine(medId) {
    const med = allMedicines.find(m => m.id === medId);
    if (!med) return;
    editingMedId = medId;
    document.getElementById('medModalTitle').textContent = 'Edit Medicine';
    document.getElementById('medName').value = med.medicineName || '';
    document.getElementById('medGeneric').value = med.genericName || '';
    document.getElementById('medCategory').value = med.category || 'Tablet';
    document.getElementById('medStock').value = med.stock || 0;
    document.getElementById('medUnit').value = med.unit || '';
    document.getElementById('medExpiry').value = med.expiryDate || '';
    document.getElementById('medPrice').value = med.price || 0;
    document.getElementById('medBatch').value = med.batchNumber || '';
    document.getElementById('medManufacturer').value = med.manufacturer || '';
    document.getElementById('medHsn').value = med.hsnCode || '';
    document.getElementById('medSchedule').value = med.schedule || '';
    document.getElementById('medGstRate').value = String(med.gstRate != null ? med.gstRate : 5);
    document.getElementById('medModal').classList.add('active');
}

document.getElementById('medForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById('saveMedBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const medicineName = document.getElementById('medName').value.trim();
    const genericName = document.getElementById('medGeneric').value.trim();
    const reasonEl = document.getElementById('medChangeReason');
    const changeReason = reasonEl ? reasonEl.value.trim() : '';

    const medData = {
        medicineName: medicineName,
        genericName: genericName,
        category: document.getElementById('medCategory').value,
        stock: parseInt(document.getElementById('medStock').value) || 0,
        unit: document.getElementById('medUnit').value.trim(),
        expiryDate: document.getElementById('medExpiry').value,
        price: parseFloat(document.getElementById('medPrice').value) || 0,
        // Fields the GST retail invoice has to print for each line.
        batchNumber: (document.getElementById('medBatch') || {}).value || '',
        manufacturer: (document.getElementById('medManufacturer') || {}).value || '',
        hsnCode: ((document.getElementById('medHsn') || {}).value || '').trim(),
        schedule: (document.getElementById('medSchedule') || {}).value || '',
        gstRate: parseFloat((document.getElementById('medGstRate') || {}).value) || 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        if (!editingMedId) {
            const norm = medicineName.toLowerCase().replace(/\s+/g, ' ');
            const dup = allMedicines.find(function (m) {
                return (m.medicineName || '').toLowerCase().replace(/\s+/g, ' ') === norm
                    && !(m.disposed === true)
                    && getExpiryStatus(m.expiryDate) !== 'expired';
            });
            if (dup) {
                showToast('Medicine already exists — amend via GRN / Add Stock (no duplicate).', 'warning');
                document.getElementById('medModal').classList.remove('active');
                openAddStockModal(dup.id, dup.medicineName, dup.stock || 0);
                return;
            }
        } else if (!changeReason) {
            showToast('Please enter a change description for audit.', 'warning');
            return;
        }

        if (editingMedId) {
            await db.collection('pharmacy').doc(editingMedId).update(medData);
            if (typeof writeAuditLog === 'function') {
                writeAuditLog({
                    action: 'pharmacy_medicine_updated',
                    medicineId: editingMedId,
                    medicineName: medicineName,
                    reason: changeReason,
                    stock: medData.stock
                });
            }
        } else {
            medData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('pharmacy').add(medData);
            if (typeof writeAuditLog === 'function') {
                writeAuditLog({
                    action: 'pharmacy_medicine_created',
                    medicineId: ref.id,
                    medicineName: medicineName,
                    stock: medData.stock
                });
            }
        }
        document.getElementById('medModal').classList.remove('active');
        editingMedId = null;
        showToast('Medicine saved.', 'success');
    } catch (err) {
        console.error('Error saving medicine:', err);
        alert('Error saving: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
});

// Patient Search Standard Functions
function searchPatient_pharma(query) {
    var dropdown = document.getElementById('pharma_patientSearchResults');
    if (!query || query.length < 2) {
        dropdown.style.display = 'none';
        return;
    }
    dropdown.innerHTML = '<div style="padding:10px;color:#666;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    dropdown.style.display = 'block';
    var results = [];
    var q = query.toLowerCase();
    db.collection('patients').where('patientId', '==', query).get()
    .then(function(snap) {
        snap.forEach(function(doc) { results.push(Object.assign({docId: doc.id}, doc.data())); });
        return db.collection('patients').orderBy('nameLower').startAt(q).endAt(q + '\uf8ff').limit(5).get();
    })
    .then(function(snap) {
        snap.forEach(function(doc) {
            if (!results.find(function(r) { return r.docId === doc.id; }))
                results.push(Object.assign({docId: doc.id}, doc.data()));
        });
        return db.collection('patients').where('phone', '==', query).get();
    })
    .then(function(snap) {
        snap.forEach(function(doc) {
            if (!results.find(function(r) { return r.docId === doc.id; }))
                results.push(Object.assign({docId: doc.id}, doc.data()));
        });
        showPatientDropdown_pharma(results);
    })
    .catch(function(err) {
        dropdown.innerHTML = '<div style="padding:10px;color:red;">Error: ' + err.message + '</div>';
    });
}

function showPatientDropdown_pharma(patients) {
    var dropdown = document.getElementById('pharma_patientSearchResults');
    if (!patients.length) {
        dropdown.innerHTML = '<div style="padding:10px;color:#666;">No patients found</div>';
        return;
    }
    var html = '';
    patients.forEach(function(p) {
        html += '<div onclick="selectPatient_pharma(this)" '
            + 'data-docid="' + p.docId + '" '
            + 'data-patientid="' + (p.patientId||'') + '" '
            + 'data-name="' + (p.name||'') + '" '
            + 'data-doctor="' + (p.doctor||'') + '" '
            + 'data-dept="' + (p.department||'') + '" '
            + 'data-phone="' + (p.phone||'') + '" '
            + 'data-age="' + (p.age||'') + '" '
            + 'data-gender="' + (p.gender||'') + '" '
            + 'style="padding:10px 15px;cursor:pointer;border-bottom:1px solid #eee;" '
            + 'onmouseover="this.style.background=\'#f5f5f5\'" '
            + 'onmouseout="this.style.background=\'white\'">'
            + '<strong>' + (p.name||'Unknown') + '</strong>'
            + ' <span style="color:#0D7A70;font-size:12px;">' + (p.patientId||'') + '</span>'
            + '<br><small style="color:#888;">'
            + (p.phone||'') + ' | ' + (p.doctor||'') + ' | ' + (p.department||'')
            + '</small></div>';
    });
    dropdown.innerHTML = html;
}

function selectPatient_pharma(el) {
    selectedPatient_pharma = {
        docId: el.dataset.docid,
        patientId: el.dataset.patientid,
        name: el.dataset.name,
        doctor: el.dataset.doctor,
        department: el.dataset.dept,
        phone: el.dataset.phone,
        age: el.dataset.age,
        gender: el.dataset.gender
    };
    document.getElementById('pharma_patientSearchInput').value = selectedPatient_pharma.name + ' — ' + selectedPatient_pharma.patientId;
    document.getElementById('pharma_patientSearchResults').style.display = 'none';
    document.getElementById('pharma_cardPatientName').textContent = selectedPatient_pharma.name;
    document.getElementById('pharma_cardPatientId').textContent = selectedPatient_pharma.patientId;
    document.getElementById('pharma_cardAgeGender').textContent = (selectedPatient_pharma.age || '—') + ' / ' + (selectedPatient_pharma.gender || '—');
    loadDoctors_pharma(selectedPatient_pharma.doctor);
    var deptSelect = document.getElementById('pharma_deptSelect');
    if (deptSelect) deptSelect.value = selectedPatient_pharma.department || '';
    document.getElementById('pharma_selectedPatientCard').style.display = 'block';
    updateDispenseBtnState();
}

function clearPatient_pharma() {
    selectedPatient_pharma = null;
    document.getElementById('pharma_patientSearchInput').value = '';
    document.getElementById('pharma_selectedPatientCard').style.display = 'none';
    document.getElementById('pharma_patientSearchResults').style.display = 'none';
    document.getElementById('pharma_patientSearchInput').focus();
    updateDispenseBtnState();
}

function loadDoctors_pharma(defaultDoctor) {
    var select = document.getElementById('pharma_doctorSelect');
    var prescribedSelect = document.getElementById('pharmaPrescribedBy');
    
    if (select) select.innerHTML = '<option value="">Select Doctor</option>';
    if (prescribedSelect) prescribedSelect.innerHTML = '<option value="">Select Doctor</option>';
    
    firebase.firestore().collection('staff').where('role', '==', 'doctor').get()
    .then(function(snap) {
        if (snap.empty) {
            var defaults = ['Dr. Sharma', 'Dr. Patel', 'Dr. Vamsi', 'Dr. Reddy', 'Dr. Rao'];
            defaults.forEach(function(d) {
                if (select) {
                    var opt = document.createElement('option');
                    opt.value = d; opt.textContent = d;
                    if (d === defaultDoctor) opt.selected = true;
                    select.appendChild(opt);
                }
                if (prescribedSelect) {
                    var opt2 = document.createElement('option');
                    opt2.value = d; opt2.textContent = d;
                    if (d === defaultDoctor) opt2.selected = true;
                    prescribedSelect.appendChild(opt2);
                }
            });
        } else {
            snap.forEach(function(doc) {
                var d = doc.data();
                // Filter active doctors in JS — handles boolean true and string 'true'
                var active = d.isActive === true || d.isActive === 'true';
                if (!active) return;
                if (select) {
                    var opt = document.createElement('option');
                    opt.value = d.name;
                    opt.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                    if (d.name === defaultDoctor) opt.selected = true;
                    select.appendChild(opt);
                }
                if (prescribedSelect) {
                    var opt2 = document.createElement('option');
                    opt2.value = d.name;
                    opt2.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                    if (d.name === defaultDoctor) opt2.selected = true;
                    prescribedSelect.appendChild(opt2);
                }
            });
        }
    });
}

// Dispense Logic — P7: Cash/Insurance/Due/Bill Attached, writes /patientDues on Due
function dispenseMedicine() {
    if (document.getElementById('dispenseBtn').disabled) return;
    if (!selectedPatient_pharma) {
        showToast('Please select a patient first', 'error');
        return;
    }
    if (manualDispenseItems.length === 0) {
        showToast('Please add at least one medicine to the list.', 'warning');
        return;
    }

    var nearExp = [];
    var blocked = null;
    manualDispenseItems.forEach(function (item) {
        var med = allMedicines.find(function (m) { return m.id === item.medicineId; });
        if (!med) return;
        if (getExpiryStatus(med.expiryDate) === 'expired' || med.disposed) {
            blocked = 'Cannot dispense expired/disposed medicine: ' + (med.medicineName || '');
        }
        if (getExpiryStatus(med.expiryDate) === 'expiring') {
            nearExp.push((med.medicineName || '') + ' (exp ' + (med.expiryDate || '') + ')');
        }
    });
    if (blocked) {
        showToast(blocked, 'error');
        return;
    }
    if (nearExp.length) {
        if (!confirm('NEAR EXPIRY WARNING\n\n' + nearExp.join('\n') + '\n\nContinue dispensing?')) {
            return;
        }
    }

    var paymentMethod = document.getElementById('dispPaymentMode');
    var linkedBillId = document.getElementById('dispBillId');
    var prescribedBy = document.getElementById('pharmaPrescribedBy');

    var db = firebase.firestore();
    var payment = paymentMethod ? paymentMethod.value : 'Cash';
    var billId = linkedBillId ? linkedBillId.value.trim() : '';
    var doctor = prescribedBy ? prescribedBy.value : '';
    var patientId = selectedPatient_pharma.patientId;
    var patientDocId = selectedPatient_pharma.docId;
    var patientName = selectedPatient_pharma.name;

    var dispenseBtn = document.getElementById('dispenseBtn');
    if (dispenseBtn) {
        dispenseBtn.disabled = true;
        dispenseBtn.textContent = 'Dispensing...';
    }

    var patient = Object.assign({}, selectedPatient_pharma);
    return commitPharmacySale({
        patient: patient, items: manualDispenseItems, paymentMode: payment,
        linkedBillId: billId, doctor: doctor, actor: currentUserEmail
    }).then(function (result) {
        _lastDispenseRecord = {
            patientName: patient.name, patientId: patient.patientId, prescribedBy: doctor,
            items: result.records, totalAmount: result.totalAmount, dispensedAt: new Date(),
            dispensingId: result.records[0].dispensingId
        };
        showToast('Medicines dispensed. Bill: ' + result.billNumber, 'success');
        resetDispenseForm();
        showPharmacyBillPdfPrompt(result.billDocId, result.billNumber);
    }).catch(function (err) {
        console.error('Dispense error:', err);
        showToast(err.message || 'Unable to dispense medicines.', 'error');
    }).finally(function () {
        if (dispenseBtn) { dispenseBtn.textContent = 'Dispense'; updateDispenseBtnState(); }
    });
}

window.dispenseMedicine = dispenseMedicine;

function resetDispenseForm() {
    var form = document.getElementById('dispenseForm');
    if (form) form.reset();
    clearPatient_pharma();
    manualDispenseItems = [];
    renderManualDispenseItems();
    var estimateDiv = document.getElementById('dispenseEstimate');
    if (estimateDiv) estimateDiv.style.display = 'none';
    if (document.getElementById('dispMedicine')) document.getElementById('dispMedicine').value = '';
    if (document.getElementById('dispMedicineSearch')) document.getElementById('dispMedicineSearch').value = '';
}
window.resetDispenseForm = resetDispenseForm;

function renderManualDispenseItems() {
    var tbody = document.getElementById('manualDispenseItemsBody');
    if (!tbody) return;
    
    if (manualDispenseItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 12px;">No medicines added yet.</td></tr>';
        updateDispenseBtnState();
        updateDispenseEstimate();
        return;
    }
    
    tbody.innerHTML = '';
    manualDispenseItems.forEach((item, idx) => {
        var tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 8px; text-align: left; font-weight: 500;">${escapeHtml(item.medicineName)}</td>
            <td style="padding: 8px; text-align: center;">${escapeHtml(item.dosage || '—')}</td>
            <td style="padding: 8px; text-align: center;">${escapeHtml(String(item.days || '—'))}</td>
            <td style="padding: 8px; text-align: center;">${escapeHtml(String(item.quantity))}</td>
            <td style="padding: 8px; text-align: right;">₹${item.unitPrice.toFixed(2)}</td>
            <td style="padding: 8px; text-align: right; font-weight: 600;">₹${item.totalAmount.toFixed(2)}</td>
            <td style="padding: 8px; text-align: center;">
                <button type="button" class="btn-cancel" onclick="removeManualDispenseItem(${idx})" style="padding: 2px 6px; font-size: 11px; border-radius: 4px; color: red; border-color: red; background: none; cursor: pointer;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    updateDispenseBtnState();
    updateDispenseEstimate();
}
window.renderManualDispenseItems = renderManualDispenseItems;

function removeManualDispenseItem(idx) {
    manualDispenseItems.splice(idx, 1);
    renderManualDispenseItems();
}
window.removeManualDispenseItem = removeManualDispenseItem;

function updateDispenseBtnState() {
    var ready = !!(selectedPatient_pharma && manualDispenseItems.length > 0);
    ['dispenseBtn', 'printPrescriptionBtn', 'printPrescriptionBtnInline', 'printDispenseSlipBtn'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = !ready;
    });
}
window.updateDispenseBtnState = updateDispenseBtnState;

// Real-time suggest query drug suggestion list for manual dispensing
function showPharmaDrugSuggestions(inputEl) {
    const q = inputEl.value.trim().toLowerCase();
    const dropdown = document.getElementById('pharmaSuggestions');
    
    if (!q || q.length < 1) {
        dropdown.style.display = 'none';
        return;
    }
    
    const matches = allMedicines.filter(m =>
        !m.disposed && getExpiryStatus(m.expiryDate) !== 'expired' && (
        (m.medicineName && m.medicineName.toLowerCase().includes(q)) ||
        (m.genericName && m.genericName.toLowerCase().includes(q))
        )
    ).slice(0, 6);
    
    if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
    }
    
    let html = '';
    matches.forEach(drug => {
        const escapedName = drug.medicineName.replace(/'/g, "\\'");
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
            <div class="drug-suggestion-item" onclick="selectDrugForDispense('${drug.id}', '${escapedName}', ${drug.stock}, ${drug.unitPrice || drug.price || 0})">
                <strong>${drug.medicineName}</strong> <small style="color:#666;">(${drug.genericName || ''})</small>
                <span style="float:right; font-size:10px; font-weight:600; color:${badgeColor}">${badgeText}</span>
            </div>
        `;
    });
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}
window.showPharmaDrugSuggestions = showPharmaDrugSuggestions;

function selectDrugForDispense(id, name, stock, price) {
    document.getElementById('dispMedicine').value = id;
    document.getElementById('dispMedicineSearch').value = name;
    document.getElementById('pharmaSuggestions').style.display = 'none';
    
    // Auto-focus quantity input after choosing drug
    const qtyInput = document.getElementById('dispQuantity');
    if (qtyInput) qtyInput.focus();
    
    updateDispenseEstimate();
}
window.selectDrugForDispense = selectDrugForDispense;

// Close suggestions on outside click
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('pharmaSuggestions');
    const input = document.getElementById('dispMedicineSearch');
    if (dropdown && input && !input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

function addDispenseItemToList() {
    var medicineId = document.getElementById('dispMedicine') ? document.getElementById('dispMedicine').value : '';
    var quantityInput = document.getElementById('dispQuantity');
    if (!medicineId || !quantityInput) {
        showToast('Please select a medicine from suggestions first.', 'warning');
        return;
    }
    
    const med = allMedicines.find(m => m.id === medicineId);
    if (!med) {
        showToast('Selected medicine not found in inventory.', 'error');
        return;
    }

    var medicineName = med.medicineName;
    var maxStock = med.stock || 0;
    var unitPrice = med.unitPrice || med.price || 0;
    var quantity = parseInt(quantityInput.value) || 0;
    
    if (quantity < 1) {
        showToast('Please enter a valid quantity of 1 or more.', 'warning');
        return;
    }
    
    var dosage = document.getElementById('dispDosage') ? document.getElementById('dispDosage').value.trim() : '';
    var days = parseInt(document.getElementById('dispDays') ? document.getElementById('dispDays').value : '') || 1;
    
    // Check stock
    var existingItem = manualDispenseItems.find(item => item.medicineId === medicineId && item.dosage === dosage && item.days === days);
    var currentListQty = existingItem ? existingItem.quantity : 0;
    if (maxStock < (currentListQty + quantity)) {
        showToast('Insufficient stock. Available: ' + maxStock + (currentListQty ? ' (already added: ' + currentListQty + ')' : ''), 'warning');
        return;
    }
    
    if (existingItem) {
        existingItem.quantity += quantity;
        existingItem.totalAmount = existingItem.quantity * existingItem.unitPrice;
    } else {
        // Carry the batch, expiry, HSN, schedule and GST rate onto the line
        // so the retail invoice can print them and the tax can be split.
        var srcMed = allMedicines.find(function (m) { return m.id === medicineId; }) || {};
        manualDispenseItems.push({
            medicineId: medicineId,
            medicineName: medicineName,
            quantity: quantity,
            unitPrice: unitPrice,
            totalAmount: unitPrice * quantity,
            dosage: dosage,
            days: days,
            batchNumber: srcMed.batchNumber || '',
            expiryDate: srcMed.expiryDate || '',
            hsnCode: srcMed.hsnCode || '',
            schedule: srcMed.schedule || '',
            manufacturer: srcMed.manufacturer || '',
            gstRate: srcMed.gstRate != null ? Number(srcMed.gstRate) : 5
        });
    }
    
    // Reset inputs
    document.getElementById('dispMedicine').value = '';
    document.getElementById('dispMedicineSearch').value = '';
    quantityInput.value = '';
    if (document.getElementById('dispDosage')) document.getElementById('dispDosage').value = '';
    if (document.getElementById('dispDays')) document.getElementById('dispDays').value = '';
    
    renderManualDispenseItems();
    showToast('Medicine added to list.', 'success');
}
window.addDispenseItemToList = addDispenseItemToList;

// ==========================================
// IMPROVEMENT 4 — DISPENSE PRICE ESTIMATE PREVIEW
// ==========================================
function updateDispenseEstimate() {
    var estimateDiv = document.getElementById('dispenseEstimate');
    var totalEl = document.getElementById('estimatedTotalAmount');
    var breakdownEl = document.getElementById('estimatedBreakdown');
    if (!estimateDiv) return;

    if (manualDispenseItems.length > 0) {
        var total = manualDispenseItems.reduce((sum, item) => sum + item.totalAmount, 0);
        estimateDiv.style.display = 'block';
        if (totalEl) totalEl.textContent = formatCurrency(total);
        if (breakdownEl) {
            breakdownEl.textContent = manualDispenseItems.length + ' medicine(s) in list';
        }
        return;
    }

    var medicineId = document.getElementById('dispMedicine') ? document.getElementById('dispMedicine').value : '';
    var quantityInput = document.getElementById('dispQuantity');
    if (!medicineId || !quantityInput) {
        estimateDiv.style.display = 'none';
        return;
    }

    const med = allMedicines.find(m => m.id === medicineId);
    var price = parseFloat(med ? (med.unitPrice || med.price || 0) : 0) || 0;
    var qty = parseInt(quantityInput.value) || 0;
    var medicineName = med ? med.medicineName : '';

    if (!medicineId || qty < 1 || price === 0) {
        estimateDiv.style.display = 'none';
        return;
    }

    var total = price * qty;
    estimateDiv.style.display = 'block';
    if (totalEl) totalEl.textContent = formatCurrency(total);
    if (breakdownEl) breakdownEl.textContent = medicineName + ' @ ₹' + price.toFixed(2) + ' × ' + qty + ' units';
}
window.updateDispenseEstimate = updateDispenseEstimate;

// Register event listeners directly in global scope for dispensing inputs
var dispMedSearch = document.getElementById('dispMedicineSearch');
var dispQuantity = document.getElementById('dispQuantity');
var btnAddDispItem = document.getElementById('btnAddDispItem');

if (dispMedSearch) {
    dispMedSearch.addEventListener('input', updateDispenseEstimate);
}

if (dispQuantity) {
    dispQuantity.addEventListener('input', updateDispenseEstimate);
    dispQuantity.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addDispenseItemToList();
            if (dispMedSearch) dispMedSearch.focus();
        }
    });
}

if (btnAddDispItem) {
    btnAddDispItem.addEventListener('click', addDispenseItemToList);
}


function loadInventory() {
    loadMedicines();
}
window.loadInventory = loadInventory;


document.getElementById('dispenseForm').addEventListener('submit', function(e) {
    e.preventDefault();
    dispenseMedicine();
});

// BUG 3: Add Stock logic
function openAddStockModal(medicineId, medicineName, currentStock) {
    document.getElementById('stockMedId').value = medicineId;
    document.getElementById('stockMedName').value = medicineName;
    document.getElementById('stockCurrent').value = currentStock;
    document.getElementById('stockQtyToAdd').value = '';
    document.getElementById('stockSupplier').value = '';
    document.getElementById('stockPurPrice').value = '';
    document.getElementById('stockBatch').value = '';
    document.getElementById('stockExpiry').value = '';
    document.getElementById('addStockModal').classList.add('active');
}
window.openAddStockModal = openAddStockModal;

document.getElementById('addStockForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('saveAddStockBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    const medicineId = document.getElementById('stockMedId').value;
    const medicineName = document.getElementById('stockMedName').value;
    const qtyToAdd = parseInt(document.getElementById('stockQtyToAdd').value, 10);
    const supplier = document.getElementById('stockSupplier').value.trim();
    const purPrice = parseFloat(document.getElementById('stockPurPrice').value) || 0;
    const batchNo = document.getElementById('stockBatch').value.trim();
    const expiryDate = document.getElementById('stockExpiry').value;
    const notes = (document.getElementById('stockNotes') || {}).value || '';
    if (!String(notes).trim()) {
        showToast('GRN description is required for audit.', 'warning');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save GRN'; }
        return;
    }

    const data = {
        medicineName: medicineName,
        quantityAdded: qtyToAdd,
        supplierName: supplier,
        purchasePrice: purPrice,
        batchNumber: batchNo,
        expiryDate: expiryDate,
        grnNo: (document.getElementById('stockGrnNo') || {}).value || '',
        paymentDueDate: (document.getElementById('stockPaymentDue') || {}).value || '',
        paymentStatus: (document.getElementById('stockPaymentStatus') || {}).value || 'unpaid',
        notes: String(notes).trim(),
        amount: qtyToAdd * purPrice
    };

    try {
        const newStock = await addStock(medicineId, data);
        showToast('GRN saved — stock now ' + newStock, 'success');
        document.getElementById('addStockModal').classList.remove('active');
        if (typeof loadGrnTimeline === 'function') loadGrnTimeline();
    } catch (err) {
        console.error('Error adding stock:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save GRN';
        }
    }
});

// Part 7: Atomic Stock Receipt function
function addStock(medicineId, data) {
    const db = firebase.firestore();
    const medRef = db.collection('pharmacy').doc(medicineId);

    return db.runTransaction(async function(transaction) {
        const doc = await transaction.get(medRef);
        if (!doc.exists) throw new Error("Medicine not found");

        const med = doc.data();
        const newStock = (med.stock || 0) + data.quantityAdded;

        let newExpiry = med.expiryDate || '';
        if (data.expiryDate) {
            if (!newExpiry || new Date(data.expiryDate) > new Date(newExpiry)) {
                newExpiry = data.expiryDate;
            }
        }

        const updateData = {
            stock: firebase.firestore.FieldValue.increment(data.quantityAdded),
            stockStatus: 'active',
            disposed: false,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (newExpiry) updateData.expiryDate = newExpiry;
        if (data.batchNumber) updateData.batchNo = data.batchNumber;
        if (data.purchasePrice) updateData.purchasePrice = data.purchasePrice;

        transaction.update(medRef, updateData);

        const receiptRef = db.collection('stockReceipts').doc();
        transaction.set(receiptRef, {
            medicineId: medicineId,
            medicineName: med.medicineName || data.medicineName,
            quantityAdded: data.quantityAdded,
            supplierName: data.supplierName || '',
            purchasePrice: data.purchasePrice || 0,
            amount: data.amount || ((data.quantityAdded || 0) * (data.purchasePrice || 0)),
            batchNumber: data.batchNumber || '',
            expiryDate: data.expiryDate || '',
            grnNo: data.grnNo || '',
            paymentDueDate: data.paymentDueDate || '',
            paymentStatus: data.paymentStatus || 'unpaid',
            notes: data.notes || '',
            addedBy: currentUserEmail,
            addedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const auditRef = db.collection('auditLog').doc();
        transaction.set(auditRef, {
            action: 'pharmacy_grn',
            medicineId: medicineId,
            medicineName: med.medicineName || data.medicineName,
            quantityAdded: data.quantityAdded,
            supplierName: data.supplierName || '',
            grnNo: data.grnNo || '',
            paymentDueDate: data.paymentDueDate || '',
            paymentStatus: data.paymentStatus || 'unpaid',
            amount: data.amount || ((data.quantityAdded || 0) * (data.purchasePrice || 0)),
            reason: data.notes || '',
            staffEmail: currentUserEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        return newStock;
    });
}
window.addStock = addStock;

function disposeExpiredMedicine(medicineId) {
    var reason = prompt('Disposal description (mandatory — physical destruction / return to supplier):');
    if (!reason || !reason.trim()) {
        showToast('Disposal cancelled — description required.', 'warning');
        return;
    }
    var med = allMedicines.find(function (m) { return m.id === medicineId; });
    db.collection('pharmacy').doc(medicineId).update({
        stock: 0,
        stockStatus: 'disposed',
        disposed: true,
        disposedAt: firebase.firestore.FieldValue.serverTimestamp(),
        disposedBy: currentUserEmail,
        disposeReason: reason.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
        if (typeof writeAuditLog === 'function') {
            writeAuditLog({
                action: 'pharmacy_dispose_expired',
                medicineId: medicineId,
                medicineName: med ? med.medicineName : '',
                reason: reason.trim(),
                previousStock: med ? med.stock : 0
            });
        }
        showToast('Expired stock disposed and removed from inventory.', 'success');
    }).catch(function (err) {
        showToast(err.message, 'error');
    });
}
window.disposeExpiredMedicine = disposeExpiredMedicine;

function returnStockToAgency(medicineId, medicineName, currentStock) {
    if (!currentStock || currentStock <= 0) {
        showToast('No stock available to return.', 'warning');
        return;
    }
    var qtyStr = prompt('Quantity to return to agency for "' + (medicineName || '') + '" (available ' + currentStock + '):', String(currentStock));
    if (qtyStr === null) return;
    var qty = parseInt(qtyStr, 10);
    if (!qty || qty < 1 || qty > currentStock) {
        showToast('Enter a valid quantity up to ' + currentStock + '.', 'warning');
        return;
    }
    var agency = prompt('Supplier / agency name:');
    if (agency === null) return;
    agency = String(agency).trim();
    if (!agency) {
        showToast('Agency name is required.', 'warning');
        return;
    }
    var reason = prompt('Reason for return (e.g. slow moving / near expiry / quality):');
    if (reason === null) return;
    reason = String(reason).trim();
    if (!reason) {
        showToast('Return reason is required for audit.', 'warning');
        return;
    }

    var dbx = firebase.firestore();
    var medRef = dbx.collection('pharmacy').doc(medicineId);
    dbx.runTransaction(function (tx) {
        return tx.get(medRef).then(function (doc) {
            if (!doc.exists) throw new Error('Medicine not found');
            var med = doc.data();
            var stock = Number(med.stock || 0);
            if (qty > stock) throw new Error('Only ' + stock + ' units in stock');
            var newStock = stock - qty;
            tx.update(medRef, {
                stock: newStock,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            tx.set(dbx.collection('stockReceipts').doc(), {
                type: 'agency_return',
                medicineId: medicineId,
                medicineName: med.medicineName || medicineName || '',
                quantityReturned: qty,
                quantityAdded: -qty,
                supplierName: agency,
                notes: reason,
                paymentStatus: 'credit_note',
                addedBy: currentUserEmail,
                addedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            tx.set(dbx.collection('auditLog').doc(), {
                action: 'pharmacy_return_agency',
                medicineId: medicineId,
                medicineName: med.medicineName || medicineName || '',
                quantityReturned: qty,
                supplierName: agency,
                reason: reason,
                staffEmail: currentUserEmail,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            return newStock;
        });
    }).then(function (newStock) {
        showToast('Returned ' + qty + ' to ' + agency + '. Stock now ' + newStock + '.', 'success');
        if (typeof loadGrnTimeline === 'function') loadGrnTimeline();
    }).catch(function (err) {
        showToast(err.message, 'error');
    });
}
window.returnStockToAgency = returnStockToAgency;

function openAdjustStockModal() {
    var sel = document.getElementById('adjustMedSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select medicine</option>';
    allMedicines.filter(function (m) {
        return !m.disposed && getExpiryStatus(m.expiryDate) !== 'expired';
    }).forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = (m.medicineName || m.id) + ' (stock ' + (m.stock || 0) + ')';
        opt.dataset.stock = m.stock || 0;
        sel.appendChild(opt);
    });
    document.getElementById('adjustNewQty').value = '';
    document.getElementById('adjustReason').value = '';
    document.getElementById('adjustStockModal').classList.add('active');
}
window.openAdjustStockModal = openAdjustStockModal;

document.addEventListener('DOMContentLoaded', function () {
    var adjForm = document.getElementById('adjustStockForm');
    if (adjForm) {
        adjForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var medId = document.getElementById('adjustMedSelect').value;
            var newQty = parseInt(document.getElementById('adjustNewQty').value, 10);
            var reason = document.getElementById('adjustReason').value.trim();
            if (!medId || isNaN(newQty) || !reason) {
                showToast('Medicine, quantity and description are required.', 'warning');
                return;
            }
            var med = allMedicines.find(function (m) { return m.id === medId; });
            var prev = med ? (med.stock || 0) : 0;
            db.collection('pharmacy').doc(medId).update({
                stock: newQty,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function () {
                if (typeof writeAuditLog === 'function') {
                    writeAuditLog({
                        action: 'pharmacy_stock_adjust',
                        medicineId: medId,
                        medicineName: med ? med.medicineName : '',
                        previousStock: prev,
                        newStock: newQty,
                        reason: reason
                    });
                }
                document.getElementById('adjustStockModal').classList.remove('active');
                showToast('Stock adjusted and audited.', 'success');
            }).catch(function (err) { showToast(err.message, 'error'); });
        });
    }
});

// ==========================================
// DEDICATED GRN & SUPPLIERS MODULE
// ==========================================
var allGrnData = [];
var allSuppliersData = [];
var grnSupplierSelectOpenedFromGrn = false;

// --- SUPPLIERS SECTION ---
function loadSuppliersSection() {
    var tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#888;"><i class="fa-solid fa-spinner fa-spin"></i> Loading suppliers directory...</td></tr>';

    db.collection('suppliers').get().then(function (snap) {
        if (snap.empty) {
            // Seed 3 initial suppliers if database has none
            var initialSuppliers = [
                {
                    name: 'Sri Balaji Medical Agencies',
                    contactPerson: 'Ramesh Reddy',
                    phone: '9848012345',
                    email: 'orders@balajipharma.com',
                    gstin: '36AABCS1234D1Z5',
                    dlNo: '20B/21B-TS/HYD/1092',
                    address: 'Kachiguda, Hyderabad',
                    paymentTerms: '15 Days Net',
                    totalPurchases: 45000,
                    balanceDue: 12000,
                    notes: 'Prompt delivery within 24h. Stockist for Cipla & Sun Pharma.',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                },
                {
                    name: 'Apollo Pharma Wholesale Distributors',
                    contactPerson: 'S. Swathi',
                    phone: '9988776655',
                    email: 'wholesale@apollodist.com',
                    gstin: '36AAACT8921E1Z4',
                    dlNo: '20B/21B-TS/SEC/8834',
                    address: 'Begumpet, Secunderabad',
                    paymentTerms: '30 Days Net',
                    totalPurchases: 78500,
                    balanceDue: 0,
                    notes: 'Direct distributor for surgicals, IV fluids and antibiotics.',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                },
                {
                    name: 'MedPlus Logistics & Agencies',
                    contactPerson: 'V. Prakash',
                    phone: '9876543210',
                    email: 'supply@medpluslogistics.com',
                    gstin: '36AABCM4567K1Z8',
                    dlNo: '20B/21B-TS/RAN/4421',
                    address: 'Autonagar, Hyderabad',
                    paymentTerms: '30 Days Net',
                    totalPurchases: 32000,
                    balanceDue: 5500,
                    notes: 'Authorized agency for maternity and pediatric formulations.',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            ];

            var batch = db.batch();
            initialSuppliers.forEach(function (sup) {
                var ref = db.collection('suppliers').doc();
                batch.set(ref, sup);
            });
            return batch.commit().then(function () {
                return db.collection('suppliers').get();
            });
        }
        return snap;
    }).then(function (snap) {
        allSuppliersData = [];
        snap.forEach(function (doc) {
            allSuppliersData.push(Object.assign({ id: doc.id }, doc.data()));
        });
        allSuppliersData.sort(function (a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });
        renderSuppliersTable(allSuppliersData);
        populateGrnSupplierDropdown(allSuppliersData);
    }).catch(function (err) {
        console.error('loadSuppliersSection error:', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:red;padding:16px;">Failed to load suppliers: ' + escapeHtml(err.message) + '</td></tr>';
    });
}
window.loadSuppliersSection = loadSuppliersSection;

function renderSuppliersTable(suppliers) {
    var tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;

    var totalPurchases = 0;
    var totalDue = 0;

    suppliers.forEach(function (s) {
        totalPurchases += Number(s.totalPurchases || 0);
        totalDue += Number(s.balanceDue || 0);
    });

    var statTotal = document.getElementById('supplierStatTotal');
    var statPurchases = document.getElementById('supplierStatPurchases');
    var statDue = document.getElementById('supplierStatDue');
    if (statTotal) statTotal.textContent = suppliers.length;
    if (statPurchases) statPurchases.textContent = formatCurrency(totalPurchases);
    if (statDue) statDue.textContent = formatCurrency(totalDue);

    if (!suppliers.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#888;">No suppliers found. Click "+ Add New Supplier" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = suppliers.map(function (s) {
        var due = Number(s.balanceDue || 0);
        var dueBadge = due > 0 
            ? '<span style="color:#dc2626;font-weight:700;">' + formatCurrency(due) + '</span>'
            : '<span style="color:#16a34a;font-weight:600;">Cleared (₹0)</span>';

        return '<tr>'
            + '<td><strong style="color:var(--primary-navy);">' + escapeHtml(s.name || '') + '</strong></td>'
            + '<td>' + escapeHtml(s.contactPerson || '—') + '</td>'
            + '<td><div>' + escapeHtml(s.phone || '—') + '</div><small style="color:#64748b;">' + escapeHtml(s.email || '') + '</small></td>'
            + '<td><div><span style="font-size:11.5px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">GST: ' + escapeHtml(s.gstin || 'N/A') + '</span></div>'
            + (s.dlNo ? '<small style="color:#64748b;font-size:11px;">DL: ' + escapeHtml(s.dlNo) + '</small>' : '') + '</td>'
            + '<td>' + escapeHtml(s.address || '—') + '</td>'
            + '<td><span style="font-size:11.5px;color:#475569;font-weight:600;">' + escapeHtml(s.paymentTerms || '15 Days') + '</span></td>'
            + '<td class="num"><strong>' + formatCurrency(s.totalPurchases || 0) + '</strong></td>'
            + '<td class="num">' + dueBadge + '</td>'
            + '<td style="text-align:center;"><div style="display:flex;gap:6px;justify-content:center;">'
            + '<button class="btn-secondary btn-sm" onclick="openAddSupplierModal(false, \'' + s.id + '\')" title="Edit Supplier"><i class="fa-solid fa-pen"></i></button>'
            + '<button class="btn-primary btn-sm" style="padding:4px 8px;font-size:11px;" onclick="openNewGrnModal(\'' + escapeHtml(s.name).replace(/'/g, "\\'") + '\')" title="Record Inward GRN for this Supplier"><i class="fa-solid fa-plus"></i> GRN</button>'
            + '</div></td>'
            + '</tr>';
    }).join('');
}

function populateGrnSupplierDropdown(suppliers) {
    var select = document.getElementById('grnModalSupplier');
    if (!select) return;
    var currentVal = select.value;
    select.innerHTML = '<option value="">Select Supplier...</option>' + suppliers.map(function (s) {
        return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</option>';
    }).join('');
    if (currentVal) select.value = currentVal;
}

// Supplier Search Handler
var supplierSearchInput = document.getElementById('supplierSearchInput');
if (supplierSearchInput) {
    supplierSearchInput.addEventListener('input', function (e) {
        var query = (e.target.value || '').toLowerCase().trim();
        if (!query) {
            renderSuppliersTable(allSuppliersData);
            return;
        }
        var filtered = allSuppliersData.filter(function (s) {
            return (s.name || '').toLowerCase().includes(query)
                || (s.contactPerson || '').toLowerCase().includes(query)
                || (s.phone || '').toLowerCase().includes(query)
                || (s.gstin || '').toLowerCase().includes(query)
                || (s.address || '').toLowerCase().includes(query);
        });
        renderSuppliersTable(filtered);
    });
}

// Add / Edit Supplier Modal Actions
function openAddSupplierModal(fromGrn, editId) {
    grnSupplierSelectOpenedFromGrn = !!fromGrn;
    var modal = document.getElementById('addSupplierModal');
    var title = document.getElementById('supplierModalTitle');
    var form = document.getElementById('supplierForm');
    if (form) form.reset();
    document.getElementById('supplierEditId').value = editId || '';

    if (editId) {
        var existing = allSuppliersData.find(function (s) { return s.id === editId; });
        if (existing) {
            if (title) title.innerHTML = '<i class="fa-solid fa-pen" style="color:#A61E4D;margin-right:8px;"></i>Edit Supplier: ' + escapeHtml(existing.name);
            document.getElementById('supName').value = existing.name || '';
            document.getElementById('supContact').value = existing.contactPerson || '';
            document.getElementById('supPhone').value = existing.phone || '';
            document.getElementById('supEmail').value = existing.email || '';
            document.getElementById('supGstin').value = existing.gstin || '';
            document.getElementById('supDl').value = existing.dlNo || '';
            document.getElementById('supPaymentTerms').value = existing.paymentTerms || '15 Days Net';
            document.getElementById('supAddress').value = existing.address || '';
            document.getElementById('supNotes').value = existing.notes || '';
        }
    } else {
        if (title) title.innerHTML = '<i class="fa-solid fa-truck-field" style="color:#A61E4D;margin-right:8px;"></i>Add New Supplier / Distributor';
    }

    if (modal) modal.classList.add('active');
}
window.openAddSupplierModal = openAddSupplierModal;

function closeAddSupplierModal() {
    var modal = document.getElementById('addSupplierModal');
    if (modal) modal.classList.remove('active');
}
window.closeAddSupplierModal = closeAddSupplierModal;

var btnOpenAddSupplierModal = document.getElementById('btnOpenAddSupplierModal');
if (btnOpenAddSupplierModal) {
    btnOpenAddSupplierModal.addEventListener('click', function () {
        openAddSupplierModal(false);
    });
}

var supplierForm = document.getElementById('supplierForm');
if (supplierForm) {
    supplierForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var editId = document.getElementById('supplierEditId').value;
        var name = document.getElementById('supName').value.trim();
        var phone = document.getElementById('supPhone').value.trim();
        if (!name || !phone) {
            showToast('Supplier Name and Phone are required.', 'warning');
            return;
        }

        var data = {
            name: name,
            contactPerson: document.getElementById('supContact').value.trim(),
            phone: phone,
            email: document.getElementById('supEmail').value.trim(),
            gstin: document.getElementById('supGstin').value.trim().toUpperCase(),
            dlNo: document.getElementById('supDl').value.trim(),
            paymentTerms: document.getElementById('supPaymentTerms').value,
            address: document.getElementById('supAddress').value.trim(),
            notes: document.getElementById('supNotes').value.trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        var promise;
        if (editId) {
            promise = db.collection('suppliers').doc(editId).update(data);
        } else {
            data.totalPurchases = 0;
            data.balanceDue = 0;
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            promise = db.collection('suppliers').add(data);
        }

        promise.then(function (docRef) {
            showToast(editId ? 'Supplier updated successfully.' : 'Supplier registered successfully.', 'success');
            closeAddSupplierModal();
            loadSuppliersSection();

            if (grnSupplierSelectOpenedFromGrn) {
                setTimeout(function () {
                    var supSelect = document.getElementById('grnModalSupplier');
                    if (supSelect) supSelect.value = name;
                }, 300);
            }
        }).catch(function (err) {
            showToast('Error saving supplier: ' + err.message, 'error');
        });
    });
}

// Export Suppliers CSV
var exportSuppliersBtn = document.getElementById('exportSuppliersBtn');
if (exportSuppliersBtn) {
    exportSuppliersBtn.addEventListener('click', function () {
        if (!allSuppliersData.length) {
            showToast('No suppliers to export.', 'warning');
            return;
        }
        var exportData = allSuppliersData.map(function (s) {
            return {
                'Supplier Name': s.name || '',
                'Contact Person': s.contactPerson || '',
                'Phone': s.phone || '',
                'Email': s.email || '',
                'GSTIN': s.gstin || '',
                'Drug License': s.dlNo || '',
                'Address': s.address || '',
                'Payment Terms': s.paymentTerms || '',
                'Total Purchases (INR)': s.totalPurchases || 0,
                'Balance Due (INR)': s.balanceDue || 0
            };
        });
        exportToCSV(exportData, 'Suppliers_Directory_' + todayIso());
    });
}


// --- GRN (GOODS RECEIPT NOTE) SECTION ---
function loadGrnSection() {
    var tbody = document.getElementById('grnTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:#888;"><i class="fa-solid fa-spinner fa-spin"></i> Loading Goods Receipt Notes...</td></tr>';

    db.collection('stockReceipts').orderBy('addedAt', 'desc').get().then(function (snap) {
        if (snap.empty) {
            // If empty, seed 2 sample realistic GRNs
            var now = new Date();
            var sampleGrns = [
                {
                    grnNo: 'GRN-2026-0001',
                    receiptDate: todayIso(),
                    invoiceNo: 'INV-BLJ-4491',
                    invoiceDate: todayIso(),
                    supplierName: 'Sri Balaji Medical Agencies',
                    medicineName: 'Paracetamol 500mg (Dolo)',
                    medicineId: '',
                    batchNumber: 'DL26B01',
                    expiryDate: '2028-12-31',
                    quantityAdded: 200,
                    purchasePrice: 1.80,
                    mrp: 3.50,
                    gstPercent: 12,
                    totalAmount: 403.20,
                    paidAmount: 403.20,
                    balanceDue: 0,
                    paymentDueDate: todayIso(),
                    paymentStatus: 'paid',
                    paymentMode: 'bank_transfer',
                    notes: 'Fresh stock received in intact blister packaging.',
                    addedBy: currentUserEmail || 'admin@hospital.com',
                    addedAt: firebase.firestore.FieldValue.serverTimestamp()
                },
                {
                    grnNo: 'GRN-2026-0002',
                    receiptDate: todayIso(),
                    invoiceNo: 'INV-APL-8821',
                    invoiceDate: todayIso(),
                    supplierName: 'Apollo Pharma Wholesale Distributors',
                    medicineName: 'Amoxicillin 500mg Capsules',
                    medicineId: '',
                    batchNumber: 'AMX26C04',
                    expiryDate: '2027-10-31',
                    quantityAdded: 100,
                    purchasePrice: 6.50,
                    mrp: 12.00,
                    gstPercent: 12,
                    totalAmount: 728.00,
                    paidAmount: 0,
                    balanceDue: 728.00,
                    paymentDueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
                    paymentStatus: 'unpaid',
                    paymentMode: 'credit',
                    notes: 'Invoice received with e-way bill. Payment on 30-day net terms.',
                    addedBy: currentUserEmail || 'admin@hospital.com',
                    addedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            ];

            var batch = db.batch();
            sampleGrns.forEach(function (grn) {
                var ref = db.collection('stockReceipts').doc();
                batch.set(ref, grn);
            });
            return batch.commit().then(function () {
                return db.collection('stockReceipts').orderBy('addedAt', 'desc').get();
            });
        }
        return snap;
    }).then(function (snap) {
        allGrnData = [];
        snap.forEach(function (doc) {
            allGrnData.push(Object.assign({ id: doc.id }, doc.data()));
        });
        filterAndRenderGrnTable();
    }).catch(function (err) {
        console.warn('Fallback unordered stockReceipts query:', err);
        db.collection('stockReceipts').get().then(function (snap) {
            allGrnData = [];
            snap.forEach(function (doc) {
                allGrnData.push(Object.assign({ id: doc.id }, doc.data()));
            });
            allGrnData.sort(function (a, b) {
                var da = a.addedAt && a.addedAt.toMillis ? a.addedAt.toMillis() : 0;
                var db_ = b.addedAt && b.addedAt.toMillis ? b.addedAt.toMillis() : 0;
                return db_ - da;
            });
            filterAndRenderGrnTable();
        }).catch(function (err2) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:red;padding:16px;">Failed to load GRNs: ' + escapeHtml(err2.message) + '</td></tr>';
        });
    });
}
window.loadGrnSection = loadGrnSection;

function filterAndRenderGrnTable() {
    var search = (document.getElementById('grnSearchInput') ? document.getElementById('grnSearchInput').value : '').toLowerCase().trim();
    var status = document.getElementById('grnStatusFilter') ? document.getElementById('grnStatusFilter').value : '';
    var date = document.getElementById('grnDateFilter') ? document.getElementById('grnDateFilter').value : '';

    var filtered = allGrnData.filter(function (r) {
        if (status && String(r.paymentStatus || '').toLowerCase() !== status.toLowerCase()) return false;
        if (date) {
            var rDate = r.receiptDate || (r.addedAt && r.addedAt.toDate ? isoDate(r.addedAt.toDate()) : '');
            if (rDate !== date) return false;
        }
        if (search) {
            var haystack = [
                r.grnNo || '',
                r.invoiceNo || '',
                r.supplierName || '',
                r.medicineName || '',
                r.batchNumber || ''
            ].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    renderGrnTable(filtered);
}

function renderGrnTable(grns) {
    var tbody = document.getElementById('grnTableBody');
    if (!tbody) return;

    var totalInwardValue = 0;
    var totalPaid = 0;
    var totalDue = 0;

    grns.forEach(function (r) {
        var amt = Number(r.totalAmount || r.amount || ((r.quantityAdded || 0) * (r.purchasePrice || 0)));
        totalInwardValue += amt;
        var pStatus = String(r.paymentStatus || '').toLowerCase();
        if (pStatus === 'paid') {
            totalPaid += amt;
        } else if (pStatus === 'partial') {
            totalPaid += Number(r.paidAmount || (amt / 2));
            totalDue += Number(r.balanceDue || (amt / 2));
        } else {
            totalDue += amt;
        }
    });

    var statTotalCount = document.getElementById('grnStatTotalCount');
    var statTotalValue = document.getElementById('grnStatTotalValue');
    var statTotalPaid = document.getElementById('grnStatTotalPaid');
    var statTotalDue = document.getElementById('grnStatTotalDue');
    if (statTotalCount) statTotalCount.textContent = grns.length;
    if (statTotalValue) statTotalValue.textContent = formatCurrency(totalInwardValue);
    if (statTotalPaid) statTotalPaid.textContent = formatCurrency(totalPaid);
    if (statTotalDue) statTotalDue.textContent = formatCurrency(totalDue);

    if (!grns.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:#888;">No GRNs found matching current criteria.</td></tr>';
        return;
    }

    tbody.innerHTML = grns.map(function (r) {
        var pStatus = String(r.paymentStatus || 'unpaid').toLowerCase();
        var statusBadge = '';
        if (pStatus === 'paid') {
            statusBadge = '<span class="status-badge" style="background:#dcfce7;color:#166534;"><i class="fa-solid fa-circle-check"></i> Paid</span>';
        } else if (pStatus === 'partial') {
            statusBadge = '<span class="status-badge" style="background:#fef3c7;color:#b45309;"><i class="fa-solid fa-clock"></i> Partial</span>';
        } else if (pStatus === 'credit_note') {
            statusBadge = '<span class="status-badge" style="background:#f3e8ff;color:#6b21a8;">Credit Note</span>';
        } else {
            statusBadge = '<span class="status-badge" style="background:#fee2e2;color:#991b1b;"><i class="fa-solid fa-circle-exclamation"></i> Unpaid / Due</span>';
        }

        var amount = Number(r.totalAmount || r.amount || ((r.quantityAdded || 0) * (r.purchasePrice || 0)));
        var dateStr = r.receiptDate || (r.addedAt ? formatDate(r.addedAt) : '—');
        var grnIdSafe = r.id;

        return '<tr>'
            + '<td><strong style="color:#A61E4D;font-family:monospace;">' + escapeHtml(r.grnNo || ('GRN-' + (r.id ? r.id.slice(-6).toUpperCase() : '001'))) + '</strong></td>'
            + '<td>' + escapeHtml(dateStr) + '</td>'
            + '<td><strong>' + escapeHtml(r.supplierName || '—') + '</strong></td>'
            + '<td><div>' + escapeHtml(r.invoiceNo || '—') + '</div>' + (r.invoiceDate ? '<small style="color:#64748b;">' + escapeHtml(r.invoiceDate) + '</small>' : '') + '</td>'
            + '<td><strong>' + escapeHtml(r.medicineName || '—') + '</strong><br><span style="font-size:11px;color:#64748b;">'
            + (Number(r.itemCount) > 1
                ? escapeHtml(r.itemCount + ' items on this invoice')
                : 'Batch: ' + escapeHtml(r.batchNumber || '-') + ' | Exp: ' + escapeHtml(r.expiryDate || '-'))
            + '</span></td>'
            + '<td class="num"><strong style="color:#0f172a;">' + (r.quantityAdded || 0) + '</strong></td>'
            + '<td class="num"><strong style="color:#166534;">' + formatCurrency(amount) + '</strong></td>'
            + '<td>' + (r.paymentDueDate ? escapeHtml(r.paymentDueDate) : '—') + '</td>'
            + '<td>' + statusBadge + '</td>'
            + '<td style="text-align:center;"><div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">'
            + '<button class="btn-secondary btn-sm" onclick="showGrnVoucher(\'' + grnIdSafe + '\')" style="padding:3px 8px;font-size:11.5px;"><i class="fa-solid fa-file-invoice"></i> Voucher</button>'
            + (pStatus !== 'paid' ? '<button class="btn-primary btn-sm" onclick="quickMarkGrnPaid(\'' + grnIdSafe + '\')" style="padding:3px 8px;font-size:11.5px;background:#16a34a;border-color:#16a34a;"><i class="fa-solid fa-check"></i> Pay</button>' : '')
            + '</div></td>'
            + '</tr>';
    }).join('');
}

// GRN Search, Filter & Clear Event Listeners
var grnSearchInput = document.getElementById('grnSearchInput');
if (grnSearchInput) grnSearchInput.addEventListener('input', filterAndRenderGrnTable);
var grnStatusFilter = document.getElementById('grnStatusFilter');
if (grnStatusFilter) grnStatusFilter.addEventListener('change', filterAndRenderGrnTable);
var grnDateFilter = document.getElementById('grnDateFilter');
if (grnDateFilter) grnDateFilter.addEventListener('change', filterAndRenderGrnTable);
var grnClearFiltersBtn = document.getElementById('grnClearFiltersBtn');
if (grnClearFiltersBtn) {
    grnClearFiltersBtn.addEventListener('click', function () {
        if (grnSearchInput) grnSearchInput.value = '';
        if (grnStatusFilter) grnStatusFilter.value = '';
        if (grnDateFilter) grnDateFilter.value = '';
        filterAndRenderGrnTable();
    });
}

// Export GRN CSV
var exportGrnBtn = document.getElementById('exportGrnBtn');
if (exportGrnBtn) {
    exportGrnBtn.addEventListener('click', function () {
        if (!allGrnData.length) {
            showToast('No GRN records to export.', 'warning');
            return;
        }
        var exportData = allGrnData.map(function (r) {
            return {
                'GRN No': r.grnNo || '',
                'Receipt Date': r.receiptDate || (r.addedAt ? formatDate(r.addedAt) : ''),
                'Supplier': r.supplierName || '',
                'Invoice No': r.invoiceNo || '',
                'Invoice Date': r.invoiceDate || '',
                'Medicine': r.medicineName || '',
                'Batch No': r.batchNumber || '',
                'Expiry Date': r.expiryDate || '',
                'Quantity Received': r.quantityAdded || 0,
                'Purchase Price (INR)': r.purchasePrice || 0,
                'Total Amount (INR)': r.totalAmount || r.amount || 0,
                'Payment Status': r.paymentStatus || '',
                'Payment Due Date': r.paymentDueDate || '',
                'Notes': r.notes || ''
            };
        });
        exportToCSV(exportData, 'GRN_Records_' + todayIso());
    });
}

// Open / Close New GRN Modal
function openNewGrnModal(prefillSupplier) {
    var modal = document.getElementById('newComprehensiveGrnModal');
    var form = document.getElementById('newGrnForm');
    if (form) form.reset();

    // Auto-generate GRN number
    var year = new Date().getFullYear();
    var randomSeq = Math.floor(1000 + Math.random() * 9000);
    document.getElementById('grnModalNo').value = 'GRN-' + year + '-' + randomSeq;
    document.getElementById('grnModalDate').value = todayIso();
    document.getElementById('grnModalPaymentStatus').value = 'unpaid';

    // Populate suppliers dropdown if not already populated
    if (allSuppliersData.length) {
        populateGrnSupplierDropdown(allSuppliersData);
    } else {
        loadSuppliersSection();
    }

    if (prefillSupplier) {
        setTimeout(function () {
            var supSelect = document.getElementById('grnModalSupplier');
            if (supSelect) supSelect.value = prefillSupplier;
        }, 150);
    }

    // Start each GRN with an empty line buffer, or the previous invoice's
    // items would be inwarded again.
    grnPendingItems = [];
    if (typeof renderGrnItems === 'function') renderGrnItems();

    calculateGrnModalTotal();
    if (modal) modal.classList.add('active');
}
window.openNewGrnModal = openNewGrnModal;

function closeNewGrnModal() {
    if (grnPendingItems && grnPendingItems.length
        && !confirm(grnPendingItems.length + ' item(s) have been added but not saved.\n\nDiscard this GRN?')) {
        return;
    }
    grnPendingItems = [];
    if (typeof renderGrnItems === 'function') renderGrnItems();
    var modal = document.getElementById('newComprehensiveGrnModal');
    if (modal) modal.classList.remove('active');
}
window.closeNewGrnModal = closeNewGrnModal;

var btnOpenNewGrnModal = document.getElementById('btnOpenNewGrnModal');
if (btnOpenNewGrnModal) {
    btnOpenNewGrnModal.addEventListener('click', function () {
        openNewGrnModal();
    });
}

// Autocomplete for Medicines in GRN Modal
var grnModalMedSearch = document.getElementById('grnModalMedSearch');
var grnMedSuggestions = document.getElementById('grnMedSuggestions');
if (grnModalMedSearch && grnMedSuggestions) {
    grnModalMedSearch.addEventListener('input', function (e) {
        var q = (e.target.value || '').toLowerCase().trim();
        if (!q || q.length < 2) {
            grnMedSuggestions.style.display = 'none';
            return;
        }
        var matches = (allMedicines || []).filter(function (m) {
            return (m.medicineName || '').toLowerCase().includes(q)
                || (m.genericName || '').toLowerCase().includes(q);
        }).slice(0, 6);

        if (!matches.length) {
            grnMedSuggestions.style.display = 'none';
            return;
        }

        grnMedSuggestions.innerHTML = matches.map(function (m) {
            return '<div class="drug-suggestion-item" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;" data-id="' + m.id + '">'
                + '<strong>' + escapeHtml(m.medicineName || '') + '</strong>'
                + ' <span style="font-size:11px;color:#64748b;">(' + escapeHtml(m.genericName || m.category || '') + ')</span>'
                + ' <span style="float:right;color:#0D7A70;font-size:11.5px;">Current Stock: ' + (m.stock || 0) + '</span>'
                + '</div>';
        }).join('');
        grnMedSuggestions.style.display = 'block';

        grnMedSuggestions.querySelectorAll('.drug-suggestion-item').forEach(function (item) {
            item.addEventListener('click', function () {
                var medId = item.dataset.id;
                var selected = (allMedicines || []).find(function (m) { return m.id === medId; });
                if (selected) {
                    grnModalMedSearch.value = selected.medicineName || '';
                    document.getElementById('grnModalMedId').value = selected.id;
                    if (selected.batchNo) document.getElementById('grnModalBatch').value = selected.batchNo;
                    if (selected.expiryDate) document.getElementById('grnModalExpiry').value = selected.expiryDate;
                    if (selected.purchasePrice) document.getElementById('grnModalPurchaseRate').value = selected.purchasePrice;
                    if (selected.price || selected.mrp) document.getElementById('grnModalMrp').value = selected.price || selected.mrp;
                    calculateGrnModalTotal();
                }
                grnMedSuggestions.style.display = 'none';
            });
        });
    });

    document.addEventListener('click', function (e) {
        if (!grnModalMedSearch.contains(e.target) && !grnMedSuggestions.contains(e.target)) {
            grnMedSuggestions.style.display = 'none';
        }
    });
}

function calculateGrnModalTotal() {
    var qty = parseFloat(document.getElementById('grnModalQty').value) || 0;
    var rate = parseFloat(document.getElementById('grnModalPurchaseRate').value) || 0;
    var gst = parseFloat(document.getElementById('grnModalGst').value) || 0;
    var freeQty = parseFloat((document.getElementById('grnModalFreeQty') || {}).value) || 0;
    var discPct = parseFloat((document.getElementById('grnModalDiscount') || {}).value) || 0;

    // Free goods are received into stock but not paid for, so they add to the
    // quantity inwarded and never to the value.
    var gross = qty * rate;
    var discount = gross * discPct / 100;
    var subtotal = gross - discount;
    var tax = (subtotal * gst) / 100;
    var total = subtotal + tax;

    var totalInput = document.getElementById('grnModalTotal');
    if (totalInput) totalInput.value = formatCurrency(total);
    var summaryText = document.getElementById('grnModalSummaryText');
    if (summaryText) {
        summaryText.textContent = 'Inwarded ' + (qty + freeQty) + ' unit(s)'
            + (freeQty ? ' (' + freeQty + ' free)' : '')
            + ' · Gross ' + formatCurrency(gross)
            + (discount ? ' − Disc ' + formatCurrency(discount) : '')
            + ' + GST (' + gst + '%) ' + formatCurrency(tax)
            + ' = Net ' + formatCurrency(total);
    }
}
window.calculateGrnModalTotal = calculateGrnModalTotal;

// Save GRN Form Handler — one supplier invoice, many medicine lines
var newGrnForm = document.getElementById('newGrnForm');
if (newGrnForm) {
    newGrnForm.addEventListener('submit', function (e) {
        e.preventDefault();

        var grnNo = document.getElementById('grnModalNo').value;
        var receiptDate = document.getElementById('grnModalDate').value;
        var supplier = document.getElementById('grnModalSupplier').value;
        var invoiceNo = document.getElementById('grnModalInvoiceNo').value.trim();
        var invoiceDate = document.getElementById('grnModalInvoiceDate').value;
        var dueDate = document.getElementById('grnModalDueDate').value;
        var payStatus = document.getElementById('grnModalPaymentStatus').value;
        var payMode = document.getElementById('grnModalPaymentMode').value;
        var poNo = ((document.getElementById('grnModalPoNo') || {}).value || '').trim();
        var notes = document.getElementById('grnModalNotes').value.trim();

        // An item still sitting in the entry fields is almost certainly meant
        // to be on the invoice, so offer to take it rather than lose it.
        if (!grnPendingItems.length && document.getElementById('grnModalMedSearch').value.trim()) {
            addGrnItem();
        }

        if (!supplier || !invoiceNo) {
            showToast('Select the supplier and enter the invoice number.', 'warning');
            return;
        }
        if (!grnPendingItems.length) {
            showToast('Add at least one medicine to this GRN.', 'warning');
            return;
        }
        if (GRN_REQUIRES_PO && !poNo) {
            showToast('A purchase order number is required before a GRN can be saved.', 'warning');
            return;
        }

        var items = grnPendingItems.slice();
        var subtotal = 0, taxAmount = 0, netTotal = 0, totalQty = 0;
        items.forEach(function (it) {
            subtotal += Number(it.subtotal || 0);
            taxAmount += Number(it.taxAmount || 0);
            netTotal += Number(it.lineTotal || 0);
            totalQty += Number(it.totalQuantityInwarded || 0);
        });
        subtotal = Math.round(subtotal * 100) / 100;
        taxAmount = Math.round(taxAmount * 100) / 100;
        netTotal = Math.round(netTotal * 100) / 100;

        var btn = document.getElementById('btnSaveNewGrn');
        if (btn) btn.disabled = true;

        var dbx = firebase.firestore();
        var batchOp = dbx.batch();
        var grnDocRef = dbx.collection('stockReceipts').doc();

        // Summary fields mirror the first line so older screens that expect a
        // single-item GRN keep rendering; items[] carries the full invoice.
        var summaryName = items.length === 1
            ? items[0].medicineName
            : items[0].medicineName + ' + ' + (items.length - 1) + ' more';

        batchOp.set(grnDocRef, {
            grnNo: grnNo,
            receiptDate: receiptDate,
            supplierName: supplier,
            invoiceNo: invoiceNo,
            invoiceDate: invoiceDate || receiptDate,
            poNo: poNo,
            paymentDueDate: dueDate || '',
            paymentStatus: payStatus,
            paymentMode: payMode,
            items: items,
            itemCount: items.length,
            medicineName: summaryName,
            batchNumber: items.length === 1 ? items[0].batchNumber : '',
            expiryDate: items.length === 1 ? items[0].expiryDate : '',
            quantityAdded: totalQty,
            purchasePrice: items[0].purchasePrice,
            mrp: items[0].mrp,
            subtotal: subtotal,
            taxAmount: taxAmount,
            totalAmount: netTotal,
            amount: netTotal,
            paidAmount: payStatus === 'paid' ? netTotal : 0,
            balanceDue: payStatus === 'paid' ? 0 : netTotal,
            notes: notes,
            addedBy: currentUserEmail || 'pharmacist',
            branchId: (window.hmsBranch ? hmsBranch.currentId() : 'main'),
            addedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Inward every line into stock.
        items.forEach(function (it) {
            var inward = Number(it.totalQuantityInwarded || 0);
            var stockFields = {
                stock: firebase.firestore.FieldValue.increment(inward),
                batchNo: it.batchNumber,
                batchNumber: it.batchNumber,
                expiryDate: it.expiryDate,
                purchasePrice: it.purchasePrice,
                price: it.mrp || it.purchasePrice,
                unitPrice: it.mrp || it.purchasePrice,
                stockStatus: 'active',
                disposed: false,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (it.manufacturer) stockFields.manufacturer = it.manufacturer;
            if (it.genericName) stockFields.genericName = it.genericName;
            if (it.rackLocation) stockFields.rackLocation = it.rackLocation;

            var target = it.medicineId;
            if (!target) {
                var existing = (allMedicines || []).find(function (m) {
                    return (m.medicineName || '').toLowerCase() === it.medicineName.toLowerCase();
                });
                if (existing) target = existing.id;
            }
            if (target) {
                batchOp.update(dbx.collection('pharmacy').doc(target), stockFields);
            } else {
                var newMedRef = dbx.collection('pharmacy').doc();
                batchOp.set(newMedRef, Object.assign({}, stockFields, {
                    medicineName: it.medicineName,
                    category: 'General',
                    stock: inward,
                    unit: 'unit',
                    reorderLevel: 20,
                    gstRate: Number(it.gstPercent || 5),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }));
            }
        });

        // Supplier ledger
        var matchingSupplier = (allSuppliersData || []).find(function (s) {
            return (s.name || '').toLowerCase() === supplier.toLowerCase();
        });
        if (matchingSupplier) {
            batchOp.update(dbx.collection('suppliers').doc(matchingSupplier.id), {
                totalPurchases: firebase.firestore.FieldValue.increment(netTotal),
                balanceDue: firebase.firestore.FieldValue.increment(payStatus === 'paid' ? 0 : netTotal),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        batchOp.set(dbx.collection('auditLog').doc(), {
            action: 'pharmacy_grn_created',
            grnNo: grnNo,
            supplierName: supplier,
            invoiceNo: invoiceNo,
            itemCount: items.length,
            quantityAdded: totalQty,
            amount: netTotal,
            paymentStatus: payStatus,
            staffEmail: currentUserEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        batchOp.commit().then(function () {
            showToast('GRN ' + grnNo + ' recorded with ' + items.length + ' item(s). Inventory updated.', 'success');
            grnPendingItems = [];
            renderGrnItems();
            closeNewGrnModal();
            loadGrnSection();
            loadSuppliersSection();
            if (typeof fetchMedicines === 'function') fetchMedicines();
        }).catch(function (err) {
            showToast('Failed to save GRN: ' + err.message, 'error');
        }).finally(function () {
            if (btn) btn.disabled = false;
        });
    });
}

// Quick Mark GRN as Paid
function quickMarkGrnPaid(grnId) {
    if (!confirm('Mark this GRN as fully PAID?')) return;
    var grn = allGrnData.find(function (g) { return g.id === grnId; });
    if (!grn) return;

    var amt = Number(grn.totalAmount || grn.amount || 0);
    var dbx = firebase.firestore();
    var batch = dbx.batch();

    var grnRef = dbx.collection('stockReceipts').doc(grnId);
    batch.update(grnRef, {
        paymentStatus: 'paid',
        paidAmount: amt,
        balanceDue: 0,
        paidAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    var matchingSupplier = (allSuppliersData || []).find(function (s) {
        return (s.name || '').toLowerCase() === (grn.supplierName || '').toLowerCase();
    });
    if (matchingSupplier) {
        var supRef = dbx.collection('suppliers').doc(matchingSupplier.id);
        batch.update(supRef, {
            balanceDue: firebase.firestore.FieldValue.increment(-amt),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    batch.commit().then(function () {
        showToast('GRN marked as PAID. Supplier ledger updated.', 'success');
        loadGrnSection();
        loadSuppliersSection();
    }).catch(function (err) {
        showToast('Payment update failed: ' + err.message, 'error');
    });
}
window.quickMarkGrnPaid = quickMarkGrnPaid;

// View / Print GRN Voucher Modal
var currentGrnVoucherData = null;
function showGrnVoucher(grnId) {
    var grn = allGrnData.find(function (g) { return g.id === grnId; });
    if (!grn) {
        showToast('GRN record not found.', 'error');
        return;
    }
    currentGrnVoucherData = grn;

    var area = document.getElementById('grnVoucherPrintArea');
    if (!area) return;

    var amt = Number(grn.totalAmount || grn.amount || ((grn.quantityAdded || 0) * (grn.purchasePrice || 0)));
    var sub = Number(grn.subtotal || ((grn.quantityAdded || 0) * (grn.purchasePrice || 0)));
    var tax = Number(grn.taxAmount || (amt - sub));

    area.innerHTML = '<div style="font-family:Inter,sans-serif;color:#1e293b;">'
        + '<div style="display:flex;justify-content:space-between;border-bottom:2px solid #A61E4D;padding-bottom:12px;margin-bottom:16px;">'
        + '<div>'
        + '<h2 style="margin:0;color:#A61E4D;font-size:1.3rem;">JYOTHSNA MATERNITY HOSPITAL</h2>'
        + '<div style="font-size:11.5px;color:#64748b;">Central Pharmacy &amp; Stores Department • Madhanapalli</div>'
        + '<div style="font-size:11.5px;color:#64748b;">GSTIN: 36AABCS1234D1Z5 • Drug License: 20B/21B-TS/MBNR/449</div>'
        + '</div>'
        + '<div style="text-align:right;">'
        + '<div style="font-size:1.1rem;font-weight:700;color:#0f172a;">GOODS RECEIPT NOTE</div>'
        + '<div style="font-size:13px;font-weight:700;color:#A61E4D;font-family:monospace;">' + escapeHtml(grn.grnNo || '') + '</div>'
        + '<div style="font-size:12px;color:#64748b;">Date: ' + escapeHtml(grn.receiptDate || '') + '</div>'
        + '</div>'
        + '</div>'

        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-bottom:16px;font-size:12.5px;">'
        + '<div>'
        + '<div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;">Supplier / Vendor Details:</div>'
        + '<div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:2px;">' + escapeHtml(grn.supplierName || '—') + '</div>'
        + '<div style="color:#475569;margin-top:2px;">Payment Terms: ' + escapeHtml(grn.paymentMode || 'Credit') + '</div>'
        + '</div>'
        + '<div>'
        + '<div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;">Invoice Reference:</div>'
        + '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:2px;">Invoice No: ' + escapeHtml(grn.invoiceNo || '—') + '</div>'
        + '<div style="color:#475569;margin-top:2px;">Invoice Date: ' + escapeHtml(grn.invoiceDate || grn.receiptDate || '—') + '</div>'
        + '<div style="color:#475569;">Payment Due: ' + escapeHtml(grn.paymentDueDate || 'Immediate') + '</div>'
        + '</div>'
        + '</div>'

        + '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;border:1px solid #cbd5e1;">'
        + '<thead>'
        + '<tr style="background:#0f172a;color:#fff;text-align:left;">'
        + '<th style="padding:8px 10px;">Item / Description</th>'
        + '<th style="padding:8px 10px;">Batch No</th>'
        + '<th style="padding:8px 10px;">Expiry</th>'
        + '<th style="padding:8px 10px;text-align:right;">Qty</th>'
        + '<th style="padding:8px 10px;text-align:right;">Rate (₹)</th>'
        + '<th style="padding:8px 10px;text-align:right;">GST (%)</th>'
        + '<th style="padding:8px 10px;text-align:right;">Total (₹)</th>'
        + '</tr>'
        + '</thead>'
        + '<tbody>'
        // Multi-item GRNs carry items[]; older single-item records are shown
        // from their top-level fields so historic vouchers still print.
        + ((grn.items && grn.items.length)
            ? grn.items.map(function (it) {
                return '<tr style="border-bottom:1px solid #e2e8f0;">'
                    + '<td style="padding:10px;"><strong>' + escapeHtml(it.medicineName || '—') + '</strong>'
                    + (it.manufacturer ? '<br><span style="font-size:11px;color:#64748b;">' + escapeHtml(it.manufacturer) + '</span>' : '')
                    + (it.rackLocation ? '<br><span style="font-size:11px;color:#64748b;">Rack: ' + escapeHtml(it.rackLocation) + '</span>' : '')
                    + '</td>'
                    + '<td style="padding:10px;font-family:monospace;">' + escapeHtml(it.batchNumber || '-') + '</td>'
                    + '<td style="padding:10px;">' + escapeHtml(it.expiryDate || '-') + '</td>'
                    + '<td style="padding:10px;text-align:right;font-weight:700;">' + (it.quantityAdded || 0)
                    + (it.freeQuantity ? '<br><span style="font-size:11px;color:#16a34a;">+' + it.freeQuantity + ' free</span>' : '') + '</td>'
                    + '<td style="padding:10px;text-align:right;">' + Number(it.purchasePrice || 0).toFixed(2) + '</td>'
                    + '<td style="padding:10px;text-align:right;">' + (it.gstPercent || 0) + '%</td>'
                    + '<td style="padding:10px;text-align:right;font-weight:700;">' + Number(it.lineTotal || 0).toFixed(2) + '</td>'
                    + '</tr>';
            }).join('')
            : '<tr style="border-bottom:1px solid #e2e8f0;">'
                + '<td style="padding:10px;"><strong>' + escapeHtml(grn.medicineName || '—') + '</strong></td>'
                + '<td style="padding:10px;font-family:monospace;">' + escapeHtml(grn.batchNumber || '-') + '</td>'
                + '<td style="padding:10px;">' + escapeHtml(grn.expiryDate || '-') + '</td>'
                + '<td style="padding:10px;text-align:right;font-weight:700;">' + (grn.quantityAdded || 0) + '</td>'
                + '<td style="padding:10px;text-align:right;">' + Number(grn.purchasePrice || 0).toFixed(2) + '</td>'
                + '<td style="padding:10px;text-align:right;">' + (grn.gstPercent || 0) + '%</td>'
                + '<td style="padding:10px;text-align:right;font-weight:700;">' + Number(amt).toFixed(2) + '</td>'
                + '</tr>')
        + '</tbody>'
        + '</table>'

        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">'
        + '<div style="font-size:12px;color:#64748b;max-width:350px;">'
        + '<strong>Inspection Remarks:</strong> ' + (grn.notes ? escapeHtml(grn.notes) : 'Goods physically inspected, batch &amp; expiry verified against manufacturer packaging.')
        + '<div style="margin-top:6px;font-weight:600;color:' + (String(grn.paymentStatus).toLowerCase() === 'paid' ? '#16a34a' : '#dc2626') + ';">Payment Status: ' + String(grn.paymentStatus || 'unpaid').toUpperCase() + '</div>'
        + '</div>'
        + '<div style="width:240px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-size:12.5px;">'
        + '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Subtotal:</span><span>₹' + sub.toFixed(2) + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>GST:</span><span>₹' + tax.toFixed(2) + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #cbd5e1;padding-top:4px;color:#A61E4D;font-size:13.5px;"><span>Net Amount:</span><span>₹' + amt.toFixed(2) + '</span></div>'
        + '</div>'
        + '</div>'

        + '<div style="display:flex;justify-content:space-between;margin-top:40px;padding-top:20px;border-top:1px dashed #cbd5e1;font-size:11px;color:#64748b;">'
        + '<div style="text-align:center;width:180px;"><div style="border-top:1px solid #94a3b8;padding-top:4px;">Received &amp; Stocked By</div>Pharmacist Signature</div>'
        + '<div style="text-align:center;width:180px;"><div style="border-top:1px solid #94a3b8;padding-top:4px;">Quality Verified By</div>Store Incharge</div>'
        + '<div style="text-align:center;width:180px;"><div style="border-top:1px solid #94a3b8;padding-top:4px;">Finance Authorized</div>Hospital Accounts Seal</div>'
        + '</div>'
        + '</div>';

    var modal = document.getElementById('viewGrnVoucherModal');
    if (modal) modal.classList.add('active');
}
window.showGrnVoucher = showGrnVoucher;

// Print GRN Voucher
var btnPrintGrnVoucher = document.getElementById('btnPrintGrnVoucher');
if (btnPrintGrnVoucher) {
    btnPrintGrnVoucher.addEventListener('click', function () {
        var content = document.getElementById('grnVoucherPrintArea').innerHTML;
        var printWin = window.open('', '_blank', 'width=800,height=900');
        if (!printWin) {
            showToast('Please allow popups to print voucher.', 'warning');
            return;
        }
        printWin.document.open();
        printWin.document.write('<html><head><title>GRN Voucher - ' + (currentGrnVoucherData ? currentGrnVoucherData.grnNo : '') + '</title>'
            + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">'
            + '<style>body{font-family:Inter,sans-serif;margin:30px;color:#1e293b;}@media print{@page{margin:15mm;}}</style>'
            + '</head><body>' + content + '<script>setTimeout(function(){window.print();},400);<\/script></body></html>');
        printWin.document.close();
    });
}

// Download GRN PDF
var btnDownloadGrnPdf = document.getElementById('btnDownloadGrnPdf');
if (btnDownloadGrnPdf) {
    btnDownloadGrnPdf.addEventListener('click', function () {
        if (!currentGrnVoucherData) return;
        var grn = currentGrnVoucherData;
        if (!window.jspdf || !window.jspdf.jsPDF) {
            showToast('PDF generator loading...', 'info');
            return;
        }
        var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pageWidth = doc.internal.pageSize.getWidth();
        var y = 14;

        doc.setFillColor(166, 30, 77); // Hospital Wine
        doc.rect(0, 0, pageWidth, 24, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('JYOTHSNA MATERNITY HOSPITAL', pageWidth / 2, 11, { align: 'center' });
        doc.setFontSize(8.5);
        doc.setFont(undefined, 'normal');
        doc.text('Central Pharmacy & Stores • Goods Receipt Note (GRN)', pageWidth / 2, 18, { align: 'center' });

        y = 34;
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text('GRN NUMBER: ' + (grn.grnNo || '-'), 14, y);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9.5);
        doc.text('Date: ' + (grn.receiptDate || todayIso()), pageWidth - 14, y, { align: 'right' });

        y += 8;
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y, pageWidth - 28, 22, 'F');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text('SUPPLIER / VENDOR:', 18, y + 6);
        doc.text('INVOICE REFERENCE:', 110, y + 6);
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.setFont(undefined, 'bold');
        doc.text(String(grn.supplierName || '-'), 18, y + 12);
        doc.text('Invoice #: ' + String(grn.invoiceNo || '-'), 110, y + 12);
        doc.setFontSize(8.5);
        doc.setFont(undefined, 'normal');
        doc.text('Payment Mode: ' + String(grn.paymentMode || 'Credit'), 18, y + 17);
        doc.text('Payment Due: ' + String(grn.paymentDueDate || 'Immediate'), 110, y + 17);

        y += 28;
        var amt = Number(grn.totalAmount || grn.amount || ((grn.quantityAdded || 0) * (grn.purchasePrice || 0)));
        if (doc.autoTable) {
            doc.autoTable({
                startY: y,
                head: [['Item Description', 'Batch', 'Expiry', 'Qty', 'Rate (Rs)', 'GST %', 'Total (Rs)']],
                body: [[
                    grn.medicineName || '—',
                    grn.batchNumber || '—',
                    grn.expiryDate || '—',
                    String(grn.quantityAdded || 0),
                    Number(grn.purchasePrice || 0).toFixed(2),
                    (grn.gstPercent || 0) + '%',
                    amt.toFixed(2)
                ]],
                theme: 'grid',
                headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
                bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
                margin: { left: 14, right: 14 }
            });
            y = doc.lastAutoTable.finalY + 10;
        }

        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text('NET INWARD VALUE: Rs. ' + amt.toFixed(2), pageWidth - 14, y, { align: 'right' });
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8.5);
        doc.text('Payment Status: ' + String(grn.paymentStatus || 'unpaid').toUpperCase(), 14, y);

        y += 30;
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.line(14, y, 60, y);
        doc.text('Received By (Pharmacist)', 18, y + 5);

        doc.line(80, y, 130, y);
        doc.text('Verified By (Stores)', 85, y + 5);

        doc.line(150, y, pageWidth - 14, y);
        doc.text('Accounts Seal', 160, y + 5);

        var pdfFileName = 'GRN-' + (grn.grnNo || 'voucher');
        if (window.savePDFHelper) {
            window.savePDFHelper(doc, pdfFileName);
        } else {
            doc.save(pdfFileName + '.pdf');
        }
    });
}


// Part 6 & 9: Dispensing History loading, rendering, and export functions
function loadDispensingHistory(fromDate, toDate, patientSearch, medicineName, doctor) {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "<tr><td colspan='14' style='text-align: center;'><i class='fa-solid fa-spinner fa-spin'></i> Loading dispensing history...</td></tr>";
    
    let query = db.collection("dispensingHistory").orderBy("createdAt", "desc");
    
    query.get().then(snapshot => {
        let historyData = [];
        snapshot.forEach(doc => {
            historyData.push({ id: doc.id, ...doc.data() });
        });
        
        // Filter in JS for maximum robustness and flexibilty without requiring composite indexes
        let filtered = historyData.filter(item => {
            // Date range filter
            if (fromDate) {
                const itemDate = item.createdAt ? (item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt)) : null;
                if (!itemDate) return false;
                const start = new Date(fromDate);
                start.setHours(0,0,0,0);
                if (itemDate < start) return false;
            }
            if (toDate) {
                const itemDate = item.createdAt ? (item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt)) : null;
                if (!itemDate) return false;
                const end = new Date(toDate);
                end.setHours(23,59,59,999);
                if (itemDate > end) return false;
            }
            
            // Patient search (ID or Name)
            if (patientSearch) {
                const pQuery = patientSearch.toLowerCase();
                const pId = (item.patientId || '').toLowerCase();
                const pName = (item.patientName || '').toLowerCase();
                if (!pId.includes(pQuery) && !pName.includes(pQuery)) return false;
            }
            
            // Medicine search
            if (medicineName) {
                const mQuery = medicineName.toLowerCase();
                const mName = (item.medicineName || '').toLowerCase();
                if (!mName.includes(mQuery)) return false;
            }
            
            // Doctor search
            if (doctor) {
                const dQuery = doctor.toLowerCase();
                const dName = (item.prescribedBy || '').toLowerCase();
                if (!dName.includes(dQuery)) return false;
            }
            
            return true;
        });
        
        renderDispensingHistory(filtered);
    }).catch(err => {
        console.error("Error loading dispensing history:", err);
        tbody.innerHTML = `<tr><td colspan='14' style='text-align: center; color: red;'>Error loading history: ${err.message}</td></tr>`;
    });
}
window.loadDispensingHistory = loadDispensingHistory;

function renderDispensingHistory(data) {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    if (data.length === 0) {
        tbody.innerHTML = "<tr><td colspan='14' style='text-align: center;'>No dispensing records found.</td></tr>";
        document.getElementById('histTotalQty').textContent = '0 items';
        document.getElementById('histTotalValue').textContent = formatCurrency(0);
        document.getElementById('histMostDispensed').textContent = '—';
        window.currentDispensingHistory = [];
        return;
    }
    
    window.currentDispensingHistory = data;
    
    let totalQty = 0;
    let totalValue = 0;
    let medicineCounts = {};
    
    data.forEach(item => {
        const tr = document.createElement("tr");
        const qty = item.quantity || 0;
        const total = item.totalAmount || 0;
        
        totalQty += qty;
        totalValue += total;
        
        const medName = item.medicineName || 'Unknown';
        medicineCounts[medName] = (medicineCounts[medName] || 0) + qty;
        
        const dateStr = formatDate(item.createdAt) || 'Pending...';
        
        tr.innerHTML = `
            <td>${escapeHtml(dateStr)}</td>
            <td>${escapeHtml(item.patientName || '—')}</td>
            <td>${escapeHtml(item.patientId || '—')}</td>
            <td>${escapeHtml(medName)}</td>
            <td>${escapeHtml(item.dosage || '—')}</td>
            <td>${escapeHtml(String(item.days || '—'))}</td>
            <td>${escapeHtml(String(qty))}</td>
            <td>${formatCurrency(item.unitPrice)}</td>
            <td>${formatCurrency(total)}</td>
            <td>${escapeHtml(item.prescribedBy || '—')}</td>
            <td>${escapeHtml(item.dispensedBy || '—')}</td>
            <td><span class="status-badge status-instock" style="background:rgba(13, 122, 112, 0.1); color:#0D7A70;">${escapeHtml(item.paymentMethod || 'Cash')}</span></td>
            <td>${escapeHtml(item.linkedBillId || '—')}</td>
            <td>
                <button onclick="generateDispensingSlipPDF('${item.id}')" style="background:#0D7A70;color:white;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:4px;">
                    <i class="fa-solid fa-print"></i> Slip
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    let mostDispensed = '—';
    let maxQty = 0;
    for (const [med, qty] of Object.entries(medicineCounts)) {
        if (qty > maxQty) {
            maxQty = qty;
            mostDispensed = `${med} (${qty} items)`;
        }
    }
    
    document.getElementById('histTotalQty').textContent = `${totalQty} items`;
    document.getElementById('histTotalValue').textContent = formatCurrency(totalValue);
    document.getElementById('histMostDispensed').textContent = mostDispensed;
}
window.renderDispensingHistory = renderDispensingHistory;

function setDefaultHistoryDates() {
    const toDateInput = document.getElementById('histToDate');
    const fromDateInput = document.getElementById('histFromDate');
    if (toDateInput && fromDateInput) {
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);
        
        toDateInput.value = isoDate(today);
        fromDateInput.value = isoDate(thirtyDaysAgo);
    }
}

function loadDoctorsForHistory() {
    const select = document.getElementById('histDoctorSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">All Doctors</option>';
    db.collection('staff').where('role', '==', 'doctor').get().then(snap => {
        snap.forEach(doc => {
            const d = doc.data();
            const active = d.isActive === true || d.isActive === 'true';
            if (!active) return;
            const opt = document.createElement('option');
            opt.value = d.name;
            opt.textContent = d.name;
            select.appendChild(opt);
        });
    }).catch(err => console.error("Error loading doctors for history:", err));
}

// Filter listeners
document.getElementById('btnHistApply').addEventListener('click', function() {
    const fromDate = document.getElementById('histFromDate').value;
    const toDate = document.getElementById('histToDate').value;
    const patientSearch = document.getElementById('histPatientSearch').value.trim();
    const medicineSearch = document.getElementById('histMedicineSearch').value.trim();
    const doctor = document.getElementById('histDoctorSelect').value;
    
    loadDispensingHistory(fromDate, toDate, patientSearch, medicineSearch, doctor);
});

document.getElementById('btnHistClear').addEventListener('click', function() {
    setDefaultHistoryDates();
    document.getElementById('histPatientSearch').value = '';
    document.getElementById('histMedicineSearch').value = '';
    document.getElementById('histDoctorSelect').value = '';
    
    const fromDate = document.getElementById('histFromDate').value;
    const toDate = document.getElementById('histToDate').value;
    loadDispensingHistory(fromDate, toDate, '', '', '');
});

// CSV Export listeners for pharmacy
document.getElementById('exportInventoryBtn').addEventListener('click', function() {
    if (!allMedicines || !allMedicines.length) {
        showToast('No inventory data to export', 'warning');
        return;
    }
    const exportData = allMedicines.map(med => ({
        'Medicine Name': med.medicineName || '',
        'Generic Name': med.genericName || '',
        'Category': med.category || '',
        'Stock': med.stock || 0,
        'Unit': med.unit || '',
        'Price per Unit (INR)': med.price || 0,
        'Expiry Date': med.expiryDate || '',
        'Status': (med.stock || 0) <= 0 ? 'Out of Stock' : ((med.stock || 0) <= (med.reorderLevel !== undefined ? med.reorderLevel : 20) ? 'Low Stock' : 'In Stock')
    }));
    exportToCSV(exportData, 'pharmacy_inventory');
});

document.getElementById('exportHistoryBtn').addEventListener('click', function() {
    if (!window.currentDispensingHistory || !window.currentDispensingHistory.length) {
        showToast('No history data to export', 'warning');
        return;
    }
    const exportData = window.currentDispensingHistory.map(item => {
        const dateStr = formatDate(item.createdAt);
        return {
            'Date': dateStr,
            'Patient Name': item.patientName || '',
            'Patient ID': item.patientId || '',
            'Medicine Name': item.medicineName || '',
            'Quantity': item.quantity || 0,
            'Unit Price': item.unitPrice || 0,
            'Total Amount': item.totalAmount || 0,
            'Prescribed By': item.prescribedBy || '',
            'Dispensed By': item.dispensedBy || '',
            'Payment Method': item.paymentMethod || '',
            'Linked Bill': item.linkedBillId || ''
        };
    });
    exportToCSV(exportData, 'pharmacy_dispensing_history');
});

// Bind Prescription Queue modal buttons
const closeBtn = document.getElementById("closeDispRxModalBtn");
if (closeBtn) {
    closeBtn.addEventListener("click", () => {
        const modal = document.getElementById("dispensePrescriptionModal");
        if (modal) {
            modal.classList.remove("active");
            modal.style.display = "none";
        }
    });
}

const cancelBtn = document.getElementById("cancelDispRxBtn");
if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
        const modal = document.getElementById("dispensePrescriptionModal");
        if (modal) {
            modal.classList.remove("active");
            modal.style.display = "none";
        }
    });
}

const confirmBtn = document.getElementById("confirmDispRxBtn");
if (confirmBtn) {
    confirmBtn.addEventListener("click", confirmDispensePrescription);
}

// ==========================================
// CLINICAL PRESCRIPTION QUEUE FUNCTIONS
// ==========================================

let currentRxFilter = 'pending';
function setRxQueueFilter(status) {
    currentRxFilter = status;
    
    // Update active UI classes
    const pBtn = document.getElementById('rxFilterPendingBtn');
    const dBtn = document.getElementById('rxFilterDispensedBtn');
    const aBtn = document.getElementById('rxFilterAllBtn');
    
    if (pBtn) pBtn.classList.toggle('active', status === 'pending');
    if (dBtn) dBtn.classList.toggle('active', status === 'dispensed');
    if (aBtn) aBtn.classList.toggle('active', status === 'all');
    
    const btns = ['rxFilterPendingBtn', 'rxFilterDispensedBtn', 'rxFilterAllBtn'];
    btns.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.classList.contains('active')) {
                el.style.background = 'var(--primary-navy)';
                el.style.color = 'white';
                el.style.borderColor = 'var(--primary-navy)';
            } else {
                el.style.background = 'white';
                el.style.color = 'var(--text-muted)';
                el.style.borderColor = '#ccc';
            }
        }
    });

    loadPrescriptionQueue();
}
window.setRxQueueFilter = setRxQueueFilter;

// ==========================================
// PRESCRIPTION PRICING
// The doctor writes dose, frequency and duration; the counter has to turn
// that into a quantity and a price before the patient can pay. Same rules
// the dispense modal uses, so the queue's figure and the modal's total
// always agree.
// ==========================================
// A medicine name can legitimately appear more than once in the master —
// separate batches at different prices and expiry dates. Taking the first
// match quoted an arbitrary price and could refuse a dispense for
// "insufficient stock" while plenty sat under the other batch. Pick a batch
// that is actually sellable and can fill the order, oldest expiry first
// (first-expired-first-out, the normal rotation on a pharmacy shelf).
function findMedicineForDispense(name, qtyNeeded) {
    var wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    var matches = allMedicines.filter(function (m) {
        return String(m.medicineName || '').trim().toLowerCase() === wanted;
    });
    if (!matches.length) return null;

    var usable = matches.filter(function (m) {
        return !m.disposed && getExpiryStatus(m.expiryDate) !== 'expired';
    });
    var pool = usable.length ? usable : matches;

    var canFill = pool.filter(function (m) { return (m.stock || 0) >= (qtyNeeded || 1); });
    var candidates = canFill.length ? canFill : pool;

    candidates.sort(function (a, b) {
        var ad = a.expiryDate || '9999-12-31';
        var bd = b.expiryDate || '9999-12-31';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (b.stock || 0) - (a.stock || 0);
    });
    return candidates[0];
}
window.findMedicineForDispense = findMedicineForDispense;

function rxLineQuantity(item) {
    var freqVal = 1;
    var freq = String(item.frequency || '').toLowerCase();
    if (freq.indexOf('twice') !== -1 || freq.indexOf('every 12 hours') !== -1) freqVal = 2;
    else if (freq.indexOf('three') !== -1 || freq.indexOf('every 8 hours') !== -1) freqVal = 3;
    else if (freq.indexOf('four') !== -1 || freq.indexOf('every 6 hours') !== -1) freqVal = 4;
    var days = parseInt(String(item.duration || '').replace(/[^0-9]/g, ''), 10) || 1;
    return days * freqVal;
}

function rxEstimatedTotal(rx) {
    var total = 0, priced = 0, unpriced = 0;
    (rx.medicines || []).forEach(function (item) {
        var qty = rxLineQuantity(item);
        var med = findMedicineForDispense(item.medicineName || item.name, qty);
        if (!med) { unpriced++; return; }
        var price = parseFloat(med.price || med.unitPrice || 0) || 0;
        total += price * qty;
        priced++;
    });
    return { amount: Math.round(total * 100) / 100, priced: priced, unpriced: unpriced };
}

function loadPrescriptionQueue() {
    const tbody = document.getElementById("prescriptionQueueBody");
    if (!tbody) return;
    
    tbody.innerHTML = "<tr><td colspan='8' style='text-align: center;'><i class='fa-solid fa-spinner fa-spin'></i> Loading prescriptions...</td></tr>";
    
    if (prescriptionQueueUnsubscribe) {
        prescriptionQueueUnsubscribe();
    }
    
    let query = db.collection("prescriptions");
    if (currentRxFilter === 'pending') {
        query = query.where("status", "==", "pending");
    } else if (currentRxFilter === 'dispensed') {
        query = query.where("status", "==", "dispensed");
    }
    
    prescriptionQueueUnsubscribe = query.orderBy("createdAt", "desc")
    .onSnapshot(snapshot => {
        tbody.innerHTML = "";
        const badge = document.getElementById("rxQueueCountBadge");
        if (badge) {
            let label = "prescriptions";
            if (currentRxFilter === 'pending') label = "pending prescriptions";
            else if (currentRxFilter === 'dispensed') label = "dispensed prescriptions";
            else label = "total prescriptions";
            badge.textContent = `${snapshot.size} ${label}`;
        }
        // Pending count on the tab itself, so the pharmacist sees waiting work
        // from any other tab.
        const tabBadge = document.getElementById("rxQueueTabBadge");
        if (tabBadge) {
            const pending = currentRxFilter === 'pending' ? snapshot.size : null;
            if (pending !== null && pending > 0) {
                tabBadge.textContent = pending;
                tabBadge.style.display = '';
            } else if (pending === 0) {
                tabBadge.style.display = 'none';
            }
        }
        
        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan='8' style='text-align: center;'>No ${currentRxFilter === 'all' ? '' : currentRxFilter} prescriptions in queue.</td></tr>`;
            const emptyValue = document.getElementById("rxQueueValueBadge");
            if (emptyValue) emptyValue.textContent = formatCurrency(0) + ' to collect';
            return;
        }

        let queueValue = 0;

        snapshot.forEach(doc => {
            const rx = doc.data();
            const tr = document.createElement("tr");
            const dateStr = formatDate(rx.createdAt) || 'Pending...';
            const medsCount = rx.medicines ? rx.medicines.length : 0;
            const rxStatus = rx.status || 'pending';

            const est = rxEstimatedTotal(rx);
            if (rxStatus !== 'dispensed') queueValue += est.amount;
            let amountCell;
            if (!allMedicines.length) {
                amountCell = '<span style="color:#94a3b8;">…</span>';
            } else if (est.priced === 0) {
                amountCell = '<span style="color:#b91c1c;font-size:11px;">not in stock list</span>';
            } else {
                amountCell = '<strong>' + formatCurrency(est.amount) + '</strong>'
                    + (est.unpriced ? '<div style="font-size:10px;color:#b45309;">' + est.unpriced + ' item(s) unpriced</div>' : '');
            }
            
            let statusBadge = '';
            if (rxStatus === 'dispensed') {
                statusBadge = `<span style="background:rgba(16, 185, 129, 0.1); color:#10b981; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; text-transform:capitalize;">dispensed</span>`;
            } else {
                statusBadge = `<span style="background:rgba(245, 158, 11, 0.1); color:#f59e0b; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; text-transform:capitalize;">pending</span>`;
            }
            
            let actionHtml = '';
            if (rxStatus === 'dispensed') {
                actionHtml = `
                    <button class="btn-primary dispense-rx-btn" disabled style="padding: 6px 12px; font-size: 0.8rem; background:#cbd5e1; border-color:#cbd5e1; border-radius:6px; color:#64748b; cursor:not-allowed;">Dispensed</button>
                    <button class="btn-secondary print-rx-btn" onclick="generateBilingualPrescriptionPDF('${doc.id}')" style="padding: 6px 12px; font-size: 0.8rem; background:#f1f5f9; border: 1px solid #cbd5e1; border-radius:6px; color:#333; cursor:pointer; margin-left:6px;"><i class="fa-solid fa-print"></i> Duplicate Rx</button>
                `;
            } else {
                actionHtml = `
                    <button class="btn-primary dispense-rx-btn" data-id="${doc.id}" style="padding: 6px 12px; font-size: 0.8rem; background:#0D7A70; border-color:#0D7A70; border-radius:6px; color:white; cursor:pointer;">Dispense</button>
                    <button class="btn-secondary print-rx-btn" onclick="generateBilingualPrescriptionPDF('${doc.id}')" style="padding: 6px 12px; font-size: 0.8rem; background:#f1f5f9; border: 1px solid #cbd5e1; border-radius:6px; color:#333; cursor:pointer; margin-left:6px;"><i class="fa-solid fa-print"></i> Print Rx</button>
                `;
            }
            
            tr.innerHTML = `
                <td><strong>${escapeHtml(doc.id)}</strong></td>
                <td><strong>${escapeHtml(rx.patientName || '—')}</strong> <span style="font-size:11px; color:#888;">(${escapeHtml(rx.patientId || '')})</span></td>
                <td>${escapeHtml(rx.doctorName || '—')}</td>
                <td><span style="background:rgba(15, 43, 91, 0.1); color:#0F2B5B; padding:2px 8px; border-radius:12px; font-size:12px; font-weight:600;">${medsCount} meds</span></td>
                <td>${amountCell}</td>
                <td>${escapeHtml(dateStr)}</td>
                <td>${statusBadge}</td>
                <td>${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });

        const valueBadge = document.getElementById("rxQueueValueBadge");
        if (valueBadge) {
            valueBadge.textContent = allMedicines.length
                ? formatCurrency(queueValue) + ' to collect'
                : 'pricing…';
        }
        
        // Wire up dispense buttons
        tbody.querySelectorAll('.dispense-rx-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                openDispensePrescriptionModal(btn.dataset.id);
            });
        });
    }, error => {
        console.error("Error loading prescription queue:", error);
        tbody.innerHTML = `<tr><td colspan='7' style='text-align: center; color: red;'>Error loading queue: ${error.message}</td></tr>`;
    });
}
window.loadPrescriptionQueue = loadPrescriptionQueue;

function openDispensePrescriptionModal(rxId) {
    const modal = document.getElementById("dispensePrescriptionModal");
    if (!modal) return;
    
    // Reset fields
    document.getElementById("rxModalPtName").textContent = "Loading...";
    document.getElementById("rxModalDocName").textContent = "Loading...";
    document.getElementById("rxModalPtId").value = "";
    document.getElementById("rxModalPtDocId").value = "";
    document.getElementById("rxModalRxId").value = rxId;
    document.getElementById("rxModalMedsBody").innerHTML = "<tr><td colspan='5' style='text-align: center;'>Loading medicines...</td></tr>";
    document.getElementById("rxModalTotal").textContent = "₹0.00";
    
    modal.classList.add("active");
    modal.style.display = "flex"; // ensure visual display override
    
    db.collection("prescriptions").doc(rxId).get()
    .then(async doc => {
        if (!doc.exists) {
            showToast("Prescription not found", "error");
            modal.classList.remove("active");
            modal.style.display = "none";
            return;
        }
        
        const rx = doc.data();
        document.getElementById("rxModalPtName").textContent = rx.patientName || "Unknown";
        document.getElementById("rxModalDocName").textContent = rx.doctorName || "Unknown";
        document.getElementById("rxModalPtId").value = rx.patientId || "";
        document.getElementById("rxModalRxId").value = doc.id;
        
        // Find patient document ID from patientId
        let ptDocId = "";
        try {
            const ptSnap = await db.collection("patients").where("patientId", "==", rx.patientId).get();
            if (!ptSnap.empty) {
                ptDocId = ptSnap.docs[0].id;
                document.getElementById("rxModalPtDocId").value = ptDocId;
            }
        } catch (e) {
            console.error("Error fetching patient docId:", e);
        }
        
        // Render medicines
        const tbody = document.getElementById("rxModalMedsBody");
        tbody.innerHTML = "";
        
        if (!rx.medicines || rx.medicines.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align: center;'>No medicines in prescription.</td></tr>";
            return;
        }
        
        rx.medicines.forEach((item, index) => {
            // Prescription stores medicine as {name,...} from consultation.js; support both field names
            const rxMedName = item.medicineName || item.name || '';
            // Same batch-aware pick as the queue, so the modal total always
            // matches the amount quoted in the prescription list.
            const pharmacyMed = findMedicineForDispense(rxMedName, rxLineQuantity(item));
            
            let stock = 0;
            let price = 0;
            let medId = "";
            let stockDisplay = '<span class="status-badge status-outstock" style="padding:2px 8px; font-size:11px; border-radius:4px; font-weight:600; background:rgba(239, 68, 68, 0.1); color:#ef4444;">Not in Stock</span>';
            
            if (pharmacyMed) {
                stock = pharmacyMed.stock || 0;
                price = parseFloat(pharmacyMed.price || pharmacyMed.unitPrice || 0);
                medId = pharmacyMed.id;
                
                const reorderLevel = pharmacyMed.reorderLevel !== undefined ? pharmacyMed.reorderLevel : 20;
                if (stock === 0) {
                    stockDisplay = `<span class="status-badge status-outstock" style="padding:2px 8px; font-size:11px; border-radius:4px; font-weight:600; background:rgba(239, 68, 68, 0.1); color:#ef4444;">Out: 0</span>`;
                } else if (stock <= reorderLevel) {
                    stockDisplay = `<span class="status-badge status-lowstock" style="padding:2px 8px; font-size:11px; border-radius:4px; font-weight:600; background:rgba(245,158,11,0.1); color:#f59e0b;">Low: ${stock}</span>`;
                } else {
                    stockDisplay = `<span class="status-badge status-instock" style="padding:2px 8px; font-size:11px; border-radius:4px; font-weight:600; background:rgba(16,185,129,0.1); color:#10b981;">In: ${stock}</span>`;
                }
            }
            
            // Smart calculate qty from duration and frequency
            let freqVal = 1;
            const freq = (item.frequency || '').toLowerCase();
            if (freq.includes('twice') || freq.includes('every 12 hours')) freqVal = 2;
            else if (freq.includes('three') || freq.includes('every 8 hours')) freqVal = 3;
            else if (freq.includes('four') || freq.includes('every 6 hours')) freqVal = 4;
            else if (freq.includes('once')) freqVal = 1;
            
            const days = parseInt((item.duration || '').replace(/[^0-9]/g, '')) || 1;
            const defaultQty = days * freqVal;
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">
                    <strong style="color:#0F2B5B; font-size:14px;">${rxMedName}</strong>
                    <div style="font-size:11px; color:#666; margin-top:2px;">
                        ${item.dosage || ""} | ${item.frequency || ""} | ${item.duration || ""} | ${item.instructions || ""}
                    </div>
                </td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align:middle;">
                    ${stockDisplay}
                </td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align:middle;">
                    <input type="number" class="rx-qty-input filter-input" 
                        data-med-name="${escapeHtml(rxMedName)}" 
                        data-med-id="${medId}" 
                        data-price="${price}"
                        data-stock="${stock}"
                        data-dosage="${escapeHtml(item.dosage || '')}"
                        data-days="${days}"
                        data-frequency="${escapeHtml(item.frequency || '')}"
                        data-instructions="${escapeHtml(item.instructions || '')}"
                        value="${defaultQty}" 
                        min="0" 
                        style="width:60px; height:32px; padding:4px; text-align:center; border:1px solid #ddd; border-radius:6px; font-size:13px;"
                        oninput="updateRxModalTotals()">
                </td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9; text-align:right; vertical-align:middle;">
                    ₹${price.toFixed(2)}
                </td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9; text-align:right; font-weight:600; color:#0F2B5B; vertical-align:middle;" class="rx-item-amount">
                    ₹${(price * defaultQty).toFixed(2)}
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        updateRxModalTotals();
    })
    .catch(err => {
        console.error("Error opening rx modal:", err);
        showToast("Error loading prescription details: " + err.message, "error");
    });
}
window.openDispensePrescriptionModal = openDispensePrescriptionModal;

function updateRxModalTotals() {
    let grandTotal = 0;
    const qtyInputs = document.querySelectorAll(".rx-qty-input");
    const amountEls = document.querySelectorAll(".rx-item-amount");
    
    qtyInputs.forEach((input, index) => {
        const qty = parseInt(input.value) || 0;
        const price = parseFloat(input.dataset.price) || 0;
        const amount = qty * price;
        grandTotal += amount;
        
        if (amountEls[index]) {
            amountEls[index].textContent = "₹" + amount.toFixed(2);
        }
    });
    
    const totalEl = document.getElementById("rxModalTotal");
    if (totalEl) {
        totalEl.textContent = "₹" + grandTotal.toFixed(2);
    }
}
window.updateRxModalTotals = updateRxModalTotals;

function confirmDispensePrescription() {
    const rxId = document.getElementById("rxModalRxId").value;
    const patientId = document.getElementById("rxModalPtId").value;
    const patientDocId = document.getElementById("rxModalPtDocId").value;
    const patientName = document.getElementById("rxModalPtName").textContent;
    const doctorName = document.getElementById("rxModalDocName").textContent;
    const paymentMode = document.getElementById("rxModalPaymentMode").value;
    const billId = document.getElementById("rxModalBillId").value.trim();
    
    if (!rxId) {
        showToast("No active prescription selected", "error");
        return;
    }
    
    const qtyInputs = document.querySelectorAll(".rx-qty-input");
    const itemsToDispense = [];
    let insfStockWarning = false;
    let missingInvWarning = false;
    
    qtyInputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
            const medName = input.dataset.medName;
            const medId = input.dataset.medId;
            const price = parseFloat(input.dataset.price) || 0;
            const stock = parseInt(input.dataset.stock) || 0;
            const dosage = input.dataset.dosage || '';
            const days = parseInt(input.dataset.days) || 1;
            const frequency = input.dataset.frequency || '';
            const instructions = input.dataset.instructions || '';
            
            if (!medId) {
                missingInvWarning = true;
            } else if (stock < qty) {
                insfStockWarning = true;
            }
            
            itemsToDispense.push({
                medName,
                medId,
                qty,
                price,
                stock,
                dosage,
                days,
                frequency,
                instructions
            });
        }
    });
    
    if (itemsToDispense.length === 0) {
        showToast("Please enter a quantity greater than zero for at least one medicine", "warning");
        return;
    }
    
    if (missingInvWarning) {
        showToast("One or more prescribed medicines are not registered in the pharmacy inventory!", "error");
        return;
    }
    
    if (insfStockWarning) {
        showToast('Insufficient stock. Reduce the quantity or receive stock before dispensing.', 'error');
        return;
    }
    
    proceedDispense(itemsToDispense, rxId, patientId, patientDocId, patientName, doctorName, paymentMode, billId);
}

function proceedDispense(itemsToDispense, rxId, patientId, patientDocId, patientName, doctorName, paymentMode, billId) {
    const confirmBtn = document.getElementById('confirmDispRxBtn');
    if (confirmBtn && confirmBtn.disabled) return;
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Processing...'; }
    return commitPharmacySale({
        patient: { docId: patientDocId, patientId: patientId, name: patientName },
        items: itemsToDispense.map(item => ({ medicineId: item.medId, medicineName: item.medName,
            quantity: item.qty, unitPrice: item.price, dosage: item.dosage, days: item.days,
            frequency: item.frequency, instructions: item.instructions })),
        paymentMode: paymentMode, linkedBillId: billId, doctor: doctorName,
        actor: currentUserEmail, prescriptionId: rxId
    }).then(function (result) {
        const modal = document.getElementById('dispensePrescriptionModal');
        if (modal) { modal.classList.remove('active'); modal.style.display = 'none'; }
        showToast('Prescription dispensed. Bill: ' + result.billNumber, 'success');
        showPharmacyBillPdfPrompt(result.billDocId, result.billNumber);
    }).catch(function (err) {
        console.error('Dispensing prescription error:', err);
        showToast(err.message || 'Unable to dispense prescription.', 'error');
    }).finally(function () {
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Fulfill & Dispense'; }
    });
}

window.confirmDispensePrescription = confirmDispensePrescription;

function showPharmacyBillPdfPrompt(billDocId, billNumber) {
    var overlay = document.createElement('div');
    overlay.className = 'pharmacy-bill-pdf-prompt';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = '<div role="dialog" aria-modal="true" style="background:#fff;border-radius:12px;max-width:430px;width:100%;padding:26px;box-shadow:0 20px 55px rgba(0,0,0,.28);">'
        + '<div style="display:flex;align-items:center;gap:10px;color:#A61E4D;margin-bottom:10px;"><i class="fa-solid fa-circle-check" style="font-size:24px;"></i><h3 style="margin:0;font-size:18px;">Medicine dispensed</h3></div>'
        + '<p style="color:#475569;line-height:1.55;margin:0 0 20px;">Bill <strong></strong> is ready. Print or download the billing PDF now.</p>'
        + '<div style="display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;"><button type="button" class="pharmacy-bill-close" style="padding:9px 15px;background:#fff;border:1px solid #cbd5e1;border-radius:7px;cursor:pointer;">Close</button><button type="button" class="pharmacy-bill-gst" style="padding:9px 15px;background:#0D7A70;color:#fff;border:0;border-radius:7px;cursor:pointer;font-weight:600;"><i class="fa-solid fa-receipt"></i> GST invoice</button><button type="button" class="pharmacy-bill-print" style="padding:9px 15px;background:#D6336C;color:#fff;border:0;border-radius:7px;cursor:pointer;font-weight:600;"><i class="fa-solid fa-file-pdf"></i> Print billing PDF</button></div>'
        + '</div>';
    overlay.querySelector('strong').textContent = billNumber || billDocId;
    overlay.querySelector('.pharmacy-bill-close').onclick = function() { overlay.remove(); };
    overlay.querySelector('.pharmacy-bill-gst').onclick = function() { printPharmacyGstInvoice(billDocId); };
    overlay.querySelector('.pharmacy-bill-print').onclick = function() { generateBillPDF(billDocId); };
    overlay.onclick = function(event) { if (event.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
}

const pharmaSearchInput = document.getElementById('pharma_patientSearchInput');
if (pharmaSearchInput) {
    var debouncedSearchPharma = debounce(function(query) {
        searchPatient_pharma(query);
    }, 300);
    pharmaSearchInput.addEventListener('input', function() {
        debouncedSearchPharma(this.value.trim());
    });
}

// ==========================================
// PHARMACY BILLS REPORT
// The counter's own cash-up sheet, over the same date range the
// dispensing history is showing.
// ==========================================
document.getElementById('pharmacyBillsReportBtn') && document.getElementById('pharmacyBillsReportBtn').addEventListener('click', function () {
    var fromStr = (document.getElementById('histFromDate') || {}).value || '';
    var toStr = (document.getElementById('histToDate') || {}).value || '';
    if (!fromStr || !toStr) { showToast('Choose a from and to date first.', 'warning'); return; }

    var start = new Date(fromStr + 'T00:00:00');
    var end = new Date(toStr + 'T23:59:59.999');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        showToast('That date range is not valid.', 'warning');
        return;
    }

    var btn = this;
    btn.disabled = true;

    db.collection('bills')
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .get()
        .then(function (snap) {
            var bills = [];
            snap.forEach(function (d) {
                var b = d.data();
                var kind = String(b.billType || b.type || '').toUpperCase();
                var id = String(b.billId || '').toUpperCase();
                // Pharmacy counter sales and dispensing bills only.
                if (kind.indexOf('PHARM') === 0 || b.isCounterSale === true || id.indexOf('-PH-') !== -1) {
                    bills.push(b);
                }
            });
            bills.sort(function (a, b) {
                var ad = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(0);
                var bd = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(0);
                return ad - bd;
            });
            if (!bills.length) { showToast('No pharmacy bills in that date range.', 'warning'); return null; }
            return hmsBillsReportPDF({
                title: 'Pharmacy bills report',
                bills: bills,
                filterLabel: fromStr === toStr ? fromStr : (fromStr + ' to ' + toStr),
                filename: 'Pharmacy-Bills-' + fromStr + (fromStr === toStr ? '' : '_to_' + toStr)
            });
        })
        .catch(function (err) { showToast(err.message, 'error'); })
        .then(function () { btn.disabled = false; });
});

// ==========================================================
// GST RETAIL INVOICE (pharmacy)
//
// Matches the chemist bill the hospital supplied as the sample: HSN,
// schedule, manufacturer, batch and expiry per line, then a tax summary
// broken down by GST slab with CGST and SGST shown separately, the value
// in words, and the drug licence numbers in the header.
//
// Selling prices are GST-inclusive, which is how retail pharmacy pricing
// works in India — the taxable value is back-calculated per line in
// commitPharmacySale and stored on the bill, so what prints here is
// exactly what was recorded at the till.
// ==========================================================
function rupeesInWords(amount) {
    var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function twoDigit(n) {
        if (n < 20) return ONES[n];
        return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
    }
    function threeDigit(n) {
        var out = '';
        if (n >= 100) { out = ONES[Math.floor(n / 100)] + ' Hundred'; n = n % 100; if (n) out += ' '; }
        if (n) out += twoDigit(n);
        return out;
    }

    var whole = Math.floor(Math.abs(Number(amount) || 0));
    var paise = Math.round((Math.abs(Number(amount) || 0) - whole) * 100);
    if (whole === 0 && paise === 0) return 'Zero Rupees';

    // Indian numbering: crore, lakh, thousand, then the last three digits.
    var parts = [];
    var crore = Math.floor(whole / 10000000); whole = whole % 10000000;
    var lakh = Math.floor(whole / 100000); whole = whole % 100000;
    var thousand = Math.floor(whole / 1000); whole = whole % 1000;
    if (crore) parts.push(threeDigit(crore) + ' Crore');
    if (lakh) parts.push(threeDigit(lakh) + ' Lakh');
    if (thousand) parts.push(threeDigit(thousand) + ' Thousand');
    if (whole) parts.push(threeDigit(whole));

    var words = parts.join(' ').trim() + ' Rupees';
    if (paise) words += ' and ' + twoDigit(paise) + ' Paise';
    return words;
}
window.rupeesInWords = rupeesInWords;

function shortExpiry(value) {
    // Chemist bills show expiry as MM/YYYY.
    var s = String(value || '');
    var m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return m[2] + '/' + m[1];
    return s;
}

function printPharmacyGstInvoice(billDocId) {
    if (!billDocId) { showToast('No bill selected.', 'warning'); return; }

    Promise.all([
        db.collection('bills').doc(billDocId).get(),
        db.collection('hospitalSettings').doc('main').get()
    ]).then(function (res) {
        if (!res[0].exists) { showToast('Bill not found.', 'error'); return; }
        var bill = res[0].data();
        var s = res[1].exists ? res[1].data() : {};

        var lines = (bill.items || []).filter(function (i) {
            return String(i.category || '').toLowerCase() === 'medicine' || i.medicineName;
        });
        if (!lines.length) { showToast('This bill has no medicine lines.', 'warning'); return; }

        var slabs = bill.gstSummary && bill.gstSummary.length ? bill.gstSummary : null;
        if (!slabs) {
            // Older bills saved before GST capture — derive on the fly.
            var map = {};
            lines.forEach(function (l) {
                var rate = Number(l.gstRate || 0);
                var amt = Number(l.amount || 0);
                var taxable = Math.round((amt / (1 + rate / 100)) * 100) / 100;
                var tax = Math.round((amt - taxable) * 100) / 100;
                if (!map[rate]) map[rate] = { rate: rate, taxable: 0, cgst: 0, sgst: 0 };
                map[rate].taxable += taxable;
                map[rate].cgst += tax / 2;
                map[rate].sgst += tax / 2;
            });
            slabs = Object.keys(map).sort(function (a, b) { return a - b; }).map(function (k) { return map[k]; });
        }

        var subtotal = Number(bill.subtotal != null ? bill.subtotal : bill.grandTotal || 0);
        var discount = Number(bill.discountAmount || 0);
        var net = Number(bill.grandTotal || 0);
        var rounded = bill.roundedTotal != null ? Number(bill.roundedTotal) : Math.round(net);

        function cell(v) { return escapeHtml(v == null ? '' : String(v)); }
        function money2(v) { return Number(v || 0).toFixed(2); }

        var rows = lines.map(function (l, i) {
            return '<tr>'
                + '<td>' + (i + 1) + '</td>'
                + '<td>' + cell(l.hsnCode || '') + '</td>'
                + '<td class="name">' + cell(l.medicineName || l.description || '') + '</td>'
                + '<td>' + cell(l.schedule || '') + '</td>'
                + '<td>' + cell(l.manufacturer || '') + '</td>'
                + '<td>' + cell(l.batchNumber || '') + '</td>'
                + '<td>' + cell(shortExpiry(l.expiryDate)) + '</td>'
                + '<td class="r">' + cell(l.quantity || 0) + '</td>'
                + '<td class="r">' + money2(l.unitPrice) + '</td>'
                + '<td class="r">' + money2(l.amount) + '</td>'
                + '<td class="r">' + cell(Number(l.gstRate || 0)) + '</td>'
                + '</tr>';
        }).join('');

        var slabRows = [0, 5, 12, 18].map(function (rate) {
            var found = slabs.filter(function (x) { return Number(x.rate) === rate; })[0]
                || { taxable: 0, cgst: 0, sgst: 0 };
            return '<tr><td>' + rate + '%</td><td class="r">' + money2(found.taxable)
                + '</td><td class="r">' + money2(found.cgst) + '</td><td class="r">' + money2(found.sgst) + '</td></tr>';
        }).join('');

        var created = bill.createdAt && bill.createdAt.toDate ? bill.createdAt.toDate() : new Date();
        var licences = [s.drugLicenceNo1, s.drugLicenceNo2].filter(Boolean);

        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pharmacy Invoice '
            + cell(bill.billId || '') + '</title><style>'
            + 'body{font-family:"Courier New",monospace;font-size:11px;color:#000;margin:14px;}'
            + '.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}'
            + '.shop{font-size:17px;font-weight:700;letter-spacing:.5px}'
            + '.muted{font-size:10px;line-height:1.45}'
            + 'hr{border:none;border-top:1px dashed #000;margin:6px 0}'
            + 'table{width:100%;border-collapse:collapse}'
            + 'th,td{padding:2px 4px;text-align:left;font-size:10.5px}'
            + 'thead th{border-bottom:1px solid #000;font-weight:700}'
            + '.r{text-align:right}.name{max-width:150px}'
            + '.totals{display:flex;justify-content:space-between;gap:24px;margin-top:4px}'
            + '.tax th,.tax td{font-size:10px;padding:1px 6px}'
            + '.net{font-size:15px;font-weight:700}'
            + '.sign{margin-top:16px;display:flex;justify-content:space-between;font-size:10.5px}'
            + '.note{font-size:9.5px;margin-top:10px;line-height:1.5}'
            + '@media print{@page{size:A4;margin:8mm}.noprint{display:none}}'
            + '</style></head><body>'
            + '<p class="noprint" style="text-align:right"><button onclick="window.print()">Print</button></p>'
            + '<div class="hdr"><div>'
            + '<div class="shop">' + cell(s.hospitalName || 'Pharmacy') + '</div>'
            + '<div class="muted">' + cell(s.address || '') + '<br>PHONE : ' + cell(s.phone || '') + '</div>'
            + '</div><div class="muted">'
            + (s.gstin ? 'GSTIN &nbsp;: ' + cell(s.gstin) + '<br>' : '')
            + (licences.length ? 'D.L.No : ' + licences.map(cell).join('<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;') : '')
            + '</div></div><hr>'
            + '<div class="hdr"><div class="muted">'
            + 'Name &nbsp;&nbsp;: ' + cell(bill.patientName || 'Counter sale') + '<br>'
            + 'Doctor : ' + cell(bill.visitDoctor || (lines[0] && lines[0].orderedBy) || '') + '</div>'
            + '<div class="muted">Invoice: ' + cell(bill.billId || '') + ' &nbsp;&nbsp; Bill: ' + cell(bill.paymentMethod || 'Cash') + '<br>'
            + 'Date &nbsp;&nbsp;: ' + created.toLocaleDateString('en-GB') + ' &nbsp; ' + created.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            + '</div></div><hr>'
            + '<table><thead><tr><th>SL</th><th>HSN</th><th>Product Name</th><th>Sch</th><th>Mfg</th>'
            + '<th>Batch</th><th>Expiry</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th><th class="r">GST</th>'
            + '</tr></thead><tbody>' + rows + '</tbody></table><hr>'
            + '<div class="totals"><table class="tax" style="width:auto">'
            + '<thead><tr><th></th><th class="r">TAXABLE</th><th class="r">CGST</th><th class="r">SGST</th></tr></thead>'
            + '<tbody>' + slabRows + '</tbody></table>'
            + '<table class="tax" style="width:auto">'
            + '<tr><td>SubTotal</td><td class="r">' + money2(subtotal) + '</td></tr>'
            + '<tr><td>LESS DISCOUNT</td><td class="r">' + money2(discount) + '</td></tr>'
            + '<tr><td class="net">Net Payable</td><td class="r net">' + rounded.toFixed(2) + '</td></tr>'
            + '</table></div>'
            + '<div style="margin-top:6px">' + cell(rupeesInWords(rounded)) + '</div>'
            + '<div class="sign"><div></div><div>for ' + cell(s.hospitalName || '') + '</div></div>'
            + (s.pharmacyBillNote ? '<div class="note">' + cell(s.pharmacyBillNote) + '</div>' : '')
            + '<script>setTimeout(function(){window.print();},350);<\/script></body></html>';

        var w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) { showToast('Allow pop-ups to print the invoice.', 'warning'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
    }).catch(function (err) {
        console.error('GST invoice error:', err);
        showToast('Could not build the invoice: ' + err.message, 'error');
    });
}
window.printPharmacyGstInvoice = printPharmacyGstInvoice;

// ==========================================================
// MULTI-LINE GRN
//
// A supplier invoice normally carries many medicines. Recording one GRN per
// medicine would split a single invoice across several documents, so the
// invoice total, the payment status and the supplier ledger could never
// agree. Items are collected here first, then saved as one GRN whose
// `items[]` array holds every line.
// ==========================================================
var grnPendingItems = [];

function grnItemFieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
}

function grnComputeLine(qty, rate, discPct, gstPct) {
    var gross = qty * rate;
    var discountAmount = gross * (discPct || 0) / 100;
    var subtotal = gross - discountAmount;
    var taxAmount = subtotal * (gstPct || 0) / 100;
    return {
        gross: gross,
        discountAmount: Math.round(discountAmount * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        lineTotal: Math.round((subtotal + taxAmount) * 100) / 100
    };
}

function renderGrnItems() {
    var tbody = document.getElementById('grnItemsBody');
    var badge = document.getElementById('grnItemCountBadge');
    if (badge) badge.textContent = grnPendingItems.length;
    if (!tbody) return;

    if (!grnPendingItems.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#888;padding:14px;">No items added yet — fill the fields above and click <strong>Add item to this GRN</strong>.</td></tr>';
    } else {
        tbody.innerHTML = grnPendingItems.map(function (it, i) {
            return '<tr>'
                + '<td><strong>' + escapeHtml(it.medicineName) + '</strong>'
                + (it.manufacturer ? '<br><span style="font-size:11px;color:#64748b;">' + escapeHtml(it.manufacturer) + '</span>' : '')
                + '</td>'
                + '<td>' + escapeHtml(it.batchNumber) + '<br><span style="font-size:11px;color:#64748b;">' + escapeHtml(it.expiryDate) + '</span></td>'
                + '<td style="text-align:right;">' + it.quantityAdded + '</td>'
                + '<td style="text-align:right;">' + (it.freeQuantity || 0) + '</td>'
                + '<td style="text-align:right;">' + Number(it.purchasePrice).toFixed(2) + '</td>'
                + '<td style="text-align:right;">' + (it.discountPercent || 0) + '</td>'
                + '<td style="text-align:right;">' + (it.gstPercent || 0) + '</td>'
                + '<td style="text-align:right;"><strong>' + formatCurrency(it.lineTotal) + '</strong></td>'
                + '<td style="text-align:center;"><button type="button" class="btn-secondary btn-sm" onclick="removeGrnItem(' + i + ')" style="padding:2px 8px;font-size:11px;">Remove</button></td>'
                + '</tr>';
        }).join('');
    }

    var totals = grnPendingItems.reduce(function (acc, it) {
        acc.qty += Number(it.totalQuantityInwarded || 0);
        acc.sub += Number(it.subtotal || 0);
        acc.tax += Number(it.taxAmount || 0);
        acc.net += Number(it.lineTotal || 0);
        return acc;
    }, { qty: 0, sub: 0, tax: 0, net: 0 });

    var summary = document.getElementById('grnModalSummaryText');
    if (summary) {
        summary.textContent = grnPendingItems.length
            ? grnPendingItems.length + ' item(s) · ' + totals.qty + ' unit(s) · Subtotal ' + formatCurrency(totals.sub)
                + ' + GST ' + formatCurrency(totals.tax) + ' = Net Inward Value ' + formatCurrency(totals.net)
            : 'Net Inward Value: ₹0.00';
    }
}
window.renderGrnItems = renderGrnItems;

function removeGrnItem(index) {
    grnPendingItems.splice(index, 1);
    renderGrnItems();
}
window.removeGrnItem = removeGrnItem;

function clearGrnItemFields() {
    ['grnModalMedSearch', 'grnModalMedId', 'grnModalBatch', 'grnModalExpiry', 'grnModalQty',
     'grnModalPurchaseRate', 'grnModalMrp', 'grnModalGeneric', 'grnModalBrand',
     'grnModalManufacturer', 'grnModalRack'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });
    var free = document.getElementById('grnModalFreeQty'); if (free) free.value = '0';
    var disc = document.getElementById('grnModalDiscount'); if (disc) disc.value = '0';
    var total = document.getElementById('grnModalTotal'); if (total) total.value = '₹0.00';
    var search = document.getElementById('grnModalMedSearch'); if (search) search.focus();
}

function addGrnItem() {
    var medName = grnItemFieldValue('grnModalMedSearch');
    var batch = grnItemFieldValue('grnModalBatch');
    var expiry = grnItemFieldValue('grnModalExpiry');
    var qty = parseFloat(grnItemFieldValue('grnModalQty')) || 0;
    var rate = parseFloat(grnItemFieldValue('grnModalPurchaseRate')) || 0;

    if (!medName || !batch || !expiry || qty <= 0 || rate <= 0) {
        showToast('Enter medicine, batch, expiry, quantity and purchase rate before adding the item.', 'warning');
        return;
    }
    if (expiry <= todayIso()) {
        showToast('That batch is already expired — it cannot be received into stock.', 'warning');
        return;
    }

    var freeQty = parseFloat(grnItemFieldValue('grnModalFreeQty')) || 0;
    var discPct = parseFloat(grnItemFieldValue('grnModalDiscount')) || 0;
    var gstPct = parseFloat(grnItemFieldValue('grnModalGst')) || 0;
    var line = grnComputeLine(qty, rate, discPct, gstPct);

    // Same medicine and batch twice on one invoice is almost always a slip.
    var clash = grnPendingItems.filter(function (it) {
        return it.medicineName.toLowerCase() === medName.toLowerCase()
            && it.batchNumber.toLowerCase() === batch.toLowerCase();
    })[0];
    if (clash && !confirm(medName + ' batch ' + batch + ' is already on this GRN.\n\nAdd it again as a separate line?')) return;

    grnPendingItems.push({
        medicineId: grnItemFieldValue('grnModalMedId'),
        medicineName: medName,
        genericName: grnItemFieldValue('grnModalGeneric'),
        brand: grnItemFieldValue('grnModalBrand'),
        manufacturer: grnItemFieldValue('grnModalManufacturer'),
        rackLocation: grnItemFieldValue('grnModalRack'),
        batchNumber: batch,
        expiryDate: expiry,
        quantityAdded: qty,
        freeQuantity: freeQty,
        totalQuantityInwarded: qty + freeQty,
        purchasePrice: rate,
        mrp: parseFloat(grnItemFieldValue('grnModalMrp')) || rate,
        discountPercent: discPct,
        discountAmount: line.discountAmount,
        gstPercent: gstPct,
        subtotal: line.subtotal,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal
    });

    renderGrnItems();
    clearGrnItemFields();
    showToast('Item added. Continue with the next medicine on this invoice.', 'success');
}
window.addGrnItem = addGrnItem;

var btnAddGrnItem = document.getElementById('btnAddGrnItem');
if (btnAddGrnItem) btnAddGrnItem.addEventListener('click', addGrnItem);
