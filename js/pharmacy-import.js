// ==========================================================
// PHARMACY STOCK IMPORT
//
// Brings the medicine master and opening stock across from an
// older pharmacy package. The exports from those packages never
// agree on column names, so the wizard is: upload → map columns
// → preview → import, with an explicit policy for medicines that
// already exist in Firestore.
// ==========================================================

var stockImportRows = null;      // parsed CSV, row 0 is the header
var stockImportPrepared = null;  // rows after mapping and validation

// Every field the import understands. `aliases` drive the automatic
// column matching so a typical export maps itself.
var STOCK_IMPORT_FIELDS = [
    { key: 'medicineName', label: 'Medicine name (required)', required: true, type: 'text',
      aliases: ['medicine', 'medicinename', 'itemname', 'item', 'productname', 'product', 'drugname', 'drug', 'name', 'description'] },
    { key: 'genericName', label: 'Generic / salt name', type: 'text',
      aliases: ['generic', 'genericname', 'salt', 'saltname', 'composition', 'molecule'] },
    { key: 'category', label: 'Category / form', type: 'text',
      aliases: ['category', 'form', 'type', 'dosageform', 'group'] },
    { key: 'manufacturer', label: 'Manufacturer', type: 'text',
      aliases: ['manufacturer', 'company', 'mfr', 'mfg', 'brand', 'supplier'] },
    { key: 'batchNo', label: 'Batch number', type: 'text',
      aliases: ['batch', 'batchno', 'batchnumber', 'lot', 'lotno'] },
    { key: 'stock', label: 'Stock quantity', type: 'integer',
      aliases: ['stock', 'qty', 'quantity', 'closingstock', 'currentstock', 'balance', 'onhand', 'openingstock'] },
    { key: 'unit', label: 'Unit (strip, bottle…)', type: 'text',
      aliases: ['unit', 'uom', 'packing', 'pack', 'unitofmeasure'] },
    { key: 'price', label: 'Selling price', type: 'number',
      aliases: ['price', 'sellingprice', 'saleprice', 'rate', 'sellrate', 'mrp'] },
    { key: 'mrp', label: 'MRP', type: 'number',
      aliases: ['mrp', 'maximumretailprice', 'printedrate'] },
    { key: 'purchasePrice', label: 'Purchase price', type: 'number',
      aliases: ['purchaseprice', 'costprice', 'cost', 'purchaserate', 'ptr'] },
    { key: 'expiryDate', label: 'Expiry date', type: 'date',
      aliases: ['expiry', 'expirydate', 'exp', 'expdate', 'expiredon'] },
    { key: 'reorderLevel', label: 'Reorder level', type: 'integer',
      aliases: ['reorder', 'reorderlevel', 'minstock', 'minimumstock', 'minlevel'] },
    { key: 'hsnCode', label: 'HSN code', type: 'text',
      aliases: ['hsn', 'hsncode', 'hsnsac'] },
    { key: 'rackNo', label: 'Rack / shelf', type: 'text',
      aliases: ['rack', 'rackno', 'shelf', 'location', 'bin'] }
];

var CATEGORY_ALIASES = {
    tab: 'Tablet', tablet: 'Tablet', tablets: 'Tablet',
    cap: 'Capsule', capsule: 'Capsule', capsules: 'Capsule',
    syp: 'Syrup', syrup: 'Syrup', susp: 'Syrup', suspension: 'Syrup',
    inj: 'Injection', injection: 'Injection', amp: 'Injection', vial: 'Injection',
    oint: 'Ointment', ointment: 'Ointment', cream: 'Ointment', gel: 'Ointment',
    drop: 'Drops', drops: 'Drops', eyedrops: 'Drops',
    iv: 'IV Fluid', ivfluid: 'IV Fluid', fluid: 'IV Fluid'
};

