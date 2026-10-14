// ==========================================================
// PHARMACY COUNTER SALE (over-the-counter)
//
// A walk-in buying medicines without being a registered patient.
// Produces a real bill in the `bills` collection so counter takings
// appear in collections, the accounts page and the owner analytics
// alongside everything else — and can be cancelled or refunded
// through the same workflow as any other bill.
// ==========================================================

var counterItems = [];
var counterStock = [];

function loadCounterStock() {
    return db.collection('pharmacy').get().then(function(snapshot) {
        counterStock = [];
        snapshot.forEach(function(doc) {
            var item = doc.data();
            if (!isSaleableMedicine(item)) return;
            counterStock.push({
                id: doc.id,
                name: item.medicineName || '',
                generic: item.genericName || '',
                price: Number(item.price || item.mrp || 0),
                stock: Number(item.stock || 0),
                unit: item.unit || '',
                batchNo: item.batchNo || '',
                expiryDate: item.expiryDate || ''
            });
        });
        return counterStock;
    });
}

// ----------------------------------------------------------
// ITEM ENTRY
// ----------------------------------------------------------
function renderCounterSuggestions(term) {
    var box = document.getElementById('counterSuggestions');
    if (!box) return;
    term = (term || '').trim().toLowerCase();
    if (term.length < 2) { box.style.display = 'none'; return; }

    var matches = counterStock.filter(function(m) {
        return m.name.toLowerCase().indexOf(term) !== -1
            || m.generic.toLowerCase().indexOf(term) !== -1;
    }).slice(0, 8);

    if (!matches.length) {
        box.innerHTML = '<div class="drug-suggestion-item" style="color:#94a3b8;">No medicine matches.</div>';
        box.style.display = 'block';
        return;
    }

    box.innerHTML = matches.map(function(m) {
        var outOfStock = m.stock <= 0;
        return '<div class="drug-suggestion-item' + (outOfStock ? '' : ' counter-pick') + '"'
            + (outOfStock ? ' style="opacity:0.5;cursor:not-allowed;"' : ' data-id="' + m.id + '"') + '>'
            + '<strong>' + escapeHtml(m.name) + '</strong>'
            + (m.generic ? ' <span style="color:#64748b;">· ' + escapeHtml(m.generic) + '</span>' : '')
            + '<br><small>' + formatCurrency(m.price) + ' · stock ' + m.stock
            + (outOfStock ? ' — out of stock' : '') + '</small></div>';
    }).join('');
    box.style.display = 'block';

    box.querySelectorAll('.counter-pick').forEach(function(el) {
        el.addEventListener('click', function() {
            addCounterItem(el.dataset.id);
            box.style.display = 'none';
            document.getElementById('counterSearch').value = '';
        });
    });
}

function addCounterItem(medicineId) {
    var medicine = counterStock.find(function(m) { return m.id === medicineId; });
    if (!medicine) return;

    var existing = counterItems.find(function(i) { return i.id === medicineId; });
    if (existing) {
        if (existing.quantity + 1 > medicine.stock) {
            showToast('Only ' + medicine.stock + ' in stock.', 'warning');
            return;
        }
        existing.quantity++;
    } else {
        counterItems.push({
            id: medicine.id,
            name: medicine.name,
            price: medicine.price,
            quantity: 1,
            available: medicine.stock,
            unit: medicine.unit,
            batchNo: medicine.batchNo
        });
    }
    renderCounterItems();
}

function updateCounterQuantity(index, quantity) {
    var item = counterItems[index];
    if (!item) return;
    quantity = Math.max(0, parseInt(quantity, 10) || 0);
    if (quantity > item.available) {
        showToast('Only ' + item.available + ' of ' + item.name + ' in stock.', 'warning');
        quantity = item.available;
    }
    if (quantity === 0) counterItems.splice(index, 1);
    else item.quantity = quantity;
    renderCounterItems();
}
window.updateCounterQuantity = updateCounterQuantity;

function removeCounterItem(index) {
    counterItems.splice(index, 1);
    renderCounterItems();
}
window.removeCounterItem = removeCounterItem;

function counterTotals() {
    var subtotal = counterItems.reduce(function(sum, i) { return sum + (i.price * i.quantity); }, 0);
    var discountPercent = Number((document.getElementById('counterDiscount') || {}).value || 0);
    if (discountPercent < 0) discountPercent = 0;
    if (discountPercent > 100) discountPercent = 100;
    var discountAmount = Math.round((subtotal * discountPercent / 100) * 100) / 100;
    var grandTotal = Math.round((subtotal - discountAmount) * 100) / 100;
    return { subtotal: subtotal, discountPercent: discountPercent, discountAmount: discountAmount, grandTotal: grandTotal };
}

