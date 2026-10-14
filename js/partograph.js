checkAccess(['admin', 'doctor', 'nurse', 'owner']);

var pgDocId = null;
var pgObs = [];
var pgUser = null;
var pgReadOnly = false;
var pgLoading = false;
var pgDoc = {};

// Owner gets a read-only view: Firestore rules only let admin/doctor/nurse write
// to /partographs, so the form is hidden rather than left to fail on save.
function pgApplyReadOnly() {
    pgReadOnly = ((pgUser && pgUser.role) || '').toLowerCase() === 'owner';
    if (!pgReadOnly) return;
    var form = document.getElementById('pgObsCard');
    if (form) form.style.display = 'none';
    var loadBtn = document.getElementById('pgLoadBtn');
    if (loadBtn) loadBtn.textContent = 'Load chart';
}

getCurrentUser(function (user) {
    if (!checkPageAccess(user)) return;
    pgUser = user;
    pgApplyReadOnly();
    var now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('pgTime').value = now.toISOString().slice(0, 16);
    document.getElementById('pgLabourStart').value = now.toISOString().slice(0, 16);
    document.getElementById('pgLoadBtn').onclick = loadOrCreatePartograph;
    document.getElementById('pgObsForm').onsubmit = saveObservation;
    document.getElementById('pgPrintBtn').onclick = printPartograph;
    window.addEventListener('resize', function () { renderObs(); });
    mountPatientSearch({
        inputId: 'pgPatientSearch',
        resultsId: 'pgPatientSearchResults',
        onSelect: function (p) {
            document.getElementById('pgPatientId').value = p.patientId || '';
            document.getElementById('pgPatientName').value = p.name || '';
            document.getElementById('pgPatientSearch').value = (p.name || '') + ' — ' + (p.patientId || '');
            db.collection('patients').doc(p.docId).get().then(function (doc) {
                if (!doc.exists) return;
                var d = doc.data();
                document.getElementById('pgParity').value = (d.gravida != null ? 'G' + d.gravida : '') + (d.para != null ? 'P' + d.para : '');
            });
        }
    });

    var params = new URLSearchParams(location.search);
    var pid = params.get('patientId');
    if (pid) {
        document.getElementById('pgPatientId').value = pid;
        db.collection('patients').where('patientId', '==', pid).limit(1).get().then(function (snap) {
            if (!snap.empty) {
                var p = snap.docs[0].data();
                document.getElementById('pgPatientName').value = p.name || '';
                document.getElementById('pgParity').value = (p.gravida != null ? 'G' + p.gravida : '') + (p.para != null ? 'P' + p.para : '');
            }
            loadOrCreatePartograph();
        }).catch(function (err) { showToast(err.message, 'error'); });
    }
});

function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
}

function num(id) {
    var v = parseFloat(val(id));
    return isNaN(v) ? null : v;
}