function normaliseHeader(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ----------------------------------------------------------
// STEP CONTROL
// ----------------------------------------------------------
function showStockImportStep(step) {
    ['stockUploadStep', 'stockMappingStep', 'stockPreviewStep', 'stockSummaryStep'].forEach(function(id) {
        var element = document.getElementById(id);
        if (element) element.style.display = (id === step) ? 'block' : 'none';
    });
}

function resetStockImport() {
    stockImportRows = null;
    stockImportPrepared = null;
    var input = document.getElementById('stockCsvFileInput');
    if (input) input.value = '';
    showStockImportStep('stockUploadStep');
}
window.resetStockImport = resetStockImport;

function openStockImportModal() {
    resetStockImport();
    document.getElementById('importStockModal').style.display = 'flex';
}
window.openStockImportModal = openStockImportModal;

function closeStockImportModal() {
    document.getElementById('importStockModal').style.display = 'none';
}
window.closeStockImportModal = closeStockImportModal;

function downloadStockTemplate() {
    var headers = STOCK_IMPORT_FIELDS.map(function(field) { return field.key; });
    var sample = [
        'Paracetamol 500mg', 'Paracetamol', 'Tablet', 'Cipla', 'B24J119',
        '250', 'Strip of 10', '18.50', '22.00', '12.40', '2027-09-30', '50', '30049099', 'R2-A'
    ];
    exportToCSV([headers.reduce(function(row, key, index) {
        row[key] = sample[index];
        return row;
    }, {})], 'pharmacy_stock_template');
}

// ----------------------------------------------------------
// UPLOAD & MAPPING
// ----------------------------------------------------------
function readStockCsv(file) {
    var reader = new FileReader();
    reader.onload = function(event) {
        var rows = parseCSV(event.target.result);
        if (rows.length < 2) {
            showToast('The file needs a header row and at least one medicine.', 'error');
            return;
        }
        stockImportRows = rows;
        renderStockMapping(rows[0]);
        showStockImportStep('stockMappingStep');
    };
    reader.onerror = function() { showToast('Could not read that file.', 'error'); };
    reader.readAsText(file);
}

function renderStockMapping(headers) {
    var container = document.getElementById('stockMappingContainer');
    if (!container) return;

    var normalised = headers.map(normaliseHeader);

    container.innerHTML = STOCK_IMPORT_FIELDS.map(function(field) {
        // Pick the first header whose normalised name matches an alias.
        var matchIndex = -1;
        for (var i = 0; i < normalised.length && matchIndex === -1; i++) {
            if (field.aliases.indexOf(normalised[i]) !== -1) matchIndex = i;
        }

        var options = ['<option value="">— not in this file —</option>'];
        headers.forEach(function(header, index) {
            options.push('<option value="' + index + '"' + (index === matchIndex ? ' selected' : '') + '>'
                + escapeHtml(header || ('Column ' + (index + 1))) + '</option>');
        });

        return '<div class="form-group">'
            + '<label style="font-size:12px;font-weight:600;color:var(--primary-navy);">'
            + escapeHtml(field.label) + '</label>'
            + '<select id="stockMap_' + field.key + '" style="width:100%;margin-top:4px;"'
            + (field.required ? ' required' : '') + '>' + options.join('') + '</select>'
            + '</div>';
    }).join('');

    var matched = STOCK_IMPORT_FIELDS.filter(function(field) {
        var select = document.getElementById('stockMap_' + field.key);
        return select && select.value !== '';
    }).length;

    var note = document.getElementById('stockMappingNote');
    if (note) {
        note.textContent = matched
            ? matched + ' of ' + STOCK_IMPORT_FIELDS.length + ' columns matched automatically — check them before continuing.'
            : 'No columns matched automatically. Map at least the medicine name.';
    }
}

// ----------------------------------------------------------
// PREPARE & PREVIEW
// ----------------------------------------------------------
function coerceValue(field, raw) {
    var text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (field.type === 'integer') {
        var integer = parseInt(text.replace(/[^0-9-]/g, ''), 10);
        return isNaN(integer) ? 0 : Math.max(0, integer);
    }
    if (field.type === 'number') {
        var number = parseFloat(text.replace(/[^0-9.-]/g, ''));
        return isNaN(number) ? 0 : Math.max(0, Math.round(number * 100) / 100);
    }
    if (field.type === 'date') return normaliseImportedDate(text);
    return text;
}

function prepareStockImport() {
    if (!stockImportRows) return;

    var mapping = {};
    STOCK_IMPORT_FIELDS.forEach(function(field) {
        var select = document.getElementById('stockMap_' + field.key);
        mapping[field.key] = select && select.value !== '' ? Number(select.value) : null;
    });

    if (mapping.medicineName === null) {
        showToast('Map the medicine name column before continuing.', 'error');
        return;
    }

    // Existing stock, so the preview can tell the user what will collide.
    db.collection('pharmacy').get().then(function(snapshot) {
        var existing = {};
        snapshot.forEach(function(doc) {
            var item = doc.data();
            var key = String(item.medicineName || '').trim().toLowerCase() + '|' + String(item.batchNo || '').trim().toLowerCase();
            existing[key] = Object.assign({ id: doc.id }, item);
        });

        var prepared = [];
        var seenInFile = {};

        stockImportRows.slice(1).forEach(function(cells, index) {
            var record = {};
            STOCK_IMPORT_FIELDS.forEach(function(field) {
                var column = mapping[field.key];
                record[field.key] = column === null ? (field.type === 'integer' || field.type === 'number' ? 0 : '') : coerceValue(field, cells[column]);
            });

            var rowNumber = index + 2; // 1-based, plus the header row
            var errors = [];

            if (!record.medicineName) errors.push('Medicine name is blank');
            if (record.medicineName.length > 160) errors.push('Medicine name is too long');
            if (mapping.expiryDate !== null && cells[mapping.expiryDate] && !record.expiryDate) {
                errors.push('Expiry date "' + cells[mapping.expiryDate] + '" is not a date we recognise');
            }

            // Normalise the form so the pharmacy filters keep working.
            var categoryKey = normaliseHeader(record.category);
            record.category = CATEGORY_ALIASES[categoryKey] || (record.category || 'Tablet');

            // MRP is a reasonable fallback for a missing selling price.
            if (!record.price && record.mrp) record.price = record.mrp;

            var key = record.medicineName.toLowerCase() + '|' + String(record.batchNo || '').toLowerCase();
            var duplicateInFile = Boolean(seenInFile[key]);
            seenInFile[key] = true;

            prepared.push({
                rowNumber: rowNumber,
                record: record,
                errors: errors,
                existing: existing[key] || null,
                duplicateInFile: duplicateInFile
            });
        });

        stockImportPrepared = prepared;
        renderStockPreview();
        showStockImportStep('stockPreviewStep');
    }).catch(function(err) {
        showToast('Could not read the current stock list: ' + err.message, 'error');
    });
}

function renderStockPreview() {
    var head = document.getElementById('stockPreviewHead');
    var body = document.getElementById('stockPreviewBody');
    if (!head || !body) return;

    var columns = ['Row', 'Medicine', 'Generic', 'Category', 'Batch', 'Stock', 'Price', 'Expiry', 'Status'];
    head.innerHTML = '<tr>' + columns.map(function(name) { return '<th>' + name + '</th>'; }).join('') + '</tr>';

    body.innerHTML = stockImportPrepared.slice(0, 100).map(function(row) {
        var status;
        if (row.errors.length) status = '<span style="color:#dc2626;">' + escapeHtml(row.errors.join('; ')) + '</span>';
        else if (row.duplicateInFile) status = '<span style="color:#b45309;">Repeated in this file</span>';
        else if (row.existing) status = '<span style="color:#b45309;">Already in stock</span>';
        else status = '<span style="color:#047857;">New</span>';

        return '<tr>'
            + '<td>' + row.rowNumber + '</td>'
            + '<td>' + escapeHtml(row.record.medicineName) + '</td>'
            + '<td>' + escapeHtml(row.record.genericName) + '</td>'
            + '<td>' + escapeHtml(row.record.category) + '</td>'
            + '<td>' + escapeHtml(row.record.batchNo) + '</td>'
            + '<td>' + row.record.stock + '</td>'
            + '<td>' + row.record.price + '</td>'
            + '<td>' + escapeHtml(row.record.expiryDate || '—') + '</td>'
            + '<td>' + status + '</td>'
            + '</tr>';
    }).join('');

    var errorCount = stockImportPrepared.filter(function(row) { return row.errors.length; }).length;
    var existingCount = stockImportPrepared.filter(function(row) { return row.existing && !row.errors.length; }).length;

    var note = document.getElementById('stockPreviewNote');
    note.innerHTML = stockImportPrepared.length + ' rows read · '
        + '<strong style="color:#047857;">' + (stockImportPrepared.length - errorCount - existingCount) + ' new</strong> · '
        + '<strong style="color:#b45309;">' + existingCount + ' already in stock</strong> · '
        + '<strong style="color:#dc2626;">' + errorCount + ' with problems</strong>'
        + (stockImportPrepared.length > 100 ? ' — showing the first 100 rows.' : '');

    document.getElementById('stockDuplicateChoice').style.display = existingCount ? 'block' : 'none';
}

// ----------------------------------------------------------
// COMMIT
// ----------------------------------------------------------
function commitStockImport() {
    if (!stockImportPrepared || !stockImportPrepared.length) return;

    var policy = (document.querySelector('input[name="stockDuplicatePolicy"]:checked') || {}).value || 'skip';
    var button = document.getElementById('stockConfirmBtn');
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing...';

    var toWrite = [];
    var skipped = 0;
    var failed = [];

    stockImportPrepared.forEach(function(row) {
        if (row.errors.length) { failed.push('Row ' + row.rowNumber + ': ' + row.errors.join('; ')); return; }
        if (row.duplicateInFile) { skipped++; return; }
        if (row.existing && policy === 'skip') { skipped++; return; }
        toWrite.push(row);
    });

    if (!toWrite.length) {
        renderStockSummary(0, skipped, failed);
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-file-import"></i> Confirm & import';
        return;
    }

    // Firestore allows 500 writes per batch; stay well inside that.
    var chunks = [];
    for (var i = 0; i < toWrite.length; i += 400) chunks.push(toWrite.slice(i, i + 400));

    var imported = 0;
    var now = firebase.firestore.FieldValue.serverTimestamp();

    var chain = Promise.resolve();
    chunks.forEach(function(chunk) {
        chain = chain.then(function() {
            var batch = db.batch();
            chunk.forEach(function(row) {
                var payload = Object.assign({}, row.record, { updatedAt: now, importedFrom: 'csv' });

                if (row.existing && policy === 'add') {
                    // Opening-stock top-up: add the quantity, leave the rest alone.
                    batch.update(db.collection('pharmacy').doc(row.existing.id), {
                        stock: firebase.firestore.FieldValue.increment(row.record.stock),
                        updatedAt: now
                    });
                } else if (row.existing && policy === 'overwrite') {
                    batch.set(db.collection('pharmacy').doc(row.existing.id), payload, { merge: true });
                } else {
                    payload.createdAt = now;
                    batch.set(db.collection('pharmacy').doc(), payload);
                }
                imported++;
            });
            return batch.commit();
        }).catch(function(err) {
            failed.push('A block of ' + chunk.length + ' rows failed: ' + err.message);
            imported -= chunk.length;
        });
    });

    chain.then(function() {
        renderStockSummary(Math.max(0, imported), skipped, failed);
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-file-import"></i> Confirm & import';
        if (typeof loadMedicines === 'function') loadMedicines();
    });
}

function renderStockSummary(imported, skipped, failed) {
    document.getElementById('stockSumImported').textContent = imported;
    document.getElementById('stockSumSkipped').textContent = skipped;
    document.getElementById('stockSumFailed').textContent = failed.length;

    var container = document.getElementById('stockErrorsContainer');
    var list = document.getElementById('stockErrorsList');
    if (failed.length) {
        container.style.display = 'block';
        list.innerHTML = failed.map(function(line) { return escapeHtml(line); }).join('<br>');
    } else {
        container.style.display = 'none';
    }

    showStockImportStep('stockSummaryStep');
    showToast(imported + ' medicines imported.', imported ? 'success' : 'warning');
}

// ----------------------------------------------------------
// WIRING
// ----------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
    var openButton = document.getElementById('btnImportStock');
    if (!openButton) return;

    getCurrentUser(function(user) {
        var role = (user.role || '').toLowerCase();
        if (role === 'admin' || role === 'pharmacist') openButton.style.display = 'inline-flex';
    });

    openButton.addEventListener('click', openStockImportModal);
    document.getElementById('stockTemplateBtn').addEventListener('click', downloadStockTemplate);
    document.getElementById('stockCsvFileInput').addEventListener('change', function(event) {
        if (event.target.files.length) readStockCsv(event.target.files[0]);
    });
    document.getElementById('stockMappingForm').addEventListener('submit', function(event) {
        event.preventDefault();
        prepareStockImport();
    });
    document.getElementById('stockBackToUpload').addEventListener('click', function() { showStockImportStep('stockUploadStep'); });
    document.getElementById('stockBackToMapping').addEventListener('click', function() { showStockImportStep('stockMappingStep'); });
    document.getElementById('stockConfirmBtn').addEventListener('click', commitStockImport);
    document.getElementById('stockDoneBtn').addEventListener('click', function() {
        closeStockImportModal();
        resetStockImport();
    });
});
