checkAccess(['owner', 'admin']);

let currentUserEmail = '';
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    
    // Load all owner dashboard sections
    loadOwnerDashboard();
    loadOwnerOpsStrip();

    // Default current month in monthly selector
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var monthInput = document.getElementById('reportMonth');
    if (monthInput) {
        monthInput.value = yyyy + '-' + mm;
    }
    
    // Wire up buttons
    var btnLoad = document.getElementById('btnGenerateMonthlyReport');
    if (btnLoad) {
        btnLoad.addEventListener('click', function() {
            var mVal = monthInput.value;
            if (mVal) loadMonthlyOwnerReport(mVal);
        });
    }
    var btnCancelledExport = document.getElementById('exportCancelledBtn');
    if (btnCancelledExport) {
        btnCancelledExport.addEventListener('click', function() {
            exportToCSV(window.cancelledBillsExport || [], 'cancelled-refunded-bills');
        });
    }

    var btnPdf = document.getElementById('btnDownloadMonthlyPDF');
    if (btnPdf) {
        btnPdf.addEventListener('click', function() {
            var mVal = monthInput.value;
            if (mVal) downloadMonthlyOwnerPDF(mVal);
        });
    }
});

// ==========================================================
// CANCELLED & REFUNDED BILLS — CURRENT MONTH
// Read from auditLog rather than from the bills themselves: the
// audit rows carry the reason, who acted and when, and a bill that
// was refunded twice produces two rows.
// ==========================================================
function loadCancelledBillsThisMonth() {
    var body = document.getElementById('cancelledBillsBody');
    if (!body) return;

    var bounds = getMonthBounds(new Date());
    var label = document.getElementById('cancelledMonthLabel');
    if (label) {
        label.textContent = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    }

    db.collection('auditLog')
        .where('timestamp', '>=', bounds.start)
        .where('timestamp', '<=', bounds.end)
        .orderBy('timestamp', 'desc')
        .get()
        .then(function(snap) {
            var rows = [];
            snap.forEach(function(doc) {
                var entry = doc.data();
                if (entry.action !== 'BILL_CANCELLED' && entry.action !== 'BILL_REFUNDED') return;
                rows.push(entry);
            });

            window.cancelledBillsExport = rows.map(function(r) {
                return {
                    Date: formatDate(r.timestamp),
                    BillNo: r.billId || '',
                    Patient: r.patientName || '',
                    PatientId: r.patientId || '',
                    Action: r.action === 'BILL_CANCELLED' ? 'Cancelled' : 'Refunded',
                    Amount: r.amount || 0,
                    Reason: r.reason || '',
                    By: r.performedBy || ''
                };
            });

            var cancelled = rows.filter(function(r) { return r.action === 'BILL_CANCELLED'; });
            var refunded = rows.filter(function(r) { return r.action === 'BILL_REFUNDED'; });
            var cancelledValue = cancelled.reduce(function(s, r) { return s + Number(r.amount || 0); }, 0);
            var refundedValue = refunded.reduce(function(s, r) { return s + Number(r.amount || 0); }, 0);

            var summary = document.getElementById('cancelledMonthSummary');
            if (summary) {
                summary.innerHTML = cancelled.length + ' cancelled (' + formatCurrency(cancelledValue) + ') · '
                    + refunded.length + ' refunded (' + formatCurrency(refundedValue) + ')';
            }

            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="7" class="table-empty">'
                    + '<i class="fa-solid fa-circle-check"></i>No bills cancelled or refunded this month.</td></tr>';
                return;
            }

            body.innerHTML = rows.map(function(r) {
                var isCancel = r.action === 'BILL_CANCELLED';
                return '<tr>'
                    + '<td class="nowrap">' + escapeHtml(formatDate(r.timestamp)) + '</td>'
                    + '<td><strong class="nowrap">' + escapeHtml(r.billId || '—') + '</strong></td>'
                    + '<td>' + escapeHtml(r.patientName || '—')
                    + '<span class="cell-sub">' + escapeHtml(r.patientId || '') + '</span></td>'
                    + '<td>' + statusBadge(isCancel ? 'cancelled' : 'refunded') + '</td>'
                    + '<td class="num"><span class="due-amount">' + formatCurrency(r.amount || 0) + '</span></td>'
                    + '<td style="max-width:280px;">' + escapeHtml(r.reason || '—') + '</td>'
                    + '<td class="nowrap">' + escapeHtml(r.performedBy || '—') + '</td>'
                    + '</tr>';
            }).join('');
        })
        .catch(function(err) {
            console.error('Cancelled bills load failed:', err);
            body.innerHTML = '<tr><td colspan="7" class="table-empty" style="color:#dc2626;">Could not load: '
                + escapeHtml(err.message) + '</td></tr>';
        });
}
window.loadCancelledBillsThisMonth = loadCancelledBillsThisMonth;

function loadOwnerPharmacyGrn() {
    var body = document.getElementById('ownerPharmacyGrnBody');
    if (!body) return;
    db.collection('stockReceipts').orderBy('addedAt', 'desc').limit(30).get()
        .then(function (snap) {
            if (snap.empty) {
                body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;">No pharmacy GRNs yet.</td></tr>';
                return;
            }
            var html = '';
            snap.forEach(function (doc) {
                var r = doc.data();
                html += '<tr>'
                    + '<td>' + (r.addedAt ? formatDate(r.addedAt) : '—') + '</td>'
                    + '<td>' + escapeHtml(r.medicineName || '') + '</td>'
                    + '<td>' + escapeHtml(r.supplierName || '—') + '</td>'
                    + '<td>' + (r.quantityAdded || 0) + '</td>'
                    + '<td>' + formatCurrency(r.amount || ((r.quantityAdded || 0) * (r.purchasePrice || 0))) + '</td>'
                    + '<td>' + (r.paymentDueDate || '—') + '</td>'
                    + '<td>' + escapeHtml(r.paymentStatus || 'unpaid') + '</td>'
                    + '<td style="max-width:180px;font-size:12px;color:#64748b;">' + escapeHtml(r.notes || '') + '</td>'
                    + '</tr>';
            });
            body.innerHTML = html;
        })
        .catch(function () {
            db.collection('auditLog').where('action', '==', 'pharmacy_grn').limit(30).get()
                .then(function (snap) {
                    if (snap.empty) {
                        body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;">No pharmacy GRNs yet.</td></tr>';
                        return;
                    }
                    var html = '';
                    snap.forEach(function (doc) {
                        var r = doc.data();
                        html += '<tr><td>' + (r.timestamp ? formatDate(r.timestamp) : '—') + '</td><td>'
                            + escapeHtml(r.medicineName || '') + '</td><td>' + escapeHtml(r.supplierName || '—')
                            + '</td><td>' + (r.quantityAdded || 0) + '</td><td>' + formatCurrency(r.amount || 0)
                            + '</td><td>' + (r.paymentDueDate || '—') + '</td><td>' + escapeHtml(r.paymentStatus || '')
                            + '</td><td>' + escapeHtml(r.reason || '') + '</td></tr>';
                    });
                    body.innerHTML = html;
                })
                .catch(function (err) {
                    body.innerHTML = '<tr><td colspan="8" style="color:red;">' + escapeHtml(err.message) + '</td></tr>';
                });
        });
}
window.loadOwnerPharmacyGrn = loadOwnerPharmacyGrn;

