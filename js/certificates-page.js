// ==========================================================
// CERTIFICATES PAGE — issue form, source-record prefill and
// the certificate register.
// ==========================================================

var certActiveType = 'birth';
var certSelectedPatient = null;
var certRegisterRows = [];
var certRegisterUnsub = null;

// Field definitions per certificate type. `full` spans both columns.
var CERT_FIELDS = {
    birth: [
        { key: 'babyName', label: 'Name of child (leave blank if not named)', type: 'text' },
        { key: 'babyGender', label: 'Sex', type: 'select', options: ['Female', 'Male', 'Other'], required: true },
        { key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
        { key: 'timeOfBirth', label: 'Time of birth', type: 'time' },
        { key: 'birthWeight', label: 'Birth weight (kg)', type: 'number', step: '0.01' },
        { key: 'gestationalWeeks', label: 'Gestation at birth (weeks)', type: 'number' },
        { key: 'deliveryType', label: 'Type of delivery', type: 'select', options: ['Normal vaginal', 'Assisted vaginal', 'LSCS (Caesarean)', 'Other'] },
        { key: 'placeOfBirth', label: 'Place of birth', type: 'text' },
        { key: 'motherAge', label: 'Mother’s age (years)', type: 'number' },
        { key: 'fatherName', label: 'Father’s name', type: 'text', required: true },
        { key: 'conductedBy', label: 'Attended by (doctor)', type: 'text', required: true },
        { key: 'informantName', label: 'Informant name & relationship', type: 'text' },
        { key: 'address', label: 'Permanent address', type: 'text', full: true },
        { key: 'hospitalRecordNo', label: 'Hospital record reference', type: 'text' }
    ],
    delivery: [
        { key: 'motherAge', label: 'Age (years)', type: 'number' },
        { key: 'fatherName', label: 'Husband / Guardian name', type: 'text' },
        { key: 'admissionDate', label: 'Date of admission', type: 'date' },
        { key: 'deliveryDate', label: 'Date of delivery', type: 'date', required: true },
        { key: 'deliveryTime', label: 'Time of delivery', type: 'time' },
        { key: 'deliveryType', label: 'Type of delivery', type: 'select', options: ['Normal vaginal', 'Assisted vaginal', 'LSCS (Caesarean)', 'Other'], required: true },
        { key: 'gestationalWeeks', label: 'Gestational age (weeks)', type: 'number' },
        { key: 'outcome', label: 'Outcome', type: 'text' },
        { key: 'babyGender', label: 'Baby sex', type: 'select', options: ['', 'Female', 'Male', 'Other'] },
        { key: 'birthWeight', label: 'Baby weight (kg)', type: 'number', step: '0.01' },
        { key: 'conductedBy', label: 'Conducted by', type: 'text', required: true },
        { key: 'motherCondition', label: 'Condition on discharge', type: 'text' },
        { key: 'complications', label: 'Complications', type: 'text', full: true },
        { key: 'remarks', label: 'Remarks', type: 'text', full: true }
    ],
    medical: [
        { key: 'age', label: 'Age (years)', type: 'number', required: true },
        { key: 'gender', label: 'Sex', type: 'select', options: ['Female', 'Male', 'Other'] },
        { key: 'examinedOn', label: 'Date examined', type: 'date', required: true },
        { key: 'diagnosis', label: 'Diagnosis', type: 'text', required: true, full: true },
        { key: 'treatment', label: 'Treatment given', type: 'text', full: true },
        { key: 'restFrom', label: 'Rest advised from', type: 'date', required: true },
        { key: 'restTo', label: 'Rest advised to', type: 'date', required: true },
        { key: 'resumeOn', label: 'Fit to resume duty on', type: 'date' },
        { key: 'purpose', label: 'Purpose of certificate', type: 'text' },
        { key: 'remarks', label: 'Remarks', type: 'text', full: true }
    ],
    fitness: [
        { key: 'age', label: 'Age (years)', type: 'number', required: true },
        { key: 'gender', label: 'Sex', type: 'select', options: ['Female', 'Male', 'Other'] },
        { key: 'examinedOn', label: 'Date examined', type: 'date', required: true },
        { key: 'bp', label: 'Blood pressure (mmHg)', type: 'text' },
        { key: 'pulse', label: 'Pulse (bpm)', type: 'text' },
        { key: 'height', label: 'Height (cm)', type: 'text' },
        { key: 'weight', label: 'Weight (kg)', type: 'text' },
        { key: 'vision', label: 'Vision', type: 'text' },
        { key: 'generalCondition', label: 'General condition', type: 'text' },
        { key: 'fitFor', label: 'Fit for', type: 'text', required: true },
        { key: 'fitFrom', label: 'Fit with effect from', type: 'date' },
        { key: 'validUntil', label: 'Valid until', type: 'date' },
        { key: 'restrictions', label: 'Restrictions / advice', type: 'text', full: true },
        { key: 'purpose', label: 'Purpose of certificate', type: 'text', full: true }
    ]
};

// ----------------------------------------------------------
// TYPE TABS
// ----------------------------------------------------------
function renderCertTypeTabs(role) {
    var holder = document.getElementById('certTypeTabs');
    if (!holder) return;
    var html = '';
    Object.keys(CERTIFICATE_TYPES).forEach(function(type) {
        var config = CERTIFICATE_TYPES[type];
        if (config.roles.indexOf(role) === -1) return;
        var isActive = type === certActiveType;
        html += '<button type="button" class="btn-secondary cert-type-tab" data-type="' + type + '" style="'
            + (isActive ? 'background:var(--primary-teal);color:white;border-color:var(--primary-teal);' : '')
            + '"><i class="fa-solid ' + config.icon + '"></i> ' + escapeHtml(config.label) + '</button>';
    });
    holder.innerHTML = html || '<span style="color:var(--text-muted);font-size:13px;">Your role cannot issue certificates.</span>';

    holder.querySelectorAll('.cert-type-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
            certActiveType = btn.dataset.type;
            renderCertTypeTabs(role);
            renderCertFields();
            loadSourceRecords();
            showLastCertificateNumber();
        });
    });

    // If the default type is not available to this role, fall back to the first one that is.
    var allowed = Object.keys(CERTIFICATE_TYPES).filter(function(t) { return CERTIFICATE_TYPES[t].roles.indexOf(role) !== -1; });
    if (allowed.length && allowed.indexOf(certActiveType) === -1) {
        certActiveType = allowed[0];
        renderCertTypeTabs(role);
        renderCertFields();
    }
}

