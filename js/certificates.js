// ==========================================================
// CERTIFICATES — birth, delivery, medical (rest) and fitness
//
// Every certificate is allocated a serial number from a yearly
// counter and stored in the `certificates` collection before the
// PDF is produced. A reprint always rebuilds the PDF from the
// stored record, so a reprinted copy is identical to the one the
// patient was originally handed. Certificates are never edited;
// a wrong one is cancelled and a fresh one issued.
// ==========================================================

var CERTIFICATE_TYPES = {
    birth: {
        label: 'Birth Certificate',
        title: 'CERTIFICATE OF BIRTH',
        prefix: 'BC',
        icon: 'fa-baby',
        accent: [214, 51, 108],
        roles: ['admin', 'doctor', 'nurse', 'receptionist']
    },
    delivery: {
        label: 'Delivery Certificate',
        title: 'CERTIFICATE OF DELIVERY',
        prefix: 'DC',
        icon: 'fa-hospital-user',
        accent: [214, 51, 108],
        roles: ['admin', 'doctor', 'nurse']
    },
    medical: {
        label: 'Medical Certificate',
        title: 'MEDICAL CERTIFICATE',
        prefix: 'MC',
        icon: 'fa-file-medical',
        accent: [15, 43, 91],
        roles: ['admin', 'doctor']
    },
    fitness: {
        label: 'Fitness Certificate',
        title: 'CERTIFICATE OF FITNESS',
        prefix: 'FC',
        icon: 'fa-heart-pulse',
        accent: [13, 122, 112],
        roles: ['admin', 'doctor']
    }
};
window.CERTIFICATE_TYPES = CERTIFICATE_TYPES;

// ----------------------------------------------------------
// CERTIFICATE NUMBERS — allocated atomically by the server.
// ----------------------------------------------------------
function lastCertificateNumber(type) {
    return db.collection('certificates')
        .where('certificateType', '==', type)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
        .then(function(snapshot) {
            return snapshot.empty ? '' : (snapshot.docs[0].data().certificateNo || '');
        })
        .catch(function() { return ''; });
}
window.lastCertificateNumber = lastCertificateNumber;

// Resolves true when the number is already in the register.
function certificateNumberExists(certificateNo) {
    return db.collection('certificates')
        .where('certificateNo', '==', certificateNo)
        .limit(1)
        .get()
        .then(function(snapshot) { return !snapshot.empty; });
}
window.certificateNumberExists = certificateNumberExists;

// ----------------------------------------------------------
// SHARED PDF FURNITURE
// ----------------------------------------------------------
function certificateHeader(doc, settings, config, certificateNo) {
    var width = doc.internal.pageSize.getWidth();

    // Ruled border, so a photocopy is visibly a copy of a formal document.
    doc.setDrawColor(config.accent[0], config.accent[1], config.accent[2]);
    doc.setLineWidth(1.2);
    doc.rect(8, 8, width - 16, doc.internal.pageSize.getHeight() - 16);
    doc.setLineWidth(0.3);
    doc.rect(11, 11, width - 22, doc.internal.pageSize.getHeight() - 22);

    doc.setTextColor(config.accent[0], config.accent[1], config.accent[2]);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(18);
    doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', width / 2, 24, { align: 'center' });

    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(70, 70, 70);
    doc.text(settings.address || '', width / 2, 30, { align: 'center' });
    doc.text('Phone: ' + (settings.phone || '') + '   |   Email: ' + (settings.email || ''), width / 2, 35, { align: 'center' });
    if (settings.registrationNo) {
        doc.text('Hospital Registration No: ' + settings.registrationNo, width / 2, 40, { align: 'center' });
    }

    doc.setDrawColor(config.accent[0], config.accent[1], config.accent[2]);
    doc.setLineWidth(0.6);
    doc.line(20, 44, width - 20, 44);

    doc.setFont(undefined, 'bold');
    doc.setFontSize(15);
    doc.setTextColor(config.accent[0], config.accent[1], config.accent[2]);
    doc.text(config.title, width / 2, 54, { align: 'center' });

    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text('Certificate No: ' + certificateNo, 20, 62);
    doc.text('Date of issue: ' + formatDate(new Date()), width - 20, 62, { align: 'right' });

    return 72;
}

