var dashboardRole = null;
var dashboardPaymentsUnsubscribe = null;
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    loadDashboardData(user);
    loadBedOccupancy();
    loadPatientStatusCounts();
    loadMaternityAlerts();
    
    // Auto calculate IPD bed charges
    if (typeof updateDailyBedCharges === 'function') {
        updateDailyBedCharges();
    }
    
    // Load financial overview for receptionist, billing_staff, admin, and owner roles
    const role = (user.role || '').toLowerCase();
    dashboardRole = role;
    if (['receptionist', 'billing_staff', 'admin', 'owner'].includes(role)) {
        loadFinancialOverview();
    } else {
        const container = document.getElementById('financialOverviewContainer');
        if (container) container.style.display = 'none';
        const revCard = document.getElementById('statTotalRevenue')?.closest('.stat-card');
        if (revCard) revCard.style.display = 'none';
    }
    
    // Load hospital name and update dashboard title
    firebase.firestore().collection('hospitalSettings').doc('main').get().then(function(doc) {
        if (doc.exists) {
            var name = doc.data().hospitalName || doc.data().name || 'Jyothsna Maternity Hospital';
            var titleEl = document.getElementById('dashboardNavTitle');
            if (titleEl) titleEl.textContent = name + ' Dashboard';
        }
    }).catch(function() {});
});

// FIX 12: Auto-refresh dashboard every 60 seconds when tab is visible
setInterval(function() {
    if (document.visibilityState === 'visible') {
        if (typeof loadFinancialOverview === 'function') loadFinancialOverview();
        if (typeof loadBedOccupancy === 'function') loadBedOccupancy();
        if (typeof loadMaternityAlerts === 'function') loadMaternityAlerts();
    }
}, 60000);

function loadMaternityAlerts() {
    var db = firebase.firestore(); var today = todayIso(); var month = today.slice(0, 7);
    db.collection('patients').where('isPregnant', '==', true).get().then(function(snap) {
        var due = [], edd = [];
        snap.forEach(function(doc) { var p = doc.data(); if (p.nextVisitDate && p.nextVisitDate <= today) due.push(p); if (p.edd && p.edd.slice(0, 7) === month) edd.push(p); });
        renderMaternityAlertList('ancDueList', 'ancDueCount', due, function(p) { return 'Next visit: ' + escapeHtml(p.nextVisitDate); });
        renderMaternityAlertList('eddMonthList', 'eddMonthCount', edd, function(p) { return 'EDD: ' + escapeHtml(p.edd); });
    }).catch(function(err) { console.error('Maternity alerts:', err); });
}
function renderMaternityAlertList(listId, countId, patients, detail) {
    var list = document.getElementById(listId), count = document.getElementById(countId); if (!list || !count) return;
    count.textContent = patients.length;
    list.innerHTML = patients.length ? patients.map(function(p) { return '<div style="padding:8px 0;border-bottom:1px solid var(--border-color)"><a href="patient-profile.html?id=' + encodeURIComponent(p.patientId || '') + '" style="color:var(--primary-teal);font-weight:600;text-decoration:none">' + escapeHtml(p.name || p.patientId || 'Patient') + '</a><br><small>' + detail(p) + '</small></div>'; }).join('') : '<span>No patients to show.</span>';
}


function loadBedOccupancy() {
    firebase.firestore().collection('beds').get()
    .then(function(snap) {
        var total = snap.size;
        var occupied = 0;
        var available = 0;
        snap.forEach(function(doc) {
            var b = doc.data();
            if (b.status === 'occupied') occupied++;
            if (b.status === 'available') available++;
        });
        var pct = total > 0 ? Math.round(occupied / total * 100) : 0;
        var occEl = document.getElementById('statBedOccupied');
        var avEl = document.getElementById('statBedAvailable');
        if (occEl) occEl.textContent = occupied + ' occupied';
        if (avEl) avEl.textContent = available + ' available | ' + pct + '% full';
    }).catch(function(err) { console.error('Bed occupancy error:', err); });
}
window.loadBedOccupancy = loadBedOccupancy;

