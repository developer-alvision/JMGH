checkAccess(['lab_technician', 'doctor', 'nurse', 'admin', 'owner']);

let currentUserEmail = '';
let currentUserRole = '';
let currentDoctorName = '';
let allReports = [];
var selectedPatient_img = null;
let activeReportDocId = null; // null for new, document ID when editing/completing a pending request

// Read once at load so the report table can render the PACS button
// synchronously; refreshed after the settings arrive.
var imagingPacsConfig = { enabled: false, viewerUrl: '', lookupUrl: '', aeTitle: '' };

getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;

    getPacsConfig().then(function(config) {
        imagingPacsConfig = config;
        if (config.enabled && allReports.length) applyFilters();
    });
    currentUserEmail = user.email || '';
    currentUserRole = (user.role || '').toLowerCase();
    currentDoctorName = user.name || '';
    
    // Hide upload button for view-only roles
    const canUpload = (currentUserRole === 'lab_technician' || currentUserRole === 'admin');
    const btnUpload = document.getElementById('uploadReportBtn') || document.getElementById('btnOpenUploadModal');
    if (btnUpload) btnUpload.style.display = canUpload ? 'inline-flex' : 'none';

    // Toggle Pending Requests sections based on role
    const pendingRequestsContainer = document.getElementById('pendingRequestsContainer');
    if (pendingRequestsContainer) {
        if (['lab_technician', 'admin', 'owner', 'doctor'].includes(currentUserRole)) {
            pendingRequestsContainer.style.display = 'block';
            loadPendingRequests();
        } else {
            pendingRequestsContainer.style.display = 'none';
        }
    }

    const pendingLabWorkContainer = document.getElementById('pendingLabWorkContainer');
    if (pendingLabWorkContainer) {
        if (['lab_technician', 'admin', 'owner'].includes(currentUserRole)) {
            pendingLabWorkContainer.style.display = 'block';
            loadPendingLabWork();
        } else {
            pendingLabWorkContainer.style.display = 'none';
        }
    }
    
    // Hide billing elements for non-billing roles
    const isBillingRole = ['receptionist', 'billing_staff', 'admin', 'pharmacist', 'owner'].includes(currentUserRole);
    if (!isBillingRole) {
        const filterGroup = document.getElementById('billingFilterGroup');
        if (filterGroup) filterGroup.style.display = 'none';
        document.querySelectorAll('.billing-col').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.lab-amount-group').forEach(el => el.style.display = 'none');
    }
    
    loadImagingReports();
});

