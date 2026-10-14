checkAccess(['receptionist', 'billing_staff', 'admin']);

let currentUserEmail = '';
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    
    // Auto calculate IPD bed charges (PART 3)
    if (typeof updateDailyBedCharges === 'function') {
        updateDailyBedCharges();
    }
    
    loadBills();
    loadUnbilledReports(); // Part 5 Requirement
    populateDeptSelect('billing_deptSelect');
    
    // Update Bill No Preview span on page load (Minor Fix 17)
    const billNoPrev = document.getElementById('billNoPreview');
    if (billNoPrev) {
        billNoPrev.textContent = 'SA-OPD-' + new Date().getFullYear() + '-XXXXX';
    }

    // Debounced patient search (Improvement B)
    const searchBillingInput = document.getElementById('billing_patientSearchInput');
    if (searchBillingInput) {
        var debouncedSearchBilling = debounce(function(query) {
            searchPatient_billing(query);
        }, 300);
        searchBillingInput.addEventListener('input', function() {
            debouncedSearchBilling(this.value.trim());
        });
    }
    
    // Load hospital settings
    db.collection('hospitalSettings').doc('main').get().then(doc => {
        if (doc.exists) {
            const data = doc.data();
            document.getElementById('printHsName').textContent = data.hospitalName || data.name || 'Jyothsna Maternity Hospital';
            document.getElementById('printHsAddress').textContent = data.address || '';
            document.getElementById('printHsPhone').textContent = data.phone || '';
            document.getElementById('printHsGstin').textContent = data.gstin || '';
        }
    }).catch(err => console.error(err));

    // Handle URL parameters for patient profile integration
    var urlParams = new URLSearchParams(window.location.search);
    var autoOpen = urlParams.get('autoOpen');
    var prefilledPatientId = urlParams.get('patientId');
    var urlAdmitBillId = urlParams.get('admitBillId');
    var urlMoveERBillId = urlParams.get('moveERBillId');
    
    if (autoOpen === 'true') {
        // Auto open the New Bill modal
        var newBillModal = document.getElementById('newBillModal');
        if (newBillModal) {
            newBillModal.classList.add('active');
            newBillModal.style.display = 'flex';
        }

        // If patientId provided, auto-search and select that patient
        if (prefilledPatientId) {
            firebase.firestore().collection('patients')
            .where('patientId', '==', prefilledPatientId)
            .get()
            .then(function(snap) {
                if (!snap.empty) {
                    var doc = snap.docs[0];
                    var patient = doc.data();
                    // Pre-fill patient search input
                    document.getElementById('billing_patientSearchInput').value = patient.name + ' — ' + patient.patientId;
                    // Set selected patient
                    selectedPatient_billing = {
                        docId: doc.id,
                        patientId: patient.patientId,
                        name: patient.name,
                        doctor: patient.doctor || patient.doctorName || patient.assignedDoctor || '',
                        department: patient.department || '',
                        phone: patient.phone || '',
                        age: patient.age || '',
                        gender: patient.gender || ''
                    };
                    // Show patient card
                    document.getElementById('billing_cardPatientName').textContent = patient.name;
                    document.getElementById('billing_cardPatientId').textContent = patient.patientId;
                    document.getElementById('billing_cardAgeGender').textContent = (patient.age || '—') + ' / ' + (patient.gender || '—');
                    document.getElementById('billing_selectedPatientCard').style.display = 'block';
                    // Load doctors dropdown with patient's doctor pre-selected
                    if (typeof loadDoctors_billing === 'function') {
                        loadDoctors_billing(patient.doctor || patient.doctorName || patient.assignedDoctor || '');
                    }
                    // Set department
                    var deptSelect = document.getElementById('billing_deptSelect');
                    if (deptSelect) deptSelect.value = patient.department || '';
                }
            });
        }
    } else if (prefilledPatientId) {
        db.collection('patients').where('patientId', '==', prefilledPatientId).get().then(snap => {
            if (!snap.empty) {
                var doc = snap.docs[0];
                var p = doc.data();
                var mockEl = {
                    dataset: {
                        docid: doc.id,
                        patientid: p.patientId || '',
                        name: p.name || '',
                        doctor: p.doctorId || p.doctorName || p.doctor || p.assignedDoctor || '',
                        dept: p.department || '',
                        phone: p.phone || '',
                        age: p.age || '',
                        gender: p.gender || ''
                    }
                };
                setTimeout(() => {
                    if (typeof selectPatient_billing === 'function') {
                        selectPatient_billing(mockEl);
                        showToast('Patient auto-selected for billing.', 'success');
                    }
                }, 1000);
            }
        });
    }

    if (urlAdmitBillId) {
        setTimeout(() => {
            if (typeof openAdmitToIPDModal === 'function') {
                openAdmitToIPDModal(urlAdmitBillId);
            }
        }, 1200);
    } else if (urlMoveERBillId) {
        setTimeout(() => {
            if (typeof openMoveToERModal === 'function') {
                openMoveToERModal(urlMoveERBillId);
            }
        }, 1200);
    }
});

let allBills = [];
let allUnbilledReports = [];
var selectedPatient_billing = null;

// ==========================================
// 1. BILL LIST & FILTERING LOGIC
// ==========================================
var unsubscribeBills = null;
function loadBills() {
    if (unsubscribeBills) unsubscribeBills(); // Unsubscribe previous listener
    unsubscribeBills = db.collection("bills").orderBy("createdAt", "desc").onSnapshot(snapshot => {
        allBills = [];
        snapshot.forEach(doc => {
            var data = doc.data() || {};
            var billId = data.billId || data.billNumber || data.billNo || ('BILL-' + doc.id.slice(-6).toUpperCase());
            var grandTotal = Number(data.grandTotal != null ? data.grandTotal : (data.totalAmount != null ? data.totalAmount : (data.total != null ? data.total : (data.subtotal || 0))));
            var balanceDue = Number(data.balanceDue != null ? data.balanceDue : (data.dueAmount != null ? data.dueAmount : 0));
            var billType = data.type || data.billType || 'OPD';
            
            // Asynchronous self-heal for older incomplete records
            if (!data.billId || data.grandTotal == null || !data.type) {
                db.collection("bills").doc(doc.id).update({
                    billId: billId,
                    billNumber: billId,
                    billNo: billId,
                    grandTotal: grandTotal,
                    totalAmount: grandTotal,
                    balanceDue: balanceDue,
                    type: billType
                }).catch(function() {});
            }

            allBills.push({
                id: doc.id,
                ...data,
                billId: billId,
                billNumber: billId,
                billNo: billId,
                grandTotal: grandTotal,
                balanceDue: balanceDue,
                type: billType
            });
        });
        
        // Update stats bar (FIX 6)
        updateBillingStatsBar(allBills);
        
        var urlParams = new URLSearchParams(window.location.search);
        var filterParam = urlParams.get('filter');
        if (filterParam === 'running') {
            const running = allBills.filter(b => b.isRunningBill === true && b.isFinalized === false);
            renderBills(running);
            
            // Activate today-collections active status (visual hint)
            document.querySelectorAll('#billFilters .filter-btn').forEach(btn => btn.classList.remove('active'));
        } else {
            filterAndSearch(document.getElementById('billSearch').value.toLowerCase(), getCurrentFilter());
        }
    }, error => {
        console.error("Error fetching bills:", error);
        var tbody = document.getElementById('billsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--error-color);">Unable to load bills: ' + escapeHtml(error.message || 'Please check your sign-in and Firestore rules.') + '</td></tr>';
        }
        showToast('Unable to load bills. Check your sign-in and deployed Firestore rules.', 'error');
    });
}
window.addEventListener('beforeunload', function() {
    if (unsubscribeBills) unsubscribeBills();
});

// Shared badge vocabulary lives in helpers.js so billing, patients,
// appointments and the profile all render a state identically.
function getPaymentStatusBadge(status) {
    return statusBadge(status, 'unpaid');
}

function getPaymentBadge(status) {
    return getPaymentStatusBadge(status);
}

function getReportStatusBadge(status) {
    return statusBadge(status, 'not_applicable');
}

// Stats summary bar calculation (FIX 6)
function updateBillingStatsBar(bills) {
    const todayStr = todayIso();
    let todayBillsCount = 0;
    let todayCollections = 0;
    let pendingPayments = 0;
    let activeIPDCount = 0;

    bills.forEach(b => {
        const createdAt = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : null;
        const isToday = createdAt && isoDate(createdAt) === todayStr;

        if (isToday) {
            todayBillsCount++;
            if (b.paymentDetails) {
                Object.keys(b.paymentDetails).forEach(method => {
                    todayCollections += parseFloat(b.paymentDetails[method].amount) || 0;
                });
            } else {
                const amt = (b.grandTotal || 0) - (b.balanceDue || 0);
                if (amt > 0) todayCollections += amt;
            }
        }

        const ps = (b.paymentStatus || '').toLowerCase();
        if (ps === 'unpaid' || ps === 'partial') {
            pendingPayments += parseFloat(b.balanceDue) || 0;
        }

        if ((b.type === 'IPD' || b.type === 'ICU' || b.type === 'OT') && b.isRunningBill === true && !b.isFinalized) {
            activeIPDCount++;
        }
    });

    const elTodayBills = document.getElementById('statTodayBills');
    const elTodayCollections = document.getElementById('statTodayCollections');
    const elPendingPayments = document.getElementById('statPendingPayments');
    const elActiveIPD = document.getElementById('statActiveIPD');

    if (elTodayBills) elTodayBills.textContent = todayBillsCount.toLocaleString();
    if (elTodayCollections) elTodayCollections.textContent = formatCurrency(todayCollections);
    if (elPendingPayments) elPendingPayments.textContent = formatCurrency(pendingPayments);
    if (elActiveIPD) elActiveIPD.textContent = activeIPDCount.toLocaleString();
}

function renderBills(billsToRender) {
    const tbody = document.getElementById("billsTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    if (billsToRender.length === 0) {
        setEmptyRow('billsTableBody', 'No bills found matching current filters.', 8);
        return;
    }

    billsToRender.forEach(bill => {
        const tr = document.createElement("tr");
        
        // The visit type reuses the shared badge vocabulary, so an OPD bill
        // here looks like an OPD patient everywhere else in the app.
        const typeBadge = statusBadge(bill.type || 'opd');

        // Outstanding balance is the number the front desk is actually
        // looking for, so it gets its own column rather than a footnote.
        const balance = Number(bill.balanceDue || 0);
        const balanceCell = balance > 0
            ? `<span class="due-amount">${formatCurrency(balance)}</span>`
            : `<span class="due-amount settled">${formatCurrency(0)}</span>`;

        tr.innerHTML = `
            <td data-label="Bill No"><strong class="nowrap">${escapeHtml(bill.billId || bill.billNumber || bill.billNo || 'BILL')}</strong><span class="cell-sub">${typeBadge}</span></td>
            <td data-label="Patient"><a href="patient-profile.html?id=${bill.patientId || ''}" style="color:var(--primary-teal); font-weight:600; text-decoration:none;"><i class="fa-solid fa-user" style="font-size:0.8rem; margin-right:4px;"></i>${bill.patientName || '-'}</a><span class="cell-sub">ID: ${bill.patientId || '-'}</span></td>
            <td data-label="Amount" class="num"><strong>${formatCurrency(bill.grandTotal)}</strong></td>
            <td data-label="Balance" class="num">${balanceCell}</td>
            <td data-label="Payment">${getPaymentStatusBadge(bill.paymentStatus || bill.status)}</td>
            <td data-label="Report">${getReportStatusBadge(bill.reportStatus)}</td>
            <td data-label="Date">${formatDate(bill.createdAt)}</td>
            <td data-label="Actions" class="actions"><div>
                <button class="btn-secondary btn-sm manage-btn" onclick="event.stopPropagation(); window.openManageMenu(this, '${bill.id}')"><i class="fa-solid fa-ellipsis-vertical"></i> Manage</button>
            </div></td>
        `;
        tbody.appendChild(tr);
    });
}

// Context-sensitive dropdown actions (FIX 1)
let currentOpenMenu = null;

function openManageMenu(buttonEl, billId) {
    closeActiveMenu();

    const bill = allBills.find(b => b.id === billId);
    if (!bill) return;

    const rect = buttonEl.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'manage-dropdown-menu';
    dropdown.style.cssText = `
        position: fixed;
        top: ${rect.bottom}px;
        left: ${rect.left}px;
        background: white;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        z-index: 99999;
        display: flex;
        flex-direction: column;
        min-width: 180px;
        padding: 6px 0;
    `;

    const actions = [];
    const isRunning = bill.isRunningBill && !bill.isFinalized;
    
    if (isRunning) {
        actions.push({
            html: '<i class="fa-solid fa-chart-line" style="color:#7C3AED; width: 16px;"></i> Running Bill',
            onclick: () => openRunningBillModal(bill)
        });
    } else {
        actions.push({
            html: '<i class="fa-solid fa-eye" style="color:#0D7A70; width: 16px;"></i> View Bill',
            onclick: () => openViewBillModal(bill)
        });
    }

    actions.push({
        html: '<i class="fa-solid fa-file-prescription" style="color:#0D7A70; width: 16px;"></i> OP Bill / Rx (Bilingual)',
        onclick: () => generateClinicalOPBillPDF(bill.id, { bill: bill })
    });

    actions.push({
        html: '<i class="fa-solid fa-file-pdf" style="color:#DC2626; width: 16px;"></i> Download PDF',
        onclick: () => generateBillPDF(bill.id)
    });

    if ((bill.type === 'IPD' || bill.type === 'ICU') && bill.isFinalized) {
        actions.push({
            html: '<i class="fa-solid fa-file-lines" style="color:#1E3A8A; width: 16px;"></i> Summary PDF',
            onclick: () => generateDischargeSummaryPDF(bill.id)
        });
    }

    const payStat = (bill.paymentStatus || 'unpaid').toLowerCase();
    if (payStat === 'unpaid' || payStat === 'partial') {
        actions.push({
            html: '<i class="fa-solid fa-indian-rupee-sign" style="color:#10B981; width: 16px;"></i> Record Payment',
            onclick: () => openRecordPaymentModal(bill.id)
        });
        actions.push({
            html: '<i class="fa-solid fa-credit-card" style="color:#2563EB; width: 16px;"></i> Pay Online',
            onclick: () => startRazorpayBillPayment(bill)
        });
    }

    if (isRunning) {
        actions.push({
            html: '<i class="fa-solid fa-plus" style="color:#0D7A70; width: 16px;"></i> Add Charge',
            onclick: () => openAddChargeModal(bill.id)
        });
    }

    if (bill.type === 'OT' && !bill.isFinalized) {
        actions.push({
            html: '<i class="fa-solid fa-circle-check" style="color:#0D7A70; width: 16px;"></i> Complete Procedure',
            onclick: () => openCompleteOTModal(bill)
        });
    }

    // Cancel / refund. A cancelled bill stays in the register, so the
    // only follow-up action offered on it is a refund of money already
    // collected. Age and role limits are enforced in canModifyBill().
    const isCancelled = String(bill.status || '').toLowerCase() === 'cancelled';
    const collected = Number(bill.amountPaid || 0) - Number(bill.refundedAmount || 0);

    if (!isCancelled) {
        actions.push({
            html: '<i class="fa-solid fa-ban" style="color:#dc2626; width: 16px;"></i> Cancel Bill',
            onclick: () => openBillActionModal(bill.id, 'cancel')
        });
    }
    if (collected > 0) {
        actions.push({
            html: '<i class="fa-solid fa-rotate-left" style="color:#b45309; width: 16px;"></i> Refund',
            onclick: () => openBillActionModal(bill.id, 'refund')
        });
    }

    const type = (bill.type || '').toUpperCase();
    if (type === 'OPD') {
        if (!bill.transferredTo) {
            actions.push({
                html: '<i class="fa-solid fa-bed-pulse" style="color:#2563eb; width: 16px;"></i> Admit IPD',
                onclick: () => openAdmitToIPDModal(bill.id)
            });
            actions.push({
                html: '<i class="fa-solid fa-truck-medical" style="color:#dc2626; width: 16px;"></i> Move ER',
                onclick: () => openMoveToERModal(bill.id)
            });
            actions.push({
                html: '<i class="fa-solid fa-hospital-user" style="color:#0D7A70; width: 16px;"></i> Move to OT',
                onclick: () => openMoveToOTModal(bill.id)
            });
        }
    } else if (type === 'ER') {
        if (!bill.transferredTo) {
            actions.push({
                html: '<i class="fa-solid fa-heart-pulse" style="color:#7c3aed; width: 16px;"></i> Transfer ICU',
                onclick: () => openTransferToICUModal(bill.id)
            });
            actions.push({
                html: '<i class="fa-solid fa-hospital-user" style="color:#0D7A70; width: 16px;"></i> Move to OT',
                onclick: () => openMoveToOTModal(bill.id)
            });
        }
    } else if ((type === 'IPD' || type === 'ICU') && bill.bedNumber && !bill.isIPDClosed && !bill.isFinalized) {
        actions.push({
            html: '<i class="fa-solid fa-right-from-bracket" style="color:#ca8a04; width: 16px;"></i> Discharge',
            onclick: () => openDischargeModal(bill.id)
        });
        actions.push({
            html: '<i class="fa-solid fa-hospital-user" style="color:#0D7A70; width: 16px;"></i> Move to OT',
            onclick: () => openMoveToOTModal(bill.id)
        });
    }

    actions.push({
        html: '<i class="fa-brands fa-whatsapp" style="color:#25D366; width: 16px;"></i> WhatsApp Bill',
        onclick: () => {
            if (typeof sendBillViaWhatsApp === 'function') sendBillViaWhatsApp(bill.id);
            else showToast('WhatsApp send is not available on this page.', 'warning');
        }
    });

    actions.push({
        html: '<i class="fa-solid fa-user" style="color:#64748B; width: 16px;"></i> Patient Profile',
        onclick: () => window.location.href = `patient-profile.html?id=${bill.patientId}`
    });

    actions.forEach(action => {
        const item = document.createElement('button');
        item.innerHTML = action.html;
        item.style.cssText = `
            border: none;
            background: none;
            padding: 10px 16px;
            text-align: left;
            font-size: 13px;
            font-weight: 500;
            color: #334155;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            transition: background 0.15s;
        `;
        item.onmouseover = () => item.style.backgroundColor = '#f1f5f9';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';
        item.onclick = (e) => {
            e.stopPropagation();
            closeActiveMenu();
            action.onclick();
        };
        dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);
    currentOpenMenu = dropdown;

    const dropRect = dropdown.getBoundingClientRect();
    // Keep menu on-screen: flip up and/or align to the right edge of the button
    var left = rect.right - dropRect.width;
    if (left < 8) left = 8;
    if (left + dropRect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - dropRect.width - 8);
    dropdown.style.left = left + 'px';
    if (dropRect.bottom > window.innerHeight - 8) {
        dropdown.style.top = Math.max(8, rect.top - dropRect.height) + 'px';
    }
}
window.openManageMenu = openManageMenu;

function closeActiveMenu() {
    if (currentOpenMenu) {
        currentOpenMenu.remove();
        currentOpenMenu = null;
    }
}

// Collapsible Unbilled Card toggle
document.addEventListener('DOMContentLoaded', () => {
    const toggleHeader = document.getElementById('toggleUnbilledHeader');
    if (toggleHeader) {
        toggleHeader.addEventListener('click', function() {
            const content = document.getElementById('unbilledChargesContent');
            const icon = document.getElementById('unbilledToggleIcon');
            if (content) {
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    if (icon) icon.style.transform = 'rotate(180deg)';
                } else {
                    content.style.display = 'none';
                    if (icon) icon.style.transform = 'rotate(0deg)';
                }
            }
        });
    }
});