// ── PATIENT STATUS COUNTS (Part 8) ───────────────────────────────────────────
function loadPatientStatusCounts() {
    var db = firebase.firestore();
    var statuses = ['admitted', 'emergency', 'icu'];
    var ids = { admitted: 'statAdmittedCount', emergency: 'statEmergencyCount', icu: 'statICUCount' };

    statuses.forEach(function(st) {
        db.collection('patients').where('status', '==', st).onSnapshot(function(snap) {
            var el = document.getElementById(ids[st]);
            if (el) el.textContent = snap.size;
        }, function(err) { console.error('Status count error (' + st + '):', err); });
    });

    // Load OT Bookings count for today (FIX 10)
    var todayStr = todayIso();
    db.collection('otBookings').where('scheduledDate', '==', todayStr).onSnapshot(function(snap) {
        var el = document.getElementById('statOTBookings');
        if (el) el.textContent = snap.size;
    }, function(err) { console.error('OT Bookings count error:', err); });

    // DATE FIX 14: Load Birthday Alerts
    loadBirthdayAlerts();
}
window.loadPatientStatusCounts = loadPatientStatusCounts;

function loadBirthdayAlerts() {
    var db = firebase.firestore();
    var today = new Date();
    var todayMonth = String(today.getMonth() + 1).padStart(2, '0');
    var todayDay = String(today.getDate()).padStart(2, '0');
    var targetMD = todayMonth + '-' + todayDay; // 'MM-DD'
    
    db.collection('patients').get().then(function(snap) {
        var birthdayPatients = [];
        snap.forEach(function(doc) {
            var data = doc.data();
            if (data.dob) {
                var dobPart = data.dob.substring(5); // MM-DD
                if (dobPart === targetMD) {
                    birthdayPatients.push(data.name || 'Unknown');
                }
            }
        });
        
        var banner = document.getElementById('birthdayAlertsBanner');
        var textEl = document.getElementById('birthdayAlertsText');
        var countEl = document.getElementById('birthdayAlertsCount');
        
        if (banner && textEl && countEl) {
            if (birthdayPatients.length > 0) {
                banner.style.display = 'flex';
                textEl.innerHTML = 'Wish a happy birthday to: <strong>' + birthdayPatients.map(escapeHtml).join(', ') + '</strong>!';
                countEl.textContent = birthdayPatients.length + ' Patient' + (birthdayPatients.length > 1 ? 's' : '');
            } else {
                banner.style.display = 'none';
            }
        }
    }).catch(function(err) {
        console.error("Birthday alerts error:", err);
    });
}
window.loadBirthdayAlerts = loadBirthdayAlerts;