// ==========================================
// 1. PENDING REQUESTS PANEL (PART 6)
// ==========================================
function loadPendingRequests() {
    const tbody = document.getElementById('pendingRequestsTableBody');
    if (!tbody) return;

    function renderSnap(snap) {
        tbody.innerHTML = '';
        var rows = [];
        snap.forEach(function (doc) {
            var r = doc.data();
            var st = String(r.status || '').toLowerCase();
            var billSt = String(r.billingStatus || 'unpaid').toLowerCase();
            if (st !== 'pending') return;
            if (billSt !== 'unpaid' && billSt !== 'unbilled') return;
            rows.push({ id: doc.id, r: r });
        });
        if (!rows.length) {
            setEmptyRow('pendingRequestsTableBody', 'No doctor-ordered scans awaiting billing.', 6);
            return;
        }
        rows.forEach(function (row) {
            var r = row.r;
            var tr = document.createElement('tr');
            var dateVal = r.createdAt ? formatDate(r.createdAt) : '—';
            tr.innerHTML = `
                <td><strong>${escapeHtml(r.patientName || '—')}</strong></td>
                <td>${escapeHtml(r.patientId || '—')}</td>
                <td>${escapeHtml(r.testName || r.imagingType || '—')}</td>
                <td><span style="font-family: monospace; background: #f8fafc; padding: 2px 6px; border: 1px solid #e2e8f0;">${escapeHtml(r.linkedBillId || 'Unbilled')}</span></td>
                <td>${escapeHtml(dateVal)}</td>
                <td><span style="font-size:12px;color:#64748b;">Awaiting billing desk</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    db.collection('reports')
        .where('type', '==', 'imaging')
        .where('status', '==', 'pending')
        .onSnapshot(renderSnap, function () {
            db.collection('reports').where('type', '==', 'imaging').get().then(renderSnap)
                .catch(function (e2) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">Error: ' + escapeHtml(e2.message) + '</td></tr>';
                });
        });
}

function openUploadForPending(docId) {
    activeReportDocId = docId;
    clearPatient_img();
    
    db.collection('reports').doc(docId).get()
    .then(docSnap => {
        if (!docSnap.exists) {
            showToast("Report request not found.", "error");
            return;
        }
        const report = docSnap.data();
        
        // Find patient details
        db.collection('patients').where('patientId', '==', report.patientId).get()
        .then(snap => {
            if (!snap.empty) {
                const pDoc = snap.docs[0];
                const pData = pDoc.data();
                selectedPatient_img = {
                    docId: pDoc.id,
                    patientId: pData.patientId,
                    name: pData.name,
                    doctor: pData.doctor || '',
                    department: pData.department || '',
                    phone: pData.phone || '',
                    age: pData.age || '',
                    gender: pData.gender || ''
                };
                
                // Pre-fill selected patient card
                document.getElementById('img_patientSearchInput').value = selectedPatient_img.name + ' — ' + selectedPatient_img.patientId;
                document.getElementById('img_cardPatientName').textContent = selectedPatient_img.name;
                document.getElementById('img_cardPatientId').textContent = selectedPatient_img.patientId;
                document.getElementById('img_cardAgeGender').textContent = (selectedPatient_img.age || '—') + ' / ' + (selectedPatient_img.gender || '—');
                
                loadDoctors_img(report.referredBy || selectedPatient_img.doctor);
                populateDeptSelect('img_deptSelect', report.visitDepartment || selectedPatient_img.department || '');
                document.getElementById('img_selectedPatientCard').style.display = 'block';
            } else {
                // Mock simple selected patient
                selectedPatient_img = {
                    docId: '',
                    patientId: report.patientId,
                    name: report.patientName,
                    doctor: report.referredBy || '',
                    department: report.visitDepartment || '',
                    phone: '', age: '', gender: ''
                };
            }
            
            // Set Single Scan Mode & Pre-fill details
            if (document.getElementById('btnSingleTestMode')) {
                document.getElementById('btnSingleTestMode').click();
            }
            
            // Deduce imaging type based on name or set default
            const scanNameLower = (report.testName || '').toLowerCase();
            let typeDetected = 'X-Ray';
            if (scanNameLower.includes('ct') || scanNameLower.includes('computed')) typeDetected = 'CT Scan';
            else if (scanNameLower.includes('mri') || scanNameLower.includes('magnetic')) typeDetected = 'MRI';
            else if (scanNameLower.includes('ultrasound') || scanNameLower.includes('usg')) typeDetected = 'Ultrasound';
            
            document.getElementById('imgType').value = report.imagingType || typeDetected;
            document.getElementById('imgTestName').value = report.testName || '';
            document.getElementById('imgTestAmount').value = report.amount || 0;
            document.getElementById('imgTestDate').value = todayIso();
            document.getElementById('imgStatus').value = 'ready'; // Pending requests are uploaded as ready
            document.getElementById('imgNotes').value = report.notes || '';
            
            // Pre-select doctor in referred dropdown
            if (document.getElementById('imgReferredBy')) {
                document.getElementById('imgReferredBy').value = report.referredBy || '';
            }
            
            // Open upload modal
            document.getElementById('uploadReportModal').classList.add('active');
        });
    })
    .catch(err => {
        console.error("Error setting up pending upload:", err);
        showToast("Error retrieving pending request details.", "error");
    });
}
window.openUploadForPending = openUploadForPending;

// ==========================================
// 1B. PENDING IMAGING WORK FROM BILLING QUEUE (CHANGE 2, 3)
// ==========================================
function getOrdinal(n) {
    var s = ["th", "st", "nd", "rd"],
        v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function loadPendingLabWork() {
    var tbody = document.getElementById('pendingLabBody');
    var countEl = document.getElementById('pendingLabCount');
    if (!tbody) return;

    function renderQueue(snap) {
        if (countEl) countEl.textContent = snap.size + ' pending';
        if (snap.empty) {
            setEmptyRow('pendingLabBody', 'No pending imaging work from billed orders.', 8);
            return;
        }
        var html = '';
        var idx = 1;
        snap.forEach(doc => {
            var q = doc.data();
            var pos = getOrdinal(idx++);
            var dateVal = q.createdAt ? formatDate(q.createdAt) : '—';
            var queueJson = JSON.stringify({
                queueId: q.queueId || doc.id,
                queueDocId: doc.id,
                billDocId: q.billDocId,
                billId: q.billId,
                patientId: q.patientId,
                patientName: q.patientName,
                doctor: q.visitDoctor || '',
                testName: q.testName || '',
                amount: q.amount || 0,
                imagingType: q.imagingType || '',
                labNotes: q.labNotes || ''
            }).replace(/"/g, '&quot;');
            var isEmergency = q.isEmergency === true || q.isEmergency === 'true';
            var badgeHtml = isEmergency ? ' <span class="status-badge" style="font-size:10px;">STAT</span>' : '';
            html += '<tr style="border-bottom:1px solid #E2E8F0;">';
            html += '<td style="padding:10px 14px;font-weight:600;">' + pos + badgeHtml + '</td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(q.billId || '—') + '</td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(q.patientName || '') + '<br><small style="color:#666;">' + escapeHtml(q.patientId || '') + '</small></td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(q.visitDoctor || '') + '</td>';
            html += '<td style="padding:10px 14px;font-weight:500;">' + escapeHtml(q.testName || q.imagingType || '') + '</td>';
            html += '<td style="padding:10px 14px;font-size:12px;color:#666;">' + escapeHtml(q.labNotes || '—') + '</td>';
            html += '<td style="padding:10px 14px;">' + escapeHtml(dateVal) + '</td>';
            html += '<td style="padding:10px 14px;"><button onclick="startImagingUploadQueue(' + queueJson + ')" class="btn-primary" style="padding:7px 14px;font-size:12px;"><i class="fa-solid fa-upload"></i> Upload</button></td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    }

    db.collection('imagingQueue')
    .where('reportStatus', '==', 'pending')
    .orderBy('isEmergency', 'desc')
    .orderBy('createdAt', 'asc')
    .onSnapshot(renderQueue, function (err) {
        console.warn('Imaging queue composite failed:', err.message);
        db.collection('imagingQueue').where('reportStatus', '==', 'pending')
            .onSnapshot(renderQueue, function (err2) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:red;">Error: ' + escapeHtml(err2.message) + '</td></tr>';
            });
    });
}
window.loadPendingLabWork = loadPendingLabWork;

function startImagingUploadQueue(data) {
    window.currentQueueData = data;
    // Pre-fill patient in upload modal
    document.getElementById('img_patientSearchInput').value = data.patientName + ' — ' + data.patientId;
    selectedPatient_img = { patientId: data.patientId, name: data.patientName, doctor: data.doctor };
    document.getElementById('img_cardPatientName').textContent = data.patientName;
    document.getElementById('img_cardPatientId').textContent = data.patientId;
    document.getElementById('img_selectedPatientCard').style.display = 'block';

    // Pre-fill referred doctor list
    loadDoctors_img(data.doctor);
    populateDeptSelect('img_deptSelect', data.department || '');

    // Pre-fill test name and deduce scan type
    const scanNameLower = (data.testName || '').toLowerCase();
    let typeDetected = 'X-Ray';
    if (scanNameLower.includes('ct') || scanNameLower.includes('computed')) typeDetected = 'CT Scan';
    else if (scanNameLower.includes('mri') || scanNameLower.includes('magnetic')) typeDetected = 'MRI';
    else if (scanNameLower.includes('ultrasound') || scanNameLower.includes('usg')) typeDetected = 'Ultrasound';
    document.getElementById('imgType').value = data.imagingType || typeDetected;

    if (document.getElementById('btnSingleTestMode')) {
        document.getElementById('btnSingleTestMode').click();
    }
    document.getElementById('imgTestName').value = data.testName;
    document.getElementById('imgTestAmount').value = data.amount || 0;

    // Show lab notes from reception
    if (data.labNotes) {
        var notesEl = document.getElementById('imgNotesFromReception');
        if (notesEl) {
            notesEl.textContent = 'Notes from reception: ' + data.labNotes;
            notesEl.style.display = 'block';
        }
    } else {
        var notesEl = document.getElementById('imgNotesFromReception');
        if (notesEl) notesEl.style.display = 'none';
    }

    // Open modal
    document.getElementById('uploadReportModal').classList.add('active');
}
window.startImagingUploadQueue = startImagingUploadQueue;

// ==========================================
// 2. REPORT LOADER & REALTIME SNAPSHOT
// ==========================================
function loadImagingReports() {
    db.collection('reports')
        .where('type', '==', 'imaging')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snap => {
            allReports = [];
            snap.forEach(doc => {
                allReports.push({ id: doc.id, ...doc.data() });
            });
            applyFilters();
        }, err => {
            console.error("Error loading imaging reports:", err);
            const tbody = document.getElementById('reportsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:red;">Error loading reports: ' + err.message + '</td></tr>';
        });
}

// ==========================================
// 3. TABLE RENDERING (PART 4, 7, 8)
// ==========================================
function renderReports(reports) {
    const tbody = document.getElementById("reportsTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    if (reports.length === 0) {
        setEmptyRow('tbodyImagingReports', 'No imaging reports found matching current filters.', 10);
        return;
    }

    reports.forEach(report => {
        const tr = document.createElement('tr');
        
        // P7 Status colors
        const rStat = (report.status || 'pending').toLowerCase().trim();
        const statusColor = rStat === 'ready' ? '#10b981' : rStat === 'delivered' ? '#3b82f6' : '#f59e0b';
        
        // P4 Billing Status colors
        const bStatus = (report.billingStatus || 'unbilled').toLowerCase();
        let bBg = '#FEF3C7', bText = '#D4820A';
        if (bStatus === 'billed') { bBg = '#EFF6FF'; bText = '#1E6FB5'; }
        else if (bStatus === 'paid') { bBg = '#DCFCE7'; bText = '#0D7A70'; }
        else if (bStatus === 'due') { bBg = '#FEE2E2'; bText = '#DC2626'; }

        // Format dates
        const dateVal = report.reportDate || (report.createdAt ? formatDate(report.createdAt) : '—');
        
        // Check edit permission
        const canEdit = (currentUserRole === 'lab_technician' || currentUserRole === 'admin');
        const editBtnHtml = canEdit ? `<button onclick="openEditReport('${report.id}')" class="btn-secondary" style="padding:4px 8px;font-size:0.8rem;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;"><i class="fa-solid fa-pen-to-square"></i> Edit</button>` : '';

        // Check view own only condition for Doctor
        if (currentUserRole === 'doctor' && report.referredBy !== currentDoctorName && report.referredBy !== 'Admin' && report.referredBy !== '') {
            // Doctors can only view their own referred reports (Part 1 requirement)
            return;
        }

        const waNotified = report.notifyPatient === true;
        const waHtml = waNotified 
            ? `<span title="WhatsApp notification will be sent when bot is set up in Phase 7" style="color:#f59e0b;font-size:1.1rem;cursor:help;"><i class="fa-solid fa-bell"></i></span>`
            : `<span title="Patient notified or no notification pending" style="color:#10b981;font-size:1.1rem;"><i class="fa-solid fa-circle-check"></i></span>`;

        const statusCellHtml = canEdit ? `
            <select class="status-select" data-id="${report.id}" style="padding:4px 8px;border-radius:6px;border:1px solid #ddd;font-size:0.8rem;background:${statusColor}20;color:${statusColor};font-weight:600;cursor:pointer;outline:none;">
                <option value="pending" ${rStat === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="ready" ${rStat === 'ready' ? 'selected' : ''}>Ready</option>
                <option value="delivered" ${rStat === 'delivered' ? 'selected' : ''}>Delivered</option>
            </select>
        ` : `<span style="background:${statusColor}20;color:${statusColor};padding:4px 8px;border-radius:6px;font-size:0.8rem;font-weight:600;text-transform:capitalize;">${escapeHtml(rStat)}</span>`;

        tr.innerHTML = `
            <td><strong>${escapeHtml(report.reportId || report.id.substring(0, 8))}</strong></td>
            <td>${escapeHtml(report.patientName || '—')}</td>
            <td>${escapeHtml(report.patientId || '—')}</td>
            <td><span style="font-weight: 500; background:#f3f4f6; padding: 2px 8px; border-radius:12px; font-size:11px;">${escapeHtml(report.imagingType || '—')}</span></td>
            <td>${escapeHtml(report.testName || '—')}</td>
            <td class="billing-col"><strong>${formatCurrency(report.totalAmount || report.amount || 0)}</strong></td>
            <td>${escapeHtml(dateVal)}</td>
            <td class="billing-col"><span style="background:${bBg};color:${bText};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:capitalize;">${escapeHtml(bStatus)}</span></td>
            <td>${statusCellHtml}</td>
            <td>${waHtml}</td>
            <td>
                <div style="display:flex; gap:6px; flex-wrap: wrap;">
                    ${report.imageUrl ? `<button onclick="window.open('${report.imageUrl}', '_blank')" class="btn-primary" style="padding:4px 8px;font-size:0.8rem;background:#10b981;border-color:#10b981;cursor:pointer;"><i class="fa-solid fa-image"></i> View Image</button>` : ''}
                    ${(report.pdfUrl || report.fileUrl) ? `<button onclick="window.open('${report.pdfUrl || report.fileUrl}', '_blank')" class="btn-primary" style="padding:4px 8px;font-size:0.8rem;background:#3b82f6;border-color:#3b82f6;cursor:pointer;"><i class="fa-solid fa-file-pdf"></i> View Report</button>` : ''}
                    ${pacsButtonHtml(report, imagingPacsConfig)}
                    <button class="btn-primary view-img-btn" data-id="${report.id}" style="padding:4px 8px;font-size:0.8rem;cursor:pointer;"><i class="fa-solid fa-eye"></i> View</button>
                    ${editBtnHtml}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Hide billing elements for non-billing roles (FIX 1 / FIX 5)
    const isBillingRole = ['receptionist', 'billing_staff', 'admin', 'pharmacist', 'owner'].includes(currentUserRole);
    if (!isBillingRole) {
        document.querySelectorAll('.billing-col').forEach(el => el.style.display = 'none');
    }

    // Attach status update change listeners (PART 7)
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            updateReportStatus(e.target.dataset.id, e.target.value);
        });
    });

    // Attach view listeners
    document.querySelectorAll('.view-img-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const btnEl = e.currentTarget;
            const report = allReports.find(r => r.id === btnEl.dataset.id);
            if (report) viewImagingReport(report);
        });
    });
}

