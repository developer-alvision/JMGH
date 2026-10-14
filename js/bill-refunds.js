// ==========================================================
// BILL CANCELLATION & REFUNDS
//
// Rules agreed with the hospital:
//   * A bill is NEVER deleted. Cancelling marks it cancelled and
//     leaves the original figures intact; refunding posts a
//     negative entry against it. The register always reconciles.
//   * Admin may act on a bill of any age.
//   * Pharmacy and reception may act only on bills raised in the
//     last 5 months; anything older needs an admin.
//   * A written reason is mandatory in every case.
//   * Every action is written to auditLog.
// ==========================================================

var REFUND_WINDOW_MONTHS = 5;

// Roles allowed to cancel or refund at all.
var REFUND_ROLES = ['admin', 'billing_staff', 'receptionist', 'pharmacist'];

function billAgeInMonths(bill) {
    var created = bill.createdAt && bill.createdAt.toDate ? bill.createdAt.toDate() : new Date(bill.createdAt || Date.now());
    if (isNaN(created.getTime())) return 0;
    var now = new Date();
    return (now.getFullYear() - created.getFullYear()) * 12
        + (now.getMonth() - created.getMonth())
        - (now.getDate() < created.getDate() ? 1 : 0);
}
window.billAgeInMonths = billAgeInMonths;

// Returns { allowed: bool, reason: string } for the current user.
function canModifyBill(bill, role) {
    role = (role || '').toLowerCase();
    if (REFUND_ROLES.indexOf(role) === -1) {
        return { allowed: false, reason: 'Your role cannot cancel or refund bills.' };
    }
    if (role === 'admin') return { allowed: true, reason: '' };

    var age = billAgeInMonths(bill);
    if (age >= REFUND_WINDOW_MONTHS) {
        return {
            allowed: false,
            reason: 'This bill is ' + age + ' months old. Bills older than '
                + REFUND_WINDOW_MONTHS + ' months can only be handled by an admin.'
        };
    }
    return { allowed: true, reason: '' };
}
window.canModifyBill = canModifyBill;

