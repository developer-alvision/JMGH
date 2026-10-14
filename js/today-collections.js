checkAccess(['receptionist', 'billing_staff', 'admin', 'owner']);

let currentUserEmail = '';
let allTodayBills = [];

getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    
    // Set Page Title Date
    const dStr = formatDate(new Date());
    const titleEl = document.getElementById('pageDateTitle');
    if (titleEl) titleEl.textContent = "Today's Collections — " + dStr;
    
    loadTodayCollections();
});

var todayRaisedBills = [];
var todayPaymentBills = [];
var todayPayments = [];
var todayCollectionListeners = [];
var todayPaymentsRevision = 0;

function refreshTodayCollectionRows() {
    var bills = new Map();
    todayPaymentBills.concat(todayRaisedBills).forEach(function (bill) { bills.set(bill.id, bill); });
    allTodayBills = Array.from(bills.values()).map(function (bill) {
        // This report uses today's receipts, not lifetime collections on the bill.
        var details = {};
        todayPayments.filter(function (payment) { return payment.billDocId === bill.id || payment.billId === bill.billId; })
            .forEach(function (payment) {
                var method = payment.paymentMethod || payment.mode || 'Other';
                if (!details[method]) details[method] = { amount: 0 };
                details[method].amount += Number(payment.amount || 0);
            });
        return Object.assign({}, bill, { paymentDetails: details });
    }).sort(function (a, b) {
        var time = function (value) { return value ? (value.toDate ? value.toDate() : new Date(value)).getTime() : 0; };
        return time(b.createdAt) - time(a.createdAt);
    });
    calculateTotals(allTodayBills);
    applyFilterAndRender();
}

function loadTodayCollections() {
    todayCollectionListeners.forEach(function (unsubscribe) { unsubscribe(); });
    todayCollectionListeners = [];
    var bounds = getDayBounds(new Date());
    var onError = function (err) { console.error('Collections:', err); showToast('Unable to load collections: ' + err.message, 'error'); };
    todayCollectionListeners.push(db.collection('bills')
        .where('createdAt', '>=', bounds.start).where('createdAt', '<=', bounds.end)
        .onSnapshot(function (snap) {
            todayRaisedBills = snap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
            refreshTodayCollectionRows();
        }, onError));
    todayCollectionListeners.push(db.collection('payments')
        .where('createdAt', '>=', bounds.start).where('createdAt', '<=', bounds.end)
        .onSnapshot(async function (snap) {
            var revision = ++todayPaymentsRevision;
            todayPayments = snap.docs.map(function (doc) { return doc.data(); });
            refreshTodayCollectionRows();
            try {
                var keys = new Map();
                todayPayments.forEach(function (payment) {
                    var key = payment.billDocId || payment.billId;
                    if (key) keys.set(key, payment);
                });
                var bills = await Promise.all(Array.from(keys.values()).map(async function (payment) {
                    if (payment.billDocId) {
                        var doc = await db.collection('bills').doc(payment.billDocId).get();
                        return doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
                    }
                    var match = await db.collection('bills').where('billId', '==', payment.billId).limit(1).get();
                    return match.empty ? null : Object.assign({ id: match.docs[0].id }, match.docs[0].data());
                }));
                if (revision !== todayPaymentsRevision) return;
                todayPaymentBills = bills.filter(Boolean);
                refreshTodayCollectionRows();
            } catch (err) { onError(err); }
        }, onError));
}
window.addEventListener('beforeunload', function () { todayCollectionListeners.forEach(function (unsubscribe) { unsubscribe(); }); });

// ==========================================
// SERVICE LINE
// The desk cashes up three tills separately: hospital services, the
// diagnostic bench, and the pharmacy counter. A bill belongs to whichever
// produced it — a mixed OPD bill carrying one lab line is still a hospital
// bill, so only bills made up entirely of lab/imaging charges count as lab.
// ==========================================
var SERVICE_LABELS = {
    hospital: 'Hospitalisation',
    lab: 'Lab & Imaging',
    pharmacy: 'Pharmacy'
};

