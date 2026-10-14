// OT Schedule Page Logic
var otUnsubscribe = null;
var currentUserRole = '';
var currentDoctorName = '';

function updateOtDaySummary(rows, dateStr) {
    var el = document.getElementById('otDaySummary');
    if (!el) return;
    var total = rows.length;
    var scheduled = rows.filter(function (r) { return (r.status || '') === 'scheduled' || (r.status || '') === 'booked'; }).length;
    var inOt = rows.filter(function (r) { return (r.status || '') === 'in_surgery'; }).length;
    var done = rows.filter(function (r) { return (r.status || '') === 'completed'; }).length;
    var cancelled = rows.filter(function (r) { return /cancel/i.test(r.status || ''); }).length;
    var procs = {};
    rows.forEach(function (r) {
        var p = r.procedureType || 'Other';
        procs[p] = (procs[p] || 0) + 1;
    });
    var top = Object.keys(procs).sort(function (a, b) { return procs[b] - procs[a]; }).slice(0, 3)
        .map(function (k) { return k + ' (' + procs[k] + ')'; }).join(' · ') || '—';
    el.innerHTML = '<div class="classic-panel" style="padding:14px 16px;margin-bottom:16px;">'
        + '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;">'
        + '<strong style="font-size:14px;">OT summary — ' + escapeHtml(dateStr || '') + '</strong>'
        + '<span style="font-size:12px;color:#64748b;">Top procedures: ' + escapeHtml(top) + '</span></div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px;">'
        + '<div><div style="font-size:11px;color:#64748b;text-transform:uppercase;">Total</div><div style="font-size:1.4rem;font-weight:700;">' + total + '</div></div>'
        + '<div><div style="font-size:11px;color:#64748b;text-transform:uppercase;">Scheduled</div><div style="font-size:1.4rem;font-weight:700;">' + scheduled + '</div></div>'
        + '<div><div style="font-size:11px;color:#64748b;text-transform:uppercase;">In OT</div><div style="font-size:1.4rem;font-weight:700;">' + inOt + '</div></div>'
        + '<div><div style="font-size:11px;color:#64748b;text-transform:uppercase;">Completed</div><div style="font-size:1.4rem;font-weight:700;">' + done + '</div></div>'
        + '<div><div style="font-size:11px;color:#64748b;text-transform:uppercase;">Cancelled</div><div style="font-size:1.4rem;font-weight:700;">' + cancelled + '</div></div>'
        + '</div></div>';
}

document.addEventListener('DOMContentLoaded', function() {
    checkAccess(['admin', 'doctor', 'receptionist']);
    
    // Set default date to today
    const dateInput = document.getElementById('otScheduleDate');
    const todayStr = todayIso();
    dateInput.value = todayStr;
    
    // Listen for date change
    dateInput.addEventListener('change', function() {
        loadOTSchedule(this.value);
    });
    var procFilter = document.getElementById('otProcedureFilter');
    var viewMode = document.getElementById('otViewMode');
    if (procFilter) procFilter.addEventListener('change', function () { loadOTSchedule(dateInput.value); });
    if (viewMode) viewMode.addEventListener('change', function () { loadOTSchedule(dateInput.value); });
    loadServiceCatalogOptions(procFilter).then(function () {
        if (!procFilter) return;
        // Ensure first option is All
        if (!procFilter.querySelector('option[value=""]')) {
            var opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'All procedures';
            procFilter.insertBefore(opt, procFilter.firstChild);
        } else {
            procFilter.querySelector('option[value=""]').textContent = 'All procedures';
        }
        procFilter.value = '';
    });
    
    // Get user role
    getCurrentUser(function(user) {
        currentUserRole = (user.role || '').toLowerCase();
        currentDoctorName = user.name || '';
        
        // Hide Book OT button for receptionist. The id here was stale, so the
        // button stayed visible to every role.
        const btnBook = document.getElementById('btnScheduleOT')
            || document.getElementById('btnOpenBookOTModal')
            || document.getElementById('btnBookOT');
        if (btnBook && currentUserRole === 'receptionist') {
            btnBook.style.display = 'none';
        }
        
        loadOTSchedule(todayStr);
    });
});