// ----------------------------------------------------------
// DIALOG
// ----------------------------------------------------------
function openBillActionModal(billDocId, mode) {
    db.collection('bills').doc(billDocId).get().then(function(doc) {
        if (!doc.exists) { showToast('Bill not found.', 'error'); return; }
        var bill = doc.data();

        getCurrentUser(function(user) {
            var permission = canModifyBill(bill, user.role);
            if (!permission.allowed) { showToast(permission.reason, 'error'); return; }

            if (bill.status === 'Cancelled' || bill.status === 'cancelled') {
                showToast('This bill is already cancelled.', 'warning');
                return;
            }

            var paid = Number(bill.amountPaid || 0);
            var alreadyRefunded = Number(bill.refundedAmount || 0);
            var refundable = Math.max(0, Math.round((paid - alreadyRefunded) * 100) / 100);

            if (mode === 'refund' && refundable <= 0) {
                showToast('Nothing has been collected on this bill, so there is nothing to refund. Cancel it instead.', 'warning');
                return;
            }

            var isRefund = mode === 'refund';
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = '<div style="background:white;border-radius:12px;padding:24px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.25);max-height:90vh;overflow:auto;">'
                + '<h3 style="margin:0 0 4px;color:#0F2B5B;font-size:16px;font-weight:700;">'
                + '<i class="fa-solid ' + (isRefund ? 'fa-rotate-left' : 'fa-ban') + '" style="color:#dc2626;margin-right:8px;"></i>'
                + (isRefund ? 'Refund bill' : 'Cancel bill') + ' ' + escapeHtml(bill.billId || '') + '</h3>'
                + '<p style="margin:0 0 14px;color:#64748b;font-size:12.5px;">'
                + escapeHtml(bill.patientName || '') + ' · ' + escapeHtml(bill.patientId || '')
                + ' · raised ' + escapeHtml(formatDate(bill.createdAt)) + '</p>'

                + '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:13px;margin-bottom:14px;">'
                + '<div style="display:flex;justify-content:space-between;"><span>Bill total</span><strong>' + formatCurrency(bill.grandTotal) + '</strong></div>'
                + '<div style="display:flex;justify-content:space-between;"><span>Collected</span><strong>' + formatCurrency(paid) + '</strong></div>'
                + (alreadyRefunded > 0 ? '<div style="display:flex;justify-content:space-between;color:#b45309;"><span>Already refunded</span><strong>' + formatCurrency(alreadyRefunded) + '</strong></div>' : '')
                + '<div style="display:flex;justify-content:space-between;border-top:1px solid #e2e8f0;margin-top:6px;padding-top:6px;"><span>Refundable now</span><strong style="color:#b91c1c;">' + formatCurrency(refundable) + '</strong></div>'
                + '</div>'

                + (isRefund
                    ? '<div class="form-group"><label>Refund amount <span style="color:#dc2626;">*</span></label>'
                      + '<input type="number" id="refundAmountInput" min="0.01" step="0.01" max="' + refundable + '" value="' + refundable + '"></div>'
                      + '<div class="form-group"><label>Refund mode</label><select id="refundModeInput">'
                      + '<option value="Cash">Cash</option><option value="UPI">UPI</option>'
                      + '<option value="Card">Card</option><option value="Bank Transfer">Bank Transfer</option>'
                      + '</select></div>'
                    : '<p style="font-size:12.5px;color:#b45309;background:#fffbeb;border:1px solid #fef3c7;padding:10px;border-radius:8px;">'
                      + 'The bill stays in the register marked <strong>Cancelled</strong> and keeps its original figures. '
                      + (paid > 0 ? 'It has ' + formatCurrency(paid) + ' collected against it — refund that separately if the money is being returned.' : '')
                      + '</p>')

                + '<div class="form-group"><label>Reason <span style="color:#dc2626;">*</span></label>'
                + '<textarea id="billActionReason" rows="3" maxlength="300" placeholder="Why is this bill being '
                + (isRefund ? 'refunded' : 'cancelled') + '? This is kept permanently in the audit trail."></textarea></div>'

                + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">'
                + '<button class="btn-secondary ba-cancel">Close</button>'
                + '<button class="btn-danger ba-confirm">' + (isRefund ? 'Post refund' : 'Cancel bill') + '</button>'
                + '</div></div>';

            document.body.appendChild(overlay);
            overlay.querySelector('.ba-cancel').onclick = function() { overlay.remove(); };
            overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

            overlay.querySelector('.ba-confirm').onclick = function() {
                var reason = (document.getElementById('billActionReason').value || '').trim();
                if (reason.length < 5) {
                    showToast('Give a reason — it is kept in the audit trail.', 'warning');
                    return;
                }

                var amount = 0;
                if (isRefund) {
                    amount = Number(document.getElementById('refundAmountInput').value || 0);
                    if (!(amount > 0)) { showToast('Enter a refund amount.', 'warning'); return; }
                    if (amount > refundable + 0.001) {
                        showToast('You cannot refund more than ' + formatCurrency(refundable) + '.', 'error');
                        return;
                    }
                }

                var button = this;
                button.disabled = true;
                var action = isRefund
                    ? postBillRefund(billDocId, amount, document.getElementById('refundModeInput').value, reason, user)
                    : cancelBill(billDocId, reason, user);

                action.then(function() {
                    overlay.remove();
                    if (typeof loadBills === 'function') loadBills();
                }).catch(function(err) {
                    showToast('Could not complete: ' + err.message, 'error');
                    button.disabled = false;
                });
            };
        });
    }).catch(function(err) {
        showToast('Could not load the bill: ' + err.message, 'error');
    });
}
window.openBillActionModal = openBillActionModal;

