// Secure provider entry points. Provider secrets live only in Firebase Functions.
// Each feature remains disabled until hospitalSettings/main.integrations.<name>.enabled
// is explicitly set to true after its keys and provider setup are complete.
(function () {
    var settingsPromise = null;

    function getIntegrationSettings() {
        if (!settingsPromise) {
            settingsPromise = db.collection('hospitalSettings').doc('main').get()
                .then(function (doc) { return doc.exists ? (doc.data().integrations || {}) : {}; })
                .catch(function () { return {}; });
        }
        return settingsPromise;
    }

    function isEnabled(provider) {
        return getIntegrationSettings().then(function (integrations) {
            return Boolean(integrations[provider] && integrations[provider].enabled === true);
        });
    }

    // Region-aware; see callFunction in helpers.js.
    function callable(name, data) {
        return callFunction(name, data);
    }

    function loadRazorpayCheckout() {
        if (window.Razorpay) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = resolve;
            script.onerror = function () { reject(new Error('Razorpay Checkout could not be loaded.')); };
            document.head.appendChild(script);
        });
    }

    window.startRazorpayBillPayment = function (bill) {
        if (!bill || !bill.id) { showToast('Bill details are unavailable.', 'error'); return; }
        isEnabled('razorpay').then(function (enabled) {
            if (!enabled) {
                showToast('Razorpay is integrated but currently on hold.', 'warning');
                return null;
            }
            return callable('createRazorpayOrder', { billDocId: bill.id });
        }).then(function (order) {
            if (!order) return null;
            return loadRazorpayCheckout().then(function () {
                var checkout = new window.Razorpay({
                    key: order.keyId,
                    amount: order.amount,
                    currency: order.currency || 'INR',
                    name: 'Jyothsna Maternity Hospital',
                    description: 'Bill ' + order.billName,
                    order_id: order.orderId,
                    theme: { color: '#D6336C' },
                    handler: function (response) {
                        callable('verifyRazorpayPayment', {
                            orderId: response.razorpay_order_id,
                            paymentId: response.razorpay_payment_id,
                            signature: response.razorpay_signature
                        }).then(function () {
                            showToast('Online payment verified and recorded.', 'success');
                            if (typeof loadBills === 'function') loadBills();
                        }).catch(function (err) {
                            console.error('Razorpay verification error:', err);
                            showToast('Payment received but verification needs attention: ' + err.message, 'error');
                        });
                    }
                });
                checkout.on('payment.failed', function () { showToast('Online payment was not completed.', 'warning'); });
                checkout.open();
            });
        }).catch(function (err) {
            console.error('Razorpay setup error:', err);
            showToast(err.message || 'Unable to start Razorpay payment.', 'error');
        });
    };

    function sendBill(provider, functionName, billDocId, successText) {
        if (!billDocId) { showToast('Open a bill first.', 'warning'); return; }
        isEnabled(provider).then(function (enabled) {
            if (!enabled) {
                showToast((provider === 'aiSensy' ? 'AI Sensy' : 'Email delivery') + ' is integrated but currently on hold.', 'warning');
                return null;
            }
            return callable(functionName, { billDocId: billDocId });
        }).then(function (result) {
            if (result && result.sent) showToast(successText, 'success');
        }).catch(function (err) {
            console.error(provider + ' delivery error:', err);
            showToast(err.message || 'Unable to send the bill.', 'error');
        });
    }

    window.sendBillViaWhatsApp = function (billDocId) {
        sendBill('aiSensy', 'sendBillWhatsApp', billDocId, 'Bill sent by WhatsApp.');
    };

    window.sendBillViaEmail = function (billDocId) {
        sendBill('email', 'sendBillEmail', billDocId, 'Bill sent by email.');
    };

    // ------------------------------------------------------
    // MSG91 SMS FALLBACK
    // Built and deployed, but deliberately invisible: nothing is
    // shown and nothing is sent until integrations.msg91.enabled
    // is true and DLT templates are registered. Elements marked
    // data-integration="msg91" reveal themselves at that point.
    // ------------------------------------------------------
    window.sendPatientSms = function (patientDocId, templateId, variables, purpose) {
        return isEnabled('msg91').then(function (enabled) {
            if (!enabled) {
                showToast('SMS delivery is built but not switched on yet.', 'warning');
                return null;
            }
            return callable('sendPatientSms', {
                patientDocId: patientDocId,
                templateId: templateId,
                variables: variables || {},
                purpose: purpose || 'general'
            });
        }).then(function (result) {
            if (result && result.sent) showToast('SMS sent.', 'success');
            return result;
        }).catch(function (err) {
            console.error('SMS delivery error:', err);
            showToast(err.message || 'Unable to send the SMS.', 'error');
            throw err;
        });
    };

    // Reveals any element tagged with a provider once that provider is on.
    // Keeps half-finished integrations out of the interface entirely.
    document.addEventListener('DOMContentLoaded', function () {
        var tagged = document.querySelectorAll('[data-integration]');
        if (!tagged.length) return;
        getIntegrationSettings().then(function (integrations) {
            tagged.forEach(function (element) {
                var provider = element.getAttribute('data-integration');
                var on = Boolean(integrations[provider] && integrations[provider].enabled === true);
                element.style.display = on ? '' : 'none';
            });
        });
    });
}());