// Two-column label/value rows inside a tinted panel.
function certificateFieldBlock(doc, y, rows, accent) {
    var width = doc.internal.pageSize.getWidth();
    var lineHeight = 8;
    var height = Math.ceil(rows.length / 2) * lineHeight + 6;

    doc.setFillColor(250, 250, 252);
    doc.rect(20, y, width - 40, height, 'F');

    doc.setFontSize(10);
    rows.forEach(function(row, index) {
        var column = index % 2;
        var line = Math.floor(index / 2);
        var x = column === 0 ? 24 : width / 2 + 2;
        var rowY = y + 6 + line * lineHeight;
        doc.setFont(undefined, 'bold');
        doc.setTextColor(accent[0], accent[1], accent[2]);
        doc.text(row[0] + ':', x, rowY);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(45, 45, 45);
        doc.text(String(row[1] === null || row[1] === undefined || row[1] === '' ? '—' : row[1]), x + 42, rowY, {
            maxWidth: (width / 2) - 48
        });
    });

    return y + height + 8;
}

function certificateParagraph(doc, y, text) {
    var width = doc.internal.pageSize.getWidth();
    doc.setFont(undefined, 'normal');
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    var lines = doc.splitTextToSize(text, width - 44);
    doc.text(lines, 22, y);
    return y + lines.length * 6 + 4;
}

function certificateFooter(doc, record, settings) {
    var width = doc.internal.pageSize.getWidth();
    var height = doc.internal.pageSize.getHeight();
    var signatureY = height - 48;

    doc.setDrawColor(140, 140, 140);
    doc.setLineWidth(0.3);
    doc.line(width - 90, signatureY, width - 22, signatureY);

    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    doc.setFont(undefined, 'bold');
    doc.text(record.issuedByName || '', width - 56, signatureY + 5, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setTextColor(110, 110, 110);
    doc.text(record.issuedByQualification || 'Medical Officer', width - 56, signatureY + 10, { align: 'center' });
    if (record.issuedByRegistration) {
        doc.text('Reg. No: ' + record.issuedByRegistration, width - 56, signatureY + 15, { align: 'center' });
    }
    doc.text('Signature & Hospital Seal', width - 56, signatureY + 21, { align: 'center' });

    doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 130);
    doc.setFont(undefined, 'italic');
    doc.text(
        'This certificate is issued on the basis of hospital records. It is not a substitute for the statutory birth '
        + 'certificate issued by the Registrar of Births & Deaths.',
        width / 2, height - 22, { align: 'center', maxWidth: width - 44 }
    );
    doc.text('Issued by ' + (record.recordedBy || '') + ' · ' + formatDateTime(new Date()), width / 2, height - 16, { align: 'center' });
}