function loadOTSchedule(dateStr) {
    if (otUnsubscribe) otUnsubscribe();
    
    const tbody = document.getElementById('otScheduleBody');
    const board = document.getElementById('otBoardSections');
    const listCard = document.getElementById('otListCard');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#888;">Loading scheduled procedures...</td></tr>';
    if (board) board.innerHTML = '';
    
    otUnsubscribe = db.collection('otBookings')
        .where('scheduledDate', '==', dateStr)
        .orderBy('createdAt', 'desc')
        .onSnapshot(snap => {
            var procFilterVal = (document.getElementById('otProcedureFilter') || {}).value || '';
            var viewMode = (document.getElementById('otViewMode') || {}).value || 'byRoom';
            var rows = [];
            snap.forEach(doc => {
                const booking = Object.assign({ _id: doc.id }, doc.data());
                if (currentUserRole === 'doctor' && 
                    (booking.surgeonName || '').trim().toLowerCase() !== currentDoctorName.trim().toLowerCase() &&
                    (booking.surgeon || '').trim().toLowerCase() !== currentDoctorName.trim().toLowerCase()) {
                    return;
                }
                if (procFilterVal && String(booking.procedureType || '') !== procFilterVal) return;
                rows.push(booking);
            });

            rows.sort(function (a, b) {
                return String(a.scheduledTime || '').localeCompare(String(b.scheduledTime || ''));
            });

            updateOtDaySummary(rows, dateStr);

            function rowHtml(booking) {
                let statusClass = 'status-pending';
                if (booking.status === 'completed') statusClass = 'status-active';
                else if (booking.status === 'in_surgery') statusClass = 'status-pending';
                let actionBtn = '—';
                const canComplete = ['admin', 'doctor'].includes(currentUserRole);
                if (booking.status !== 'completed' && canComplete) {
                    actionBtn = `
                        <button class="btn-primary" onclick="openCompleteOTModalFromSchedule('${booking._id}', '${booking.billDocId || ''}', '${booking.patientDocId || ''}', '${booking.patientId || ''}', '${(booking.patientName || '').replace(/'/g, '')}', '${booking.otRoomId || ''}', '${booking.billId || ''}', '${(booking.otRoomName || '').replace(/'/g, '')}')" style="height:32px; padding:4px 10px; font-size:12px;">
                            <i class="fa-solid fa-circle-check"></i> Complete
                        </button>
                    `;
                }
                return `
                    <td data-label="Time"><strong>${escapeHtml(booking.scheduledTime || '—')}</strong></td>
                    <td data-label="Patient">
                        <strong>${escapeHtml(booking.patientName || '—')}</strong><br>
                        <small style="color:#64748b; font-weight:500;">ID: ${escapeHtml(booking.patientId || '—')}</small>
                    </td>
                    <td data-label="Procedure"><span style="font-weight:600; color:var(--primary-navy);">${escapeHtml(booking.procedureType || '—')}</span></td>
                    <td data-label="Surgeon">Dr. ${escapeHtml((booking.surgeonName || booking.surgeon || '').replace(/^Dr\.\s+/i, ''))}</td>
                    <td data-label="OT Room"><span style="font-weight:600; background:#f1f5f9; padding:2px 8px; border-radius:4px; font-size:12px;">${escapeHtml(booking.otRoomName || '—')}</span></td>
                    <td data-label="Status"><span class="status-badge ${statusClass}">${escapeHtml(booking.status || '—')}</span></td>
                    <td data-label="Action">
                        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                            ${actionBtn}
                            ${typeof addToCalendarLinkHtml === 'function' ? addToCalendarLinkHtml({
                                date: booking.scheduledDate,
                                time: booking.scheduledTime,
                                durationMinutes: 90,
                                title: 'OT: ' + (booking.procedureType || 'Procedure') + ' — ' + (booking.patientName || ''),
                                details: 'Patient ID: ' + (booking.patientId || '')
                                    + '\nSurgeon: ' + (booking.surgeonName || booking.surgeon || '')
                                    + '\nAnaesthetist: ' + (booking.anaesthetistName || '-'),
                                location: booking.otRoomName || 'Operation Theatre'
                            }) : ''}
                        </div>
                    </td>
                `;
            }

            if (viewMode === 'byRoom' && board) {
                listCard.style.display = 'none';
                if (!rows.length) {
                    board.innerHTML = '<div class="card" style="padding:30px;text-align:center;color:#888;">No OT bookings scheduled for this date.</div>';
                    return;
                }
                var byRoom = {};
                rows.forEach(function (b) {
                    var room = b.otRoomName || 'Unassigned';
                    if (!byRoom[room]) byRoom[room] = [];
                    byRoom[room].push(b);
                });
                var html = '';
                Object.keys(byRoom).sort().forEach(function (room) {
                    html += '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">'
                        + '<div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0F2B5B;">'
                        + '<i class="fa-solid fa-door-open" style="color:#0D7A70;margin-right:8px;"></i>' + escapeHtml(room)
                        + ' <span style="font-weight:500;color:#64748b;font-size:12px;">(' + byRoom[room].length + ')</span></div>'
                        + '<div class="table-responsive"><table style="width:100%;border-collapse:collapse;"><thead><tr>'
                        + '<th>Time</th><th>Patient</th><th>Procedure</th><th>Surgeon</th><th>OT Room</th><th>Status</th><th>Action</th>'
                        + '</tr></thead><tbody>';
                    byRoom[room].forEach(function (b) {
                        html += '<tr>' + rowHtml(b) + '</tr>';
                    });
                    html += '</tbody></table></div></div>';
                });
                board.innerHTML = html;
            } else {
                if (board) board.innerHTML = '';
                if (listCard) listCard.style.display = 'block';
                tbody.innerHTML = '';
                if (!rows.length) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#888;">No OT bookings scheduled for this date.</td></tr>';
                    return;
                }
                rows.forEach(function (booking) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = rowHtml(booking);
                    tbody.appendChild(tr);
                });
            }
        }, err => {
            console.error("Error loading OT Schedule:", err);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:red;">Error: ${err.message}</td></tr>`;
        });
}

