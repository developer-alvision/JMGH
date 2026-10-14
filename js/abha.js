// ==========================================================
// ABDM / ABHA LINKING (patient profile)
//
// The whole exchange with the ABDM gateway happens in Cloud
// Functions: the client secret and the gateway session token
// never reach the browser. This file only collects the ABHA
// identifier and the OTP, and shows the linked state.
//
// The panel stays hidden until hospitalSettings/main
// .integrations.abdm.enabled is true, so nothing appears until
// the facility is actually registered with ABDM.
// ==========================================================

var abhaTxnId = null;

function abhaPanelHost() {
    return document.getElementById('abhaPanel');
}

function renderAbhaPanel(patient) {
    var host = abhaPanelHost();
    if (!host) return;

    var linked = Boolean(patient.abhaNumber || patient.abhaAddress);

    host.innerHTML = '<div class="card" style="border-left:5px solid #1e40af;">'
        + '<div class="card-header">'
        + '<h3 class="card-title"><i class="fa-solid fa-id-card" style="color:#1e40af;"></i> ABHA (Ayushman Bharat Health Account)</h3>'
        + (linked
            ? '<span class="status-badge" style="background:#eff6ff;color:#1e40af;">Linked</span>'
            : '<span class="status-badge" style="background:#f1f5f9;color:#64748b;">Not linked</span>')
        + '</div>'
        + '<div class="modal-body">'
        + (linked
            ? '<div class="form-grid">'
                + '<div><strong>ABHA number</strong><br>' + escapeHtml(patient.abhaNumber || '—') + '</div>'
                + '<div><strong>ABHA address</strong><br>' + escapeHtml(patient.abhaAddress || '—') + '</div>'
                + '<div><strong>Verified on</strong><br>' + escapeHtml(formatDate(patient.abhaVerifiedAt)) + '</div>'
                + '<div><strong>Verified by</strong><br>' + escapeHtml(patient.abhaVerifiedBy || '—') + '</div>'
                + '</div>'
                + '<div style="margin-top:12px;"><button class="btn-secondary" id="abhaUnlinkBtn" style="color:#dc2626;border-color:#fecaca;">'
                + '<i class="fa-solid fa-link-slash"></i> Unlink at patient\'s request</button></div>'

            : '<p style="font-size:13px;color:#475569;margin:0 0 12px;">'
                + 'Linking an ABHA lets this visit be recorded against the patient\'s national health account. '
                + 'Ask for the patient\'s consent before you start — an OTP goes to the mobile number registered with their ABHA.</p>'
                + '<div class="form-grid">'
                + '<div class="form-group"><label>ABHA number or address</label>'
                + '<input type="text" id="abhaIdInput" placeholder="14-digit number or name@abdm"></div>'
                + '<div class="form-group" id="abhaOtpGroup" style="display:none;"><label>OTP sent to the registered mobile</label>'
                + '<input type="text" id="abhaOtpInput" inputmode="numeric" maxlength="8" placeholder="6-digit OTP"></div>'
                + '</div>'
                + '<div style="display:flex;gap:8px;margin-top:8px;">'
                + '<button class="btn-primary" id="abhaSendOtpBtn"><i class="fa-solid fa-paper-plane"></i> Send OTP</button>'
                + '<button class="btn-primary" id="abhaVerifyBtn" style="display:none;background:#1e40af;border-color:#1e40af;">'
                + '<i class="fa-solid fa-check"></i> Verify &amp; link</button>'
                + '</div>')
        + '</div></div>';

    host.style.display = 'block';
    wireAbhaPanel();
}

function wireAbhaPanel() {
    var sendButton = document.getElementById('abhaSendOtpBtn');
    if (sendButton) {
        sendButton.addEventListener('click', function() {
            var abhaId = (document.getElementById('abhaIdInput').value || '').trim();
            if (!abhaId) { showToast('Enter the patient\'s ABHA number or address.', 'warning'); return; }

            sendButton.disabled = true;
            callFunction('abdmRequestOtp', { abhaId: abhaId }).then(function(result) {
                abhaTxnId = result.txnId;
                document.getElementById('abhaOtpGroup').style.display = 'block';
                document.getElementById('abhaVerifyBtn').style.display = 'inline-flex';
                showToast('OTP sent to the mobile registered with this ABHA.', 'success');
            }).catch(function(err) {
                showToast(err.message || 'ABDM could not send the OTP.', 'error');
            }).then(function() { sendButton.disabled = false; });
        });
    }

    var verifyButton = document.getElementById('abhaVerifyBtn');
    if (verifyButton) {
        verifyButton.addEventListener('click', function() {
            var otp = (document.getElementById('abhaOtpInput').value || '').trim();
            if (!abhaTxnId) { showToast('Send the OTP first.', 'warning'); return; }
            if (!otp) { showToast('Enter the OTP the patient received.', 'warning'); return; }

            verifyButton.disabled = true;
            callFunction('abdmVerifyAndLink', {
                txnId: abhaTxnId,
                otp: otp,
                patientDocId: currentPatientDocId
            }).then(function(result) {
                Object.assign(currentPatient, {
                    abhaNumber: result.abhaNumber,
                    abhaAddress: result.abhaAddress,
                    abhaVerifiedAt: new Date(),
                    abhaVerifiedBy: (firebase.auth().currentUser || {}).email || ''
                });
                abhaTxnId = null;
                renderAbhaPanel(currentPatient);
                showToast('ABHA linked to this patient.', 'success');
            }).catch(function(err) {
                showToast(err.message || 'ABHA verification failed.', 'error');
            }).then(function() { verifyButton.disabled = false; });
        });
    }

    var unlinkButton = document.getElementById('abhaUnlinkBtn');
    if (unlinkButton) {
        unlinkButton.addEventListener('click', function() {
            confirmAction(
                'Unlink this ABHA?',
                'The link between this patient record and their national health account is removed. The action is recorded in the ABDM audit trail.',
                function() {
                    callFunction('abdmUnlink', { patientDocId: currentPatientDocId }).then(function() {
                        delete currentPatient.abhaNumber;
                        delete currentPatient.abhaAddress;
                        delete currentPatient.abhaVerifiedAt;
                        delete currentPatient.abhaVerifiedBy;
                        renderAbhaPanel(currentPatient);
                        showToast('ABHA unlinked.', 'success');
                    }).catch(function(err) {
                        showToast(err.message || 'Could not unlink the ABHA.', 'error');
                    });
                },
                'Unlink'
            );
        });
    }
}

// The profile script loads the patient asynchronously, so wait for it
// rather than racing it.
document.addEventListener('DOMContentLoaded', function() {
    if (!abhaPanelHost()) return;

    db.collection('hospitalSettings').doc('main').get().then(function(doc) {
        var config = (doc.exists && doc.data().integrations && doc.data().integrations.abdm) || {};
        if (config.enabled !== true) return; // panel stays hidden

        var attempts = 0;
        var timer = setInterval(function() {
            attempts++;
            if (typeof currentPatient !== 'undefined' && currentPatient && currentPatientDocId) {
                clearInterval(timer);
                renderAbhaPanel(currentPatient);
            } else if (attempts > 40) { // ~20 seconds
                clearInterval(timer);
            }
        }, 500);
    }).catch(function(err) {
        console.warn('ABDM settings unavailable:', err.message);
    });
});
