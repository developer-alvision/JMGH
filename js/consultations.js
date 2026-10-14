checkAccess(['doctor', 'admin', 'owner']);
let currentUserEmail = '';
let currentUserRole = '';
let currentDoctorName = '';
let currentUserUid = '';

getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    currentUserRole = (user.role || '').toLowerCase();
    currentUserUid = user.uid || user.docId || '';

    if (currentUserRole === 'doctor') {
        currentDoctorName = user.name || '';
        const filterSelect = document.getElementById('filterDoctor');
        if (filterSelect) {
            filterSelect.value = currentDoctorName;
            filterSelect.disabled = true;
        }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const ptIdParam = urlParams.get('patientId');
    if (ptIdParam) {
        const searchInput = document.getElementById('filterSearch');
        if (searchInput) searchInput.value = ptIdParam;
    }

    loadDoctorFilter();
    loadConsultations();
});

function loadDoctorFilter() {
    const select = document.getElementById('filterDoctor');
    if (!select) return;

    db.collection('staff').where('role', '==', 'doctor').get().then(snap => {
        snap.forEach(doc => {
            const d = doc.data();
            const active = d.isActive === true || d.isActive === 'true';
            if (!active) return;
            if ([...select.options].some(opt => opt.value === d.name)) return;
            const opt = document.createElement('option');
            opt.value = d.name;
            opt.textContent = d.name;
            select.appendChild(opt);
        });
        if (currentUserRole === 'doctor' && currentDoctorName) {
            select.value = currentDoctorName;
            select.disabled = true;
        }
    }).catch(err => console.error('Error loading doctors for filters:', err));
}

let allConsultations = [];

function normalizeId(v) {
    return String(v || '').toLowerCase().replace(/[\s_-]/g, '');
}

function loadConsultations() {
    const tbody = document.getElementById('consultationsTableBody');
    if (!tbody) return;

    tbody.innerHTML = "<tr><td colspan='8' style='text-align: center;'><i class='fa-solid fa-spinner fa-spin'></i> Loading consultations...</td></tr>";

    function ingest(snapshot) {
        allConsultations = [];
        snapshot.forEach(doc => {
            allConsultations.push({ id: doc.id, ...doc.data() });
        });
        // Prefer newest first even if orderBy failed
        allConsultations.sort(function (a, b) {
            var da = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : (a.date ? new Date(a.date) : new Date(0)));
            var db_ = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : (b.date ? new Date(b.date) : new Date(0)));
            return db_ - da;
        });
        applyFilters();
    }

    db.collection('consultations').orderBy('createdAt', 'desc').limit(500).get()
        .then(ingest)
        .catch(function () {
            // Fallback when createdAt index/missing field blocks the query
            return db.collection('consultations').limit(500).get().then(ingest);
        })
        .catch(err => {
            console.error('Error loading consultations:', err);
            tbody.innerHTML = `<tr><td colspan='8' style='text-align: center; color: red;'>Error loading consultations: ${err.message}</td></tr>`;
        });
}