function pgDate(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

// ==========================================================
// LOAD / CREATE
// ==========================================================
function loadOrCreatePartograph() {
    if (pgLoading) return;
    var patientId = val('pgPatientId');
    if (!patientId) { showToast('Enter patient ID.', 'warning'); return; }
    var btn = document.getElementById('pgLoadBtn');
    pgLoading = true;
    if (btn) btn.disabled = true;

    // Load the most recent chart for this patient whatever its status, so a
    // completed or transferred labour can still be reviewed and printed.
    db.collection('partographs').where('patientId', '==', patientId).get()
        .then(function (snap) {
            var docs = snap.docs.slice().sort(function (a, b) {
                var av = a.data().labourStart || '', bv = b.data().labourStart || '';
                return String(bv).localeCompare(String(av));
            });
            var active = docs.filter(function (d) { return (d.data().status || 'active') === 'active'; });
            var chosen = active[0] || docs[0];
            if (chosen) {
                pgDocId = chosen.id;
                pgDoc = chosen.data() || {};
                document.getElementById('pgPatientName').value = pgDoc.patientName || '';
                document.getElementById('pgParity').value = pgDoc.parity || '';
                document.getElementById('pgStatus').value = pgDoc.status || 'active';
                if (pgDoc.labourStart) document.getElementById('pgLabourStart').value = String(pgDoc.labourStart).slice(0, 16);
                pgObs = pgDoc.observations || [];
                renderObs();
                showToast(pgDoc.status === 'active' ? 'Loaded active partograph.' : 'Loaded ' + (pgDoc.status || '') + ' partograph (read-only history).', 'success');
                return null;
            }
            if (pgReadOnly) { showToast('No partograph exists for this patient.', 'warning'); return null; }
            var payload = window.hmsBranch ? hmsBranch.stamp({}) : {};
            payload.patientId = patientId;
            payload.patientName = val('pgPatientName');
            payload.parity = val('pgParity');
            payload.labourStart = val('pgLabourStart');
            payload.status = 'active';
            payload.observations = [];
            payload.createdBy = (pgUser && (pgUser.name || pgUser.email)) || '';
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            return db.collection('partographs').add(payload).then(function (ref) {
                pgDocId = ref.id;
                pgDoc = payload;
                pgObs = [];
                renderObs();
                showToast('Partograph started.', 'success');
            });
        })
        .catch(function (err) { showToast(err.message, 'error'); })
        .then(function () {
            pgLoading = false;
            if (btn) btn.disabled = false;
        });
}

// ==========================================================
// SAVE OBSERVATION
// ==========================================================
function saveObservation(e) {
    e.preventDefault();
    if (pgReadOnly) return;
    if (!pgDocId) { showToast('Load or create a partograph first.', 'warning'); return; }
    var submitBtn = document.getElementById('pgSaveBtn');
    var obs = {
        time: val('pgTime'),
        dilation: parseFloat(document.getElementById('pgDilation').value),
        effacement: val('pgEffacement'),
        descent: val('pgDescent'),
        liquor: val('pgLiquor') || 'Clear',
        fhr: num('pgFhr'),
        contractions: num('pgContractions'),
        pulse: num('pgPulse'),
        bp: val('pgBp'),
        temperature: num('pgTemp'),
        urineOutput: val('pgUrineOutput'),
        ivFluids: val('pgIvFluids'),
        oxytocin: val('pgOxytocin'),
        medication: val('pgMedication'),
        notes: val('pgNotes'),
        recordedBy: (pgUser && (pgUser.name || pgUser.email)) || '',
        recordedAt: new Date().toISOString()
    };
    if (!obs.time || isNaN(obs.dilation)) {
        showToast('Time and cervical dilation are required.', 'warning');
        return;
    }
    if (obs.dilation < 0 || obs.dilation > 10) {
        showToast('Cervical dilation must be between 0 and 10 cm.', 'warning');
        return;
    }
    if (!pgDate(obs.time)) { showToast('Observation time is not a valid date.', 'warning'); return; }
    if (obs.bp && !/^\s*\d{2,3}\s*\/\s*\d{2,3}\s*$/.test(obs.bp)) {
        showToast('BP must be written as systolic/diastolic, e.g. 120/80.', 'warning');
        return;
    }
    obs.bp = obs.bp.replace(/\s/g, '');
    var start = pgDate(val('pgLabourStart'));
    if (start && pgDate(obs.time) < start) {
        showToast('Observation time is before labour start.', 'warning');
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    // arrayUnion so two nurses charting from different devices cannot
    // overwrite each other's rows.
    db.collection('partographs').doc(pgDocId).update({
        observations: firebase.firestore.FieldValue.arrayUnion(obs),
        status: document.getElementById('pgStatus').value,
        patientName: val('pgPatientName'),
        parity: val('pgParity'),
        labourStart: val('pgLabourStart'),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
        showToast('Observation saved.', 'success');
        try {
            var t = new Date(obs.time);
            if (!isNaN(t.getTime())) {
                t.setHours(t.getHours() + 1);
                t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
                document.getElementById('pgTime').value = t.toISOString().slice(0, 16);
            }
        } catch (err) {}
        ['pgEffacement', 'pgDescent', 'pgFhr', 'pgContractions', 'pgPulse', 'pgBp', 'pgTemp', 'pgUrineOutput', 'pgIvFluids', 'pgOxytocin', 'pgMedication', 'pgNotes'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('pgDilation').value = '';
        // Re-read so rows another device added since load are picked up.
        return db.collection('partographs').doc(pgDocId).get().then(function (doc) {
            pgDoc = doc.exists ? doc.data() : pgDoc;
            pgObs = (pgDoc && pgDoc.observations) || [];
            renderObs();
        });
    }).catch(function (err) { showToast(err.message, 'error'); })
      .then(function () { if (submitBtn) submitBtn.disabled = false; });
}

function deleteObservation(index) {
    if (pgReadOnly || !pgDocId) return;
    var sorted = pgSorted();
    var target = sorted[index];
    if (!target) return;
    if (!confirm('Remove the observation charted at ' + pgTimeLabel(target.time) + '?')) return;
    db.collection('partographs').doc(pgDocId).update({
        observations: firebase.firestore.FieldValue.arrayRemove(target),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
        return db.collection('partographs').doc(pgDocId).get();
    }).then(function (doc) {
        pgDoc = doc.exists ? doc.data() : pgDoc;
        pgObs = (pgDoc && pgDoc.observations) || [];
        renderObs();
        showToast('Observation removed.', 'success');
    }).catch(function (err) { showToast(err.message, 'error'); });
}
window.deleteObservation = deleteObservation;

// ==========================================================
// TABLE
// ==========================================================
function cell(v) {
    if (v == null || v === '') return '—';
    return escapeHtml(String(v));
}

function pgTimeLabel(t) {
    var dt = pgDate(t);
    if (!dt) return t || '';
    return dt.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function pgSorted() {
    return (pgObs || []).slice().sort(function (a, b) {
        var ad = pgDate(a.time), bd = pgDate(b.time);
        if (ad && bd) return ad - bd;
        return String(a.time).localeCompare(String(b.time));
    });
}

var PG_COLS = 15;

function renderObs() {
    var body = document.getElementById('pgObsBody');
    var alertEl = document.getElementById('pgAlert');
    if (!pgObs.length) {
        body.innerHTML = '<tr><td colspan="' + PG_COLS + '" style="text-align:center;color:#888;padding:16px;">No observations yet.</td></tr>';
        alertEl.textContent = '';
        drawChart([]);
        return;
    }
    var sorted = pgSorted();
    body.innerHTML = sorted.map(function (o, i) {
        var meds = [o.medication, o.oxytocin ? ('Oxy: ' + o.oxytocin) : ''].filter(Boolean).join(' · ');
        var fhrBad = o.fhr && (o.fhr < 110 || o.fhr > 160);
        var prBad = o.pulse && (o.pulse < 60 || o.pulse > 120);
        var tempBad = o.temperature && o.temperature >= 100.4;
        var bad = 'color:#b91c1c;font-weight:600;';
        return '<tr>'
            + '<td>' + cell(pgTimeLabel(o.time)) + '</td>'
            + '<td>' + cell(o.dilation) + '</td>'
            + '<td>' + cell(o.effacement) + '</td>'
            + '<td>' + cell(o.descent) + '</td>'
            + '<td>' + cell(o.liquor) + '</td>'
            + '<td' + (fhrBad ? ' style="' + bad + '"' : '') + '>' + cell(o.fhr) + '</td>'
            + '<td>' + cell(o.contractions) + '</td>'
            + '<td' + (prBad ? ' style="' + bad + '"' : '') + '>' + cell(o.pulse) + '</td>'
            + '<td>' + cell(o.bp) + '</td>'
            + '<td' + (tempBad ? ' style="' + bad + '"' : '') + '>' + cell(o.temperature) + '</td>'
            + '<td>' + cell(o.urineOutput) + '</td>'
            + '<td>' + cell(o.ivFluids) + '</td>'
            + '<td style="max-width:140px;font-size:12px;">' + cell(meds) + '</td>'
            + '<td style="max-width:140px;font-size:12px;">' + cell(o.notes) + '</td>'
            + '<td>' + (pgReadOnly ? '—' : '<button type="button" class="btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="deleteObservation(' + i + ')">Remove</button>') + '</td>'
            + '</tr>';
    }).join('');

    alertEl.textContent = pgAlerts(sorted).slice(0, 3).join(' · ');
    drawChart(sorted);
}

function pgAlerts(sorted) {
    var alerts = [];
    sorted.forEach(function (o) {
        var t = pgTimeLabel(o.time);
        if (o.fhr && (o.fhr < 110 || o.fhr > 160)) alerts.push('FHR ' + o.fhr + ' at ' + t);
        if (o.pulse && (o.pulse < 60 || o.pulse > 120)) alerts.push('Maternal PR ' + o.pulse + ' at ' + t);
        if (o.temperature && o.temperature >= 100.4) alerts.push('Fever ' + o.temperature + '°F at ' + t);
        if (Number(o.dilation) >= 4 && o.contractions != null && o.contractions < 3) alerts.push('Inadequate contractions at ' + t);
        if (/meconium/i.test(o.liquor || '')) alerts.push('Meconium liquor at ' + t);
    });
    var line = pgAlertLine(sorted);
    if (line) {
        var last = sorted[sorted.length - 1];
        var h = pgHours(last, sorted);
        var alertDil = 4 + (h - line.startHour);
        if (Number(last.dilation) < alertDil - 4) alerts.unshift('CROSSED ACTION LINE — intervene');
        else if (Number(last.dilation) < alertDil) alerts.unshift('Crossed alert line — review');
    }
    return alerts;
}

// ==========================================================
// CHART — WHO-style stacked panels sharing one time axis.
// Sections mirror the ward chart: FETUS (FHR, liquor),
// LABOUR PROGRESS (cervix, descent, contractions) and
// MOTHER (pulse, BP, temperature, urine, fluids).
// ==========================================================
// The axis starts at labour onset, but only when that is credible. Charts
// carrying a stale or mistyped labourStart (days before the first
// observation) would otherwise squash every reading against the right edge,
// so anything beyond a day falls back to the first observation.
var PG_MAX_LEAD_HOURS = 24;

function pgBaseTime(sorted) {
    var start = pgDate(val('pgLabourStart')) || pgDate(pgDoc && pgDoc.labourStart);
    var first = sorted.length ? pgDate(sorted[0].time) : null;
    if (start && first) {
        if (start > first) return first;
        return (first - start) / 3600000 > PG_MAX_LEAD_HOURS ? first : start;
    }
    return start || first || new Date();
}

function pgHours(o, sorted) {
    var base = pgBaseTime(sorted);
    var d = pgDate(o.time);
    if (!d) return 0;
    return (d - base) / 3600000;
}

// WHO alert line: 1 cm/hr from the first observation at >= 4 cm.
function pgAlertLine(sorted) {
    for (var i = 0; i < sorted.length; i++) {
        if (Number(sorted[i].dilation) >= 4) {
            return { startHour: pgHours(sorted[i], sorted), startDil: Number(sorted[i].dilation) };
        }
    }
    return null;
}

function drawChart(obs) {
    var canvas = document.getElementById('pgCanvas');
    if (!canvas || !canvas.getContext) return;

    var W = 1000;
    var L = 120, R = 18;
    var PANELS = [
        { key: 'fhr', h: 108, band: 'FETUS' },
        { key: 'liquor', h: 26 },
        { key: 'cervix', h: 180, band: 'LABOUR PROGRESS' },
        { key: 'ctx', h: 66 },
        { key: 'drugs', h: 26 },
        { key: 'pulse', h: 132, band: 'MOTHER' },
        { key: 'vitals', h: 52 }
    ];
    var GAP = 10, TOP = 26, AXIS = 34;
    var H = TOP + AXIS + PANELS.reduce(function (s, p) { return s + p.h; }, 0) + GAP * (PANELS.length - 1);

    var dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.maxWidth = W + 'px';
    canvas.style.height = 'auto';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Hours span: at least 12, rounded up past the last observation.
    var lastH = 0;
    obs.forEach(function (o) { lastH = Math.max(lastH, pgHours(o, obs)); });
    var HOURS = Math.max(12, Math.ceil(lastH + 1));
    var PW = W - L - R;
    // PAD keeps the hour-0 column clear of the frame so centred labels and
    // markers are not clipped by the left edge.
    var PAD = 15;
    function X(h) { return L + PAD + (Math.max(0, Math.min(HOURS, h)) / HOURS) * (PW - PAD * 2); }

    // Resolve each panel's y position.
    var y = TOP, rect = {};
    PANELS.forEach(function (p, i) {
        rect[p.key] = { top: y, h: p.h, bottom: y + p.h, band: p.band };
        y += p.h + (i < PANELS.length - 1 ? GAP : 0);
    });
    var axisTop = y;

    function panelFrame(key, title, sub) {
        var r = rect[key];
        ctx.fillStyle = '#fdfdfd';
        ctx.fillRect(L, r.top, PW, r.h);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(L + 0.5, r.top + 0.5, PW - 1, r.h - 1);
        ctx.fillStyle = '#334155';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(title, L - 6, r.top + 12);
        if (sub) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px Inter, sans-serif';
            ctx.fillText(sub, L - 6, r.top + 25);
        }
        ctx.textAlign = 'left';
        // Hour gridlines
        ctx.strokeStyle = '#eef2f7';
        for (var hh = 1; hh < HOURS; hh++) {
            var gx = X(hh);
            ctx.beginPath(); ctx.moveTo(gx, r.top + 1); ctx.lineTo(gx, r.bottom - 1); ctx.stroke();
        }
    }

    // Section bands down the left edge (FETUS / LABOUR PROGRESS / MOTHER).
    PANELS.forEach(function (p, i) {
        if (!p.band) return;
        var from = rect[p.key].top;
        var to = rect[p.key].bottom;
        for (var j = i + 1; j < PANELS.length && !PANELS[j].band; j++) to = rect[PANELS[j].key].bottom;
        ctx.save();
        ctx.fillStyle = p.band === 'MOTHER' ? '#A61E4D' : (p.band === 'FETUS' ? '#0f766e' : '#1d4ed8');
        ctx.fillRect(2, from, 4, to - from);
        ctx.translate(16, (from + to) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.fillText(p.band, 0, 0);
        ctx.restore();
        ctx.textAlign = 'left';
    });

    // ---------- FHR ----------
    var fhrMin = 80, fhrMax = 200, rf = rect.fhr;
    function yFhr(v) { return rf.bottom - ((Math.max(fhrMin, Math.min(fhrMax, v)) - fhrMin) / (fhrMax - fhrMin)) * rf.h; }
    panelFrame('fhr', 'FHR', 'bpm');
    ctx.fillStyle = 'rgba(16,185,129,.10)';
    ctx.fillRect(L + 1, yFhr(160), PW - 2, yFhr(110) - yFhr(160));
    ctx.strokeStyle = '#10b981';
    ctx.setLineDash([4, 3]);
    [110, 160].forEach(function (v) {
        ctx.beginPath(); ctx.moveTo(L, yFhr(v)); ctx.lineTo(L + PW, yFhr(v)); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    [80, 110, 140, 160, 200].forEach(function (v) { ctx.fillText(String(v), L - 6, yFhr(v) + 3); });
    ctx.textAlign = 'left';

    var fhrPts = obs.filter(function (o) { return o.fhr != null && !isNaN(Number(o.fhr)); });
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    fhrPts.forEach(function (o, i) {
        var px = X(pgHours(o, obs)), py = yFhr(Number(o.fhr));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    fhrPts.forEach(function (o) {
        var v = Number(o.fhr);
        var px = X(pgHours(o, obs)), py = yFhr(v);
        var bad = v < 110 || v > 160;
        ctx.fillStyle = bad ? '#dc2626' : '#0f766e';
        ctx.beginPath(); ctx.arc(px, py, bad ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
    });

    // ---------- Liquor ----------
    panelFrame('liquor', 'Liquor', '');
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    obs.forEach(function (o) {
        var code = ({ clear: 'C', meconium: 'M', 'blood-stained': 'B', absent: 'A' })[String(o.liquor || '').toLowerCase()] || (o.liquor ? String(o.liquor).charAt(0).toUpperCase() : '');
        if (!code) return;
        ctx.fillStyle = code === 'M' ? '#dc2626' : '#334155';
        ctx.fillText(code, X(pgHours(o, obs)), rect.liquor.top + 18);
    });
    ctx.textAlign = 'left';

    // ---------- Cervicograph ----------
    var rc = rect.cervix;
    function yDil(d) { return rc.bottom - (Math.max(0, Math.min(10, d)) / 10) * rc.h; }
    panelFrame('cervix', 'Cx dilation ✕', 'cm · descent ○');
    ctx.fillStyle = '#64748b';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (var d = 0; d <= 10; d += 1) {
        ctx.strokeStyle = d % 2 === 0 ? '#e2e8f0' : '#f5f7fa';
        ctx.beginPath(); ctx.moveTo(L + 1, yDil(d)); ctx.lineTo(L + PW - 1, yDil(d)); ctx.stroke();
        if (d % 2 === 0) ctx.fillText(String(d), L - 6, yDil(d) + 3);
    }
    ctx.textAlign = 'left';

    var line = pgAlertLine(obs);
    if (line) {
        // Alert line: 4 cm -> 10 cm at 1 cm/hr. Action line: 4 h to the right.
        var a0x = X(line.startHour), a0y = yDil(4);
        var a1h = line.startHour + (10 - 4);
        ctx.setLineDash([7, 4]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#f59e0b';
        ctx.beginPath(); ctx.moveTo(a0x, a0y); ctx.lineTo(X(a1h), yDil(10)); ctx.stroke();
        ctx.strokeStyle = '#dc2626';
        ctx.beginPath(); ctx.moveTo(X(line.startHour + 4), a0y); ctx.lineTo(X(a1h + 4), yDil(10)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('alert', Math.min(X(a1h) + 3, L + PW - 30), yDil(10) + 10);
        ctx.fillStyle = '#dc2626';
        ctx.fillText('action', Math.min(X(a1h + 4) + 3, L + PW - 32), yDil(10) + 20);
    }

    // Dilation plot — ✕ markers joined, WHO convention
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    obs.forEach(function (o, i) {
        var px = X(pgHours(o, obs)), py = yDil(Number(o.dilation) || 0);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    obs.forEach(function (o) {
        var px = X(pgHours(o, obs)), py = yDil(Number(o.dilation) || 0);
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4);
        ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4);
        ctx.stroke();
    });

    // Descent — ○ markers, station -3..+3 mapped onto the same box
    var descPts = obs.filter(function (o) { return /-?\d/.test(String(o.descent || '')); });
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    descPts.forEach(function (o, i) {
        var st = parseFloat(String(o.descent).replace(/[^\d.+-]/g, ''));
        if (isNaN(st)) return;
        var frac = (st + 3) / 6; // -3 -> 0, +3 -> 1
        var px = X(pgHours(o, obs)), py = rc.bottom - frac * rc.h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    descPts.forEach(function (o) {
        var st = parseFloat(String(o.descent).replace(/[^\d.+-]/g, ''));
        if (isNaN(st)) return;
        var frac = (st + 3) / 6;
        var px = X(pgHours(o, obs)), py = rc.bottom - frac * rc.h;
        ctx.strokeStyle = '#7c3aed';
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.stroke();
    });

    // ---------- Contractions ----------
    var rx = rect.ctx;
    panelFrame('ctx', 'Contractions', 'per 10 min (0–5)');
    var barW = Math.max(6, Math.min(18, PW / (HOURS * 1.6)));
    obs.forEach(function (o) {
        var c = Number(o.contractions);
        if (!c || isNaN(c)) return;
        c = Math.max(0, Math.min(5, c));
        var px = X(pgHours(o, obs));
        var bh = (c / 5) * (rx.h - 8);
        ctx.fillStyle = c < 3 ? '#fbbf24' : '#1d4ed8';
        ctx.fillRect(px - barW / 2, rx.bottom - 4 - bh, barW, bh);
    });

    // ---------- Oxytocin / IV fluids ----------
    panelFrame('drugs', 'Oxytocin / IV', '');
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#334155';
    obs.forEach(function (o) {
        var txt = o.oxytocin || o.ivFluids || '';
        if (!txt) return;
        txt = String(txt);
        if (txt.length > 10) txt = txt.slice(0, 9) + '…';
        ctx.fillText(txt, X(pgHours(o, obs)), rect.drugs.top + 17);
    });
    ctx.textAlign = 'left';

    // ---------- Mother: pulse + BP ----------
    var rp = rect.pulse, pMin = 40, pMax = 200;
    function yP(v) { return rp.bottom - ((Math.max(pMin, Math.min(pMax, v)) - pMin) / (pMax - pMin)) * rp.h; }
    panelFrame('pulse', 'PR ● / BP ↕', 'per min · mmHg');
    ctx.fillStyle = '#64748b';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    [40, 80, 120, 160, 200].forEach(function (v) {
        ctx.strokeStyle = '#eef2f7';
        ctx.beginPath(); ctx.moveTo(L + 1, yP(v)); ctx.lineTo(L + PW - 1, yP(v)); ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.fillText(String(v), L - 6, yP(v) + 3);
    });
    ctx.textAlign = 'left';

    // BP drawn first, as vertical systolic-to-diastolic arrows behind the pulse line.
    obs.forEach(function (o) {
        var m = String(o.bp || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
        if (!m) return;
        var sys = Number(m[1]), dia = Number(m[2]);
        var px = X(pgHours(o, obs));
        var high = sys >= 140 || dia >= 90;
        ctx.strokeStyle = high ? '#dc2626' : '#94a3b8';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(px, yP(sys)); ctx.lineTo(px, yP(dia)); ctx.stroke();
        [yP(sys), yP(dia)].forEach(function (yy) {
            ctx.beginPath(); ctx.moveTo(px - 4, yy); ctx.lineTo(px + 4, yy); ctx.stroke();
        });
    });

    var prPts = obs.filter(function (o) { return o.pulse != null && !isNaN(Number(o.pulse)); });
    ctx.strokeStyle = '#A61E4D';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    prPts.forEach(function (o, i) {
        var px = X(pgHours(o, obs)), py = yP(Number(o.pulse));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    prPts.forEach(function (o) {
        var v = Number(o.pulse);
        var px = X(pgHours(o, obs)), py = yP(v);
        var bad = v < 60 || v > 120;
        ctx.fillStyle = bad ? '#dc2626' : '#A61E4D';
        ctx.beginPath(); ctx.arc(px, py, bad ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
    });

    // ---------- Mother: temperature + urine ----------
    panelFrame('vitals', 'Temp / Urine', '°F · ml');
    var rv = rect.vitals;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(L + 1, rv.top + rv.h / 2); ctx.lineTo(L + PW - 1, rv.top + rv.h / 2); ctx.stroke();
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    obs.forEach(function (o) {
        var px = X(pgHours(o, obs));
        if (o.temperature != null && !isNaN(Number(o.temperature))) {
            ctx.fillStyle = Number(o.temperature) >= 100.4 ? '#dc2626' : '#334155';
            ctx.fillText(String(o.temperature), px, rv.top + 16);
        }
        if (o.urineOutput) {
            var u = String(o.urineOutput);
            if (u.length > 9) u = u.slice(0, 8) + '…';
            ctx.fillStyle = '#334155';
            ctx.fillText(u, px, rv.top + rv.h / 2 + 16);
        }
    });
    ctx.textAlign = 'left';

    // ---------- Time axis ----------
    var base = pgBaseTime(obs);
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath(); ctx.moveTo(L, axisTop + 1); ctx.lineTo(L + PW, axisTop + 1); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    // Keep roughly a dozen labelled ticks whatever the span, so the hour and
    // clock rows stay readable instead of overprinting each other.
    var step = Math.max(1, Math.ceil(HOURS / 12));
    for (var hh = 0; hh <= HOURS; hh += step) {
        var px = X(hh);
        ctx.beginPath(); ctx.moveTo(px, axisTop + 1); ctx.lineTo(px, axisTop + 5); ctx.stroke();
        ctx.fillText(String(hh), px, axisTop + 15);
        var clock = new Date(base.getTime() + hh * 3600000);
        ctx.fillText(clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }), px, axisTop + 26);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#334155';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillText('Hours', 8, axisTop + 15);
    ctx.fillText('Clock', 8, axisTop + 26);
}

// ==========================================================
// PRINT
// ==========================================================
function printPartograph() {
    if (!pgDocId || !pgObs.length) { showToast('Load a chart with at least one observation first.', 'warning'); return; }
    var canvas = document.getElementById('pgCanvas');
    var img = canvas ? canvas.toDataURL('image/png') : '';
    var head = ['Time', 'Cx dil.', 'Cx eff.', 'Station', 'Liquor', 'FHR', 'Ctx/10min', 'PR', 'BP', 'Temp', 'Urine', 'IV fluids', 'Medication', 'Notes'];
    var rows = pgSorted().map(function (o) {
        var meds = [o.medication, o.oxytocin ? ('Oxy: ' + o.oxytocin) : ''].filter(Boolean).join(' · ');
        return [pgTimeLabel(o.time), o.dilation, o.effacement, o.descent, o.liquor, o.fhr, o.contractions,
            o.pulse, o.bp, o.temperature, o.urineOutput, o.ivFluids, meds, o.notes]
            .map(function (v) { return '<td>' + escapeHtml(v == null || v === '' ? '—' : String(v)) + '</td>'; }).join('');
    });

    db.collection('hospitalSettings').doc('main').get().then(function (doc) {
        var s = doc.exists ? doc.data() : {};
        var w = window.open('', '_blank', 'width=1100,height=900');
        if (!w) { showToast('Pop-up blocked — allow pop-ups to print.', 'error'); return; }
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Partograph — '
            + escapeHtml(val('pgPatientName') || val('pgPatientId')) + '</title><style>'
            + 'body{font-family:Arial,Helvetica,sans-serif;margin:18px;color:#111;}'
            + 'h1{font-size:17px;margin:0;}h2{font-size:13px;margin:2px 0 12px;font-weight:400;color:#444;}'
            + '.meta{font-size:12px;margin-bottom:12px;}.meta b{display:inline-block;min-width:96px;}'
            + 'img{width:100%;border:1px solid #ccc;}'
            + 'table{width:100%;border-collapse:collapse;font-size:10px;margin-top:12px;}'
            + 'th,td{border:1px solid #bbb;padding:3px 4px;text-align:left;}th{background:#f1f1f1;}'
            + '@media print{@page{size:A4 landscape;margin:10mm;}}'
            + '</style></head><body>'
            + '<h1>' + escapeHtml(s.hospitalName || 'Jyothsna Maternity Hospital') + '</h1>'
            + '<h2>' + escapeHtml(s.address || '') + '</h2>'
            + '<div class="meta"><b>Patient</b>' + escapeHtml(val('pgPatientName')) + ' (' + escapeHtml(val('pgPatientId')) + ')<br>'
            + '<b>Parity</b>' + escapeHtml(val('pgParity') || '—') + '<br>'
            + '<b>Labour start</b>' + escapeHtml(pgTimeLabel(val('pgLabourStart'))) + '<br>'
            + '<b>Status</b>' + escapeHtml(val('pgStatus')) + '<br>'
            + '<b>Printed</b>' + escapeHtml(new Date().toLocaleString('en-IN')) + '</div>'
            + (img ? '<img src="' + img + '">' : '')
            + '<table><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>'
            + '<tbody>' + rows.map(function (r) { return '<tr>' + r + '</tr>'; }).join('') + '</tbody></table>'
            + '<script>setTimeout(function(){window.print();},500);<\/script></body></html>';
        w.document.write(html);
        w.document.close();
    }).catch(function (err) { showToast(err.message, 'error'); });
}