// ----------------------------------------------------------
// DYNAMIC FORM
// ----------------------------------------------------------
function renderCertFields(values) {
    values = values || {};
    var container = document.getElementById('certFieldsContainer');
    if (!container) return;
    var fields = CERT_FIELDS[certActiveType] || [];

    container.innerHTML = fields.map(function(field) {
        var id = 'certField_' + field.key;
        var value = values[field.key] === undefined || values[field.key] === null ? '' : String(values[field.key]);
        var control;
        if (field.type === 'select') {
            control = '<select id="' + id + '"' + (field.required ? ' required' : '') + '>'
                + field.options.map(function(option) {
                    return '<option value="' + escapeHtml(option) + '"' + (option === value ? ' selected' : '') + '>'
                        + escapeHtml(option || '— none —') + '</option>';
                }).join('')
                + '</select>';
        } else {
            control = '<input type="' + field.type + '" id="' + id + '" value="' + escapeHtml(value) + '"'
                + (field.step ? ' step="' + field.step + '"' : '')
                + (field.required ? ' required' : '') + '>';
        }
        return '<div class="form-group' + (field.full ? ' full-width' : '') + '">'
            + '<label>' + escapeHtml(field.label) + (field.required ? ' <span style="color:#dc2626;">*</span>' : '') + '</label>'
            + control + '</div>';
    }).join('');

    // Sensible defaults for the date fields on the clinical certificates.
    if (certActiveType === 'medical' || certActiveType === 'fitness') {
        var examined = document.getElementById('certField_examinedOn');
        if (examined && !examined.value) examined.value = todayIso();
        var restFrom = document.getElementById('certField_restFrom');
        if (restFrom && !restFrom.value) restFrom.value = todayIso();
        var fitFrom = document.getElementById('certField_fitFrom');
        if (fitFrom && !fitFrom.value) fitFrom.value = todayIso();
    }
}

function collectCertFields() {
    var data = {};
    (CERT_FIELDS[certActiveType] || []).forEach(function(field) {
        var element = document.getElementById('certField_' + field.key);
        if (!element) return;
        var value = element.value.trim();
        data[field.key] = field.type === 'number' && value !== '' ? Number(value) : value;
    });

    // Derived values the PDF prints but nobody should have to type.
    if (certActiveType === 'medical' && data.restFrom && data.restTo) {
        data.restDays = daysBetween(data.restFrom, data.restTo);
    }
    if (data.gender) {
        data.salutation = data.gender === 'Male' ? 'Sri.' : 'Smt.';
        data.pronoun = data.gender === 'Male' ? 'he' : 'she';
    }
    return data;
}

