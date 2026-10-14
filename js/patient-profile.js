// ==========================================
// JMGH HMS - PATIENT PROFILE JS
// ==========================================

// Global state variables
let currentPatient = null;
let currentPatientId = null;
let currentPatientDocId = null;
let latestOPDBillDocId = null; 
var patientId = '';

let currentUserRole = '';
let currentUserName = '';
let currentUserDocId = '';

// 1. Initial Authentication and Access Control Check
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserRole = (user.role || '').toLowerCase();
    currentUserName = user.name || '';
    currentUserDocId = user.docId || user.uid || '';
    
    // Auth success, run profile loader
    initProfile(user);
});

// 2. Parse Patient ID and retrieve from Firestore
function initProfile(user) {
    var params = new URLSearchParams(window.location.search);
    currentPatientId = params.get('id');
    patientId = currentPatientId;
    window.patientId = currentPatientId;
    
    if (!currentPatientId) {
        showToast('No Patient ID provided.', 'warning');
        setTimeout(() => { window.location.href = 'patients.html'; }, 1000);
        return;
    }
    
    // Load patient document
    db.collection('patients').where('patientId', '==', currentPatientId).get().then(snap => {
        if (snap.empty) {
            // Backup lookup using document ID just in case
            return db.collection('patients').doc(currentPatientId).get().then(doc => {
                if (!doc.exists) {
                    showToast('Patient record not found in system.', 'error');
                    setTimeout(() => { window.location.href = 'patients.html'; }, 1500);
                    return null;
                }
                return doc;
            });
        }
        return snap.docs[0];
    }).then(async doc => {
        if (!doc) return;
        const ptData = doc.data();
        
        // DOCTOR SCOPING CHECK: doctor may open patient ONLY if assigned doctor is them OR they have an appointment/consultation with patient
        if (currentUserRole === 'doctor') {
            const assignedDoc = ptData.doctor || ptData.doctorName || ptData.assignedDoctor || '';
            const isAssigned = (assignedDoc === currentUserName || assignedDoc.includes(currentUserName));
            
            if (!isAssigned) {
                const apptSnap = await db.collection('appointments')
                    .where('patientId', '==', currentPatientId)
                    .where('doctorName', '==', currentUserName)
                    .get();
                
                const consultSnap = await db.collection('consultations')
                    .where('patientId', '==', currentPatientId)
                    .where('doctorName', '==', currentUserName)
                    .get();
                
                if (apptSnap.empty && consultSnap.empty) {
                    showToast('Access denied: You are not assigned to this patient.', 'error');
                    setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
                    return;
                }
            }
        }
        
        currentPatientDocId = doc.id;
        currentPatient = ptData;
        window.patientId = currentPatientId;
        
        // Render Top Patient Header Card
        renderHeaderCard();
        
        // Load initial tab (visits and bills)
        loadPatientBills(currentPatientId);
        
        // Load counts for remaining stats
        loadSummaryStats();
        if (currentPatient.isPregnant) initAntenatalCare();
        loadBabies();
    }).catch(err => {
        console.error('Error loading patient:', err);
        showToast('Error loading patient profile.', 'error');
    });
}

function pregnancyDetails(lmp) {
    if (!lmp) return { weeks: '—', trimester: '—' };
    var weeks = Math.max(0, Math.floor((Date.now() - new Date(lmp + 'T00:00:00').getTime()) / 604800000));
    return { weeks: weeks, trimester: weeks < 14 ? 'First trimester' : weeks < 28 ? 'Second trimester' : 'Third trimester' };
}

// ----------------------------------------------------------
// PREGNANCY DATES — LMP drives EDD by Naegele's rule, but a
// dating scan often moves the EDD. The override is stored with
// its source so nobody has to guess later which one is in force.
// ----------------------------------------------------------
function togglePregnancyDatesEditor(show) {
    var editor = document.getElementById('pregnancyDatesEditor');
    if (editor) editor.style.display = show ? 'block' : 'none';
}
window.togglePregnancyDatesEditor = togglePregnancyDatesEditor;

function onPregnancyLmpChange() {
    var lmp = document.getElementById('pregLmpInput');
    var edd = document.getElementById('pregEddInput');
    var mode = document.getElementById('pregEddMode');
    if (!lmp || !edd || !mode) return;
    if (mode.value === 'auto' && lmp.value) {
        edd.value = addDaysToIso(lmp.value, 280);
        edd.readOnly = true;
    } else {
        edd.readOnly = false;
    }
    var preview = document.getElementById('pregWeeksPreview');
    if (preview) {
        var details = pregnancyDetails(lmp.value);
        preview.textContent = lmp.value ? details.weeks + ' weeks · ' + details.trimester : 'Enter an LMP to see gestational age.';
    }
}
window.onPregnancyLmpChange = onPregnancyLmpChange;

