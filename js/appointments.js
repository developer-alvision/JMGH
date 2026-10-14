// ==========================================
// JMGH HMS - APPOINTMENTS SCHEDULER JS
// ==========================================

checkAccess(['admin', 'receptionist', 'doctor']);

let currentUserEmail = '';
let currentUserRole = '';
let currentDoctorName = '';
let currentDoctorId = '';
let selectedPatient = null;
let allDoctors = [];
let allAppointments = [];
let appointmentsUnsubscribe = null;

// Page Initial Load
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    currentUserRole = (user.role || '').toLowerCase();
    currentDoctorName = user.name || '';
    currentDoctorId = user.docId || user.uid || '';
    
    // Hide action buttons for owner
    if (currentUserRole === 'owner') {
        const btnBook = document.getElementById('btnOpenBookModal');
        if (btnBook) btnBook.style.display = 'none';
    }

    // Set default date to today using todayIso()
    const todayStr = todayIso();
    document.getElementById('filterDate').value = todayStr;
    
    const bookingDateEl = document.getElementById('bookingDate');
    if (bookingDateEl) {
        bookingDateEl.value = todayStr;
        bookingDateEl.min = todayStr;
    }
    const rescheduleDateEl = document.getElementById('rescheduleDate');
    if (rescheduleDateEl) {
        rescheduleDateEl.min = todayStr;
    }
    
    // Quick Filter Buttons
    const btnYest = document.getElementById('btnFilterYesterday');
    const btnToday = document.getElementById('btnFilterToday');
    const btnTom = document.getElementById('btnFilterTomorrow');
    const filterDateInput = document.getElementById('filterDate');
    
    function setFilterDate(d) {
        filterDateInput.value = d;
        [btnYest, btnToday, btnTom].forEach(b => {
            if (b) {
                b.style.backgroundColor = 'white';
                b.style.color = '#64748b';
                b.style.borderColor = '#cbd5e1';
            }
        });
        loadAppointments();
    }
    
    if (btnYest) btnYest.addEventListener('click', function() {
        var d = new Date(); d.setDate(d.getDate() - 1);
        var yestIso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        setFilterDate(yestIso);
        btnYest.style.backgroundColor = '#eff6ff'; btnYest.style.color = '#1e40af'; btnYest.style.borderColor = '#bfdbfe';
    });
    if (btnToday) btnToday.addEventListener('click', function() {
        setFilterDate(todayIso());
        btnToday.style.backgroundColor = '#eff6ff'; btnToday.style.color = '#1e40af'; btnToday.style.borderColor = '#bfdbfe';
    });
    if (btnTom) btnTom.addEventListener('click', function() {
        var d = new Date(); d.setDate(d.getDate() + 1);
        var tomIso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        setFilterDate(tomIso);
        btnTom.style.backgroundColor = '#eff6ff'; btnTom.style.color = '#1e40af'; btnTom.style.borderColor = '#bfdbfe';
    });
    
    if (btnToday) {
        btnToday.style.backgroundColor = '#eff6ff'; btnToday.style.color = '#1e40af'; btnToday.style.borderColor = '#bfdbfe';
    }
    
    // Load Doctors & Appointments Queue
    loadDoctorsList().then(() => {
        if (currentUserRole === 'doctor') {
            const filterSelect = document.getElementById('filterDoctor');
            if (filterSelect) {
                const docObj = allDoctors.find(d => d.name === currentDoctorName || d.id === currentDoctorId);
                if (docObj) {
                    filterSelect.value = docObj.id;
                }
                filterSelect.disabled = true;
            }
        }
        loadAppointments();
    });
});

// ==========================================
// 1. DOCTORS DROPDOWN LOAD
// ==========================================
function loadDoctorsList() {
    return loadDoctors()
        .then(doctors => {
            allDoctors = doctors;
            const filterSelect = document.getElementById('filterDoctor');
            const bookingSelect = document.getElementById('bookingDoctor');
            
            if (filterSelect) filterSelect.innerHTML = '<option value="">All Doctors</option>';
            if (bookingSelect) bookingSelect.innerHTML = '<option value="">Select Doctor</option>';
            
            doctors.forEach(doctor => {
                // Add to filter dropdown
                if (filterSelect) {
                    const opt = document.createElement('option');
                    opt.value = doctor.id;
                    opt.textContent = doctor.name;
                    filterSelect.appendChild(opt);
                }
                // Add to booking dropdown
                if (bookingSelect) {
                    const opt = document.createElement('option');
                    opt.value = doctor.id;
                    opt.textContent = doctor.name;
                    bookingSelect.appendChild(opt);
                }
            });
        }).catch(err => {
            console.error('Error loading doctors:', err);
            showToast('Error loading doctors.', 'error');
        });
}

// Booking form doctor select changes department & auto-populates consultation fee

