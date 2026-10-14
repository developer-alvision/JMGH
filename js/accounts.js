// ==========================================================
// ACCOUNTS — monthly financial summary
//
// Three sources, deliberately kept separate:
//   bills     what was charged, and what discount was allowed
//   payments  what actually moved, refunds included as negatives
//   auditLog  cancellations, with their reasons
//
// "Billed" and "collected" are not the same number and are never
// added together: a bill raised in March can be paid in April, so
// the collection figures come from the payment rows, not the bills.
// ==========================================================

var accountsData = null;

function monthBoundsFromInput(value) {
    var parts = String(value || '').split('-');
    if (parts.length !== 2) return getMonthBounds(new Date());
    var year = Number(parts[0]);
    var month = Number(parts[1]) - 1;
    return {
        start: new Date(year, month, 1, 0, 0, 0, 0),
        end: new Date(year, month + 1, 0, 23, 59, 59, 999)
    };
}

function dayKey(date) {
    var d = date && date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function loadAccounts() {
    var monthInput = document.getElementById('accountsMonth');
    var bounds = monthBoundsFromInput(monthInput.value);

    var dailyBody = document.getElementById('accDailyBody');
    dailyBody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading...</td></tr>';

    Promise.all([
        db.collection('bills').where('createdAt', '>=', bounds.start).where('createdAt', '<=', bounds.end).get(),
        db.collection('payments').where('createdAt', '>=', bounds.start).where('createdAt', '<=', bounds.end).get(),
        db.collection('auditLog').where('timestamp', '>=', bounds.start).where('timestamp', '<=', bounds.end).get()
    ]).then(function(results) {
        var bills = [];
        results[0].forEach(function(doc) { bills.push(Object.assign({ id: doc.id }, doc.data())); });

        var payments = [];
        results[1].forEach(function(doc) { payments.push(doc.data()); });

        var cancellations = [];
        results[2].forEach(function(doc) {
            var entry = doc.data();
            if (entry.action === 'BILL_CANCELLED') cancellations.push(entry);
        });

        accountsData = summariseAccounts(bills, payments, cancellations);
        renderAccounts(accountsData);
    }).catch(function(err) {
        console.error('Accounts load failed:', err);
        dailyBody.innerHTML = '<tr><td colspan="7" class="table-empty" style="color:#dc2626;">Could not load: '
            + escapeHtml(err.message) + '</td></tr>';
    });
}
window.loadAccounts = loadAccounts;

function summariseAccounts(bills, payments, cancellations) {
    var summary = {
        grossBilled: 0, discounts: 0, discountedBills: 0, billCount: 0,
        collected: 0, refunded: 0, cancelledValue: 0, cancelledCount: cancellations.length,
        outstanding: 0,
        byMode: {}, byType: {}, byDay: {}
    };

    function day(key) {
        if (!summary.byDay[key]) {
            summary.byDay[key] = { bills: 0, gross: 0, discount: 0, collected: 0, refunded: 0 };
        }
        return summary.byDay[key];
    }

    bills.forEach(function(bill) {
        var isCancelled = String(bill.status || '').toLowerCase() === 'cancelled';
        var key = dayKey(bill.createdAt);
        var total = Number(bill.grandTotal || 0);
        var discount = Number(bill.discountAmount || 0);

        // Cancelled bills are reported separately and excluded from the
        // billed total, otherwise the month looks bigger than it was.
        if (!isCancelled) {
            summary.grossBilled += total;
            summary.billCount++;
            summary.outstanding += Number(bill.balanceDue || 0);

            var type = (bill.type || bill.billType || 'OTHER').toUpperCase();
            if (!summary.byType[type]) summary.byType[type] = { count: 0, amount: 0 };
            summary.byType[type].count++;
            summary.byType[type].amount += total;

            if (discount > 0) { summary.discounts += discount; summary.discountedBills++; }

            if (key) {
                var d = day(key);
                d.bills++;
                d.gross += total;
                d.discount += discount;
            }
        } else {
            summary.cancelledValue += total;
        }
    });

    payments.forEach(function(payment) {
        var amount = Number(payment.amount || 0);
        var key = dayKey(payment.createdAt);
        var mode = payment.paymentMethod || payment.mode || 'Unspecified';

        if (amount >= 0) {
            summary.collected += amount;
            summary.byMode[mode] = (summary.byMode[mode] || 0) + amount;
            if (key) day(key).collected += amount;
        } else {
            var refund = Math.abs(amount);
            summary.refunded += refund;
            if (key) day(key).refunded += refund;
        }
    });

    summary.netCollected = Math.round((summary.collected - summary.refunded) * 100) / 100;
    return summary;
}

function renderAccounts(s) {
    document.getElementById('accGrossBilled').textContent = formatCurrency(s.grossBilled);
    document.getElementById('accBillCount').textContent = s.billCount + ' bills';
    document.getElementById('accDiscounts').textContent = formatCurrency(s.discounts);
    document.getElementById('accDiscountCount').textContent = s.discountedBills + ' bills discounted';
    document.getElementById('accNetCollected').textContent = formatCurrency(s.netCollected);
    document.getElementById('accCollectedSub').textContent =
        formatCurrency(s.collected) + ' received, ' + formatCurrency(s.refunded) + ' refunded';
    document.getElementById('accRefunds').textContent = formatCurrency(s.refunded + s.cancelledValue);
    document.getElementById('accCancelSub').textContent =
        s.cancelledCount + ' cancelled (' + formatCurrency(s.cancelledValue) + ')';

    // Reconciliation
    var rows = [
        ['Gross billed (excluding cancelled bills)', s.grossBilled, ''],
        ['Less discounts allowed', -s.discounts, 'warn'],
        ['Net receivable for the month', s.grossBilled - s.discounts, 'strong'],
        ['Cash received in the month (any bill date)', s.collected, ''],
        ['Less refunds paid out', -s.refunded, 'warn'],
        ['Net collected', s.netCollected, 'strong'],
        ['Outstanding on this month’s bills', s.outstanding, 'due'],
        ['Value of bills cancelled this month', s.cancelledValue, 'due']
    ];

    document.getElementById('accReconcileBody').innerHTML = rows.map(function(row) {
        var emphasis = row[2] === 'strong' ? 'font-weight:700;background:var(--surface-alt);' : '';
        var colour = row[2] === 'warn' ? 'color:#b45309;' : (row[2] === 'due' ? 'color:#b91c1c;' : '');
        return '<tr style="' + emphasis + '"><td>' + escapeHtml(row[0]) + '</td>'
            + '<td class="num" style="' + colour + emphasis + '">' + formatCurrency(row[1]) + '</td></tr>';
    }).join('');

    // Payment modes
    var modeKeys = Object.keys(s.byMode).sort(function(a, b) { return s.byMode[b] - s.byMode[a]; });
    document.getElementById('accModeBody').innerHTML = modeKeys.length
        ? modeKeys.map(function(mode) {
            var share = s.collected > 0 ? (s.byMode[mode] / s.collected * 100) : 0;
            return '<tr><td>' + escapeHtml(mode) + '</td>'
                + '<td class="num">' + formatCurrency(s.byMode[mode]) + '</td>'
                + '<td class="num">' + share.toFixed(1) + '%</td></tr>';
        }).join('')
        : '<tr><td colspan="3" class="table-empty">Nothing collected this month.</td></tr>';

    // Bill types
    var typeKeys = Object.keys(s.byType).sort(function(a, b) { return s.byType[b].amount - s.byType[a].amount; });
    document.getElementById('accTypeBody').innerHTML = typeKeys.length
        ? typeKeys.map(function(type) {
            return '<tr><td>' + statusBadge(type.toLowerCase()) + '</td>'
                + '<td class="num">' + s.byType[type].count + '</td>'
                + '<td class="num">' + formatCurrency(s.byType[type].amount) + '</td></tr>';
        }).join('')
        : '<tr><td colspan="3" class="table-empty">No bills this month.</td></tr>';

    // Day by day
    var dayKeys = Object.keys(s.byDay).sort();
    document.getElementById('accDailyBody').innerHTML = dayKeys.length
        ? dayKeys.map(function(key) {
            var d = s.byDay[key];
            var net = d.collected - d.refunded;
            return '<tr>'
                + '<td class="nowrap">' + escapeHtml(formatDate(key)) + '</td>'
                + '<td class="num">' + d.bills + '</td>'
                + '<td class="num">' + formatCurrency(d.gross) + '</td>'
                + '<td class="num" style="color:#b45309;">' + formatCurrency(d.discount) + '</td>'
                + '<td class="num">' + formatCurrency(d.collected) + '</td>'
                + '<td class="num" style="color:#b91c1c;">' + formatCurrency(d.refunded) + '</td>'
                + '<td class="num"><strong>' + formatCurrency(net) + '</strong></td>'
                + '</tr>';
        }).join('')
        : '<tr><td colspan="7" class="table-empty"><i class="fa-solid fa-inbox"></i>No activity in this month.</td></tr>';
}

function exportAccounts() {
    if (!accountsData) { showToast('Load a month first.', 'warning'); return; }
    var rows = Object.keys(accountsData.byDay).sort().map(function(key) {
        var d = accountsData.byDay[key];
        return {
            Date: key,
            Bills: d.bills,
            GrossBilled: d.gross.toFixed(2),
            Discount: d.discount.toFixed(2),
            Collected: d.collected.toFixed(2),
            Refunded: d.refunded.toFixed(2),
            Net: (d.collected - d.refunded).toFixed(2)
        };
    });
    exportToCSV(rows, 'accounts-' + document.getElementById('accountsMonth').value);
}

getCurrentUser(function(user) {
    if (!checkPageAccess(user)) return;

    var monthInput = document.getElementById('accountsMonth');
    var now = new Date();
    monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    document.getElementById('accountsRefresh').addEventListener('click', loadAccounts);
    document.getElementById('accountsMonth').addEventListener('change', loadAccounts);
    document.getElementById('accountsExport').addEventListener('click', exportAccounts);

    loadAccounts();
});