function loadOwnerDashboard() {
    loadCancelledBillsThisMonth();
    loadOwnerPharmacyGrn();
    var _todayBounds = getDayBounds(new Date());
    var startOfToday = _todayBounds.start;
    var endOfToday   = _todayBounds.end;
    
    var db = firebase.firestore();

    // ==========================================
    // SECTION 1 & 6: Today's Bills & Audits
    // ==========================================
    db.collection('bills')
        .where('createdAt', '>=', startOfToday)
        .where('createdAt', '<=', endOfToday)
        .get().then(function(snap) {
        var todayRev = 0;
        var discountCount = 0;
        var discountTotal = 0;
        var cancelCount = 0;
        var cancelTotal = 0;
        var todayBills = [];
        
        snap.forEach(function(doc) {
            var b = doc.data();
            var ps = (b.paymentStatus || '').toLowerCase().trim();
            if (ps === 'paid') todayRev += b.grandTotal || 0;
            else if (ps === 'partial') todayRev += b.amountPaid || 0;
            todayBills.push(b);
            
            if (b.discountAmount && b.discountAmount > 0) {
                discountCount++;
                discountTotal += b.discountAmount;
            }
            
            if (b.status === 'Cancelled' || b.status === 'cancelled') {
                cancelCount++;
                cancelTotal += b.grandTotal || 0;
            }
        });
        
        document.getElementById('todayRevenue').textContent = formatCurrency(todayRev);
        document.getElementById('auditDiscountsCount').textContent = discountCount + ' (₹' + discountTotal.toFixed(2) + ')';
        document.getElementById('auditCancelledCount').textContent = cancelCount + ' (₹' + cancelTotal.toFixed(2) + ')';
        
        window.todayBillsForExport = todayBills;
        
        // Export format for audit statistics
        window.auditStatsExport = [
            { 'Audit Metric': 'Discounts Given Today', 'Event Count': discountCount, 'Financial Amount': discountTotal },
            { 'Audit Metric': 'Bills Cancelled Today', 'Event Count': cancelCount, 'Financial Amount': cancelTotal }
        ];
    }).catch(function(err) {
        console.error("Error loading today's bills audit:", err);
    });

    // ==========================================
    // SECTION 1: Today's Patients Count
    // ==========================================
    db.collection('patients')
        .where('createdAt', '>=', startOfToday)
        .where('createdAt', '<=', endOfToday)
        .get().then(function(snap) {
        document.getElementById('todayPatients').textContent = snap.size;
    }).catch(function(err) {
        console.error("Error loading today's patient registrations:", err);
    });

    // ==========================================
    // SECTION 1: Pending Lab Reports Count
    // ==========================================
    db.collection('labQueue').where('reportStatus', '==', 'pending').get().then(function(snap) {
        document.getElementById('pendingLabReports').textContent = snap.size;
    }).catch(function(err) {
        console.error("Error loading pending lab reports count:", err);
    });

    // ==========================================
    // SECTION 1 & 5: Outstanding Dues & Breakdown
    // ==========================================
    window.unpaidBillsList = [];
    window.insuranceBillsList = [];
    window.unpaidTotalVal = 0;
    window.insTotalVal = 0;

    // Unpaid, Partial, & Insurance Bills in a single unified query
    db.collection('bills').where('paymentStatus', 'in', ['unpaid', 'partial']).get().then(function(snap) {
        var unpaidTotal = 0;
        var ipdDuesTotal = 0;
        var insTotal = 0;
        var oldestDate = null;
        
        snap.forEach(function(doc) {
            var b = doc.data();
            var method = (b.paymentMethod || '').toLowerCase();
            var isIns = method.includes('insurance') || method.includes('aarogyasri') || method.includes('govt');
            var balance = b.balanceDue || 0;
            
            if (isIns) {
                insTotal += balance;
                window.insuranceBillsList.push(b);
            } else {
                unpaidTotal += balance;
                window.unpaidBillsList.push(b);
                
                if (b.type === 'IPD') {
                    ipdDuesTotal += balance;
                }
                
                if (b.createdAt) {
                    var bDate = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                    if (!oldestDate || bDate < oldestDate) {
                        oldestDate = bDate;
                    }
                }
            }
        });
        
        document.getElementById('duesUnpaid').textContent = formatCurrency(unpaidTotal);
        document.getElementById('duesAdmitted').textContent = formatCurrency(ipdDuesTotal);
        document.getElementById('oldestUnpaidDate').textContent = oldestDate ? formatDate(oldestDate) : '—';
        document.getElementById('duesInsurance').textContent = formatCurrency(insTotal);
        
        window.unpaidTotalVal = unpaidTotal;
        window.insTotalVal = insTotal;
        
        var grandOutstanding = unpaidTotal + insTotal;
        document.getElementById('outstandingDues').textContent = formatCurrency(grandOutstanding);
    }).catch(function(err) {
        console.error("Error loading outstanding dues:", err);
    });

    // ==========================================
    // SECTION 2: Daily Collections (7 Days Chart)
    // ==========================================
    var sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0,0,0,0);

    db.collection('bills').where('createdAt', '>=', sevenDaysAgo).get().then(function(snap) {
        var dailyTotals = {};
        var daysArray = [];
        
        for (var i = 6; i >= 0; i--) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            var dateStr = formatDate(d).substring(0, 6);
            dailyTotals[dateStr] = { total: 0, count: 0, bills: [] };
            daysArray.push(dateStr);
        }
        
        snap.forEach(function(doc) {
            var b = doc.data();
            if (b.createdAt) {
                var bDate = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                var dateStr = formatDate(bDate).substring(0, 6);
                if (dailyTotals[dateStr] !== undefined) {
                    var ps = (b.paymentStatus || '').toLowerCase().trim();
                    var rev = 0;
                    if (ps === 'paid') rev = b.grandTotal || 0;
                    dailyTotals[dateStr].total += rev;
                    dailyTotals[dateStr].count += 1;
                    dailyTotals[dateStr].bills.push(b);
                }
            }
        });
        
        var maxAmt = 1000; // safety ceiling
        daysArray.forEach(function(d) {
            if (dailyTotals[d].total > maxAmt) {
                maxAmt = dailyTotals[d].total;
            }
        });
        
        var chartContainer = document.getElementById('revenueBarChart');
        if (chartContainer) {
            if (window.Chart) {
                chartContainer.innerHTML = '<canvas id="dailyCollectionsChart" aria-label="Daily collections for the last 7 days"></canvas>';
                // The canvas id makes the browser publish a global
                // window.dailyCollectionsChart pointing at the *element*.
                // That shadowed the Chart instance, so .destroy() threw and
                // the chart was never drawn. Keep the instance under a name
                // that cannot collide with an element id.
                if (window._dailyCollectionsChart && typeof window._dailyCollectionsChart.destroy === 'function') {
                    window._dailyCollectionsChart.destroy();
                }
                window._dailyCollectionsChart = new Chart(document.getElementById('dailyCollectionsChart'), {
                    type: 'bar',
                    data: { labels: daysArray, datasets: [{ label: 'Collections (INR)', data: daysArray.map(function(d) { return dailyTotals[d].total; }), backgroundColor: '#D6336C', borderRadius: 6 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { afterLabel: function(context) { return dailyTotals[daysArray[context.dataIndex]].count + ' bills'; } } } }, scales: { y: { beginAtZero: true, ticks: { callback: function(value) { return '₹' + value; } } } }, onClick: function(event, elements) { if (elements.length) { var d = daysArray[elements[0].index]; showDayBillsModal(d, dailyTotals[d].bills); } } }
                });
            } else {
                chartContainer.innerHTML = '';
                daysArray.forEach(function(d) {
                    var item = dailyTotals[d];
                    var pct = (item.total / maxAmt) * 100;
                    var barWrapper = document.createElement('div');
                    barWrapper.className = 'chart-bar-wrapper';
                    barWrapper.onclick = function() { showDayBillsModal(d, item.bills); };
                    barWrapper.innerHTML = '<div class="chart-bar" style="height:' + Math.max(pct, 5) + '%;"><span class="tooltip">' + d + ': ' + formatCurrency(item.total) + ' (' + item.count + ' bills)</span></div><div class="chart-label">' + d + '</div>';
                    chartContainer.appendChild(barWrapper);
                });
            }
        }
        
        window.chartDailyTotals = dailyTotals;
    }).catch(function(err) {
        console.error("Error generating daily revenue chart:", err);
    });

    // ==========================================
    // SECTION 3 & 4: Monthly Department & Doctor performance
    // ==========================================
    var firstOfMonth = getMonthBounds(new Date()).start;

    db.collection('bills').where('createdAt', '>=', firstOfMonth).get().then(function(snap) {
        var deptStats = {};
        var docStats = {};
        var totalMonthlyRev = 0;
        
        snap.forEach(function(doc) {
            var b = doc.data();
            var ps = (b.paymentStatus || '').toLowerCase().trim();
            var rev = 0;
            if (ps === 'paid') rev = b.grandTotal || 0;
            else if (ps === 'partial') rev = b.amountPaid || 0;
            totalMonthlyRev += rev;
            
            // Department distribution
            var dept = b.visitDepartment || 'General';
            if (!deptStats[dept]) {
                deptStats[dept] = { name: dept, patients: new Set(), revenue: 0 };
            }
            deptStats[dept].revenue += rev;
            if (b.patientId) deptStats[dept].patients.add(b.patientId);
            
            // Doctor performance
            var doctor = b.visitDoctor || 'Unassigned';
            if (!docStats[doctor]) {
                docStats[doctor] = { name: doctor, patients: new Set(), consultations: 0, revenue: 0 };
            }
            docStats[doctor].revenue += rev;
            if (b.patientId) docStats[doctor].patients.add(b.patientId);
            
            // Tally consultation charges
            var hasConsult = b.items && b.items.some(function(item) {
                return (item.category || '').toLowerCase().includes('consult');
            });
            if (hasConsult) {
                docStats[doctor].consultations += 1;
            }
        });
        
        var deptList = Object.values(deptStats);
        var docList = Object.values(docStats);

        // Render Department table
        var deptTbody = document.getElementById('deptRevenueTableBody');
        if (deptTbody) {
            deptTbody.innerHTML = '';
            if (deptList.length === 0) {
                deptTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">No department revenue this month.</td></tr>';
            } else {
                deptList.sort(function(a, b) { return b.revenue - a.revenue; });
                deptList.forEach(function(d) {
                    var pct = totalMonthlyRev > 0 ? ((d.revenue / totalMonthlyRev) * 100).toFixed(1) : '0.0';
                    var tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${d.name}</strong></td>
                        <td>${d.patients.size}</td>
                        <td>${formatCurrency(d.revenue)}</td>
                        <td><span class="status-badge status-instock" style="background:rgba(16,185,129,0.1); color:#10b981;">${pct}%</span></td>
                    `;
                    deptTbody.appendChild(tr);
                });
            }
        }
        
        // Render Doctor performance
        var docTbody = document.getElementById('doctorPerformanceTableBody');
        if (docTbody) {
            docTbody.innerHTML = '';
            if (docList.length === 0) {
                docTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">No doctor performance logged.</td></tr>';
            } else {
                docList.sort(function(a, b) { return b.revenue - a.revenue; });
                docList.forEach(function(d) {
                    var tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${d.name}</strong></td>
                        <td>${d.patients.size}</td>
                        <td>${d.consultations}</td>
                        <td>${formatCurrency(d.revenue)}</td>
                    `;
                    docTbody.appendChild(tr);
                });
            }
        }
        
        // Save for exports
        window.monthlyDeptStats = deptList.map(function(d) {
            return {
                'Department': d.name,
                'Unique Patients': d.patients.size,
                'Collected Revenue (INR)': d.revenue,
                'Contribution Ratio': totalMonthlyRev > 0 ? ((d.revenue / totalMonthlyRev) * 100).toFixed(1) + '%' : '0.0%'
            };
        });
        
        window.monthlyDocStats = docList.map(function(d) {
            return {
                'Doctor Name': d.name,
                'Patients Consulted': d.patients.size,
                'Consultation Invoices': d.consultations,
                'Total Revenue Secured (INR)': d.revenue
            };
        });
    }).catch(function(err) {
        console.error("Error gathering monthly statistics:", err);
    });

    // ==========================================
    // SECTION 6: Staff Logins List
    // ==========================================
    db.collection('logins')
        .where('timestamp', '>=', startOfToday)
        .where('timestamp', '<=', endOfToday)
        .get().then(function(snap) {
        var listContainer = document.getElementById('auditLoginsList');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        var loginsData = [];
        
        snap.forEach(function(doc) {
            loginsData.push(doc.data());
        });
        
        loginsData.sort(function(a, b) {
            var tA = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp)) : new Date(0);
            var tB = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp)) : new Date(0);
            return tB - tA;
        });
        if (loginsData.length === 0) {
            listContainer.innerHTML = '<span style="color:#888;">No staff logins recorded today.</span>';
        } else {
            loginsData.forEach(function(l) {
                var div = document.createElement('div');
                div.style.marginBottom = '4px';
                div.innerHTML = `<i class="fa-solid fa-key" style="color:#0d7a70; margin-right:6px;"></i><strong>${l.email}</strong> logged in ${timeAgo(l.timestamp)}`;
                listContainer.appendChild(div);
            });
        }
        
        window.todayLoginsForExport = loginsData.map(function(l) {
            return {
                'Staff Account': l.email,
                'Authentication Timestamp': formatDateTime(l.timestamp)
            };
        });
    }).catch(function(err) {
        console.error("Error loading logins audit logs:", err);
    });
}