var bookingFeePreviewVersion = 0;
async function refreshBookingPolicyFee() {
    var version = ++bookingFeePreviewVersion;
    var doctor = allDoctors.find(function(row) { return row.id === document.getElementById('bookingDoctor').value; });
    document.getElementById('bookingDept').value = doctor ? doctor.department || 'Gynaecology' : '';
    if (!doctor || !selectedPatient) return;
    var note = document.getElementById('bookingFeePolicyNote');
    if (note) note.textContent = 'Checking visit history…';
    try {
        var fee = await getHospitalOPFee(selectedPatient, doctor, document.getElementById('bookingDate').value || todayIso(), {
            visitType: document.getElementById('bookingVisitType').value === 'New Visit' ? 'New' : 'Review',
            phone: document.getElementById('bookingPhoneOP').checked
        });
        if (version !== bookingFeePreviewVersion) return;
        document.getElementById('bookingOpFee').value = fee.amount;
        updateBookingPaymentSummary();
        if (note) note.textContent = fee.reason + ' · ₹' + fee.amount;
    } catch (error) { if (note) note.textContent = 'Unable to check history. Retry before booking.'; }
}
document.getElementById('bookingDoctor').addEventListener('change', function() { refreshBookingPolicyFee(); updateTokenPreview(); });
['bookingDate', 'bookingVisitType', 'bookingPhoneOP'].forEach(function(id) { document.getElementById(id).addEventListener('change', refreshBookingPolicyFee); });


document.getElementById('bookingDate').addEventListener('change', updateTokenPreview);

// Live update of payment summary & fee toggles
function updateBookingPaymentSummary() {
    const feeInput = document.getElementById('bookingOpFee');
    const freeOpCheck = document.getElementById('bookingFreeOp');
    const freeOpGroup = document.getElementById('bookingFreeOpGroup');
    const payModeContainer = document.getElementById('bookingPayModeContainer');
    const feeSummary = document.getElementById('bookingFeeSummary');
    const badge = document.getElementById('bookingPayStatusBadge');
    
    if (!feeSummary || !badge) return;
    
    const isFree = freeOpCheck ? freeOpCheck.checked : false;
    if (isFree) {
        if (freeOpGroup) freeOpGroup.style.display = 'block';
        if (payModeContainer) payModeContainer.style.opacity = '0.4';
        if (feeInput) {
            feeInput.value = 0;
            feeInput.disabled = true;
        }
        feeSummary.textContent = '₹0';
        badge.textContent = 'Free OP (Waived)';
        badge.style.color = '#92400e';
    } else {
        if (freeOpGroup) freeOpGroup.style.display = 'none';
        if (payModeContainer) payModeContainer.style.opacity = '1';
        if (feeInput) feeInput.disabled = false;
        
        const feeVal = Number(feeInput ? feeInput.value : 0) || 0;
        feeSummary.textContent = '₹' + feeVal;
        
        const selectedModeEl = document.querySelector('input[name="bookingPayMode"]:checked');
        const mode = selectedModeEl ? selectedModeEl.value : 'Cash';
        
        if (mode === 'Due') {
            badge.textContent = 'Payment Due (Pay Later)';
            badge.style.color = '#ea580c';
        } else {
            badge.textContent = 'Paid via ' + mode;
            badge.style.color = '#16a34a';
        }
    }
}

// Payment mode radio and Fee input listeners
document.addEventListener('DOMContentLoaded', function() {
    initBookingPaymentUI();
});
function initBookingPaymentUI() {
    const feeInput = document.getElementById('bookingOpFee');
    const freeOpCheck = document.getElementById('bookingFreeOp');
    if (feeInput) feeInput.addEventListener('input', updateBookingPaymentSummary);
    if (freeOpCheck) freeOpCheck.addEventListener('change', updateBookingPaymentSummary);
    
    const payRadios = document.querySelectorAll('input[name="bookingPayMode"]');
    payRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            document.querySelectorAll('.pay-mode-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.style.border = '1px solid #cbd5e1';
                btn.style.background = 'white';
            });
            const parent = this.closest('.pay-mode-btn');
            if (parent) {
                parent.classList.add('active');
                parent.style.border = '1px solid #0D7A70';
                parent.style.background = '#f0fdf4';
            }
            updateBookingPaymentSummary();
        });
    });
}
// Run once immediately in case DOM is already loaded
initBookingPaymentUI();