function savePregnancyDates() {
    var lmp = document.getElementById('pregLmpInput').value;
    var edd = document.getElementById('pregEddInput').value;
    var mode = document.getElementById('pregEddMode').value;
    var reason = document.getElementById('pregEddReason').value.trim();

    if (!lmp && !edd) { showToast('Enter an LMP or an EDD.', 'warning'); return; }
    if (lmp && new Date(lmp + 'T00:00:00') > new Date()) { showToast('The LMP cannot be in the future.', 'error'); return; }
    if (mode === 'manual' && !edd) { showToast('A manually set EDD is required.', 'error'); return; }
    if (mode === 'manual' && !reason) { showToast('Give a reason for overriding the EDD (for example: dating scan).', 'warning'); return; }

    var update = {
        lmp: lmp || null,
        edd: edd || (lmp ? addDaysToIso(lmp, 280) : null),
        eddSource: mode === 'manual' ? 'manual' : 'lmp',
        eddOverrideReason: mode === 'manual' ? reason : '',
        eddUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        eddUpdatedBy: (firebase.auth().currentUser || {}).email || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('patients').doc(currentPatientDocId).update(update).then(function() {
        Object.assign(currentPatient, { lmp: update.lmp, edd: update.edd, eddSource: update.eddSource, eddOverrideReason: update.eddOverrideReason });
        renderAncSummary();
        showToast('Pregnancy dates updated.', 'success');
    }).catch(function(err) {
        showToast('Could not update pregnancy dates: ' + err.message, 'error');
    });
}
window.savePregnancyDates = savePregnancyDates;

// addDaysToIso / eddFromLmp / gestationalAge live in helpers.js.

function initAntenatalCare() {
    var tab = document.getElementById('ancTabButton');
    if (tab) tab.style.display = 'flex';
    renderAncSummary();
    var date = document.getElementById('ancVisitDate'); if (date) date.value = todayIso();
    var weeks = document.getElementById('ancGestationalWeeks'); if (weeks) weeks.value = pregnancyDetails(currentPatient.lmp).weeks === '—' ? '' : pregnancyDetails(currentPatient.lmp).weeks;
    loadAncVisits();
    var form = document.getElementById('ancVisitForm');
    if (form) form.addEventListener('submit', saveAncVisit);
}

function renderAncSummary() {
    var target = document.getElementById('ancSummary'); if (!target) return;
    var age = gestationalAge(currentPatient.lmp);
    var isManual = currentPatient.eddSource === 'manual';

    target.innerHTML = '<div class="card" style="border-left:5px solid var(--primary-teal);">'
        + '<div class="card-header"><h3 class="card-title"><i class="fa-solid fa-baby"></i> Pregnancy Summary</h3>'
        + '<div style="display:flex;gap:8px;align-items:center;">'
        + (currentPatient.highRisk ? '<span class="status-badge" style="background:#fff1f2;color:#dc2626;">High risk</span>' : '')
        + '<button class="btn-secondary" onclick="togglePregnancyDatesEditor(true)" style="padding:4px 10px;font-size:12px;"><i class="fa-solid fa-pen"></i> Update dates</button>'
        + '</div></div>'
        + '<div class="modal-body"><div class="form-grid">'
        + '<div><strong>LMP</strong><br>' + escapeHtml(currentPatient.lmp || '—') + '</div>'
        + '<div><strong>EDD</strong><br>' + escapeHtml(currentPatient.edd || '—')
        + '<br><small style="color:var(--text-muted);">' + (isManual ? 'Set manually' : 'From LMP + 280 days') + '</small></div>'
        + '<div><strong>Gestational age</strong><br>' + escapeHtml(age ? age.text : '—') + '</div>'
        + '<div><strong>Trimester</strong><br>' + escapeHtml(age ? age.trimester : '—') + '</div>'
        + '<div><strong>Gravida / Para</strong><br>' + escapeHtml(currentPatient.gravida || 0) + ' / ' + escapeHtml(currentPatient.para || 0) + '</div>'
        + '<div><strong>Abortions</strong><br>' + escapeHtml(currentPatient.abortions || 0)
        + (currentPatient.highRiskReason ? '<br><small>Reason: ' + escapeHtml(currentPatient.highRiskReason) + '</small>' : '') + '</div>'
        + '</div>'
        + (isManual && currentPatient.eddOverrideReason
            ? '<p style="margin-top:10px;font-size:12.5px;color:#b45309;"><i class="fa-solid fa-circle-info"></i> EDD override: ' + escapeHtml(currentPatient.eddOverrideReason) + '</p>'
            : '')

        // Inline editor — hidden until "Update dates" is pressed.
        + '<div id="pregnancyDatesEditor" style="display:none;margin-top:16px;border-top:1px solid #f1f5f9;padding-top:14px;">'
        + '<div class="form-grid">'
        + '<div class="form-group"><label>LMP</label><input type="date" id="pregLmpInput" value="' + escapeHtml(currentPatient.lmp || '') + '" onchange="onPregnancyLmpChange()"></div>'
        + '<div class="form-group"><label>EDD calculation</label><select id="pregEddMode" onchange="onPregnancyLmpChange()">'
        + '<option value="auto"' + (isManual ? '' : ' selected') + '>Automatic — LMP + 280 days</option>'
        + '<option value="manual"' + (isManual ? ' selected' : '') + '>Manual — set by scan / clinician</option>'
        + '</select></div>'
        + '<div class="form-group"><label>EDD</label><input type="date" id="pregEddInput" value="' + escapeHtml(currentPatient.edd || '') + '"></div>'
        + '<div class="form-group full-width"><label>Reason for a manual EDD</label>'
        + '<input type="text" id="pregEddReason" maxlength="200" value="' + escapeHtml(currentPatient.eddOverrideReason || '') + '" placeholder="e.g. Corrected by first-trimester dating scan"></div>'
        + '</div>'
        + '<p style="font-size:12.5px;color:var(--text-muted);margin:4px 0 12px;" id="pregWeeksPreview"></p>'
        + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
        + '<button class="btn-secondary" onclick="togglePregnancyDatesEditor(false)">Cancel</button>'
        + '<button class="btn-primary" onclick="savePregnancyDates()"><i class="fa-solid fa-check"></i> Save dates</button>'
        + '</div></div>'

        + '</div></div>';

    onPregnancyLmpChange();
}

function saveAncVisit(event) {
    event.preventDefault();
    var value = function(id) { return document.getElementById(id).value.trim(); };
    var visit = { patientId: currentPatientId, patientName: currentPatient.name || '', visitDate: value('ancVisitDate'), gestationalWeeks: Number(value('ancGestationalWeeks')) || 0, weight: Number(value('ancWeight')) || null, bpSystolic: Number(value('ancBpSystolic')) || null, bpDiastolic: Number(value('ancBpDiastolic')) || null, fundalHeight: Number(value('ancFundalHeight')) || null, fetalHeartRate: Number(value('ancFetalHeartRate')) || null, hb: Number(value('ancHb')) || null, urineAlbumin: value('ancUrineAlbumin'), complaints: value('ancComplaints'), advice: value('ancAdvice'), nextVisitDate: value('ancNextVisitDate') || null, recordedBy: (firebase.auth().currentUser || {}).email || '', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    db.collection('ancVisits').add(visit).then(function() { return db.collection('patients').doc(currentPatientDocId).update({ nextVisitDate: visit.nextVisitDate, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); }).then(function() { showToast('ANC visit saved.', 'success'); event.target.reset(); document.getElementById('ancVisitDate').value = todayIso(); }).catch(function(err) { showToast('Could not save ANC visit: ' + err.message, 'error'); });
}

function chartSvg(visits, keys, colors) {
    var points = visits.filter(function(v) { return keys.some(function(k) { return v[k] != null; }); });
    if (!points.length) return '<p style="padding:20px;color:var(--text-muted);">No trend data yet.</p>';
    var values = points.flatMap(function(v) { return keys.map(function(k) { return Number(v[k]); }).filter(Number.isFinite); }); var min = Math.min.apply(null, values), max = Math.max.apply(null, values); if (min === max) { min -= 1; max += 1; }
    var poly = function(key) { return points.map(function(v, i) { var x = 25 + i * (250 / Math.max(points.length - 1, 1)); var y = 115 - ((Number(v[key]) - min) / (max - min) * 90); return Number.isFinite(y) ? x.toFixed(1) + ',' + y.toFixed(1) : ''; }).filter(Boolean).join(' '); };
    return '<svg viewBox="0 0 300 140" role="img" aria-label="ANC trend chart" style="width:100%;height:150px"><line x1="25" y1="115" x2="280" y2="115" stroke="#cbd5e1"/><line x1="25" y1="15" x2="25" y2="115" stroke="#cbd5e1"/>' + keys.map(function(k, i) { return '<polyline fill="none" stroke="' + colors[i] + '" stroke-width="3" points="' + poly(k) + '"/>'; }).join('') + '<text x="25" y="132" font-size="10" fill="#64748b">' + escapeHtml(points[0].visitDate || '') + '</text><text x="220" y="132" font-size="10" fill="#64748b">' + escapeHtml(points[points.length - 1].visitDate || '') + '</text></svg>';
}

function loadAncVisits() {
    db.collection('ancVisits').where('patientId', '==', currentPatientId).orderBy('visitDate', 'desc').onSnapshot(function(snap) {
        var visits = []; snap.forEach(function(doc) { visits.push(Object.assign({ id: doc.id }, doc.data())); });
        var body = document.getElementById('tbodyAncVisits'); if (!body) return; body.innerHTML = visits.length ? visits.map(function(v) { return '<tr><td>' + escapeHtml(v.visitDate || '—') + '</td><td>' + escapeHtml(v.gestationalWeeks ?? '—') + '</td><td>' + escapeHtml(v.weight ?? '—') + '</td><td>' + escapeHtml(v.bpSystolic ?? '—') + '/' + escapeHtml(v.bpDiastolic ?? '—') + '</td><td>' + escapeHtml(v.fundalHeight ?? '—') + '</td><td>' + escapeHtml(v.fetalHeartRate ?? '—') + '</td><td>' + escapeHtml(v.hb ?? '—') + '</td><td>' + escapeHtml(v.urineAlbumin || '—') + '</td><td>' + escapeHtml(v.nextVisitDate || '—') + '</td></tr>'; }).join('') : '<tr><td colspan="9" style="text-align:center">No ANC visits recorded.</td></tr>';
        var ordered = visits.slice().reverse(); document.getElementById('ancWeightChart').innerHTML = chartSvg(ordered, ['weight'], ['#D6336C']); document.getElementById('ancBpChart').innerHTML = chartSvg(ordered, ['bpSystolic', 'bpDiastolic'], ['#D6336C', '#F783AC']);
    }, function(err) { console.error('ANC visits:', err); });
}

function closeDeliveryModal() { document.getElementById('deliveryModal').classList.remove('active'); }
window.closeDeliveryModal = closeDeliveryModal;
function addBabyForm() {
    var holder = document.getElementById('deliveryBabies'), card = document.createElement('div'); card.className = 'card'; card.style.marginTop = '12px';
    card.innerHTML = '<div class="modal-body"><div class="form-grid"><div class="form-group"><label>Gender</label><select class="babyGender"><option>Female</option><option>Male</option><option>Other</option></select></div><div class="form-group"><label>Birth weight (kg)</label><input class="babyWeight" type="number" step="0.01" required></div><div class="form-group"><label>Length (cm)</label><input class="babyLength" type="number" step="0.1"></div><div class="form-group"><label>APGAR 1 min</label><input class="babyApgar1" type="number" min="0" max="10"></div><div class="form-group"><label>APGAR 5 min</label><input class="babyApgar5" type="number" min="0" max="10"></div><div class="form-group"><label>Immediate cry</label><select class="babyCry"><option value="yes">Yes</option><option value="no">No</option></select></div><div class="form-group"><label>Feeding type</label><select class="babyFeeding"><option>Breastfeeding</option><option>Formula</option><option>Mixed</option></select></div><div class="form-group"><label>Condition</label><input class="babyCondition" value="Stable"></div><div class="form-group"><label>Time of birth</label><input class="babyTime" type="time"></div><div class="form-group full-width"><label>Notes / congenital anomalies</label><input class="babyNotes"></div></div></div>'; holder.appendChild(card);
}
function openDeliveryModal() { var form=document.getElementById('deliveryForm'); form.reset(); document.getElementById('deliveryBabies').innerHTML=''; document.getElementById('deliveryDate').value=todayIso(); document.getElementById('deliveryWeeks').value=(gestationalAge(currentPatient.lmp) || {}).weeks || ''; document.getElementById('deliveryDoctor').value=currentPatient.doctor || currentPatient.doctorName || ''; addBabyForm(); document.getElementById('deliveryModal').classList.add('active'); }
function saveDelivery(event) {
    event.preventDefault(); var v=function(id){return document.getElementById(id).value.trim();}, ref=db.collection('deliveries').doc(), batch=db.batch();
    batch.set(ref,{patientId:currentPatientId,patientName:currentPatient.name || '',deliveryDate:v('deliveryDate'),deliveryType:v('deliveryType'),deliveryTime:v('deliveryTime'),gestationalWeeksAtDelivery:Number(v('deliveryWeeks')) || 0,conductedBy:v('deliveryDoctor'),placeOfDelivery:v('deliveryPlace'),motherCondition:v('motherCondition'),complications:v('deliveryComplications'),bloodLoss:Number(v('deliveryBloodLoss')) || 0,notes:v('deliveryNotes'),recordedBy:(firebase.auth().currentUser || {}).email || '',createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    document.querySelectorAll('#deliveryBabies > .card').forEach(function(card){var q=function(s){return card.querySelector(s).value.trim();}; batch.set(db.collection('babies').doc(),{deliveryId:ref.id,motherPatientId:currentPatientId,motherName:currentPatient.name || '',babyGender:q('.babyGender'),birthWeight:Number(q('.babyWeight')) || 0,babyLength:Number(q('.babyLength')) || null,apgarScore1min:Number(q('.babyApgar1')) || null,apgarScore5min:Number(q('.babyApgar5')) || null,cryImmediate:q('.babyCry'),feedingType:q('.babyFeeding'),babyCondition:q('.babyCondition'),timeOfBirth:q('.babyTime'),notes:q('.babyNotes'),immunizations:[{name:'BCG',given:false,dateGiven:''},{name:'OPV-0',given:false,dateGiven:''},{name:'Hep-B Birth',given:false,dateGiven:''}],createdAt:firebase.firestore.FieldValue.serverTimestamp()});});
    batch.update(db.collection('patients').doc(currentPatientDocId),{isPregnant:false,status:'postnatal',deliveryId:ref.id,nextVisitDate:null,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    batch.commit().then(function(){currentPatient.isPregnant=false;currentPatient.status='postnatal';renderHeaderCard();closeDeliveryModal();loadBabies();showToast('Delivery and newborn record saved.','success');}).catch(function(err){showToast('Could not save delivery: '+err.message,'error');});
}
function loadBabies() {
    db.collection('babies').where('motherPatientId', '==', currentPatientId).orderBy('createdAt', 'desc').onSnapshot(function(snap) {
        var babies = [];
        snap.forEach(function(doc) { babies.push(Object.assign({ id: doc.id }, doc.data())); });
        var tab = document.getElementById('babiesTabButton');
        var out = document.getElementById('babiesList');
        if (!tab || !out) return;
        tab.style.display = babies.length ? 'flex' : 'none';

        // The mother's own delivery certificate hangs off the delivery record,
        // not the newborn, so it is offered once above the list.
        var deliveryLink = currentPatient.deliveryId
            ? '<div style="margin-bottom:12px;"><a class="btn-secondary" href="certificates.html?type=delivery&source='
                + encodeURIComponent(currentPatient.deliveryId) + '" style="padding:6px 12px;font-size:12px;text-decoration:none;">'
                + '<i class="fa-solid fa-hospital-user"></i> Delivery certificate for ' + escapeHtml(currentPatient.name || 'mother') + '</a></div>'
            : '';

        out.innerHTML = deliveryLink + babies.map(function(baby) {
            return '<div class="card" style="margin-bottom:15px"><div class="modal-body">'
                + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">'
                + '<div><strong>' + escapeHtml(baby.babyGender || 'Baby') + '</strong> · '
                + escapeHtml(baby.birthWeight ?? '—') + ' kg · APGAR '
                + escapeHtml(baby.apgarScore1min ?? '—') + '/' + escapeHtml(baby.apgarScore5min ?? '—')
                + '<br><small>' + escapeHtml(baby.feedingType || '') + ' · ' + escapeHtml(baby.babyCondition || '') + '</small></div>'
                + '<a class="btn-secondary" href="certificates.html?type=birth&source=' + encodeURIComponent(baby.id) + '" '
                + 'style="padding:6px 12px;font-size:12px;text-decoration:none;white-space:nowrap;">'
                + '<i class="fa-solid fa-certificate"></i> Birth certificate</a>'
                + '</div></div></div>';
        }).join('');
    }, function(err) { console.error('Baby records:', err); });
}
document.getElementById('addBabyBtn').addEventListener('click',addBabyForm);
document.getElementById('deliveryForm').addEventListener('submit',saveDelivery);

// 3. Render Patient Header Card with custom badges
function renderHeaderCard() {
    if (!currentPatient) return;
    
    // Compute age from Date of Birth
    const age = calculateAge(currentPatient.dob);
    
    document.getElementById('pName').textContent = currentPatient.name || '—';
    document.getElementById('pIdBadge').textContent = currentPatient.patientId || '—';
    document.getElementById('pAge').textContent = age;
    document.getElementById('pGender').textContent = currentPatient.gender || '—';
    document.getElementById('pBlood').textContent = currentPatient.bloodGroup || '—';
    var femaleDetails = document.getElementById('profileFemaleDetails');
    if (!femaleDetails) {
        femaleDetails = document.createElement('div'); femaleDetails.id = 'profileFemaleDetails';
        femaleDetails.style.cssText = 'padding:12px;margin-top:12px;background:#fff1f6;border-radius:8px;white-space:pre-wrap;font-size:13px;';
        document.getElementById('pAddress').parentElement.appendChild(femaleDetails);
    }
    femaleDetails.hidden = currentPatient.gender !== 'Female';
    femaleDetails.textContent = 'Marital status: ' + (currentPatient.maritalStatus || 'Not stated')
        + '\nSpouse / partner: ' + (currentPatient.spouseName || 'Not stated')
        + '\nGynaecological / menstrual history: ' + (currentPatient.femaleHistory || 'Not recorded');
    document.getElementById('pPhone').textContent = currentPatient.phone || '—';
    document.getElementById('pAddress').textContent = currentPatient.address || '—';
    
    var emName = currentPatient.emergencyContact || '';
    var emPhone = currentPatient.emergencyPhone || '';
    var emStr = '—';
    if (emName || emPhone) {
        emStr = (emName + ' ' + (emPhone ? '(' + emPhone + ')' : '')).trim();
    }
    document.getElementById('pEmergency').textContent = emStr;
    
    var docName = currentPatient.doctor || currentPatient.doctorName || currentPatient.assignedDoctor || '—';
    document.getElementById('pDoctor').textContent = docName;
    document.getElementById('pDept').textContent = currentPatient.department || '—';
    
    // Status Badge Render
    var status = (currentPatient.status || 'opd').toLowerCase();
    var pStatusBadge = document.getElementById('pStatusBadge');
    if (pStatusBadge) {
        pStatusBadge.innerHTML = getPatientStatusBadge(status);
    }
    
    // Action Buttons
    var consultBtn = document.getElementById('actionConsult');
    var newBillBtn = document.getElementById('actionNewBill');
    var uploadReportBtn = document.getElementById('actionUploadReport');
    var admitBtn = document.getElementById('actionAdmitIPD');
    var moveERBtn = document.getElementById('actionMoveER');
    var deliveryBtn = document.getElementById('actionDeliveryRecord');

    if (currentUserRole === 'owner') {
        if (consultBtn) consultBtn.style.display = 'none';
        if (newBillBtn) newBillBtn.style.display = 'none';
        if (uploadReportBtn) uploadReportBtn.style.display = 'none';
        if (admitBtn) admitBtn.style.display = 'none';
        if (moveERBtn) moveERBtn.style.display = 'none';
        if (deliveryBtn) deliveryBtn.style.display = 'none';
    } else {
        if (consultBtn) {
            consultBtn.href = `consultation.html?patientId=${currentPatientId}`;
            if (['nurse', 'billing_staff'].includes(currentUserRole)) consultBtn.style.display = 'none';
        }
        if (newBillBtn) {
            newBillBtn.href = `billing.html?patientId=${currentPatientId}&autoOpen=true`;
            if (['doctor', 'nurse'].includes(currentUserRole)) newBillBtn.style.display = 'none';
        }
        if (uploadReportBtn) {
            uploadReportBtn.href = `lab-reports.html?patientId=${currentPatientId}&autoOpen=true`;
            if (['billing_staff'].includes(currentUserRole)) uploadReportBtn.style.display = 'none';
        }
        if (deliveryBtn) {
            deliveryBtn.style.display = currentPatient.isPregnant ? 'inline-flex' : 'none';
            deliveryBtn.onclick = openDeliveryModal;
        }
        var dischargeBtn = document.getElementById('actionDischarge');
        if (dischargeBtn) dischargeBtn.href = 'discharge.html?patientId=' + encodeURIComponent(currentPatientId || '');
        var partoBtn = document.getElementById('actionPartograph');
        if (partoBtn) {
            partoBtn.style.display = currentPatient.isPregnant ? 'inline-flex' : 'none';
            partoBtn.href = 'partograph.html?patientId=' + encodeURIComponent(currentPatientId || '');
        }
        var pinBtn = document.getElementById('actionPortalPin');
        if (pinBtn) pinBtn.onclick = setPatientPortalPinFromProfile;
        if (status === 'opd') {
            if (admitBtn) admitBtn.style.display = 'inline-flex';
            if (moveERBtn) moveERBtn.style.display = 'inline-flex';
        } else {
            if (admitBtn) admitBtn.style.display = 'none';
            if (moveERBtn) moveERBtn.style.display = 'none';
        }
    }
}

// 4. Tab 1 - Load Patient Visits & Bills
function loadPatientBills(patientId) {
    setLoadingRow('tbodyVisits', 7);
    db.collection('bills')
        .where('patientId', '==', patientId)
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            const tbody = document.getElementById('tbodyVisits');
            if (!tbody) return;
            
            if (snapshot.empty) {
                setEmptyRow('tbodyVisits', 'No billing/visit history found for this patient.', 7);
                document.getElementById('statBillsCount').textContent = '0';
                document.getElementById('statBillsAmount').textContent = '₹0.00 total';
                document.getElementById('statUnpaidAmount').textContent = '₹0.00';
                document.getElementById('statUnpaidCount').textContent = '0 pending payments';
                return;
            }
            
            tbody.innerHTML = '';
            let totalAmountBilled = 0;
            let totalUnpaidAmount = 0;
            let unpaidCount = 0;
            let count = 0;
            // Reset on each snapshot so Admit/ER buttons always use latest bill
            latestOPDBillDocId = null;
            
            snapshot.forEach(doc => {
                count++;
                const bill = { id: doc.id, ...doc.data() };
                totalAmountBilled += (bill.grandTotal || 0);
                
                // Track latest OPD bill doc id for admit/move operations
                if ((bill.type || '').toLowerCase() === 'opd' && !latestOPDBillDocId) {
                    latestOPDBillDocId = bill.id;
                }
                
                const payStat = (bill.paymentStatus || 'unpaid').toLowerCase();
                if (payStat === 'unpaid' || payStat === 'partial' || payStat === 'due') {
                    const outstanding = (bill.grandTotal || 0) - (bill.amountPaid || 0);
                    if (outstanding > 0) {
                        totalUnpaidAmount += outstanding;
                        unpaidCount++;
                    }
                }
                
                let actionBtn = `<a href="billing.html?billId=${bill.id}" class="btn-view-pdf" style="padding:4px 8px;font-size:0.8rem;margin-right:4px;"><i class="fa-solid fa-eye"></i> View</a>` +
                `<button class="btn-download-pdf" data-bill-id="${bill.id}" style="background:#DC2626;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:4px;">
                    <i class="fa-solid fa-file-pdf"></i> PDF
                </button>`;
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${bill.billId || bill.id.substring(0,8)}</strong></td>
                    <td><span style="font-weight:500; background:#f3f4f6; padding: 2px 8px; border-radius:12px; font-size:11px; text-transform:uppercase;">${bill.type || 'OPD'}</span></td>
                    <td><strong>${formatCurrency(bill.grandTotal)}</strong></td>
                    <td>${getPaymentStatusBadge(bill.paymentStatus || bill.status)}</td>
                    <td>${getReportStatusBadge(bill.reportStatus)}</td>
                    <td>${formatDate(bill.createdAt)}</td>
                    <td>${actionBtn}</td>
                `;
                tbody.appendChild(tr);
            });
            
            // Attach PDF download listeners
            document.querySelectorAll('.btn-download-pdf').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var billId = this.dataset.billId;
                    generateBillPDF(billId);
                });
            });
            
            // Render Bills & Outstanding Stats Cards
            document.getElementById('statBillsCount').textContent = count;
            document.getElementById('statBillsAmount').textContent = formatCurrency(totalAmountBilled) + ' total';
            
            document.getElementById('statUnpaidAmount').textContent = formatCurrency(totalUnpaidAmount);
            document.getElementById('statUnpaidCount').textContent = unpaidCount + ' pending payments';
            
        }, err => {
            console.error('Error loading bills:', err);
            setEmptyRow('tbodyVisits', 'Error loading billing history.', 7);
        });
}

// 5. Tab 2 - Load Patient Lab Reports
function loadPatientReports(patientId) {
    setLoadingRow('tbodyLabs', 7);
    db.collection('reports')
        .where('patientId', '==', patientId)
        .where('type', '==', 'lab')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            const tbody = document.getElementById('tbodyLabs');
            if (!tbody) return;
            
            if (snapshot.empty) {
                setEmptyRow('tbodyLabs', 'No lab reports found for this patient.', 7);
                return;
            }
            
            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const rep = { id: doc.id, ...doc.data() };
                
                let viewPdfBtn = '—';
                if (rep.reportUrl || rep.uploadedReport) {
                    viewPdfBtn = `<a href="${rep.reportUrl || rep.uploadedReport}" target="_blank" class="btn-view-pdf"><i class="fa-solid fa-file-pdf"></i> View PDF</a>`;
                }
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${rep.reportId || rep.id.substring(0,8)}</strong></td>
                    <td>${rep.testName || '—'}</td>
                    <td>${rep.referredBy || rep.doctor || '—'}</td>
                    <td>${formatDate(rep.createdAt || rep.reportDate)}</td>
                    <td><span style="font-weight:600;padding:2px 8px;border-radius:12px;font-size:11px;background:#e2e8f0;color:#475569;text-transform:capitalize;">${rep.status || 'pending'}</span></td>
                    <td><span style="font-weight:600;padding:2px 8px;border-radius:12px;font-size:11px;background:#fef3c7;color:#d97706;text-transform:capitalize;">${rep.billingStatus || 'unbilled'}</span></td>
                    <td>${viewPdfBtn}</td>
                `;
                tbody.appendChild(tr);
            });
        }, err => {
            console.error('Error loading lab reports:', err);
            setEmptyRow('tbodyLabs', 'Error loading lab reports.', 7);
        });
}

// 6. Tab 3 - Load Patient Imaging Reports
function loadPatientImaging(patientId) {
    setLoadingRow('tbodyImaging', 6);
    db.collection('reports')
        .where('patientId', '==', patientId)
        .where('type', '==', 'imaging')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            const tbody = document.getElementById('tbodyImaging');
            if (!tbody) return;
            
            if (snapshot.empty) {
                setEmptyRow('tbodyImaging', 'No imaging reports found for this patient.', 6);
                return;
            }
            
            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const rep = { id: doc.id, ...doc.data() };
                
                let actionBtns = '';
                if (rep.imageUrl || rep.uploadedImage) {
                    actionBtns += `<a href="${rep.imageUrl || rep.uploadedImage}" target="_blank" class="btn-view-pdf" style="margin-right:6px;"><i class="fa-solid fa-image"></i> View Image</a>`;
                }
                if (rep.reportUrl || rep.uploadedReport) {
                    actionBtns += `<a href="${rep.reportUrl || rep.uploadedReport}" target="_blank" class="btn-view-pdf"><i class="fa-solid fa-file-waveform"></i> View Report</a>`;
                }
                if (!actionBtns) actionBtns = '—';
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${rep.reportId || rep.id.substring(0,8)}</strong></td>
                    <td>${rep.testName || 'Imaging Scan'}</td>
                    <td>${rep.referredBy || rep.doctor || '—'}</td>
                    <td>${formatDate(rep.createdAt || rep.reportDate)}</td>
                    <td><span style="font-weight:600;padding:2px 8px;border-radius:12px;font-size:11px;background:#e2e8f0;color:#475569;text-transform:capitalize;">${rep.status || 'pending'}</span></td>
                    <td>${actionBtns}</td>
                `;
                tbody.appendChild(tr);
            });
        }, err => {
            console.error('Error loading imaging:', err);
            setEmptyRow('tbodyImaging', 'Error loading imaging studies.', 6);
        });
}

// 7. Tab 4 - Load Dispensing History (Medicines)
function loadPatientMedicines(patientId) {
    setLoadingRow('tbodyMedicines', 7);
    db.collection('dispensingHistory')
        .where('patientId', '==', patientId)
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            const tbody = document.getElementById('tbodyMedicines');
            if (!tbody) return;
            
            if (snapshot.empty) {
                setEmptyRow('tbodyMedicines', 'No dispensing history found for this patient.', 7);
                return;
            }
            
            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const rec = { id: doc.id, ...doc.data() };
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${rec.medicineName || '—'}</strong></td>
                    <td>${rec.quantity || 0}</td>
                    <td><strong>${formatCurrency(rec.totalAmount || rec.amount || 0)}</strong></td>
                    <td>${rec.prescribedBy || '—'}</td>
                    <td>${rec.dispensedBy || '—'}</td>
                    <td><span style="font-weight:600;padding:2px 8px;border-radius:12px;font-size:11px;background:#dcfce7;color:#15803d;text-transform:capitalize;">${rec.paymentStatus || 'paid'}</span></td>
                    <td>${formatDate(rec.createdAt)}</td>
                `;
                tbody.appendChild(tr);
            });
        }, err => {
            console.error('Error loading medicines:', err);
            setEmptyRow('tbodyMedicines', 'Error loading dispensing history.', 7);
        });
}

// 8. Tab 5 - Load Patient Admissions History
function loadPatientAdmissions(patientId) {
    setLoadingRow('tbodyAdmissions', 9);
    db.collection('admissions')
        .where('patientId', '==', patientId)
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            const tbody = document.getElementById('tbodyAdmissions');
            if (!tbody) return;
            
            if (snapshot.empty) {
                setEmptyRow('tbodyAdmissions', 'No admissions history found for this patient.', 9);
                return;
            }
            
            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const adm = { id: doc.id, ...doc.data() };
                
                const admDate = adm.admittedAt ? formatDate(adm.admittedAt) : (adm.createdAt ? formatDate(adm.createdAt) : '—');
                const disDate = adm.dischargedAt ? formatDate(adm.dischargedAt) : (adm.expectedDischargeDate ? formatDate(adm.expectedDischargeDate) + ' (Est)' : '—');
                
                const tr = document.createElement('tr');
                const notes = adm.clinicalNotes || adm.progressNote || '';
                tr.innerHTML = `
                    <td><strong>${adm.admissionId || adm.id.substring(0,8)}</strong></td>
                    <td>${adm.ward || '—'}</td>
                    <td>Bed ${adm.bedNumber || adm.bed || '—'}</td>
                    <td>${adm.doctorName || adm.assignedDoctor || '—'}</td>
                    <td>${admDate}</td>
                    <td>${disDate}</td>
                    <td><span style="font-weight:600;padding:2px 8px;border-radius:12px;font-size:11px;background:#f8fafc;color:#334155;border:1px solid #e2e8f0;text-transform:uppercase;">${adm.status || 'admitted'}</span></td>
                    <td><strong>${formatCurrency(adm.dailyRate || 0)}</strong></td>
                    <td>
                        <div style="font-size:12px;color:#475569;max-width:160px;">${escapeHtml((notes || '—').substring(0, 80))}${notes && notes.length > 80 ? '…' : ''}</div>
                        <button type="button" class="btn-secondary" style="padding:3px 8px;font-size:11px;margin-top:4px;" onclick="updateInpatientRecord('${adm.id}')">Update record</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }, err => {
            console.error('Error loading admissions:', err);
            setEmptyRow('tbodyAdmissions', 'Error loading admissions log.', 9);
        });
}

window.updateInpatientRecord = function (admissionId) {
    var note = prompt('Inpatient progress / clinical update (saved to admission record):');
    if (note === null) return;
    note = String(note).trim();
    if (!note) { showToast('Note required.', 'warning'); return; }
    var stamp = new Date().toLocaleString('en-IN');
    db.collection('admissions').doc(admissionId).get().then(function (doc) {
        if (!doc.exists) throw new Error('Admission not found');
        var prev = doc.data().clinicalNotes || '';
        var merged = (prev ? (prev + '\n') : '') + '[' + stamp + '] ' + note;
        return db.collection('admissions').doc(admissionId).update({
            clinicalNotes: merged,
            progressNote: note,
            lastClinicalUpdateAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastClinicalUpdateBy: (typeof currentUserEmail !== 'undefined' ? currentUserEmail : '') || ''
        });
    }).then(function () {
        if (typeof writeAuditLog === 'function') {
            writeAuditLog({ action: 'inpatient_record_update', admissionId: admissionId, patientId: currentPatientId || '', reason: note });
        }
        showToast('Inpatient record updated.', 'success');
    }).catch(function (err) { showToast(err.message, 'error'); });
};

// 9. Auxiliary Loader for Counts & Sums
function loadSummaryStats() {
    // Lab Count
    db.collection('reports')
        .where('patientId', '==', currentPatientId)
        .where('type', '==', 'lab')
        .get()
        .then(snap => {
            document.getElementById('statLabCount').textContent = snap.size;
        }).catch(err => console.error(err));
        
    // Medicines count
    db.collection('dispensingHistory')
        .where('patientId', '==', currentPatientId)
        .get()
        .then(snap => {
            document.getElementById('statMedsCount').textContent = snap.size;
        }).catch(err => console.error(err));
}

// 10. Status and Badge Layout Helpers
function getPatientStatusBadge(status) {
    return statusBadge(status, 'opd');
}

function getPaymentStatusBadge(status) {
    return statusBadge(status, 'unpaid');
}

function getReportStatusBadge(status) {
    return statusBadge(status, 'not_applicable');
}

// 11. Quick Action Event Listeners
document.getElementById('actionAdmitIPD').addEventListener('click', function() {
    if (!latestOPDBillDocId) {
        db.collection('bills')
            .where('patientId', '==', currentPatientId)
            .where('type', '==', 'OPD')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get()
            .then(snap => {
                if (snap.empty) {
                    showToast('No active OPD bill found for this patient. Please create a bill first.', 'warning');
                } else {
                    var billId = snap.docs[0].id;
                    window.location.href = `billing.html?admitBillId=${billId}`;
                }
            }).catch(err => {
                console.error(err);
                showToast('Error finding active bill.', 'error');
            });
    } else {
        window.location.href = `billing.html?admitBillId=${latestOPDBillDocId}`;
    }
});

document.getElementById('actionMoveER').addEventListener('click', function() {
    if (!latestOPDBillDocId) {
        db.collection('bills')
            .where('patientId', '==', currentPatientId)
            .where('type', '==', 'OPD')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get()
            .then(snap => {
                if (snap.empty) {
                    showToast('No active OPD bill found for this patient. Please create a bill first.', 'warning');
                } else {
                    var billId = snap.docs[0].id;
                    window.location.href = `billing.html?moveERBillId=${billId}`;
                }
            }).catch(err => {
                console.error(err);
                showToast('Error finding active bill.', 'error');
            });
    } else {
        window.location.href = `billing.html?moveERBillId=${latestOPDBillDocId}`;
    }
});

// 12. Tab switching logic
document.querySelectorAll('#profileTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // Toggle active button
        document.querySelectorAll('#profileTabs .tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        // Toggle active content pane
        const targetTabId = this.dataset.tab;
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById(targetTabId).classList.add('active');
        
        // Load data on click
        if (targetTabId === 'tab-visits') {
            loadPatientBills(currentPatientId);
        } else if (targetTabId === 'tab-labs') {
            loadPatientReports(currentPatientId);
        } else if (targetTabId === 'tab-imaging') {
            loadPatientImaging(currentPatientId);
        } else if (targetTabId === 'tab-medicines') {
            loadPatientMedicines(currentPatientId);
        } else if (targetTabId === 'tab-admissions') {
            loadPatientAdmissions(currentPatientId);
        }
    });
});

function setPatientPortalPinFromProfile() {
    if (!currentPatientDocId || !currentPatientId) {
        showToast('Patient not loaded.', 'warning');
        return;
    }
    var pin = prompt('Set a 4–8 digit portal PIN for ' + (currentPatient.name || currentPatientId) + '.\nShare Patient ID + PIN with the attendant.\nPortal URL: portal.html');
    if (pin == null) return;
    pin = String(pin).trim();
    if (!/^\d{4,8}$/.test(pin)) {
        showToast('PIN must be 4–8 digits.', 'error');
        return;
    }
    callFunction('setPatientPortalPin', { patientDocId: currentPatientDocId, pin: pin })
        .then(function () {
            showToast('Portal PIN set. Patient can open portal.html with ID ' + currentPatientId, 'success');
        })
        .catch(function (err) {
            showToast(err.message || 'Could not set portal PIN.', 'error');
        });
}
window.setPatientPortalPinFromProfile = setPatientPortalPinFromProfile;