// ----------------------------------------------------------
// PATIENT PICKER
// ----------------------------------------------------------
function searchCertPatients(term) {
    var results = document.getElementById('certPatientResults');
    if (!results) return;
    term = (term || '').trim();
    if (term.length < 2) { results.innerHTML = ''; return; }

    var lower = term.toLowerCase();
    Promise.all([
        db.collection('patients').orderBy('nameLower').startAt(lower).endAt(lower + '').limit(8).get(),
        db.collection('patients').where('phone', '==', term).limit(5).get(),
        db.collection('patients').where('patientId', '==', term.toUpperCase()).limit(5).get()
    ]).then(function(snapshots) {
        var seen = {};
        var matches = [];
        snapshots.forEach(function(snapshot) {
            snapshot.forEach(function(doc) {
                if (seen[doc.id]) return;
                seen[doc.id] = true;
                matches.push(Object.assign({ docId: doc.id }, doc.data()));
            });
        });

        results.innerHTML = matches.length
            ? matches.map(function(patient) {
                return '<div class="cert-patient-hit" data-doc="' + patient.docId + '" style="padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;margin-top:4px;cursor:pointer;font-size:13px;">'
                    + '<strong>' + escapeHtml(patient.name || '') + '</strong> · ' + escapeHtml(patient.patientId || '')
                    + ' · ' + escapeHtml(patient.phone || '') + '</div>';
            }).join('')
            : '<div style="padding:8px;color:var(--text-muted);font-size:13px;">No matching patient.</div>';

        results.querySelectorAll('.cert-patient-hit').forEach(function(row) {
            row.addEventListener('click', function() {
                var patient = matches.find(function(p) { return p.docId === row.dataset.doc; });
                selectCertPatient(patient);
            });
        });
    }).catch(function(err) {
        console.error('Patient search failed:', err);
        results.innerHTML = '<div style="padding:8px;color:#dc2626;font-size:13px;">Search failed: ' + escapeHtml(err.message) + '</div>';
    });
}

function selectCertPatient(patient) {
    if (!patient) return;
    certSelectedPatient = patient;
    document.getElementById('certPatientResults').innerHTML = '';
    document.getElementById('certPatientSearch').value = patient.name || '';
    var box = document.getElementById('certSelectedPatient');
    box.style.display = 'block';
    box.innerHTML = '<strong>' + escapeHtml(patient.name || '') + '</strong> · ' + escapeHtml(patient.patientId || '')
        + ' · ' + escapeHtml(patient.phone || '')
        + (patient.dob ? ' · ' + escapeHtml(calculateAge(patient.dob)) + ' yrs' : '');

    // Prefill what we already know about this person.
    var prefill = {};
    if (certActiveType === 'medical' || certActiveType === 'fitness') {
        prefill.age = patient.dob ? calculateAge(patient.dob) : (patient.age || '');
        prefill.gender = patient.gender || '';
        prefill.examinedOn = todayIso();
    }
    if (certActiveType === 'birth') {
        prefill.address = patient.address || '';
        prefill.motherAge = patient.dob ? calculateAge(patient.dob) : (patient.age || '');
        prefill.hospitalRecordNo = patient.patientId || '';
    }
    if (certActiveType === 'delivery') {
        prefill.motherAge = patient.dob ? calculateAge(patient.dob) : (patient.age || '');
    }
    renderCertFields(prefill);
    loadSourceRecords();
}

// ----------------------------------------------------------
// SOURCE RECORDS (birth → newborn, delivery → delivery record)
// ----------------------------------------------------------
function loadSourceRecords() {
    var group = document.getElementById('certSourceGroup');
    var select = document.getElementById('certSourceSelect');
    var label = document.getElementById('certSourceLabel');
    if (!group || !select) return;

    if (!certSelectedPatient || (certActiveType !== 'birth' && certActiveType !== 'delivery')) {
        group.style.display = 'none';
        select.innerHTML = '';
        return;
    }

    var patientId = certSelectedPatient.patientId;
    var query = certActiveType === 'birth'
        ? db.collection('babies').where('motherPatientId', '==', patientId)
        : db.collection('deliveries').where('patientId', '==', patientId);

    label.textContent = certActiveType === 'birth' ? 'Newborn record' : 'Delivery record';

    query.get().then(function(snapshot) {
        if (snapshot.empty) {
            group.style.display = 'block';
            select.innerHTML = '<option value="">No recorded ' + (certActiveType === 'birth' ? 'newborn' : 'delivery') + ' — fill the form manually</option>';
            return;
        }
        var options = ['<option value="">— fill manually —</option>'];
        snapshot.forEach(function(doc) {
            var record = doc.data();
            var text = certActiveType === 'birth'
                ? (record.babyGender || 'Baby') + ' · ' + (record.birthWeight || '—') + ' kg · ' + (record.timeOfBirth || '')
                : (record.deliveryDate || '') + ' · ' + (record.deliveryType || '');
            options.push('<option value="' + doc.id + '">' + escapeHtml(text) + '</option>');
        });
        select.innerHTML = options.join('');
        group.style.display = 'block';
    }).catch(function(err) {
        console.error('Source record lookup failed:', err);
        group.style.display = 'none';
    });
}