function updateReportStatus(id, newStatus) {
    if (newStatus.toLowerCase() === 'ready') {
        db.collection('reports').doc(id).get().then(doc => {
            if (!doc.exists) return;
            const rep = doc.data();
            const runner = (typeof finalizeDiagnosticReportReady === 'function')
                ? finalizeDiagnosticReportReady(id, rep, 'imaging')
                : db.collection('reports').doc(id).update({ status: 'ready', notifyPatient: true, notifyDoctor: true });
            runner.then(function (meta) {
                if (meta && meta.phone) {
                    showToast('Scan ready. Doctor notified. WhatsApp queued (24h link). Kept 3 years.', 'success');
                } else {
                    showToast('Scan ready. Doctor notified. Patient record updated (3yr retention).', 'success');
                }
            }).catch(function (err) { showToast(err.message, 'error'); });
        });
    } else {
        db.collection('reports').doc(id).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            showToast('Status updated to ' + newStatus, 'success');
        }).catch(err => {
            console.error(err);
            showToast('Failed to update status: ' + err.message, 'error');
        });
    }
}
window.updateReportStatus = updateReportStatus;

// ==========================================
// 4. FILTER BAR LOGIC (PART 8)
// ==========================================
function applyFilters() {
    const patVal = document.getElementById('filterPatient').value.toLowerCase().trim();
    const statusVal = document.getElementById('filterStatus').value;
    const billVal = document.getElementById('filterBilling').value;
    const fromVal = document.getElementById('filterFromDate').value;
    const toVal = document.getElementById('filterToDate').value;
    
    let filtered = allReports;
    
    // 1. Patient Name / ID Search
    if (patVal) {
        filtered = filtered.filter(r => 
            (r.patientName && r.patientName.toLowerCase().includes(patVal)) ||
            (r.patientId && r.patientId.toLowerCase().includes(patVal)) ||
            (r.reportId && r.reportId.toLowerCase().includes(patVal)) ||
            (r.imagingType && r.imagingType.toLowerCase().includes(patVal))
        );
    }
    
    // 2. Report Status
    if (statusVal !== 'All') {
        filtered = filtered.filter(r => String(r.status || '').toLowerCase() === String(statusVal).toLowerCase());
    }
    
    // 3. Billing Status
    if (billVal !== 'All') {
        filtered = filtered.filter(r => (r.billingStatus || 'unbilled').toLowerCase() === billVal.toLowerCase());
    }
    
    // 4. Date Range
    if (fromVal) {
        const fromDate = new Date(fromVal);
        fromDate.setHours(0,0,0,0);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate >= fromDate;
        });
    }
    if (toVal) {
        const toDate = new Date(toVal);
        toDate.setHours(23,59,59,999);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate <= toDate;
        });
    }
    
    // Update count label
    const label = document.getElementById('reportsCountLabel');
    if (label) {
        label.textContent = `Showing ${filtered.length} reports`;
    }
    
    renderReports(filtered);
}
window.applyFilters = applyFilters;