function renderCounterItems() {
    var body = document.getElementById('counterItemsBody');
    if (!body) return;

    if (!counterItems.length) {
        body.innerHTML = '<tr><td colspan="5" class="table-empty" style="padding:24px;">'
            + '<i class="fa-solid fa-basket-shopping"></i>No medicines added yet.</td></tr>';
    } else {
        body.innerHTML = counterItems.map(function(item, index) {
            return '<tr>'
                + '<td><strong>' + escapeHtml(item.name) + '</strong>'
                + (item.batchNo ? '<span class="cell-sub">Batch ' + escapeHtml(item.batchNo) + '</span>' : '') + '</td>'
                + '<td class="num">' + formatCurrency(item.price) + '</td>'
                + '<td class="num"><input type="number" min="0" max="' + item.available + '" value="' + item.quantity
                + '" onchange="updateCounterQuantity(' + index + ', this.value)" style="width:70px;text-align:right;padding:4px 6px;"></td>'
                + '<td class="num"><strong>' + formatCurrency(item.price * item.quantity) + '</strong></td>'
                + '<td class="actions"><div><button type="button" class="btn-secondary btn-xs" onclick="removeCounterItem(' + index + ')">'
                + '<i class="fa-solid fa-trash"></i></button></div></td>'
                + '</tr>';
        }).join('');
    }

    var totals = counterTotals();
    document.getElementById('counterSubtotal').textContent = formatCurrency(totals.subtotal);
    document.getElementById('counterDiscountAmount').textContent = '- ' + formatCurrency(totals.discountAmount);
    document.getElementById('counterGrandTotal').textContent = formatCurrency(totals.grandTotal);

    var saveBtn = document.getElementById('counterSaveBtn');
    if (saveBtn) saveBtn.disabled = counterItems.length === 0;
}
window.renderCounterItems = renderCounterItems;

