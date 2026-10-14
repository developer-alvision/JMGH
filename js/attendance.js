// ==========================================
// JS/ATTENDANCE.JS — Staff Attendance & Leaves
// ==========================================

checkAccess(['admin', 'owner', 'receptionist']);

let currentStaffList = [];
let hospitalShiftStart = "09:00"; // Default shift start
let currentMonthLogs = []; // Cache monthly log records for CSV/PDF exports

getCurrentUser(function(user) {
    if (!checkPageAccess(user)) return;
    
    // Toggle role-based permissions
    var role = (user.role || '').toLowerCase();
    if (role === 'admin') {
        var els = document.querySelectorAll('.admin-owner-only');
        els.forEach(function(el) {
            el.style.display = 'block';
            if (el.tagName === 'DIV' && el.classList.contains('grid-3')) {
                el.style.display = 'grid';
            }
        });
    } else if (role === 'owner') {
        // Owner: View & reports only (no manual punch, leave entry, or biometric import)
        var repSec = document.getElementById('monthlyReportSection');
        if (repSec) repSec.style.display = 'block';
        var grid3 = document.querySelector('.grid-3');
        if (grid3) grid3.style.display = 'none';
    } else if (role === 'receptionist') {
        // Receptionist: Punch clock & biometric import only — NO monthly reports
        var repSec = document.getElementById('monthlyReportSection');
        if (repSec) repSec.style.display = 'none';
    }
    
    // Set default values for selectors
    var todayStr = todayIso();
    var filterDateInput = document.getElementById('filterAttendanceDate');
    if (filterDateInput) {
        filterDateInput.value = todayStr;
    }
    
    var monthSelect = document.getElementById('monthlyReportMonthSelect');
    if (monthSelect) {
        var now = new Date();
        monthSelect.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }
    
    // Load hospital settings (shiftStartTime)
    db.collection('hospitalSettings').doc('main').get().then(function(doc) {
        if (doc.exists && doc.data().shiftStartTime) {
            hospitalShiftStart = doc.data().shiftStartTime;
        }
    }).catch(function(err) {
        console.warn('Failed to load shift start time settings:', err);
    });
    
    // Load active staff for dropdowns and current state
    loadActiveStaff(user);
    
    // Setup event listeners
    setupEventListeners(user);
});

// Load active staff members
function loadActiveStaff(currentUser) {
    db.collection('staff').where('isActive', '==', true).get().then(function(snap) {
        currentStaffList = [];
        snap.forEach(function(doc) {
            var s = doc.data();
            s.id = doc.id;
            currentStaffList.push(s);
        });
        
        // Populate manual clock dropdown
        var punchSelect = document.getElementById('punchStaffSelect');
        if (punchSelect) {
            punchSelect.innerHTML = '<option value="">-- Choose Staff --</option>';
            currentStaffList.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = escapeHtml(s.name) + ' (' + escapeHtml(s.role) + ')';
                punchSelect.appendChild(opt);
            });
        }
        
        // Populate leave registration staff dropdown
        var leaveSelect = document.getElementById('leaveStaffSelect');
        if (leaveSelect) {
            leaveSelect.innerHTML = '<option value="">-- Choose Staff --</option>';
            currentStaffList.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = escapeHtml(s.name) + ' (' + escapeHtml(s.role) + ')';
                leaveSelect.appendChild(opt);
            });
        }
        
        // Populate monthly report staff dropdown
        var monthlySelect = document.getElementById('monthlyReportStaffSelect');
        if (monthlySelect) {
            monthlySelect.innerHTML = '<option value="all">All Active Staff</option>';
            currentStaffList.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = escapeHtml(s.name) + ' (' + escapeHtml(s.role) + ')';
                monthlySelect.appendChild(opt);
            });
        }
        
        // Load today's attendance logs
        loadAttendanceLogs();
    }).catch(function(err) {
        showToast('Error loading active staff: ' + err.message, 'error');
    });
}