function applyFilters() {
    const tbody = document.getElementById('consultationsTableBody');
    if (!tbody) return;

    const searchVal = (document.getElementById('filterSearch').value || '').trim().toLowerCase();
    const searchNorm = normalizeId(searchVal);
    const doctorVal = document.getElementById('filterDoctor').value;
    const statusVal = (document.getElementById('filterStatus').value || '').toLowerCase();
    const fromDate = document.getElementById('filterFromDate').value;
    const toDate = document.getElementById('filterToDate').value;

    const filtered = allConsultations.filter(c => {
        if (currentUserRole === 'doctor') {
            if (c.doctorName !== currentDoctorName && c.doctorId !== currentUserUid) return false;
        } else if (doctorVal && c.doctorName !== doctorVal) {
            return false;
        }

        if (searchVal) {
            const name = (c.patientName || '').toLowerCase();
            const ptId = (c.patientId || '').toLowerCase();
            const docId = (c.patientDocId || '').toLowerCase();
            const diag = (c.diagnosis || '').toLowerCase();
            const phone = (c.patientPhone || '').toLowerCase();
            const hit = name.includes(searchVal)
                || ptId.includes(searchVal)
                || docId.includes(searchVal)
                || diag.includes(searchVal)
                || phone.includes(searchVal)
                || (searchNorm && normalizeId(ptId).includes(searchNorm));
            if (!hit) return false;
        }

        if (statusVal) {
            const st = String(c.status || 'completed').toLowerCase();
            if (st !== statusVal) return false;
        }

        const cDate = c.createdAt
            ? (c.createdAt.toDate ? c.createdAt.toDate() : new Date(c.createdAt))
            : (c.date ? new Date(c.date) : null);

        if (fromDate) {
            if (!cDate || isNaN(cDate.getTime())) return false;
            const start = new Date(fromDate);
            start.setHours(0, 0, 0, 0);
            if (cDate < start) return false;
        }
        if (toDate) {
            if (!cDate || isNaN(cDate.getTime())) return false;
            const end = new Date(toDate);
            end.setHours(23, 59, 59, 999);
            if (cDate > end) return false;
        }

        return true;
    });

    renderTable(filtered, searchVal);
}