document.addEventListener('click', (e) => {
    if (currentOpenMenu && !e.target.closest('.manage-dropdown-menu') && !e.target.closest('.manage-btn')) {
        closeActiveMenu();
    }
});
window.addEventListener('scroll', closeActiveMenu, true);
window.addEventListener('resize', closeActiveMenu);

// Search and Filter tabs
document.getElementById('billSearch').addEventListener('input', function(e) {
    filterAndSearch(e.target.value.toLowerCase(), getCurrentFilter());
});

document.querySelectorAll('#billFilters .filter-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        document.querySelectorAll('#billFilters .filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        filterAndSearch(document.getElementById('billSearch').value.toLowerCase(), e.target.dataset.filter);
    });
});

function getCurrentFilter() {
    const activeBtn = document.querySelector('#billFilters .filter-btn.active');
    return activeBtn ? activeBtn.dataset.filter : 'Today';
}

function filterAndSearch(query, filterType) {
    let filtered = allBills;
    filterType = filterType || 'Today';
    
    if (filterType !== 'all') {
        if (filterType === 'Unpaid') {
            filtered = filtered.filter(b => {
                var ps = (b.paymentStatus || 'unpaid').toLowerCase();
                return ps !== 'paid' && ps !== 'cancelled';
            });
        } else if (filterType === 'Today') {
            const todayStr = todayIso ? todayIso() : todayIso();
            filtered = filtered.filter(b => {
                if (b.billDate && String(b.billDate).slice(0, 10) === todayStr) return true;
                if (!b.createdAt) return false;
                const d = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                return isoDate(d) === todayStr;
            });
        } else if (filterType === 'IPD') {
            filtered = filtered.filter(b => b.isRunningBill === true && b.isFinalized === false);
        } else {
            filtered = filtered.filter(b => (b.type || b.billType) === filterType);
        }
    }
    
    if (query) {
        filtered = filtered.filter(b => 
            (b.billId && b.billId.toLowerCase().includes(query)) ||
            (b.patientName && b.patientName.toLowerCase().includes(query)) ||
            (b.patientId && b.patientId.toLowerCase().includes(query)) ||
            (b.patientPhone && b.patientPhone.includes(query))
        );
    }

    var title = document.getElementById('billingDeskTitle');
    if (title) {
        var labels = { Today: "Today's bills", Unpaid: 'Unpaid / due', IPD: 'Active IPD bills', OPD: 'OPD bills', ER: 'ER bills' };
        title.textContent = labels[filterType] || 'Bills';
    }
    
    renderBills(filtered);
}