// ----------------------------------------------------------
// PDF BUILDERS — one per certificate type, all fed from the
// stored record so reprints are byte-for-byte equivalent.
// ----------------------------------------------------------
function buildCertificatePDF(record, settings) {
    var config = CERTIFICATE_TYPES[record.certificateType];
    if (!config) { showToast('Unknown certificate type.', 'error'); return; }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var data = record.data || {};
    var y = certificateHeader(doc, settings, config, record.certificateNo);

    if (record.certificateType === 'birth') {
        y = certificateParagraph(doc, y,
            'This is to certify that a ' + (data.babyGender || 'child').toLowerCase()
            + ' child was born alive at this hospital as recorded below.');
        y = certificateFieldBlock(doc, y, [
            ['Name of child', data.babyName || 'Baby of ' + (record.patientName || '')],
            ['Sex', data.babyGender || ''],
            ['Date of birth', formatDate(data.dateOfBirth)],
            ['Time of birth', data.timeOfBirth || ''],
            ['Place of birth', data.placeOfBirth || settings.hospitalName || ''],
            ['Birth weight', data.birthWeight ? data.birthWeight + ' kg' : ''],
            ['Mother’s name', record.patientName || ''],
            ['Mother’s age', data.motherAge ? data.motherAge + ' years' : ''],
            ['Father’s name', data.fatherName || ''],
            ['Type of delivery', data.deliveryType || ''],
            ['Gestation at birth', data.gestationalWeeks ? data.gestationalWeeks + ' weeks' : ''],
            ['Attended by', data.conductedBy || ''],
            ['Permanent address', data.address || ''],
            ['Informant', data.informantName || '']
        ], config.accent);
        y = certificateParagraph(doc, y,
            'Hospital record reference: ' + (data.hospitalRecordNo || record.patientId || '')
            + '. The particulars above have been verified against the labour room register and the newborn record.');

    } else if (record.certificateType === 'delivery') {
        y = certificateParagraph(doc, y,
            'This is to certify that Smt. ' + (record.patientName || '')
            + ' was admitted to this hospital and delivered under medical supervision as detailed below.');
        y = certificateFieldBlock(doc, y, [
            ['Patient name', record.patientName || ''],
            ['Patient ID', record.patientId || ''],
            ['Age', data.motherAge ? data.motherAge + ' years' : ''],
            ['Husband / Guardian', data.fatherName || ''],
            ['Date of admission', formatDate(data.admissionDate)],
            ['Date of delivery', formatDate(data.deliveryDate)],
            ['Time of delivery', data.deliveryTime || ''],
            ['Type of delivery', data.deliveryType || ''],
            ['Gestational age', data.gestationalWeeks ? data.gestationalWeeks + ' weeks' : ''],
            ['Outcome', data.outcome || ''],
            ['Baby sex / weight', (data.babyGender || '') + (data.birthWeight ? ' / ' + data.birthWeight + ' kg' : '')],
            ['Conducted by', data.conductedBy || ''],
            ['Complications', data.complications || 'Nil'],
            ['Condition on discharge', data.motherCondition || 'Stable']
        ], config.accent);
        if (data.remarks) y = certificateParagraph(doc, y, 'Remarks: ' + data.remarks);

    } else if (record.certificateType === 'medical') {
        y = certificateParagraph(doc, y,
            'This is to certify that I have examined ' + (data.salutation || 'Smt./Sri.') + ' ' + (record.patientName || '')
            + ', aged ' + (data.age || '—') + ' years, and that ' + (data.pronoun || 'the patient')
            + ' is suffering from the condition stated below and requires rest for the period specified.');
        y = certificateFieldBlock(doc, y, [
            ['Patient name', record.patientName || ''],
            ['Patient ID', record.patientId || ''],
            ['Age / Sex', (data.age || '—') + ' / ' + (data.gender || '—')],
            ['Date examined', formatDate(data.examinedOn)],
            ['Diagnosis', data.diagnosis || ''],
            ['Treatment given', data.treatment || ''],
            ['Rest advised from', formatDate(data.restFrom)],
            ['Rest advised to', formatDate(data.restTo)],
            ['Total days of rest', data.restDays || ''],
            ['Fit to resume duty on', formatDate(data.resumeOn)]
        ], config.accent);
        if (data.remarks) y = certificateParagraph(doc, y, 'Remarks: ' + data.remarks);
        y = certificateParagraph(doc, y,
            'This certificate is issued at the request of the patient for the purpose of '
            + (data.purpose || 'leave of absence') + '.');

    } else if (record.certificateType === 'fitness') {
        y = certificateParagraph(doc, y,
            'This is to certify that I have examined ' + (data.salutation || 'Smt./Sri.') + ' ' + (record.patientName || '')
            + ', aged ' + (data.age || '—') + ' years, on ' + formatDate(data.examinedOn)
            + ' and found ' + (data.pronoun || 'the patient') + ' medically fit as recorded below.');
        y = certificateFieldBlock(doc, y, [
            ['Patient name', record.patientName || ''],
            ['Patient ID', record.patientId || ''],
            ['Age / Sex', (data.age || '—') + ' / ' + (data.gender || '—')],
            ['Date examined', formatDate(data.examinedOn)],
            ['Blood pressure', data.bp || ''],
            ['Pulse', data.pulse || ''],
            ['Height / Weight', (data.height || '—') + ' / ' + (data.weight || '—')],
            ['Vision', data.vision || ''],
            ['General condition', data.generalCondition || 'Satisfactory'],
            ['Fit for', data.fitFor || 'Normal duties'],
            ['Fit with effect from', formatDate(data.fitFrom)],
            ['Valid until', formatDate(data.validUntil)]
        ], config.accent);
        if (data.restrictions) y = certificateParagraph(doc, y, 'Restrictions / advice: ' + data.restrictions);
        y = certificateParagraph(doc, y,
            'This certificate is issued at the request of the person examined for the purpose of '
            + (data.purpose || 'employment') + '.');
    }

    if (record.status === 'cancelled') {
        doc.setTextColor(220, 38, 38);
        doc.setFontSize(48);
        doc.setFont(undefined, 'bold');
        doc.text('CANCELLED', doc.internal.pageSize.getWidth() / 2, 160, { align: 'center', angle: 30 });
    }

    certificateFooter(doc, record, settings);
    savePDFHelper(doc, config.label.replace(/\s+/g, '-') + '-' + String(record.certificateNo || '').replace(/\//g, '-'));
}
window.buildCertificatePDF = buildCertificatePDF;

// ----------------------------------------------------------
// ISSUE & REPRINT
// ----------------------------------------------------------

var certificateRequestId = '';
function issueCertificate(type, patient, data) {
    if (!patient || !(patient.docId || patient.id)) return Promise.reject(new Error('Select a patient.'));
    if (!certificateRequestId) certificateRequestId = 'CERT-' + db.collection('certificates').doc().id;
    return callFunction('issueHospitalCertificate', { type: type, patientDocId: patient.docId || patient.id, data: data || {}, requestId: certificateRequestId })
        .then(function(result) {
            certificateRequestId = '';
            return db.collection('certificates').doc(result.id).get();
        }).then(function(snapshot) {
            var record = snapshot.data();
            showToast('Certificate ' + record.certificateNo + ' issued.', 'success');
            return db.collection('hospitalSettings').doc('main').get().then(function(settings) {
                try { buildCertificatePDF(record, settings.exists ? settings.data() : {}); }
                catch (error) { showToast('Certificate saved. Use Reprint in the register to download it.', 'warning'); }
                return Object.assign({ id: snapshot.id }, record);
            });
        }).catch(function(error) { showToast('Could not issue certificate: ' + error.message, 'error'); throw error; });
}
window.issueCertificate = issueCertificate;

function reprintCertificate(docId) {
    db.collection('certificates').doc(docId).get().then(function(doc) {
        if (!doc.exists) { showToast('Certificate record not found.', 'error'); return; }
        var record = doc.data();
        return db.collection('hospitalSettings').doc('main').get().then(function(settingsDoc) {
            buildCertificatePDF(record, settingsDoc.exists ? settingsDoc.data() : {});
        });
    }).catch(function(err) {
        showToast('Could not reprint certificate: ' + err.message, 'error');
    });
}
window.reprintCertificate = reprintCertificate;

function cancelCertificate(docId, certificateNo) {
    confirmAction(
        'Cancel certificate ' + certificateNo + '?',
        'A cancelled certificate stays in the register and every future reprint is stamped CANCELLED. This cannot be undone.',
        function() {
            var reason = window.prompt('Reason for cancellation (recorded in the register):', '');
            if (reason === null) return;
            getCurrentUser(function(user) {
                db.collection('certificates').doc(docId).update({
                    status: 'cancelled',
                    cancelReason: (reason || '').slice(0, 300),
                    cancelledBy: user.email || '',
                    cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function() {
                    showToast('Certificate ' + certificateNo + ' cancelled.', 'success');
                    if (typeof loadCertificateRegister === 'function') loadCertificateRegister();
                }).catch(function(err) {
                    showToast('Could not cancel certificate: ' + err.message, 'error');
                });
            });
        },
        'Cancel certificate'
    );
}
window.cancelCertificate = cancelCertificate;

// ----------------------------------------------------------
// PREFILL HELPERS — pull whatever the hospital already knows so
// the clerk types as little as possible.
// ----------------------------------------------------------
function prefillBirthCertificate(babyDocId) {
    return db.collection('babies').doc(babyDocId).get().then(function(babyDoc) {
        if (!babyDoc.exists) throw new Error('Newborn record not found.');
        var baby = babyDoc.data();
        var deliveryPromise = baby.deliveryId
            ? db.collection('deliveries').doc(baby.deliveryId).get()
            : Promise.resolve(null);
        var motherPromise = db.collection('patients').where('patientId', '==', baby.motherPatientId).limit(1).get();
        return Promise.all([baby, deliveryPromise, motherPromise]);
    }).then(function(result) {
        var baby = result[0];
        var delivery = result[1] && result[1].exists ? result[1].data() : {};
        var mother = result[2].empty ? {} : Object.assign({ docId: result[2].docs[0].id }, result[2].docs[0].data());
        return {
            patient: { patientId: baby.motherPatientId, name: baby.motherName || mother.name || '', docId: mother.docId || '' },
            data: {
                babyDocId: babyDocId,
                babyName: '',
                babyGender: baby.babyGender || '',
                birthWeight: baby.birthWeight || '',
                dateOfBirth: delivery.deliveryDate || '',
                timeOfBirth: baby.timeOfBirth || delivery.deliveryTime || '',
                deliveryType: delivery.deliveryType || '',
                gestationalWeeks: delivery.gestationalWeeksAtDelivery || '',
                conductedBy: delivery.conductedBy || '',
                placeOfDelivery: delivery.placeOfDelivery || '',
                motherAge: mother.age || (mother.dob ? calculateAge(mother.dob) : ''),
                address: mother.address || '',
                hospitalRecordNo: baby.motherPatientId || ''
            }
        };
    });
}
window.prefillBirthCertificate = prefillBirthCertificate;

function prefillDeliveryCertificate(deliveryDocId) {
    return db.collection('deliveries').doc(deliveryDocId).get().then(function(deliveryDoc) {
        if (!deliveryDoc.exists) throw new Error('Delivery record not found.');
        var delivery = deliveryDoc.data();
        return Promise.all([
            delivery,
            db.collection('patients').where('patientId', '==', delivery.patientId).limit(1).get(),
            db.collection('babies').where('deliveryId', '==', deliveryDocId).get()
        ]);
    }).then(function(result) {
        var delivery = result[0];
        var mother = result[1].empty ? {} : Object.assign({ docId: result[1].docs[0].id }, result[1].docs[0].data());
        var babies = [];
        result[2].forEach(function(doc) { babies.push(doc.data()); });
        var first = babies[0] || {};
        return {
            patient: { patientId: delivery.patientId, name: delivery.patientName || mother.name || '', docId: mother.docId || '' },
            data: {
                deliveryDocId: deliveryDocId,
                deliveryDate: delivery.deliveryDate || '',
                deliveryTime: delivery.deliveryTime || '',
                deliveryType: delivery.deliveryType || '',
                gestationalWeeks: delivery.gestationalWeeksAtDelivery || '',
                conductedBy: delivery.conductedBy || '',
                complications: delivery.complications || '',
                motherCondition: delivery.motherCondition || '',
                motherAge: mother.age || (mother.dob ? calculateAge(mother.dob) : ''),
                outcome: babies.length === 1 ? 'Single live birth' : (babies.length > 1 ? babies.length + ' live births' : ''),
                babyGender: first.babyGender || '',
                birthWeight: first.birthWeight || '',
                admissionDate: mother.admissionDate || ''
            }
        };
    });
}
window.prefillDeliveryCertificate = prefillDeliveryCertificate;