// Filter Event Listeners
document.getElementById('btnApplyFilters') && document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
document.getElementById('btnClearFilters') && document.getElementById('btnClearFilters').addEventListener('click', () => {
    document.getElementById('filterPatient').value = '';
    document.getElementById('filterStatus').value = 'All';
    document.getElementById('filterBilling').value = 'All';
    document.getElementById('filterFromDate').value = '';
    document.getElementById('filterToDate').value = '';
    applyFilters();
});

// ==========================================
// 5. VIEW DETAIL MODAL (PART 3)
// ==========================================
function viewImagingReport(report) {
    document.getElementById('viewImgReportId').textContent = escapeHtml(report.reportId || report.id.substring(0, 8));
    document.getElementById('viewImgPatient').textContent = escapeHtml(report.patientName || '—') + ' (' + escapeHtml(report.patientId || '—') + ')';
    document.getElementById('viewImgType').textContent = escapeHtml(report.imagingType || '—');
    document.getElementById('viewImgTest').textContent = escapeHtml(report.testName || '—');
    
    // PART 3: Show all individual scans inside the panel in list
    const listEl = document.getElementById('viewImgTestsList');
    if (listEl) {
        if (report.tests && report.tests.length) {
            let html = '<ul style="margin:0; padding-left:15px; font-size:0.9rem; line-height: 1.6;">';
            report.tests.forEach(t => {
                html += `<li><strong>${escapeHtml(t.name)}</strong>: <span style="color: #0D7A70; font-weight:500;">${formatCurrency(t.amount)}</span></li>`;
            });
            html += '</ul>';
            listEl.innerHTML = html;
        } else {
            listEl.innerHTML = `<span style="font-size:0.9rem;"><strong>${escapeHtml(report.testName || '—')}</strong>: ${formatCurrency(report.totalAmount || report.amount || 0)}</span>`;
        }
    }

    document.getElementById('viewImgReferred').textContent = escapeHtml(report.referredBy || report.doctorName || '—');
    document.getElementById('viewImgDoctor').textContent = escapeHtml(report.referredBy || report.doctorName || '—');
    document.getElementById('viewImgDate').textContent = escapeHtml(report.reportDate || (report.createdAt ? formatDate(report.createdAt) : '—'));
    document.getElementById('viewImgStatus').textContent = escapeHtml((report.status || 'pending').toLowerCase().trim());
    document.getElementById('viewImgNotes').textContent = escapeHtml(report.notes || 'No custom notes.');
    
    // Handle view PDF button in modal
    const pdfBtn = document.getElementById('viewImgPdfBtn');
    if (pdfBtn) {
        if (report.fileUrl || report.pdfUrl) {
            pdfBtn.style.display = 'inline-flex';
            pdfBtn.onclick = function() {
                window.open(report.fileUrl || report.pdfUrl, '_blank');
            };
        } else {
            pdfBtn.style.display = 'none';
        }
    }

    document.getElementById('viewImgModal').classList.add('active');
}
document.getElementById('closeViewImgModal') && document.getElementById('closeViewImgModal').addEventListener('click', () => {
    document.getElementById('viewImgModal').classList.remove('active');
});

// CHANGE 7 — Unified PDF view report
function viewReport(reportId) {
    firebase.firestore().collection('reports').doc(reportId).get()
    .then(function(doc) {
        if (!doc.exists) { showToast('Report not found', 'error'); return; }
        var r = doc.data();
        if (r.pdfUrl || r.fileUrl) {
            window.open(r.pdfUrl || r.fileUrl, '_blank');
        } else {
            showToast('No PDF uploaded for this report yet', 'warning');
        }
    }).catch(function(err) {
        showToast('Error: ' + err.message, 'error');
    });
}
window.viewReport = viewReport;