function billServiceLine(b) {
    var kind = String(b.billType || b.type || '').toUpperCase();
    var id = String(b.billId || '').toUpperCase();
    if (kind.indexOf('PHARM') === 0 || b.isCounterSale === true || id.indexOf('-PH-') !== -1) return 'pharmacy';

    var cats = (b.items || []).map(function (i) {
        return String((i && i.category) || '').toLowerCase();
    });
    var isLabCat = function (c) {
        return c.indexOf('lab') === 0 || c.indexOf('img') === 0 || c === 'imaging' || c === 'radiology';
    };
    var labCount = cats.filter(isLabCat).length;
    if (cats.length && labCount === cats.length) return 'lab';
    if (!cats.length && (id.indexOf('-LAB-') !== -1 || id.indexOf('-IMG-') !== -1)) return 'lab';
    return 'hospital';
}

function billCollected(b) {
    var collected = 0;
    if (b.paymentDetails) {
        Object.keys(b.paymentDetails).forEach(function (m) {
            collected += parseFloat(b.paymentDetails[m].amount) || 0;
        });
    } else {
        collected = Math.max(0, (b.grandTotal || 0) - (b.balanceDue || 0));
    }
    return collected;
}

function renderServiceTotals(bills) {
    var lines = { hospital: { amt: 0, n: 0 }, lab: { amt: 0, n: 0 }, pharmacy: { amt: 0, n: 0 } };
    bills.forEach(function (b) {
        var line = lines[billServiceLine(b)];
        line.amt += billCollected(b);
        line.n += 1;
    });
    var map = [
        ['hospital', 'lineHospitalTotal', 'lineHospitalCount'],
        ['lab', 'lineLabTotal', 'lineLabCount'],
        ['pharmacy', 'linePharmacyTotal', 'linePharmacyCount']
    ];
    map.forEach(function (row) {
        var amtEl = document.getElementById(row[1]);
        var cntEl = document.getElementById(row[2]);
        if (amtEl) amtEl.textContent = formatCurrency(lines[row[0]].amt);
        if (cntEl) cntEl.textContent = lines[row[0]].n + (lines[row[0]].n === 1 ? ' bill' : ' bills');
    });
}

function calculateTotals(bills) {
    renderServiceTotals(bills);
    let grandTotalCollected = 0;
    let cash = 0;
    let card = 0;
    let phonepe = 0;
    let upi = 0;
    let insurance = 0;
    let creditDue = 0;

    // One classifier for both the paymentDetails map and the legacy
    // single-method fallback, so a method can never be counted in the total
    // but missed by every bucket.
    function addToBucket(mKey, amt) {
        if (mKey === 'cash') cash += amt;
        else if (mKey === 'card') card += amt;
        else if (mKey === 'phonepe' || mKey === 'phone pe' || mKey === 'phonepay') phonepe += amt;
        else if (mKey === 'upi' || mKey.indexOf('upi') !== -1) upi += amt;
        else if (mKey.includes('insurance') || mKey.includes('aarogyasri') || mKey.includes('scheme')) insurance += amt;
        
    }

    bills.forEach(b => {
        if (!/cancelled|draft/i.test(b.status || '')) creditDue += Number(b.balanceDue || 0);
        // We sum up the actual collections recorded
        if (b.paymentDetails) {
            Object.keys(b.paymentDetails).forEach(method => {
                const amt = parseFloat(b.paymentDetails[method].amount) || 0;
                grandTotalCollected += amt;
                addToBucket(method.toLowerCase(), amt);
            });
        } else {
            // Fallback for bills without paymentDetails
            var amt = (b.grandTotal || 0) - (b.balanceDue || 0);
            if (amt > 0) grandTotalCollected += amt;
            addToBucket((b.paymentMethod || '').toLowerCase(), amt);

            // Only add balanceDue when using the fallback path (no paymentDetails)

        }
    });

    grandTotalCollected = todayPayments.reduce(function (sum, payment) { return sum + Number(payment.amount || 0); }, 0);
    document.getElementById('todayTotal').textContent = formatCurrency(grandTotalCollected);
    document.getElementById('todayCash').textContent = formatCurrency(cash);
    document.getElementById('todayCard').textContent = formatCurrency(card);
    document.getElementById('todayPhonePe').textContent = formatCurrency(phonepe);
    document.getElementById('todayUPI').textContent = formatCurrency(upi);
    document.getElementById('todayInsurance').textContent = formatCurrency(insurance);
    document.getElementById('todayDue').textContent = formatCurrency(creditDue);
}