// Sequential ID helper for quick patient creation
async function generateQuickPatientId() {
    const counterRef = db.collection('patientCounter').doc('counter');
    try {
        return await db.runTransaction(async (tx) => {
            const doc = await tx.get(counterRef);
            const count = doc.exists ? (doc.data().count || 0) + 1 : 1;
            tx.set(counterRef, { count: count }, { merge: true });
            return `SA-${new Date().getFullYear()}-${String(count).padStart(5, '0')}`;
        });
    } catch (err) {
        console.error('Counter error:', err);
        return `SA-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    }
}

// Quick Patient Mode state
let isQuickPatientMode = false;
const btnToggleQuickPatient = document.getElementById('btnToggleQuickPatient');
const btnCancelQuickPatient = document.getElementById('btnCancelQuickPatient');
const quickPatientSection = document.getElementById('quickPatientSection');
const searchPatientContainer = document.getElementById('searchPatientContainer');

if (btnToggleQuickPatient) {
    btnToggleQuickPatient.addEventListener('click', function() {
        isQuickPatientMode = true;
        quickPatientSection.style.display = 'block';
        searchPatientContainer.style.display = 'none';
        selectedPatient = null;
        document.getElementById('selectedPatientCard').style.display = 'none';
        const qName = document.getElementById('quickName');
        if (qName) qName.focus();
    });
}

if (btnCancelQuickPatient) {
    btnCancelQuickPatient.addEventListener('click', function() {
        isQuickPatientMode = false;
        quickPatientSection.style.display = 'none';
        searchPatientContainer.style.display = 'block';
    });
}

// Time Slot manager: filters past slots for Today, shows current & future times
const STANDARD_TIME_SLOTS = [
    "08:30 AM", "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM",
    "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "01:00 PM",
    "01:30 PM", "02:00 PM", "02:30 PM", "03:00 PM", "03:30 PM",
    "04:00 PM", "04:30 PM", "05:00 PM", "05:30 PM", "06:00 PM",
    "06:30 PM", "07:00 PM", "07:30 PM", "08:00 PM"
];

function parseSlotToMinutes(str) {
    const parts = String(str || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!parts) return 0;
    let h = parseInt(parts[1], 10);
    const m = parseInt(parts[2], 10);
    const isPM = parts[3].toUpperCase() === 'PM';
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return h * 60 + m;
}

function updateBookingTimeSlots(selectedDate) {
    const timeSelect = document.getElementById('bookingTime');
    if (!timeSelect) return;

    const isToday = (selectedDate === todayIso());
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let availableSlots = [];
    if (isToday) {
        // Filter out past slots: only keep slots >= (current time - 15 mins)
        availableSlots = STANDARD_TIME_SLOTS.filter(s => parseSlotToMinutes(s) >= (currentMins - 15));
        
        const formattedCurrent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        if (currentMins < parseSlotToMinutes("08:30 AM")) {
            // Before opening hours, all slots are available
            availableSlots = STANDARD_TIME_SLOTS.slice();
        } else if (availableSlots.length === 0) {
            // Late evening/night: show current immediate slot
            availableSlots = [`Current / Immediate OP (${formattedCurrent})`];
        } else {
            // Always offer immediate OP as first option for walk-ins today
            availableSlots.unshift(`Immediate OP (${formattedCurrent})`);
        }
    } else {
        // Future date: all standard daytime slots
        availableSlots = STANDARD_TIME_SLOTS.slice();
    }

    const prevVal = timeSelect.value;
    timeSelect.innerHTML = '<option value="">Select Slot</option>' + availableSlots.map(s => {
        return `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
    }).join('');

    if (prevVal && availableSlots.includes(prevVal)) {
        timeSelect.value = prevVal;
    } else if (availableSlots.length > 0) {
        timeSelect.value = availableSlots[0];
    }
}

document.getElementById('bookingDate').addEventListener('change', function() {
    updateBookingTimeSlots(this.value);
    updateTokenPreview();
});

// Live preview of token number on doctor & date select
function updateTokenPreview() {
    const docId = document.getElementById('bookingDoctor').value;
    const date = document.getElementById('bookingDate').value;
    const previewSpan = document.getElementById('tokenPreview');
    
    if (!docId || !date) {
        previewSpan.textContent = '# Will generate on booking';
        return;
    }
    
    db.collection('appointmentCounters').doc(docId + '_' + date).get().then(snap => {
        const nextToken = (snap.exists ? Number(snap.data().count) || 0 : 0) + 1;
        previewSpan.textContent = `Estimated token: #${nextToken} (confirmed on booking)`;
    }).catch(function () { previewSpan.textContent = '# Will generate on booking'; });
}

// ==========================================
// 2. APPOINTMENTS QUEUE LOADER
// ==========================================
function loadAppointments() {
    if (appointmentsUnsubscribe) appointmentsUnsubscribe();
    const date = document.getElementById('filterDate').value;
    let docFilter = document.getElementById('filterDoctor').value;
    
    if (currentUserRole === 'doctor') {
        const docObj = allDoctors.find(d => d.name === currentDoctorName || d.id === currentDoctorId);
        if (docObj) docFilter = docObj.id;
    }
    
    setLoadingRow('appointmentsTableBody', 10);
    
    let query = db.collection('appointments').where('appointmentDate', '==', date);
    
    const selectedDoctor = allDoctors.find(function (doctor) { return doctor.id === docFilter; });
    
    appointmentsUnsubscribe = query.onSnapshot(snapshot => {
        allAppointments = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Older records may refer to the email-keyed staff document; the
            // canonical UID doctor still needs to see these appointments.
            if (docFilter && data.doctorId !== docFilter && (!selectedDoctor || data.doctorName !== selectedDoctor.name)) return;
            // HARD SCOPING FOR DOCTORS: show ONLY records where assigned doctor == logged-in doctor
            if (currentUserRole === 'doctor' && data.doctorName !== currentDoctorName && data.doctorId !== currentDoctorId && data.doctorId !== docFilter) {
                return;
            }
            allAppointments.push({ id: doc.id, ...data });
        });
        
        // Sort ascending by token number
        allAppointments.sort((a, b) => (a.tokenNumber || 9999) - (b.tokenNumber || 9999));
        
        renderAppointmentsTable(allAppointments);
    }, err => {
        console.error('Error loading appointments:', err);
        setEmptyRow('appointmentsTableBody', 'Error loading appointments.', 10);
    });
}

