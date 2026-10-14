// ==========================================================
// PACS / DICOM (Orthanc)
//
// Radiology images belong in a PACS, not in Firebase Storage:
// a DICOM study is a multi-slice series that needs a real
// viewer with window/level, measurement and series navigation.
// The HMS therefore stores only the identifiers — accession
// number and Study Instance UID — and links out to the viewer.
//
// hospitalSettings/main.integrations.orthanc:
//   enabled     false until the PACS is reachable
//   viewerUrl   link template, e.g.
//               https://pacs.hospital.local/ohif/viewer?StudyInstanceUIDs={studyUID}
//               or  https://pacs.hospital.local/osimis-viewer/app/index.html?study={studyUID}
//   lookupUrl   optional template keyed on accession when the
//               study UID is not known yet, e.g.
//               https://pacs.hospital.local/ohif/viewer?AccessionNumber={accession}
//   aeTitle     the modality worklist AE title, shown on the request slip
// ==========================================================

var _pacsConfigPromise = null;

function getPacsConfig(forceRefresh) {
    if (!_pacsConfigPromise || forceRefresh) {
        _pacsConfigPromise = db.collection('hospitalSettings').doc('main').get()
            .then(function(doc) {
                var config = (doc.exists && doc.data().integrations && doc.data().integrations.orthanc) || {};
                return {
                    enabled: config.enabled === true,
                    viewerUrl: String(config.viewerUrl || ''),
                    lookupUrl: String(config.lookupUrl || ''),
                    aeTitle: String(config.aeTitle || '')
                };
            })
            .catch(function() { return { enabled: false, viewerUrl: '', lookupUrl: '', aeTitle: '' }; });
    }
    return _pacsConfigPromise;
}
window.getPacsConfig = getPacsConfig;

// Accession numbers are what tie an HMS order to the images the
// modality produces, so one is minted when the study is ordered.
function generateAccessionNumber(imagingType) {
    var year = new Date().getFullYear();
    var counterRef = db.collection('counters').doc('accession-' + year);
    return db.runTransaction(function(tx) {
        return tx.get(counterRef).then(function(doc) {
            var next = (doc.exists ? Number(doc.data().count || 0) : 0) + 1;
            tx.set(counterRef, { count: next, year: year, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            var code = String(imagingType || 'IMG').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'IM';
            return 'JYO' + code + year + String(next).padStart(5, '0');
        });
    });
}
window.generateAccessionNumber = generateAccessionNumber;

function fillTemplate(template, values) {
    return String(template || '').replace(/\{(\w+)\}/g, function(match, key) {
        return values[key] === undefined || values[key] === null ? '' : encodeURIComponent(values[key]);
    });
}

// Returns the viewer URL for a report, or '' when the study cannot be located.
function pacsStudyUrl(report, config) {
    if (!config || !config.enabled) return '';
    var values = {
        studyUID: report.studyInstanceUID || '',
        accession: report.accessionNumber || '',
        patientId: report.patientId || ''
    };
    if (values.studyUID && config.viewerUrl) return fillTemplate(config.viewerUrl, values);
    if (values.accession && config.lookupUrl) return fillTemplate(config.lookupUrl, values);
    return '';
}
window.pacsStudyUrl = pacsStudyUrl;

function openPacsStudy(reportId) {
    Promise.all([
        db.collection('reports').doc(reportId).get(),
        getPacsConfig()
    ]).then(function(result) {
        var doc = result[0];
        var config = result[1];
        if (!doc.exists) { showToast('Report not found.', 'error'); return; }
        if (!config.enabled) { showToast('The PACS link is configured but currently switched off.', 'warning'); return; }

        var url = pacsStudyUrl(doc.data(), config);
        if (!url) {
            showToast('This study has no Study UID or accession number recorded yet.', 'warning');
            return;
        }
        // noopener so the viewer cannot reach back into the HMS window.
        window.open(url, '_blank', 'noopener');
    }).catch(function(err) {
        showToast('Could not open the study: ' + err.message, 'error');
    });
}
window.openPacsStudy = openPacsStudy;

// Renders the "Open in PACS" button for a report row. Returns '' when
// the integration is off, so the button never appears half-working.
function pacsButtonHtml(report, config) {
    if (!pacsStudyUrl(report, config)) return '';
    return '<button onclick="openPacsStudy(\'' + report.id + '\')" class="btn-primary" '
        + 'style="padding:4px 8px;font-size:0.8rem;background:#6d28d9;border-color:#6d28d9;cursor:pointer;" '
        + 'title="Open the DICOM study in the PACS viewer">'
        + '<i class="fa-solid fa-x-ray"></i> PACS</button>';
}
window.pacsButtonHtml = pacsButtonHtml;

// Shows the PACS fields on the upload form only when the integration is on.
document.addEventListener('DOMContentLoaded', function() {
    var section = document.getElementById('pacsFieldsSection');
    if (!section) return;
    getPacsConfig().then(function(config) {
        section.style.display = config.enabled ? 'block' : 'none';
        var aeTitle = document.getElementById('pacsAeTitleHint');
        if (aeTitle && config.aeTitle) {
            aeTitle.textContent = 'Modality worklist AE title: ' + config.aeTitle;
        }
    });
});