function applySourceRecord(docId) {
    if (!docId) return;
    var loader = certActiveType === 'birth' ? prefillBirthCertificate : prefillDeliveryCertificate;
    loader(docId).then(function(result) {
        if (result.patient && result.patient.patientId) {
            certSelectedPatient = Object.assign({}, certSelectedPatient, result.patient);
            var box = document.getElementById('certSelectedPatient');
            box.style.display = 'block';
            box.innerHTML = '<strong>' + escapeHtml(certSelectedPatient.name || '') + '</strong> · '
                + escapeHtml(certSelectedPatient.patientId || '');
            document.getElementById('certPatientSearch').value = certSelectedPatient.name || '';
        }
        renderCertFields(result.data);
        showToast('Form filled from the hospital record.', 'success');
    }).catch(function(err) {
        showToast('Could not load that record: ' + err.message, 'error');
    });
}

// Reminds the clerk where the register got to, without filling the
// field in for them — the number has to match the physical book.
function showLastCertificateNumber() {
    var hint = document.getElementById('certLastNumberHint');
    if (!hint) return;
    lastCertificateNumber(certActiveType).then(function(last) {
        var label = (CERTIFICATE_TYPES[certActiveType] || {}).label || 'certificate';
        hint.textContent = last
            ? 'Last ' + label.toLowerCase() + ' issued: ' + last + '. The next number is generated automatically.'
            : 'No ' + label.toLowerCase() + ' issued yet. The next number is generated automatically.';
    });
}
window.showLastCertificateNumber = showLastCertificateNumber;

// ----------------------------------------------------------
// REGISTER
// ----------------------------------------------------------
function renderCertRegister() {
    var body = document.getElementById('certRegisterBody');
    if (!body) return;
    var typeFilter = document.getElementById('certFilterType').value;
    var term = (document.getElementById('certRegisterSearch').value || '').trim().toLowerCase();

    var rows = certRegisterRows.filter(function(row) {
        if (typeFilter && row.certificateType !== typeFilter) return false;
        if (!term) return true;
        return (row.certificateNo || '').toLowerCase().indexOf(term) !== -1
            || (row.patientName || '').toLowerCase().indexOf(term) !== -1
            || (row.patientId || '').toLowerCase().indexOf(term) !== -1;
    });

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#888;">No certificates match.</td></tr>';
        return;
    }

    body.innerHTML = rows.map(function(row) {
        var config = CERTIFICATE_TYPES[row.certificateType] || { label: row.certificateType };
        var cancelled = row.status === 'cancelled';
        return '<tr>'
            + '<td><strong>' + escapeHtml(row.certificateNo || '') + '</strong></td>'
            + '<td>' + escapeHtml(config.label) + '</td>'
            + '<td>' + escapeHtml(row.patientName || '') + '<br><small style="color:var(--text-muted);">' + escapeHtml(row.patientId || '') + '</small></td>'
            + '<td>' + escapeHtml(row.issuedByName || row.recordedBy || '') + '</td>'
            + '<td>' + escapeHtml(formatDate(row.createdAt)) + '</td>'
            + '<td><span class="status-badge" style="background:' + (cancelled ? '#fef2f2;color:#dc2626' : '#ecfdf5;color:#047857') + ';">'
            + (cancelled ? 'Cancelled' : 'Issued') + '</span></td>'
            + '<td style="white-space:nowrap;">'
            + '<button class="btn-secondary cert-reprint" data-id="' + row.id + '" style="padding:4px 10px;font-size:12px;"><i class="fa-solid fa-print"></i> Reprint</button>'
            + (cancelled ? '' : ' <button class="btn-secondary cert-cancel" data-id="' + row.id + '" data-no="' + escapeHtml(row.certificateNo || '') + '" style="padding:4px 10px;font-size:12px;color:#dc2626;border-color:#fecaca;"><i class="fa-solid fa-ban"></i> Cancel</button>')
            + '</td></tr>';
    }).join('');

    body.querySelectorAll('.cert-reprint').forEach(function(btn) {
        btn.addEventListener('click', function() { reprintCertificate(btn.dataset.id); });
    });
    body.querySelectorAll('.cert-cancel').forEach(function(btn) {
        btn.addEventListener('click', function() { cancelCertificate(btn.dataset.id, btn.dataset.no); });
    });
}