// ==========================================
// IMPROVEMENT 5 — DISCOUNT & CANCELLATION AUDIT MODALS
// ==========================================
function openDiscountsModal() {
    document.getElementById('discountsModal').style.display = 'flex';
    loadDiscountAudit();
}
window.openDiscountsModal = openDiscountsModal;

function openCancellationsModal() {
    document.getElementById('cancellationsModal').style.display = 'flex';
    loadCancellationAudit();
}
window.openCancellationsModal = openCancellationsModal;

function loadDiscountAudit() {
    var tbody = document.getElementById('discountsTableBody');
    var totalEl = document.getElementById('discountsModalTotal');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>';

    var startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    var endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    firebase.firestore().collection('auditLog')
        .where('action', '==', 'discount_applied')
        .where('timestamp', '>=', startOfToday)
        .where('timestamp', '<=', endOfToday)
        .get()
        .then(function(snap) {
            tbody.innerHTML = '';
            var grandTotal = 0;

            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#888; padding:20px;">No discounts given today.</td></tr>';
                if (totalEl) totalEl.textContent = '₹0.00';
                return;
            }

            snap.forEach(function(doc) {
                var d = doc.data();
                var t = d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate() : new Date(d.timestamp)) : new Date();
                var timeStr = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                grandTotal += d.discountAmount || 0;

                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + timeStr + '</td>' +
                    '<td><strong>' + (d.billId || '—') + '</strong></td>' +
                    '<td>' + (d.patientName || '—') + '</td>' +
                    '<td>' + formatCurrency(d.originalAmount || 0) + '</td>' +
                    '<td><span style="background:rgba(245,158,11,0.1);color:#b45309;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">' + (d.discountPercent || 0) + '%</span></td>' +
                    '<td><strong style="color:#dc2626;">' + formatCurrency(d.discountAmount || 0) + '</strong></td>' +
                    '<td>' + (d.approverName || '—') + '</td>' +
                    '<td style="font-size:12px; color:#64748b;">' + (d.staffEmail || '—') + '</td>';
                tbody.appendChild(tr);
            });

            if (totalEl) totalEl.textContent = formatCurrency(grandTotal);
        })
        .catch(function(err) {
            console.error('Error loading discount audit:', err);
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red; padding:20px;">Error: ' + err.message + '</td></tr>';
        });
}