// ----------------------------------------------------------
// SAVE
// ----------------------------------------------------------
function counterBillNumber() {
    var year = new Date().getFullYear();
    var counterRef = db.collection('billCounters').doc('counter-' + year);
    return db.runTransaction(function(tx) {
        return tx.get(counterRef).then(function(doc) {
            var next = (doc.exists ? Number(doc.data().count || 0) : 0) + 1;
            tx.set(counterRef, { count: next, year: year, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            return 'JMH-CTR-' + year + '-' + String(next).padStart(5, '0');
        });
    });
}

function saveCounterSale() {
    var saveBtn = document.getElementById('counterSaveBtn');
    if (saveBtn.disabled) return;
    if (!counterItems.length) { showToast('Add at least one medicine.', 'warning'); return; }
    var items = counterItems.map(function (item) { return Object.assign({}, item); });
    var totals = counterTotals();
    var buyerName = (document.getElementById('counterBuyerName').value || '').trim() || 'Counter sale';
    var buyerPhone = (document.getElementById('counterBuyerPhone').value || '').trim();
    var paymentMode = document.getElementById('counterPaymentMode').value;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    getCurrentUser(function (user) {
        commitPharmacySale({
            counter: true, patient: { name: buyerName, phone: buyerPhone },
            items: items.map(function (item) { return { medicineId: item.id, medicineName: item.name,
                quantity: item.quantity, unitPrice: item.price }; }),
            discountPercent: totals.discountPercent, paymentMode: paymentMode, actor: user.email || ''
        }).then(function (result) {
            showToast('Counter sale ' + result.billNumber + ' saved.', 'success');
            resetCounterSale();
            printCounterReceipt(result.billNumber, buyerName, buyerPhone, paymentMode, totals, items);
            return loadCounterStock();
        }).catch(function (err) {
            console.error('Counter sale failed:', err);
            showToast(err.message || 'Could not save the sale.', 'error');
        }).finally(function () {
            saveBtn.disabled = counterItems.length === 0;
            saveBtn.innerHTML = '<i class="fa-solid fa-receipt"></i> Save sale & print receipt';
        });
    });
}

window.saveCounterSale = saveCounterSale;

function resetCounterSale() {
    counterItems = [];
    ['counterBuyerName', 'counterBuyerPhone', 'counterSearch'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });
    var discount = document.getElementById('counterDiscount');
    if (discount) discount.value = 0;
    renderCounterItems();
}
window.resetCounterSale = resetCounterSale;

// ----------------------------------------------------------
// RECEIPT
// ----------------------------------------------------------
function printCounterReceipt(billId, buyerName, buyerPhone, paymentMode, totals, items) {
    db.collection('hospitalSettings').doc('main').get().then(function(doc) {
        var settings = doc.exists ? doc.data() : {};
        var jsPDF = window.jspdf.jsPDF;
        // 80mm roll — the usual counter printer.
        var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 200] });
        var y = 8;

        pdf.setFontSize(11);
        pdf.setFont(undefined, 'bold');
        pdf.text(settings.hospitalName || 'Jyothsna Maternity Hospital', 40, y, { align: 'center', maxWidth: 72 });
        y += 5;
        pdf.setFontSize(7);
        pdf.setFont(undefined, 'normal');
        pdf.text(settings.address || '', 40, y, { align: 'center', maxWidth: 72 });
        y += 4;
        pdf.text('Phone: ' + (settings.phone || ''), 40, y, { align: 'center' });
        y += 5;

        pdf.setFontSize(9);
        pdf.setFont(undefined, 'bold');
        pdf.text('PHARMACY COUNTER SALE', 40, y, { align: 'center' });
        y += 5;

        pdf.setFontSize(7.5);
        pdf.setFont(undefined, 'normal');
        pdf.text('Bill: ' + billId, 4, y); y += 3.5;
        pdf.text('Date: ' + formatDateTime(new Date()), 4, y); y += 3.5;
        pdf.text('Buyer: ' + buyerName, 4, y); y += 3.5;
        if (buyerPhone) { pdf.text('Phone: ' + buyerPhone, 4, y); y += 3.5; }

        pdf.line(4, y, 76, y); y += 4;
        pdf.setFont(undefined, 'bold');
        pdf.text('Item', 4, y);
        pdf.text('Qty', 50, y, { align: 'right' });
        pdf.text('Amount', 76, y, { align: 'right' });
        y += 2;
        pdf.line(4, y, 76, y); y += 4;

        pdf.setFont(undefined, 'normal');
        items.forEach(function(item) {
            var lines = pdf.splitTextToSize(item.name, 42);
            pdf.text(lines, 4, y);
            pdf.text(String(item.quantity), 50, y, { align: 'right' });
            pdf.text(Number(item.price * item.quantity).toFixed(2), 76, y, { align: 'right' });
            y += Math.max(lines.length * 3.2, 4);
        });

        y += 1;
        pdf.line(4, y, 76, y); y += 4;
        pdf.text('Subtotal', 40, y); pdf.text(totals.subtotal.toFixed(2), 76, y, { align: 'right' }); y += 4;
        if (totals.discountAmount > 0) {
            pdf.text('Discount (' + totals.discountPercent + '%)', 40, y);
            pdf.text('-' + totals.discountAmount.toFixed(2), 76, y, { align: 'right' });
            y += 4;
        }
        pdf.setFont(undefined, 'bold');
        pdf.setFontSize(9);
        pdf.text('TOTAL', 40, y); pdf.text(totals.grandTotal.toFixed(2), 76, y, { align: 'right' }); y += 5;
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(7.5);
        pdf.text('Paid by ' + paymentMode, 4, y); y += 5;

        pdf.setFontSize(6.5);
        pdf.text('Medicines once sold are not returnable except as per policy.', 40, y, { align: 'center', maxWidth: 72 });

        savePDFHelper(pdf, 'Counter-' + billId);
    }).catch(function (err) { showToast('Sale saved, but receipt could not be generated: ' + err.message, 'warning'); });
}

// ----------------------------------------------------------
// WIRING
// ----------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
    if (!document.getElementById('counterSaleSection')) return;

    getCurrentUser(function () {
        loadCounterStock().then(renderCounterItems).catch(function (err) { showToast('Unable to load counter stock: ' + err.message, 'error'); });
    });

    var search = document.getElementById('counterSearch');
    if (search) {
        search.addEventListener('input', debounce(function(e) { renderCounterSuggestions(e.target.value); }, 200));
        search.addEventListener('blur', function() {
            // Delay so a click on a suggestion still registers.
            setTimeout(function() {
                var box = document.getElementById('counterSuggestions');
                if (box) box.style.display = 'none';
            }, 200);
        });
    }

    var discount = document.getElementById('counterDiscount');
    if (discount) discount.addEventListener('input', renderCounterItems);

    var saveBtn = document.getElementById('counterSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveCounterSale);

    var clearBtn = document.getElementById('counterClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', resetCounterSale);
});