function loadFinancialOverview() {
    if (!['receptionist', 'billing_staff', 'admin', 'owner'].includes(dashboardRole)) return;
    var _todayBounds = getDayBounds(new Date());
    var startOfToday = _todayBounds.start;
    var endOfToday   = _todayBounds.end;
    var db = firebase.firestore();

    var container = document.getElementById('financialOverviewContainer');
    if (container) container.style.display = 'block';

    // Collections are the actual dated ledger receipts, including refunds and
    // payments received today for invoices raised on an earlier day.
    if (dashboardPaymentsUnsubscribe) dashboardPaymentsUnsubscribe();
    dashboardPaymentsUnsubscribe = db.collection('payments')
        .where('createdAt', '>=', startOfToday).where('createdAt', '<=', endOfToday)
        .onSnapshot(function (snap) {
            var total = 0;
            var buckets = { Cash: 0, Card: 0, UPI: 0, Insurance: 0, Other: 0 };
            snap.forEach(function (doc) {
                var payment = doc.data(), amount = Number(payment.amount || 0);
                total += amount;
                var mode = String(payment.paymentMethod || payment.mode || '').toLowerCase();
                var bucket = mode === 'cash' ? 'Cash' : mode === 'card' ? 'Card' : /upi|phonepe|phone pe/.test(mode) ? 'UPI' : /insurance|aarogyasri|scheme/.test(mode) ? 'Insurance' : 'Other';
                buckets[bucket] += amount;
            });
            ['todayCollectionTotal', 'statTotalRevenue', 'statTodayRevenue'].forEach(function (id) {
                var el = document.getElementById(id); if (el) el.textContent = formatCurrency(total);
            });
            var breakdown = document.getElementById('todayCollectionBreakdown');
            if (breakdown) breakdown.textContent = Object.keys(buckets).map(function (key) {
                return key + ': ' + formatCurrency(buckets[key]);
            }).join(' | ');
        }, function (err) { console.error('Today collections error:', err); });

    // ── UNPAID BILLS ─────────────────────────────────────────────────────────
    // Unpaid Bills must query bills where paymentStatus in ['unpaid', 'partial']
    // Sum (grandTotal - amountPaid) for each bill as outstanding amount.
    db.collection('bills')
    .where('paymentStatus', 'in', ['unpaid', 'partial', 'due'])
    .get()
    .then(function(snap) {
        var total = 0;
        snap.forEach(function(doc) {
            var b = doc.data();
            var gt = b.grandTotal || 0;
            var ap = b.amountPaid || 0;
            total += (gt - ap);
        });
        const countEl = document.getElementById('unpaidBillsCount');
        if (countEl) countEl.textContent = snap.size + ' bills';
        const totalEl = document.getElementById('unpaidBillsTotal');
        if (totalEl) totalEl.textContent = formatCurrency(total);
    }).catch(function(err) { console.error('Unpaid bills error:', err); });

    // ── ADMITTED WITH DUES (IPD) ──────────────────────────────────────────────
    db.collection('bills')
    .where('type', '==', 'IPD')
    .where('paymentStatus', 'in', ['unpaid', 'partial', 'due'])
    .get()
    .then(function(snap) {
        var total = 0;
        snap.forEach(function(doc) {
            var b = doc.data();
            var gt = b.grandTotal || 0;
            var ap = b.amountPaid || 0;
            total += (gt - ap);
        });
        const countEl = document.getElementById('admittedDuesCount');
        if (countEl) countEl.textContent = snap.size + ' patients';
        const totalEl = document.getElementById('admittedDuesTotal');
        if (totalEl) totalEl.textContent = formatCurrency(total);
    }).catch(function(err) { console.error('Admitted dues error:', err); });

    // ── INSURANCE / CREDIT PENDING ────────────────────────────────────────────
    db.collection('bills').get()
    .then(function(snap) {
        var insuranceTotal = 0;
        var insuranceCount = 0;
        snap.forEach(function(doc) {
            var b = doc.data();
            var method = (b.paymentMethod || '').toLowerCase();
            var status = (b.paymentStatus || '').toLowerCase();
            if ((method.includes('insurance') || method.includes('aarogyasri') || method.includes('govt'))
                && status !== 'paid') {
                insuranceTotal += (b.grandTotal || 0) - (b.amountPaid || 0);
                insuranceCount++;
            }
        });
        const countEl = document.getElementById('insurancePendingCount');
        if (countEl) countEl.textContent = insuranceCount + ' claims';
        const totalEl = document.getElementById('insurancePendingTotal');
        if (totalEl) totalEl.textContent = formatCurrency(insuranceTotal);
    }).catch(function(err) { console.error('Insurance pending error:', err); });

    // ── ACTIVE IPD RUNNING BILLS (PART 7) ─────────────────────────────────────
    db.collection('bills')
    .where('isRunningBill', '==', true)
    .where('isFinalized', '==', false)
    .get()
    .then(function(snap) {
        var total = 0;
        snap.forEach(function(doc) { total += doc.data().grandTotal || 0; });
        var countEl = document.getElementById('runningBillsCount');
        if (countEl) countEl.textContent = snap.size + ' active';
        var totalEl = document.getElementById('runningBillsTotal');
        if (totalEl) totalEl.textContent = formatCurrency(total);
    }).catch(function(err) { console.error('Active running bills error:', err); });
}
window.loadFinancialOverview = loadFinancialOverview;