function loadCancellationAudit() {
    var tbody = document.getElementById('cancellationsTableBody');
    var totalEl = document.getElementById('cancellationsModalTotal');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>';

    var startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    var endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Query bills cancelled today directly
    firebase.firestore().collection('bills')
        .where('createdAt', '>=', startOfToday)
        .where('createdAt', '<=', endOfToday)
        .get()
        .then(function(snap) {
            tbody.innerHTML = '';
            var grandTotal = 0;
            var cancelledBills = [];

            snap.forEach(function(doc) {
                var b = doc.data();
                if (b.status === 'Cancelled' || b.status === 'cancelled') {
                    cancelledBills.push(b);
                }
            });

            if (cancelledBills.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888; padding:20px;">No cancellations today.</td></tr>';
                if (totalEl) totalEl.textContent = '₹0.00';
                return;
            }

            cancelledBills.forEach(function(b) {
                var t = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date();
                var timeStr = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                grandTotal += b.grandTotal || 0;

                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + timeStr + '</td>' +
                    '<td><strong>' + (b.billId || '—') + '</strong></td>' +
                    '<td>' + (b.patientName || '—') + '</td>' +
                    '<td><strong style="color:#dc2626;">' + formatCurrency(b.grandTotal || 0) + '</strong></td>' +
                    '<td style="color:#64748b; font-size:12px;">' + (b.cancellationReason || b.notes || '—') + '</td>' +
                    '<td style="font-size:12px; color:#64748b;">' + (b.createdBy || '—') + '</td>';
                tbody.appendChild(tr);
            });

            if (totalEl) totalEl.textContent = formatCurrency(grandTotal);
        })
        .catch(function(err) {
            console.error('Error loading cancellation audit:', err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red; padding:20px;">Error: ' + err.message + '</td></tr>';
        });
}

// Day Bills modal popup

function showDayBillsModal(dateStr, bills) {
    var existing = document.getElementById('dayBillsModal');
    if (existing) existing.remove();
    
    var modal = document.createElement('div');
    modal.id = 'dayBillsModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:999999; display:flex; align-items:center; justify-content:center;';
    
    var rowsHtml = '';
    if (bills.length === 0) {
        rowsHtml = '<tr><td colspan="5" style="text-align:center; padding:15px; color:#888;">No transactions for this day.</td></tr>';
    } else {
        bills.forEach(function(b) {
            rowsHtml += `
                <tr>
                    <td><strong>${b.billId || '—'}</strong></td>
                    <td>${b.patientName || '—'}</td>
                    <td>${formatCurrency(b.grandTotal)}</td>
                    <td><span class="status-badge status-instock" style="background:rgba(16, 185, 129, 0.1); color:#10b981;">${formatCurrency(b.amountPaid)}</span></td>
                    <td>${b.createdBy || '—'}</td>
                </tr>
            `;
        });
    }
    
    modal.innerHTML = `
        <div class="card" style="width:90%; max-width:650px; background:white; border-radius:12px; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.2); max-height:80%; overflow-y:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:12px; margin-bottom:15px;">
                <h3 style="margin:0; font-size:1.1rem; color:var(--primary-navy);"><i class="fa-solid fa-receipt"></i> Collections for ${dateStr}</h3>
                <button onclick="document.getElementById('dayBillsModal').remove()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:#666;">✕</button>
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Bill No</th>
                            <th>Patient Name</th>
                            <th>Grand Total</th>
                            <th>Amount Paid</th>
                            <th>Created By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            <div style="text-align:right; margin-top:15px;">
                <button class="btn-secondary" onclick="document.getElementById('dayBillsModal').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ==========================================
// EXCEL CSV EXPORTER LISTENERS FOR ALL MODULES
// ==========================================
document.getElementById('exportChartBtn').addEventListener('click', function() {
    if (!window.chartDailyTotals) { showToast('No chart data to export', 'warning'); return; }
    var data = Object.keys(window.chartDailyTotals).map(function(dateStr) {
        return {
            'Collection Date': dateStr,
            'Total Cash Secured (INR)': window.chartDailyTotals[dateStr].total,
            'Transaction Count': window.chartDailyTotals[dateStr].count
        };
    });
    exportToCSV(data, 'owner_daily_collections_chart');
});

document.getElementById('exportDuesBtn').addEventListener('click', function() {
    var data = [];
    if (window.unpaidBillsList) {
        window.unpaidBillsList.forEach(function(b) {
            data.push({
                'Bill No': b.billId || '',
                'Patient Name': b.patientName || '',
                'Billing Category': b.type || '',
                'Invoice Gross (INR)': b.grandTotal || 0,
                'Outstanding Balance (INR)': b.balanceDue || 0,
                'Account Status': b.paymentStatus || '',
                'Asset Classification': b.type === 'IPD' ? 'Admitted Patient Debts' : 'Unpaid Accounts'
            });
        });
    }
    if (window.insuranceBillsList) {
        window.insuranceBillsList.forEach(function(b) {
            data.push({
                'Bill No': b.billId || '',
                'Patient Name': b.patientName || '',
                'Billing Category': b.type || '',
                'Invoice Gross (INR)': b.grandTotal || 0,
                'Outstanding Balance (INR)': b.balanceDue || 0,
                'Account Status': b.paymentStatus || '',
                'Asset Classification': 'Insurance Scheme Receivables'
            });
        });
    }
    exportToCSV(data, 'owner_outstanding_debts_breakdown');
});

document.getElementById('exportDeptBtn').addEventListener('click', function() {
    if (!window.monthlyDeptStats || !window.monthlyDeptStats.length) { showToast('No department metrics recorded', 'warning'); return; }
    exportToCSV(window.monthlyDeptStats, 'owner_department_performance_monthly');
});

document.getElementById('exportDocBtn').addEventListener('click', function() {
    if (!window.monthlyDocStats || !window.monthlyDocStats.length) { showToast('No doctor metrics compiled', 'warning'); return; }
    exportToCSV(window.monthlyDocStats, 'owner_doctor_performance_monthly');
});

document.getElementById('exportAuditBtn').addEventListener('click', function() {
    var data = [];
    if (window.auditStatsExport) data.push(...window.auditStatsExport);
    if (window.todayLoginsForExport) {
        window.todayLoginsForExport.forEach(function(l) {
            data.push({
                'Audit Metric': 'Staff Authenticated Login',
                'Event Count': 1,
                'Financial Amount': 0,
                'Contextual Details': 'User account: ' + l['Staff Account'] + ' signed in'
            });
        });
    }
    exportToCSV(data, 'owner_audit_access_logs');
});

// ==========================================
// PART 7 — MONTHLY PERFORMANCE & ANALYTICS
// ==========================================
let currentMonthlyReportData = null;

function loadMonthlyOwnerReport(monthStr) {
    var parts = monthStr.split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    var targetDate = new Date(year, month, 1);
    
    var currentBounds = getMonthBounds(targetDate);
    var prevDate = new Date(year, month - 1, 1);
    var prevBounds = getMonthBounds(prevDate);
    
    var db = firebase.firestore();
    showToast('Loading monthly metrics...', 'info');
    
    var contentDiv = document.getElementById('monthlyReportContent');
    if (contentDiv) contentDiv.style.display = 'block';
    
    document.getElementById('monthlyTotalRev').textContent = 'Loading...';
    document.getElementById('monthlyOutstanding').textContent = 'Loading...';
    document.getElementById('monthlyNewPatients').textContent = 'Loading...';
    document.getElementById('monthlyPharmacyRev').textContent = 'Loading...';
    document.getElementById('monthlyAttendancePct').textContent = 'Loading...';
    document.getElementById('monthlyTotalBillsCount').textContent = 'Loading...';
    document.getElementById('compRevenue').textContent = '—';
    document.getElementById('compBills').textContent = '—';
    document.getElementById('compPatients').textContent = '—';
    
    var pCurrentBills = db.collection('bills')
        .where('createdAt', '>=', currentBounds.start)
        .where('createdAt', '<=', currentBounds.end)
        .get();
        
    var pPrevBills = db.collection('bills')
        .where('createdAt', '>=', prevBounds.start)
        .where('createdAt', '<=', prevBounds.end)
        .get();
        
    var pCurrentPatients = db.collection('patients')
        .where('createdAt', '>=', currentBounds.start)
        .where('createdAt', '<=', currentBounds.end)
        .get();
        
    var pPrevPatients = db.collection('patients')
        .where('createdAt', '>=', prevBounds.start)
        .where('createdAt', '<=', prevBounds.end)
        .get();
        
    var pPharmacy = db.collection('dispensingHistory')
        .where('createdAt', '>=', currentBounds.start)
        .where('createdAt', '<=', currentBounds.end)
        .get();
        
    var pAttendance = db.collection('attendance').get();
        
    Promise.all([pCurrentBills, pPrevBills, pCurrentPatients, pPrevPatients, pPharmacy, pAttendance])
        .then(function(results) {
            var currentBillsSnap = results[0];
            var prevBillsSnap = results[1];
            var currentPatientsSnap = results[2];
            var prevPatientsSnap = results[3];
            var pharmacySnap = results[4];
            var attendanceSnap = results[5];
            
            var totalRev = 0;
            var unpaidTotal = 0;
            var billsByType = { OPD: 0, IPD: 0, ICU: 0, ER: 0, OT: 0 };
            var payMethods = { Cash: 0, Card: 0, UPI: 0, Insurance: 0, Credit: 0 };
            var deptRev = {};
            var docRev = {};
            var dailyRevenue = {};
            
            var numDays = new Date(year, month + 1, 0).getDate();
            for (var d = 1; d <= numDays; d++) {
                var dStr = String(d).padStart(2, '0');
                dailyRevenue[dStr] = 0;
            }
            
            currentBillsSnap.forEach(function(doc) {
                var b = doc.data();
                var ps = (b.paymentStatus || '').toLowerCase().trim();
                var status = (b.status || '').toLowerCase().trim();
                
                var rev = 0;
                if (ps === 'paid') rev = b.grandTotal || 0;
                else if (ps === 'partial') rev = b.amountPaid || 0;
                
                if (status !== 'cancelled') {
                    totalRev += rev;
                    unpaidTotal += (b.balanceDue || 0);
                }
                
                var type = (b.billType || b.type || 'OPD').toUpperCase();
                if (type.includes('OPD')) billsByType.OPD++;
                else if (type.includes('IPD')) billsByType.IPD++;
                else if (type.includes('ICU')) billsByType.ICU++;
                else if (type.includes('ER')) billsByType.ER++;
                else if (type.includes('OT')) billsByType.OT++;
                else billsByType.OPD++;
                
                var methods = [];
                if (Array.isArray(b.paymentMethods) && b.paymentMethods.length > 0) {
                    methods = b.paymentMethods;
                } else if (b.paymentMethod) {
                    methods = b.paymentMethod.split(',').map(s => s.trim()).filter(Boolean);
                }
                
                if (methods.length === 0) {
                    payMethods.Cash += rev;
                } else {
                    var share = rev / methods.length;
                    methods.forEach(function(m) {
                        var mk = m.toLowerCase();
                        if (mk === 'cash') payMethods.Cash += share;
                        else if (mk === 'card') payMethods.Card += share;
                        else if (mk === 'upi') payMethods.UPI += share;
                        else if (mk.includes('insurance') || mk.includes('aarogyasri') || mk.includes('scheme')) payMethods.Insurance += share;
                        else payMethods.Credit += share;
                    });
                }
                
                var dept = b.visitDepartment || 'General';
                if (!deptRev[dept]) deptRev[dept] = 0;
                deptRev[dept] += rev;
                
                var docName = b.visitDoctor || 'Unassigned';
                if (!docRev[docName]) docRev[docName] = { revenue: 0, patients: new Set() };
                docRev[docName].revenue += rev;
                if (b.patientId) docRev[docName].patients.add(b.patientId);
                
                if (b.createdAt) {
                    var bDate = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                    var dayStr = String(bDate.getDate()).padStart(2, '0');
                    if (dailyRevenue[dayStr] !== undefined) {
                        dailyRevenue[dayStr] += rev;
                    }
                }
            });
            
            var pharmacyRev = 0;
            pharmacySnap.forEach(function(doc) {
                var p = doc.data();
                pharmacyRev += (p.totalAmount || p.totalPrice || 0);
            });
            
            var presentCount = 0;
            var totalWorkingDays = 0;
            var attendanceMap = {};
            
            attendanceSnap.forEach(function(doc) {
                var a = doc.data();
                if (a.date && a.date.startsWith(monthStr)) {
                    var sid = a.staffId;
                    if (!attendanceMap[sid]) attendanceMap[sid] = { present: 0, total: 0 };
                    attendanceMap[sid].total++;
                    if (['present', 'half_day', 'late'].includes(a.status)) {
                        attendanceMap[sid].present++;
                        presentCount++;
                    }
                    totalWorkingDays++;
                }
            });
            
            var avgAttendancePctStr = '—';
            var totalStaffCount = Object.keys(attendanceMap).length;
            if (totalStaffCount > 0) {
                var sumPcts = 0;
                Object.keys(attendanceMap).forEach(function(sid) {
                    var sPct = (attendanceMap[sid].present / attendanceMap[sid].total) * 100;
                    sumPcts += sPct;
                });
                avgAttendancePctStr = (sumPcts / totalStaffCount).toFixed(1) + '%';
            }
            
            var prevTotalRev = 0;
            prevBillsSnap.forEach(function(doc) {
                var b = doc.data();
                var ps = (b.paymentStatus || '').toLowerCase().trim();
                var status = (b.status || '').toLowerCase().trim();
                var rev = 0;
                if (ps === 'paid') rev = b.grandTotal || 0;
                else if (ps === 'partial') rev = b.amountPaid || 0;
                if (status !== 'cancelled') {
                    prevTotalRev += rev;
                }
            });
            
            renderPercentChange('compRevenue', totalRev, prevTotalRev, true);
            renderPercentChange('compBills', currentBillsSnap.size, prevBillsSnap.size, false);
            renderPercentChange('compPatients', currentPatientsSnap.size, prevPatientsSnap.size, false);
            
            document.getElementById('monthlyTotalRev').textContent = formatCurrency(totalRev);
            document.getElementById('monthlyOutstanding').textContent = formatCurrency(unpaidTotal);
            document.getElementById('monthlyNewPatients').textContent = currentPatientsSnap.size;
            document.getElementById('monthlyPharmacyRev').textContent = formatCurrency(pharmacyRev);
            document.getElementById('monthlyAttendancePct').textContent = avgAttendancePctStr;
            document.getElementById('monthlyTotalBillsCount').textContent = currentBillsSnap.size;
            
            var breakdownTbody = document.getElementById('monthlyRevenueBreakdownBody');
            breakdownTbody.innerHTML = `
                <tr><td><strong>OPD Appointments Revenue</strong></td><td style="text-align:right;">${billsByType.OPD} bills</td></tr>
                <tr><td><strong>IPD Admissions Revenue</strong></td><td style="text-align:right;">${billsByType.IPD} bills</td></tr>
                <tr><td><strong>ICU Admissions Revenue</strong></td><td style="text-align:right;">${billsByType.ICU} bills</td></tr>
                <tr><td><strong>Emergency Room (ER) Bills</strong></td><td style="text-align:right;">${billsByType.ER} bills</td></tr>
                <tr><td><strong>Operation Theatre (OT) Bills</strong></td><td style="text-align:right;">${billsByType.OT} bills</td></tr>
                <tr style="border-top:2px solid #e2e8f0; font-weight:600;"><td colspan="2" style="padding-top:10px; color:var(--primary-navy);">Collections by Payment Method</td></tr>
                <tr><td>Cash</td><td style="text-align:right; color:#16a34a;">${formatCurrency(payMethods.Cash)}</td></tr>
                <tr><td>Card</td><td style="text-align:right; color:#16a34a;">${formatCurrency(payMethods.Card)}</td></tr>
                <tr><td>UPI</td><td style="text-align:right; color:#16a34a;">${formatCurrency(payMethods.UPI)}</td></tr>
                <tr><td>Insurance Pending Claim</td><td style="text-align:right; color:#2563eb;">${formatCurrency(payMethods.Insurance)}</td></tr>
                <tr><td>Credit / Partial Outstanding</td><td style="text-align:right; color:#d97706;">${formatCurrency(payMethods.Credit)}</td></tr>
            `;
            
            var chartContainer = document.getElementById('monthlyDailyRevenueChart');
            if (chartContainer) {
                chartContainer.innerHTML = '';
                var maxAmt = 1000;
                Object.keys(dailyRevenue).forEach(function(day) {
                    if (dailyRevenue[day] > maxAmt) maxAmt = dailyRevenue[day];
                });
                
                Object.keys(dailyRevenue).forEach(function(day) {
                    var dayAmt = dailyRevenue[day];
                    var pct = (dayAmt / maxAmt) * 100;
                    
                    var barWrapper = document.createElement('div');
                    barWrapper.className = 'chart-bar-wrapper';
                    barWrapper.innerHTML = `
                        <div class="chart-bar" style="height: ${Math.max(pct, 5)}%; max-width: 10px; background:linear-gradient(180deg, #3b82f6 0%, #1e3a8a 100%);">
                            <span class="tooltip">Day ${day}: ${formatCurrency(dayAmt)}</span>
                        </div>
                        <div class="chart-label" style="font-size: 8px;">${day}</div>
                    `;
                    chartContainer.appendChild(barWrapper);
                });
            }
            
            currentMonthlyReportData = {
                monthStr: monthStr,
                totalRev: totalRev,
                unpaidTotal: unpaidTotal,
                newPatients: currentPatientsSnap.size,
                pharmacyRev: pharmacyRev,
                billsByType: billsByType,
                payMethods: payMethods,
                deptRev: deptRev,
                docRev: docRev,
                attendancePct: avgAttendancePctStr,
                totalBills: currentBillsSnap.size,
                prevRev: prevTotalRev,
                prevBills: prevBillsSnap.size,
                prevPatients: prevPatientsSnap.size,
                dailyRevenue: dailyRevenue
            };
            
            showToast('Monthly metrics loaded successfully.', 'success');
        })
        .catch(function(err) {
            console.error('Error loading monthly owner analytics:', err);
            showToast('Index building or loading error. Try again.', 'error');
        });
}
window.loadMonthlyOwnerReport = loadMonthlyOwnerReport;

function renderPercentChange(elemId, currentVal, prevVal, isCurrency) {
    var el = document.getElementById(elemId);
    if (!el) return;
    
    var diff = currentVal - prevVal;
    var pct = 0;
    if (prevVal > 0) {
        pct = (diff / prevVal) * 100;
    } else if (currentVal > 0) {
        pct = 100;
    }
    
    var sign = diff >= 0 ? '+' : '';
    var pctStr = sign + pct.toFixed(1) + '%';
    var formattedVal = isCurrency ? formatCurrency(currentVal) : currentVal;
    
    var color = diff >= 0 ? '#166534' : '#991b1b';
    var icon = diff >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
    
    el.innerHTML = `${formattedVal} <span style="color:${color}; font-size:12px; font-weight:600;"><i class="fa-solid ${icon}"></i> ${pctStr}</span>`;
}

function downloadMonthlyOwnerPDF(monthStr) {
    if (!currentMonthlyReportData || currentMonthlyReportData.monthStr !== monthStr) {
        showToast('Please load the report for the month first.', 'warning');
        return;
    }
    
    var data = currentMonthlyReportData;
    var db = firebase.firestore();
    showToast('Generating monthly PDF report...', 'info');
    
    db.collection('hospitalSettings').doc('main').get().then(function(settingsDoc) {
        var settings = settingsDoc.exists ? settingsDoc.data() : {};
        
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var y = 0;
        
        doc.setFillColor(15, 43, 91);
        doc.rect(0, 0, pageWidth, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', pageWidth/2, 12, { align: 'center' });
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(settings.address || '', pageWidth/2, 18, { align: 'center' });
        doc.text('Phone: ' + (settings.phone || '') + '  |  Email: ' + (settings.email || ''), pageWidth/2, 23, { align: 'center' });
        if (settings.gstin) doc.text('GSTIN: ' + settings.gstin, pageWidth/2, 28, { align: 'center' });
        
        y = 40;
        
        doc.setTextColor(15, 43, 91);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('MONTHLY HOSPITAL PERFORMANCE & ANALYTICS', pageWidth/2, y, { align: 'center' });
        doc.setFontSize(11);
        doc.text('Reporting Month: ' + data.monthStr, pageWidth/2, y + 6, { align: 'center' });
        
        y += 15;
        
        doc.setFontSize(11);
        doc.setTextColor(15, 43, 91);
        doc.text('Key Performance Indicators (KPI)', 10, y);
        y += 4;
        
        var summaryRows = [
            ['Total Monthly Revenue', formatCurrency(data.totalRev), 'Staff Avg Attendance %', data.attendancePct],
            ['Month End Outstanding Dues', formatCurrency(data.unpaidTotal), 'New Patients Registered', data.newPatients.toString()],
            ['Pharmacy Gross Revenue', formatCurrency(data.pharmacyRev), 'Total Bills Issued', data.totalBills.toString()]
        ];
        
        doc.autoTable({
            startY: y,
            head: [['KPI Indicator', 'Value', 'KPI Indicator', 'Value']],
            body: summaryRows,
            theme: 'grid',
            headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: [60, 60, 60] },
            margin: { left: 10, right: 10 }
        });
        
        y = doc.lastAutoTable.finalY + 8;
        
        doc.setFontSize(11);
        doc.setTextColor(15, 43, 91);
        doc.text('Revenue Breakdown: Bill Category & Payments', 10, y);
        y += 4;
        
        var breakdownRows = [
            ['OPD Appointments', data.billsByType.OPD.toString() + ' bills', 'Cash Collections', formatCurrency(data.payMethods.Cash)],
            ['IPD Admissions', data.billsByType.IPD.toString() + ' bills', 'Card Collections', formatCurrency(data.payMethods.Card)],
            ['ICU Admissions', data.billsByType.ICU.toString() + ' bills', 'UPI Collections', formatCurrency(data.payMethods.UPI)],
            ['Emergency (ER) Bills', data.billsByType.ER.toString() + ' bills', 'Insurance Claims Pending', formatCurrency(data.payMethods.Insurance)],
            ['OT Booking Bills', data.billsByType.OT.toString() + ' bills', 'Credit / Partial Dues', formatCurrency(data.payMethods.Credit)]
        ];
        
        doc.autoTable({
            startY: y,
            head: [['Bill Category', 'Volume', 'Payment Method', 'Volume']],
            body: breakdownRows,
            theme: 'grid',
            headStyles: { fillColor: [13, 122, 112], textColor: 255, fontSize: 9.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: [60, 60, 60] },
            margin: { left: 10, right: 10 }
        });
        
        y = doc.lastAutoTable.finalY + 8;
        
        doc.setFontSize(11);
        doc.setTextColor(15, 43, 91);
        doc.text('Department Revenue Contribution', 10, y);
        y += 4;
        
        var deptRows = [];
        var totalDeptVal = 0;
        Object.keys(data.deptRev).forEach(function(k) {
            totalDeptVal += data.deptRev[k];
        });
        
        Object.keys(data.deptRev).sort((a,b) => data.deptRev[b] - data.deptRev[a]).forEach(function(k) {
            var val = data.deptRev[k];
            var pct = totalDeptVal > 0 ? ((val / totalDeptVal) * 100).toFixed(1) + '%' : '0.0%';
            deptRows.push([k, formatCurrency(val), pct]);
        });
        
        if (deptRows.length === 0) {
            deptRows.push(['No active department metrics logged', '₹0.00', '0.0%']);
        }
        
        doc.autoTable({
            startY: y,
            head: [['Department', 'Revenue Generated', 'Contribution Ratio']],
            body: deptRows,
            theme: 'grid',
            headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: [60, 60, 60] },
            margin: { left: 10, right: 10 }
        });
        
        y = doc.lastAutoTable.finalY + 8;
        
        if (y > pageHeight - 60) {
            doc.addPage();
            y = 20;
        }
        
        doc.setFontSize(11);
        doc.setTextColor(15, 43, 91);
        doc.text('Doctor Performance Summary', 10, y);
        y += 4;
        
        var docRows = [];
        Object.keys(data.docRev).sort((a,b) => data.docRev[b].revenue - data.docRev[a].revenue).forEach(function(k) {
            var val = data.docRev[k];
            docRows.push([k, val.patients.size.toString() + ' patients', formatCurrency(val.revenue)]);
        });
        
        if (docRows.length === 0) {
            docRows.push(['No doctor performance metrics logged', '0 patients', '₹0.00']);
        }
        
        doc.autoTable({
            startY: y,
            head: [['Consulting Doctor', 'Patients Seen', 'Revenue Generated']],
            body: docRows,
            theme: 'grid',
            headStyles: { fillColor: [13, 122, 112], textColor: 255, fontSize: 9.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: [60, 60, 60] },
            margin: { left: 10, right: 10 }
        });
        
        y = doc.lastAutoTable.finalY + 8;
        
        if (y > pageHeight - 60) {
            doc.addPage();
            y = 20;
        }
        
        doc.setFontSize(11);
        doc.setTextColor(15, 43, 91);
        doc.text('Daily Collections Summary', 10, y);
        y += 4;
        
        var dailyRows = [];
        var days = Object.keys(data.dailyRevenue).sort();
        for (var i = 0; i < days.length; i += 3) {
            var d1 = days[i];
            var d2 = days[i+1] || '';
            var d3 = days[i+2] || '';
            
            var r1 = d1 ? 'Day ' + d1 + ': ' + formatCurrency(data.dailyRevenue[d1]) : '';
            var r2 = d2 ? 'Day ' + d2 + ': ' + formatCurrency(data.dailyRevenue[d2]) : '';
            var r3 = d3 ? 'Day ' + d3 + ': ' + formatCurrency(data.dailyRevenue[d3]) : '';
            
            dailyRows.push([r1, r2, r3]);
        }
        
        doc.autoTable({
            startY: y,
            body: dailyRows,
            theme: 'plain',
            bodyStyles: { fontSize: 8, textColor: [100, 100, 100], padding: 2 },
            margin: { left: 10, right: 10 }
        });
        
        y = doc.lastAutoTable.finalY + 12;
        
        if (y > pageHeight - 35) {
            doc.addPage();
            y = 20;
        }
        
        var sigY = pageHeight - 30;
        doc.setDrawColor(200, 200, 200);
        doc.line(10, sigY, 70, sigY);
        doc.line(pageWidth - 70, sigY, pageWidth - 10, sigY);
        doc.setFontSize(8.5);
        doc.setTextColor(120, 120, 120);
        doc.text('Prepared By: Administrative Audit', 40, sigY + 4, { align: 'center' });
        doc.text('Authorized Signatory: Owner / Director', pageWidth - 40, sigY + 4, { align: 'center' });
        
        doc.text('*** End of Hospital Performance Monthly Report ***', pageWidth/2, pageHeight - 10, { align: 'center' });
        
        var filename = 'Hospital-Monthly-Report-' + data.monthStr + '.pdf';
        if (window.savePDFHelper) {
            window.savePDFHelper(doc, filename);
        } else {
            doc.save(filename);
            showToast('PDF downloaded successfully.', 'success');
        }
    }).catch(function(err) {
        console.error('Error generating PDF:', err);
        showToast('Could not generate PDF: ' + err.message, 'error');
    });
}
window.downloadMonthlyOwnerPDF = downloadMonthlyOwnerPDF;

function loadOwnerOpsStrip() {
    var today = todayIso();
    var month = today.slice(0, 7);
    db.collection("patients").where("status", "in", ["admitted", "icu", "emergency", "postnatal"]).get()
        .then(function (snap) {
            var el = document.getElementById("ownerCensus");
            if (el) el.textContent = snap.size;
        }).catch(function () {
            db.collection("patients").where("status", "==", "admitted").get().then(function (snap) {
                var el = document.getElementById("ownerCensus");
                if (el) el.textContent = snap.size;
            });
        });
    db.collection("otBookings").where("scheduledDate", "==", today).get().then(function (snap) {
        var el = document.getElementById("ownerOtToday");
        if (el) el.textContent = snap.size;
    }).catch(function () {
        var el = document.getElementById("ownerOtToday");
        if (el) el.textContent = "-";
    });
    db.collection("bills").get().then(function (snap) {
        var due = 0;
        var byDoc = {};
        snap.forEach(function (doc) {
            var b = doc.data();
            var bal = Number(b.balanceDue || 0);
            if (bal > 0) due += bal;
            var bd = b.billDate || "";
            if (bd && bd.indexOf(month) === 0) {
                var docName = b.visitDoctor || b.doctorName || "Unassigned";
                byDoc[docName] = (byDoc[docName] || 0) + Number(b.amountPaid || 0);
            }
        });
        var el = document.getElementById("ownerOutstanding");
        if (el) el.textContent = formatCurrency(due);
        var topName = "-", topAmt = 0;
        Object.keys(byDoc).forEach(function (k) {
            if (byDoc[k] > topAmt) { topAmt = byDoc[k]; topName = k; }
        });
        var c = document.getElementById("ownerDocRevCount");
        var h = document.getElementById("ownerDocRevHint");
        if (c) c.textContent = formatCurrency(topAmt);
        if (h) h.textContent = topName === "-" ? "No collections this month" : ("Top: " + topName);
    });
}
window.loadOwnerOpsStrip = loadOwnerOpsStrip;