// ==========================================
// 6. EDIT EXISTING REPORT (PART 7)
// ==========================================
function openEditReport(docId) {
    activeReportDocId = docId;
    clearPatient_img();
    
    db.collection('reports').doc(docId).get()
    .then(docSnap => {
        if (!docSnap.exists) return;
        const report = docSnap.data();
        
        // Find patient
        db.collection('patients').where('patientId', '==', report.patientId).get()
        .then(snap => {
            if (!snap.empty) {
                const pDoc = snap.docs[0];
                const pData = pDoc.data();
                selectedPatient_img = {
                    docId: pDoc.id,
                    patientId: pData.patientId,
                    name: pData.name,
                    doctor: pData.doctor || '',
                    department: pData.department || '',
                    phone: pData.phone || '',
                    age: pData.age || '',
                    gender: pData.gender || ''
                };
                document.getElementById('img_patientSearchInput').value = selectedPatient_img.name + ' — ' + selectedPatient_img.patientId;
                document.getElementById('img_cardPatientName').textContent = selectedPatient_img.name;
                document.getElementById('img_cardPatientId').textContent = selectedPatient_img.patientId;
                document.getElementById('img_cardAgeGender').textContent = (selectedPatient_img.age || '—') + ' / ' + (selectedPatient_img.gender || '—');
                
                loadDoctors_img(report.referredBy || selectedPatient_img.doctor);
                populateDeptSelect('img_deptSelect', report.visitDepartment || selectedPatient_img.department || '');
                document.getElementById('img_selectedPatientCard').style.display = 'block';
            }
            
            document.getElementById('imgType').value = report.imagingType || 'X-Ray';
            
            // Set Single/Panel mode and pre-fill tests
            if (report.tests && report.tests.length > 1) {
                document.getElementById('btnPanelMode').click();
                document.getElementById('imgPanelName').value = report.testName || '';
                const container = document.getElementById('panelRowsContainer');
                if (container) container.innerHTML = '';
                report.tests.forEach(t => addPanelRow(t.name, t.amount));
            } else {
                document.getElementById('btnSingleTestMode').click();
                document.getElementById('imgTestName').value = report.testName || '';
                document.getElementById('imgTestAmount').value = report.amount || 0;
            }
            
            document.getElementById('imgTestDate').value = report.reportDate || '';
            document.getElementById('imgStatus').value = (report.status || 'pending').toLowerCase().trim();
            document.getElementById('imgNotes').value = report.notes || '';
            if (document.getElementById('imgReferredBy')) {
                document.getElementById('imgReferredBy').value = report.referredBy || report.doctorName || '';
            }
            
            // Open Modal
            document.getElementById('uploadReportModal').classList.add('active');
        });
    })
    .catch(err => {
        console.error("Error setting up edit report:", err);
        showToast("Error retrieving report details for editing.", "error");
    });
}
window.openEditReport = openEditReport;

// ==========================================
// 7. MODAL SINGLE/PANEL TOGGLE & ROW CALCULATOR (PART 3)
// ==========================================
const uploadReportModal = document.getElementById('uploadReportModal');
document.getElementById('uploadReportBtn') && document.getElementById('uploadReportBtn').addEventListener('click', () => {
    activeReportDocId = null;
    clearPatient_img();
    document.getElementById('uploadReportForm').reset();
    uploadReportModal.classList.add('active');
    
    if (document.getElementById('btnSingleTestMode')) {
        document.getElementById('btnSingleTestMode').click();
    }
});
document.getElementById('closeUploadModalBtn') && document.getElementById('closeUploadModalBtn').addEventListener('click', () => {
    activeReportDocId = null;
    uploadReportModal.classList.remove('active');
});
document.getElementById('cancelUploadBtn') && document.getElementById('cancelUploadBtn').addEventListener('click', () => {
    activeReportDocId = null;
    uploadReportModal.classList.remove('active');
});

const btnSingleMode = document.getElementById('btnSingleTestMode');
const btnPanelMode = document.getElementById('btnPanelMode');
const singleTestFields = document.getElementById('singleTestFields');
const panelFields = document.getElementById('panelFields');
const imgUploadMode = document.getElementById('imgUploadMode');

if (btnSingleMode && btnPanelMode) {
    btnSingleMode.addEventListener('click', () => {
        btnSingleMode.className = 'btn-primary';
        btnPanelMode.className = 'btn-secondary';
        btnPanelMode.style.cssText = 'flex:1; justify-content:center; background:#f1f5f9; color:#334155; border-color:#cbd5e1;';
        singleTestFields.style.display = 'block';
        panelFields.style.display = 'none';
        imgUploadMode.value = 'single';
        document.getElementById('imgTestName').required = true;
        document.getElementById('imgPanelName').required = false;
    });

    btnPanelMode.addEventListener('click', () => {
        btnPanelMode.className = 'btn-primary';
        btnSingleMode.className = 'btn-secondary';
        btnSingleMode.style.cssText = 'flex:1; justify-content:center; background:#f1f5f9; color:#334155; border-color:#cbd5e1;';
        singleTestFields.style.display = 'none';
        panelFields.style.display = 'block';
        imgUploadMode.value = 'panel';
        document.getElementById('imgTestName').required = false;
        document.getElementById('imgPanelName').required = true;
        if (document.getElementById('panelRowsContainer').children.length === 0) {
            addPanelRow();
        }
    });
}