// Wire form buttons & inputs
function setupEventListeners(currentUser) {
    // Filter by date
    var filterDateInput = document.getElementById('filterAttendanceDate');
    if (filterDateInput) {
        filterDateInput.addEventListener('change', function() {
            loadAttendanceLogs();
        });
    }
    
    // Manual Punch In
    var btnIn = document.getElementById('btnClockIn');
    if (btnIn) {
        btnIn.addEventListener('click', function() {
            var staffId = document.getElementById('punchStaffSelect').value;
            if (!staffId) { showToast('Please select a staff member.', 'warning'); return; }
            recordClockPunch(staffId, 'IN', currentUser.email);
        });
    }
    
    // Manual Punch Out
    var btnOut = document.getElementById('btnClockOut');
    if (btnOut) {
        btnOut.addEventListener('click', function() {
            var staffId = document.getElementById('punchStaffSelect').value;
            if (!staffId) { showToast('Please select a staff member.', 'warning'); return; }
            recordClockPunch(staffId, 'OUT', currentUser.email);
        });
    }
    
    // Leave registration form submit
    var leaveForm = document.getElementById('leaveRegistrationForm');
    if (leaveForm) {
        leaveForm.addEventListener('submit', function(e) {
            e.preventDefault();
            registerLeave(currentUser.email);
        });
    }
    
    // CSV Biometric upload listener
    var csvInput = document.getElementById('biometricCsvFile');
    if (csvInput) {
        csvInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                handleBiometricCsv(e.target.files[0], currentUser.email);
            }
        });
    }
    
    // Load Monthly Report Button
    var btnLoadMonthly = document.getElementById('btnLoadMonthlyAttendance');
    if (btnLoadMonthly) {
        btnLoadMonthly.addEventListener('click', function() {
            loadMonthlyAttendanceReport();
        });
    }
    
    // Export Monthly CSV Button
    var btnExportCSV = document.getElementById('btnExportMonthlyCSV');
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', function() {
            exportMonthlyAttendanceCSV();
        });
    }
    
    // Download Monthly PDF Button
    var btnDownloadPDF = document.getElementById('btnDownloadMonthlyPDF');
    if (btnDownloadPDF) {
        btnDownloadPDF.addEventListener('click', function() {
            downloadMonthlyAttendancePDF();
        });
    }
    
    // Export today's attendance table CSV
    var btnExportToday = document.getElementById('btnExportTodayAttendance');
    if (btnExportToday) {
        btnExportToday.addEventListener('click', function() {
            exportTodayAttendanceCSV();
        });
    }
}