function getPaymentStatusBadge(status) {
    var s = (status || 'unpaid').toLowerCase().trim();
    if (s === 'paid') return '<span style="background:#DCFCE7;color:#166534;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500;">Paid</span>';
    if (s === 'partial') return '<span style="background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500;">Partial</span>';
    if (s === 'due') return '<span style="background:#EFF6FF;color:#1E40AF;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500;">Due</span>';
    return '<span style="background:#FEE2E2;color:#991B1B;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500;">Unpaid</span>';
}

function renderTable(bills) {
    const tbody = document.getElementById('collectionsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (bills.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #888; padding: 20px;">No transactions found for this filter.</td></tr>';
        document.getElementById('tableTotalAmount').textContent = formatCurrency(0);
        return;
    }
    
    let sumAmount = 0;
    
    bills.forEach(b => {
        sumAmount += b.grandTotal || 0;
        
        const tr = document.createElement('tr');
        
        // Time formatting
        let timeStr = '—';
        if (b.createdAt) {
            const date = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
        
        const line = billServiceLine(b);
        const lineColour = { hospital: '#A61E4D', lab: '#0f766e', pharmacy: '#7c3aed' }[line];

        tr.innerHTML = `
            <td><strong>${b.billId}</strong></td>
            <td>${b.patientName || '—'}</td>
            <td>${b.patientId || '—'}</td>
            <td><span style="font-weight:600; color:${lineColour}; font-size:11px;">${SERVICE_LABELS[line]}</span></td>
            <td><span style="font-weight: 500; background:#f3f4f6; padding: 2px 8px; border-radius:12px; font-size:11px;">${b.type || '—'}</span></td>
            <td><strong>${formatCurrency(b.grandTotal)}</strong></td>
            <td>${b.paymentMethods ? b.paymentMethods.join(", ") : (b.paymentMethod || '—')}</td>
            <td>${getPaymentStatusBadge(b.paymentStatus || b.status)}</td>
            <td>${b.createdBy || '—'}</td>
            <td>${timeStr}</td>
        `;
        
        tbody.appendChild(tr);
    });
    
    document.getElementById('tableTotalAmount').textContent = formatCurrency(sumAmount);
}

function getCurrentFilter() {
    const active = document.querySelector('#paymentFilters .filter-btn.active');
    return active ? active.dataset.filter : 'all';
}

function getCurrentService() {
    const active = document.querySelector('#serviceFilters .filter-btn.active');
    return active ? active.dataset.service : 'all';
}

function applyFilterAndRender() {
    const filter = getCurrentFilter();
    const service = getCurrentService();
    let filtered = allTodayBills;

    if (service !== 'all') {
        filtered = filtered.filter(b => billServiceLine(b) === service);
    }
    if (filter !== 'all') {
        filtered = filtered.filter(b => (b.paymentStatus || b.status || '').toLowerCase() === filter);
    }

    renderTable(filtered);
}

document.querySelectorAll('#serviceFilters .filter-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
        document.querySelectorAll('#serviceFilters .filter-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        applyFilterAndRender();
    });
});

