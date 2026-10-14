// All dispensing paths share one transaction: stock, invoice, receipt and history
// either commit together or remain unchanged when validation/conflicts fail.
(function () {
    'use strict';
    function money(value) { return Math.round(Number(value) * 100) / 100; }
    function availableMedicine(data) {
        if (!data || data.disposed || data.stockStatus === 'expired') return false;
        if (!data.expiryDate) return true;
        var expiry = String(data.expiryDate).slice(0, 10);
        return expiry >= todayIso();
    }
    window.isSaleableMedicine = availableMedicine;

    window.commitPharmacySale = async function (options) {
        var items = (options.items || []).map(function (item) { return Object.assign({}, item); });
        if (!items.length) throw new Error('Add at least one medicine.');
        if (items.length > 80) throw new Error('Limit one sale to 80 medicine lines.');
        items.forEach(function (item) {
            item.quantity = Number(item.quantity);
            item.unitPrice = Number(item.unitPrice);
            if (!item.medicineId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
                throw new Error('Medicine quantities must be positive whole numbers and prices must be valid.');
            }
        });
        var patient = options.patient || {};
        if (!options.counter && (!patient.docId || !patient.patientId)) throw new Error('Select a registered patient.');
        var linkedBill = String(options.linkedBillId || '').trim();
        var mode = options.paymentMode || 'Cash';
        if (mode === 'Bill Attached' && !linkedBill) throw new Error('Enter the bill number to attach these medicines.');
        var billRef;
        if (linkedBill) {
            var billDoc = await db.collection('bills').doc(linkedBill).get();
            if (billDoc.exists) billRef = billDoc.ref;
            else {
                var matches = await db.collection('bills').where('billId', '==', linkedBill).limit(1).get();
                if (matches.empty) throw new Error('Bill not found: ' + linkedBill);
                billRef = matches.docs[0].ref;
            }
        } else billRef = db.collection('bills').doc();

        var year = new Date().getFullYear();
        var counterRef = db.collection('billCounters').doc(options.counter ? 'counter-' + year : 'pharmacy');
        var rxRef = options.prescriptionId ? db.collection('prescriptions').doc(options.prescriptionId) : null;
        var medicineIds = Array.from(new Set(items.map(function (item) { return item.medicineId; })));
        var refs = medicineIds.map(function (id) { return db.collection('pharmacy').doc(id); });
        var historyRefs = items.map(function () { return db.collection('dispensingHistory').doc(); });
        var paymentRef = db.collection('payments').doc();
        var auditRef = db.collection('auditLog').doc();

        return db.runTransaction(async function (tx) {
            // Firestore requires all reads before the first transaction write.
            var stockDocs = await Promise.all(refs.map(function (ref) { return tx.get(ref); }));
            var billSnap = linkedBill ? await tx.get(billRef) : null;
            var countSnap = linkedBill ? null : await tx.get(counterRef);
            var rxSnap = rxRef ? await tx.get(rxRef) : null;
            if (rxRef && (!rxSnap.exists || String(rxSnap.data().status).toLowerCase() === 'dispensed')) {
                throw new Error('This prescription is missing or has already been dispensed.');
            }
            var bill = billSnap && billSnap.exists ? billSnap.data() : null;
            if (linkedBill && !bill) throw new Error('The linked bill no longer exists.');
            if (bill && (bill.patientId !== patient.patientId || bill.patientDocId && bill.patientDocId !== patient.docId)) {
                throw new Error('The selected bill belongs to another patient.');
            }
            if (bill && (/cancelled|refunded/i.test(bill.status || '') || bill.isIPDClosed)) {
                throw new Error('This bill is closed. Create a new pharmacy bill.');
            }
            stockDocs.forEach(function (doc, index) {
                var requested = items.filter(function (item) { return item.medicineId === medicineIds[index]; })
                    .reduce(function (sum, item) { return sum + item.quantity; }, 0);
                var med = doc.exists ? doc.data() : null;
                if (!availableMedicine(med)) throw new Error('Medicine is missing, expired or disposed: ' + (med ? med.medicineName : medicineIds[index]));
                if (Number(med.stock || 0) < requested) throw new Error('Insufficient stock for ' + med.medicineName + '. Available: ' + Number(med.stock || 0));
            });

            var now = firebase.firestore.FieldValue.serverTimestamp();
            var nextCount = countSnap ? Number(countSnap.exists ? countSnap.data().count || 0 : 0) + 1 : 0;
            var billNumber = bill ? bill.billId : (options.counter ? 'JMH-CTR-' : 'SA-PH-') + year + '-' + String(nextCount).padStart(5, '0');
            var billingItems = items.map(function (item, index) {
                var stockIndex = medicineIds.indexOf(item.medicineId);
                var stockData = (stockDocs[stockIndex] && stockDocs[stockIndex].exists) ? stockDocs[stockIndex].data() : {};
                var lineAmount = money(item.quantity * item.unitPrice);
                // Retail chemist pricing: the selling price already includes
                // GST, so the taxable value is back-calculated and the tax is
                // split equally into CGST and SGST for an intra-state sale.
                var rate = Number(item.gstRate != null ? item.gstRate : (stockData.gstRate != null ? stockData.gstRate : 5)) || 0;
                var taxable = money(lineAmount / (1 + rate / 100));
                var tax = money(lineAmount - taxable);
                return { category: 'Medicine', medicineId: item.medicineId, description: item.medicineName + ' x' + item.quantity,
                    medicineName: item.medicineName, dosage: item.dosage || '', days: item.days || 1,
                    frequency: item.frequency || '', instructions: item.instructions || '', quantity: item.quantity,
                    unitPrice: item.unitPrice, amount: lineAmount, orderedBy: options.doctor || '',
                    // Printed on the GST retail invoice.
                    hsnCode: item.hsnCode || stockData.hsnCode || '',
                    schedule: item.schedule || stockData.schedule || '',
                    manufacturer: item.manufacturer || stockData.manufacturer || '',
                    batchNumber: item.batchNumber || stockData.batchNumber || '',
                    expiryDate: item.expiryDate || stockData.expiryDate || '',
                    gstRate: rate, taxableValue: taxable, cgst: money(tax / 2), sgst: money(tax / 2) };
            });
            var addedSubtotal = money(billingItems.reduce(function (sum, item) { return sum + item.amount; }, 0));
            var subtotal = money((bill ? Number(bill.subtotal === undefined ? bill.grandTotal || 0 : bill.subtotal) : 0) + addedSubtotal);
            var discountPercent = Math.max(0, Math.min(100, Number(bill ? bill.discountPercent || 0 : options.discountPercent || 0)));
            var discountAmount = money(subtotal * discountPercent / 100);
            var gstPercent = bill ? Number(bill.gstPercent || 0) : 0;
            var gstAmount = money((subtotal - discountAmount) * gstPercent / 100);
            var total = money(subtotal - discountAmount + gstAmount);
            var refunded = bill ? Number(bill.refundedAmount || 0) : 0;
            var existingPaid = bill ? Number(bill.amountPaid === undefined ? Number(bill.grandTotal || 0) - Number(bill.balanceDue || 0) + refunded : bill.amountPaid) : 0;
            var received = /^(Due|Credit|Insurance|Aarogyasri|Govt Scheme|Bill Attached)$/i.test(mode) ? 0 : money(total - (bill ? Number(bill.grandTotal || 0) : 0));
            var paid = money(existingPaid + received);
            var netPaid = money(paid - refunded);
            var balance = Math.max(0, money(total - netPaid));
            var paymentDetails = Object.assign({}, bill ? bill.paymentDetails : {});
            if (received > 0) paymentDetails[mode] = { amount: money(Number((paymentDetails[mode] || {}).amount || 0) + received) };
            var invoice = Object.assign({}, bill || {}, {
                billDocId: billRef.id, billId: billNumber, patientId: patient.patientId || '', patientDocId: patient.docId || '',
                patientName: patient.name || 'Counter sale', patientPhone: patient.phone || '',
                items: (bill ? bill.items || [] : []).concat(billingItems), subtotal: subtotal, discountPercent: discountPercent,
                discountAmount: discountAmount, gstPercent: gstPercent, gstAmount: gstAmount, grandTotal: total,
                amountPaid: paid, netPaid: netPaid, balanceDue: balance, paymentStatus: balance === 0 ? 'paid' : netPaid > 0 ? 'partial' : 'due',
                paymentMethod: mode, paymentMethods: Array.from(new Set((bill ? bill.paymentMethods || [] : []).concat(mode))),
                paymentDetails: paymentDetails, updatedAt: now
            });
            // GST slab summary across every line on the invoice, so the
            // printed bill can show taxable / CGST / SGST per rate without
            // recomputing and risking a different answer.
            var slabs = {};
            (invoice.items || []).forEach(function (line) {
                if (!line || line.taxableValue === undefined) return;
                var key = String(Number(line.gstRate) || 0);
                if (!slabs[key]) slabs[key] = { rate: Number(key), taxable: 0, cgst: 0, sgst: 0 };
                slabs[key].taxable = money(slabs[key].taxable + Number(line.taxableValue || 0));
                slabs[key].cgst = money(slabs[key].cgst + Number(line.cgst || 0));
                slabs[key].sgst = money(slabs[key].sgst + Number(line.sgst || 0));
            });
            invoice.gstSummary = Object.keys(slabs).sort(function (a, b) { return Number(a) - Number(b); })
                .map(function (k) { return slabs[k]; });
            invoice.roundedTotal = Math.round(total);
            invoice.roundOff = money(Math.round(total) - total);
            if (!bill) Object.assign(invoice, { type: 'PHARMACY', billType: 'Pharmacy', isCounterSale: !!options.counter, billedBy: options.actor || '', createdAt: now });
            invoice.status = invoice.paymentStatus;
            if (!bill) tx.set(counterRef, { count: nextCount, updatedAt: now }, { merge: true });
            tx.set(billRef, invoice);
            if (patient.docId) tx.set(db.collection('patients').doc(patient.docId).collection('bills').doc(billRef.id), invoice);
            if (received > 0) tx.set(paymentRef, {
                paymentId: paymentRef.id, billId: billNumber, billDocId: billRef.id,
                patientId: patient.patientId || '', patientName: patient.name || 'Counter sale',
                amount: received, paymentMethod: mode, type: options.counter ? 'counter_sale' : 'pharmacy_sale',
                recordedBy: options.actor || '', createdAt: now, recordedAt: now
            });
            stockDocs.forEach(function (doc, index) {
                var quantity = items.filter(function (item) { return item.medicineId === medicineIds[index]; }).reduce(function (sum, item) { return sum + item.quantity; }, 0);
                tx.update(refs[index], { stock: Number(doc.data().stock) - quantity, updatedAt: now });
            });
            var records = items.map(function (item, index) {
                var record = Object.assign({}, billingItems[index], {
                    dispensingId: historyRefs[index].id, patientId: patient.patientId || '', patientDocId: patient.docId || '',
                    patientName: patient.name || 'Counter sale', totalAmount: billingItems[index].amount,
                    prescribedBy: options.doctor || '', dispensedBy: options.actor || '', paymentMethod: mode,
                    linkedBillId: billNumber, billDocId: billRef.id, isCounterSale: !!options.counter, createdAt: now
                });
                tx.set(historyRefs[index], record);
                if (patient.docId) tx.set(db.collection('patients').doc(patient.docId).collection('dispensing').doc(historyRefs[index].id), record);
                tx.set(db.collection('pharmacyLog').doc(historyRefs[index].id), Object.assign({ dispensedAt: now }, record));
                return record;
            });
            if (rxRef) tx.update(rxRef, { status: 'dispensed', dispensedAt: now, dispensedBy: options.actor || '', linkedBillId: billNumber, billDocId: billRef.id });
            tx.set(auditRef, { action: options.counter ? 'COUNTER_SALE' : 'PHARMACY_DISPENSE', billId: billNumber,
                amount: addedSubtotal, performedBy: options.actor || '', timestamp: now });
            return { billDocId: billRef.id, billNumber: billNumber, totalAmount: addedSubtotal, records: records };
        });
    };
}());