// ----------------------------------------------------------
// WRITES
// ----------------------------------------------------------
function cancelBill(billDocId, reason, user) {
    var billRef = db.collection('bills').doc(billDocId);

    return db.runTransaction(function(tx) {
        return tx.get(billRef).then(function(doc) {
            if (!doc.exists) throw new Error('Bill not found.');
            var bill = doc.data();
            if (String(bill.status || '').toLowerCase() === 'cancelled') {
                throw new Error('This bill is already cancelled.');
            }

            // Original figures are preserved; only the state changes.
            tx.update(billRef, {
                status: 'Cancelled',
                paymentStatus: 'cancelled',
                cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
                cancelledBy: user.email || '',
                cancelReason: reason,
                balanceDue: 0,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            tx.set(db.collection('auditLog').doc(), {
                action: 'BILL_CANCELLED',
                billDocId: billDocId,
                billId: bill.billId || '',
                patientId: bill.patientId || '',
                patientName: bill.patientName || '',
                amount: Number(bill.grandTotal || 0),
                reason: reason,
                performedBy: user.email || '',
                performedByRole: (user.role || '').toLowerCase(),
                billAgeMonths: billAgeInMonths(bill),
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            return bill;
        });
    }).then(function(bill) {
        // Mirror onto the patient's copy of the bill where one exists.
        if (bill.patientDocId) {
            db.collection('patients').doc(bill.patientDocId).collection('bills').doc(billDocId)
                .set({ status: 'Cancelled', paymentStatus: 'cancelled', cancelReason: reason, balanceDue: 0 }, { merge: true })
                .catch(function(err) { console.warn('Patient bill copy not updated:', err.message); });
        }
        showToast('Bill cancelled and recorded in the audit trail.', 'success');
    });
}
window.cancelBill = cancelBill;

function postBillRefund(billDocId, amount, mode, reason, user) {
    var billRef = db.collection('bills').doc(billDocId);
    var refundId = 'RFND-' + Date.now();

    return db.runTransaction(function(tx) {
        return tx.get(billRef).then(function(doc) {
            if (!doc.exists) throw new Error('Bill not found.');
            var bill = doc.data();

            var paid = Number(bill.amountPaid || 0);
            var refundedSoFar = Number(bill.refundedAmount || 0);
            if (amount > paid - refundedSoFar + 0.001) {
                throw new Error('Refund exceeds the amount collected on this bill.');
            }

            var newRefunded = Math.round((refundedSoFar + amount) * 100) / 100;
            var netPaid = Math.round((paid - newRefunded) * 100) / 100;
            var total = Number(bill.grandTotal || 0);
            var newBalance = Math.max(0, Math.round((total - netPaid) * 100) / 100);

            tx.update(billRef, {
                refundedAmount: newRefunded,
                netPaid: netPaid,
                balanceDue: newBalance,
                paymentStatus: netPaid <= 0 ? 'unpaid' : (newBalance > 0 ? 'partial' : 'paid'),
                lastRefundAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastRefundBy: user.email || '',
                lastRefundReason: reason,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // A refund is a negative payment row, so the ledger still adds up.
            tx.set(db.collection('payments').doc(refundId), {
                paymentId: refundId,
                type: 'refund',
                amount: -Math.abs(amount),
                refundOf: bill.billId || billDocId,
                billDocId: billDocId,
                patientId: bill.patientId || '',
                patientName: bill.patientName || '',
                paymentMethod: mode,
                reason: reason,
                recordedBy: user.email || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            tx.set(db.collection('auditLog').doc(), {
                action: 'BILL_REFUNDED',
                billDocId: billDocId,
                billId: bill.billId || '',
                patientId: bill.patientId || '',
                patientName: bill.patientName || '',
                amount: amount,
                refundMode: mode,
                reason: reason,
                performedBy: user.email || '',
                performedByRole: (user.role || '').toLowerCase(),
                billAgeMonths: billAgeInMonths(bill),
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            return bill;
        });
    }).then(function() {
        showToast('Refund of ' + formatCurrency(amount) + ' posted.', 'success');
    });
}
window.postBillRefund = postBillRefund;