function renderTable(data, searchVal) {
    const tbody = document.getElementById('consultationsTableBody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        const tip = searchVal
            ? 'No consultations for this patient filter. Clear search or Reset to see all.'
            : (allConsultations.length === 0
                ? 'No consultations recorded yet.'
                : 'No consultations found matching the filters.');
        tbody.innerHTML = "<tr><td colspan='8' style='text-align: center; padding: 28px; color:#64748b;'>" + tip + '</td></tr>';
        return;
    }

    data.forEach(c => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => showConsultationDetails(c));

        const dateStr = formatDate(c.createdAt) || formatDate(c.date) || '—';
        const diagStr = c.diagnosis ? (c.diagnosis.length > 40 ? c.diagnosis.substring(0, 40) + '...' : c.diagnosis) : '—';
        const followUpStr = (c.followUpRequired && c.followUpDate) ? formatDate(c.followUpDate) : '—';

        let badgeClass = 'badge-completed';
        let statusText = 'Completed';
        const st = String(c.status || 'completed').toLowerCase();
        if (st === 'draft') {
            badgeClass = 'badge-draft';
            statusText = 'Draft';
        }

        const rxList = c.prescription || c.medicines || c.medications || c.rx || [];
        let rxSummaryHtml = '<span style="color:#94a3b8;font-size:11.5px;font-style:italic;">None</span>';
        if (rxList.length > 0) {
            const firstTwo = rxList.slice(0, 2).map(m => {
                const medName = m.name || m.medicineName || 'Medicine';
                const dosage = m.dosage ? ' ' + m.dosage : '';
                const freq = m.frequency ? ' (' + m.frequency + ')' : '';
                return `<strong>${escapeHtml(medName)}</strong>${escapeHtml(dosage + freq)}`;
            }).join(', ');
            const moreCount = rxList.length > 2 ? ` <span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10.5px;padding:1px 5px;border-radius:4px;">+${rxList.length - 2} more</span>` : '';
            rxSummaryHtml = `<div style="font-size:12px;color:#334155;line-height:1.35;"><i class="fa-solid fa-pills" style="color:#A61E4D;margin-right:4px;"></i>${firstTwo}${moreCount}</div>`;
        }

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><strong>${escapeHtml(c.patientName || '-')}</strong></td>
            <td><span style="font-weight:600;">${escapeHtml(c.patientId || '-')}</span></td>
            <td>${escapeHtml(c.doctorName || '-')}</td>
            <td>${escapeHtml(diagStr)}</td>
            <td>${rxSummaryHtml}</td>
            <td>${followUpStr}</td>
            <td><span class="status-badge ${badgeClass}">${statusText}</span></td>
            <td>
                <button type="button" class="btn-secondary" style="padding: 4px 8px; font-size:0.75rem;"><i class="fa-solid fa-eye"></i> View</button>
                ${st === 'draft' && currentUserRole !== 'owner' ? `<a class="btn-primary" style="padding:4px 8px;font-size:0.75rem;" href="consultation.html?patientId=${encodeURIComponent(c.patientId || '')}&consultationId=${encodeURIComponent(c.id)}${c.appointmentId ? '&appointmentId=' + encodeURIComponent(c.appointmentId) : ''}" onclick="event.stopPropagation()">Resume</a>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showConsultationDetails(c) {
    const modal = document.getElementById('consultationDetailsModal');
    if (!modal) return;

    document.getElementById('detPtName').textContent = c.patientName || 'Unknown';
    document.getElementById('detPtId').textContent = c.patientId || '—';
    document.getElementById('detDocName').textContent = c.doctorName || '—';
    document.getElementById('detDept').textContent = c.department || '—';

    const dateStr = formatDateTime(c.createdAt) || formatDate(c.date) || '—';
    document.getElementById('detDate').textContent = dateStr;

    const statusBadge = document.getElementById('detStatusBadge');
    const st = String(c.status || 'completed').toLowerCase();
    statusBadge.textContent = st === 'draft' ? 'Draft' : 'Completed';
    statusBadge.className = 'status-badge ' + (st === 'draft' ? 'badge-draft' : 'badge-completed');

    const v = c.vitals || {};
    document.getElementById('detBP').textContent = v.bp || '—';
    document.getElementById('detPulse').textContent = v.pulse ? v.pulse + ' bpm' : '—';
    document.getElementById('detTemp').textContent = v.temperature ? v.temperature + ' °F' : '—';
    document.getElementById('detWeight').textContent = v.weight ? v.weight + ' kg' : '—';
    document.getElementById('detHeight').textContent = v.height ? v.height + ' cm' : '—';
    document.getElementById('detSpO2').textContent = v.spo2 ? v.spo2 + ' %' : '—';

    document.getElementById('detChiefComplaint').textContent = c.chiefComplaint || '—';
    document.getElementById('detHistoryIllness').textContent = c.historyOfIllness || '—';
    document.getElementById('detExamFindings').textContent = c.examinationFindings || '—';
    document.getElementById('detDiagnosis').textContent = c.diagnosis || '—';
    document.getElementById('detAdvice').textContent = c.advice || '—';

    const labDiv = document.getElementById('detLabOrders');
    labDiv.innerHTML = '';
    if (c.labOrders && c.labOrders.length > 0) {
        c.labOrders.forEach(test => {
            const tag = document.createElement('span');
            tag.style.cssText = 'background:#f1f5f9; color:#334155; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600; margin:2px; display:inline-block;';
            tag.textContent = test.name;
            labDiv.appendChild(tag);
        });
    } else {
        labDiv.innerHTML = '<em>None ordered</em>';
    }

    const imgDiv = document.getElementById('detImagingOrders');
    imgDiv.innerHTML = '';
    if (c.imagingOrders && c.imagingOrders.length > 0) {
        c.imagingOrders.forEach(scan => {
            const tag = document.createElement('span');
            tag.style.cssText = 'background:#f1f5f9; color:#334155; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600; margin:2px; display:inline-block;';
            tag.textContent = scan.name;
            imgDiv.appendChild(tag);
        });
    } else {
        imgDiv.innerHTML = '<em>None ordered</em>';
    }

    const rxDiv = document.getElementById('detPrescriptionList');
    rxDiv.innerHTML = '';
    const rxItems = c.prescription || c.medicines || c.medications || c.rx || [];
    if (rxItems && rxItems.length > 0) {
        let rxTable = '<table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-top:4px;">'
            + '<thead><tr style="background:#fef9c3;color:#854d0e;text-align:left;">'
            + '<th style="padding:4px 6px;">Medicine</th><th style="padding:4px 6px;">Dosage</th><th style="padding:4px 6px;">Freq</th><th style="padding:4px 6px;">Duration</th><th style="padding:4px 6px;">Instructions</th>'
            + '</tr></thead><tbody>';
        rxItems.forEach(item => {
            rxTable += '<tr style="border-bottom:1px solid #fef08a;">'
                + `<td style="padding:4px 6px;font-weight:600;">${escapeHtml(item.name || item.medicineName || '')}</td>`
                + `<td style="padding:4px 6px;">${escapeHtml(item.dosage || '—')}</td>`
                + `<td style="padding:4px 6px;">${escapeHtml(item.frequency || '—')}</td>`
                + `<td style="padding:4px 6px;">${escapeHtml(item.duration || '—')}</td>`
                + `<td style="padding:4px 6px;color:#64748b;">${escapeHtml(item.instructions || '—')}</td>`
                + '</tr>';
        });
        rxTable += '</tbody></table>';
        rxDiv.innerHTML = rxTable;
    } else {
        rxDiv.innerHTML = '<em>None prescribed</em>';
    }

    document.getElementById('detFollowUpReq').textContent = c.followUpRequired ? 'Yes' : 'No';
    if (c.followUpRequired) {
        document.getElementById('detFollowUpDateDiv').style.display = 'block';
        document.getElementById('detFollowUpDate').textContent = formatDate(c.followUpDate) || '—';
        if (c.followUpNotes) {
            document.getElementById('detFollowUpNotesDiv').style.display = 'block';
            document.getElementById('detFollowUpNotes').textContent = c.followUpNotes;
        } else {
            document.getElementById('detFollowUpNotesDiv').style.display = 'none';
        }
    } else {
        document.getElementById('detFollowUpDateDiv').style.display = 'none';
        document.getElementById('detFollowUpNotesDiv').style.display = 'none';
    }

    const btnPrintRx = document.getElementById('btnPrintRxBilingual');
    if (btnPrintRx) {
        btnPrintRx.style.display = 'inline-block';
        const newBtn = btnPrintRx.cloneNode(true);
        btnPrintRx.parentNode.replaceChild(newBtn, btnPrintRx);
        newBtn.addEventListener('click', () => {
            if (typeof generateClinicalOPBillPDF === 'function') {
                generateClinicalOPBillPDF(c.id || c.consultationId, { consultation: c });
            } else if (typeof generateBilingualPrescriptionFromConsultationPDF === 'function') {
                generateBilingualPrescriptionFromConsultationPDF(c);
            }
        });
    }

    modal.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    const btnApply = document.getElementById('btnApplyFilters');
    if (btnApply) btnApply.addEventListener('click', applyFilters);

    const searchInput = document.getElementById('filterSearch');
    if (searchInput) {
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyFilters();
            }
        });
        searchInput.addEventListener('input', function () {
            if (!this.value.trim()) applyFilters();
        });
    }

    ['filterDoctor', 'filterStatus', 'filterFromDate', 'filterToDate'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', applyFilters);
    });

    const btnClear = document.getElementById('btnClearFilters');
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            document.getElementById('filterSearch').value = '';
            document.getElementById('filterDoctor').value = currentUserRole === 'doctor' ? currentDoctorName : '';
            document.getElementById('filterStatus').value = '';
            document.getElementById('filterFromDate').value = '';
            document.getElementById('filterToDate').value = '';
            applyFilters();
        });
    }

    const closeBtn = document.getElementById('closeDetailsModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('consultationDetailsModal').classList.remove('active');
        });
    }

    const dismissBtn = document.getElementById('btnDismissDetailsModal');
    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            document.getElementById('consultationDetailsModal').classList.remove('active');
        });
    }
});