// Complete OT Modal helpers (re-implemented for schedule page context)
function openCompleteOTModalFromSchedule(bookingId, billDocId, patientDocId, patientId, patientName, otRoomId, billId, otRoomName) {
    document.getElementById('completeOtBookingId').value = bookingId;
    document.getElementById('completeOtBillId').value = billDocId;
    document.getElementById('completeOtPatientDocId').value = patientDocId;
    document.getElementById('completeOtPatientId').value = patientId;
    document.getElementById('completeOtRoomId').value = otRoomId;
    
    document.getElementById('completePatientInfo').innerHTML = `
        <strong>Patient:</strong> ${escapeHtml(patientName)} (${patientId})<br>
        <strong>Procedure Bill:</strong> ${billId || '—'}<br>
        <strong>OT Room:</strong> ${otRoomName || '—'}
    `;
    
    document.getElementById('postOpWardSelect').value = '';
    document.getElementById('postOpBedSelectGroup').style.display = 'none';
    document.getElementById('postOpBedSelect').innerHTML = '<option value="">— Select ward first —</option>';
    
    document.getElementById('completeProcedureModal').style.display = 'flex';
}
window.openCompleteOTModalFromSchedule = openCompleteOTModalFromSchedule;

function loadBedsForPostOp(ward) {
    const bedSelectGroup = document.getElementById('postOpBedSelectGroup');
    const bedSelect = document.getElementById('postOpBedSelect');
    
    if (!ward || ward === 'Discharge') {
        bedSelectGroup.style.display = 'none';
        return;
    }
    
    bedSelect.innerHTML = '<option value="">Loading beds...</option>';
    bedSelectGroup.style.display = 'block';
    
    db.collection('beds')
        .where('ward', '==', ward)
        .where('status', '==', 'available')
        .get()
        .then(snap => {
            bedSelect.innerHTML = '<option value="">Select Bed</option>';
            if (snap.empty) {
                bedSelect.innerHTML = '<option value="">No available beds in this ward</option>';
                return;
            }
            snap.forEach(doc => {
                const bed = doc.data();
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = `${bed.bedNumber} (Rate: ₹${bed.dailyRate || 0}/day)`;
                opt.dataset.bedNumber = bed.bedNumber;
                opt.dataset.dailyRate = bed.dailyRate || 0;
                bedSelect.appendChild(opt);
            });
        }).catch(err => {
            console.error("Error loading post op beds:", err);
            bedSelect.innerHTML = '<option value="">Error loading beds</option>';
        });
}
window.loadBedsForPostOp = loadBedsForPostOp;