// Filter Action
document.querySelectorAll('#paymentFilters .filter-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        document.querySelectorAll('#paymentFilters .filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        applyFilterAndRender();
    });
});

// CSV Export Trigger
document.getElementById('exportCsvBtn') && document.getElementById('exportCsvBtn').addEventListener('click', function() {
    const filter = getCurrentFilter();
    const service = getCurrentService();
    let filtered = allTodayBills;
    if (service !== 'all') {
        filtered = filtered.filter(b => billServiceLine(b) === service);
    }
    if (filter !== 'all') {
        filtered = filtered.filter(b => (b.paymentStatus || b.status || '').toLowerCase() === filter);
    }

    const exportData = filtered.map(b => {
        let timeStr = '—';
        if (b.createdAt) {
            const date = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
        return {
            "Bill No": b.billId,
            "Patient Name": b.patientName || '',
            "Patient ID": b.patientId || '',
            "Service": SERVICE_LABELS[billServiceLine(b)],
            "Type": b.type || '',
            "Grand Total": b.grandTotal || 0,
            "Balance Due": b.balanceDue || 0,
            "Payment Method": b.paymentMethods ? b.paymentMethods.join("; ") : (b.paymentMethod || ''),
            "Payment Status": b.paymentStatus || b.status || '',
            "Staff": b.createdBy || '',
            "Time": timeStr
        };
    });
    
    exportToCSV(exportData, "Today_Collections_Export");
});

// ==========================================
// DAILY COLLECTIONS PDF REPORT (PART 5)
// ==========================================
function downloadDailyReportPDF() {
    db.collection('hospitalSettings').doc('main').get()
    .then(function(settingsDoc) {
        var settings = settingsDoc.exists ? settingsDoc.data() : {};
        generateDailyReport(settings);
    })
    .catch(function(err) {
        showToast('Error generating Daily Report PDF: ' + err.message, 'error');
    });
}
window.downloadDailyReportPDF = downloadDailyReportPDF;

function generateDailyReport(settings) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;

    // === HEADER ===
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

    // === REPORT TITLE ===
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    var dateStr = formatDate(new Date());
    doc.text("DAILY COLLECTIONS REPORT - " + dateStr, pageWidth/2, y, { align: 'center' });
    y += 8;

    // === METADATA LINE ===
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(10, y, pageWidth - 10, y);
    y += 5;

    // Calculate Summary Stats
    let grandTotalCollected = 0;
    let cash = 0;
    let card = 0;
    let phonepe = 0;
    let upi = 0;
    let insurance = 0;
    let creditDue = 0;

    function addToBucket(mKey, amt) {
        if (mKey === 'cash') cash += amt;
        else if (mKey === 'card') card += amt;
        else if (mKey === 'phonepe' || mKey === 'phone pe' || mKey === 'phonepay') phonepe += amt;
        else if (mKey === 'upi' || mKey.indexOf('upi') !== -1) upi += amt;
        else if (mKey.includes('insurance') || mKey.includes('aarogyasri') || mKey.includes('scheme')) insurance += amt;
        
    }

    var serviceTotals = { hospital: { amt: 0, n: 0 }, lab: { amt: 0, n: 0 }, pharmacy: { amt: 0, n: 0 } };

    allTodayBills.forEach(b => {
        if (!/cancelled|draft/i.test(b.status || '')) creditDue += Number(b.balanceDue || 0);
        var sl = serviceTotals[billServiceLine(b)];
        sl.amt += billCollected(b);
        sl.n += 1;

        if (b.paymentDetails) {
            Object.keys(b.paymentDetails).forEach(method => {
                const amt = parseFloat(b.paymentDetails[method].amount) || 0;
                grandTotalCollected += amt;
                addToBucket(method.toLowerCase(), amt);
            });
        } else {
            const amt = (b.grandTotal || 0) - (b.balanceDue || 0);
            if (amt > 0) grandTotalCollected += amt;
            addToBucket((b.paymentMethod || '').toLowerCase(), amt);

            // Only add balanceDue when using the fallback path
            if (b.balanceDue > 0) creditDue += b.balanceDue;
        }
    });

    grandTotalCollected = todayPayments.reduce(function (sum, payment) { return sum + Number(payment.amount || 0); }, 0);

    // === SUMMARY CARDS ===
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 26, 'F');
    
    doc.setFontSize(9);
    doc.setTextColor(15, 43, 91);
    doc.setFont(undefined, 'bold');
    doc.text('COLLECTIONS SUMMARY', 12, y + 5);
    
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text('Total Collected: Rs ' + grandTotalCollected.toFixed(2), 12, y + 12);
    doc.text('Cash: Rs ' + cash.toFixed(2), 12, y + 18);
    doc.text('Card: Rs ' + card.toFixed(2), 12, y + 24);

    doc.text('PhonePe: Rs ' + phonepe.toFixed(2), 75, y + 12);
    doc.text('Other UPI: Rs ' + upi.toFixed(2), 75, y + 18);
    doc.text('Insurance / Scheme: Rs ' + insurance.toFixed(2), 75, y + 24);

    doc.text('Outstanding Due: Rs ' + creditDue.toFixed(2), 145, y + 12);

    y += 32;

    // === COLLECTIONS BY SERVICE LINE ===
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 20, 'F');
    doc.setFontSize(9);
    doc.setTextColor(15, 43, 91);
    doc.setFont(undefined, 'bold');
    doc.text('COLLECTIONS BY SERVICE', 12, y + 5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text('Hospitalisation: Rs ' + serviceTotals.hospital.amt.toFixed(2)
        + '  (' + serviceTotals.hospital.n + ' bills)', 12, y + 12);
    doc.text('Lab & Imaging: Rs ' + serviceTotals.lab.amt.toFixed(2)
        + '  (' + serviceTotals.lab.n + ' bills)', 12, y + 17);
    doc.text('Pharmacy: Rs ' + serviceTotals.pharmacy.amt.toFixed(2)
        + '  (' + serviceTotals.pharmacy.n + ' bills)', 110, y + 12);

    y += 26;

    // === TRANSACTIONS TABLE ===
    var tableBody = [];
    allTodayBills.forEach(function(b, idx) {
        let timeStr = '—';
        if (b.createdAt) {
            const date = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
        tableBody.push([
            b.billId || '—',
            b.patientName || '—',
            SERVICE_LABELS[billServiceLine(b)],
            b.type || '—',
            'Rs ' + (b.grandTotal || 0).toFixed(2),
            b.paymentMethods ? b.paymentMethods.join(", ") : (b.paymentMethod || '—'),
            (b.paymentStatus || b.status || '—').toUpperCase(),
            timeStr
        ]);
    });

    doc.autoTable({
        startY: y,
        head: [['Bill No', 'Patient Name', 'Service', 'Type', 'Amount', 'Payment Method', 'Status', 'Time']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 28 },
            1: { cellWidth: 36 },
            2: { cellWidth: 26 },
            3: { cellWidth: 13, halign: 'center' },
            4: { cellWidth: 22, halign: 'right' },
            5: { cellWidth: 28 },
            6: { cellWidth: 18, halign: 'center' },
            7: { cellWidth: 17, halign: 'center' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 10;

    // === FOOTER ===
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    doc.text('This is a computer-generated collections report. No signature required.', pageWidth/2, pageHeight - 15, { align: 'center' });
    doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pageWidth/2, pageHeight - 10, { align: 'center' });

    // === SAVE ===
    var filename = 'Daily-Report-' + dateStr + '.pdf';
    if (window.savePDFHelper) {
        window.savePDFHelper(doc, filename);
    } else {
        doc.save(filename);
    }
}