async function loadDashboardData(user) {
    const db = firebase.firestore();
    const role = (user.role || '').toLowerCase();
    const _todayBounds = getDayBounds(new Date());
    const startOfToday = _todayBounds.start;

    // Setup Quick Actions
    const quickActionsEl = document.getElementById('quickActionsContainer');
    const tablesEl = document.getElementById('dashboardTables');

        if (role === 'receptionist' || role === 'billing_staff') {
        // Receptionist / Billing dashboard setup
        quickActionsEl.style.display = 'block';
        quickActionsEl.innerHTML = `
            <div style="background:var(--white); padding:20px; border-radius:10px; box-shadow: 0 2px 10px rgba(0,0,0,0.03); display:flex; gap:15px; align-items:center; flex-wrap:wrap;">
                <strong style="color:var(--primary-navy); margin-right:10px;" data-i18n="Quick Actions">Quick Actions:</strong>
                <a href="patients.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-user-plus"></i> New Patient</a>
                <a href="appointments.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-calendar-check"></i> Appointments</a>
                <a href="op-queue.html" class="btn-primary" style="text-decoration:none; background:#7c3aed;"><i class="fa-solid fa-ticket"></i> OP Queue</a>
                <a href="billing.html" class="btn-primary" style="text-decoration:none; background:var(--primary-teal);"><i class="fa-solid fa-file-invoice-dollar"></i> New Bill</a>
                <a href="claims.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-shield-halved"></i> Claims</a>
            </div>
        `;

        if (tablesEl) tablesEl.style.display = 'none';

        renderStatsCards([
            { id: 'statTodayPatients', title: 'Patients Registered Today', icon: 'fa-bed-pulse', value: '...' },
            { id: 'statTodayBills', title: 'Bills Created Today', icon: 'fa-file-invoice', value: '...' },
            { id: 'statTodayRevenue', title: "Today's Revenue", icon: 'fa-indian-rupee-sign', value: '...' },
            { id: 'statPendingLab', title: 'Pending Lab Requests', icon: 'fa-flask', value: '...' }
        ]);

        // Today Registered Patients
        db.collection('patients').where('createdAt', '>=', startOfToday).onSnapshot(snap => {
            const el = document.getElementById('statTodayPatients');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Today Bills & Revenue
        db.collection('bills').where('createdAt', '>=', startOfToday).onSnapshot(snap => {
            const elBills = document.getElementById('statTodayBills');
            if (elBills) elBills.textContent = snap.size.toLocaleString();

        }, err => console.error(err));

        // Pending Lab report requests count
        db.collection('reports').where('type', '==', 'lab').where('status', '==', 'pending').onSnapshot(snap => {
            const el = document.getElementById('statPendingLab');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

    } else if (role === 'lab_technician') {
        // Lab Technician dashboard setup
        quickActionsEl.style.display = 'block';
        quickActionsEl.innerHTML = `
            <div style="background:var(--white); padding:20px; border-radius:10px; box-shadow: 0 2px 10px rgba(0,0,0,0.03); display:flex; gap:15px; align-items:center;">
                <strong style="color:var(--primary-navy); margin-right:10px;">Quick Actions:</strong>
                <a href="lab-reports.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-upload"></i> Upload Report</a>
            </div>
        `;

        if (tablesEl) tablesEl.style.display = 'none';

        renderStatsCards([
            { id: 'statPendingOrange', title: 'Pending Report Requests', icon: 'fa-flask', value: '...', borderColor: '#f59e0b', iconColor: '#f59e0b' },
            { id: 'statUploadedToday', title: 'Reports Uploaded Today', icon: 'fa-file-arrow-up', value: '...' },
            { id: 'statReadyReports', title: 'Ready Reports', icon: 'fa-circle-check', value: '...' }
        ]);

        // Pending Report requests (big orange)
        db.collection('reports').where('status', '==', 'pending').onSnapshot(snap => {
            const el = document.getElementById('statPendingOrange');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Reports uploaded today
        db.collection('reports').where('uploadedReport', '==', true).where('createdAt', '>=', startOfToday).onSnapshot(snap => {
            const el = document.getElementById('statUploadedToday');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Ready reports count
        db.collection('reports').where('status', '==', 'Ready').onSnapshot(snap => {
            const el = document.getElementById('statReadyReports');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

    } else if (role === 'doctor') {
        // Doctor dashboard setup
        quickActionsEl.style.display = 'block';
        quickActionsEl.innerHTML = `
            <div style="background:var(--white); padding:20px; border-radius:10px; box-shadow: 0 2px 10px rgba(0,0,0,0.03); display:flex; gap:15px; align-items:center; flex-wrap:wrap;">
                <strong style="color:var(--primary-navy); margin-right:10px;" data-i18n="Quick Actions">Quick Actions:</strong>
                <a href="doctor-dashboard.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-user-md"></i> Doctor Board</a>
                <a href="op-queue.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-ticket"></i> OP Queue</a>
                <a href="maternity-care.html" class="btn-primary" style="text-decoration:none; background:var(--primary-teal);"><i class="fa-solid fa-person-pregnant"></i> Maternity</a>
                <a href="teleconsult.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-video"></i> Tele-consult</a>
                <a href="partograph.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-chart-line"></i> Partograph</a>
            </div>
        `;

        if (tablesEl) tablesEl.style.display = 'none';

        // Toggle doctor completed reports table visible
        const docReportsContainer = document.getElementById('doctorReportsContainer');
        if (docReportsContainer) docReportsContainer.style.display = 'block';

        renderStatsCards([
            { id: 'statMyPatientsToday', title: 'My Patients Today', icon: 'fa-users', value: '...' },
            { id: 'statMyPendingReports', title: 'Pending Reports for My Patients', icon: 'fa-flask', value: '...' },
            { id: 'statNewReportsToday', title: 'New Reports Today', icon: 'fa-file-pdf', value: '...', borderColor: '#10b981', iconColor: '#10b981' }
        ]);

        // My patients today
        db.collection('patients').where('doctorName', '==', user.name).where('createdAt', '>=', startOfToday).onSnapshot(snap => {
            const el = document.getElementById('statMyPatientsToday');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Pending reports for my patients
        db.collection('reports').where('referredBy', '==', user.name).where('status', '==', 'pending').onSnapshot(snap => {
            const el = document.getElementById('statMyPendingReports');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Realtime completed reports for my patients (CHANGE 5)
        db.collection('bills')
            .where('visitDoctor', '==', user.name)
            .where('labCompleted', '==', true)
            .where('notifyDoctor', '==', true)
            .onSnapshot(snap => {
                const countEl = document.getElementById('doctorReportsCount');
                const statEl = document.getElementById('statNewReportsToday');
                
                if (countEl) countEl.textContent = snap.size + ' new reports';
                if (statEl) statEl.textContent = snap.size.toLocaleString();
                
                const tbody = document.getElementById('doctorReportsBody');
                if (!tbody) return;
                
                if (snap.empty) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">No new reports for your patients.</td></tr>';
                    return;
                }
                
                let html = '';
                snap.forEach(doc => {
                    const b = doc.data();
                    const tests = b.labTests || [];
                    const testNames = tests.map(t => t.testName).join(', ');
                    const dateVal = formatDate(b.labCompletedAt);
                    
                    html += `<tr style="border-bottom:1px solid #E2E8F0;">
                        <td style="padding:10px 14px; font-weight:500; color:#0F2B5B;">${b.billId || doc.id}</td>
                        <td style="padding:10px 14px;"><strong>${b.patientName || '—'}</strong><br><small style="color:#666;">${b.patientId || ''}</small></td>
                        <td style="padding:10px 14px; color:#0D7A70; font-weight:500;">${testNames}</td>
                        <td style="padding:10px 14px;">${dateVal}</td>
                        <td style="padding:10px 14px; font-size:12px; color:#666;">${b.labCompletedBy || '—'}</td>
                        <td style="padding:10px 14px;">
                            <button onclick="viewDoctorReport('${doc.id}', '${b.labReportUrl || ''}')" class="btn-primary" style="background:#0D7A70; color:white; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; font-size:12px; display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-file-pdf"></i> View PDF
                            </button>
                        </td>
                    </tr>`;
                });
                tbody.innerHTML = html;
            }, err => console.error(err));

    } else if (role === 'nurse') {
        quickActionsEl.style.display = 'block';
        quickActionsEl.innerHTML = `
            <div style="background:var(--white); padding:20px; border-radius:10px; box-shadow: 0 2px 10px rgba(0,0,0,0.03); display:flex; gap:15px; align-items:center; flex-wrap:wrap;">
                <strong style="color:var(--primary-navy); margin-right:10px;">Quick Actions:</strong>
                <a href="bed-management.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-bed"></i> Bed Board</a>
                <a href="maternity-care.html" class="btn-primary" style="text-decoration:none; background:var(--primary-teal);"><i class="fa-solid fa-person-pregnant"></i> Maternity</a>
                <a href="partograph.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-chart-line"></i> Partograph</a>
                <a href="discharge.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-file-medical"></i> Discharge</a>
                <a href="quality.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-clipboard-check"></i> Quality</a>
            </div>
        `;
        if (tablesEl) tablesEl.style.display = 'none';
        renderStatsCards([
            { id: 'statAdmittedCount', title: 'Admitted', icon: 'fa-bed-pulse', value: '...' },
            { id: 'statBedOccupied', title: 'Beds occupied', icon: 'fa-bed', value: '...' }
        ]);
        loadBedOccupancy();
        loadPatientStatusCounts();

    } else if (role === 'pharmacist') {
        quickActionsEl.style.display = 'block';
        quickActionsEl.innerHTML = `
            <div style="background:var(--white); padding:20px; border-radius:10px; box-shadow: 0 2px 10px rgba(0,0,0,0.03); display:flex; gap:15px; align-items:center; flex-wrap:wrap;">
                <strong style="color:var(--primary-navy); margin-right:10px;">Quick Actions:</strong>
                <a href="pharmacy.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-pills"></i> Pharmacy</a>
                <a href="inventory-alerts.html" class="btn-primary" style="text-decoration:none; background:#b45309;"><i class="fa-solid fa-bell"></i> Stock Alerts</a>
            </div>
        `;
        if (tablesEl) tablesEl.style.display = 'none';
        renderStatsCards([
            { id: 'statPharmaHint', title: 'Open Inventory Alerts for low stock & expiry', icon: 'fa-bell', value: '→' }
        ]);

    } else {
        // Admin (or everything else) dashboard setup
        quickActionsEl.style.display = 'block';
        quickActionsEl.innerHTML = `
            <div style="background:var(--white); padding:20px; border-radius:10px; box-shadow: 0 2px 10px rgba(0,0,0,0.03); display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                <strong style="color:var(--primary-navy); margin-right:6px;">Quick Actions:</strong>
                <a href="ot-schedule.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-calendar-plus"></i> Schedule OT</a>
                <a href="maternity-care.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-person-pregnant"></i> Maternity</a>
                <a href="op-queue.html" class="btn-primary" style="text-decoration:none;"><i class="fa-solid fa-ticket"></i> OP Queue</a>
                <a href="claims.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-shield-halved"></i> Claims</a>
                <a href="quality.html" class="btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-clipboard-check"></i> Quality</a>
                <a href="portal.html" class="btn-secondary" style="text-decoration:none;" target="_blank"><i class="fa-solid fa-mobile-screen"></i> Patient Portal</a>
            </div>
        `;
        if (tablesEl) tablesEl.style.display = 'grid';

        renderStatsCards([
            { id: 'statTotalPatients', title: "Today's Patients", icon: 'fa-bed-pulse', value: '...' },
            { id: 'statTodayOPD', title: "Today's Appointments", icon: 'fa-stethoscope', value: '...' },
            { id: 'statPendingReports', title: 'Pending Reports', icon: 'fa-file-waveform', value: '...' },
            { id: 'statTotalRevenue', title: "Today's Revenue", icon: 'fa-indian-rupee-sign', value: '...' },
            { id: 'statUnbilledReports', title: 'Unbilled Reports', icon: 'fa-circle-dollar-to-slot', value: '...', borderColor: '#ef4444', iconColor: '#ef4444' },
            { id: 'statAttendanceToday', title: 'Present Today / Total Staff', icon: 'fa-clock', value: '...', borderColor: '#0D7A70', iconColor: '#0D7A70' }
        ]);

        // Attendance count for today (admin/owner)
        (function() {
            var todayStr = todayIso();
            db.collection('attendance').where('date', '==', todayStr).where('status', 'in', ['present','half_day','late']).get().then(function(attSnap) {
                db.collection('staff').where('isActive', '==', true).get().then(function(staffSnap) {
                    var el = document.getElementById('statAttendanceToday');
                    if (el) el.textContent = attSnap.size + ' / ' + staffSnap.size;
                }).catch(function() {
                    var el = document.getElementById('statAttendanceToday');
                    if (el) el.textContent = attSnap.size + ' present';
                });
            }).catch(function(err) {
                console.warn('Attendance index building or error:', err.message);
                var el = document.getElementById('statAttendanceToday');
                if (el) el.textContent = '—';
            });
        })();

        // Today's patients (registered today)
        (function () {
            var startOfToday = getDayBounds(new Date()).start;
            db.collection('patients').where('createdAt', '>=', startOfToday).onSnapshot(function (snap) {
                var el = document.getElementById('statTotalPatients');
                if (el) el.textContent = snap.size.toLocaleString();
            }, function (err) {
                console.warn(err);
                // Fallback: count by local date on limited recent docs
                db.collection('patients').orderBy('createdAt', 'desc').limit(200).get().then(function (snap) {
                    var today = todayIso();
                    var n = 0;
                    snap.forEach(function (doc) {
                        var c = doc.data().createdAt;
                        var d = c && c.toDate ? c.toDate() : (c ? new Date(c) : null);
                        if (d && !isNaN(d) && d.toISOString().slice(0, 10) === today) n++;
                    });
                    var el = document.getElementById('statTotalPatients');
                    if (el) el.textContent = String(n);
                });
            });
        })();

        // Today's appointments
        (function () {
            var today = todayIso();
            db.collection('appointments').where('date', '==', today).onSnapshot(function (snap) {
                var el = document.getElementById('statTodayOPD');
                if (el) el.textContent = snap.size.toLocaleString();
            }, function (err) {
                console.warn(err);
                var el = document.getElementById('statTodayOPD');
                if (el) el.textContent = '—';
            });
        })();

        // Pending Reports
        db.collection('reports').where('status', '==', 'pending').onSnapshot(snap => {
            const el = document.getElementById('statPendingReports');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Unbilled Reports
        db.collection('reports').where('billingStatus', '==', 'unbilled').onSnapshot(snap => {
            const el = document.getElementById('statUnbilledReports');
            if (el) el.textContent = snap.size.toLocaleString();
        }, err => console.error(err));

        // Bills — today's revenue + recent table
        var _revDayStart = getDayBounds(new Date()).start;
        db.collection('bills').orderBy('createdAt', 'desc').limit(200).onSnapshot(snap => {
            let totalRevenue = 0;
            let doctorRevenue = {};
            let recentPatientsHtml = '';
            let count = 0;
            var todayStr = todayIso();

            snap.forEach(doc => {
                const bill = doc.data();
                const ps = (bill.paymentStatus || '').toLowerCase().trim();
                var created = bill.createdAt && bill.createdAt.toDate ? bill.createdAt.toDate() : null;
                var isToday = created && created >= _revDayStart;
                if (isToday && (ps === 'paid' || ps === 'partial')) {
                    let revenue = 0;
                    if (ps === 'paid') revenue = bill.grandTotal || 0;
                    else if (ps === 'partial') revenue = bill.amountPaid || 0;
                    totalRevenue += revenue;

                    const docName = bill.visitDoctor || bill.doctorName || 'Unassigned';
                    if (!doctorRevenue[docName]) doctorRevenue[docName] = { revenue: 0, bills: 0 };
                    doctorRevenue[docName].revenue += revenue;
                    doctorRevenue[docName].bills += 1;
                }

                if (count < 5) {
                    const bs = (bill.paymentStatus || bill.status || '').toLowerCase().trim();
                    const statusClass = bs === 'paid' ? 'status-active' : bs === 'draft' ? 'status-lowstock' : 'status-pending';
                    recentPatientsHtml += `
                        <tr>
                            <td>${bill.patientId || '-'}</td>
                            <td>${escapeHtml(bill.patientName || '-')} ${bill.activeBillLabel ? '<div class="cell-sub">' + escapeHtml(bill.activeBillLabel) + '</div>' : ''}</td>
                            <td>${bill.visitDoctor || bill.doctorName || '-'}</td>
                            <td>${bill.visitDepartment || bill.department || '-'}</td>
                            <td><span class="status-badge ${statusClass}">${bill.paymentStatus || bill.status || '-'}</span></td>
                        </tr>
                    `;
                    count++;
                }
            });

            const recentBody = document.getElementById('recentPatientsBody');
            if (recentBody) {
                recentBody.innerHTML = recentPatientsHtml || '<tr><td colspan="5" style="text-align:center; color:#888;">No bills found</td></tr>';
            }

            // Top 5 Doctors by Revenue
            const sortedDoctors = Object.keys(doctorRevenue)
                .map(name => ({ name, ...doctorRevenue[name] }))
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 5);

            let topDocHtml = '';
            sortedDoctors.forEach(d => {
                topDocHtml += `
                    <tr>
                        <td><strong>${d.name}</strong></td>
                        <td>${d.bills}</td>
                        <td style="color:var(--primary-teal); font-weight:bold;">₹${d.revenue.toLocaleString('en-IN')}</td>
                    </tr>
                `;
            });

            const docRevBody = document.getElementById('doctorRevenueBody');
            if (docRevBody) {
                docRevBody.innerHTML = topDocHtml || '<tr><td colspan="3" style="text-align:center; color:#888;">No data available</td></tr>';
            }

        }, err => console.error(err));
    }
}

function renderStatsCards(cards) {
    const container = document.querySelector('.stat-cards');
    if (!container) return;
    let html = '';
    cards.forEach(card => {
        const borderStyle = card.borderColor ? `border-bottom: 4px solid ${card.borderColor};` : '';
        const iconStyle = card.iconColor ? `background-color:${card.iconColor}20; color:${card.iconColor};` : '';
        html += `
            <div class="stat-card" style="${borderStyle}">
                <div class="stat-icon" style="${iconStyle}"><i class="fa-solid ${card.icon}"></i></div>
                <div class="stat-details">
                    <h3>${card.title}</h3>
                    <div class="value" id="${card.id}">${card.value || '...'}</div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// CHANGE 5 — Doctor report popup and notification clearing
function viewDoctorReport(billDocId, labReportUrl) {
    if (labReportUrl) {
        window.open(labReportUrl, '_blank');
    } else {
        showToast('No PDF uploaded for this report yet', 'warning');
    }
    
    // Clear notification in Firestore
    firebase.firestore().collection('bills').doc(billDocId).update({
        notifyDoctor: false
    }).then(() => {
        showToast('Notification cleared.', 'success');
    }).catch(err => {
        console.error('Error clearing doctor notification:', err);
    });
}
window.viewDoctorReport = viewDoctorReport;

window.addEventListener('beforeunload', function () { if (dashboardPaymentsUnsubscribe) dashboardPaymentsUnsubscribe(); });