async function confirmCompleteProcedure() {
    const bookingId = document.getElementById('completeOtBookingId').value;
    const billId = document.getElementById('completeOtBillId').value; // billDocId
    const patientDocId = document.getElementById('completeOtPatientDocId').value;
    const patientId = document.getElementById('completeOtPatientId').value;
    const otRoomId = document.getElementById('completeOtRoomId').value;
    
    const ward = document.getElementById('postOpWardSelect').value;
    if (!ward) { showToast('Please select a post-op ward or discharge.', 'warning'); return; }
    
    let bedDocId = '';
    let bedNumber = '';
    let dailyRate = 0;
    
    if (ward !== 'Discharge') {
        const bedSel = document.getElementById('postOpBedSelect');
        const bedOpt = bedSel.options[bedSel.selectedIndex];
        bedDocId = bedSel.value;
        if (!bedDocId) { showToast('Please select a bed.', 'warning'); return; }
        bedNumber = bedOpt.dataset.bedNumber || '';
        dailyRate = parseFloat(bedOpt.dataset.dailyRate) || 0;
    }
    
    const btn = document.querySelector('#completeProcedureModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
    
    try {
        const batch = db.batch();
        
        // 1. Mark OT Booking as completed
        if (bookingId) {
            batch.update(db.collection('otBookings').doc(bookingId), {
                status: 'completed',
                completedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        // 2. Release OT Room to cleaning
        if (otRoomId) {
            batch.update(db.collection('beds').doc(otRoomId), {
                status: 'cleaning',
                patientId: null,
                patientDocId: null,
                patientName: null,
                billId: null,
                billDocId: null,
                dischargedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        if (ward === 'Discharge') {
            if (billId) {
                batch.update(db.collection('bills').doc(billId), {
                    isFinalized: true,
                    isRunningBill: false,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            if (patientDocId) {
                batch.update(db.collection('patients').doc(patientDocId), {
                    status: 'discharged',
                    currentBillId: null,
                    currentBedId: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            showToast('Procedure completed. Patient discharged and OT bill finalized.', 'success');
        } else {
            const newType = (ward === 'ICU') ? 'ICU' : 'IPD';
            
            let billData = {};
            if (billId) {
                const billSnap = await db.collection('bills').doc(billId).get();
                billData = billSnap.data() || {};
                const items = billData.items || [];
                
                const addedItem = {
                    category: 'Bed Charges',
                    description: `Bed ${bedNumber} (${ward})`,
                    quantity: 1,
                    unitPrice: dailyRate,
                    amount: dailyRate,
                    addedAt: new Date().toISOString()
                };
                items.push(addedItem);
                
                const newSubtotal = (billData.subtotal || 0) + dailyRate;
                const newGrandTotal = (billData.grandTotal || 0) + dailyRate;
                const newBalanceDue = newGrandTotal - (billData.amountPaid || 0);
                
                batch.update(db.collection('bills').doc(billId), {
                    type: newType,
                    bedDocId: bedDocId,
                    bedNumber: bedNumber,
                    bedWard: ward,
                    dailyRate: dailyRate,
                    admissionDate: todayIso(),
                    items: items,
                    subtotal: newSubtotal,
                    grandTotal: newGrandTotal,
                    balanceDue: newBalanceDue,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            
            const admissionRef = db.collection('admissions').doc();
            batch.update(db.collection('beds').doc(bedDocId), {
                status: 'occupied',
                patientId: patientId,
                patientDocId: patientDocId,
                patientName: billData.patientName || '',
                billId: billData.billId || '',
                billDocId: billId || '',
                admittedAt: todayIso(),
                activeAdmissionId: admissionRef.id,
                assignedBy: currentUserEmail,
                assignedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            batch.set(admissionRef, {
                patientId: patientId,
                patientDocId: patientDocId,
                patientName: billData.patientName || '',
                bedDocId: bedDocId,
                bedNumber: bedNumber,
                ward: ward,
                billId: billData.billId || '',
                billDocId: billId || '',
                dailyRate: dailyRate,
                admissionDate: todayIso(),
                status: 'admitted',
                admittedBy: currentUserEmail,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            if (patientDocId) {
                batch.update(db.collection('patients').doc(patientDocId), {
                    status: (ward === 'ICU') ? 'icu' : 'admitted',
                    currentBedId: bedDocId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            showToast(`Procedure completed. Patient moved to ${ward}. Running bill updated.`, 'success');
        }
        
        await batch.commit();
        document.getElementById('completeProcedureModal').style.display = 'none';
        
        const dateInput = document.getElementById('otScheduleDate');
        loadOTSchedule(dateInput.value);
        
    } catch (err) {
        console.error('Complete procedure error:', err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Complete & Release'; }
    }
}
window.confirmCompleteProcedure = confirmCompleteProcedure;
window.addEventListener('beforeunload', function() {
    if (otUnsubscribe) otUnsubscribe();
});

// ==========================================
// SCHEDULE OT (standalone booking)
// ==========================================
function openScheduleOTModal() {
    var modal = document.getElementById("scheduleOTModal");
    if (!modal) return;
    document.getElementById("otBookPatientSearch").value = "";
    document.getElementById("otBookPatientId").value = "";
    document.getElementById("otBookPatientDocId").value = "";
    document.getElementById("otBookPatientName").value = "";
    document.getElementById("otBookNotes").value = "";
    document.getElementById("otBookAnaesthetist").value = "";
    document.getElementById("otBookDate").value = document.getElementById("otScheduleDate").value || todayIso();
    document.getElementById("otBookTime").value = "10:00";
    loadServiceCatalogOptions(document.getElementById("otBookProcedure"));
    db.collection("staff").where("role", "==", "doctor").get().then(function (snap) {
        var sel = document.getElementById("otBookSurgeon");
        sel.innerHTML = "<option value=\"\">Select surgeon</option>";
        snap.forEach(function (doc) {
            var d = doc.data();
            if (d.isActive === false) return;
            var opt = document.createElement("option");
            opt.value = doc.id;
            opt.textContent = d.name || doc.id;
            opt.setAttribute("data-name", d.name || "");
            sel.appendChild(opt);
        });
    });
    db.collection("beds").where("ward", "==", "Operation Theatre").get().then(function (snap) {
        var sel = document.getElementById("otBookRoom");
        sel.innerHTML = "<option value=\"\">Select room</option>";
        snap.forEach(function (doc) {
            var b = doc.data();
            var opt = document.createElement("option");
            opt.value = doc.id;
            opt.textContent = b.bedNumber || doc.id;
            opt.setAttribute("data-name", b.bedNumber || doc.id);
            sel.appendChild(opt);
        });
        if (!snap.size) {
            ["OT-1", "OT-2", "OT-3"].forEach(function (r) {
                var opt = document.createElement("option");
                opt.value = r; opt.textContent = r; opt.setAttribute("data-name", r);
                sel.appendChild(opt);
            });
        }
    });
    modal.style.display = "flex";
}

function saveScheduleOT() {
    var patientId = document.getElementById("otBookPatientId").value.trim();
    var patientName = document.getElementById("otBookPatientName").value.trim();
    var procedure = document.getElementById("otBookProcedure").value;
    var surgeonEl = document.getElementById("otBookSurgeon");
    var roomEl = document.getElementById("otBookRoom");
    var date = document.getElementById("otBookDate").value;
    var time = document.getElementById("otBookTime").value;
    if (!patientId || !procedure || !surgeonEl.value || !roomEl.value || !date || !time) {
        showToast("Fill patient, procedure, surgeon, room, date and time.", "warning");
        return;
    }
    var data = {
        patientId: patientId,
        patientDocId: document.getElementById("otBookPatientDocId").value || "",
        patientName: patientName,
        procedureType: procedure,
        surgeonId: surgeonEl.value,
        surgeonName: surgeonEl.selectedOptions[0] ? (surgeonEl.selectedOptions[0].getAttribute("data-name") || surgeonEl.selectedOptions[0].textContent) : "",
        otRoomId: roomEl.value,
        otRoomName: roomEl.selectedOptions[0] ? (roomEl.selectedOptions[0].getAttribute("data-name") || roomEl.selectedOptions[0].textContent) : "",
        scheduledDate: date,
        scheduledTime: time,
        anaesthetistName: document.getElementById("otBookAnaesthetist").value.trim(),
        preOpNotes: document.getElementById("otBookNotes").value.trim(),
        status: "scheduled",
        branchId: "main",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection("otBookings").add(data).then(function () {
        showToast("OT booked for " + patientName + ".", "success");
        document.getElementById("scheduleOTModal").style.display = "none";
        document.getElementById("otScheduleDate").value = date;
        loadOTSchedule(date);
    }).catch(function (err) { showToast(err.message, "error"); });
}

document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("btnScheduleOT");
    if (btn) btn.addEventListener("click", openScheduleOTModal);
    var saveBtn = document.getElementById("otBookSaveBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveScheduleOT);
    if (typeof mountPatientSearch === "function") {
        mountPatientSearch({
            inputId: "otBookPatientSearch",
            resultsId: "otBookPatientSearchResults",
            onSelect: function (p) {
                document.getElementById("otBookPatientId").value = p.patientId || "";
                document.getElementById("otBookPatientDocId").value = p.docId || "";
                document.getElementById("otBookPatientName").value = p.name || "";
                document.getElementById("otBookPatientSearch").value = (p.name || "") + " � " + (p.patientId || "");
            }
        });
    }
});
window.openScheduleOTModal = openScheduleOTModal;