function loadCertificateRegister() {
    if (certRegisterUnsub) certRegisterUnsub();
    certRegisterUnsub = db.collection('certificates').orderBy('createdAt', 'desc').limit(300)
        .onSnapshot(function(snapshot) {
            certRegisterRows = [];
            snapshot.forEach(function(doc) { certRegisterRows.push(Object.assign({ id: doc.id }, doc.data())); });
            renderCertRegister();
        }, function(err) {
            console.error('Certificate register error:', err);
            document.getElementById('certRegisterBody').innerHTML =
                '<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">Could not load the register: ' + escapeHtml(err.message) + '</td></tr>';
        });
}
window.loadCertificateRegister = loadCertificateRegister;

// ----------------------------------------------------------
// BOOT
// ----------------------------------------------------------
getCurrentUser(function(user) {
    if (!checkPageAccess(user)) return;
    var role = (user.role || '').toLowerCase();

    renderCertTypeTabs(role);
    renderCertFields();
    loadCertificateRegister();

    document.getElementById('certPatientSearch').addEventListener('input', debounce(function(event) {
        searchCertPatients(event.target.value);
    }, 300));

    document.getElementById('certSourceSelect').addEventListener('change', function(event) {
        applySourceRecord(event.target.value);
    });

    document.getElementById('certFilterType').addEventListener('change', renderCertRegister);
    document.getElementById('certRegisterSearch').addEventListener('input', debounce(renderCertRegister, 200));

    document.getElementById('certExportBtn').addEventListener('click', function() {
        exportToCSV(certRegisterRows.map(function(row) {
            return {
                CertificateNo: row.certificateNo || '',
                Type: (CERTIFICATE_TYPES[row.certificateType] || {}).label || row.certificateType,
                PatientId: row.patientId || '',
                PatientName: row.patientName || '',
                IssuedBy: row.issuedByName || row.recordedBy || '',
                IssuedOn: formatDate(row.createdAt),
                Status: row.status || ''
            };
        }), 'certificate-register');
    });

    showLastCertificateNumber();

    document.getElementById('certResetBtn').addEventListener('click', function() {
        certSelectedPatient = null;
        if (typeof certificateRequestId !== 'undefined') certificateRequestId = '';
        document.getElementById('certNumberInput').value = '';
        document.getElementById('certPatientSearch').value = '';
        document.getElementById('certPatientResults').innerHTML = '';
        document.getElementById('certSelectedPatient').style.display = 'none';
        document.getElementById('certSourceGroup').style.display = 'none';
        renderCertFields();
    });

    // Deep link from the patient profile:
    //   certificates.html?type=birth&source=<babyDocId>
    //   certificates.html?type=medical&patient=<patientDocId>
    var params = new URLSearchParams(window.location.search);
    var linkedType = params.get('type');
    if (linkedType && CERT_FIELDS[linkedType] && CERTIFICATE_TYPES[linkedType].roles.indexOf(role) !== -1) {
        certActiveType = linkedType;
        renderCertTypeTabs(role);
        renderCertFields();
    }
    var linkedPatient = params.get('patient');
    if (linkedPatient) {
        db.collection('patients').doc(linkedPatient).get().then(function(doc) {
            if (doc.exists) selectCertPatient(Object.assign({ docId: doc.id }, doc.data()));
        });
    }
    var linkedSource = params.get('source');
    if (linkedSource) applySourceRecord(linkedSource);

    document.getElementById('certIssueForm').addEventListener('submit', function(event) {
        event.preventDefault();
        if (!certSelectedPatient) { showToast('Select a patient first.', 'warning'); return; }

        var data = collectCertFields();
        if (certActiveType === 'medical' && data.restFrom && data.restTo && data.restTo < data.restFrom) {
            showToast('The rest period ends before it begins.', 'error');
            return;
        }
        if (certActiveType === 'fitness' && data.fitFrom && data.validUntil && data.validUntil < data.fitFrom) {
            showToast('The validity date is before the effective date.', 'error');
            return;
        }

        var certificateNo = '';

        var button = document.getElementById('certIssueBtn');
        button.disabled = true;
        issueCertificate(certActiveType, certSelectedPatient, data, certificateNo)
            .then(function() {
                document.getElementById('certResetBtn').click();
                showLastCertificateNumber();
            })
            .catch(function() { /* issueCertificate already reported the reason */ })
            .then(function() { button.disabled = false; });
    });
});