// Listen to filter changes
document.getElementById('filterDate').addEventListener('change', loadAppointments);
document.getElementById('filterDoctor').addEventListener('change', loadAppointments);

function getApptStatusBadge(status) {
    return statusBadge(status, 'scheduled');
}

function renderAppointmentsTable(appointments) {
    const tbody = document.getElementById('appointmentsTableBody');
    if (!tbody) return;
    
    document.getElementById('apptCountBadge').textContent = `${appointments.length} appointments`;
    
    if (appointments.length === 0) {
        setEmptyRow('appointmentsTableBody', 'No appointments booked on this date.', 11);
        return;
    }
    
    tbody.innerHTML = '';
    appointments.forEach(appt => {
        const tr = document.createElement('tr');
        const status = (appt.status || 'scheduled').toLowerCase();
        
        let actionButtons = '';
        if (currentUserRole === 'owner') {
            actionButtons = '<span style="color:#94a3b8; font-size:12px;">—</span>';
        } else if (status === 'scheduled' || status === 'in_progress') {
            actionButtons = `
                ${['doctor', 'admin'].includes(currentUserRole) ? `<button class="btn-action-sm btn-consult" onclick="startConsultation('${appt.id}', '${appt.patientId}')"><i class="fa-solid fa-stethoscope"></i> Consult</button>` : ''}
                <button class="btn-action-sm btn-reschedule" onclick="openRescheduleModal('${appt.id}', '${appt.appointmentDate}', '${appt.timeSlot}')"><i class="fa-solid fa-clock"></i> Resched</button>
                <button class="btn-action-sm btn-secondary" onclick="notifyAppointment('${appt.id}','confirm')" title="Send confirm via SMS/WhatsApp when messaging is enabled"><i class="fa-solid fa-paper-plane"></i> Notify</button>
                <button class="btn-action-sm btn-cancel" onclick="cancelAppointment('${appt.id}')"><i class="fa-solid fa-circle-xmark"></i> Cancel</button>
            `;
        } else if (status === 'completed') {
            actionButtons = `
                <a href="consultations.html?patientId=${appt.patientId}" class="btn-action-sm btn-secondary" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#334155; font-size:11px; padding:4px 8px; text-decoration:none; display:inline-flex; align-items:center; gap:4px; height:28px;"><i class="fa-solid fa-file-medical"></i> History</a>
            `;
        } else {
            actionButtons = '<span style="color:#94a3b8; font-size:12px;">—</span>';
        }

        let feeBadge = '';
        if (appt.paymentStatus === 'free') {
            feeBadge = '<span style="background:#fef3c7; color:#92400e; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-gift"></i> Free OP</span>';
        } else if (appt.paymentStatus === 'due') {
            feeBadge = `<span style="background:#ffedd5; color:#c2410c; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-clock-rotate-left"></i> ₹${appt.opFee || 0} Due</span>`;
        } else {
            const mode = appt.paymentMethod || 'Cash';
            let modeIcon = 'fa-money-bill-wave';
            if (mode === 'UPI') modeIcon = 'fa-mobile-screen';
            else if (mode === 'Card') modeIcon = 'fa-credit-card';
            feeBadge = `<span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid ${modeIcon}"></i> ₹${appt.opFee || 0} (${escapeHtml(mode)})</span>`;
        }
        
        tr.innerHTML = `
            <td><strong style="color:var(--primary-teal); font-size:1.05rem;">#${appt.tokenNumber || '—'}</strong></td>
            <td><strong>${escapeHtml(appt.patientName || '—')}</strong></td>
            <td><span class="id-badge">${escapeHtml(appt.patientId || '—')}</span></td>
            <td>${escapeHtml(appt.doctorName || '—')}</td>
            <td><span style="font-weight:550; background:#f1f5f9; padding:2px 8px; border-radius:12px; font-size:11px;">${escapeHtml(appt.department || '—')}</span></td>
            <td><strong style="color:var(--primary-navy);">${escapeHtml(appt.timeSlot || '—')}</strong></td>
            <td><span style="font-size:12px; font-weight:500;">${escapeHtml(appt.visitType || '—')}</span></td>
            <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(appt.chiefComplaint || '')}">${escapeHtml(appt.chiefComplaint || '—')}</td>
            <td>${feeBadge}</td>
            <td>${getApptStatusBadge(appt.status)}</td>
            <td><div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                ${actionButtons}
                ${appt.status === 'cancelled' ? '' : addToCalendarLinkHtml({
                    date: appt.appointmentDate,
                    time: appt.timeSlot,
                    durationMinutes: 15,
                    title: 'OP: ' + (appt.patientName || 'Patient') + (appt.tokenNumber ? ' (Token ' + appt.tokenNumber + ')' : ''),
                    details: 'Patient ID: ' + (appt.patientId || '')
                        + '\nDoctor: ' + (appt.doctorName || '')
                        + '\nComplaint: ' + (appt.chiefComplaint || '-'),
                    location: appt.department || 'OPD'
                })}
            </div></td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 3. APPOINTMENT BOOKING TRIGGER
// ==========================================
const bookModal = document.getElementById('bookingModal');

document.getElementById('btnOpenBookModal').addEventListener('click', () => {
    selectedPatient = null;
    isQuickPatientMode = false;
    if (quickPatientSection) quickPatientSection.style.display = 'none';
    if (searchPatientContainer) searchPatientContainer.style.display = 'block';
    document.getElementById('bookingForm').reset();
    const bDate = document.getElementById('filterDate').value >= todayIso() ? document.getElementById('filterDate').value : todayIso();
    document.getElementById('bookingDate').value = bDate;
    updateBookingTimeSlots(bDate);
    document.getElementById('selectedPatientCard').style.display = 'none';
    document.getElementById('tokenPreview').textContent = '# Will generate on booking';
    updateBookingPaymentSummary();
    bookModal.classList.add('active');
});

document.getElementById('closeBookingModalBtn').addEventListener('click', () => bookModal.classList.remove('active'));
document.getElementById('cancelBookingBtn').addEventListener('click', () => bookModal.classList.remove('active'));

// Patient Autocomplete Search logic (Supports name prefix/suffix/substring, phone, patient ID prefix/suffix/number)
const searchInput = document.getElementById('apptPatientSearch');
const searchResults = document.getElementById('apptPatientSearchResults');

var debouncedSearch = debounce(async function(q) {
    if (!q || q.length < 1) {
        searchResults.style.display = 'none';
        return;
    }
    
    searchResults.innerHTML = '<div style="padding:10px;color:#666;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching patients...</div>';
    searchResults.style.display = 'block';

    try {
        const lower = q.toLowerCase();
        const cleanNum = q.replace(/\D/g, '');

        // Fetch up to 250 records for instant client-side multi-field matching
        const snap = await db.collection('patients').limit(250).get();
        let results = [];
        
        snap.forEach(doc => {
            const p = { docId: doc.id, ...doc.data() };
            const name = (p.name || '').toLowerCase();
            const pid = (p.patientId || '').toLowerCase();
            const phone = String(p.phone || '');
            const pidNum = pid.replace(/\D/g, '');

            let matched = false;
            // Name substring (prefix, suffix, or middle, e.g. "Lavanya" or "s.")
            if (name.includes(lower)) matched = true;
            // Patient ID (prefix "SA-", suffix "99", or full "SA-2026-00099")
            if (pid.includes(lower)) matched = true;
            if (cleanNum.length >= 1 && (pidNum.endsWith(cleanNum) || pidNum.includes(cleanNum))) matched = true;
            // Phone number substring or digits (e.g. "9848", "12345")
            if (phone.includes(q) || (cleanNum.length >= 2 && phone.includes(cleanNum))) matched = true;

            if (matched) results.push(p);
        });

        renderSearchResults(results.slice(0, 8));
    } catch (err) {
        searchResults.innerHTML = `<div style="padding:10px;color:red;font-size:12px;">Error: ${err.message}</div>`;
    }
}, 220);

searchInput.addEventListener('input', function(e) {
    debouncedSearch(e.target.value.trim().toLowerCase());
});

function renderSearchResults(patients) {
    if (!patients.length) {
        searchResults.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;"><i class="fa-solid fa-inbox"></i> No matching patients found</div>';
        return;
    }
    
    let html = '';
    patients.forEach(p => {
        html += `
            <div class="search-result-item" data-docid="${escapeHtml(p.docId)}" data-patientid="${escapeHtml(p.patientId)}" data-name="${escapeHtml(p.name || '')}" data-phone="${escapeHtml(p.phone || '')}" data-age="${escapeHtml(String(p.age || ''))}" data-gender="${escapeHtml(p.gender || '')}">
                <strong>${escapeHtml(p.name)}</strong> <span style="color:var(--primary-teal); font-size:11px; margin-left:4px;">${escapeHtml(p.patientId)}</span>
                <div style="font-size:11px; color:#888; margin-top:2px;">Phone: ${escapeHtml(p.phone || '—')} | Gender: ${escapeHtml(p.gender || '—')}</div>
            </div>
        `;
    });
    searchResults.innerHTML = html;

    document.querySelectorAll('.search-result-item').forEach(function(el) {
        el.addEventListener('click', function() {
            selectPatientForBooking(this.dataset.docid, this.dataset.patientid, this.dataset.name, this.dataset.phone, this.dataset.age, this.dataset.gender);
        });
    });
}

function selectPatientForBooking(docId, patientId, name, phone, age, gender) {
    selectedPatient = { docId, patientId, name, phone, age, gender };
    
    document.getElementById('cardPatientName').textContent = name;
    document.getElementById('cardPatientId').textContent = patientId;
    document.getElementById('cardAgeGender').textContent = `${age || '—'} / ${gender || '—'}`;
    document.getElementById('cardPhone').textContent = phone || '—';
    
    document.getElementById('selectedPatientCard').style.display = 'block';
    searchResults.style.display = 'none';
    // Keep search filled so HTML5 required/validation never blocks Book
    searchInput.value = name + ' — ' + patientId;
    searchInput.removeAttribute('required');
    refreshBookingPolicyFee();
}
window.selectPatientForBooking = selectPatientForBooking;

// Clear selected patient
document.getElementById('clearPatientBtn').addEventListener('click', () => {
    selectedPatient = null;
    document.getElementById('selectedPatientCard').style.display = 'none';
    searchInput.value = '';
    searchInput.focus();
});

// Click outside search suggestion list closes it
document.addEventListener('click', function(e) {
    if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
    }
});

// Booking Submission
document.getElementById('bookingForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('saveBookingBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Processing...';

    try {
        // Quick patient handling (Register later)
        if (isQuickPatientMode) {
            const qName = (document.getElementById('quickName') || {}).value?.trim();
            const qPhone = (document.getElementById('quickPhone') || {}).value?.trim();
            const qAge = (document.getElementById('quickAge') || {}).value?.trim();
            const qGender = (document.getElementById('quickGender') || {}).value || 'Female';
            
            if (!qName) {
                showToast('Please enter patient name.', 'warning');
                saveBtn.disabled = false; saveBtn.textContent = 'Book Appointment';
                return;
            }
            if (!qPhone || qPhone.length < 10) {
                showToast('Please enter a valid 10-digit mobile number.', 'warning');
                saveBtn.disabled = false; saveBtn.textContent = 'Book Appointment';
                return;
            }
            
            const newPid = await generateQuickPatientId();
            const patientRef = db.collection('patients').doc();
            const newPatientData = {
                patientId: newPid,
                name: qName,
                nameLower: qName.toLowerCase(),
                phone: qPhone,
                age: Number(qAge) || null,
                gender: qGender,
                registrationStatus: 'pending_completion',
                quickOp: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: currentUserEmail
            };
            await patientRef.set(newPatientData);
            selectedPatient = {
                docId: patientRef.id,
                patientId: newPid,
                name: qName,
                phone: qPhone,
                age: qAge,
                gender: qGender
            };
        }

        if (!selectedPatient) {
            showToast('Please select or quickly register a patient first.', 'warning');
            saveBtn.disabled = false; saveBtn.textContent = 'Book Appointment';
            return;
        }
        
        const docId = document.getElementById('bookingDoctor').value;
        const doc = allDoctors.find(d => d.id === docId);
        if (!doc) {
            showToast('Please select consulting doctor.', 'warning');
            saveBtn.disabled = false; saveBtn.textContent = 'Book Appointment';
            return;
        }
        
        const date = document.getElementById('bookingDate').value;
        const time = document.getElementById('bookingTime').value;
        const visitType = document.getElementById('bookingVisitType').value;
        const complaint = document.getElementById('bookingComplaint').value.trim();
        
        if (!date || date < todayIso() || !time) {
            showToast('Select a valid date and appointment time.', 'warning');
            saveBtn.disabled = false; saveBtn.textContent = 'Book Appointment';
            return;
        }

        // Extract Fee & Payment Mode
        const isFree = document.getElementById('bookingFreeOp').checked;
        const feePolicy = await getHospitalOPFee(selectedPatient, doc, date, { visitType: visitType === 'New Visit' ? 'New' : 'Review', phone: document.getElementById('bookingPhoneOP').checked });
        const opFee = isFree ? 0 : feePolicy.amount;
        document.getElementById('bookingOpFee').value = opFee;
        const payModeEl = document.querySelector('input[name="bookingPayMode"]:checked');
        const payMode = isFree ? 'Free' : currentUserRole === 'doctor' ? 'Due' : (payModeEl ? payModeEl.value : 'Cash');
        const payStatus = opFee === 0 ? 'free' : currentUserRole === 'doctor' ? 'unpaid' : (payMode === 'Due' ? 'due' : 'paid');
        const freeOpReason = isFree ? (document.getElementById('bookingFreeOpReason').value || '') : '';
        const freeOpApprover = isFree ? (document.getElementById('bookingFreeOpApprover').value.trim() || '') : '';

        if (isFree && !freeOpApprover) {
            showToast('Please enter who approved the Free OP.', 'warning');
            saveBtn.disabled = false; saveBtn.textContent = 'Book Appointment';
            return;
        }

        const patient = Object.assign({}, selectedPatient);
        const apptRef = db.collection('appointments').doc();
        const counterRef = db.collection('appointmentCounters').doc(docId + '_' + date);
        const opBillRef = opFee > 0 ? db.collection('bills').doc() : null;
        const opReceiptRef = opFee > 0 && payStatus === 'paid' ? db.collection('payments').doc() : null;
        const queueRef = date === todayIso() ? db.collection('opTokens').doc() : null;
        const tokenNumber = await db.runTransaction(async function(transaction) {
            const counter = await transaction.get(counterRef);
            const tokenNum = (counter.exists ? Number(counter.data().count) || 0 : 0) + 1;
            const appointmentData = {
                appointmentId: apptRef.id,
                patientId: patient.patientId,
                patientDocId: patient.docId,
                patientName: patient.name,
                patientPhone: patient.phone || '',
                doctorId: docId,
                doctorName: doc.name,
                department: doc.department || 'General',
                appointmentDate: date,
                timeSlot: time,
                visitType: visitType,
                chiefComplaint: complaint || '',
                tokenNumber: tokenNum,
                status: 'scheduled',
                bookedBy: currentUserEmail,
                opFeePolicy: feePolicy, phoneOP: document.getElementById('bookingPhoneOP').checked,
                opBillDocId: opBillRef ? opBillRef.id : '',
                opFeeWaived: isFree,
                opFee: opFee,
                paymentMethod: payMode,
                paymentStatus: payStatus,
                freeOpReason: freeOpReason,
                freeOpApprovedBy: freeOpApprover,
                vitalsRecorded: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            transaction.set(counterRef, { count: tokenNum, doctorId: docId, date: date });
            transaction.set(apptRef, appointmentData);
            transaction.update(db.collection('patients').doc(patient.docId), {
                lastAppointment: date,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            if (opBillRef) {
                const billNo = 'JYO-OP-' + apptRef.id;
                const paid = payStatus === 'paid' ? opFee : 0;
                const bill = { billId: billNo, billNumber: billNo, billNo: billNo, billType: 'OPD', type: 'OPD',
                    appointmentId: apptRef.id, patientId: patient.patientId, patientDocId: patient.docId, patientName: patient.name,
                    patientPhone: patient.phone || '', doctorId: docId, doctorName: doc.name, visitDoctor: doc.name,
                    visitDepartment: doc.department || 'Gynaecology', date: date, subtotal: opFee, discount: 0, tax: 0,
                    grandTotal: opFee, amountPaid: paid, paidAmount: paid, balanceDue: opFee - paid, dueAmount: opFee - paid,
                    paymentStatus: payStatus, paymentMethod: payMode, reportStatus: 'not_applicable', opFeePolicy: feePolicy,
                    payments: paid ? [{ amount: paid, method: payMode, date: new Date().toISOString(), recordedBy: currentUserEmail }] : [],
                    items: [{ category: 'Consultation', description: feePolicy.reason + ' - ' + doc.name, quantity: 1, unitPrice: opFee, amount: opFee }],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentUserEmail, billedBy: currentUserEmail };
                transaction.set(opBillRef, bill);
                transaction.set(db.collection('patients').doc(patient.docId).collection('bills').doc(opBillRef.id), bill);
                if (opReceiptRef) transaction.set(opReceiptRef, { billId: billNo, billDocId: opBillRef.id, patientId: patient.patientId,
                    patientName: patient.name, amount: paid, method: payMode, paymentMethod: payMode, date: todayIso(),
                    recordedBy: currentUserEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            }
            if (queueRef) transaction.set(queueRef, { date: date, tokenNo: tokenNum, appointmentId: apptRef.id,
                patientId: patient.patientId, patientDocId: patient.docId, patientName: patient.name, patientPhone: patient.phone || '',
                doctorId: docId, doctorName: doc.name, department: doc.department || 'Gynaecology', chiefComplaint: complaint || '',
                status: 'vitals_pending', vitalsRecorded: false, opFee: opFee, paymentStatus: payStatus, paymentMethod: payMode,
                issuedAt: firebase.firestore.FieldValue.serverTimestamp(), issuedAtText: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), createdBy: currentUserEmail });
            return tokenNum;
        });
        showToast(`Appointment booked! Token assigned: #${tokenNumber}`, 'success');
        bookModal.classList.remove('active');
        document.getElementById('filterDate').value = date;
        loadAppointments();
    } catch (err) {
        console.error('Save appointment error:', err);
        showToast('Failed to book appointment: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Book Appointment';
    }
});

// ==========================================
// 4. ACTION FUNCTIONS: CONSULT, CANCEL, RESCHEDULE
// ==========================================

// 4a. Start Consultation
function startConsultation(apptId, patientId) {
    if (!['doctor', 'admin'].includes(currentUserRole)) return;
    const apptRef = db.collection('appointments').doc(apptId);
    db.runTransaction(async function (transaction) {
        const appt = await transaction.get(apptRef);
        if (!appt.exists || !['scheduled', 'in_progress'].includes(appt.data().status)) throw new Error('Appointment is no longer available for consultation.');
        transaction.update(apptRef, { status: 'in_progress', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }).then(() => {
        window.location.href = `consultation.html?appointmentId=${encodeURIComponent(apptId)}&patientId=${encodeURIComponent(patientId)}`;
    }).catch(err => {
        console.error('Start consult error:', err);
        showToast('Error starting consultation.', 'error');
    });
}
window.startConsultation = startConsultation;

// 4b. Cancel Appointment
function cancelAppointment(apptId) {
    confirmAction(
        'Cancel Appointment',
        'Are you sure you want to cancel this appointment? This action is irreversible.',
        function() { proceedCancelAppointment(apptId); },
        'Cancel Appointment',
        '#DC2626'
    );
}
window.cancelAppointment = cancelAppointment;

function proceedCancelAppointment(apptId) {
    db.runTransaction(async function (batch) {
        const doc = await batch.get(db.collection('appointments').doc(apptId));
        if (!doc.exists) throw new Error('Appointment not found.');
        const appt = doc.data();
        if (!['scheduled', 'in_progress'].includes(appt.status)) throw new Error('Appointment is no longer active.');
        batch.update(db.collection('appointments').doc(apptId), {
            status: 'cancelled',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        batch.set(db.collection('auditLog').doc(), {
            action: 'appointment_cancelled',
            appointmentId: apptId,
            patientId: appt.patientId,
            staffEmail: currentUserEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        return appt;
    }).then(appt => {
        showToast('Appointment has been cancelled.', 'success');
        notifyAppointment(apptId, 'cancel', appt);
    }).catch(err => {
        console.error('Cancel appointment error:', err);
        showToast('Error cancelling appointment.', 'error');
    });
}
window.cancelAppointment = cancelAppointment;

// Notify patient about confirm/cancel. Uses MSG91/WhatsApp only when those
// integrations are already enabled — does not turn them on.
function notifyAppointment(apptId, kind, preloaded) {
    var run = function (appt) {
        if (!appt) { showToast('Appointment not found.', 'error'); return; }
        var patientId = appt.patientId;
        if (!patientId) { showToast('No patient on this appointment.', 'warning'); return; }
        db.collection('patients').where('patientId', '==', patientId).limit(1).get().then(function (snap) {
            if (snap.empty) { showToast('Patient record not found.', 'error'); return; }
            var patientDoc = snap.docs[0];
            var patient = patientDoc.data();
            var when = (appt.appointmentDate || appt.date || '') + ' ' + (appt.timeSlot || appt.time || '');
            var purpose = kind === 'cancel' ? 'appointment_cancel' : 'appointment_confirm';
            var vars = [patient.name || '', when, appt.doctorName || 'Doctor'];

            var tasks = [];
            if (typeof window.sendPatientSms === 'function' && patient.smsConsent) {
                tasks.push(window.sendPatientSms(patientDoc.id, null, vars, purpose).catch(function (e) { return { error: e.message }; }));
            }

            if (!tasks.length) {
                showToast('Messaging integrations are off or patient has no SMS consent. Enable MSG91/WhatsApp in Staff → Integrations when ready.', 'warning');
                if (kind === 'confirm') {
                    db.collection('appointments').doc(apptId).update({ notifyStatus: 'queued_local', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                }
                return;
            }
            Promise.all(tasks).then(function () {
                showToast('Notification attempted.', 'success');
                db.collection('appointments').doc(apptId).update({
                    notifyStatus: kind === 'cancel' ? 'cancel_sent' : 'confirm_sent',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
        });
    };
    if (preloaded) run(preloaded);
    else db.collection('appointments').doc(apptId).get().then(function (doc) { run(doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null); });
}
window.notifyAppointment = notifyAppointment;

// 4c. Reschedule Appointment Modal Toggle
const reschedModal = document.getElementById('rescheduleModal');
document.getElementById('closeRescheduleModalBtn').addEventListener('click', () => reschedModal.classList.remove('active'));
document.getElementById('cancelRescheduleBtn').addEventListener('click', () => reschedModal.classList.remove('active'));

function openRescheduleModal(apptId, date, time) {
    document.getElementById('rescheduleApptId').value = apptId;
    document.getElementById('rescheduleDate').value = date;
    document.getElementById('rescheduleTime').value = time;
    reschedModal.classList.add('active');
}
window.openRescheduleModal = openRescheduleModal;

// Reschedule submission
document.getElementById('rescheduleForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const apptId = document.getElementById('rescheduleApptId').value;
    const newDate = document.getElementById('rescheduleDate').value;
    const newTime = document.getElementById('rescheduleTime').value;
    
    if (!newDate || newDate < todayIso() || !newTime) { showToast('Select a valid future date and time.', 'warning'); return; }
    const saveBtn = e.target.querySelector('[type="submit"]');
    if (saveBtn) { if (saveBtn.disabled) return; saveBtn.disabled = true; }
    try {
        await rescheduleAppointment(apptId, newDate, newTime);
        showToast('Appointment rescheduled successfully.', 'success');
        reschedModal.classList.remove('active');
        document.getElementById('filterDate').value = newDate;
        loadAppointments();
    } catch (err) {
        console.error('Reschedule error:', err);
        showToast('Error rescheduling appointment: ' + err.message, 'error');
    } finally { if (saveBtn) saveBtn.disabled = false; }
});

function rescheduleAppointment(apptId, newDate, newTime) {
    return db.runTransaction(async function (transaction) {
        const apptRef = db.collection('appointments').doc(apptId);
        const doc = await transaction.get(apptRef);
        if (!doc.exists) throw new Error('Appointment not found.');
        const appt = doc.data();
        if (!['scheduled', 'in_progress'].includes(appt.status)) throw new Error('Only active appointments can be rescheduled.');
        const update = { appointmentDate: newDate, timeSlot: newTime, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        if (newDate !== appt.appointmentDate) {
            const counterRef = db.collection('appointmentCounters').doc(appt.doctorId + '_' + newDate);
            const counter = await transaction.get(counterRef);
            update.tokenNumber = (counter.exists ? Number(counter.data().count) || 0 : 0) + 1;
            transaction.set(counterRef, { count: update.tokenNumber, doctorId: appt.doctorId, date: newDate });
        }
        transaction.update(apptRef, update);
        transaction.set(db.collection('auditLog').doc(), {
            action: 'appointment_rescheduled', appointmentId: apptId, patientId: appt.patientId,
            staffEmail: currentUserEmail, oldDate: appt.appointmentDate, oldTime: appt.timeSlot,
            newDate: newDate, newTime: newTime, timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    });
}