// Load daily attendance logs & cross-reference with active staff
function loadAttendanceLogs() {
    var filterDateInput = document.getElementById('filterAttendanceDate');
    if (!filterDateInput) return;
    var targetDate = filterDateInput.value;
    // Used both while counting rows and when updating the summary after the loop.
    var todayStr = todayIso();
    
    var tbody = document.getElementById('todayAttendanceTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading attendance logs...</td></tr>';
    
    try {
        db.collection('attendance').where('date', '==', targetDate).get().then(function(snap) {
            var punchMap = {};
            snap.forEach(function(doc) {
                var a = doc.data();
                a.id = doc.id;
                punchMap[a.staffId] = a;
            });
            
            // Re-render table mapping all active staff
            tbody.innerHTML = '';
            var presentCount = 0;
            var absentCount = 0;
            var leaveCount = 0;
            
            currentStaffList.forEach(function(s) {
                var log = punchMap[s.id];
                var status = 'absent';
                var inTime = '—';
                var outTime = '—';
                var hours = '—';
                var source = '—';
                
                if (log) {
                    status = log.status || 'absent';
                    inTime = log.clockIn ? formatTimeOnly(log.clockIn) : '—';
                    outTime = log.clockOut ? formatTimeOnly(log.clockOut) : '—';
                    hours = log.totalHours !== undefined && log.totalHours > 0 ? log.totalHours.toFixed(2) + ' hrs' : '—';
                    source = log.source ? log.source.toUpperCase() : '—';
                }
                
                // Track counts for summary cards (if filtering for today)
                if (targetDate === todayStr) {
                    if (status === 'leave') leaveCount++;
                    else if (status === 'absent') absentCount++;
                    else presentCount++;
                }
                
                var statusBadge = '';
                if (status === 'present') statusBadge = '<span class="status-badge status-present">Present</span>';
                else if (status === 'absent') statusBadge = '<span class="status-badge status-absent">Absent</span>';
                else if (status === 'leave') statusBadge = '<span class="status-badge status-leave">Approved Leave</span>';
                else if (status === 'half_day') statusBadge = '<span class="status-badge status-halfday">Half Day</span>';
                else if (status === 'late') statusBadge = '<span class="status-badge status-late">Late Arrival</span>';
                
                var tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td>${escapeHtml(s.role)}</td>
                    <td>${escapeHtml(s.biometricId || '—')}</td>
                    <td>${inTime}</td>
                    <td>${outTime}</td>
                    <td>${hours}</td>
                    <td>${statusBadge}</td>
                    <td><span class="status-badge ${log ? 'badge-manual' : ''}">${source}</span></td>
                `;
                tbody.appendChild(tr);
            });
            
            // Populate summary cards
            if (targetDate === todayStr) {
                document.getElementById('countPresent').textContent = presentCount;
                document.getElementById('countAbsent').textContent = absentCount;
                document.getElementById('countLeave').textContent = leaveCount;
                document.getElementById('countTotal').textContent = currentStaffList.length;
            } else {
                // If not today, show general metrics for target date
                document.getElementById('countPresent').textContent = presentCount;
                document.getElementById('countAbsent').textContent = absentCount;
                document.getElementById('countLeave').textContent = leaveCount;
                document.getElementById('countTotal').textContent = currentStaffList.length;
            }
        }).catch(function(err) {
            console.error('Firestore query failure:', err);
            if (err.message && err.message.includes('index')) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#d97706; padding:20px;"><i class="fa-solid fa-triangle-exclamation"></i> Firestore index is currently building. Please try again in a few minutes.</td></tr>';
            } else {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red; padding:20px;">Error loading logs: ' + escapeHtml(err.message) + '</td></tr>';
            }
        });
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red; padding:20px;">Unexpected query error: ' + escapeHtml(e.message) + '</td></tr>';
    }
}

// Record manual clock punch (IN or OUT)
function recordClockPunch(staffId, type, operatorEmail) {
    var todayStr = todayIso();
    var staffObj = currentStaffList.find(s => s.id === staffId);
    if (!staffObj) { showToast('Invalid staff member selected.', 'error'); return; }
    
    var docRef = db.collection('attendance').doc(staffId + '_' + todayStr);
    
    docRef.get().then(function(doc) {
        var existing = doc.exists ? doc.data() : null;
        
        if (type === 'IN') {
            if (existing && existing.clockIn) {
                showToast(escapeHtml(staffObj.name) + ' is already clocked in today.', 'warning');
                return;
            }
            
            // Check if late arrival
            var clockInDate = new Date();
            var status = 'present';
            
            var shiftParts = hospitalShiftStart.split(':');
            var shiftHours = parseInt(shiftParts[0], 10);
            var shiftMinutes = parseInt(shiftParts[1], 10);
            
            var currentHours = clockInDate.getHours();
            var currentMinutes = clockInDate.getMinutes();
            
            if (currentHours > shiftHours || (currentHours === shiftHours && currentMinutes > shiftMinutes)) {
                status = 'late';
            }
            
            var record = {
                staffId: staffId,
                staffName: staffObj.name,
                staffEmail: staffObj.email || '',
                biometricId: staffObj.biometricId || '',
                role: staffObj.role || 'unknown',
                date: todayStr,
                clockIn: firebase.firestore.FieldValue.serverTimestamp(),
                clockOut: null,
                totalHours: 0,
                status: status,
                source: 'manual',
                notes: status === 'late' ? 'Late punching (' + clockInDate.toLocaleTimeString('en-IN') + ')' : '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                recordedBy: operatorEmail
            };
            
            docRef.set(record).then(function() {
                showToast(escapeHtml(staffObj.name) + ' clocked in successfully.', 'success');
                loadAttendanceLogs();
            }).catch(function(err) {
                showToast('Failed to clock in: ' + err.message, 'error');
            });
            
        } else if (type === 'OUT') {
            if (!existing || !existing.clockIn) {
                showToast(escapeHtml(staffObj.name) + ' has not clocked in today yet.', 'warning');
                return;
            }
            if (existing.clockOut) {
                showToast(escapeHtml(staffObj.name) + ' has already clocked out today.', 'warning');
                return;
            }
            
            var clockInDate = existing.clockIn.toDate ? existing.clockIn.toDate() : new Date(existing.clockIn);
            var clockOutDate = new Date();
            
            var diffMs = clockOutDate.getTime() - clockInDate.getTime();
            var hoursVal = diffMs / (1000 * 60 * 60);
            
            var status = 'present';
            if (hoursVal < 4) {
                status = 'half_day';
            } else if (existing.status === 'late') {
                status = 'late';
            }
            
            docRef.update({
                clockOut: firebase.firestore.FieldValue.serverTimestamp(),
                totalHours: parseFloat(hoursVal.toFixed(2)),
                status: status,
                notes: (existing.notes ? existing.notes + ' · ' : '') + 'Clocked out manual'
            }).then(function() {
                showToast(escapeHtml(staffObj.name) + ' clocked out successfully. Total hours: ' + hoursVal.toFixed(2), 'success');
                loadAttendanceLogs();
            }).catch(function(err) {
                showToast('Failed to clock out: ' + err.message, 'error');
            });
        }
    }).catch(function(err) {
        showToast('Error querying punch records: ' + err.message, 'error');
    });
}

// Register Leave for date range
function registerLeave(operatorEmail) {
    var staffId = document.getElementById('leaveStaffSelect').value;
    var fromStr = document.getElementById('leaveFromDate').value;
    var toStr = document.getElementById('leaveToDate').value;
    var notesVal = document.getElementById('leaveNotes').value || 'Approved Leave';
    
    if (!staffId || !fromStr || !toStr) {
        showToast('Please fill out all leave fields.', 'warning');
        return;
    }
    
    var staffObj = currentStaffList.find(s => s.id === staffId);
    if (!staffObj) { showToast('Invalid staff member.', 'error'); return; }
    
    var fromDate = new Date(fromStr);
    var toDate = new Date(toStr);
    
    if (toDate < fromDate) {
        showToast('To Date cannot be earlier than From Date.', 'warning');
        return;
    }
    
    showToast('Registering approved leave logs...', 'info');
    
    var batch = db.batch();
    var cur = new Date(fromDate);
    var writeCount = 0;
    
    while (cur <= toDate) {
        var curStr = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
        var ref = db.collection('attendance').doc(staffId + '_' + curStr);
        
        var record = {
            staffId: staffId,
            staffName: staffObj.name,
            staffEmail: staffObj.email || '',
            biometricId: staffObj.biometricId || '',
            role: staffObj.role || 'unknown',
            date: curStr,
            clockIn: null,
            clockOut: null,
            totalHours: 0,
            status: 'leave',
            source: 'manual',
            notes: notesVal,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            recordedBy: operatorEmail
        };
        
        batch.set(ref, record);
        writeCount++;
        
        cur.setDate(cur.getDate() + 1);
    }
    
    batch.commit().then(function() {
        showToast('Leave registered successfully for ' + writeCount + ' day(s).', 'success');
        document.getElementById('leaveRegistrationForm').reset();
        loadAttendanceLogs();
    }).catch(function(err) {
        showToast('Error registering leaves batch: ' + err.message, 'error');
    });
}

// ==========================================================
// PART 5 — BIOMETRIC CSV FILE HANDLER
// ==========================================================
let parsedCsvData = null; // Stored parsed CSV rows

function handleBiometricCsv(file, operatorEmail) {
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = e.target.result;
        var lines = text.split(/\r?\n/);
        var rows = [];
        
        lines.forEach(function(line) {
            var cols = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
            if (cols.length > 0 && cols[0]) {
                rows.push(cols);
            }
        });
        
        if (rows.length === 0) {
            showToast('CSV file is empty or corrupted.', 'error');
            return;
        }
        
        // Automatically import standard device exports. Unrecognised layouts still
        // open the existing mapping dialog so no punch data is guessed.
        parsedCsvData = rows;
        var detectedMapping = detectBiometricCsvColumns(rows[0]);
        if (detectedMapping) {
            showToast('Recognised biometric CSV layout. Importing punches automatically...', 'info');
            processMappedAttendanceCsv(detectedMapping.biometricId, detectedMapping.date, detectedMapping.time, detectedMapping.direction);
        } else {
            showColumnMappingModal(rows[0]);
        }
    };
    reader.readAsText(file);
}

function detectBiometricCsvColumns(headers) {
    function findHeader(patterns, exclude) {
        for (var index = 0; index < headers.length; index++) {
            var header = String(headers[index] || '').trim().toLowerCase();
            if (exclude && exclude.test(header)) continue;
            if (patterns.some(function(pattern) { return pattern.test(header); })) return index;
        }
        return -1;
    }
    var biometricId = findHeader([/biometric/, /employee\s*id/, /user\s*id/, /enroll/, /^id$/]);
    var date = findHeader([/^date$/, /punch\s*date/, /attendance\s*date/, /\bday\b/], /date\s*time|datetime/);
    var time = findHeader([/^time$/, /punch\s*time/, /log\s*time/, /clock\s*time/], /date\s*time|datetime/);
    var direction = findHeader([/direction/, /punch\s*type/, /in\s*\/\s*out/, /^mode$/, /status/]);
    return biometricId >= 0 && date >= 0 && time >= 0 ? {
        biometricId: biometricId,
        date: date,
        time: time,
        direction: direction >= 0 ? direction : null
    } : null;
}

function showColumnMappingModal(headers) {
    var modal = document.getElementById('csvMappingModal');
    modal.style.display = 'flex';
    
    // Populate select elements with header columns
    var selects = ['mapBiometricId', 'mapDate', 'mapTime', 'mapDirection'];
    selects.forEach(function(selId) {
        var sel = document.getElementById(selId);
        sel.innerHTML = '';
        if (selId === 'mapDirection') {
            sel.innerHTML = '<option value="">None (Auto-calculate: 1st punch = IN, 2nd = OUT)</option>';
        }
        
        headers.forEach(function(h, idx) {
            var opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = 'Column ' + (idx + 1) + ': ' + h;
            // Attempt auto-matching
            var hl = h.toLowerCase();
            if (selId === 'mapBiometricId' && (hl.includes('biometric') || hl.includes('id') || hl.includes('device') || hl.includes('userid'))) opt.selected = true;
            if (selId === 'mapDate' && (hl.includes('date') || hl.includes('day'))) opt.selected = true;
            if (selId === 'mapTime' && (hl.includes('time') || hl.includes('hour') || hl.includes('punch'))) opt.selected = true;
            if (selId === 'mapDirection' && (hl.includes('in') || hl.includes('out') || hl.includes('mode') || hl.includes('type'))) opt.selected = true;
            
            sel.appendChild(opt);
        });
    });
    
    // Bind submission
    var form = document.getElementById('csvMappingForm');
    form.onsubmit = function(e) {
        e.preventDefault();
        modal.style.display = 'none';
        processMappedAttendanceCsv(
            parseInt(document.getElementById('mapBiometricId').value, 10),
            parseInt(document.getElementById('mapDate').value, 10),
            parseInt(document.getElementById('mapTime').value, 10),
            document.getElementById('mapDirection').value !== "" ? parseInt(document.getElementById('mapDirection').value, 10) : null
        );
    };
}

function processMappedAttendanceCsv(bioIdCol, dateCol, timeCol, dirCol) {
    if (!parsedCsvData || parsedCsvData.length < 2) return;
    
    showToast('Processing biometric punch CSV logs...', 'info');
    
    // Build active staff mapping: biometricId -> staffObj
    var staffMap = {};
    currentStaffList.forEach(function(s) {
        if (s.biometricId) {
            staffMap[s.biometricId.trim()] = s;
        }
    });
    
    // Aggregate punches by staff + date
    var punchesByStaffAndDate = {};
    var processedCount = 0;
    var matchedCount = 0;
    var unmatchedIds = new Set();
    
    // Skip headers
    for (var i = 1; i < parsedCsvData.length; i++) {
        var row = parsedCsvData[i];
        if (row.length <= Math.max(bioIdCol, dateCol, timeCol, dirCol || 0)) continue;
        
        var bioId = row[bioIdCol].trim();
        var dateVal = row[dateCol].trim(); // expected yyyy-mm-dd
        var timeVal = row[timeCol].trim(); // expected hh:mm:ss or similar
        var dirVal = dirCol !== null ? row[dirCol].trim().toUpperCase() : null;
        
        processedCount++;
        
        var staffObj = staffMap[bioId];
        if (!staffObj) {
            unmatchedIds.add(bioId);
            continue;
        }
        
        matchedCount++;
        
        var key = staffObj.id + '_' + dateVal;
        if (!punchesByStaffAndDate[key]) {
            punchesByStaffAndDate[key] = {
                staff: staffObj,
                date: dateVal,
                punches: []
            };
        }
        
        // Parse time/timestamp
        // Standardize date/time string to compute milliseconds
        var cleanDateTimeStr = dateVal + ' ' + timeVal;
        var pTime = new Date(cleanDateTimeStr);
        if (isNaN(pTime.getTime())) {
            // Attempt fallback to parsing custom time formatting
            pTime = new Date(dateVal + 'T' + timeVal);
        }
        
        if (!isNaN(pTime.getTime())) {
            punchesByStaffAndDate[key].punches.push({
                time: pTime,
                dir: dirVal
            });
        }
    }
    
    // Write attendance updates in batches of 400
    var batch = db.batch();
    var batchWriteCount = 0;
    var promises = [];
    
    Object.keys(punchesByStaffAndDate).forEach(function(key) {
        var group = punchesByStaffAndDate[key];
        var s = group.staff;
        var date = group.date;
        var punches = group.punches;
        
        if (punches.length === 0) return;
        
        // Sort punches by time
        punches.sort((a, b) => a.time - b.time);
        
        var inPunch = null;
        var outPunch = null;
        
        if (dirCol !== null) {
            // Map by mapped column direction (IN vs OUT)
            var inG = punches.find(p => p.dir.includes('IN') || p.dir.includes('1') || p.dir.includes('ENTRY'));
            var outG = [...punches].reverse().find(p => p.dir.includes('OUT') || p.dir.includes('0') || p.dir.includes('EXIT'));
            inPunch = inG ? inG.time : punches[0].time;
            outPunch = outG ? outG.time : (punches.length > 1 ? punches[punches.length - 1].time : null);
        } else {
            // Auto-calculate: 1st punch = IN, last punch = OUT
            inPunch = punches[0].time;
            if (punches.length > 1) {
                outPunch = punches[punches.length - 1].time;
            }
        }
        
        // Calculate status/totalHours
        var totalHours = 0;
        var status = 'present';
        
        if (inPunch && outPunch) {
            var diff = outPunch.getTime() - inPunch.getTime();
            totalHours = diff / (1000 * 60 * 60);
            if (totalHours < 4) status = 'half_day';
        }
        
        // Check if late arrival
        if (inPunch) {
            var shiftParts = hospitalShiftStart.split(':');
            var shiftH = parseInt(shiftParts[0], 10);
            var shiftM = parseInt(shiftParts[1], 10);
            if (inPunch.getHours() > shiftH || (inPunch.getHours() === shiftH && inPunch.getMinutes() > shiftM)) {
                if (status === 'present') status = 'late';
            }
        }
        
        var ref = db.collection('attendance').doc(key);
        
        var attendanceData = {
            staffId: s.id,
            staffName: s.name,
            staffEmail: s.email || '',
            biometricId: s.biometricId || '',
            role: s.role || 'unknown',
            date: date,
            clockIn: inPunch ? firebase.firestore.Timestamp.fromDate(inPunch) : null,
            clockOut: outPunch ? firebase.firestore.Timestamp.fromDate(outPunch) : null,
            totalHours: parseFloat(totalHours.toFixed(2)),
            status: status,
            source: 'import',
            notes: 'Imported from Biometric Log',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            recordedBy: 'biometric_importer'
        };
        
        batch.set(ref, attendanceData);
        batchWriteCount++;
        
        if (batchWriteCount >= 400) {
            promises.push(batch.commit());
            batch = db.batch();
            batchWriteCount = 0;
        }
    });
    
    /*
      ==========================================================
      LIVE BIOMETRIC DEVICE API SYNC ENDPOINT:
      In a live production environment with network biometric terminals (e.g. ZKTeco, Matrix, Essl), 
      the device pusher software or cloud service will make a background HTTP POST web hook to the server:
      
      POST /api/attendance/sync
      Headers: Authorization: Bearer <deviceToken>
      Body: {
         biometricId: "BIO101",
         timestamp: "2026-07-19T09:12:00.000Z",
         punchType: "check_in"
      }
      
      The Cloud Function / backend server handles the punch logic and writes to /attendance in the exact same format
      above, bypassing manual uploads completely.
      ==========================================================
    */
    
    if (batchWriteCount > 0) {
        promises.push(batch.commit());
    }
    
    Promise.all(promises).then(function() {
        var unmatchedList = unmatchedIds.size > 0 ? Array.from(unmatchedIds).join(', ') : 'None';
        showToast('Successfully processed attendance records.', 'success');
        
        // Show CSV results dialog
        alert('Biometric CSV Processing Complete!\n\n' +
              'Punches processed: ' + processedCount + '\n' +
              'Matched to Active Staff: ' + matchedCount + '\n' +
              'Unmatched Punches: ' + (processedCount - matchedCount) + '\n' +
              'Unmatched Biometric IDs: ' + unmatchedList);
              
        loadAttendanceLogs();
    }).catch(function(err) {
        showToast('Failed to commit imports: ' + err.message, 'error');
    });
}

// ==========================================
// PART 6 — MONTHLY ATTENDANCE REPORT & ANALYTICS
// ==========================================
function loadMonthlyAttendanceReport() {
    var staffId = document.getElementById('monthlyReportStaffSelect').value;
    var monthStr = document.getElementById('monthlyReportMonthSelect').value;
    
    if (!staffId || !monthStr) {
        showToast('Please select both staff member and target month.', 'warning');
        return;
    }
    
    var tbody = document.getElementById('monthlyReportTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading monthly report...</td></tr>';
    
    document.getElementById('monthlyStatsSummaryGrid').style.display = 'none';
    
    db.collection('attendance').get().then(function(snap) {
        var allLogs = [];
        snap.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            // Filter by month starting YYYY-MM and staffId
            if (data.date && data.date.startsWith(monthStr)) {
                if (staffId === 'all' || data.staffId === staffId) {
                    allLogs.push(data);
                }
            }
        });
        
        // Store globally for exports
        currentMonthLogs = allLogs;
        
        tbody.innerHTML = '';
        if (allLogs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888; padding:20px;">No attendance logs matching selected month & filters.</td></tr>';
            return;
        }
        
        // Sort chronologically
        allLogs.sort((a,b) => a.date.localeCompare(b.date));
        
        // Calculate summaries
        var daysPresent = 0;
        var daysAbsent = 0;
        var daysLeave = 0;
        var daysHalf = 0;
        var daysLate = 0;
        var totalHoursSum = 0;
        
        allLogs.forEach(function(log) {
            var status = log.status || 'absent';
            if (status === 'present') daysPresent++;
            else if (status === 'absent') daysAbsent++;
            else if (status === 'leave') daysLeave++;
            else if (status === 'half_day') daysHalf++;
            else if (status === 'late') daysLate++;
            
            totalHoursSum += (log.totalHours || 0);
            
            var statusBadge = '';
            if (status === 'present') statusBadge = '<span class="status-badge status-present">Present</span>';
            else if (status === 'absent') statusBadge = '<span class="status-badge status-absent">Absent</span>';
            else if (status === 'leave') statusBadge = '<span class="status-badge status-leave">Leave</span>';
            else if (status === 'half_day') statusBadge = '<span class="status-badge status-halfday">Half Day</span>';
            else if (status === 'late') statusBadge = '<span class="status-badge status-late">Late</span>';
            
            var inTime = log.clockIn ? formatTimeOnly(log.clockIn) : '—';
            var outTime = log.clockOut ? formatTimeOnly(log.clockOut) : '—';
            var hours = log.totalHours !== undefined && log.totalHours > 0 ? log.totalHours.toFixed(2) + ' hrs' : '—';
            
            var tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${log.date}</strong>${staffId === 'all' ? '<br><small style="color:#64748b;">' + escapeHtml(log.staffName) + '</small>' : ''}</td>
                <td>${inTime}</td>
                <td>${outTime}</td>
                <td>${hours}</td>
                <td>${statusBadge}</td>
                <td><small style="color:#64748b;">${escapeHtml(log.notes || 'No remarks')}</small></td>
            `;
            tbody.appendChild(tr);
        });
        
        // Show summary metrics block
        var metricGrid = document.getElementById('monthlyStatsSummaryGrid');
        if (metricGrid) {
            metricGrid.style.display = 'grid';
            
            var totalActiveDays = daysPresent + daysHalf + daysLate;
            var totalCount = daysPresent + daysAbsent + daysLeave + daysHalf + daysLate;
            
            var avgHours = totalActiveDays > 0 ? (totalHoursSum / totalActiveDays).toFixed(1) : '0';
            var attPct = totalCount > 0 ? Math.round(((daysPresent + daysHalf + daysLate) / totalCount) * 100) : 0;
            
            document.getElementById('mDaysPresent').textContent = daysPresent;
            document.getElementById('mDaysAbsent').textContent = daysAbsent;
            document.getElementById('mDaysLeave').textContent = daysLeave;
            document.getElementById('mDaysHalf').textContent = daysHalf;
            document.getElementById('mDaysLate').textContent = daysLate;
            document.getElementById('mHoursSummary').textContent = totalHoursSum.toFixed(1) + 'h (' + avgHours + 'h/d)';
            document.getElementById('mAttendancePct').textContent = attPct + '%';
        }
        
    }).catch(function(err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red; padding:20px;">Failed to gather report: ' + err.message + '</td></tr>';
    });
}

function exportMonthlyAttendanceCSV() {
    if (currentMonthLogs.length === 0) {
        showToast('Please load a monthly report before exporting.', 'warning');
        return;
    }
    
    var data = currentMonthLogs.map(function(log) {
        return {
            'Date': log.date,
            'Staff Name': log.staffName,
            'Role': log.role,
            'Biometric ID': log.biometricId,
            'Clock In': log.clockIn ? (log.clockIn.toDate ? log.clockIn.toDate().toLocaleString('en-IN') : new Date(log.clockIn).toLocaleString('en-IN')) : '—',
            'Clock Out': log.clockOut ? (log.clockOut.toDate ? log.clockOut.toDate().toLocaleString('en-IN') : new Date(log.clockOut).toLocaleString('en-IN')) : '—',
            'Total Hours': log.totalHours || 0,
            'Attendance Status': log.status || 'absent',
            'Punch Source': log.source || '—',
            'Remarks/Notes': log.notes || ''
        };
    });
    
    exportToCSV(data, 'monthly_attendance_report');
}

function exportTodayAttendanceCSV() {
    var filterDateInput = document.getElementById('filterAttendanceDate');
    if (!filterDateInput) return;
    var targetDate = filterDateInput.value;
    
    db.collection('attendance').where('date', '==', targetDate).get().then(function(snap) {
        if (snap.empty) {
            showToast('No punches to export for selected date.', 'warning');
            return;
        }
        
        var rows = [];
        snap.forEach(function(doc) {
            var log = doc.data();
            rows.push({
                'Date': log.date,
                'Staff Name': log.staffName,
                'Role': log.role,
                'Biometric ID': log.biometricId,
                'Clock In': log.clockIn ? (log.clockIn.toDate ? log.clockIn.toDate().toLocaleTimeString('en-IN') : new Date(log.clockIn).toLocaleTimeString('en-IN')) : '—',
                'Clock Out': log.clockOut ? (log.clockOut.toDate ? log.clockOut.toDate().toLocaleTimeString('en-IN') : new Date(log.clockOut).toLocaleTimeString('en-IN')) : '—',
                'Total Hours': log.totalHours || 0,
                'Status': log.status || 'absent',
                'Source': log.source || 'manual'
            });
        });
        
        exportToCSV(rows, 'staff_attendance_' + targetDate);
    }).catch(function(err) {
        showToast('Error exporting today logs: ' + err.message, 'error');
    });
}

function downloadMonthlyAttendancePDF() {
    if (currentMonthLogs.length === 0) {
        showToast('Please load a monthly report before generating PDF.', 'warning');
        return;
    }
    
    var staffId = document.getElementById('monthlyReportStaffSelect').value;
    var monthStr = document.getElementById('monthlyReportMonthSelect').value;
    
    db.collection('hospitalSettings').doc('main').get().then(function(settingsDoc) {
        var settings = settingsDoc.exists ? settingsDoc.data() : {};
        
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        
        // === HEADER ===
        doc.setFillColor(15, 43, 91);
        doc.rect(0, 0, pageWidth, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', pageWidth/2, 12, { align: 'center' });
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(settings.address || '', pageWidth/2, 18, { align: 'center' });
        doc.text('Phone: ' + (settings.phone || '') + '  |  Email: ' + (settings.email || ''), pageWidth/2, 23, { align: 'center' });
        
        var y = 40;
        
        doc.setTextColor(15, 43, 91);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        var reportTitle = 'STAFF MONTHLY ATTENDANCE LEDGER';
        doc.text(reportTitle, pageWidth/2, y, { align: 'center' });
        
        doc.setFontSize(10.5);
        doc.text('Month: ' + monthStr + '  |  Filtered For: ' + (staffId === 'all' ? 'All Staff Members' : currentMonthLogs[0].staffName), pageWidth/2, y + 6, { align: 'center' });
        
        y += 15;
        
        // Build tables rows
        var bodyData = currentMonthLogs.map(function(log) {
            var inTime = log.clockIn ? formatTimeOnly(log.clockIn) : '—';
            var outTime = log.clockOut ? formatTimeOnly(log.clockOut) : '—';
            return [
                log.date,
                log.staffName,
                log.role,
                inTime,
                outTime,
                log.totalHours ? log.totalHours.toFixed(2) + ' h' : '—',
                log.status.toUpperCase()
            ];
        });
        
        doc.autoTable({
            startY: y,
            head: [['Date', 'Staff Name', 'Role', 'Clock In', 'Clock Out', 'Duration', 'Status']],
            body: bodyData,
            theme: 'grid',
            headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 8.5, textColor: [60, 60, 60] },
            margin: { left: 10, right: 10 }
        });
        
        var sigY = pageHeight - 30;
        doc.setDrawColor(200, 200, 200);
        doc.line(10, sigY, 70, sigY);
        doc.line(pageWidth - 70, sigY, pageWidth - 10, sigY);
        doc.setFontSize(8);
        doc.text('HR Audit Clerk', 40, sigY + 4, { align: 'center' });
        doc.text('Approved Director / Owner', pageWidth - 40, sigY + 4, { align: 'center' });
        
        var filename = 'Monthly-Attendance-Report-' + monthStr + '.pdf';
        if (window.savePDFHelper) {
            window.savePDFHelper(doc, filename);
        } else {
            doc.save(filename);
            showToast('PDF downloaded successfully.', 'success');
        }
        
    }).catch(function(err) {
        showToast('Failed to generate PDF: ' + err.message, 'error');
    });
}