window.openBillHistory = function () {
    document.getElementById('billHistoryOverlay').classList.add('open');
    document.getElementById('billHistoryDrawer').classList.add('open');
    renderBillHistoryList();
};
window.closeBillHistory = function () {
    document.getElementById('billHistoryOverlay').classList.remove('open');
    document.getElementById('billHistoryDrawer').classList.remove('open');
};
function renderBillHistoryList() {
    var q = ((document.getElementById('billHistorySearch') || {}).value || '').toLowerCase().trim();
    var list = allBills.slice();
    if (q) {
        list = list.filter(function (b) {
            return (b.billId && b.billId.toLowerCase().includes(q))
                || (b.patientName && b.patientName.toLowerCase().includes(q))
                || (b.patientId && b.patientId.toLowerCase().includes(q));
        });
    }
    var box = document.getElementById('billHistoryList');
    if (!box) return;
    if (!list.length) {
        box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">No bills in history.</div>';
        return;
    }
    box.innerHTML = list.slice(0, 200).map(function (b) {
        return '<div style="padding:12px 0;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;gap:10px;">'
            + '<div><strong>' + escapeHtml(b.billId || '') + '</strong>'
            + '<div style="font-size:12px;color:#64748b;">' + escapeHtml(b.patientName || '') + ' · ' + escapeHtml(b.patientId || '') + '</div>'
            + '<div style="margin-top:4px;">' + statusBadge(b.paymentStatus || 'unpaid') + ' · ' + formatCurrency(b.grandTotal || 0) + '</div></div>'
            + '<button type="button" class="btn-secondary btn-xs" onclick="closeBillHistory(); document.getElementById(\'billSearch\').value=\'' + String(b.billId || '').replace(/'/g, '') + '\'; filterAndSearch(\'' + String(b.billId || '').toLowerCase().replace(/'/g, '') + '\', \'all\');">Open</button></div>';
    }).join('');
}
document.addEventListener('DOMContentLoaded', function () {
    var hist = document.getElementById('btnBillHistory');
    if (hist) hist.addEventListener('click', openBillHistory);
    var hs = document.getElementById('billHistorySearch');
    if (hs) hs.addEventListener('input', renderBillHistoryList);
});

// ==========================================
// 2. UNBILLED REPORTS QUEUE (PART 5)
// ==========================================
function loadUnbilledReports() {
    db.collection('reports')
        .where('billingStatus', '==', 'unbilled')
        .onSnapshot(snapshot => {
            allUnbilledReports = [];
            const tbody = document.getElementById('unbilledChargesTableBody');
            if (!tbody) return;
            
            tbody.innerHTML = '';
            var container = document.getElementById('unbilledChargesContainer');
            var badge = document.getElementById('unbilledCountBadge');
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 15px;">No unbilled lab/scan charges found.</td></tr>';
                if (container) container.style.display = 'none';
                if (badge) badge.textContent = '0';
                return;
            }
            if (container) container.style.display = 'block';
            if (badge) badge.textContent = String(snapshot.size);
            
            snapshot.forEach(doc => {
                const rep = { id: doc.id, ...doc.data() };
                allUnbilledReports.push(rep);
                
                const dateVal = rep.reportDate || (rep.createdAt ? formatDate(rep.createdAt) : '—');
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${rep.reportId || rep.id.substring(0, 8)}</strong></td>
                    <td>${rep.patientName || '—'}</td>
                    <td><span style="font-weight:500;">${rep.testName || '—'}</span> <small style="color:#666; text-transform:uppercase;">(${rep.type || ''})</small></td>
                    <td><strong>${formatCurrency(rep.totalAmount || rep.amount || 0)}</strong></td>
                    <td>${dateVal}</td>
                    <td>
                        <button onclick="openLinkReportModal('${rep.id}')" class="btn-primary" style="padding: 4px 10px; font-size: 0.8rem; background: var(--primary-teal); border-color: var(--primary-teal); display:flex; align-items:center; gap:4px;">
                            <i class="fa-solid fa-plus"></i> Add to Bill
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }, err => {
            console.error("Error loading unbilled reports:", err);
            const tbody = document.getElementById('unbilledChargesTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--error-color);padding:15px;">Unable to load unbilled charges: ' + escapeHtml(err.message || 'Check Firestore access.') + '</td></tr>';
            showToast('Unable to load unbilled charges. Check Firestore access.', 'error');
        });
}

function openLinkReportModal(docId) {
    const report = allUnbilledReports.find(r => r.id === docId);
    if (!report) return;
    
    document.getElementById('linkReportDocId').value = docId;
    document.getElementById('linkReportPatientId').value = report.patientId;
    document.getElementById('linkPatientName').textContent = report.patientName;
    document.getElementById('linkTestName').textContent = report.testName;
    document.getElementById('linkTestAmount').textContent = formatCurrency(report.totalAmount || report.amount || 0);
    
    // Load patient open bills into select dropdown
    const select = document.getElementById('linkBillSelect');
    select.innerHTML = '<option value="">Searching open bills...</option>';
    
    db.collection('bills')
        .where('patientId', '==', report.patientId)
        .get()
        .then(snap => {
            select.innerHTML = '';
            // Open bills are not paid
            const openBills = [];
            snap.forEach(d => {
                const b = d.data();
                const ps = (b.paymentStatus || b.status || '').toLowerCase();
                if (ps !== 'paid') {
                    openBills.push({ docId: d.id, ...b });
                }
            });
            
            if (openBills.length === 0) {
                select.innerHTML = '<option value="">No open/unpaid bills found for this patient.</option>';
                document.getElementById('confirmLinkBillBtn').disabled = true;
            } else {
                openBills.forEach(b => {
                    const opt = document.createElement('option');
                    opt.value = b.docId;
                    opt.textContent = `${b.billId} (${b.type}) - Bal: ₹${(b.balanceDue || 0).toFixed(2)} - Total: ₹${(b.grandTotal || 0).toFixed(2)}`;
                    select.appendChild(opt);
                });
                document.getElementById('confirmLinkBillBtn').disabled = false;
            }
            
            document.getElementById('linkBillModal').style.display = 'flex';
        })
        .catch(err => {
            console.error(err);
            showToast("Failed to fetch patient bills.", "error");
        });
}
window.openLinkReportModal = openLinkReportModal;

// Modal triggers for bill linker
document.getElementById('closeLinkBillModalBtn') && document.getElementById('closeLinkBillModalBtn').addEventListener('click', () => {
    document.getElementById('linkBillModal').style.display = 'none';
});
document.getElementById('cancelLinkBillBtn') && document.getElementById('cancelLinkBillBtn').addEventListener('click', () => {
    document.getElementById('linkBillModal').style.display = 'none';
});

document.getElementById('confirmLinkBillBtn') && document.getElementById('confirmLinkBillBtn').addEventListener('click', async () => {
    const reportDocId = document.getElementById('linkReportDocId').value;
    const billDocId = document.getElementById('linkBillSelect').value;
    
    if (!reportDocId || !billDocId) {
        showToast("Please select a bill to link.", "warning");
        return;
    }
    
    const confirmBtn = document.getElementById('confirmLinkBillBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Linking...";
    
    try {
        const reportSnap = await db.collection('reports').doc(reportDocId).get();
        if (!reportSnap.exists) { showToast("Report not found.", "error"); return; }
        const report = reportSnap.data();
        const amt = report.totalAmount || report.amount || 0;
        
        const billSnap = await db.collection('bills').doc(billDocId).get();
        if (!billSnap.exists) { showToast("Bill not found.", "error"); return; }
        const bill = billSnap.data();
        
        // Construct new charge item
        const newChargeItem = {
            category: report.type === 'imaging' ? 'Imaging' : 'Lab Test',
            description: report.testName,
            orderedBy: report.referredBy || '',
            quantity: 1,
            unitPrice: amt,
            amount: amt
        };
        
        // Recalculate bill totals
        const updatedItems = [...(bill.items || []), newChargeItem];
        const subtotal = updatedItems.reduce((sum, item) => sum + item.amount, 0);
        const discountAmt = subtotal * ((bill.discountPercent || 0) / 100);
        const afterDiscount = subtotal - discountAmt;
        const gstAmt = afterDiscount * ((bill.gstPercent || 0) / 100);
        const grandTotal = afterDiscount + gstAmt;
        
        // Sum payment methods
        let paymentMethodsSum = 0;
        if (bill.paymentDetails) {
            Object.keys(bill.paymentDetails).forEach(method => {
                paymentMethodsSum += bill.paymentDetails[method].amount || 0;
            });
        }
        
        const balanceDue = grandTotal - (bill.advancePaid || 0) - paymentMethodsSum;
        
        let newStatus = (bill.status || '').toLowerCase();
        if (newStatus !== 'draft') {
            if (balanceDue <= 0) newStatus = 'paid';
            else if (balanceDue < grandTotal) newStatus = 'partial';
            else newStatus = 'due';
        }
        
        const updatedBillData = {
            items: updatedItems,
            subtotal: subtotal,
            discountAmount: discountAmt,
            gstAmount: gstAmt,
            grandTotal: grandTotal,
            balanceDue: balanceDue,
            status: newStatus,
            paymentStatus: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        const batch = db.batch();
        
        // 1. Update report status to billed
        batch.update(db.collection('reports').doc(reportDocId), {
            billingStatus: 'billed',
            linkedBillId: bill.billId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // 2. Update bill details globally
        batch.update(db.collection('bills').doc(billDocId), updatedBillData);
        
        // 3. Update bill in patient subcollection
        batch.update(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billDocId), updatedBillData);
        
        // 4. Audit Log
        batch.set(db.collection('auditLog').doc(), {
            billId: bill.billId,
            patientId: bill.patientId,
            action: "charge_linked",
            reportId: report.reportId || reportDocId,
            staffEmail: currentUserEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await batch.commit();
        
        showToast("Charge linked and bill recalculated successfully!", "success");
        document.getElementById('linkBillModal').style.display = 'none';
        loadBills(); // Refresh list
    } catch (err) {
        console.error("Error linking report:", err);
        showToast("Error linking charge: " + err.message, "error");
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Link to Bill";
    }
});

// ==========================================
// 3. PATIENT SELECTION FOR NEW BILL
// ==========================================
function searchPatient_billing(query) {
    var dropdown = document.getElementById('billing_patientSearchResults');
    if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }
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
        showPatientDropdown_billing(results);
    })
    .catch(function(err) {
        dropdown.innerHTML = '<div style="padding:10px;color:red;">Error: ' + err.message + '</div>';
    });
}
window.searchPatient_billing = searchPatient_billing;

function showPatientDropdown_billing(patients) {
    var dropdown = document.getElementById('billing_patientSearchResults');
    if (!patients.length) {
        dropdown.innerHTML = '<div style="padding:10px;color:#666;">No patients found</div>';
        return;
    }
    var html = '';
    patients.forEach(function(p) {
        var escapedName = (p.name || '').replace(/"/g, '&quot;');
        html += '<div class="patient-result-item" '
            + 'data-docid="' + p.docId + '" '
            + 'data-patientid="' + (p.patientId||'') + '" '
            + 'data-name="' + escapedName + '" '
            + 'data-doctor="' + (p.doctor||'') + '" '
            + 'data-dept="' + (p.department||'') + '" '
            + 'data-phone="' + (p.phone||'') + '" '
            + 'data-age="' + (p.age||'') + '" '
            + 'data-gender="' + (p.gender||'') + '" '
            + 'style="padding:10px 15px;cursor:pointer;border-bottom:1px solid #eee;">'
            + '<strong>' + (p.name||'Unknown') + '</strong>'
            + ' <span style="color:#0D7A70;font-size:12px;">' + (p.patientId||'') + '</span>'
            + '<br><small style="color:#888;">'
            + (p.phone||'') + ' | ' + (p.doctor||'') + ' | ' + (p.department||'')
            + '</small></div>';
    });
    dropdown.innerHTML = html;

    // Attach click and hover listeners after rendering
    dropdown.querySelectorAll('.patient-result-item').forEach(function(el) {
        el.addEventListener('click', function() {
            selectPatient_billing(this);
        });
        el.addEventListener('mouseover', function() {
            this.style.background = '#f5f5f5';
        });
        el.addEventListener('mouseout', function() {
            this.style.background = 'white';
        });
    });
}
window.showPatientDropdown_billing = showPatientDropdown_billing;

function selectPatient_billing(el) {
    selectedPatient_billing = {
        docId: el.dataset.docid || el.getAttribute('data-docid'),
        patientId: el.dataset.patientid || el.getAttribute('data-patientid'),
        name: el.dataset.name || el.getAttribute('data-name'),
        doctor: el.dataset.doctor || el.getAttribute('data-doctor'),
        department: el.dataset.dept || el.getAttribute('data-dept'),
        phone: el.dataset.phone || el.getAttribute('data-phone'),
        age: el.dataset.age || el.getAttribute('data-age'),
        gender: el.dataset.gender || el.getAttribute('data-gender')
    };
    document.getElementById('billing_patientSearchInput').value = selectedPatient_billing.name + ' — ' + selectedPatient_billing.patientId;
    document.getElementById('billing_patientSearchResults').style.display = 'none';
    document.getElementById('billing_cardPatientName').textContent = selectedPatient_billing.name;
    document.getElementById('billing_cardPatientId').textContent = selectedPatient_billing.patientId;
    document.getElementById('billing_cardAgeGender').textContent = (selectedPatient_billing.age || '—') + ' / ' + (selectedPatient_billing.gender || '—');
    loadDoctors_billing(selectedPatient_billing.doctor);
    var deptSelect = document.getElementById('billing_deptSelect');
    if (deptSelect) deptSelect.value = selectedPatient_billing.department || '';
    document.getElementById('billing_selectedPatientCard').style.display = 'block';
}
window.selectPatient_billing = selectPatient_billing;

function clearPatient_billing() {
    selectedPatient_billing = null;
    document.getElementById('billing_patientSearchInput').value = '';
    document.getElementById('billing_selectedPatientCard').style.display = 'none';
    document.getElementById('billing_patientSearchResults').style.display = 'none';
    document.getElementById('billing_patientSearchInput').focus();
}
window.clearPatient_billing = clearPatient_billing;

function loadDoctors_billing(defaultDoctor) {
    var select = document.getElementById('billing_doctorSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select Doctor</option>';
    firebase.firestore().collection('staff').where('role', '==', 'doctor').get()
    .then(function(snap) {
        if (snap.empty) {
            var defaults = ['Dr. Sharma', 'Dr. Patel', 'Dr. Vamsi', 'Dr. Reddy', 'Dr. Rao'];
            defaults.forEach(function(d) {
                var opt = document.createElement('option');
                opt.value = d; opt.textContent = d;
                if (d === defaultDoctor) opt.selected = true;
                select.appendChild(opt);
            });
        } else {
            snap.forEach(function(doc) {
                var d = doc.data();
                var active = d.isActive === true || d.isActive === 'true';
                if (!active) return;
                var opt = document.createElement('option');
                opt.value = d.name;
                opt.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                if (d.name === defaultDoctor) opt.selected = true;
                select.appendChild(opt);
            });
        }
    });
}

// Free OP Auto Charge
document.getElementById('billing_doctorSelect')?.addEventListener('change', function(e) {
    const docName = e.target.value;
    if (!docName) return;
    db.collection('staff').where('role', '==', 'doctor').where('name', '==', docName).get().then(snap => {
        if (!snap.empty) {
            const data = snap.docs[0].data();
            if (data.freeOP === true || data.freeOP === 'true') {
                addChargeRow();
                // Find last added row
                const rows = document.querySelectorAll('#chargeTableBody tr');
                const lastRow = rows[rows.length - 1];
                if (lastRow) {
                    lastRow.querySelector('.item-category').value = 'Consultation';
                    lastRow.querySelector('.item-desc').value = 'Free OP Consultation';
                    lastRow.querySelector('.item-qty').value = 1;
                    lastRow.querySelector('.item-price').value = 0;
                    lastRow.querySelector('.item-amount').value = 0;
                    calculateRowAndTotals();
                }
                showToast('This doctor has Free OP — consultation fee waived.', 'success');
            }
        }
    });
});

// Close dropdown if clicked outside
document.addEventListener('click', function(e) {
    var searchInput = document.getElementById('billing_patientSearchInput');
    var searchResults = document.getElementById('billing_patientSearchResults');
    if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
    }
});

// ==========================================
// 4. CHARGE ITEMS & CALCULATION (PART 5)
// ==========================================
const chargeTableBody = document.getElementById('chargeTableBody');
let chargeRowCounter = 0;

function addChargeRow() {
    chargeRowCounter++;
    const tr = document.createElement('tr');
    tr.id = `chargeRow_${chargeRowCounter}`;
    
    const doctorSelect = document.getElementById('billing_doctorSelect');
    const defaultOrderedBy = doctorSelect ? doctorSelect.value : '';

    // Upgraded category select options with common lab/scans (PART 5 & CHANGE 1)
    tr.innerHTML = `
        <td>
            <select class="item-category" required style="width:100%;">
                <option value="Consultation">Consultation</option>
                <option value="Bed Charges">Bed Charges</option>
                <option value="Medicine">Medicine</option>
                <option value="Nursing">Nursing</option>
                <option value="Procedure">Procedure</option>
                <option value="Oxygen">Oxygen</option>
                <option value="Ambulance">Ambulance</option>
                <optgroup label="── Lab Tests ──">
                  <option value="lab_cbc">CBC (Complete Blood Count)</option>
                  <option value="lab_crp">CRP</option>
                  <option value="lab_esr">ESR</option>
                  <option value="lab_bsf">Blood Sugar Fasting</option>
                  <option value="lab_bspp">Blood Sugar PP</option>
                  <option value="lab_hba1c">HbA1c</option>
                  <option value="lab_lft">Liver Function Test</option>
                  <option value="lab_kft">Kidney Function Test</option>
                  <option value="lab_thyroid">Thyroid Profile (T3 T4 TSH)</option>
                  <option value="lab_lipid">Lipid Profile</option>
                  <option value="lab_urine">Urine Routine</option>
                  <option value="lab_fever">Fever Profile</option>
                  <option value="lab_dengue">Dengue NS1</option>
                  <option value="lab_malaria">Malaria Antigen</option>
                  <option value="lab_covid">COVID Antigen</option>
                  <option value="lab_custom">Custom Lab Test</option>
                </optgroup>
                <optgroup label="── Imaging ──">
                  <option value="img_xray_chest">X-Ray Chest</option>
                  <option value="img_xray_abdomen">X-Ray Abdomen</option>
                  <option value="img_ct_head">CT Scan Head</option>
                  <option value="img_ct_abdomen">CT Scan Abdomen</option>
                  <option value="img_mri_brain">MRI Brain</option>
                  <option value="img_mri_spine">MRI Spine</option>
                  <option value="img_usg_abdomen">Ultrasound Abdomen</option>
                  <option value="img_usg_pelvis">Ultrasound Pelvis</option>
                  <option value="img_echo">Echo</option>
                  <option value="img_ecg">ECG</option>
                  <option value="img_custom">Custom Imaging</option>
                </optgroup>
                <option value="Other">Other</option>
            </select>
        </td>
        <td>
            <input type="text" class="item-desc" required style="width:100%;">
            <label class="pending-checkbox-label" style="display:none; font-size:11px; color:#D4820A; margin-top:6px; align-items:center; gap:4px;">
                <input type="checkbox" class="item-pending"> Report pending — test not yet done
            </label>
        </td>
        <td><input type="text" class="item-orderedby" value="${defaultOrderedBy}" style="width:100%;"></td>
        <td><input type="number" class="item-qty" value="1" min="1" required style="width:100%;"></td>
        <td><input type="number" class="item-price" value="0" min="0" required style="width:100%;"></td>
        <td><input type="number" class="item-amount" value="0" readonly style="width:100%; background:#f0f0f0; border:none; padding:8px;"></td>
        <td><button type="button" class="btn-secondary remove-charge-btn" style="padding:4px 8px; color:red; border-color:red;"><i class="fa-solid fa-trash"></i></button></td>
    `;
    
    chargeTableBody.appendChild(tr);
    
    // Add event listeners for recalculation & Pending Checkbox Toggle
    const qtyInput = tr.querySelector('.item-qty');
    const priceInput = tr.querySelector('.item-price');
    const removeBtn = tr.querySelector('.remove-charge-btn');
    const catSelect = tr.querySelector('.item-category');
    const pendingLabel = tr.querySelector('.pending-checkbox-label');
    const pendingCheckbox = tr.querySelector('.item-pending');
    const descInput = tr.querySelector('.item-desc');
    if (window.HOSPITAL_POLICY) {
        catSelect.querySelectorAll('optgroup').forEach(function(group) { group.remove(); });
        [['Lab Tests', 'lab_', HOSPITAL_POLICY.labs], ['Imaging', 'img_', HOSPITAL_POLICY.imaging]].forEach(function(groupData) {
            var group = document.createElement('optgroup'); group.label = groupData[0];
            groupData[2].forEach(function(item) {
                var option = document.createElement('option'); option.value = groupData[1] + item.id.toLowerCase();
                option.textContent = item.name; option.dataset.price = item.price; group.appendChild(option);
            });
            var custom = document.createElement('option'); custom.value = groupData[1] + 'custom'; custom.textContent = 'Custom ' + groupData[0]; group.appendChild(custom);
            catSelect.appendChild(group);
        });
    }
    
    catSelect.addEventListener('change', () => {
        var catalogOption = catSelect.options[catSelect.selectedIndex];
        if (catalogOption && catalogOption.dataset.price !== undefined) {
            priceInput.value = catalogOption.dataset.price; descInput.value = catalogOption.textContent;
            calculateRowAndTotals();
        }
        const val = catSelect.value;
        const isLabImg = val.startsWith('lab_') || val.startsWith('img_');
        
        if (isLabImg) {
            tr.dataset.labItem = 'true';
            pendingLabel.style.display = 'flex';
        } else {
            delete tr.dataset.labItem;
            pendingLabel.style.display = 'none';
            pendingCheckbox.checked = false;
        }
        
        const selectedOptionText = catSelect.options[catSelect.selectedIndex].text;
        const cleanDesc = selectedOptionText.replace(/ \((Lab|Imaging)\)/, '').replace(/─/g, '').trim();
        if (!descInput.value.trim() && val !== 'Other' && !val.includes('──')) {
            descInput.value = cleanDesc;
        }
    });

    qtyInput.addEventListener('input', calculateRowAndTotals);
    priceInput.addEventListener('input', calculateRowAndTotals);
    
    removeBtn.addEventListener('click', () => {
        tr.remove();
        calculateRowAndTotals();
    });
}

document.getElementById('addChargeBtn').addEventListener('click', addChargeRow);

function loadBillingPackageAndServiceDropdowns() {
    var pkgSel = document.getElementById('billingPackageSelect');
    var svcSel = document.getElementById('billingServiceSelect');
    if (pkgSel) {
        db.collection('carePackages').get().then(function (snap) {
            var html = '<option value="">Select package…</option>';
            snap.forEach(function (doc) {
                var p = doc.data();
                if (p.active === false) return;
                html += '<option value="' + escapeHtml(doc.id) + '" data-code="' + escapeHtml(p.code || doc.id) + '" data-name="' + escapeHtml(p.name || '') + '" data-price="' + (p.price || 0) + '">'
                    + escapeHtml((p.code || doc.id) + ' — ' + (p.name || '') + ' (₹' + (p.price || 0) + ')') + '</option>';
            });
            pkgSel.innerHTML = html;
        }).catch(function () {});
    }
    if (svcSel && typeof loadServiceCatalogOptions === 'function') {
        loadServiceCatalogOptions(svcSel);
    }
}
loadBillingPackageAndServiceDropdowns();

var addServiceBtn = document.getElementById('addServiceChargeBtn');
if (addServiceBtn) {
    addServiceBtn.addEventListener('click', function () {
        var sel = document.getElementById('billingServiceSelect');
        if (!sel || !sel.value) { showToast('Select a service first.', 'warning'); return; }
        var opt = sel.selectedOptions[0];
        addChargeRow();
        var row = chargeTableBody.lastElementChild;
        if (!row) return;
        var cat = row.querySelector('.item-category');
        if (cat) cat.value = 'Procedure';
        row.querySelector('.item-desc').value = sel.value;
        row.querySelector('.item-qty').value = 1;
        row.querySelector('.item-price').value = opt && opt.dataset.price ? opt.dataset.price : 0;
        calculateRowAndTotals();
    });
}

var applyPkgBtn = document.getElementById('applyPackageBtn');
if (applyPkgBtn) {
    applyPkgBtn.addEventListener('click', function () {
        var sel = document.getElementById('billingPackageSelect');
        if (!sel || !sel.value) { showToast('Select a package from the dropdown.', 'warning'); return; }
        var opt = sel.selectedOptions[0];
        addChargeRow();
        var row = chargeTableBody.lastElementChild;
        if (!row) return;
        var cat = row.querySelector('.item-category');
        if (cat) cat.value = 'Procedure';
        row.querySelector('.item-desc').value = (opt.dataset.name || sel.value) + ' [' + (opt.dataset.code || '') + ']';
        row.querySelector('.item-qty').value = 1;
        row.querySelector('.item-price').value = opt.dataset.price || 0;
        calculateRowAndTotals();
        window._pendingPackageCode = opt.dataset.code || sel.value;
        showToast('Package applied. Extras still need separate charge lines.', 'success');
    });
}

// Calculation Logic
const billDiscount = document.getElementById('billDiscount');
const billGst = document.getElementById('billGst');
const advancePaid = document.getElementById('advancePaid'); // Standardized naming (Fix 13)

billDiscount.addEventListener('input', calculateRowAndTotals);
billGst.addEventListener('change', calculateRowAndTotals);
if (advancePaid) advancePaid.addEventListener('input', calculateRowAndTotals);

function calculateRowAndTotals() {
    let subtotal = 0;
    
    // Calculate each row
    document.querySelectorAll('#chargeTableBody tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const amount = qty * price;
        row.querySelector('.item-amount').value = (amount || 0).toFixed(2);
        subtotal += amount;
    });
    
    // Discount
    const discPct = parseFloat(billDiscount.value) || 0;
    const discountAmt = subtotal * (discPct / 100);
    const afterDiscount = subtotal - discountAmt;
    
    // Toggle approver input based on discount
    document.getElementById('discountApproverGroup').style.display = discPct > 0 ? 'block' : 'none';
    if(discPct === 0) document.getElementById('billDiscountApprover').value = "";
    
    // GST
    const gstPct = parseFloat(billGst.value) || 0;
    const gstAmt = afterDiscount * (gstPct / 100);
    
    // Grand Total & Balance
    const grandTotal = afterDiscount + gstAmt;
    const advance = parseFloat(advancePaid ? advancePaid.value : 0) || 0;
    
    let totalPaymentsEntered = 0;
    document.querySelectorAll('.pay-method-amt').forEach(input => {
        totalPaymentsEntered += parseFloat(input.value) || 0;
    });
    
    const balanceDue = grandTotal - advance - totalPaymentsEntered;
    
    // Update DOM
    document.getElementById('summarySubtotal').textContent = (subtotal || 0).toFixed(2);
    document.getElementById('summaryDiscountAmt').textContent = (discountAmt || 0).toFixed(2);
    document.getElementById('summaryGstAmt').textContent = (gstAmt || 0).toFixed(2);
    document.getElementById('summaryGrandTotal').textContent = (grandTotal || 0).toFixed(2);
    document.getElementById('summaryBalanceDue').textContent = (balanceDue || 0).toFixed(2);
}

// ==========================================
// 5. PAYMENT METHODS LOGIC
// ==========================================
const payMethodCheckboxes = document.querySelectorAll('.pay-method-cb');
const paymentDynamicFields = document.getElementById('paymentDynamicFields');

payMethodCheckboxes.forEach(cb => {
    cb.addEventListener('change', renderPaymentDynamicFields);
});

function renderPaymentDynamicFields() {
    paymentDynamicFields.innerHTML = "";
    const selectedMethods = Array.from(payMethodCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
    
    if (selectedMethods.length === 0) return;
    
    selectedMethods.forEach(method => {
        const div = document.createElement('div');
        div.style.marginBottom = "15px";
        div.style.padding = "10px";
        div.style.background = "#f8fafc";
        div.style.border = "1px solid var(--border-color)";
        div.style.borderRadius = "6px";
        
        let extraFields = "";
        if (method === "Insurance") {
            extraFields = `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                    <div class="form-group" style="margin:0;"><label>Company Name</label><input type="text" class="pay-ins-company" required></div>
                    <div class="form-group" style="margin:0;"><label>Claim ID</label><input type="text" class="pay-ins-claim"></div>
                </div>
            `;
        } else if (method === "Aarogyasri" || method === "Govt Scheme") {
            extraFields = `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                    <div class="form-group" style="margin:0;"><label>Scheme Name</label><input type="text" class="pay-govt-scheme" required></div>
                    <div class="form-group" style="margin:0;"><label>Auth Number</label><input type="text" class="pay-govt-auth" required></div>
                </div>
            `;
        }
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4 style="margin:0; color:var(--primary-navy);">${method}</h4>
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="margin:0; font-size:0.85rem;">Amount (₹)</label>
                    <input type="number" class="pay-method-amt" data-method="${method}" value="0" min="0" style="width:100px; padding:5px;">
                </div>
            </div>
            ${extraFields}
        `;
        paymentDynamicFields.appendChild(div);
    });

    document.querySelectorAll('.pay-method-amt').forEach(input => {
        input.addEventListener('input', calculateRowAndTotals);
    });
}

// ==========================================
// 6. SAVE & GENERATE BILL LOGIC (PART 5)
// ==========================================
const newBillModal = document.getElementById('newBillModal');
document.getElementById('newBillBtn').addEventListener('click', () => {
    resetNewBillForm();
    newBillModal.style.display = 'flex';
});
document.getElementById('closeNewBillModal').addEventListener('click', () => { newBillModal.style.display = 'none'; });
document.getElementById('cancelBillBtn').addEventListener('click', () => { newBillModal.style.display = 'none'; });

function resetNewBillForm() {
    document.getElementById('newBillForm').reset();
    selectedPatient_billing = null;
    document.getElementById('billing_selectedPatientCard').style.display = 'none';
    document.getElementById('billing_patientSearchInput').value = "";
    document.querySelectorAll('.visit-type-btn').forEach(l => l.classList.remove('active'));
    document.querySelector('.visit-type-btn').classList.add('active'); // Default to OPD
    chargeTableBody.innerHTML = "";
    addChargeRow(); // Add one empty row
    calculateRowAndTotals();
    window._pendingPackageCode = null;
    renderPaymentDynamicFields();
    // Reset bed section
    var bedSection = document.getElementById('bedAssignmentSection');
    if (bedSection) bedSection.style.display = 'none';
    clearBedAssignment();
    // Set admission date to today
    var admDate = document.getElementById('bedAdmissionDate');
    if (admDate) admDate.value = todayIso();
}

async function generateBillNumber(visitType) {
    const counterRef = db.collection("billCounters").doc(visitType);
    
    try {
        return await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(counterRef);
            let newCount = 1;
            if (doc.exists) {
                newCount = (doc.data().count || 0) + 1;
                transaction.update(counterRef, { count: newCount });
            } else {
                transaction.set(counterRef, { count: newCount });
            }
            
            const paddedCount = newCount.toString().padStart(5, '0');
            var year = new Date().getFullYear();
            return `SA-${visitType}-${year}-${paddedCount}`;
        });
    } catch (e) {
        console.error("Counter transaction failed: ", e);
        const random = Math.floor(Math.random() * 90000) + 10000;
        var year = new Date().getFullYear();
        return `SA-${visitType}-${year}-${random}`;
    }
}

async function saveBill(status) {
    if (document.getElementById('generateBillBtn').disabled) return;
    if (!selectedPatient_billing) { showToast('Please select a patient first.', 'warning'); return; }
    
    const rows = document.querySelectorAll('#chargeTableBody tr');
    if (rows.length === 0) { showToast('Please add at least one charge item.', 'warning'); return; }
    
    // Construct items array & collect pending tests
    const items = [];
    const pendingRequestsToCreate = [];
    const labTests = [];
    let labRequired = false;
    
    rows.forEach(row => {
        const category = row.querySelector('.item-category').value;
        const description = row.querySelector('.item-desc').value;
        const orderedBy = row.querySelector('.item-orderedby').value;
        const quantity = parseFloat(row.querySelector('.item-qty').value) || 0;
        const unitPrice = parseFloat(row.querySelector('.item-price').value) || 0;
        const amount = parseFloat(row.querySelector('.item-amount').value) || 0;
        
        const isLabImg = category.startsWith('lab_') || category.startsWith('img_');
        
        items.push({
            category,
            description,
            orderedBy,
            quantity,
            unitPrice,
            amount,
            ...(isLabImg ? { labItem: true } : {})
        });
        
        if (isLabImg) {
            labRequired = true;
            labTests.push({
                testName: description || category,
                amount: amount,
                category: category,
                status: "pending",
                reportId: null
            });
        }
        
        const pendingCheckbox = row.querySelector('.item-pending');
        if (pendingCheckbox && pendingCheckbox.checked) {
            pendingRequestsToCreate.push({
                category,
                description,
                orderedBy,
                amount
            });
        }
    });
    
    // Validate discount
    const discPct = parseFloat(billDiscount.value) || 0;
    const approver = document.getElementById('billDiscountApprover').value.trim();
    if (discPct > 0 && !approver) { showToast('Please enter the name of the person who approved the discount.', 'warning'); return; }
    
    // Gather payment details
    const selectedMethods = Array.from(payMethodCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
    const paymentDetails = {};
    let totalPaidInMethods = 0;
    
    document.querySelectorAll('#paymentDynamicFields > div').forEach(div => {
        const method = div.querySelector('.pay-method-amt').dataset.method;
        const amt = parseFloat(div.querySelector('.pay-method-amt').value) || 0;
        totalPaidInMethods += amt;
        
        let details = { amount: amt };
        if (method === "Insurance") {
            details.company = div.querySelector('.pay-ins-company').value;
            details.claimId = div.querySelector('.pay-ins-claim').value;
        } else if (method === "Aarogyasri" || method === "Govt Scheme") {
            details.scheme = div.querySelector('.pay-govt-scheme').value;
            details.authNo = div.querySelector('.pay-govt-auth').value;
        }
        paymentDetails[method] = details;
    });
    
    const visitType = document.querySelector('.visit-type-btn.active input').value;
    
    let finalStatus = status;
    const grandTotal = parseFloat(document.getElementById('summaryGrandTotal').textContent);
    const balanceDue = parseFloat(document.getElementById('summaryBalanceDue').textContent);
    
    if (status !== 'Draft') {
        if (balanceDue <= 0) {
            finalStatus = 'paid';
        } else if (balanceDue < grandTotal) {
            finalStatus = 'partial';
        } else {
            finalStatus = 'due';
        }
    } else {
        finalStatus = 'draft';
    }
    
    // Calculate new separate status fields (PART 1)
    let paymentStatus = "unpaid";
    const totalPaid = (parseFloat(advancePaid ? advancePaid.value : 0) || 0) + totalPaidInMethods;
    if (!Number.isFinite(grandTotal) || grandTotal < 0 || !Number.isFinite(totalPaid) || totalPaid < 0 || totalPaid > grandTotal + 0.001 ||
        items.some(item => item.quantity <= 0 || item.unitPrice < 0 || item.amount < 0) ||
        Object.values(paymentDetails).some(detail => detail.amount < 0)) {
        showToast('Check charge quantities and amounts. Payments cannot exceed the bill total.', 'warning');
        return;
    }
    if (status !== 'Draft') {
        if (totalPaid === 0) {
            if (selectedMethods.includes('Insurance') || selectedMethods.includes('Credit') || selectedMethods.includes('Govt Scheme') || selectedMethods.includes('Aarogyasri')) {
                paymentStatus = "due";
            } else {
                paymentStatus = "unpaid";
            }
        } else if (balanceDue <= 0) {
            paymentStatus = "paid";
        } else {
            if (selectedMethods.includes('Insurance') || selectedMethods.includes('Credit') || selectedMethods.includes('Govt Scheme') || selectedMethods.includes('Aarogyasri')) {
                paymentStatus = "due";
            } else {
                paymentStatus = "partial";
            }
        }
    } else {
        paymentStatus = "unpaid";
    }

    // category is absent on items added by the bed-charge, report-link and
    // imported paths, and an unguarded .startsWith there throws and aborts
    // the whole bill save.
    let hasLabImg = items.some(item => {
        const cat = String((item && item.category) || '');
        return cat.startsWith('lab_') || cat.startsWith('img_');
    });
    let reportStatus = hasLabImg ? "pending" : "not_applicable";
    
    document.getElementById('saveDraftBtn').disabled = true;
    document.getElementById('generateBillBtn').disabled = true;
    document.getElementById('generateBillBtn').textContent = "Saving...";

    try {
        const billNo = await generateBillNumber(visitType);
        const labNotes = document.getElementById('billing_labNotes') ? document.getElementById('billing_labNotes').value.trim() : '';
        
        const billData = {
            billId: billNo,
            patientId: selectedPatient_billing.patientId,
            patientDocId: selectedPatient_billing.docId,
            patientName: selectedPatient_billing.name,
            patientPhone: selectedPatient_billing.phone || '',
            visitDoctor: document.getElementById('billing_doctorSelect').value,
            visitDepartment: document.getElementById('billing_deptSelect').value,
            procedureUnderwent: document.getElementById('billing_procedureUnderwent') ? document.getElementById('billing_procedureUnderwent').value.trim() : '',
            type: visitType,
            items: items,
            packageCode: window._pendingPackageCode || null,
            subtotal: parseFloat(document.getElementById('summarySubtotal').textContent),
            discountPercent: discPct,
            discountAmount: parseFloat(document.getElementById('summaryDiscountAmt').textContent),
            discountApprover: approver,
            gstPercent: parseFloat(billGst.value) || 0,
            gstAmount: parseFloat(document.getElementById('summaryGstAmt').textContent),
            grandTotal: grandTotal,
            advancePaid: status === 'Draft' ? 0 : parseFloat(advancePaid ? advancePaid.value : 0) || 0,
            amountPaid: status === 'Draft' ? 0 : totalPaid,
            balanceDue: status === 'Draft' ? grandTotal : Math.max(0, balanceDue),
            paymentMethods: selectedMethods,
            paymentDetails: status === 'Draft' ? {} : paymentDetails,
            notes: document.getElementById('billNotes').value,
            status: finalStatus,
            paymentStatus: paymentStatus,
            reportStatus: reportStatus,
            createdBy: currentUserEmail,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            
            // IPD Running Bill specific fields (PART 1)
            isRunningBill: (visitType === 'IPD' || visitType === 'ICU') ? true : false,
            isFinalized: (visitType === 'IPD' || visitType === 'ICU') ? false : true,
            daysOfStay: 0,
            lastChargeUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            dailyCharges: [],
            additionalCharges: [],
            
            // Bed assignment data (PART 2)
            labRequired: labRequired,
            labCompleted: false,
            labTests: labTests,
            labNotes: labNotes,
            ...(_billingBedData ? {
                bedDocId: _billingBedData.docId,
                bedNumber: _billingBedData.bedNumber,
                bedWard: _billingBedData.ward,
                dailyRate: _billingBedData.dailyRate,
                admissionDate: _billingBedData.admissionDate,
                expectedDischargeDate: _billingBedData.expectedDischargeDate || null,
                isIPDClosed: false
            } : {})
        };

        const batch = db.batch();
        
        // 1. Save to global /bills
        const globalBillRef = db.collection("bills").doc();
        batch.set(globalBillRef, billData);
        
        // 2. Save to /patients/{id}/bills
        const patientBillRef = db.collection("patients").doc(selectedPatient_billing.docId).collection("bills").doc(globalBillRef.id);
        batch.set(patientBillRef, billData);

        // Cash collected with a new bill must appear in the append-only ledger.
        if (status !== 'Draft') {
            const receipts = Object.keys(paymentDetails).map(method => ({ method, amount: paymentDetails[method].amount }));
            if (billData.advancePaid > 0) receipts.push({ method: 'Cash', amount: billData.advancePaid });
            receipts.filter(receipt => receipt.amount > 0).forEach(receipt => {
                const ref = db.collection('payments').doc();
                batch.set(ref, { paymentId: ref.id, billId: billNo, billDocId: globalBillRef.id,
                    patientId: billData.patientId, patientName: billData.patientName,
                    amount: receipt.amount, paymentMethod: receipt.method, type: 'bill_payment',
                    recordedBy: currentUserEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            });
        }
        
        // 3. Create placeholder reports for checked lab/scan charges (PART 5)
        pendingRequestsToCreate.forEach(req => {
            const isImaging = ["Imaging", "X-Ray Chest", "CT Scan Head", "MRI Brain", "Ultrasound Abdomen", "Echo"].includes(req.category);
            const reportType = isImaging ? "imaging" : "lab";
            
            const reportRef = db.collection("reports").doc();
            
            const placeholderData = {
                type: reportType,
                status: "Pending",
                billingStatus: "billed",
                linkedBillId: billNo,
                testName: req.description || req.category,
                patientId: selectedPatient_billing.patientId,
                patientDocId: selectedPatient_billing.docId,
                patientName: selectedPatient_billing.name,
                createdBy: "billing",
                uploadedReport: false,
                amount: req.amount || 0,
                totalAmount: req.amount || 0,
                tests: [{ name: req.description || req.category, amount: req.amount || 0 }],
                referredBy: req.orderedBy || billData.visitDoctor || "",
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            if (isImaging) {
                placeholderData.imagingType = req.category === "Imaging" ? "Other" : req.category;
            }
            
            batch.set(reportRef, placeholderData);
        });

        // Lab/Imaging work queues when billed — including due / insurance / credit / Aarogyasri.
        const isEmergency = document.getElementById('isEmergencyBill') ? document.getElementById('isEmergencyBill').checked : false;
        const psLower = String(paymentStatus || '').toLowerCase();
        const creditLike = (selectedMethods || []).some(function (m) {
            return /insurance|credit|aarogyasri|govt/i.test(String(m || ''));
        });
        const enqueueNow = status !== 'Draft' && (psLower !== 'unpaid' || creditLike || totalPaid > 0);
        if (enqueueNow) {
            items.forEach(item => {
                const itemCat = String((item && item.category) || '');
                if (itemCat.startsWith('lab_')) {
                    const labQueueRef = db.collection("labQueue").doc();
                    batch.set(labQueueRef, {
                        queueId: labQueueRef.id,
                        billId: billNo,
                        billDocId: globalBillRef.id,
                        patientId: selectedPatient_billing.patientId,
                        patientName: selectedPatient_billing.name,
                        patientPhone: selectedPatient_billing.phone || '',
                        testName: item.description || item.category,
                        amount: item.amount,
                        visitDoctor: document.getElementById('billing_doctorSelect').value,
                        labNotes: labNotes,
                        reportStatus: "pending",
                        reportId: null,
                        isEmergency: isEmergency,
                        source: 'billing',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: currentUserEmail
                    });
                } else if (itemCat.startsWith('img_')) {
                    const imgQueueRef = db.collection("imagingQueue").doc();
                    batch.set(imgQueueRef, {
                        queueId: imgQueueRef.id,
                        billId: billNo,
                        billDocId: globalBillRef.id,
                        patientId: selectedPatient_billing.patientId,
                        patientName: selectedPatient_billing.name,
                        patientPhone: selectedPatient_billing.phone || '',
                        testName: item.description || item.category,
                        amount: item.amount,
                        visitDoctor: document.getElementById('billing_doctorSelect').value,
                        labNotes: labNotes,
                        reportStatus: "pending",
                        reportId: null,
                        isEmergency: isEmergency,
                        imagingType: item.category.replace('img_', ''),
                        source: 'billing',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: currentUserEmail
                    });
                }
            });
        }
        
        // 4. Save Audit Log (Improvement E enriched)
        const auditRef = db.collection("auditLog").doc();
        batch.set(auditRef, {
            action: 'bill_created',
            billId: billNo,
            patientId: selectedPatient_billing.patientId,
            patientName: selectedPatient_billing.name,
            grandTotal: grandTotal,
            discountAmount: billData.discountAmount || 0,
            discountApprover: billData.discountApprover || '',
            paymentMethod: selectedMethods.join(', '),
            paymentStatus: paymentStatus,
            staffEmail: currentUserEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 4b. If discount applied, log a separate discount audit entry
        if (discPct > 0) {
            const discountAuditRef = db.collection("auditLog").doc();
            batch.set(discountAuditRef, {
                billId: billNo,
                patientId: selectedPatient_billing.patientId,
                patientName: selectedPatient_billing.name,
                action: "discount_applied",
                discountPercent: billData.discountPercent,
                discountAmount: billData.discountAmount,
                originalAmount: billData.subtotal,
                approverName: billData.discountApprover,
                staffEmail: currentUserEmail,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        // 4c. If bed assigned, update bed + create admission record in same batch
        const _capturedBedData = _billingBedData ? Object.assign({}, _billingBedData) : null;
        if (_capturedBedData && _capturedBedData.docId && status !== 'Draft') {
            const admissionRef = db.collection('admissions').doc();
            batch.update(db.collection('beds').doc(_capturedBedData.docId), {
                status: 'occupied',
                patientId: selectedPatient_billing.patientId,
                patientDocId: selectedPatient_billing.docId,
                patientName: selectedPatient_billing.name,
                billId: billNo,
                billDocId: globalBillRef.id,
                admittedAt: _capturedBedData.admissionDate,
                expectedDischargeDate: _capturedBedData.expectedDischargeDate || null,
                activeAdmissionId: admissionRef.id,
                assignedBy: currentUserEmail,
                assignedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            batch.set(admissionRef, {
                patientId: selectedPatient_billing.patientId,
                patientDocId: selectedPatient_billing.docId,
                patientName: selectedPatient_billing.name,
                bedDocId: _capturedBedData.docId,
                bedNumber: _capturedBedData.bedNumber,
                ward: _capturedBedData.ward,
                billId: billNo,
                billDocId: globalBillRef.id,
                dailyRate: _capturedBedData.dailyRate,
                admissionDate: _capturedBedData.admissionDate,
                expectedDischargeDate: _capturedBedData.expectedDischargeDate || null,
                status: 'admitted',
                admittedBy: currentUserEmail,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();

        if (enqueueNow && typeof ensureLabImagingQueuesForBill === 'function') {
            try {
                await ensureLabImagingQueuesForBill(globalBillRef.id, Object.assign({}, billData, { billId: billNo, isEmergency: isEmergency }));
            } catch (qErr) {
                console.warn('Lab/imaging queue ensure:', qErr);
            }
        }
        
        newBillModal.style.display = 'none';
        showToast(`Bill ${billNo} created successfully!`, 'success');
        resetNewBillForm();
        loadBills();
    } catch (err) {
        console.error("Error saving bill:", err);
        showToast("Error saving bill: " + err.message, 'error');
    } finally {
        document.getElementById('saveDraftBtn').disabled = false;
        document.getElementById('generateBillBtn').disabled = false;
        document.getElementById('generateBillBtn').textContent = "Generate Bill";
    }
}

document.getElementById('saveDraftBtn').addEventListener('click', () => saveBill("Draft"));
document.getElementById('generateBillBtn').addEventListener('click', () => saveBill("Generate"));

// ==========================================
// 7. VIEW & PRINT BILL LOGIC
// ==========================================
const viewBillModal = document.getElementById('viewBillModal');
document.getElementById('closeViewBillModal').addEventListener('click', () => viewBillModal.style.display = 'none');
document.getElementById('printBillBtn').addEventListener('click', () => window.print());

function openViewBillModal(bill) {
    window.currentViewingBillId = bill.id;
    currentViewingBillId = bill.id;
    document.getElementById('printBillNo').textContent = bill.billId || "-";
    document.getElementById('printBillDate').textContent = formatDate(bill.createdAt);
    if (document.getElementById('printCashier')) document.getElementById('printCashier').textContent = bill.createdBy || "-";
    
    document.getElementById('printPtName').textContent = bill.patientName || "-";
    document.getElementById('printPtId').textContent = bill.patientId || "-";
    
    if (document.getElementById('printPtAge')) document.getElementById('printPtAge').textContent = "—";
    if (document.getElementById('printPtSex')) document.getElementById('printPtSex').textContent = "—";
    if (document.getElementById('printPtAddress')) document.getElementById('printPtAddress').textContent = "—";
    if (document.getElementById('printPtAgeGen')) document.getElementById('printPtAgeGen').textContent = "—";

    if (bill.patientDocId) {
        db.collection("patients").doc(bill.patientDocId).get().then(doc => {
            if (doc.exists) {
                const d = doc.data();
                let ageDisplay = "-";
                if (d.dob) {
                    const dobDate = new Date(d.dob);
                    const ageMath = Math.floor((Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                    ageDisplay = ageMath + " yrs";
                } else if (d.age) {
                    ageDisplay = d.age + (String(d.age).includes('yr') ? '' : ' yrs');
                }
                if (document.getElementById('printPtAge')) document.getElementById('printPtAge').textContent = ageDisplay;
                if (document.getElementById('printPtSex')) document.getElementById('printPtSex').textContent = d.gender || d.sex || "-";
                if (document.getElementById('printPtAddress')) document.getElementById('printPtAddress').textContent = d.address || d.city || "-";
                if (document.getElementById('printPtAgeGen')) document.getElementById('printPtAgeGen').textContent = `${ageDisplay} / ${d.gender || "-"}`;
            }
        }).catch(err => {
            console.error("Error fetching patient for print modal:", err);
        });
    }

    if (document.getElementById('printPtDoc')) document.getElementById('printPtDoc').textContent = bill.visitDoctor || "-";
    if (document.getElementById('printPtDept')) document.getElementById('printPtDept').textContent = bill.visitDepartment || "-";
    if (document.getElementById('printHeaderDoctor')) document.getElementById('printHeaderDoctor').textContent = bill.visitDoctor || "-";
    if (document.getElementById('printFooterDoctor')) document.getElementById('printFooterDoctor').textContent = bill.visitDoctor || "-";

    if (document.getElementById('printDoAdmission')) {
        document.getElementById('printDoAdmission').textContent = bill.admissionDate || bill.doAdmission || (bill.createdAt ? formatDate(bill.createdAt) : "-");
    }
    if (document.getElementById('printDoDischarge')) {
        document.getElementById('printDoDischarge').textContent = bill.dischargeDate || bill.doDischarge || bill.expectedDischargeDate || "-";
    }
    if (document.getElementById('printProcedureUnderwent')) {
        document.getElementById('printProcedureUnderwent').textContent = bill.procedureUnderwent || bill.labNotes || bill.notes || "—";
    }

    const tbody = document.getElementById('printChargeTableBody');
    tbody.innerHTML = "";
    (bill.items || []).forEach((item, index) => {
        let desc = item.description || item.name || '';
        let bilingualDesc = desc;
        if (window.hmsI18n && window.hmsI18n.DICT && window.hmsI18n.DICT[desc]) {
            bilingualDesc = desc + ' / ' + window.hmsI18n.DICT[desc];
        }
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="padding:8px;">${index + 1}</td>
            <td style="padding:8px;">
                <strong>${escapeHtml(bilingualDesc)}</strong>
                ${item.category ? `<br><small style="color:#666;">${escapeHtml(item.category)} ${item.orderedBy ? ' | Ordered By: ' + escapeHtml(item.orderedBy) : ''}</small>` : ''}
            </td>
            <td style="padding:8px; text-align:center;">${item.quantity || 1}</td>
            <td style="padding:8px; text-align:right;">${(item.unitPrice || 0).toFixed(2)}</td>
            <td style="padding:8px; text-align:right;">${(item.amount || 0).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('printSubtotal').textContent = (bill.subtotal || 0).toFixed(2);
    document.getElementById('printDiscount').textContent = (bill.discountAmount || 0).toFixed(2);
    document.getElementById('printGst').textContent = (bill.gstAmount || 0).toFixed(2);
    document.getElementById('printGrandTotal').textContent = (bill.grandTotal || 0).toFixed(2);
    document.getElementById('printAdvance').textContent = (bill.advancePaid || 0).toFixed(2);
    document.getElementById('printBalance').textContent = (bill.balanceDue || 0).toFixed(2);
    
    document.getElementById('printPayMethods').textContent = bill.paymentMethods ? bill.paymentMethods.join(", ") : "-";
    document.getElementById('printFooterBilledBy').textContent = bill.createdBy;
    
    const d = bill.createdAt ? bill.createdAt.toDate() : new Date();
    document.getElementById('printFooterTime').textContent = d.toLocaleString();

    // ── TRANSFER HISTORY (Part 7) ─────────────────────────────────────────
    const xferSection = document.getElementById('transferHistorySection');
    const xferBody = document.getElementById('transferHistoryBody');
    if (xferSection && xferBody) {
        let xferHtml = '';

        // Show the bill this was transferred FROM
        if (bill.linkedFromBillId) {
            xferHtml += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <i class="fa-solid fa-arrow-right-from-bracket" style="color:#0D7A70;"></i>
                <span><strong>Transferred from:</strong> ${bill.linkedFromBillId} (${bill.linkedFromType || ''})</span>
            </div>`;
            if (bill.transferReason) {
                xferHtml += `<div style="padding:8px 12px;background:#f8fafc;border-radius:6px;font-size:11px;color:#64748b;margin-bottom:6px;">
                    <strong>Reason:</strong> ${bill.transferReason}
                </div>`;
            }
            if (bill.transferDate) {
                xferHtml += `<div style="font-size:11px;color:#64748b;margin-bottom:8px;"><i class="fa-regular fa-calendar" style="margin-right:4px;"></i>${formatDate(bill.transferDate)}</div>`;
            }
        }

        // Check if there are any bills transferred FROM this one
        db.collection('bills').where('linkedFromBillId', '==', bill.billId).get().then(function(snap) {
            snap.forEach(function(doc) {
                var nb = doc.data();
                xferHtml += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <i class="fa-solid fa-arrow-right-to-bracket" style="color:#2563eb;"></i>
                    <span><strong>Transferred to:</strong> ${nb.billId} (${nb.type || ''})</span>
                    <span style="font-size:11px;color:#64748b;">${formatDate(nb.createdAt)}</span>
                </div>`;
            });
            if (xferHtml) {
                xferSection.style.display = 'block';
                xferBody.innerHTML = xferHtml;
            } else {
                xferSection.style.display = 'none';
            }
        }).catch(function() { xferSection.style.display = 'none'; });

        if (xferHtml) {
            xferSection.style.display = 'block';
            xferBody.innerHTML = xferHtml;
        } else if (!bill.linkedFromBillId) {
            xferSection.style.display = 'none';
        }
    }

    viewBillModal.style.display = 'flex';
}

// Add click listeners to visit type label elements to toggle class active
document.querySelectorAll('.visit-type-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        document.querySelectorAll('.visit-type-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const vt = this.querySelector('input').value;
        const year = new Date().getFullYear();
        document.getElementById('billNoPreview').textContent = `SA-${vt}-${year}-XXXXX`;
    });
});

// ==========================================
// RECORD PAYMENT MODAL INTERACTIONS (PART 1)
// ==========================================
// ==========================================
// RECORD PAYMENT MODAL INTERACTIONS (PART 2)
// ==========================================
function openRecordPaymentModal(docId) {
    const bill = allBills.find(b => b.id === docId);
    if (!bill) return;
    
    document.getElementById('payBillDocId').value = docId;
    document.getElementById('payPatientName').value = bill.patientName || '';
    document.getElementById('payBillNo').value = bill.billId;
    
    const outstanding = bill.balanceDue;
    document.getElementById('payBillBalance').value = outstanding;
    document.getElementById('payBillBalanceLabel').textContent = formatCurrency(outstanding);
    
    // Reset all split inputs
    const inputs = ['cash', 'card', 'phonepe', 'upi', 'insurance', 'aarogyasri', 'credit'];
    inputs.forEach(id => {
        const el = document.getElementById('splitPay_' + id);
        if (el) el.value = '';
    });
    
    const fields = ['insuranceCompany', 'authNumber'];
    fields.forEach(id => {
        const el = document.getElementById('splitPay_' + id);
        if (el) el.value = '';
    });
    
    document.getElementById('insuranceCompanyGroup').style.display = 'none';
    document.getElementById('aarogyasriAuthGroup').style.display = 'none';
    
    document.getElementById('splitPay_totalEntered').textContent = formatCurrency(0);
    document.getElementById('splitPay_remainingLabel').textContent = formatCurrency(outstanding);
    document.getElementById('splitPay_remainingLabel').style.color = '#dc2626';
    
    document.getElementById('confirmPaymentBtn').disabled = true;
    document.getElementById('confirmPaymentBtn').textContent = "Save Payment";
    document.getElementById('recordPaymentModal').style.display = 'flex';
}
window.openRecordPaymentModal = openRecordPaymentModal;

function closeRecordPaymentModal() {
    document.getElementById('recordPaymentModal').style.display = 'none';
}
window.closeRecordPaymentModal = closeRecordPaymentModal;

// Realtime calculation and validation
function calculateSplitPayment() {
    const outstanding = parseFloat(document.getElementById('payBillBalance').value) || 0;
    
    const cash = parseFloat(document.getElementById('splitPay_cash').value) || 0;
    const card = parseFloat(document.getElementById('splitPay_card').value) || 0;
    const phonepe = parseFloat(document.getElementById('splitPay_phonepe').value) || 0;
    const upi = parseFloat(document.getElementById('splitPay_upi').value) || 0;
    const insurance = parseFloat(document.getElementById('splitPay_insurance').value) || 0;
    const aarogyasri = parseFloat(document.getElementById('splitPay_aarogyasri').value) || 0;
    const credit = parseFloat(document.getElementById('splitPay_credit').value) || 0;

    // Toggle company and auth groups
    document.getElementById('insuranceCompanyGroup').style.display = insurance > 0 ? 'block' : 'none';
    document.getElementById('aarogyasriAuthGroup').style.display = aarogyasri > 0 ? 'block' : 'none';

    const totalEntered = cash + card + phonepe + upi + insurance + aarogyasri + credit;
    const remaining = outstanding - totalEntered;
    
    document.getElementById('splitPay_totalEntered').textContent = formatCurrency(totalEntered);
    
    const remainingEl = document.getElementById('splitPay_remainingLabel');
    remainingEl.textContent = formatCurrency(remaining);
    
    if (remaining <= 0) {
        remainingEl.style.color = '#10b981'; // green
    } else {
        remainingEl.style.color = '#dc2626'; // red
    }
    
    const saveBtn = document.getElementById('confirmPaymentBtn');
    
    // Validation
    const isInsuranceCompanyValid = insurance > 0 ? document.getElementById('splitPay_insuranceCompany').value.trim() !== '' : true;
    const isAarogyasriAuthValid = aarogyasri > 0 ? document.getElementById('splitPay_authNumber').value.trim() !== '' : true;
    
    if (totalEntered > 0 && totalEntered <= (outstanding + 0.01) && isInsuranceCompanyValid && isAarogyasriAuthValid) {
        saveBtn.disabled = false;
    } else {
        saveBtn.disabled = true;
    }
}

// Bind realtime calculations
document.addEventListener('DOMContentLoaded', () => {
    const splitInputs = ['cash', 'card', 'phonepe', 'upi', 'insurance', 'aarogyasri', 'credit'];
    splitInputs.forEach(id => {
        const el = document.getElementById('splitPay_' + id);
        if (el) el.addEventListener('input', calculateSplitPayment);
    });
    
    const toggleInputs = ['insuranceCompany', 'authNumber'];
    toggleInputs.forEach(id => {
        const el = document.getElementById('splitPay_' + id);
        if (el) el.addEventListener('input', calculateSplitPayment);
    });

    // DATE FIX 5: Expected Discharge Date >= Admission Date
    const bedAdm = document.getElementById('bedAdmissionDate');
    const bedDis = document.getElementById('bedDischargeDate');
    if (bedAdm && bedDis) {
        bedAdm.addEventListener('change', () => { bedDis.min = bedAdm.value; });
        bedDis.addEventListener('change', () => {
            if (bedDis.value && bedAdm.value && bedDis.value < bedAdm.value) {
                showToast("Expected discharge date must be equal to or after admission date.", "warning");
                bedDis.value = bedAdm.value;
            }
        });
    }

    const admitAdm = document.getElementById('admitAdmissionDate');
    const admitDis = document.getElementById('admitExpectedDischarge');
    if (admitAdm && admitDis) {
        admitAdm.addEventListener('change', () => { admitDis.min = admitAdm.value; });
        admitDis.addEventListener('change', () => {
            if (admitDis.value && admitAdm.value && admitDis.value < admitAdm.value) {
                showToast("Expected discharge date must be equal to or after admission date.", "warning");
                admitDis.value = admitAdm.value;
            }
        });
    }
});

document.getElementById('confirmPaymentBtn') && document.getElementById('confirmPaymentBtn').addEventListener('click', async function() {
    const docId = document.getElementById('payBillDocId').value;
    const bill = allBills.find(b => b.id === docId);
    if (!bill) return;
    
    const cash = parseFloat(document.getElementById('splitPay_cash').value) || 0;
    const card = parseFloat(document.getElementById('splitPay_card').value) || 0;
    const phonepe = parseFloat(document.getElementById('splitPay_phonepe').value) || 0;
    const upi = parseFloat(document.getElementById('splitPay_upi').value) || 0;
    const insurance = parseFloat(document.getElementById('splitPay_insurance').value) || 0;
    const insuranceCompany = document.getElementById('splitPay_insuranceCompany').value.trim();
    const aarogyasri = parseFloat(document.getElementById('splitPay_aarogyasri').value) || 0;
    const authNumber = document.getElementById('splitPay_authNumber').value.trim();
    const credit = parseFloat(document.getElementById('splitPay_credit').value) || 0;
    
    const totalPaid = cash + card + phonepe + upi + insurance + aarogyasri + credit;

    if (totalPaid <= 0) {
        showToast("Please enter an amount.", "warning");
        return;
    }
    
    const outstanding = bill.balanceDue;
    if (totalPaid > (outstanding + 0.01)) {
        showToast("Total entered cannot exceed outstanding balance.", "warning");
        return;
    }
    
    if (insurance > 0 && !insuranceCompany) {
        showToast("Insurance company name is required.", "warning");
        return;
    }
    if (aarogyasri > 0 && !authNumber) {
        showToast("Authorization number is required.", "warning");
        return;
    }
    
    const confirmBtn = document.getElementById('confirmPaymentBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Processing...";
    
    const paymentData = { cash, card, phonepe, upi, insurance, insuranceCompany, aarogyasri, authNumber, credit };
    savePayment(docId, paymentData);
});

function savePayment(billDocId, paymentData) {
    var modes = { cash: 'Cash', card: 'Card', phonepe: 'PhonePe', upi: 'UPI', insurance: 'Insurance', aarogyasri: 'Aarogyasri', credit: 'Credit' };
    var amounts = Object.keys(modes).map(function (key) { return Number(paymentData[key] || 0); });
    var totalPaid = Math.round(amounts.reduce(function (sum, value) { return sum + value; }, 0) * 100) / 100;
    var billRef = db.collection('bills').doc(billDocId);
    var receiptRefs = Object.keys(modes).map(function () { return db.collection('payments').doc(); });
    var auditRef = db.collection('auditLog').doc();
    return db.runTransaction(async function (tx) {
        if (amounts.some(function (amount) { return !Number.isFinite(amount) || amount < 0; }) || totalPaid <= 0) {
            throw new Error('Enter a positive payment with no negative amounts.');
        }
        var snap = await tx.get(billRef);
        if (!snap.exists) throw new Error('Bill no longer exists.');
        var bill = snap.data();
        if (/cancelled|refunded|draft/i.test(bill.status || '')) throw new Error('This bill cannot accept payments.');
        var grandTotal = Number(bill.grandTotal || 0);
        var refunded = Number(bill.refundedAmount || 0);
        var previous = bill.amountPaid !== undefined ? Number(bill.amountPaid) :
            bill.balanceDue !== undefined ? grandTotal - Number(bill.balanceDue) + refunded :
            Number(bill.advancePaid || 0) + Object.values(bill.paymentDetails || {}).reduce(function (sum, detail) { return sum + Number(detail.amount || 0); }, 0);
        if (totalPaid > grandTotal - previous + refunded + 0.001) throw new Error('Payment exceeds the current balance. Another payment may have just been recorded.');
        var paid = Math.round((previous + totalPaid) * 100) / 100;
        var netPaid = Math.round((paid - refunded) * 100) / 100;
        var balance = Math.max(0, Math.round((grandTotal - netPaid) * 100) / 100);
        var details = Object.assign({}, bill.paymentDetails || {});
        var methods = (bill.paymentMethods || []).slice();
        var now = firebase.firestore.FieldValue.serverTimestamp();
        Object.keys(modes).forEach(function (key, index) {
            var amount = amounts[index];
            if (amount <= 0) return;
            var label = modes[key];
            details[label] = Object.assign({}, details[label] || {}, { amount: Math.round((Number((details[label] || {}).amount || 0) + amount) * 100) / 100 });
            if (key === 'insurance') details[label].company = paymentData.insuranceCompany || '';
            if (key === 'aarogyasri') { details[label].scheme = 'Aarogyasri'; details[label].authNo = paymentData.authNumber || ''; }
            if (!methods.includes(label)) methods.push(label);
            tx.set(receiptRefs[index], {
                paymentId: receiptRefs[index].id, billId: bill.billId || billDocId, billDocId: billDocId,
                patientId: bill.patientId || '', patientName: bill.patientName || '', amount: amount,
                paymentMethod: label, type: 'bill_payment', recordedBy: currentUserEmail,
                createdAt: now, recordedAt: now
            });
        });
        var updates = { amountPaid: paid, netPaid: netPaid, balanceDue: balance, paymentStatus: balance === 0 ? 'paid' : 'partial',
            status: balance === 0 ? 'paid' : 'partial', paymentMethods: methods, paymentDetails: details,
            lastPaymentAt: now, lastPaymentBy: currentUserEmail };
        tx.update(billRef, updates);
        if (bill.patientDocId) tx.set(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billDocId),
            Object.assign({}, bill, updates), { merge: true });
        tx.set(auditRef, { action: 'payment_recorded', billId: bill.billId || billDocId,
            patientId: bill.patientId || '', amountPaid: totalPaid, paymentMethod: methods.join(', '),
            newPaymentStatus: updates.paymentStatus, staffEmail: currentUserEmail, timestamp: now });
        return { billDocId: billDocId, bill: Object.assign({}, bill, updates) };
    }).then(async function (ctx) {
        if (typeof ensureLabImagingQueuesForBill === 'function') {
            try { await ensureLabImagingQueuesForBill(ctx.billDocId, ctx.bill); }
            catch (err) { showToast('Payment saved, but the diagnostic queue needs a refresh: ' + err.message, 'warning'); }
        }
        showToast('Payment recorded successfully', 'success');
        closeRecordPaymentModal();
        loadBills();
        if (window.loadFinancialOverview) loadFinancialOverview();
    }).catch(function (err) {
        showToast('Error recording payment: ' + err.message, 'error');
    }).finally(function () {
        const button = document.getElementById('confirmPaymentBtn');
        if (button) { button.disabled = false; button.textContent = 'Save Payment'; }
    });
}

// ==========================================
// EXPORT BILLS (PART 9)
// Both the CSV and the PDF report export exactly what is on screen, so
// what the desk hands over always matches what they were looking at.
// ==========================================
// Must mirror filterAndSearch exactly. It previously matched the tab name
// against b.type, so on the Today and Unpaid tabs — the two the desk actually
// uses — the export produced an empty file while bills sat on screen.
function billsMatchingFilter(filterType, query) {
    let filtered = allBills;
    filterType = filterType || 'Today';

    if (filterType !== 'all') {
        if (filterType === 'Unpaid') {
            filtered = filtered.filter(b => {
                var ps = (b.paymentStatus || 'unpaid').toLowerCase();
                return ps !== 'paid' && ps !== 'cancelled';
            });
        } else if (filterType === 'Today') {
            const todayStr = todayIso();
            filtered = filtered.filter(b => {
                if (b.billDate && String(b.billDate).slice(0, 10) === todayStr) return true;
                if (!b.createdAt) return false;
                const d = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                return isoDate(d) === todayStr;
            });
        } else if (filterType === 'IPD') {
            filtered = filtered.filter(b => b.isRunningBill === true && b.isFinalized === false);
        } else {
            filtered = filtered.filter(b => (b.type || b.billType) === filterType);
        }
    }

    if (query) {
        filtered = filtered.filter(b =>
            (b.billId && b.billId.toLowerCase().includes(query)) ||
            (b.patientName && b.patientName.toLowerCase().includes(query)) ||
            (b.patientId && b.patientId.toLowerCase().includes(query)) ||
            (b.patientPhone && b.patientPhone.includes(query))
        );
    }
    return filtered;
}

function currentlyVisibleBills() {
    const query = (document.getElementById('billSearch').value || '').toLowerCase();
    const filterType = getCurrentFilter();
    return { bills: billsMatchingFilter(filterType, query), filterType: filterType, query: query };
}

document.getElementById('billsReportBtn') && document.getElementById('billsReportBtn').addEventListener('click', function() {
    const view = currentlyVisibleBills();
    var labels = { Today: "Today's bills", Unpaid: 'Unpaid / due bills', IPD: 'Active IPD bills', OPD: 'OPD bills', ER: 'ER bills' };
    const label = (labels[view.filterType] || 'All bills')
        + (view.query ? ' matching "' + view.query + '"' : '');
    hmsBillsReportPDF({
        title: 'Reception bills report',
        bills: view.bills,
        filterLabel: label,
        filename: 'Reception-Bills-' + todayIso()
    });
});

document.getElementById('exportBillsBtn') && document.getElementById('exportBillsBtn').addEventListener('click', function() {
    const filtered = currentlyVisibleBills().bills;

    const exportData = filtered.map(b => ({
        "Bill No": b.billId,
        "Patient Name": b.patientName || '',
        "Patient ID": b.patientId || '',
        "Type": b.type || '',
        "Grand Total": b.grandTotal || 0,
        "Balance Due": b.balanceDue || 0,
        "Payment Status": b.paymentStatus || b.status || '',
        "Report Status": b.reportStatus || '',
        "Payment Methods": b.paymentMethods ? b.paymentMethods.join("; ") : '',
        "Date": b.createdAt ? formatDate(b.createdAt) : ''
    }));
    
    exportToCSV(exportData, "Bills_Export");
});

// ==========================================
// VISIT TYPE → SHOW BED ASSIGNMENT SECTION
// ==========================================
document.querySelectorAll('.visit-type-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.visit-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.querySelector('input') ? btn.querySelector('input').value : '';
        // Also update bill number preview
        const prev = document.getElementById('billNoPreview');
        const year = new Date().getFullYear();
        if (prev) prev.textContent = 'SA-' + val + '-' + year + '-XXXXX';
        const bedSection = document.getElementById('bedAssignmentSection');
        if (bedSection) {
            if (val === 'IPD' || val === 'ICU') {
                bedSection.style.display = 'block';
                const admDate = document.getElementById('bedAdmissionDate');
                if (admDate && !admDate.value) admDate.value = todayIso();
            } else {
                bedSection.style.display = 'none';
                clearBedAssignment();
            }
        }
    });
});

// ==========================================
// BED ASSIGNMENT IN BILLING FORM
// ==========================================
var _billingBedData = null; // holds assigned bed info for this bill

function loadAvailableBedsForWard(ward) {
    var select = document.getElementById('bedNumberSelect');
    if (!select) return;
    if (!ward) {
        select.innerHTML = '<option value="">— Select ward first —</option>';
        return;
    }
    select.innerHTML = '<option value=""><i class="fa-solid fa-spinner"></i> Loading...</option>';
    db.collection('beds')
        .where('ward', '==', ward)
        .where('status', 'in', ['available', 'reserved'])
        .get()
        .then(function(snap) {
            select.innerHTML = '<option value="">Select bed...</option>';
            if (snap.empty) {
                select.innerHTML = '<option value="">No available beds in this ward</option>';
                return;
            }
            snap.forEach(function(doc) {
                var b = doc.data();
                var opt = document.createElement('option');
                opt.value = doc.id;
                opt.dataset.bedNumber = b.bedNumber;
                opt.dataset.dailyRate = b.dailyRate || 0;
                opt.dataset.ward = b.ward;
                opt.dataset.status = b.status;
                opt.textContent = b.bedNumber + ' (₹' + (b.dailyRate || 0).toLocaleString('en-IN') + '/day)'
                    + (b.status === 'reserved' ? ' — Reserved' : '');
                select.appendChild(opt);
            });
        })
        .catch(function(err) {
            select.innerHTML = '<option value="">Error: ' + err.message + '</option>';
        });
}
window.loadAvailableBedsForWard = loadAvailableBedsForWard;

function updateBedChargePreview() {
    var select = document.getElementById('bedNumberSelect');
    var previewEl = document.getElementById('bedChargePreview');
    var breakdownEl = document.getElementById('bedChargeBreakdown');
    if (!select || !previewEl) return;

    var opt = select.options[select.selectedIndex];
    var rate = parseFloat(opt ? opt.dataset.dailyRate : 0) || 0;
    var bedNumber = opt ? opt.dataset.bedNumber : '';

    // Calculate days
    var admDate = document.getElementById('bedAdmissionDate').value;
    var disDate = document.getElementById('bedDischargeDate').value;
    var daysInput = document.getElementById('bedDays');
    var days = 1;
    if (admDate && disDate) {
        var diff = Math.ceil((new Date(disDate) - new Date(admDate)) / (1000 * 60 * 60 * 24));
        if (diff > 0) {
            days = diff;
            if (daysInput) daysInput.value = days;
        }
    } else if (daysInput) {
        days = parseInt(daysInput.value) || 1;
    }

    var total = rate * days;
    if (previewEl) previewEl.textContent = '₹' + total.toLocaleString('en-IN');
    if (breakdownEl) breakdownEl.textContent = bedNumber
        ? bedNumber + ' @ ₹' + rate.toLocaleString('en-IN') + '/day × ' + days + ' days'
        : 'Select ward and bed';
}
window.updateBedChargePreview = updateBedChargePreview;

function assignBedToBill() {
    var select = document.getElementById('bedNumberSelect');
    var opt = select ? select.options[select.selectedIndex] : null;
    if (!opt || !opt.value) { showToast('Please select a bed.', 'warning'); return; }

    var rate = parseFloat(opt.dataset.dailyRate) || 0;
    var bedNumber = opt.dataset.bedNumber || opt.text.split(' ')[0];
    var ward = document.getElementById('bedWardSelect').value;
    var admDate = document.getElementById('bedAdmissionDate').value;
    var disDate = document.getElementById('bedDischargeDate').value;
    var daysInput = document.getElementById('bedDays');
    var days = parseInt(daysInput ? daysInput.value : 1) || 1;
    var total = rate * days;

    _billingBedData = {
        docId: opt.value,
        bedNumber: bedNumber,
        ward: ward,
        dailyRate: rate,
        admissionDate: admDate,
        expectedDischargeDate: disDate,
        days: days,
        chargeAmount: total
    };

    // Add as charge line item
    addChargeRow();
    var rows = document.querySelectorAll('#chargeTableBody tr');
    var lastRow = rows[rows.length - 1];
    if (lastRow) {
        lastRow.querySelector('.item-category').value = 'Bed Charges';
        lastRow.querySelector('.item-desc').value = 'Bed ' + bedNumber + ' (' + ward + ') × ' + days + ' day' + (days !== 1 ? 's' : '');
        lastRow.querySelector('.item-qty').value = days;
        lastRow.querySelector('.item-price').value = rate;
        lastRow.querySelector('.item-amount').value = (total || 0).toFixed(2);
        calculateRowAndTotals();
    }

    // Show confirmation card
    var confirmCard = document.getElementById('assignedBedConfirmCard');
    var confirmText = document.getElementById('assignedBedConfirmText');
    if (confirmCard && confirmText) {
        confirmCard.style.display = 'block';
        confirmText.textContent = 'Bed ' + bedNumber + ' (' + ward + ') assigned — ₹' + total.toLocaleString('en-IN') + ' for ' + days + ' days';
    }

    // Store hidden values
    ['assignedBedDocId', 'assignedBedNumber', 'assignedBedWard', 'assignedBedDailyRate'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            if (id === 'assignedBedDocId') el.value = _billingBedData.docId;
            if (id === 'assignedBedNumber') el.value = bedNumber;
            if (id === 'assignedBedWard') el.value = ward;
            if (id === 'assignedBedDailyRate') el.value = rate;
        }
    });

    showToast('Bed ' + bedNumber + ' added to bill!', 'success');
}
window.assignBedToBill = assignBedToBill;

function clearBedAssignment() {
    _billingBedData = null;
    var card = document.getElementById('assignedBedConfirmCard');
    if (card) card.style.display = 'none';
    ['assignedBedDocId', 'assignedBedNumber', 'assignedBedWard', 'assignedBedDailyRate'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });
}
window.clearBedAssignment = clearBedAssignment;


// ==========================================
// DISCHARGE PATIENT (Part 3)
// ==========================================
var _dischargeBillData = null;

function openDischargeModal(billDocId) {
    var bill = allBills.find(function(b) { return b.id === billDocId; });
    if (!bill) return;
    _dischargeBillData = bill;

    document.getElementById('dischargeBillDocId').value = billDocId;
    document.getElementById('dischargeBedDocId').value = bill.bedDocId || bill.bedId || '';
    document.getElementById('actualDischargeDate').value = todayIso();
    document.getElementById('extraDaysCount').value = 0;
    document.getElementById('dischargeNotes').value = '';
    document.getElementById('extraChargesSection').style.display = 'none';

    var info = document.getElementById('dischargePatientInfo');
    if (info) {
        info.innerHTML = '<strong>' + (bill.patientName || '—') + '</strong> · ' + (bill.patientId || '')
            + '<br><span style="color:#0D7A70;"><i class="fa-solid fa-bed" style="margin-right:4px;"></i>Bed: ' + (bill.bedNumber || '—') + ' (' + (bill.bedWard || '') + ')</span>'
            + '<br><small style="color:#64748b;">Admission: ' + (bill.admissionDate || '—') + ' · Expected discharge: ' + (bill.expectedDischargeDate || '—') + '</small>';
    }
    document.getElementById('dischargeModal').style.display = 'flex';
}
window.openDischargeModal = openDischargeModal;

function calculateExtraDays() {
    if (!_dischargeBillData) return;
    var actual = document.getElementById('actualDischargeDate').value;
    var expected = _dischargeBillData.expectedDischargeDate;
    var extraDaysEl = document.getElementById('extraDaysCount');
    var extraSection = document.getElementById('extraChargesSection');
    var extraText = document.getElementById('extraChargesText');

    if (actual && expected && actual > expected) {
        var extra = Math.ceil((new Date(actual) - new Date(expected)) / (1000 * 60 * 60 * 24));
        if (extra > 0 && extraDaysEl) {
            extraDaysEl.value = extra;
            var rate = _dischargeBillData.dailyRate || 0;
            var extraAmt = extra * rate;
            if (extraSection) extraSection.style.display = 'block';
            if (extraText) extraText.innerHTML = extra + ' extra day(s) × ₹' + rate.toLocaleString('en-IN') + '/day = <strong>₹' + extraAmt.toLocaleString('en-IN') + '</strong>';
            return;
        }
    }
    if (extraDaysEl) extraDaysEl.value = 0;
    if (extraSection) extraSection.style.display = 'none';
}
window.calculateExtraDays = calculateExtraDays;

async function confirmDischarge() {
    var billDocId = document.getElementById('dischargeBillDocId').value;
    var bedDocId = document.getElementById('dischargeBedDocId').value;
    var actualDate = document.getElementById('actualDischargeDate').value;
    var extraDays = parseInt(document.getElementById('extraDaysCount').value) || 0;
    var addExtra = document.getElementById('addExtraChargesCheck').checked;
    var notes = document.getElementById('dischargeNotes').value.trim();

    if (!billDocId) { showToast('Bill not found.', 'error'); return; }

    var bill = allBills.find(function(b) { return b.id === billDocId; });
    if (!bill) { showToast('Bill data not found.', 'error'); return; }

    var btn = document.querySelector('#dischargeModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    try {
        var batch = db.batch();

        // 1. Update bed status
        if (bedDocId) {
            batch.update(db.collection('beds').doc(bedDocId), {
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
        }

        // 2. Update admission record
        if (bill.activeAdmissionId) {
            batch.update(db.collection('admissions').doc(bill.activeAdmissionId), {
                status: 'discharged',
                actualDischargeDate: actualDate,
                dischargedBy: currentUserEmail,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        // 3. Extra bed charges on bill
        var billUpdate = {
            dischargeDate: actualDate,
            dischargeNotes: notes,
            isIPDClosed: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (addExtra && extraDays > 0 && bill.dailyRate > 0) {
            var extraAmt = extraDays * (bill.dailyRate || 0);
            var newItem = {
                category: 'Bed Charges',
                description: 'Extra stay — ' + extraDays + ' additional day(s)',
                quantity: extraDays,
                unitPrice: bill.dailyRate,
                amount: extraAmt
            };
            var updatedItems = [...(bill.items || []), newItem];
            var newSubtotal = updatedItems.reduce(function(s, i) { return s + i.amount; }, 0);
            var discAmt = newSubtotal * ((bill.discountPercent || 0) / 100);
            var gstAmt = (newSubtotal - discAmt) * ((bill.gstPercent || 0) / 100);
            var newGrand = newSubtotal - discAmt + gstAmt;
            var newBalance = newGrand - (bill.advancePaid || 0);
            Object.assign(billUpdate, {
                items: updatedItems,
                subtotal: newSubtotal,
                discountAmount: discAmt,
                gstAmount: gstAmt,
                grandTotal: newGrand,
                balanceDue: newBalance,
                paymentStatus: newBalance <= 0 ? 'paid' : 'partial'
            });
        }

        batch.update(db.collection('bills').doc(billDocId), billUpdate);
        if (bill.patientDocId) {
            batch.update(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billDocId), billUpdate);
        }

        // 4. Audit log
        batch.set(db.collection('auditLog').doc(), {
            action: 'patient_discharged',
            billId: bill.billId,
            patientId: bill.patientId,
            patientName: bill.patientName,
            bedNumber: bill.bedNumber || '',
            dischargeDate: actualDate,
            staffEmail: currentUserEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        document.getElementById('dischargeModal').style.display = 'none';
        showToast('Patient discharged. Bed ' + (bill.bedNumber || '') + ' is now being cleaned.', 'success');
        
        // FIX 8: Auto-generate the consolidated final bill PDF on discharge
        if (bill.patientId) {
            setTimeout(function() {
                if (confirm('Patient discharged successfully. Would you like to generate the Consolidated Final Bill PDF now?')) {
                    generateConsolidatedFinalBillPDF(bill.patientId);
                }
            }, 500);
        }
    } catch (err) {
        console.error('Discharge error:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm Discharge'; }
    }
}
window.confirmDischarge = confirmDischarge;

// ==========================================
// PATIENT STATUS BADGE HELPER
// ==========================================
function getPatientStatusBadge(status) {
    return statusBadge(status, 'opd');
}
window.getPatientStatusBadge = getPatientStatusBadge;

// ==========================================
// TRANSFER BUTTONS — per bill type/status
// ==========================================
function getTransferButtons(bill) {
    var type = (bill.type || '').toUpperCase();
    var btns = [];

    if (type === 'OPD') {
        // Don't show Admit/ER if already transferred (linkedToBillId or patient is admitted)
        if (!bill.transferredTo) {
            btns.push('<button class="btn-primary admit-ipd-btn" data-id="' + bill.id + '" style="padding:3px 7px;font-size:0.75rem;background:#2563eb;border-color:#2563eb;white-space:nowrap;">' +
                '<i class="fa-solid fa-bed-pulse"></i> Admit IPD</button>');
            btns.push('<button class="btn-primary move-er-btn" data-id="' + bill.id + '" style="padding:3px 7px;font-size:0.75rem;background:#dc2626;border-color:#dc2626;white-space:nowrap;">' +
                '<i class="fa-solid fa-truck-medical"></i> Move ER</button>');
        } else {
            btns.push('<span style="font-size:11px;color:#64748b;">→ ' + (bill.transferredTo || '') + '</span>');
        }
    } else if (type === 'ER') {
        if (!bill.transferredTo) {
            btns.push('<button class="btn-primary transfer-icu-btn" data-id="' + bill.id + '" style="padding:3px 7px;font-size:0.75rem;background:#7c3aed;border-color:#7c3aed;white-space:nowrap;">' +
                '<i class="fa-solid fa-heart-pulse"></i> → ICU</button>');
        } else {
            btns.push('<span style="font-size:11px;color:#64748b;">→ ICU</span>');
        }
    } else if ((type === 'IPD' || type === 'ICU') && bill.bedNumber && !bill.isIPDClosed) {
        btns.push('<button class="btn-secondary discharge-btn" data-id="' + bill.id + '" style="padding:3px 7px;font-size:0.75rem;background:#ca8a04;color:white;border-color:#ca8a04;white-space:nowrap;">' +
            '<i class="fa-solid fa-right-from-bracket"></i> Discharge</button>');
    }

    if (!btns.length) return '-';
    return '<div style="display:flex;flex-direction:column;gap:4px;">' + btns.join('') + '</div>';
}
window.getTransferButtons = getTransferButtons;

// ==========================================
// ADMIT TO IPD
// ==========================================
var _admitBillData = null;

function openAdmitToIPDModal(billDocId) {
    var bill = allBills.find(function(b) { return b.id === billDocId; });
    if (!bill) return;
    _admitBillData = bill;
    document.getElementById('admitFromBillDocId').value = billDocId;
    document.getElementById('admitTransferReason').value = '';
    document.getElementById('admitWardSelect').value = '';
    document.getElementById('admitBedSelect').innerHTML = '<option value="">— Select ward first —</option>';
    document.getElementById('admitAdmissionDate').value = todayIso();
    document.getElementById('admitExpectedDischarge').value = '';
    document.getElementById('admitPatientInfo').innerHTML =
        '<i class="fa-solid fa-user" style="color:#2563eb;margin-right:6px;"></i>' +
        '<strong>' + (bill.patientName || '—') + '</strong> · ' + (bill.patientId || '') +
        '<br><span style="color:#64748b;font-size:11px;">Previous Bill: ' + (bill.billId || '') + ' (' + (bill.type || '') + ')</span>';
    document.getElementById('admitToIPDModal').style.display = 'flex';
}
window.openAdmitToIPDModal = openAdmitToIPDModal;

function loadBedsForAdmit(ward) {
    var sel = document.getElementById('admitBedSelect');
    if (!sel) return;
    if (!ward) { sel.innerHTML = '<option value="">— Select ward first —</option>'; return; }
    sel.innerHTML = '<option value="">Loading...</option>';
    db.collection('beds').where('ward', '==', ward).where('status', 'in', ['available', 'reserved']).get()
    .then(function(snap) {
        sel.innerHTML = '<option value="">Select bed...</option>';
        if (snap.empty) { sel.innerHTML = '<option value="">No available beds in ' + ward + '</option>'; return; }
        snap.forEach(function(doc) {
            var b = doc.data();
            var opt = document.createElement('option');
            opt.value = doc.id;
            opt.dataset.bedNumber = b.bedNumber;
            opt.dataset.dailyRate = b.dailyRate || 0;
            opt.textContent = b.bedNumber + ' — ₹' + (b.dailyRate || 0).toLocaleString('en-IN') + '/day';
            sel.appendChild(opt);
        });
    }).catch(function(e) { sel.innerHTML = '<option value="">Error: ' + e.message + '</option>'; });
}
window.loadBedsForAdmit = loadBedsForAdmit;

async function confirmAdmitToIPD() {
    if (!_admitBillData) return;
    var bill = _admitBillData;
    var reason = document.getElementById('admitTransferReason').value.trim();
    if (!reason) { showToast('Please enter a transfer reason.', 'warning'); return; }
    var bedSel = document.getElementById('admitBedSelect');
    var bedOpt = bedSel.options[bedSel.selectedIndex];
    var bedDocId = bedSel.value;
    if (!bedDocId) { showToast('Please select a bed.', 'warning'); return; }
    var bedNumber = bedOpt.dataset.bedNumber || '';
    var dailyRate = parseFloat(bedOpt.dataset.dailyRate) || 0;
    var ward = document.getElementById('admitWardSelect').value;
    var admDate = document.getElementById('admitAdmissionDate').value;
    var expDis = document.getElementById('admitExpectedDischarge').value;

    var btn = document.querySelector('#admitToIPDModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating IPD Bill...'; }

    try {
        var ipdBillNo = await generateBillNumber('IPD');
        var ipdBillRef = db.collection('bills').doc();
        var admissionRef = db.collection('admissions').doc();
        var batch = db.batch();

        var ipdBillData = {
            billId: ipdBillNo,
            patientId: bill.patientId,
            patientDocId: bill.patientDocId,
            patientName: bill.patientName,
            patientPhone: bill.patientPhone || '',
            type: 'IPD',
            visitDoctor: bill.visitDoctor || '',
            visitDepartment: bill.visitDepartment || '',
            linkedFromBillId: bill.billId,
            linkedFromType: bill.type,
            transferReason: reason,
            transferDate: firebase.firestore.FieldValue.serverTimestamp(),
            bedDocId: bedDocId,
            bedNumber: bedNumber,
            bedWard: ward,
            dailyRate: dailyRate,
            admissionDate: admDate,
            expectedDischargeDate: expDis || null,
            isIPDClosed: false,
            isRunningBill: true,
            isFinalized: false,
            daysOfStay: 0,
            dailyCharges: [],
            additionalCharges: [],
            lastChargeUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            items: [{ category: 'Bed Charges', description: 'Bed ' + bedNumber + ' (' + ward + ')', quantity: 1, unitPrice: dailyRate, amount: dailyRate, addedAt: new Date().toISOString() }],
            subtotal: dailyRate, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0,
            grandTotal: dailyRate, advancePaid: 0, balanceDue: dailyRate,
            paymentMethods: [], paymentDetails: {},
            paymentStatus: 'unpaid', reportStatus: 'not_applicable',
            status: 'due',
            createdBy: currentUserEmail,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        batch.set(ipdBillRef, ipdBillData);
        if (bill.patientDocId) {
            batch.set(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(ipdBillRef.id), ipdBillData);
        }
        // Mark OPD bill as transferred
        batch.update(db.collection('bills').doc(bill.id), {
            transferredTo: ipdBillNo, transferredType: 'IPD',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Update bed
        batch.update(db.collection('beds').doc(bedDocId), {
            status: 'occupied', patientId: bill.patientId, patientDocId: bill.patientDocId,
            patientName: bill.patientName, billId: ipdBillNo, billDocId: ipdBillRef.id,
            admittedAt: admDate, expectedDischargeDate: expDis || null,
            activeAdmissionId: admissionRef.id, assignedBy: currentUserEmail,
            assignedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Admission record
        batch.set(admissionRef, {
            patientId: bill.patientId, patientDocId: bill.patientDocId, patientName: bill.patientName,
            bedDocId: bedDocId, bedNumber: bedNumber, ward: ward, billId: ipdBillNo,
            billDocId: ipdBillRef.id, dailyRate: dailyRate, admissionDate: admDate,
            expectedDischargeDate: expDis || null, linkedFromBillId: bill.billId,
            status: 'admitted', admittedBy: currentUserEmail,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Update patient status
        if (bill.patientDocId) {
            batch.update(db.collection('patients').doc(bill.patientDocId), {
                status: 'admitted', currentBillId: ipdBillNo,
                currentBedId: bedDocId, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        // Audit log
        batch.set(db.collection('auditLog').doc(), {
            action: 'opd_to_ipd_transfer', fromBillId: bill.billId, toBillId: ipdBillNo,
            patientId: bill.patientId, patientName: bill.patientName,
            bedNumber: bedNumber, ward: ward, reason: reason,
            staffEmail: currentUserEmail, timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        document.getElementById('admitToIPDModal').style.display = 'none';
        showToast('Patient admitted. IPD Bill ' + ipdBillNo + ' created!', 'success');
        _admitBillData = null;
    } catch (err) {
        console.error('Admit to IPD error:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bed-pulse"></i> Confirm Admission'; }
    }
}
window.confirmAdmitToIPD = confirmAdmitToIPD;

// ==========================================
// MOVE TO ER
// ==========================================
var _erBillData = null;

function openMoveToERModal(billDocId) {
    var bill = allBills.find(function(b) { return b.id === billDocId; });
    if (!bill) return;
    _erBillData = bill;
    document.getElementById('erFromBillDocId').value = billDocId;
    document.getElementById('erReason').value = '';
    document.getElementById('erPatientInfo').innerHTML =
        '<i class="fa-solid fa-triangle-exclamation" style="color:#dc2626;margin-right:6px;"></i>' +
        '<strong>' + (bill.patientName || '—') + '</strong> · ' + (bill.patientId || '') +
        '<br><span style="color:#64748b;font-size:11px;">Previous Bill: ' + (bill.billId || '') + '</span>';
    document.getElementById('moveToERModal').style.display = 'flex';
}
window.openMoveToERModal = openMoveToERModal;

async function confirmMoveToER() {
    if (!_erBillData) return;
    var bill = _erBillData;
    var reason = document.getElementById('erReason').value.trim();
    if (!reason) { showToast('Please enter the emergency reason.', 'warning'); return; }

    var btn = document.querySelector('#moveToERModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating ER Bill...'; }

    try {
        var erBillNo = await generateBillNumber('ER');
        var erBillRef = db.collection('bills').doc();
        var batch = db.batch();

        var erBillData = {
            billId: erBillNo, patientId: bill.patientId, patientDocId: bill.patientDocId,
            patientName: bill.patientName, patientPhone: bill.patientPhone || '',
            type: 'ER', visitDoctor: bill.visitDoctor || '', visitDepartment: 'Emergency',
            linkedFromBillId: bill.billId, linkedFromType: bill.type,
            transferReason: reason, transferDate: firebase.firestore.FieldValue.serverTimestamp(),
            items: [{ category: 'Consultation', description: 'Emergency Consultation', quantity: 1, unitPrice: 0, amount: 0 }],
            subtotal: 0, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0,
            grandTotal: 0, advancePaid: 0, balanceDue: 0,
            paymentMethods: [], paymentDetails: {},
            paymentStatus: 'unpaid', reportStatus: 'not_applicable', status: 'draft',
            createdBy: currentUserEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        batch.set(erBillRef, erBillData);
        if (bill.patientDocId) {
            batch.set(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(erBillRef.id), erBillData);
        }
        batch.update(db.collection('bills').doc(bill.id), {
            transferredTo: erBillNo, transferredType: 'ER',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (bill.patientDocId) {
            batch.update(db.collection('patients').doc(bill.patientDocId), {
                status: 'emergency', currentBillId: erBillNo,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        batch.set(db.collection('auditLog').doc(), {
            action: 'transferred_to_er', fromBillId: bill.billId, toBillId: erBillNo,
            patientId: bill.patientId, patientName: bill.patientName, reason: reason,
            staffEmail: currentUserEmail, timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        document.getElementById('moveToERModal').style.display = 'none';
        showToast('Patient moved to Emergency. ER Bill ' + erBillNo + ' created!', 'success');
        _erBillData = null;
    } catch (err) {
        console.error('Move to ER error:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Confirm Emergency'; }
    }
}
window.confirmMoveToER = confirmMoveToER;

// ==========================================
// TRANSFER TO ICU
// ==========================================
var _icuBillData = null;

function openTransferToICUModal(billDocId) {
    var bill = allBills.find(function(b) { return b.id === billDocId; });
    if (!bill) return;
    _icuBillData = bill;
    document.getElementById('icuFromBillDocId').value = billDocId;
    document.getElementById('icuReason').value = '';
    document.getElementById('icuPatientInfo').innerHTML =
        '<i class="fa-solid fa-heart-pulse" style="color:#7c3aed;margin-right:6px;"></i>' +
        '<strong>' + (bill.patientName || '—') + '</strong> · ' + (bill.patientId || '') +
        '<br><span style="color:#64748b;font-size:11px;">From: ' + (bill.billId || '') + ' (' + (bill.type || '') + ')</span>';
    // Load ICU beds
    var sel = document.getElementById('icuBedSelect');
    sel.innerHTML = '<option value="">Loading ICU beds...</option>';
    db.collection('beds').where('ward', '==', 'ICU').where('status', 'in', ['available', 'reserved']).get()
    .then(function(snap) {
        sel.innerHTML = '<option value="">Select ICU bed...</option>';
        if (snap.empty) { sel.innerHTML = '<option value="">No ICU beds available</option>'; return; }
        snap.forEach(function(doc) {
            var b = doc.data();
            var opt = document.createElement('option');
            opt.value = doc.id;
            opt.dataset.bedNumber = b.bedNumber;
            opt.dataset.dailyRate = b.dailyRate || 0;
            opt.textContent = b.bedNumber + ' — ₹' + (b.dailyRate || 0).toLocaleString('en-IN') + '/day';
            sel.appendChild(opt);
        });
    }).catch(function(e) { sel.innerHTML = '<option value="">Error: ' + e.message + '</option>'; });
    document.getElementById('transferToICUModal').style.display = 'flex';
}
window.openTransferToICUModal = openTransferToICUModal;

async function confirmTransferToICU() {
    if (!_icuBillData) return;
    var bill = _icuBillData;
    var reason = document.getElementById('icuReason').value.trim();
    if (!reason) { showToast('Please enter the ICU transfer reason.', 'warning'); return; }
    var bedSel = document.getElementById('icuBedSelect');
    var bedOpt = bedSel.options[bedSel.selectedIndex];
    var bedDocId = bedSel.value;
    if (!bedDocId) { showToast('Please select an ICU bed.', 'warning'); return; }
    var bedNumber = bedOpt.dataset.bedNumber || '';
    var dailyRate = parseFloat(bedOpt.dataset.dailyRate) || 0;

    var btn = document.querySelector('#transferToICUModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Transferring...'; }

    try {
        var icuBillNo = await generateBillNumber('ICU');
        var icuBillRef = db.collection('bills').doc();
        var admissionRef = db.collection('admissions').doc();
        var today = todayIso();
        var batch = db.batch();

        var icuBillData = {
            billId: icuBillNo, patientId: bill.patientId, patientDocId: bill.patientDocId,
            patientName: bill.patientName, patientPhone: bill.patientPhone || '',
            type: 'ICU', visitDoctor: bill.visitDoctor || '', visitDepartment: 'ICU',
            linkedFromBillId: bill.billId, linkedFromType: bill.type,
            transferReason: reason, transferDate: firebase.firestore.FieldValue.serverTimestamp(),
            bedDocId: bedDocId, bedNumber: bedNumber, bedWard: 'ICU', dailyRate: dailyRate,
            admissionDate: today, isIPDClosed: false,
            isRunningBill: true,
            isFinalized: false,
            daysOfStay: 0,
            dailyCharges: [],
            additionalCharges: [],
            lastChargeUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            items: [{ category: 'Bed Charges', description: 'ICU Bed ' + bedNumber, quantity: 1, unitPrice: dailyRate, amount: dailyRate, addedAt: new Date().toISOString() }],
            subtotal: dailyRate, discountPercent: 0, discountAmount: 0, gstPercent: 0, gstAmount: 0,
            grandTotal: dailyRate, advancePaid: 0, balanceDue: dailyRate,
            paymentMethods: [], paymentDetails: {},
            paymentStatus: 'unpaid', reportStatus: 'not_applicable', status: 'due',
            createdBy: currentUserEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        batch.set(icuBillRef, icuBillData);
        if (bill.patientDocId) {
            batch.set(db.collection('patients').doc(bill.patientDocId).collection('bills').doc(icuBillRef.id), icuBillData);
        }
        // Mark ER bill as transferred
        batch.update(db.collection('bills').doc(bill.id), {
            transferredTo: icuBillNo, transferredType: 'ICU',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Assign ICU bed
        batch.update(db.collection('beds').doc(bedDocId), {
            status: 'occupied', patientId: bill.patientId, patientDocId: bill.patientDocId,
            patientName: bill.patientName, billId: icuBillNo, billDocId: icuBillRef.id,
            admittedAt: today, activeAdmissionId: admissionRef.id,
            assignedBy: currentUserEmail, assignedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Release ER bed if it was occupied
        if (bill.bedDocId) {
            batch.update(db.collection('beds').doc(bill.bedDocId), {
                status: 'cleaning', patientId: null, patientName: null, billId: null,
                dischargedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        // Admission record
        batch.set(admissionRef, {
            patientId: bill.patientId, patientDocId: bill.patientDocId, patientName: bill.patientName,
            bedDocId: bedDocId, bedNumber: bedNumber, ward: 'ICU', billId: icuBillNo,
            billDocId: icuBillRef.id, dailyRate: dailyRate, admissionDate: today,
            linkedFromBillId: bill.billId, status: 'admitted', admittedBy: currentUserEmail,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Update patient status
        if (bill.patientDocId) {
            batch.update(db.collection('patients').doc(bill.patientDocId), {
                status: 'icu', currentBillId: icuBillNo, currentBedId: bedDocId,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        // Audit log
        batch.set(db.collection('auditLog').doc(), {
            action: 'transferred_to_icu', fromBillId: bill.billId, toBillId: icuBillNo,
            patientId: bill.patientId, patientName: bill.patientName,
            bedNumber: bedNumber, reason: reason,
            staffEmail: currentUserEmail, timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        document.getElementById('transferToICUModal').style.display = 'none';
        showToast('Patient transferred to ICU. ICU Bill ' + icuBillNo + ' created!', 'success');
        _icuBillData = null;
    } catch (err) {
        console.error('Transfer to ICU error:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-heart-pulse"></i> Confirm ICU Transfer'; }
    }
}
window.confirmTransferToICU = confirmTransferToICU;

// ==========================================
// IPD RUNNING BILLS - CHARGES & DISCHARGE (PART 2 & 5)
// ==========================================
function addChargeToRunningBill(billDocId, charge) {
    var db = firebase.firestore();
    var billRef = db.collection('bills').doc(billDocId);
    return db.runTransaction(function(transaction) {
        return transaction.get(billRef).then(function(doc) {
            if (!doc.exists) throw new Error('Bill not found');
            var bill = doc.data();
            if (bill.isFinalized) throw new Error('Cannot add charges to finalized bill');

            var newItems = (bill.items || []).slice();
            newItems.push({
                category: charge.category,
                description: charge.description,
                quantity: charge.quantity || 1,
                unitPrice: charge.unitPrice,
                amount: charge.amount,
                addedAt: new Date().toISOString(),
                addedBy: currentUserEmail,
                isRunningCharge: true
            });

            var newSubtotal = newItems.reduce(function(sum, i) { return sum + (i.amount || 0); }, 0);
            
            // Dynamically recalculate discount and GST to keep calculations mathematically correct
            var newDiscountAmount = bill.discountAmount || 0;
            if (bill.discountPercent && bill.discountPercent > 0) {
                newDiscountAmount = newSubtotal * (bill.discountPercent / 100);
            }
            var afterDiscount = newSubtotal - newDiscountAmount;
            
            var newGstAmount = bill.gstAmount || 0;
            if (bill.gstPercent && bill.gstPercent > 0) {
                newGstAmount = afterDiscount * (bill.gstPercent / 100);
            }
            
            var newGrandTotal = afterDiscount + newGstAmount;
            var newBalanceDue = newGrandTotal - (bill.amountPaid || 0);

            var updatedData = {
                items: newItems,
                subtotal: newSubtotal,
                discountAmount: newDiscountAmount,
                gstAmount: newGstAmount,
                grandTotal: newGrandTotal,
                balanceDue: newBalanceDue,
                paymentStatus: (bill.amountPaid || 0) >= newGrandTotal ? 'paid' : (bill.amountPaid || 0) > 0 ? 'partial' : 'unpaid',
                lastChargeUpdate: firebase.firestore.FieldValue.serverTimestamp(),
                lastUpdatedBy: currentUserEmail
            };

            transaction.update(billRef, updatedData);
            
            // Also sync patient-subcollection bill
            if (bill.patientDocId) {
                var patientBillRef = db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billDocId);
                transaction.update(patientBillRef, updatedData);
            }
        });
    }).then(function() {
        showToast('Charge added to running bill', 'success');
        loadBills();
    }).catch(function(err) {
        console.error("Add charge error:", err);
        showToast("Error adding charge: " + err.message, "error");
    });
}
window.addChargeToRunningBill = addChargeToRunningBill;

function finalizeBill(billDocId) {
    var db = firebase.firestore();
    var billRef = db.collection('bills').doc(billDocId);
    return db.runTransaction(function(transaction) {
        return transaction.get(billRef).then(function(doc) {
            if (!doc.exists) throw new Error('Bill not found');
            var bill = doc.data();
            if (bill.isFinalized) throw new Error('Already finalized');
            
            var updatedData = {
                isFinalized: true,
                isRunningBill: false,
                finalizedAt: firebase.firestore.FieldValue.serverTimestamp(),
                finalizedBy: currentUserEmail,
                dischargeDate: new Date().toISOString().slice(0, 10),
                reportStatus: 'delivered'
            };

            transaction.update(billRef, updatedData);
            
            // Sync patient subcollection
            if (bill.patientDocId) {
                var patientBillRef = db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billDocId);
                transaction.update(patientBillRef, updatedData);
            }
            
            // Also update bed to cleaning status
            var bedId = bill.bedDocId || bill.bedId;
            if (bedId) {
                var bedRef = db.collection('beds').doc(bedId);
                transaction.update(bedRef, {
                    status: 'cleaning',
                    patientId: null,
                    patientName: null,
                    releasedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            
            // Update patient status — use only patientDocId (patientId is a sequential ID, not a doc key)
            if (bill.patientDocId) {
                transaction.update(db.collection('patients').doc(bill.patientDocId), {
                    status: 'discharged',
                    currentBedId: null,
                    currentBillId: null,
                    dischargedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            
            // Audit Log
            transaction.set(db.collection('auditLog').doc(), {
                action: 'discharge_and_finalize',
                billId: bill.billId,
                patientId: bill.patientId,
                patientName: bill.patientName,
                staffEmail: currentUserEmail,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
    }).then(function() {
        showToast('Bill finalized and patient discharged', 'success');
        loadBills();
    }).catch(function(err) {
        console.error("Finalize bill error:", err);
        showToast("Error finalizing bill: " + err.message, "error");
    });
}
window.finalizeBill = finalizeBill;

// ==========================================
// IPD RUNNING BILLS - MODAL LAYOUTS & ACTIONS (PART 4)
// ==========================================
function openRunningBillModal(bill) {
    document.getElementById('runningBillDocId').value = bill.id;
    document.getElementById('runningBillPtName').textContent = bill.patientName || '—';
    document.getElementById('runningBillPtId').textContent = bill.patientId || '—';
    document.getElementById('runningBillPtPhone').textContent = bill.patientPhone || '—';
    document.getElementById('runningBillBedNo').textContent = bill.bedNumber || '—';
    document.getElementById('runningBillWard').textContent = bill.bedWard || bill.ward || '—';
    document.getElementById('runningBillAdmitDate').textContent = bill.admissionDate || '—';
    document.getElementById('runningBillDailyRate').textContent = '\u20B9' + (bill.dailyRate || 0).toLocaleString('en-IN') + '/day';

    // Populate day-wise summary
    const daysMap = {};
    const daysStayed = bill.daysOfStay || 1;
    const admissionDateStr = bill.admissionDate;

    if (admissionDateStr) {
        const admDate = new Date(admissionDateStr);
        for (let i = 0; i < daysStayed; i++) {
            const d = new Date(admDate);
            d.setDate(d.getDate() + i);
            const dStr = d.toISOString().slice(0, 10);
            daysMap[i + 1] = {
                day: i + 1,
                date: dStr,
                bedCharge: 0,
                otherCharges: [],
                otherTotal: 0,
                total: 0
            };
        }
    }

    const items = bill.items || [];
    items.forEach(item => {
        let itemDateStr = '';
        if (item.addedAt) {
            itemDateStr = item.addedAt.slice(0, 10);
        } else {
            const bDate = bill.createdAt ? (bill.createdAt.toDate ? bill.createdAt.toDate() : new Date(bill.createdAt)) : new Date();
            itemDateStr = bDate.toISOString().slice(0, 10);
        }

        let dayNum = 1;
        if (admissionDateStr) {
            const start = new Date(admissionDateStr);
            start.setHours(0, 0, 0, 0);
            const end = new Date(itemDateStr);
            end.setHours(0, 0, 0, 0);
            const diff = Math.floor((end - start) / (1000 * 60 * 60 * 24));
            dayNum = diff + 1;
        }

        if (!daysMap[dayNum]) {
            daysMap[dayNum] = {
                day: dayNum,
                date: itemDateStr,
                bedCharge: 0,
                otherCharges: [],
                otherTotal: 0,
                total: 0
            };
        }

        const amt = parseFloat(item.amount) || 0;
        if (item.category === 'Bed Charges') {
            daysMap[dayNum].bedCharge += amt;
        } else {
            daysMap[dayNum].otherCharges.push(`${item.description || item.category} (₹${amt.toFixed(2)})`);
            daysMap[dayNum].otherTotal += amt;
        }
        daysMap[dayNum].total += amt;
    });

    const tbody = document.getElementById('runningBillDaysTbody');
    tbody.innerHTML = '';

    Object.keys(daysMap).sort((a, b) => a - b).forEach(dayKey => {
        const dInfo = daysMap[dayKey];
        const otherStr = dInfo.otherCharges.length > 0 ? dInfo.otherCharges.join(', ') : 'None';
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        tr.innerHTML = `
            <td style="padding:10px;">Day ${dInfo.day}</td>
            <td style="padding:10px;">${dInfo.date}</td>
            <td style="padding:10px;">₹${dInfo.bedCharge.toFixed(2)}</td>
            <td style="padding:10px; font-size:12px; color:#475569; max-width:300px; word-wrap:break-word;">${otherStr}</td>
            <td style="padding:10px; text-align:right; font-weight:600;">₹${dInfo.total.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Totals Summary
    document.getElementById('runningBillSubtotal').textContent = '₹' + (bill.subtotal || 0).toFixed(2);
    document.getElementById('runningBillDiscount').textContent = (bill.discountAmount || 0).toFixed(2);
    document.getElementById('runningBillGst').textContent = (bill.gstAmount || 0).toFixed(2);
    document.getElementById('runningBillGrandTotal').textContent = (bill.grandTotal || 0).toFixed(2);
    document.getElementById('runningBillPaid').textContent = (bill.amountPaid || 0).toFixed(2);
    document.getElementById('runningBillBalance').textContent = (bill.balanceDue || 0).toFixed(2);

    // Show Discharge button only for Admin and Receptionist roles
    const dischargeBtn = document.getElementById('runningBillDischargeBtn');
    if (dischargeBtn) {
        getCurrentUser(function(u) {
            const role = (u.role || '').toLowerCase();
            if (role === 'admin' || role === 'receptionist') {
                dischargeBtn.style.display = 'block';
            } else {
                dischargeBtn.style.display = 'none';
            }
        });
    }

    // Bind action clicks inside modal
    document.getElementById('runningBillAddChargeBtn').onclick = function() {
        document.getElementById('runningBillModal').style.display = 'none';
        openAddChargeModal(bill.id);
    };

    document.getElementById('runningBillPayBtn').onclick = function() {
        document.getElementById('runningBillModal').style.display = 'none';
        openRecordPaymentModal(bill.id);
    };

    if (dischargeBtn) {
        dischargeBtn.onclick = function() {
            if (confirm("Are you sure you want to discharge the patient and finalize this bill? No more charges can be added once finalized.")) {
                document.getElementById('runningBillModal').style.display = 'none';
                finalizeBill(bill.id);
            }
        };
    }

    document.getElementById('runningBillModal').style.display = 'flex';
}
window.openRunningBillModal = openRunningBillModal;

function openAddChargeModal(billDocId) {
    document.getElementById('addChargeBillDocId').value = billDocId;
    document.getElementById('addChargeCategory').value = 'Lab Test';
    document.getElementById('addChargeDescription').value = '';
    document.getElementById('addChargeQuantity').value = 1;
    document.getElementById('addChargeUnitPrice').value = 0;
    document.getElementById('addChargeAmount').value = 0.00;
    document.getElementById('addChargeNotes').value = '';
    document.getElementById('addChargeModal').style.display = 'flex';
}
window.openAddChargeModal = openAddChargeModal;

function calculateAddChargeAmount() {
    const qty = parseFloat(document.getElementById('addChargeQuantity').value) || 0;
    const price = parseFloat(document.getElementById('addChargeUnitPrice').value) || 0;
    document.getElementById('addChargeAmount').value = (qty * price).toFixed(2);
}
window.calculateAddChargeAmount = calculateAddChargeAmount;

function submitAddChargeToRunningBill() {
    const billDocId = document.getElementById('addChargeBillDocId').value;
    const category = document.getElementById('addChargeCategory').value;
    const description = document.getElementById('addChargeDescription').value.trim();
    const quantity = parseFloat(document.getElementById('addChargeQuantity').value) || 1;
    const unitPrice = parseFloat(document.getElementById('addChargeUnitPrice').value) || 0;
    const amount = quantity * unitPrice;
    
    if (!description) {
        showToast("Please enter a description for the charge.", "warning");
        return;
    }
    
    const charge = {
        category: category,
        description: description,
        quantity: quantity,
        unitPrice: unitPrice,
        amount: amount
    };
    
    addChargeToRunningBill(billDocId, charge);
    document.getElementById('addChargeModal').style.display = 'none';
}
window.submitAddChargeToRunningBill = submitAddChargeToRunningBill;

// ==========================================
// MOVE TO OPERATION THEATRE (OT) WORKFLOW (FIX 3 & 14)
// ==========================================
function openMoveToOTModal(billDocId) {
    const bill = allBills.find(b => b.id === billDocId);
    if (!bill) return;
    
    document.getElementById('otFromBillDocId').value = billDocId;
    document.getElementById('otPatientInfo').innerHTML = `
        <strong>Patient:</strong> ${escapeHtml(bill.patientName)} (${bill.patientId})<br>
        <strong>Current Bill:</strong> ${bill.billId} (${bill.type})
    `;
    
    document.getElementById('otAnaesthetistInput').value = '';
    document.getElementById('otPreOpNotes').value = '';
    document.getElementById('otProcedureChargeInput').value = '';
    
    const now = new Date();
    document.getElementById('otScheduleDateInput').value = isoDate(now);
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('otScheduleTimeInput').value = `${hours}:${mins}`;

    loadServiceCatalogOptions(document.getElementById('otProcedureSelect')).then(function () {
        var sel = document.getElementById('otProcedureSelect');
        if (!sel.options.length || (sel.options.length === 1 && !sel.options[0].value)) {
            sel.innerHTML = '<option value="">Select Procedure</option>'
                + '<option value="Normal Delivery" data-price="25000">Normal Delivery</option>'
                + '<option value="Cesarean Section" data-price="45000">Cesarean Section (C-Section)</option>'
                + '<option value="LSCS" data-price="45000">LSCS</option>'
                + '<option value="D&C" data-price="15000">D&C</option>'
                + '<option value="IUD Insertion" data-price="5000">IUD Insertion</option>'
                + '<option value="Laparoscopy" data-price="30000">Laparoscopy</option>'
                + '<option value="Hysterectomy" data-price="40000">Hysterectomy</option>'
                + '<option value="Other Surgery" data-price="35000">Other Surgery</option>';
        }
        sel.value = '';
    });
    
    const surgeonSelect = document.getElementById('otSurgeonSelect');
    surgeonSelect.innerHTML = '<option value="">Loading surgeons...</option>';
    db.collection('staff')
        .where('role', '==', 'doctor')
        .get()
        .then(snap => {
            surgeonSelect.innerHTML = '<option value="">Select Surgeon</option>';
            snap.forEach(doc => {
                const d = doc.data();
                if (d.isActive !== false && d.isActive !== 'false') {
                    const opt = document.createElement('option');
                    opt.value = doc.id;
                    opt.textContent = `Dr. ${d.name} (${d.specialisation || 'General'})`;
                    opt.dataset.doctorName = `Dr. ${d.name}`;
                    surgeonSelect.appendChild(opt);
                }
            });
        }).catch(err => {
            console.error("Error loading surgeons:", err);
            surgeonSelect.innerHTML = '<option value="">Error loading surgeons</option>';
        });
        
    const roomSelect = document.getElementById('otRoomSelect');
    roomSelect.innerHTML = '<option value="">Loading OT Rooms...</option>';
    db.collection('beds')
        .where('ward', '==', 'Operation Theatre')
        .where('status', '==', 'available')
        .get()
        .then(snap => {
            roomSelect.innerHTML = '<option value="">Select Room</option>';
            snap.forEach(doc => {
                const bed = doc.data();
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = bed.bedNumber;
                opt.dataset.bedNumber = bed.bedNumber;
                roomSelect.appendChild(opt);
            });
        }).catch(err => {
            console.error("Error loading OT rooms:", err);
            roomSelect.innerHTML = '<option value="">Error loading rooms</option>';
        });
        
    document.getElementById('moveToOTModal').style.display = 'flex';
}
window.openMoveToOTModal = openMoveToOTModal;

function updateOTProcedureCharge(proc) {
    const chargeInput = document.getElementById('otProcedureChargeInput');
    const sel = document.getElementById('otProcedureSelect');
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    let charge = opt && opt.dataset.price ? Number(opt.dataset.price) : 0;
    if (!charge) {
        if (proc === 'Normal Delivery') charge = 25000;
        else if (proc === 'Cesarean Section' || proc === 'LSCS') charge = 45000;
        else if (proc === 'D&C') charge = 15000;
        else if (proc === 'IUD Insertion') charge = 5000;
        else if (proc === 'Laparoscopy') charge = 30000;
        else if (proc === 'Hysterectomy') charge = 40000;
        else if (proc === 'Other Surgery') charge = 35000;
        else if (proc) charge = 20000;
    }
    chargeInput.value = charge;
}
window.updateOTProcedureCharge = updateOTProcedureCharge;

async function confirmMoveToOT() {
    const billDocId = document.getElementById('otFromBillDocId').value;
    const procSelect = document.getElementById('otProcedureSelect');
    const surgeonSelect = document.getElementById('otSurgeonSelect');
    const otRoomSelect = document.getElementById('otRoomSelect');
    const dateInput = document.getElementById('otScheduleDateInput');
    const timeInput = document.getElementById('otScheduleTimeInput');
    const anaesthetist = document.getElementById('otAnaesthetistInput').value.trim();
    const notes = document.getElementById('otPreOpNotes').value.trim();
    const charge = parseFloat(document.getElementById('otProcedureChargeInput').value) || 0;
    
    const procedure = procSelect.value;
    const surgeonId = surgeonSelect.value;
    const surgeonName = surgeonSelect.options[surgeonSelect.selectedIndex]?.dataset.doctorName || '';
    const roomId = otRoomSelect.value;
    const roomNumber = otRoomSelect.options[otRoomSelect.selectedIndex]?.dataset.bedNumber || '';
    const schedDate = dateInput.value;
    const schedTime = timeInput.value;
    
    if (!procedure || !surgeonId || !roomId || !schedDate || !schedTime) {
        showToast('Please fill in all required fields.', 'warning');
        return;
    }
    
    const bill = allBills.find(b => b.id === billDocId);
    if (!bill) {
        showToast('Original bill not found.', 'error');
        return;
    }
    
    const btn = document.querySelector('#moveToOTModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Booking...'; }
    
    try {
        const batch = db.batch();
        const otBillNo = await generateBillNumber('OT');
        const newBillRef = db.collection('bills').doc();
        
        batch.set(newBillRef, {
            billId: otBillNo,
            type: 'OT',
            patientId: bill.patientId,
            patientDocId: bill.patientDocId || '',
            patientName: bill.patientName,
            visitDoctor: surgeonName,
            visitDepartment: 'Operation Theatre',
            items: [
                {
                    category: 'OT Procedure',
                    description: `${procedure} Procedure`,
                    quantity: 1,
                    unitPrice: charge,
                    amount: charge,
                    addedAt: new Date().toISOString()
                }
            ],
            subtotal: charge,
            grandTotal: charge,
            amountPaid: 0,
            balanceDue: charge,
            paymentStatus: 'unpaid',
            status: 'draft',
            isRunningBill: true,
            isFinalized: false,
            linkedFromBillId: bill.billId,
            bedDocId: roomId,
            bedNumber: roomNumber,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        batch.update(db.collection('bills').doc(billDocId), {
            transferredTo: otBillNo,
            transferredType: 'OT',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        batch.update(db.collection('beds').doc(roomId), {
            status: 'occupied',
            patientId: bill.patientId,
            patientDocId: bill.patientDocId || '',
            patientName: bill.patientName,
            billId: otBillNo,
            billDocId: newBillRef.id,
            admittedAt: schedDate,
            assignedBy: currentUserEmail,
            assignedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        const bookingId = 'ot-' + Date.now();
        const bookingRef = db.collection('otBookings').doc(bookingId);
        batch.set(bookingRef, {
            bookingId: bookingId,
            patientId: bill.patientId,
            patientDocId: bill.patientDocId || '',
            patientName: bill.patientName,
            procedureType: procedure,
            surgeonName: surgeonName,
            surgeonId: surgeonId,
            anaesthetistName: anaesthetist,
            otRoomId: roomId,
            otRoomName: roomNumber,
            scheduledDate: schedDate,
            scheduledTime: formatTime12Hour(schedTime),
            charge: charge,
            preOpNotes: notes,
            status: 'scheduled',
            billDocId: newBillRef.id,
            billId: otBillNo,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        if (bill.patientDocId) {
            batch.update(db.collection('patients').doc(bill.patientDocId), {
                status: 'in_surgery',
                currentBillId: otBillNo,
                currentBedId: roomId,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        const auditRef = db.collection('auditLog').doc();
        batch.set(auditRef, {
            action: 'MOVE_TO_OT',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            performedBy: currentUserEmail,
            details: `Moved patient ${bill.patientName} to OT for ${procedure}. Assigned bed ${roomNumber}.`
        });
        
        await batch.commit();
        
        showToast(`Patient successfully booked and moved to OT. Bill ${otBillNo} generated.`, 'success');
        document.getElementById('moveToOTModal').style.display = 'none';
        loadBills();
    } catch (err) {
        console.error("Error moving patient to OT:", err);
        showToast("Error: " + err.message, "error");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm OT Booking'; }
    }
}
window.confirmMoveToOT = confirmMoveToOT;

function formatTime12Hour(time24) {
    if (!time24) return '';
    const [hrs, mins] = time24.split(':');
    let h = parseInt(hrs);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${mins} ${ampm}`;
}

// ==========================================
// OT COMPLETE & RELEASE WARD ROUTING WORKFLOW (FIX 14)
// ==========================================
function openCompleteOTModal(bill) {
    document.getElementById('completeOtBookingId').value = '';
    document.getElementById('completeOtBillId').value = bill.id;
    document.getElementById('completeOtPatientDocId').value = bill.patientDocId || '';
    document.getElementById('completeOtPatientId').value = bill.patientId || '';
    document.getElementById('completeOtRoomId').value = bill.bedDocId || '';
    
    document.getElementById('completePatientInfo').innerHTML = `
        <strong>Patient:</strong> ${escapeHtml(bill.patientName)} (${bill.patientId})<br>
        <strong>Procedure Bill:</strong> ${bill.billId}<br>
        <strong>OT Room:</strong> ${bill.bedNumber || '—'}
    `;
    
    document.getElementById('postOpWardSelect').value = '';
    document.getElementById('postOpBedSelectGroup').style.display = 'none';
    document.getElementById('postOpBedSelect').innerHTML = '<option value="">— Select ward first —</option>';
    
    db.collection('otBookings')
        .where('billId', '==', bill.billId)
        .limit(1)
        .get()
        .then(snap => {
            if (!snap.empty) {
                document.getElementById('completeOtBookingId').value = snap.docs[0].id;
                const bookingData = snap.docs[0].data();
                document.getElementById('completeOtRoomId').value = bookingData.otRoomId || bill.bedDocId || '';
            }
            document.getElementById('completeProcedureModal').style.display = 'flex';
        }).catch(err => {
            console.error("Error loading booking details:", err);
            document.getElementById('completeProcedureModal').style.display = 'flex';
        });
}
window.openCompleteOTModal = openCompleteOTModal;

function loadBedsForPostOp(ward) {
    const bedSelectGroup = document.getElementById('postOpBedSelectGroup');
    const bedSelect = document.getElementById('postOpBedSelect');
    
    if (!ward || ward === 'Discharge') {
        bedSelectGroup.style.display = 'none';
        return;
    }
    
    bedSelect.innerHTML = '<option value="">Loading beds...</option>';
    bedSelectGroup.style.display = 'block';
    
    db.collection('beds')
        .where('ward', '==', ward)
        .where('status', '==', 'available')
        .get()
        .then(snap => {
            bedSelect.innerHTML = '<option value="">Select Bed</option>';
            if (snap.empty) {
                bedSelect.innerHTML = '<option value="">No available beds in this ward</option>';
                return;
            }
            snap.forEach(doc => {
                const bed = doc.data();
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = `${bed.bedNumber} (Rate: ₹${bed.dailyRate || 0}/day)`;
                opt.dataset.bedNumber = bed.bedNumber;
                opt.dataset.dailyRate = bed.dailyRate || 0;
                bedSelect.appendChild(opt);
            });
        }).catch(err => {
            console.error("Error loading post op beds:", err);
            bedSelect.innerHTML = '<option value="">Error loading beds</option>';
        });
}
window.loadBedsForPostOp = loadBedsForPostOp;

async function confirmCompleteProcedure() {
    const bookingId = document.getElementById('completeOtBookingId').value;
    const billId = document.getElementById('completeOtBillId').value;
    const patientDocId = document.getElementById('completeOtPatientDocId').value;
    const patientId = document.getElementById('completeOtPatientId').value;
    const otRoomId = document.getElementById('completeOtRoomId').value;
    
    const ward = document.getElementById('postOpWardSelect').value;
    if (!ward) { showToast('Please select a post-op ward or discharge.', 'warning'); return; }
    
    let bedDocId = '';
    let bedNumber = '';
    let dailyRate = 0;
    
    if (ward !== 'Discharge') {
        const bedSel = document.getElementById('postOpBedSelect');
        const bedOpt = bedSel.options[bedSel.selectedIndex];
        bedDocId = bedSel.value;
        if (!bedDocId) { showToast('Please select a bed.', 'warning'); return; }
        bedNumber = bedOpt.dataset.bedNumber || '';
        dailyRate = parseFloat(bedOpt.dataset.dailyRate) || 0;
    }
    
    const btn = document.querySelector('#completeProcedureModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
    
    try {
        const batch = db.batch();
        
        // 1. Mark OT Booking as completed if it exists
        if (bookingId) {
            batch.update(db.collection('otBookings').doc(bookingId), {
                status: 'completed',
                completedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        // 2. Release OT Room to cleaning
        if (otRoomId) {
            batch.update(db.collection('beds').doc(otRoomId), {
                status: 'cleaning',
                patientId: null,
                patientDocId: null,
                patientName: null,
                billId: null,
                billDocId: null,
                dischargedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        if (ward === 'Discharge') {
            batch.update(db.collection('bills').doc(billId), {
                isFinalized: true,
                isRunningBill: false,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (patientDocId) {
                batch.update(db.collection('patients').doc(patientDocId), {
                    status: 'discharged',
                    currentBillId: null,
                    currentBedId: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            showToast('Procedure completed. Patient discharged and OT bill finalized.', 'success');
        } else {
            const newType = (ward === 'ICU') ? 'ICU' : 'IPD';
            
            const billSnap = await db.collection('bills').doc(billId).get();
            const billData = billSnap.data();
            const items = billData.items || [];
            
            const addedItem = {
                category: 'Bed Charges',
                description: `Bed ${bedNumber} (${ward})`,
                quantity: 1,
                unitPrice: dailyRate,
                amount: dailyRate,
                addedAt: new Date().toISOString()
            };
            items.push(addedItem);
            
            const newSubtotal = (billData.subtotal || 0) + dailyRate;
            const newGrandTotal = (billData.grandTotal || 0) + dailyRate;
            const newBalanceDue = newGrandTotal - (billData.amountPaid || 0);
            
            batch.update(db.collection('bills').doc(billId), {
                type: newType,
                bedDocId: bedDocId,
                bedNumber: bedNumber,
                bedWard: ward,
                dailyRate: dailyRate,
                admissionDate: todayIso(),
                items: items,
                subtotal: newSubtotal,
                grandTotal: newGrandTotal,
                balanceDue: newBalanceDue,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            const admissionRef = db.collection('admissions').doc();
            batch.update(db.collection('beds').doc(bedDocId), {
                status: 'occupied',
                patientId: patientId,
                patientDocId: patientDocId,
                patientName: billData.patientName,
                billId: billData.billId,
                billDocId: billId,
                admittedAt: todayIso(),
                activeAdmissionId: admissionRef.id,
                assignedBy: currentUserEmail,
                assignedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            batch.set(admissionRef, {
                patientId: patientId,
                patientDocId: patientDocId,
                patientName: billData.patientName,
                bedDocId: bedDocId,
                bedNumber: bedNumber,
                ward: ward,
                billId: billData.billId,
                billDocId: billId,
                dailyRate: dailyRate,
                admissionDate: todayIso(),
                status: 'admitted',
                admittedBy: currentUserEmail,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            if (patientDocId) {
                batch.update(db.collection('patients').doc(patientDocId), {
                    status: (ward === 'ICU') ? 'icu' : 'admitted',
                    currentBedId: bedDocId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            showToast(`Procedure completed. Patient moved to ${ward}. Running bill updated.`, 'success');
        }
        
        await batch.commit();
        document.getElementById('completeProcedureModal').style.display = 'none';
        loadBills();
    } catch (err) {
        console.error('Complete procedure error:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Complete & Release'; }
    }
}
window.confirmCompleteProcedure = confirmCompleteProcedure;

// ==========================================
// CONSOLIDATED BILL MODAL LOGIC
// ==========================================
let conSelectedPatient = null;
const conModal = document.getElementById('consolidatedBillModal');

if (document.getElementById('consolidatedBillBtn')) {
    document.getElementById('consolidatedBillBtn').addEventListener('click', () => {
        conSelectedPatient = null;
        document.getElementById('conPatientSearch').value = '';
        document.getElementById('conSelectedPatientCard').style.display = 'none';
        document.getElementById('conPrintBtn').disabled = true;
        if (conModal) {
            conModal.classList.add('active');
            conModal.style.display = 'flex';
        }
    });
}

if (document.getElementById('closeConsolidatedModalBtn')) {
    document.getElementById('closeConsolidatedModalBtn').addEventListener('click', () => {
        if (conModal) {
            conModal.classList.remove('active');
            conModal.style.display = 'none';
        }
    });
}

if (document.getElementById('conCancelBtn')) {
    document.getElementById('conCancelBtn').addEventListener('click', () => {
        if (conModal) {
            conModal.classList.remove('active');
            conModal.style.display = 'none';
        }
    });
}

const conSearchInput = document.getElementById('conPatientSearch');
const conSearchResults = document.getElementById('conPatientSearchResults');

if (conSearchInput && conSearchResults) {
    conSearchInput.addEventListener('input', function(e) {
        const q = e.target.value.trim().toLowerCase();
        if (!q || q.length < 2) {
            conSearchResults.style.display = 'none';
            return;
        }
        
        conSearchResults.innerHTML = '<div style="padding:10px;color:#666;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
        conSearchResults.style.display = 'block';
        
        let results = [];
        db.collection('patients').where('patientId', '==', q.toUpperCase()).get()
        .then(snap => {
            snap.forEach(doc => results.push({ docId: doc.id, ...doc.data() }));
            return db.collection('patients').orderBy('nameLower').startAt(q).endAt(q + '\uf8ff').limit(5).get();
        })
        .then(snap => {
            snap.forEach(doc => {
                if (!results.find(r => r.docId === doc.id)) results.push({ docId: doc.id, ...doc.data() });
            });
            return db.collection('patients').where('phone', '==', q).get();
        })
        .then(snap => {
            snap.forEach(doc => {
                if (!results.find(r => r.docId === doc.id)) results.push({ docId: doc.id, ...doc.data() });
            });
            
            renderConSearchResults(results);
        }).catch(err => {
            conSearchResults.innerHTML = `<div style="padding:10px;color:red;font-size:12px;">Error: ${err.message}</div>`;
        });
    });
}

function renderConSearchResults(patients) {
    if (!patients.length) {
        conSearchResults.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;">No patient found</div>';
        return;
    }
    
    let html = '';
    patients.forEach(p => {
        html += `
            <div class="search-result-item" onclick="selectPatientForConBill('${p.docId}', '${p.patientId}', '${p.name.replace(/'/g, "\\'")}', '${p.phone || ''}')" style="padding:10px 15px; cursor:pointer; border-bottom: 1px solid #eee;">
                <strong>${p.name}</strong> <span style="color:var(--primary-teal); font-size:11px; margin-left:4px;">${p.patientId}</span>
                <div style="font-size:11px; color:#888; margin-top:2px;">Phone: ${p.phone || '—'} | Gender: ${p.gender || '—'}</div>
            </div>
        `;
    });
    conSearchResults.innerHTML = html;
}
window.renderConSearchResults = renderConSearchResults;

function selectPatientForConBill(docId, patientId, name, phone) {
    conSelectedPatient = { docId, patientId, name, phone };
    
    document.getElementById('conCardPatientName').textContent = name;
    document.getElementById('conCardPatientId').textContent = patientId;
    document.getElementById('conCardPhone').textContent = phone || '—';
    
    document.getElementById('conSelectedPatientCard').style.display = 'block';
    conSearchResults.style.display = 'none';
    conSearchInput.value = '';
    document.getElementById('conPrintBtn').disabled = false;
}
window.selectPatientForConBill = selectPatientForConBill;

if (document.getElementById('conClearPatientBtn')) {
    document.getElementById('conClearPatientBtn').addEventListener('click', () => {
        conSelectedPatient = null;
        document.getElementById('conSelectedPatientCard').style.display = 'none';
        document.getElementById('conPrintBtn').disabled = true;
        conSearchInput.focus();
    });
}

if (document.getElementById('conPrintBtn')) {
    document.getElementById('conPrintBtn').addEventListener('click', () => {
        if (!conSelectedPatient) return;
        generateConsolidatedBillPDF(conSelectedPatient.patientId);
        if (conModal) {
            conModal.classList.remove('active');
            conModal.style.display = 'none';
        }
    });
}

// Close con suggestions dropdown on outside click
document.addEventListener('click', function(e) {
    if (conSearchInput && conSearchResults && !conSearchInput.contains(e.target) && !conSearchResults.contains(e.target)) {
        conSearchResults.style.display = 'none';
    }
});