function addPanelRow(testName = '', amount = 0) {
    const container = document.getElementById('panelRowsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:10px; align-items:center; margin-bottom: 5px;';
    row.innerHTML = `
        <input type="text" class="panel-test-name" placeholder="Scan Name" value="${testName}" required style="flex:2; padding:10px 15px; border:1px solid var(--border-color); border-radius:6px;">
        <input type="number" class="panel-test-amount" placeholder="Amount" value="${amount || ''}" min="0" required style="flex:1; padding:10px 15px; border:1px solid var(--border-color); border-radius:6px;">
        <button type="button" class="btn-secondary btn-remove-row" style="padding:10px; color:red; border-color:red; height:42px;"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);

    row.querySelector('.panel-test-amount').addEventListener('input', calculatePanelTotal);
    row.querySelector('.btn-remove-row').addEventListener('click', () => {
        if (container.children.length > 1) {
            row.remove();
            calculatePanelTotal();
        } else {
            showToast('At least one scan row is required in panel mode.', 'warning');
        }
    });
    calculatePanelTotal();
}

function calculatePanelTotal() {
    const amounts = document.querySelectorAll('.panel-test-amount');
    let total = 0;
    amounts.forEach(inp => {
        total += parseFloat(inp.value) || 0;
    });
    const totalEl = document.getElementById('imgPanelTotalAmount');
    if (totalEl) totalEl.textContent = total.toFixed(2);
}

document.getElementById('btnAddPanelRow') && document.getElementById('btnAddPanelRow').addEventListener('click', () => addPanelRow());

// ==========================================
// 8. SAVE REPORT LOGIC (PART 3 & 4)
// ==========================================
document.getElementById('saveReportBtn').addEventListener('click', async () => {
    if (!selectedPatient_img) { showToast("Please select a patient first.", "warning"); return; }
    
    const imgType = document.getElementById('imgType').value;
    const isPanel = document.getElementById('imgUploadMode').value === 'panel';
    const testDate = document.getElementById('imgTestDate').value;
    const referredBy = document.getElementById('imgReferredBy').value;
    const status = document.getElementById('imgStatus').value;
    const notes = document.getElementById('imgNotes').value.trim();
    
    if (!testDate || !referredBy) { showToast("Please fill date and referred doctor.", "warning"); return; }

    let finalTestName = '';
    let testsArray = [];
    let totalAmount = 0;

    if (isPanel) {
        finalTestName = document.getElementById('imgPanelName').value.trim();
        if (!finalTestName) { showToast("Please enter panel name.", "warning"); return; }
        
        const rows = document.querySelectorAll('#panelRowsContainer > div');
        rows.forEach(row => {
            const name = row.querySelector('.panel-test-name').value.trim();
            const amount = parseFloat(row.querySelector('.panel-test-amount').value) || 0;
            if (name) {
                testsArray.push({ name, amount });
                totalAmount += amount;
            }
        });
        if (testsArray.length === 0) {
            showToast("At least one scan name is required.", "warning");
            return;
        }
    } else {
        finalTestName = document.getElementById('imgTestName').value.trim();
        const amountVal = parseFloat(document.getElementById('imgTestAmount').value) || 0;
        if (!finalTestName) { showToast("Please enter scan name.", "warning"); return; }
        testsArray.push({ name: finalTestName, amount: amountVal });
        totalAmount = amountVal;
    }

    const scanFile = document.getElementById('scanImageFile') ? document.getElementById('scanImageFile').files[0] : null;
    const pdfFile = document.getElementById('reportPdfFile') ? document.getElementById('reportPdfFile').files[0] : null;
    
    if (scanFile) {
        if (!['image/jpeg', 'image/png', 'image/jpg'].includes(scanFile.type)) {
            showToast('Scan image must be a JPEG or PNG.', 'error');
            return;
        }
        if (scanFile.size >= 20 * 1024 * 1024) {
            showToast('Scan image must be under 20MB.', 'error');
            return;
        }
    }
    if (pdfFile) {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(pdfFile.type)) {
            showToast('Scanned report must be PDF, JPG or PNG.', 'error');
            return;
        }
        if (pdfFile.size >= 20 * 1024 * 1024) {
            showToast('Scanned report must be under 20MB.', 'error');
            return;
        }
    }

    const saveBtn = document.getElementById('saveReportBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const reportData = {
        testName: finalTestName,
        tests: testsArray,
        totalAmount: totalAmount,
        amount: totalAmount,
        imagingType: imgType,
        referredBy: referredBy,
        doctorName: referredBy,
        reportDate: testDate,
        status: status,
        notes: notes,
        visitDoctor: document.getElementById('img_doctorSelect').value || selectedPatient_img.doctor || '',
        visitDepartment: document.getElementById('img_deptSelect').value || selectedPatient_img.department || '',
        uploadedBy: currentUserEmail,
        uploadedReport: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (status === 'Ready') {
        reportData.notifyPatient = true;
        reportData.patientPhone = selectedPatient_img.phone || '';
        reportData.reportReadyAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    // PACS identifiers. The accession number is what the modality worklist
    // and the HMS order have in common, so it is minted here if the operator
    // has not pasted one in.
    if (imagingPacsConfig.enabled) {
        var accessionInput = document.getElementById('imgAccessionNumber');
        var studyUidInput = document.getElementById('imgStudyInstanceUID');
        var accession = accessionInput ? accessionInput.value.trim() : '';
        if (!accession) {
            try {
                accession = await generateAccessionNumber(imgType);
                if (accessionInput) accessionInput.value = accession;
            } catch (err) {
                console.warn('Could not allocate an accession number:', err);
            }
        }
        if (accession) reportData.accessionNumber = accession;
        if (studyUidInput && studyUidInput.value.trim()) {
            reportData.studyInstanceUID = studyUidInput.value.trim();
        }
    }

    try {
        const qId = window.currentQueueData ? window.currentQueueData.queueId : (activeReportDocId || db.collection("reports").doc().id);
        let imageUrl = '';
        let pdfUrl = '';

        if (scanFile || pdfFile) {
            document.getElementById('imgUploadProgressContainer').style.display = 'block';
        }

        if (scanFile) {
            let fileToUpload = scanFile;
            await new Promise(resolve => {
                compressImage(scanFile, function(compressed) {
                    fileToUpload = compressed;
                    resolve();
                });
            });

            const scanPath = `imaging/${selectedPatient_img.patientId}/${qId}_scan.jpg`;
            const scanRef = firebase.storage().ref(scanPath);
            const uploadScanTask = scanRef.put(fileToUpload);
            
            await new Promise((resolve, reject) => {
                uploadScanTask.on('state_changed',
                    snap => {
                        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                        document.getElementById('imgUploadProgress').style.width = pct + '%';
                        document.getElementById('imgUploadPct').textContent = pct + '%';
                    },
                    err => reject(err),
                    async () => {
                        try {
                        imageUrl = await uploadScanTask.snapshot.ref.getDownloadURL();
                        resolve();
                        } catch (error) { reject(error); }
                    }
                );
            });
        }

        if (pdfFile) {
            const extension = pdfFile.type === 'application/pdf' ? 'pdf' : pdfFile.type === 'image/png' ? 'png' : 'jpg';
            const pdfPath = `imaging/${selectedPatient_img.patientId}/${qId}_${Date.now()}_report.${extension}`;
            const pdfRef = firebase.storage().ref(pdfPath);
            const uploadPdfTask = pdfRef.put(pdfFile);
            
            await new Promise((resolve, reject) => {
                uploadPdfTask.on('state_changed',
                    snap => {
                        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                        document.getElementById('imgUploadProgress').style.width = pct + '%';
                        document.getElementById('imgUploadPct').textContent = pct + '%';
                    },
                    err => reject(err),
                    async () => {
                        try {
                        pdfUrl = await uploadPdfTask.snapshot.ref.getDownloadURL();
                        resolve();
                        } catch (error) { reject(error); }
                    }
                );
            });
        }

        if (scanFile || pdfFile) {
            document.getElementById('imgUploadProgressContainer').style.display = 'none';
        }

        if (imageUrl) reportData.imageUrl = imageUrl;
        if (pdfUrl) {
            reportData.pdfUrl = pdfUrl;
            reportData.fileUrl = pdfUrl;
            reportData.fileName = pdfFile ? pdfFile.name : '';
            reportData.fileContentType = pdfFile ? pdfFile.type : ''; 
        }

        let finalReportId = '';
        if (activeReportDocId) {
            const doc = await db.collection("reports").doc(activeReportDocId).get();
            finalReportId = doc.exists ? (doc.data().reportId || activeReportDocId) : activeReportDocId;
            await db.collection("reports").doc(activeReportDocId).update(reportData);
            showToast("Imaging report updated successfully!", "success");
        } else {
            const random = Math.floor(Math.random() * 90000) + 10000;
            const reportId = `SA-IMG-${new Date().getFullYear()}-${random}`;
            finalReportId = reportId;
            
            reportData.type = 'imaging';
            reportData.reportId = reportId;
            reportData.patientId = selectedPatient_img.patientId;
            reportData.patientDocId = selectedPatient_img.docId;
            reportData.patientName = selectedPatient_img.name;
            if (window.currentQueueData) {
                reportData.billingStatus = 'billed';
                reportData.linkedBillId = window.currentQueueData.billId || '';
            } else if (window.currentBillData) {
                reportData.billingStatus = 'paid';
                reportData.linkedBillId = window.currentBillData.billId || '';
            } else {
                reportData.billingStatus = 'unbilled';
                reportData.linkedBillId = '';
            }
            reportData.visitType = 'OPD';
            reportData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            
            await db.collection("reports").add(reportData);
            showToast(`New imaging report ${reportId} saved successfully!`, "success");
        }

        // Update the queue / bill (PART 2)
        if (window.currentQueueData) {
            await db.collection("imagingQueue").doc(window.currentQueueData.queueDocId).update({
                reportStatus: "ready",
                reportId: finalReportId,
                completedAt: firebase.firestore.FieldValue.serverTimestamp(),
                completedBy: currentUserEmail
            });

            // Check if all labQueue and imagingQueue items for this bill are resolved
            const labSnap = await db.collection("labQueue").where("billDocId", "==", window.currentQueueData.billDocId).get();
            const imgSnap = await db.collection("imagingQueue").where("billDocId", "==", window.currentQueueData.billDocId).get();
            
            let allReady = true;
            labSnap.forEach(d => { if (d.data().reportStatus !== "ready") allReady = false; });
            imgSnap.forEach(d => { if (d.id !== window.currentQueueData.queueDocId && d.data().reportStatus !== "ready") allReady = false; });
            
            if (allReady) {
                const billRef = db.collection('bills').doc(window.currentQueueData.billDocId);
                const updateData = { reportStatus: "ready" };
                await billRef.update(updateData);
                const billDoc = await billRef.get();
                if (billDoc.exists && billDoc.data().patientDocId) {
                    await db.collection('patients').doc(billDoc.data().patientDocId).collection('bills').doc(window.currentQueueData.billDocId).update(updateData);
                }
                showToast("All lab/scan reports for this bill are ready!", "success");
            }
            window.currentQueueData = null;
            loadPendingLabWork();
        } else if (window.currentBillData) {
            const billRef = db.collection('bills').doc(window.currentBillData.billDocId);
            await billRef.update({
                labCompleted: true,
                labReportId: finalReportId,
                labReportUrl: pdfUrl || imageUrl || '',
                labCompletedAt: firebase.firestore.FieldValue.serverTimestamp(),
                labCompletedBy: currentUserEmail,
                notifyPatient: true,
                notifyDoctor: true
            });
            showToast('Bill updated. Doctor and patient notified.', 'success');
            window.currentBillData = null;
            loadPendingLabWork();
        }

        activeReportDocId = null;
        uploadReportModal.classList.remove('active');
        document.getElementById('uploadReportForm').reset();
        clearPatient_img();
    } catch (err) {
        console.error("Error saving report:", err);
        showToast("Error saving report: " + err.message, "error");
        if (document.getElementById('imgUploadProgressContainer')) {
            document.getElementById('imgUploadProgressContainer').style.display = 'none';
        }
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Report";
    }
});

// ==========================================
// 9. PATIENT SEARCH LOGIC
// ==========================================
function searchPatient_img(query) {
    var dropdown = document.getElementById('img_patientSearchResults');
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
        showPatientDropdown_img(results);
    })
    .catch(function(err) {
        dropdown.innerHTML = '<div style="padding:10px;color:red;">Error: ' + err.message + '</div>';
    });
}
window.searchPatient_img = searchPatient_img;

function showPatientDropdown_img(patients) {
    var dropdown = document.getElementById('img_patientSearchResults');
    if (!patients.length) {
        dropdown.innerHTML = '<div style="padding:10px;color:#666;">No patients found</div>';
        return;
    }
    var html = '';
    patients.forEach(function(p) {
        html += '<div onclick="selectPatient_img(this)" '
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
window.showPatientDropdown_img = showPatientDropdown_img;

function selectPatient_img(el) {
    selectedPatient_img = {
        docId: el.dataset.docid || el.getAttribute('data-docid'),
        patientId: el.dataset.patientid || el.getAttribute('data-patientid'),
        name: el.dataset.name || el.getAttribute('data-name'),
        doctor: el.dataset.doctor || el.getAttribute('data-doctor'),
        department: el.dataset.dept || el.getAttribute('data-dept'),
        phone: el.dataset.phone || el.getAttribute('data-phone'),
        age: el.dataset.age || el.getAttribute('data-age'),
        gender: el.dataset.gender || el.getAttribute('data-gender')
    };
    document.getElementById('img_patientSearchInput').value = selectedPatient_img.name + ' — ' + selectedPatient_img.patientId;
    document.getElementById('img_patientSearchResults').style.display = 'none';
    document.getElementById('img_cardPatientName').textContent = selectedPatient_img.name;
    document.getElementById('img_cardPatientId').textContent = selectedPatient_img.patientId;
    document.getElementById('img_cardAgeGender').textContent = (selectedPatient_img.age || '—') + ' / ' + (selectedPatient_img.gender || '—');
    loadDoctors_img(selectedPatient_img.doctor);
    populateDeptSelect('img_deptSelect', selectedPatient_img.department || '');
    document.getElementById('img_selectedPatientCard').style.display = 'block';
}
window.selectPatient_img = selectPatient_img;

function clearPatient_img() {
    selectedPatient_img = null;
    document.getElementById('img_patientSearchInput').value = '';
    document.getElementById('img_selectedPatientCard').style.display = 'none';
    document.getElementById('img_patientSearchResults').style.display = 'none';
    document.getElementById('img_patientSearchInput').focus();
}
window.clearPatient_img = clearPatient_img;

function loadDoctors_img(defaultDoctor) {
    var select = document.getElementById('img_doctorSelect');
    var referredSelect = document.getElementById('imgReferredBy');
    
    if (select) select.innerHTML = '<option value="">Select Doctor</option>';
    if (referredSelect) referredSelect.innerHTML = '<option value="">Select Doctor</option>';
    
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
                if (referredSelect) {
                    var opt2 = document.createElement('option');
                    opt2.value = d; opt2.textContent = d;
                    if (d === defaultDoctor) opt2.selected = true;
                    referredSelect.appendChild(opt2);
                }
            });
        } else {
            snap.forEach(function(doc) {
                var d = doc.data();
                var active = d.isActive === true || d.isActive === 'true';
                if (!active) return;
                if (select) {
                    var opt = document.createElement('option');
                    opt.value = d.name;
                    opt.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                    if (d.name === defaultDoctor) opt.selected = true;
                    select.appendChild(opt);
                }
                if (referredSelect) {
                    var opt2 = document.createElement('option');
                    opt2.value = d.name;
                    opt2.textContent = d.name + (d.specialisation ? ' — ' + d.specialisation : '');
                    if (d.name === defaultDoctor) opt2.selected = true;
                    referredSelect.appendChild(opt2);
                }
            });
        }
    });
}

// ==========================================
// 10. BILLING HELPER FUNCTIONS (PART 4)
// ==========================================
function updateBillingStatus(reportId, status, billId) {
    return db.collection('reports').doc(reportId).update({
        billingStatus: status,
        linkedBillId: billId || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
window.updateBillingStatus = updateBillingStatus;

function markReportPaid(reportId) {
    return db.collection('reports').doc(reportId).update({
        billingStatus: 'paid',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
window.markReportPaid = markReportPaid;

// ==========================================
// IMAGE COMPRESSION UTILITY (PART 3)
// ==========================================
function compressImage(file, callback) {
    if (!file.type.startsWith('image/')) { callback(file); return; }
    var maxSizeKB = 800;
    if (file.size <= maxSizeKB * 1024) { callback(file); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
            var canvas = document.createElement('canvas');
            var maxWidth = 1920;
            var ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
            if (ratio < 1) {
                canvas.width = img.width * ratio;
                canvas.height = img.height * ratio;
            } else {
                canvas.width = img.width;
                canvas.height = img.height;
            }
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function(blob) {
                var compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
                var originalKB = Math.round(file.size / 1024);
                var compressedKB = Math.round(compressedFile.size / 1024);
                // console.log('Image compressed: ' + originalKB + 'KB → ' + compressedKB + 'KB'); // removed for production
                showToast('Image compressed: ' + originalKB + 'KB → ' + compressedKB + 'KB', 'info');
                callback(compressedFile);
            }, 'image/jpeg', 0.75);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
window.compressImage = compressImage;

// ==========================================
// FILEREADER IMAGE PREVIEW (PART 3)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const scanImageInput = document.getElementById('scanImageFile');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    
    if (scanImageInput) {
        scanImageInput.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    if (previewImg) previewImg.src = e.target.result;
                    if (imagePreview) imagePreview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            } else {
                if (imagePreview) imagePreview.style.display = 'none';
            }
        });
    }
});

// ==========================================
// EXPORT REPORTS AS CSV (PART 9)
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const imgSearchInput = document.getElementById('img_patientSearchInput');
    if (imgSearchInput) {
        var debouncedSearchImg = debounce(function(query) {
            searchPatient_img(query);
        }, 300);
        imgSearchInput.addEventListener('input', function() {
            debouncedSearchImg(this.value.trim());
        });
    }
});

document.getElementById('exportImagingBtn') && document.getElementById('exportImagingBtn').addEventListener('click', function() {
    const patVal = document.getElementById('filterPatient').value.toLowerCase().trim();
    const statusVal = document.getElementById('filterStatus').value;
    const billVal = document.getElementById('filterBilling').value;
    const fromVal = document.getElementById('filterFromDate').value;
    const toVal = document.getElementById('filterToDate').value;
    
    let filtered = allReports;
    
    if (patVal) {
        filtered = filtered.filter(r => 
            (r.patientName && r.patientName.toLowerCase().includes(patVal)) ||
            (r.patientId && r.patientId.toLowerCase().includes(patVal)) ||
            (r.reportId && r.reportId.toLowerCase().includes(patVal)) ||
            (r.imagingType && r.imagingType.toLowerCase().includes(patVal))
        );
    }
    
    if (statusVal !== 'All') {
        filtered = filtered.filter(r => String(r.status || '').toLowerCase() === String(statusVal).toLowerCase());
    }
    
    if (billVal !== 'All') {
        filtered = filtered.filter(r => (r.billingStatus || 'unbilled').toLowerCase() === billVal.toLowerCase());
    }
    
    if (fromVal) {
        const fromDate = new Date(fromVal);
        fromDate.setHours(0,0,0,0);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate >= fromDate;
        });
    }
    if (toVal) {
        const toDate = new Date(toVal);
        toDate.setHours(23,59,59,999);
        filtered = filtered.filter(r => {
            const rDate = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null);
            if (!rDate) return false;
            rDate.setHours(0,0,0,0);
            return rDate <= toDate;
        });
    }
    
    const exportData = filtered.map(r => ({
        "Report ID": r.reportId || r.id.substring(0, 8),
        "Patient Name": r.patientName || '',
        "Patient ID": r.patientId || '',
        "Type": r.imagingType || '',
        "Scan Name": r.testName || '',
        "Amount": r.totalAmount || r.amount || 0,
        "Date": r.reportDate || '',
        "Billing Status": r.billingStatus || 'unbilled',
        "Status": r.status || ''
    }));
    
    exportToCSV(exportData, "Imaging_Reports_Export");
});

// ==========================================
// EXPORT IMAGING REPORTS AS CSV
// The markup has had an Export CSV button since launch with no handler
// bound to it, so the control did nothing when clicked.
// ==========================================
document.getElementById('exportImagingBtn') && document.getElementById('exportImagingBtn').addEventListener('click', function () {
    var patVal = (document.getElementById('filterPatient').value || '').toLowerCase().trim();
    var statusVal = document.getElementById('filterStatus').value;
    var billVal = document.getElementById('filterBilling').value;
    var fromVal = document.getElementById('filterFromDate').value;
    var toVal = document.getElementById('filterToDate').value;

    var filtered = allReports;

    if (patVal) {
        filtered = filtered.filter(function (r) {
            return (r.patientName && r.patientName.toLowerCase().indexOf(patVal) !== -1)
                || (r.patientId && r.patientId.toLowerCase().indexOf(patVal) !== -1)
                || (r.reportId && r.reportId.toLowerCase().indexOf(patVal) !== -1);
        });
    }
    if (statusVal !== 'All') filtered = filtered.filter(function (r) { return String(r.status || '').toLowerCase() === String(statusVal).toLowerCase(); });
    if (billVal !== 'All') {
        filtered = filtered.filter(function (r) {
            return String(r.billingStatus || 'unbilled').toLowerCase() === String(billVal).toLowerCase();
        });
    }

    function reportDate(r) {
        if (r.reportDate) return new Date(r.reportDate);
        if (r.createdAt) return r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        return null;
    }
    if (fromVal) {
        var fromDate = new Date(fromVal); fromDate.setHours(0, 0, 0, 0);
        filtered = filtered.filter(function (r) {
            var d = reportDate(r); if (!d) return false; d.setHours(0, 0, 0, 0); return d >= fromDate;
        });
    }
    if (toVal) {
        var toDate = new Date(toVal); toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(function (r) {
            var d = reportDate(r); if (!d) return false; return d <= toDate;
        });
    }

    if (!filtered.length) { showToast('No imaging reports match the current filters.', 'warning'); return; }

    exportToCSV(filtered.map(function (r) {
        return {
            "Report ID": r.reportId || String(r.id || '').substring(0, 8),
            "Patient Name": r.patientName || '',
            "Patient ID": r.patientId || '',
            "Referred By": r.referredBy || '',
            "Study": r.testName || r.imagingType || '',
            "Accession No": r.accessionNumber || '',
            "Study UID": r.studyInstanceUID || '',
            "Amount": r.totalAmount || r.amount || 0,
            "Date": r.reportDate || '',
            "Billing Status": r.billingStatus || 'unbilled',
            "Status": r.status || ''
        };
    }), "Imaging_Reports_Export");
});
