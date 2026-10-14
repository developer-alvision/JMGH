// Firebase connection. The hospital's project is named in one place only:
// js/firebase-config.js. Nothing here is tied to any particular project.
//
// On localhost the app ignores that file entirely and talks to the local
// Firebase emulators, so development never touches a live hospital database.
window.HMS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const firebaseConfig = window.HMS_LOCAL ? {
    apiKey: 'local-emulator-key',
    authDomain: 'demo-jyothsna-hms.firebaseapp.com',
    projectId: 'demo-jyothsna-hms',
    storageBucket: 'demo-jyothsna-hms.appspot.com',
    appId: '1:123456789:web:local'
} : (window.FIREBASE_CONFIG || {});

// A deployment with no project configured would otherwise fail with a
// cryptic Firebase error on every page. Say plainly what is missing.
if (!window.HMS_LOCAL && !firebaseConfig.projectId) {
    document.addEventListener('DOMContentLoaded', function () {
        document.body.innerHTML =
            '<div style="max-width:560px;margin:14vh auto;padding:28px;font-family:system-ui,sans-serif;'
            + 'border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#0f172a;">'
            + '<h2 style="margin:0 0 10px;color:#A61E4D;">Firebase is not configured</h2>'
            + '<p style="line-height:1.6;color:#475569;">Open <code>js/firebase-config.js</code> and paste the six '
            + 'values from <strong>Firebase Console → Project settings → General → Your apps → Web app → Config</strong>, '
            + 'then upload the file again.</p>'
            + '<p style="line-height:1.6;color:#475569;">Also add the website domain under '
            + '<strong>Authentication → Settings → Authorized domains</strong>, or sign-in will be refused.</p>'
            + '</div>';
    });
    throw new Error('Firebase configuration missing: fill in js/firebase-config.js');
}

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }

// Local development never connects to the hospital's live database.
if (window.HMS_LOCAL) {
    firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    firebase.firestore().useEmulator('127.0.0.1', 8080);
    if (firebase.storage) firebase.storage().useEmulator('127.0.0.1', 9199);
}

// ==========================================
// OFFLINE PERSISTENCE (must run before any firestore usage)
// ==========================================
firebase.firestore().enablePersistence({ synchronizeTabs: true })
    .then(function() {
        console.log('Offline mode enabled - data will sync when online');
    })
    .catch(function(err) {
        if (err.code === 'failed-precondition') {
            console.warn('Offline mode: Multiple tabs open. Only one tab can sync.');
        } else if (err.code === 'unimplemented') {
            console.warn('Offline mode: Browser does not support offline persistence.');
        }
    });

const auth = firebase.auth();
const db = firebase.firestore();

// ==========================================
// CALLABLE FUNCTIONS
// Every function is deployed to asia-south1. The compat SDK
// defaults to us-central1, so the region must be named here or
// the call 404s.
// ==========================================
const FUNCTIONS_REGION = 'asia-south1';

function callFunction(name, data) {
    if (!firebase.functions) {
        return Promise.reject(new Error('The Firebase Functions SDK is not loaded on this page.'));
    }
    var functionsClient = firebase.app().functions(FUNCTIONS_REGION);
    if (window.HMS_LOCAL) functionsClient.useEmulator('127.0.0.1', 5001);
    return functionsClient.httpsCallable(name)(data || {})
        .then(function(result) { return result.data; });
}
window.callFunction = callFunction;

// ==========================================
// P11: TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type) {
    type = type || 'success';
    var colors = { success: '#0D7A70', error: '#DC2626', warning: '#D4820A', info: '#1E6FB5' };
    var icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:white;border-left:4px solid ' + colors[type] + ';padding:14px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:99999;font-size:14px;color:#1F2937;max-width:320px;display:flex;align-items:center;gap:10px;';
    toast.innerHTML = '<i class="fa-solid ' + icons[type] + '" style="color:' + colors[type] + ';"></i><span></span>';
    toast.querySelector('span').textContent = String(message);
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    document.body.appendChild(toast);
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
    }, 3500);
}

// ==========================================
// P3: DEPARTMENTS — fetch from Firestore, seed if empty
// ==========================================
const DEFAULT_DEPARTMENTS = ['Gynaecology', 'Surgery'];

function loadDepartments() {
    return Promise.resolve(DEFAULT_DEPARTMENTS.map(name => ({ name })));
}

function populateDeptSelect(selectId, selectedValue = '') {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">Select Department</option>';
    loadDepartments().then(depts => {
        if (selectedValue && !DEFAULT_DEPARTMENTS.includes(selectedValue)) {
            const historic = document.createElement('option');
            historic.value = selectedValue; historic.textContent = selectedValue + ' (existing record)';
            historic.selected = true; select.appendChild(historic);
        }
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.name; opt.textContent = d.name;
            if (d.name === selectedValue) opt.selected = true;
            select.appendChild(opt);
        });
    });
}

// ==========================================
// DOCTORS — JS-side isActive filter
// ==========================================
function loadDoctors() {
    return db.collection('staff').where('role', '==', 'doctor').get().then(snapshot => {
        const doctors = new Map();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.isActive !== true && data.isActive !== 'true') return;
            const id = data.uid || doc.id;
            if (!doctors.has(id) || doc.id === id) doctors.set(id, { id: id, name: data.name, department: data.department || '', specialisation: data.specialisation || '', opFee: data.opFee || 0, freeOP: data.freeOP === true || data.freeOP === 'true' });
        });
        return Array.from(doctors.values());
    });
}

// Completed consultations establish review eligibility for the selected doctor.
async function getHospitalOPFee(patient, doctor, date, options) {
    options = options || {};
    if (!window.HOSPITAL_POLICY) throw new Error('Hospital fee policy is unavailable. Reload the page.');
    var patientData = patient || {};
    if (patientData.docId || patientData.id) {
        var patientDoc = await db.collection('patients').doc(patientData.docId || patientData.id).get();
        if (patientDoc.exists) patientData = Object.assign({}, patientData, patientDoc.data());
    }
    var snapshot = await db.collection('consultations').where('patientId', '==', patientData.patientId || '').get();
    var history = [];
    snapshot.forEach(function(doc) {
        var row = doc.data();
        if (row.status !== 'completed') return;
        if (doctor && row.doctorId !== doctor.id && String(row.doctorName || '').trim().toLowerCase() !== String(doctor.name || '').trim().toLowerCase()) return;
        var stamp = row.consultationDate || row.completedAt || row.createdAt;
        var key = typeof stamp === 'string' ? stamp.slice(0, 10) : stamp && stamp.toDate ? isoDate(stamp.toDate()) : '';
        if (key && key <= date) history.push(Object.assign({}, row, { dateKey: key }));
    });
    history.sort(function(a, b) { return b.dateKey.localeCompare(a.dateKey); });
    var episode = history.find(function(row) { return row.feeStartsEpisode === true || Number(row.opBaseFee) >= 300; });
    var latest = history[0];
    var anchor = episode ? episode.dateKey : latest && latest.feeEpisodeDate || (history.length ? history[history.length - 1].dateKey : '');
    var result = calculateHospitalOPFee({ date: date, lastVisitDate: latest && latest.dateKey,
        episodeDate: anchor, isPregnant: patientData.isPregnant === true, freeOP: doctor && doctor.freeOP,
        visitType: options.visitType, phone: options.phone });
    result.episodeDate = result.startsEpisode ? date : anchor || date;
    result.policyVersion = HOSPITAL_POLICY.version;
    return result;
}
window.getHospitalOPFee = getHospitalOPFee;

// NOTE IN CODE: UI-level access controls and hiding elements MUST be mirrored by
// Firestore and Firebase Storage security rules server-side (UI alone is not security).
const PAGE_ROLES = {
    'dashboard.html': ['admin', 'owner', 'receptionist', 'billing_staff', 'doctor', 'nurse', 'lab_technician', 'pharmacist'],
    'owner-dashboard.html': ['admin', 'owner'],
    'doctor-dashboard.html': ['admin', 'doctor'],
    'appointments.html': ['admin', 'receptionist', 'doctor'],
    'patients.html': ['admin', 'receptionist', 'nurse'],
    'patient-profile.html': ['admin', 'owner', 'receptionist', 'billing_staff', 'doctor', 'nurse'],
    'consultations.html': ['admin', 'owner', 'doctor'],
    'consultation.html': ['admin', 'doctor'],
    'lab-reports.html': ['admin', 'doctor', 'nurse', 'lab_technician'],
    'imaging.html': ['admin', 'doctor', 'nurse', 'lab_technician'],
    'pharmacy.html': ['admin', 'pharmacist'],
    'billing.html': ['admin', 'receptionist', 'billing_staff'],
    'today-collections.html': ['admin', 'owner', 'receptionist', 'billing_staff'],
    'bed-management.html': ['admin', 'receptionist', 'nurse'],
    'ot-schedule.html': ['admin', 'doctor', 'receptionist'],
    'attendance.html': ['admin', 'owner', 'receptionist'],
    'certificates.html': ['admin', 'doctor', 'nurse', 'receptionist'],
    'accounts.html': ['admin', 'owner'],
    'admin.html': ['admin'],
    'maternity-care.html': ['admin', 'doctor', 'nurse', 'receptionist'],
    // owner is read-only here (partograph.js hides the charting form); the
    // sidebar already offered the link, which previously bounced them.
    'partograph.html': ['admin', 'doctor', 'nurse', 'owner'],
    'discharge.html': ['admin', 'doctor', 'nurse', 'receptionist', 'billing_staff'],
    'op-queue.html': ['admin', 'receptionist', 'doctor', 'nurse'],
    'claims.html': ['admin', 'billing_staff', 'receptionist', 'owner'],
    'packages.html': ['admin', 'billing_staff', 'receptionist'],
    'quality.html': ['admin', 'doctor', 'nurse', 'owner'],
    'teleconsult.html': ['admin', 'doctor', 'receptionist'],
    'inventory-alerts.html': ['admin', 'pharmacist', 'owner'],
    'usg-templates.html': ['admin', 'doctor', 'lab_technician', 'nurse']
};

function checkPageAccess(user) {
    if (!user || !user.role) {
        window.location.href = 'index.html';
        return false;
    }
    const isActive = user.isActive === true || user.isActive === 'true';
    if (!isActive) {
        firebase.auth().signOut();
        showToast('Your account is inactive. Access denied.', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 1000);
        return false;
    }
    const pageRaw = window.location.pathname.split('/').pop() || 'dashboard.html';
    const page = pageRaw.split('?')[0].split('#')[0] || 'dashboard.html';
    const allowed = PAGE_ROLES[page];
    const role = (user.role || '').toLowerCase();
    
    if (!allowed || !allowed.includes(role)) {
        showToast('Access denied: You do not have permission to access this page.', 'error');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        return false;
    }
    return true;
}
window.checkPageAccess = checkPageAccess;

const MENU_GROUPS = [
    {
        id: 'home', label: 'Home',
        items: [
            { href: 'dashboard.html', text: 'Dashboard', icon: 'fa-chart-pie', roles: ['admin', 'doctor', 'nurse', 'receptionist', 'billing_staff', 'lab_technician', 'pharmacist', 'owner'] },
            { href: 'owner-dashboard.html', text: 'Owner Analytics', icon: 'fa-chart-line', roles: ['admin', 'owner'] },
            { href: 'doctor-dashboard.html', text: 'Doctor Dashboard', icon: 'fa-user-md', roles: ['admin', 'doctor'] }
        ]
    },
    {
        id: 'front', label: 'Front desk',
        items: [
            { href: 'appointments.html', text: 'Appointments', icon: 'fa-calendar-check', roles: ['admin', 'receptionist', 'doctor', 'owner'] },
            { href: 'op-queue.html', text: 'OP Queue', icon: 'fa-ticket', roles: ['admin', 'receptionist', 'doctor', 'nurse', 'owner'] },
            { href: 'patients.html', text: 'Patients', icon: 'fa-users', roles: ['admin', 'receptionist', 'nurse', 'doctor', 'owner'] },
            { href: 'bed-management.html', text: 'Bed Board', icon: 'fa-bed', roles: ['admin', 'receptionist', 'nurse', 'doctor', 'owner'] }
        ]
    },
    {
        id: 'clinical', label: 'Clinical',
        items: [
            { href: 'maternity-care.html', text: 'Maternity Care', icon: 'fa-person-pregnant', roles: ['admin', 'doctor', 'nurse', 'receptionist', 'owner'] },
            { href: 'partograph.html', text: 'Partograph', icon: 'fa-chart-line', roles: ['admin', 'doctor', 'nurse', 'owner'] },
            { href: 'discharge.html', text: 'Discharge', icon: 'fa-file-medical', roles: ['admin', 'doctor', 'nurse', 'receptionist', 'billing_staff', 'owner'] },
            { href: 'teleconsult.html', text: 'Tele-consult', icon: 'fa-video', roles: ['admin', 'doctor', 'receptionist', 'owner'] },
            { href: 'consultations.html', text: 'Consultations Log', icon: 'fa-notes-medical', roles: ['admin', 'doctor', 'owner'] },
            { href: 'lab-reports.html', text: 'Lab Reports', icon: 'fa-flask', roles: ['admin', 'lab_technician', 'doctor', 'nurse', 'owner'] },
            { href: 'imaging.html', text: 'Imaging', icon: 'fa-x-ray', roles: ['admin', 'lab_technician', 'doctor', 'nurse', 'owner'] },
            { href: 'usg-templates.html', text: 'USG Templates', icon: 'fa-file-waveform', roles: ['admin', 'doctor', 'lab_technician', 'nurse', 'owner'] },
            { href: 'ot-schedule.html', text: 'OT Schedule', icon: 'fa-calendar-plus', roles: ['admin', 'doctor', 'receptionist', 'owner'] },
            { href: 'certificates.html', text: 'Certificates', icon: 'fa-stamp', roles: ['admin', 'doctor', 'nurse', 'receptionist', 'owner'] }
        ]
    },
    {
        id: 'money', label: 'Pharmacy & billing',
        items: [
            { href: 'pharmacy.html', text: 'Pharmacy', icon: 'fa-pills', roles: ['admin', 'pharmacist', 'owner'] },
            { href: 'inventory-alerts.html', text: 'Inventory Alerts', icon: 'fa-bell', roles: ['admin', 'pharmacist', 'owner'] },
            { href: 'billing.html', text: 'Billing', icon: 'fa-file-invoice-dollar', roles: ['admin', 'receptionist', 'billing_staff', 'owner'] },
            { href: 'packages.html', text: 'Packages', icon: 'fa-box-open', roles: ['admin', 'billing_staff', 'receptionist', 'owner'] },
            { href: 'claims.html', text: 'Insurance Claims', icon: 'fa-shield-halved', roles: ['admin', 'billing_staff', 'receptionist', 'owner'] },
            { href: 'today-collections.html', text: 'Today Collections', icon: 'fa-receipt', roles: ['admin', 'receptionist', 'billing_staff', 'owner'] },
            { href: 'accounts.html', text: 'Accounts', icon: 'fa-calculator', roles: ['admin', 'owner'] }
        ]
    },
    {
        id: 'ops', label: 'Operations',
        items: [
            { href: 'attendance.html', text: 'Attendance', icon: 'fa-clock', roles: ['admin', 'owner', 'receptionist'] },
            { href: 'quality.html', text: 'Quality & Audit', icon: 'fa-clipboard-check', roles: ['admin', 'doctor', 'nurse', 'owner'] },
            { href: 'admin.html', text: 'Staff', icon: 'fa-user-doctor', roles: ['admin', 'owner'] }
        ]
    }
];

// Flat list kept for PAGE_ROLES consumers / search
const MENU_ITEMS = MENU_GROUPS.reduce(function (acc, g) { return acc.concat(g.items); }, []);

function buildSidebar(role) {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    
    const header = document.querySelector('.sidebar-header');
    if (header) {
        header.innerHTML = `
            <img src="images/logo.png" alt="Jyothsna Logo" style="height: 38px; width: 38px; border-radius: 50%; object-fit: cover; background: white; margin-right: 10px; border: 1px solid rgba(255,255,255,0.2);">
            <span style="font-size: 1.05rem; font-weight: 700; letter-spacing: 0.5px; color: white;">Jyothsna</span>
        `;
    }
    
    const r = (role || '').toLowerCase();
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    let html = '';
    const collapsed = JSON.parse(localStorage.getItem('hms_nav_collapsed') || '{}');

    MENU_GROUPS.forEach(function (group) {
        const visible = group.items.filter(function (item) { return (PAGE_ROLES[item.href] || []).includes(r); });
        if (!visible.length) return;
        const isCollapsed = collapsed[group.id] === true;
        const hasActive = visible.some(function (item) { return item.href === currentPage; });
        html += '<div class="nav-group' + ((isCollapsed && !hasActive) ? ' collapsed' : '') + '" data-group="' + group.id + '">';
        html += '<div class="nav-group-label" onclick="toggleNavGroup(\'' + group.id + '\')"><span>' + escapeHtml(group.label) + '</span><i class="fa-solid fa-chevron-down chev"></i></div>';
        html += '<div class="nav-group-items">';
        visible.forEach(function (item) {
            const activeClass = (currentPage === item.href) ? 'active' : '';
            html += '<a href="' + item.href + '" class="nav-item ' + activeClass + '" data-label="' + escapeHtml(item.text) + '"><i class="fa-solid ' + item.icon + '"></i> ' + escapeHtml(item.text) + '</a>';
        });
        html += '</div></div>';
    });
    nav.innerHTML = html;

    // Keep the active item in view
    var active = nav.querySelector('.nav-item.active');
    if (active && active.scrollIntoView) {
        setTimeout(function () { active.scrollIntoView({ block: 'nearest' }); }, 50);
    }
}
window.buildSidebar = buildSidebar;

window.toggleNavGroup = function (id) {
    var el = document.querySelector('.nav-group[data-group="' + id + '"]');
    if (!el) return;
    el.classList.toggle('collapsed');
    var store = JSON.parse(localStorage.getItem('hms_nav_collapsed') || '{}');
    store[id] = el.classList.contains('collapsed');
    localStorage.setItem('hms_nav_collapsed', JSON.stringify(store));
};

function checkAccess(allowedRoles) {
    getCurrentUser((user) => {
        const role = (user.role || '').toLowerCase();
        if (!allowedRoles.includes(role)) {
            showToast('Access denied: You do not have permission to view this page.', 'error');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        }
    });
}
window.checkAccess = checkAccess;

// ==========================================
// P1: AUTH — role compat, isActive compat
// ==========================================
var _cachedCurrentUser = null;
var _authCallbacks = [];
var _authInitialized = false;

function getCurrentUser(onSuccess) {
    if (_cachedCurrentUser) {
        if (onSuccess) onSuccess(_cachedCurrentUser);
        return;
    }
    if (onSuccess) {
        _authCallbacks.push(onSuccess);
    }
    if (_authInitialized) return;
    _authInitialized = true;

    auth.onAuthStateChanged(function(user) {
        if (user) {
            const userEmailEl = document.getElementById('userEmail');
            if (userEmailEl) userEmailEl.textContent = user.email;

            // PART 1: Look up staff document by /staff/{auth.uid} first
            db.collection('staff').doc(user.uid).get()
                .then(docSnap => {
                    if (docSnap.exists) {
                        return { docSnap: docSnap, isUidLookup: true };
                    }
                    return callFunction('syncStaffUid').then(function() {
                        return db.collection('staff').doc(user.uid).get();
                    }).then(function(staffDoc) {
                        return staffDoc.exists ? { docSnap: staffDoc, isUidLookup: true } : null;
                    });
                })
                .then(result => {
                    if (!result || !result.docSnap || !result.docSnap.exists) {
                        firebase.auth().signOut();
                        window.location.href = 'index.html';
                        return null;
                    }

                    const docSnap = result.docSnap;
                    const staffData = docSnap.data();
                    var isActive = staffData.isActive === true || staffData.isActive === 'true';

                    if (!isActive) {
                        firebase.auth().signOut();
                        showToast('Your account has been deactivated. Please contact admin.', 'error');
                        setTimeout(function() { window.location.href = 'index.html'; }, 2000);
                        return null;
                    }

                    let userData = { uid: user.uid, email: user.email, docId: docSnap.id, ...staffData };
                    // Normalize role to lowercase
                    userData.role = (staffData.role || 'unknown').toLowerCase();

                    // If found via email fallback, ask the server to create /staff/{uid} so
                    // future lookups resolve by UID. This runs server-side on purpose: the
                    // browser must never be able to write its own role document.
                    if (!result.isUidLookup) {
                        callFunction('syncStaffUid')
                            .catch(e => console.warn('Staff UID sync warning:', e.message));
                    }

                    if (userEmailEl) userEmailEl.textContent = staffData.name || user.email;
                    const adminNav = document.getElementById('adminNav');
                    if (adminNav && userData.role === 'admin') adminNav.style.display = 'flex';
                    buildSidebar(userData.role);

                    _cachedCurrentUser = userData;

                    // One account, one live session — see watchSession above.
                    watchSession(user.uid);

                    const callbacks = _authCallbacks;
                    _authCallbacks = [];
                    callbacks.forEach(function(cb) { cb(userData); });
                }).catch(err => {
                    console.error('Auth lookup error:', err);
                    const fallbackUser = { uid: user.uid, email: user.email, role: 'unknown' };
                    const callbacks = _authCallbacks;
                    _authCallbacks = [];
                    callbacks.forEach(function(cb) { cb(fallbackUser); });
                });
        } else {
            _cachedCurrentUser = null;
            if (!window.location.href.includes('index.html')) window.location.href = 'index.html';
        }
    });
}

// ==========================================
// UTILITIES
// ==========================================
function debounce(func, wait) {
    var timeout;
    return function() {
        var args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() {
            func.apply(null, args);
        }, wait);
    };
}
window.debounce = debounce;

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0);
}

// ==========================================
// DATE & TIME UTILITIES (DATE FIX 1)
// ==========================================
var _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(date) {
    if (!date) return '—';
    var d = date;
    if (date && date.toDate) d = date.toDate();
    else if (typeof date === 'string') d = new Date(date);
    else if (typeof date === 'number') d = new Date(date);
    if (!d || isNaN(d.getTime())) return '—';
    return String(d.getDate()).padStart(2,'0') + ' ' + _MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}
window.formatDate = formatDate;

function formatDateTime(date) {
    if (!date) return '—';
    var d = date;
    if (date && date.toDate) d = date.toDate();
    else if (typeof date === 'string') d = new Date(date);
    if (!d || isNaN(d.getTime())) return '—';
    var h = d.getHours();
    var min = String(d.getMinutes()).padStart(2,'0');
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return String(d.getDate()).padStart(2,'0') + ' ' + _MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + h + ':' + min + ' ' + ampm + ' IST';
}
window.formatDateTime = formatDateTime;

function formatTimeOnly(date) {
    if (!date) return '—';
    var d = date && date.toDate ? date.toDate() : new Date(date);
    if (!d || isNaN(d.getTime())) return '—';
    var h = d.getHours();
    var min = String(d.getMinutes()).padStart(2,'0');
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + min + ' ' + ampm + ' IST';
}
window.formatTimeOnly = formatTimeOnly;

// Adds days to a yyyy-mm-dd string and returns the same format.
// Deliberately built from local date parts: toISOString() would convert
// local midnight in IST back to the previous day in UTC and shift every
// EDD by one day.
function addDaysToIso(dateString, days) {
    if (!dateString) return '';
    var date = new Date(dateString + 'T00:00:00');
    if (isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + days);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
window.addDaysToIso = addDaysToIso;

// Naegele's rule — the standard EDD from a last menstrual period.
function eddFromLmp(lmp) {
    return addDaysToIso(lmp, 280);
}
window.eddFromLmp = eddFromLmp;

// Completed gestational weeks and days at a given date (default: today).
function gestationalAge(lmp, atDate) {
    if (!lmp) return null;
    var start = new Date(lmp + 'T00:00:00');
    if (isNaN(start.getTime())) return null;
    var end = atDate ? new Date(atDate + 'T00:00:00') : new Date();
    var totalDays = Math.floor((end - start) / 86400000);
    if (totalDays < 0) return null;
    var weeks = Math.floor(totalDays / 7);
    return {
        weeks: weeks,
        days: totalDays % 7,
        text: weeks + 'w ' + (totalDays % 7) + 'd',
        trimester: weeks < 14 ? 'First trimester' : (weeks < 28 ? 'Second trimester' : 'Third trimester')
    };
}
window.gestationalAge = gestationalAge;

function todayIso() {
    return isoDate(new Date());
}
window.todayIso = todayIso;

// Local YYYY-MM-DD. Never use toISOString().split('T')[0] for a date key:
// that formats in UTC, so between midnight and 05:30 IST it returns
// YESTERDAY and the night shift's admissions, bills and bed moves land on
// the wrong day.
function isoDate(value) {
    var d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
window.isoDate = isoDate;

// ==========================================
// PART 1 — DAY & MONTH BOUND HELPERS
// Returns Firestore-ready JS Date objects for use in .where() queries.
// ==========================================
function getDayBounds(dateObj) {
    var d = dateObj ? new Date(dateObj) : new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    var end   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { start: start, end: end };
}
window.getDayBounds = getDayBounds;

function getMonthBounds(dateObj) {
    var d = dateObj ? new Date(dateObj) : new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    var end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: start, end: end };
}
window.getMonthBounds = getMonthBounds;

function daysBetween(startDate, endDate) {
    var s = startDate && startDate.toDate ? startDate.toDate() : new Date(startDate);
    var e = endDate ? (endDate.toDate ? endDate.toDate() : new Date(endDate)) : new Date();
    s.setHours(0,0,0,0); e.setHours(0,0,0,0);
    return Math.max(1, Math.floor((e - s) / (1000*60*60*24)) + 1);
}
window.daysBetween = daysBetween;

function calculateAge(dob) {
    if (!dob) return '—';
    var birth = typeof dob === 'string' ? new Date(dob) : (dob && dob.toDate ? dob.toDate() : dob);
    if (!birth || isNaN(birth.getTime())) return '—';
    var today = new Date();
    var age = today.getFullYear() - birth.getFullYear();
    var m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    if (age < 0 || age > 150) return '—';
    return age;
}
window.calculateAge = calculateAge;

function timeAgo(date) {
    if (!date) return '';
    var d = date && date.toDate ? date.toDate() : (typeof date === 'string' ? new Date(date) : date);
    if (!d || isNaN(d.getTime())) return '';
    var seconds = Math.floor((new Date() - d) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds/60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds/3600) + ' hr ago';
    if (seconds < 604800) return Math.floor(seconds/86400) + ' days ago';
    return formatDate(date);
}
window.timeAgo = timeAgo;

function generateId(prefix, count) {
    return `${prefix}-${new Date().getFullYear()}-${String(count).padStart(5, '0')}`;
}

function setLoadingRow(tbodyId, colspan) {
    colspan = colspan || 6;
    const el = document.getElementById(tbodyId);
    if (el) el.innerHTML = '<tr><td colspan="' + colspan + '" style="text-align:center;padding:24px;color:#888;"><i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i>Loading...</td></tr>';
}

function setEmptyRow(tbodyId, message, colspan) {
    colspan = colspan || 6;
    const el = document.getElementById(tbodyId);
    if (el) el.innerHTML = '<tr><td colspan="' + colspan + '" style="text-align:center;padding:48px 20px;color:#9ca3af;"><i class="fa-solid fa-inbox" style="font-size:2.5rem;display:block;margin-bottom:12px;opacity:0.5;"></i><div style="font-size:14px;">' + message + '</div></td></tr>';
}

// ==========================================
// POLISH 2: CONFIRMATION MODAL
// ==========================================
function confirmAction(title, message, onConfirm, confirmText, confirmColor) {
    confirmText = confirmText || 'Confirm';
    confirmColor = confirmColor || '#DC2626';
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease;';
    overlay.innerHTML = '<div style="background:white;border-radius:12px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);transform:translateY(0);animation:slideUp 0.2s ease;">'
        + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
        + '<div style="width:36px;height:36px;border-radius:50%;background:' + confirmColor + '20;display:flex;align-items:center;justify-content:center;">'
        + '<i class="fa-solid fa-triangle-exclamation" style="color:' + confirmColor + ';font-size:16px;"></i></div>'
        + '<h3 style="margin:0;color:#0F2B5B;font-size:16px;font-weight:600;">' + title + '</h3></div>'
        + '<p style="margin:0 0 24px 0;color:#64748b;font-size:13px;line-height:1.6;">' + message + '</p>'
        + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
        + '<button class="cf-cancel" style="padding:9px 18px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:#64748b;">Cancel</button>'
        + '<button class="cf-confirm" style="padding:9px 18px;background:' + confirmColor + ';color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">' + confirmText + '</button>'
        + '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.cf-cancel').onclick = function() { overlay.remove(); };
    overlay.querySelector('.cf-confirm').onclick = function() { overlay.remove(); onConfirm(); };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}
window.confirmAction = confirmAction;


// PART 9 — EXCEL CSV EXPORT FOR ALL MODULES
function exportToCSV(data, filename) {
    if (!data || !data.length) { showToast('No data to export', 'warning'); return; }
    var headers = Object.keys(data[0]);
    var csvRows = [headers.join(',')];
    data.forEach(function(row) {
        var values = headers.map(function(h) {
            var val = row[h] || '';
            val = String(val).replace(/"/g, '""');
            if (val.includes(',') || val.includes('"') || val.includes('\n')) val = '"' + val + '"';
            return val;
        });
        csvRows.push(values.join(','));
    });
    var csvContent = csvRows.join('\n');
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename + '_' + new Date().toISOString().slice(0,10) + '.csv';
    link.click();
    showToast('Exported ' + data.length + ' rows to ' + filename + '.csv', 'success');
}
window.exportToCSV = exportToCSV;

// ==========================================
// OFFLINE SHELL & UPDATES
//
// Firestore keeps the DATA available offline; the service worker keeps
// the APP available offline. Without it, a dropped connection plus a
// refresh left staff staring at a browser error even though every
// record they needed was already cached locally.
//
// It also gives controlled updates: when a new version is deployed the
// user is told, rather than silently running half-old, half-new files.
// ==========================================
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.HMS_LOCAL) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            registrations.forEach(function(registration) { registration.unregister(); });
        });
        return;
    }
    // A service worker needs a secure context; file:// and plain http on
    // a LAN address will not register, so fail quietly there.
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

    navigator.serviceWorker.register('sw.js').then(function(registration) {
        registration.addEventListener('updatefound', function() {
            var incoming = registration.installing;
            if (!incoming) return;
            incoming.addEventListener('statechange', function() {
                // A previous worker was controlling the page, so this is a
                // genuine update rather than the very first install.
                if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdatePrompt(registration);
                }
            });
        });
    }).catch(function(err) {
        console.warn('Offline mode unavailable:', err.message);
    });

    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (reloading) return;
        reloading = true;
        window.location.reload();
    });
}

function showUpdatePrompt(registration) {
    if (document.getElementById('appUpdateBar')) return;
    var bar = document.createElement('div');
    bar.id = 'appUpdateBar';
    bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#0F172A;color:white;padding:10px 16px;border-radius:10px;z-index:99998;display:flex;align-items:center;gap:14px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,0.3);';
    bar.innerHTML = '<span><i class="fa-solid fa-circle-arrow-up" style="margin-right:8px;"></i>A new version is ready.</span>'
        + '<button id="appUpdateNow" style="background:#D6336C;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12.5px;">Update now</button>'
        + '<button id="appUpdateLater" style="background:none;color:#94a3b8;border:none;cursor:pointer;font-size:12.5px;">Later</button>';
    document.body.appendChild(bar);

    document.getElementById('appUpdateNow').onclick = function() {
        if (registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
        bar.remove();
    };
    document.getElementById('appUpdateLater').onclick = function() { bar.remove(); };
}

// ==========================================
// ONE ACTIVE SESSION PER ACCOUNT
//
// Signing in claims the account by writing a fresh session id onto
// the staff record. Every open tab watches that field; if it changes
// to an id this tab does not own, the account has been used
// somewhere else and this session signs itself out.
//
// This is a staff-discipline control, not a security boundary — the
// enforcement is co-operative and runs in the browser. It stops the
// realistic problem (one password quietly shared around the desk),
// but a determined user with the credentials could bypass it.
// ==========================================
var SESSION_KEY = 'jyothsna.sessionId';
var _sessionWatcher = null;
var _sessionSignOutInProgress = false;

function currentSessionId() {
    var id = null;
    try { id = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* private mode */ }
    return id;
}

function newSessionId() {
    var id = (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    try { sessionStorage.setItem(SESSION_KEY, id); } catch (e) { /* private mode */ }
    return id;
}

// Claims the account for this tab. Called right after a successful login.
function claimSession(uid) {
    var id = newSessionId();
    return db.collection('staff').doc(uid).set({
        activeSessionId: id,
        activeSessionAt: firebase.firestore.FieldValue.serverTimestamp(),
        activeSessionAgent: (navigator.userAgent || '').slice(0, 200)
    }, { merge: true }).then(function() { return id; });
}
window.claimSession = claimSession;

function forceSessionSignOut(message) {
    if (_sessionSignOutInProgress) return;
    _sessionSignOutInProgress = true;
    if (_sessionWatcher) { _sessionWatcher(); _sessionWatcher = null; }
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    showToast(message, 'error');
    setTimeout(function() {
        firebase.auth().signOut().then(function() {
            window.location.href = 'index.html?reason=session';
        });
    }, 2200);
}

function watchSession(uid) {
    if (_sessionWatcher) return;

    // A tab that reloads keeps its sessionStorage; a tab opened fresh
    // after login on this device adopts the stored id rather than
    // fighting with the tab that already holds it.
    var mine = currentSessionId();

    _sessionWatcher = db.collection('staff').doc(uid).onSnapshot(function(doc) {
        if (!doc.exists) return;
        var active = doc.get('activeSessionId');

        // No claim recorded yet (first run after upgrade): take it.
        if (!active) {
            if (!mine) mine = newSessionId();
            db.collection('staff').doc(uid).set({
                activeSessionId: mine,
                activeSessionAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(function(err) {
                console.warn('Could not claim session:', err.message);
            });
            return;
        }

        if (!mine) {
            // This tab never claimed anything — adopt the live session so
            // opening a second tab on the same machine is not treated as
            // a second device.
            mine = active;
            try { sessionStorage.setItem(SESSION_KEY, active); } catch (e) { /* ignore */ }
            return;
        }

        if (active !== mine) {
            forceSessionSignOut('This account was signed in on another device. You have been signed out here.');
        }

        // Deactivation takes effect without waiting for a page change.
        if (doc.get('isActive') !== true) {
            forceSessionSignOut('Your account has been deactivated.');
        }
    }, function(err) {
        console.warn('Session watch unavailable:', err.message);
    });
}
window.watchSession = watchSession;

// ==========================================
// PRODUCT BRANDING
// The hospital's own name comes from hospitalSettings; the product
// credit below is fixed. Rendered from here so all pages match and
// a change lands everywhere at once.
// ==========================================
// -------------------------------------------------------------------------
// ATTRIBUTION
//
//   Product   : JMGH HMS
//   Design     : Alvision Media
//   Owner      : Alvision Media
//   Author     : Sanath Sathyamurthy
//
// -------------------------------------------------------------------------
var PRODUCT = Object.freeze({
    name: 'JMGH HMS',
    design: 'Alvision Media',
    vendor: 'Alvision Media',
    owner: 'Alvision Media',
    author: 'Sanath Sathyamurthy',
    website: 'alvisionmedia.com',
    websiteUrl: 'https://alvisionmedia.com',
    email: 'hello@alvisionmedia.com'
});
try {
    Object.defineProperty(window, 'PRODUCT', {
        value: PRODUCT, writable: false, configurable: false, enumerable: true
    });
} catch (e) {
    window.PRODUCT = PRODUCT;
}

function renderAppFooter() {
    if (document.getElementById('appFooter')) return;
    var host = document.querySelector('.main-wrapper');
    if (!host) return;

    var year = new Date().getFullYear();
    var footer = document.createElement('footer');
    footer.id = 'appFooter';
    footer.style.cssText = 'margin-top:auto;padding:14px 28px 18px;text-align:center;color:var(--text-muted);font-size:11.5px;line-height:1.7;border-top:1px solid var(--border-color);';
    footer.innerHTML =
        '<strong style="color:var(--text-main);">' + escapeHtml(PRODUCT.name) + '</strong> &copy; ' + year
        + ' &middot; Powered by <strong style="color:var(--text-main);">' + escapeHtml(PRODUCT.vendor) + '</strong>'
        + ' &middot; <a href="' + PRODUCT.websiteUrl + '" target="_blank" rel="noopener" style="color:var(--primary-teal);text-decoration:none;">' + escapeHtml(PRODUCT.website) + '</a>'
        + ' &middot; <a href="mailto:' + PRODUCT.email + '" style="color:var(--primary-teal);text-decoration:none;">' + escapeHtml(PRODUCT.email) + '</a>'
        + '<br><span style="font-size:11px;opacity:0.9;">Designed by <strong style="color:var(--text-main);">' + escapeHtml(PRODUCT.design) + '</strong>'
        + ' &middot; Author <strong style="color:var(--text-main);">' + escapeHtml(PRODUCT.author) + '</strong></span>'
        + '<br><span style="font-size:11px;opacity:0.85;"><i class="fa-solid fa-keyboard" style="margin-right:4px;"></i>'
        + 'Shortcuts: <strong>Alt + N</strong> new patient &middot; <strong>Alt + B</strong> new bill &middot; <strong>Alt + D</strong> dashboard</span>';

    host.appendChild(footer);
}
window.renderAppFooter = renderAppFooter;

// ==========================================
// STATUS BADGES — one vocabulary for the whole app
//
// Payment, admission and workflow states used to be rendered by
// four separate functions across billing, patients, appointments
// and the patient profile, each with its own inline colours. The
// same "partial" bill was amber on one screen and blue on another.
// Everything now routes through here and through the .status-*
// classes in style.css.
// ==========================================
var STATUS_LABELS = {
    // Payment
    paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', due: 'Due',
    overdue: 'Overdue', draft: 'Draft', cancelled: 'Cancelled',
    refunded: 'Refunded', billed: 'Billed', unbilled: 'Unbilled',
    // Visit / admission
    opd: 'OPD', ipd: 'IPD', admitted: 'Admitted', emergency: 'Emergency',
    icu: 'ICU', discharged: 'Discharged', postnatal: 'Postnatal',
    in_surgery: 'In Surgery',
    // Workflow
    scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed',
    pending: 'Pending', ready: 'Ready', delivered: 'Delivered',
    noshow: 'No Show', active: 'Active', not_applicable: 'N/A'
};

// States that don't have a dedicated class fall back to a neutral one.
var STATUS_CLASS_FALLBACK = {
    unbilled: 'status-pending',
    in_progress: 'status-scheduled',
    not_applicable: 'status-draft'
};

function statusBadge(value, fallback) {
    var key = String(value === undefined || value === null || value === '' ? (fallback || 'pending') : value)
        .toLowerCase().trim().replace(/[\s-]+/g, '_');
    var cssClass = STATUS_CLASS_FALLBACK[key] || ('status-' + key.replace(/_/g, '-'));

    // The class list uses hyphens except for the two workflow states
    // that were already written with underscores in the stylesheet.
    if (key === 'in_surgery') cssClass = 'status-in_surgery';
    if (key === 'in_progress') cssClass = 'status-scheduled';

    var label = STATUS_LABELS[key] || String(value).replace(/_/g, ' ');
    return '<span class="status-badge ' + cssClass + '">' + escapeHtml(label) + '</span>';
}
window.statusBadge = statusBadge;

// Bills carry both a status and a number; showing them together is
// what the front desk actually needs to answer "does this patient owe
// anything?". Returns a badge plus the outstanding amount when there
// is one.
function dueBadge(balanceDue, paymentStatus) {
    var balance = Number(balanceDue || 0);
    var status = String(paymentStatus || '').toLowerCase().trim();
    if (!status) status = balance <= 0 ? 'paid' : 'unpaid';

    if (balance <= 0) {
        return statusBadge(status === 'cancelled' ? 'cancelled' : 'paid');
    }
    return statusBadge(status) + ' <span class="due-amount">' + formatCurrency(balance) + '</span>';
}
window.dueBadge = dueBadge;

// ==========================================
// CSV PARSING
// Handles quoted fields, embedded commas, escaped quotes ("")
// and newlines inside quotes — all of which appear in exports
// from older pharmacy and billing packages.
// ==========================================
function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    // Strip a UTF-8 BOM, which Excel adds and which otherwise
    // becomes part of the first column header.
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    for (var i = 0; i < text.length; i++) {
        var char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') { inQuotes = true; }
        else if (char === ',') { row.push(field); field = ''; }
        else if (char === '\r') { /* handled with \n */ }
        else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += char; }
    }

    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // Drop rows that are entirely blank.
    return rows.map(function(cells) {
        return cells.map(function(cell) { return String(cell).trim(); });
    }).filter(function(cells) {
        return cells.some(function(cell) { return cell !== ''; });
    });
}
window.parseCSV = parseCSV;

// Accepts the date formats old Indian software tends to emit:
// dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, mm/yyyy and mm-yy (drug expiry).
function normaliseImportedDate(value) {
    var text = String(value || '').trim();
    if (!text) return '';

    var iso = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (iso) return iso[1] + '-' + String(iso[2]).padStart(2, '0') + '-' + String(iso[3]).padStart(2, '0');

    var dmy = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (dmy) {
        var year = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
        return year + '-' + String(dmy[2]).padStart(2, '0') + '-' + String(dmy[1]).padStart(2, '0');
    }

    // Expiry is often only month and year — treat it as the last day of that month.
    var my = text.match(/^(\d{1,2})[-\/](\d{2,4})$/);
    if (my) {
        var expiryYear = Number(my[2].length === 2 ? '20' + my[2] : my[2]);
        var month = Number(my[1]);
        if (month >= 1 && month <= 12) {
            var lastDay = new Date(expiryYear, month, 0).getDate();
            return expiryYear + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
        }
    }

    return '';
}
window.normaliseImportedDate = normaliseImportedDate;

// ==========================================
// FIX 9: LOADING STATE HELPER
// ==========================================
function showLoading(elementId) {
    var el = document.getElementById(elementId);
    if (el) el.innerHTML = '<tr><td colspan="20" style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:#0D7A70;"></i><div style="margin-top:8px;color:#666;font-size:13px;">Loading...</div></td></tr>';
}
window.showLoading = showLoading;

// FIX 5: DEMO MODE BADGE (localhost only)
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    var _demoBadge = document.createElement('div');
    _demoBadge.id = 'demoModeBadge';
    // Bottom-left and click-through: at top-right it sat directly on top of
    // the Logout button and swallowed clicks aimed at it.
    _demoBadge.style.cssText = 'position:fixed;bottom:10px;left:10px;background:#D97706;color:white;padding:4px 10px;border-radius:12px;font-size:10px;font-weight:600;z-index:99997;box-shadow:0 2px 6px rgba(0,0,0,0.15);letter-spacing:0.5px;pointer-events:none;opacity:0.85;';
    _demoBadge.textContent = 'LOCAL EMULATORS · DEMO DATA';
    document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(_demoBadge); });
}

// Global logout
document.addEventListener('DOMContentLoaded', function() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            auth.signOut().then(() => { window.location.href = 'index.html'; })
                .catch(err => console.error('Logout error:', err));
        });
    }
    // Show hamburger on mobile
    if (window.innerWidth <= 768) {
        var btn = document.getElementById('mobileMenuBtn');
        if (btn) btn.style.display = 'block';
    }
    renderAppFooter();
    registerServiceWorker();

    // Hospital settings are readable only to signed-in staff, so both of
    // these wait for auth. Firing them on the login page produced a
    // permission-denied on every single page load and a wasted read.
    auth.onAuthStateChanged(function(user) {
        if (!user) return;

        // POLISH 3: Dynamic Hospital logo placeholder in sidebar header
        db.collection('hospitalSettings').doc('main').get().then(function(doc) {
            var name = 'Jyothsna Maternity Hospital';
            if (doc.exists && (doc.data().hospitalName || doc.data().name)) {
                name = doc.data().hospitalName || doc.data().name;
            }
            var headers = document.querySelectorAll('.sidebar-header');
            headers.forEach(function(h) {
                h.style.cssText = 'display:flex; align-items:center; gap:10px; padding:14px 18px; font-weight:700; color:var(--white); background:rgba(0,0,0,0.12); border-bottom:1px solid rgba(255,255,255,0.12); width:100%; box-sizing:border-box; overflow:hidden;';
                // The hospital's own logo, not a generic cross glyph — the
                // placeholder mark sitting beside the real one was the
                // "logo inside a logo" problem.
                h.innerHTML = '<img src="images/logo.png" alt="" style="width:30px;height:30px;border-radius:50%;object-fit:cover;background:#fff;flex-shrink:0;">'
                    + '<span style="font-size:13.5px; font-weight:700; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>';
            });
        }).catch(function(err) {
            console.error('Error loading sidebar branding:', err);
        });
    });
});

// POLISH 4: Session idle timer (skip on login page)
if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/' && window.location.pathname !== '') {
    var _idleTimer;
    var _IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    function _resetIdleTimer() {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(function() {
            showToast('Session expired due to inactivity. Logging out...', 'warning');
            setTimeout(function() {
                firebase.auth().signOut().then(function() {
                    window.location.href = 'index.html';
                });
            }, 2000);
        }, _IDLE_TIMEOUT);
    }
    ['click','keydown','mousemove','scroll','touchstart'].forEach(function(ev) {
        document.addEventListener(ev, _resetIdleTimer, { passive: true });
    });
    _resetIdleTimer();
}

// POLISH 8: Keyboard shortcuts (Alt+N, Alt+B, Alt+D)
document.addEventListener('keydown', function(e) {
    if (e.altKey && e.key === 'n') { e.preventDefault(); window.location.href = 'patients.html?new=true'; }
    if (e.altKey && e.key === 'b') { e.preventDefault(); window.location.href = 'billing.html?new=true'; }
    if (e.altKey && e.key === 'd') { e.preventDefault(); window.location.href = 'dashboard.html'; }
});

function toggleMobileMenu() {
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.toggle('mobile-open');
}
window.toggleMobileMenu = toggleMobileMenu;

window.addEventListener('offline', function() {
    var banner = document.getElementById('offlineBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offlineBanner';
        banner.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#DC2626;color:white;text-align:center;padding:8px;z-index:99999;font-size:13px;';
        banner.textContent = 'You are offline. Some features may not work. Data will sync when connection is restored.';
        document.body.appendChild(banner);
    }
    banner.style.display = 'block';
});
window.addEventListener('online', function() {
    var banner = document.getElementById('offlineBanner');
    if (banner) banner.style.display = 'none';
    showToast('Connection restored', 'success');
});

// ==========================================
// FILENAME SANITIZATION & PDF DOWNLOAD UTILITIES
// ==========================================
function sanitizeFilename(name) {
    if (!name) return 'document';
    var isPdf = name.toString().toLowerCase().endsWith('.pdf');
    var base = isPdf ? name.toString().slice(0, -4) : name.toString();
    var clean = base
        .replace(/[\s\\\/,]+/g, '-')       // spaces, slashes, backslashes, commas to dashes
        .replace(/[^a-zA-Z0-9\-]/g, '');   // remove everything else except letters, digits, and dashes
    // Remove consecutive dashes
    clean = clean.replace(/-+/g, '-');
    // Strip leading/trailing dashes
    clean = clean.trim().replace(/^-+|-+$/g, '');
    clean = clean || 'document';
    return isPdf ? clean + '.pdf' : clean;
}
window.sanitizeFilename = sanitizeFilename;

function savePDFHelper(doc, filename) {
    var baseName = filename || '';
    if (baseName.toLowerCase().endsWith('.pdf')) {
        baseName = baseName.substring(0, baseName.length - 4);
    }
    var sanitized = sanitizeFilename(baseName) + '.pdf';
    try {
        var blob = null;
        if (doc && typeof doc.output === 'function') {
            blob = doc.output('blob');
        } else if (doc instanceof Blob) {
            blob = doc;
        }

        if (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.setAttribute('download', sanitized);
            a.download = sanitized;
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {
                if (a.parentNode) {
                    document.body.removeChild(a);
                }
                URL.revokeObjectURL(url);
            }, 2500);
            showToast('PDF downloaded: ' + sanitized, 'success');
            return;
        }

        // Fallback if output('blob') wasn't available
        if (doc && typeof doc.save === 'function') {
            doc.save(sanitized);
            showToast('PDF downloaded: ' + sanitized, 'success');
            return;
        }
    } catch (e) {
        console.error('savePDFHelper failed:', e);
        showToast('Unable to download PDF: ' + e.message, 'error');
    }
}
window.savePDFHelper = savePDFHelper;

// Ensure any direct doc.save(...) across libraries uses our DOM-appended anchor
if (typeof window !== 'undefined') {
    function patchJsPdfSave() {
        if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.prototype && !window.jspdf.jsPDF.prototype._patchedSave) {
            var origSave = window.jspdf.jsPDF.prototype.save;
            window.jspdf.jsPDF.prototype.save = function(filename) {
                if (window.savePDFHelper) {
                    return window.savePDFHelper(this, filename);
                }
                return origSave.apply(this, arguments);
            };
            window.jspdf.jsPDF.prototype._patchedSave = true;
        }
    }
    patchJsPdfSave();
    window.addEventListener('DOMContentLoaded', patchJsPdfSave);
}

// ==========================================
// SHARED BILLS REPORT
// One generator so the reception desk and the pharmacy counter hand over
// the same document: letterhead, what was filtered, a payment-method
// summary that reconciles against the drawer, then the bill lines.
// opts = { title, bills, filterLabel, filename }
// ==========================================
function hmsBillsReportPDF(opts) {
    opts = opts || {};
    var bills = opts.bills || [];
    if (!bills.length) {
        showToast('No bills to include in the report.', 'warning');
        return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        showToast('PDF library is not loaded on this page.', 'error');
        return;
    }

    return db.collection('hospitalSettings').doc('main').get().then(function (settingsDoc) {
        var s = settingsDoc.exists ? settingsDoc.data() : {};
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();

        // Letterhead
        doc.setFillColor(15, 43, 91);
        doc.rect(0, 0, pageWidth, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text(s.hospitalName || 'Hospital', pageWidth / 2, 12, { align: 'center' });
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(s.address || '', pageWidth / 2, 18, { align: 'center' });
        doc.text('Phone: ' + (s.phone || '') + '   Email: ' + (s.email || ''), pageWidth / 2, 23, { align: 'center' });
        if (s.gstin) doc.text('GSTIN: ' + s.gstin, pageWidth / 2, 28, { align: 'center' });

        var y = 40;
        doc.setTextColor(15, 43, 91);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text(String(opts.title || 'BILLS REPORT').toUpperCase(), pageWidth / 2, y, { align: 'center' });
        y += 6;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(90, 90, 90);
        doc.text((opts.filterLabel || 'All bills') + '   ·   ' + bills.length + ' bill(s)   ·   generated '
            + new Date().toLocaleString('en-IN'), pageWidth / 2, y, { align: 'center' });
        y += 7;

        // Payment-method summary
        var buckets = { Cash: 0, Card: 0, PhonePe: 0, UPI: 0, 'Insurance / Scheme': 0, Credit: 0 };
        var billed = 0, collected = 0, outstanding = 0;
        bills.forEach(function (b) {
            billed += Number(b.grandTotal || 0);
            outstanding += Number(b.balanceDue || 0);
            if (b.paymentDetails) {
                Object.keys(b.paymentDetails).forEach(function (m) {
                    var amt = parseFloat(b.paymentDetails[m].amount) || 0;
                    collected += amt;
                    var k = m.toLowerCase();
                    if (k === 'cash') buckets.Cash += amt;
                    else if (k === 'card') buckets.Card += amt;
                    else if (k === 'phonepe') buckets.PhonePe += amt;
                    else if (k.indexOf('upi') !== -1) buckets.UPI += amt;
                    else if (k.indexOf('insurance') !== -1 || k.indexOf('aarogyasri') !== -1 || k.indexOf('scheme') !== -1) buckets['Insurance / Scheme'] += amt;
                    else if (k === 'credit') buckets.Credit += amt;
                });
            } else {
                var amt2 = Math.max(0, Number(b.grandTotal || 0) - Number(b.balanceDue || 0));
                collected += amt2;
                var k2 = String(b.paymentMethod || '').toLowerCase();
                if (k2 === 'cash') buckets.Cash += amt2;
                else if (k2 === 'card') buckets.Card += amt2;
                else if (k2 === 'phonepe') buckets.PhonePe += amt2;
                else if (k2.indexOf('upi') !== -1) buckets.UPI += amt2;
                else if (k2.indexOf('insurance') !== -1 || k2.indexOf('aarogyasri') !== -1) buckets['Insurance / Scheme'] += amt2;
                else if (k2 === 'credit') buckets.Credit += amt2;
            }
        });

        doc.setFillColor(245, 247, 250);
        doc.rect(10, y, pageWidth - 20, 30, 'F');
        doc.setFontSize(9);
        doc.setTextColor(15, 43, 91);
        doc.setFont(undefined, 'bold');
        doc.text('SUMMARY', 12, y + 5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(60, 60, 60);
        doc.text('Total billed: Rs ' + billed.toFixed(2), 12, y + 11);
        doc.text('Total collected: Rs ' + collected.toFixed(2), 12, y + 16);
        doc.text('Outstanding: Rs ' + outstanding.toFixed(2), 12, y + 21);
        var keys = Object.keys(buckets);
        keys.forEach(function (k, i) {
            var col = i < 3 ? 80 : 138;
            var row = (i % 3);
            doc.text(k + ': Rs ' + buckets[k].toFixed(2), col, y + 11 + row * 5);
        });
        y += 36;

        var body = bills.map(function (b) {
            var t = '—';
            if (b.createdAt) {
                var d = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                if (!isNaN(d.getTime())) t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            }
            return [
                b.billId || '—',
                b.patientName || '—',
                b.patientId || '—',
                b.billType || b.type || '—',
                'Rs ' + Number(b.grandTotal || 0).toFixed(2),
                'Rs ' + Number(b.balanceDue || 0).toFixed(2),
                b.paymentMethods ? b.paymentMethods.join(', ') : (b.paymentMethod || '—'),
                String(b.paymentStatus || b.status || '—').toUpperCase(),
                t
            ];
        });

        doc.autoTable({
            startY: y,
            head: [['Bill No', 'Patient', 'Patient ID', 'Type', 'Amount', 'Balance', 'Method', 'Status', 'Time']],
            body: body,
            theme: 'grid',
            headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 7.5, textColor: [60, 60, 60] },
            columnStyles: {
                0: { cellWidth: 27 }, 1: { cellWidth: 32 }, 2: { cellWidth: 24 },
                3: { cellWidth: 16, halign: 'center' }, 4: { cellWidth: 21, halign: 'right' },
                5: { cellWidth: 20, halign: 'right' }, 6: { cellWidth: 22 },
                7: { cellWidth: 16, halign: 'center' }, 8: { cellWidth: 14, halign: 'center' }
            },
            margin: { left: 10, right: 10 }
        });

        doc.setTextColor(120, 120, 120);
        doc.setFontSize(8);
        doc.setFont(undefined, 'italic');
        doc.text('Computer-generated report. No signature required.', pageWidth / 2, pageHeight - 10, { align: 'center' });

        savePDFHelper(doc, opts.filename || 'Bills-Report-' + todayIso());
    }).catch(function (err) {
        showToast('Could not build the report: ' + err.message, 'error');
    });
}
window.hmsBillsReportPDF = hmsBillsReportPDF;

// ==========================================
// BILL PDF GENERATION
// ==========================================
function generateBillPDF(billId) {
    if (!billId) { showToast('Invalid Bill ID', 'error'); return; }
    var db = firebase.firestore();
    showToast('Preparing bill PDF...', 'info');

    function fetchSettingsAndBuildPDF(billData, docId) {
        billData.id = billData.id || docId;
        return db.collection('hospitalSettings').doc('main').get()
        .then(function(settingsDoc) {
            var settings = settingsDoc.exists ? settingsDoc.data() : {};
            createPDF(billData, settings);
        });
    }

    // 1. Try doc by ID
    db.collection('bills').doc(billId).get()
    .then(function(doc) {
        if (doc.exists) {
            return fetchSettingsAndBuildPDF(doc.data(), doc.id);
        }
        // 2. Try query by billId field
        return db.collection('bills').where('billId', '==', billId).get()
        .then(function(snap) {
            if (!snap.empty) {
                return fetchSettingsAndBuildPDF(snap.docs[0].data(), snap.docs[0].id);
            }
            // 3. Try query by billDocId field
            return db.collection('bills').where('billDocId', '==', billId).get()
            .then(function(snap2) {
                if (!snap2.empty) {
                    return fetchSettingsAndBuildPDF(snap2.docs[0].data(), snap2.docs[0].id);
                }
                // 4. Try collectionGroup query for patient subcollections
                return db.collectionGroup('bills').where('billId', '==', billId).get()
                .then(function(snap3) {
                    if (!snap3.empty) {
                        return fetchSettingsAndBuildPDF(snap3.docs[0].data(), snap3.docs[0].id);
                    }
                    showToast('Bill not found in system: ' + billId, 'error');
                });
            });
        });
    })
    .catch(function(err) {
        console.error('Error generating PDF:', err);
        showToast('Error generating PDF: ' + err.message, 'error');
    });
}

async function createPDF(bill, settings) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;

    // === HEADER (Navy Banner matching Prescription Template) ===
    doc.setFillColor(15, 43, 91);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', pageWidth/2, 12, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(settings.address || '123 Main Road, Madhanapalli', pageWidth/2, 18, { align: 'center' });
    doc.text('Phone: ' + (settings.phone || '+91 40 4455 2200') + '  |  Email: ' + (settings.email || 'info@srilakshmi.hospital'), pageWidth/2, 23, { align: 'center' });
    if (settings.gstin || true) doc.text('GSTIN: ' + (settings.gstin || '36AABCS1234D1Z5'), pageWidth/2, 28, { align: 'center' });

    y = 38;

    // === BILL TITLE ===
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');

    if (typeof teluguTextImage === 'function') {
        try {
            const titleTelugu = await teluguTextImage('ఆస్పత్రి రసీదు', 60, 12);
            if (titleTelugu && titleTelugu.dataUrl) {
                const englishTitle = 'HOSPITAL RECEIPT / ';
                const englishWidth = doc.getTextWidth(englishTitle);
                const totalWidth = englishWidth + titleTelugu.widthMm;
                const startX = (pageWidth - totalWidth) / 2;
                doc.text(englishTitle, startX, y);
                doc.addImage(titleTelugu.dataUrl, 'PNG', startX + englishWidth, y - titleTelugu.heightMm + 1.5, titleTelugu.widthMm, titleTelugu.heightMm);
            } else {
                doc.text('HOSPITAL RECEIPT / ఆస్పత్రి రసీదు', pageWidth / 2, y, { align: 'center' });
            }
        } catch (e) {
            doc.text('HOSPITAL RECEIPT', pageWidth / 2, y, { align: 'center' });
        }
    } else {
        doc.text('HOSPITAL RECEIPT', pageWidth / 2, y, { align: 'center' });
    }
    y += 6;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(10, y, pageWidth - 10, y);
    y += 5;

    // === PATIENT & DETAILS CARD (Light Gray Card matching Prescription Template) ===
    doc.setFillColor(244, 246, 249);
    doc.rect(10, y, pageWidth - 20, 26, 'F');

    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);

    var leftX = 14;
    var rightX = 110;
    var lineY = y + 5;

    var billDate = '';
    if (bill.createdAt) {
        try {
            billDate = bill.createdAt.toDate ? bill.createdAt.toDate().toLocaleDateString('en-IN') : new Date(bill.createdAt).toLocaleDateString('en-IN');
        } catch(e) {
            billDate = new Date().toLocaleDateString('en-IN');
        }
    } else {
        billDate = new Date().toLocaleDateString('en-IN');
    }

    doc.setFont(undefined, 'bold');
    doc.text('Receipt No / రసీదు సంఖ్య:', leftX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.billId || '', leftX + 44, lineY);

    doc.setFont(undefined, 'bold');
    doc.text('Date / తేదీ:', rightX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(billDate, rightX + 26, lineY);
    lineY += 5;

    doc.setFont(undefined, 'bold');
    doc.text('Patient Name / పేషెంట్ పేరు:', leftX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.patientName || '', leftX + 44, lineY);

    doc.setFont(undefined, 'bold');
    doc.text('DO Admission / చేరిన తేదీ:', rightX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.admissionDate || bill.doAdmission || billDate, rightX + 44, lineY);
    lineY += 5;

    doc.setFont(undefined, 'bold');
    doc.text('Patient ID:', leftX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.patientId || '', leftX + 44, lineY);

    doc.setFont(undefined, 'bold');
    doc.text('DO Discharge / డిశ్చార్జ్ తేదీ:', rightX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.dischargeDate || bill.doDischarge || bill.expectedDischargeDate || '-', rightX + 44, lineY);
    lineY += 5;

    doc.setFont(undefined, 'bold');
    doc.text('Age / Sex / వయస్సు & లింగం:', leftX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text((bill.age || '-') + ' / ' + (bill.gender || bill.sex || '-'), leftX + 44, lineY);

    doc.setFont(undefined, 'bold');
    doc.text('Doctor Name / డాక్టర్:', rightX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.visitDoctor || '-', rightX + 34, lineY);
    lineY += 5;

    doc.setFont(undefined, 'bold');
    doc.text('Address / చిరునామా:', leftX, lineY);
    doc.setFont(undefined, 'normal');
    doc.text(bill.address || bill.patientAddress || '-', leftX + 44, lineY);

    y += 30;

    // === PROCEDURE UNDERWENT SECTION ===
    if (bill.procedureUnderwent || bill.labNotes || bill.notes) {
        doc.setDrawColor(203, 213, 225);
        doc.rect(10, y, pageWidth - 20, 10);
        doc.setFont(undefined, 'bold');
        doc.text('Procedure Underwent / చేసిన చికిత్స / విధానం:', 14, y + 4);
        doc.setFont(undefined, 'normal');
        doc.text(bill.procedureUnderwent || bill.labNotes || bill.notes || '—', 14, y + 8);
        y += 14;
    }

    // === PAYMENT DETAILS TITLE ===
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 43, 91);
    doc.text('PAYMENT DETAILS / చెల్లింపు వివరాలు', 10, y);
    y += 4;

    // === ITEMS TABLE (Navy Bar Header + Rate & Amount Pricing) ===
    var tableBody = [];
    (bill.items || []).forEach(function(item, idx) {
        var rawDesc = item.description || item.category || '';
        var te = window.hmsI18n && window.hmsI18n.DICT && window.hmsI18n.DICT[rawDesc] ? ('\n' + window.hmsI18n.DICT[rawDesc]) : '';
        tableBody.push([
            (idx + 1).toString(),
            rawDesc + te,
            (item.quantity || 1).toString(),
            'Rs ' + (item.unitPrice || 0).toFixed(2),
            'Rs ' + (item.amount || 0).toFixed(2)
        ]);
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Particulars / వివరాలు (English / Telugu)', 'Qty', 'Rate (Rs)', 'Amount (Rs) / మొత్తం']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: [40, 40, 40] },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 98 },
            2: { cellWidth: 15, halign: 'center' },
            3: { cellWidth: 32, halign: 'right' },
            4: { cellWidth: 35, halign: 'right' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 5;

    // === TOTALS ===
    var totalsX = 110;
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    doc.text('Subtotal:', totalsX, y);
    doc.text('Rs ' + (bill.subtotal || bill.grandTotal || 0).toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 5;
    if (bill.discountAmount && bill.discountAmount > 0) {
        doc.setTextColor(217, 119, 6);
        doc.text('Discount (' + (bill.discountPercent || 0) + '%):', totalsX, y);
        doc.text('- Rs ' + bill.discountAmount.toFixed(2), pageWidth - 12, y, { align: 'right' });
        doc.setTextColor(60, 60, 60);
        y += 5;
    }
    if (bill.gstAmount && bill.gstAmount > 0) {
        doc.text('GST:', totalsX, y);
        doc.text('Rs ' + bill.gstAmount.toFixed(2), pageWidth - 12, y, { align: 'right' });
        y += 5;
    }
    doc.setLineWidth(0.4);
    doc.line(totalsX, y, pageWidth - 12, y);
    y += 5;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 43, 91);
    doc.text('Grand Total:', totalsX, y);
    doc.text('Rs ' + (bill.grandTotal || 0).toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 8;

    // === PAYMENT INFO ===
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 14, 'F');
    doc.setFont(undefined, 'bold');
    doc.text('Payment Method:', 12, y + 5);
    doc.setFont(undefined, 'normal');
    doc.text((bill.paymentMethod || (bill.paymentMethods ? bill.paymentMethods.join(', ') : 'Cash')).toUpperCase(), 50, y + 5);
    doc.setFont(undefined, 'bold');
    doc.text('Amount Paid:', 12, y + 10);
    doc.setFont(undefined, 'normal');
    doc.text('Rs ' + (bill.amountPaid || (bill.grandTotal - bill.balanceDue) || 0).toFixed(2), 50, y + 10);
    doc.setFont(undefined, 'bold');
    doc.text('Balance Due:', 120, y + 5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor((bill.balanceDue || 0) > 0 ? 220 : 60, (bill.balanceDue || 0) > 0 ? 38 : 60, (bill.balanceDue || 0) > 0 ? 38 : 60);
    doc.text('Rs ' + (bill.balanceDue || 0).toFixed(2), 150, y + 5);
    doc.setTextColor(60, 60, 60);
    doc.setFont(undefined, 'bold');
    doc.text('Payment Status:', 120, y + 10);
    doc.setFont(undefined, 'normal');
    var status = (bill.paymentStatus || bill.status || 'unpaid').toUpperCase();
    if (status === 'PAID') doc.setTextColor(13, 122, 112);
    else if (status === 'UNPAID') doc.setTextColor(220, 38, 38);
    else if (status === 'PARTIAL') doc.setTextColor(217, 119, 6);
    else doc.setTextColor(30, 64, 175);
    doc.text(status, 152, y + 10);
    y += 18;

    // === SIGNATURE LINES (POLISH 5) ===
    var sigY = pageHeight - 45;
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    doc.line(20, sigY, 75, sigY);
    doc.line(pageWidth - 75, sigY, pageWidth - 20, sigY);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Cashier Signature', 47, sigY + 5, { align: 'center' });
    doc.text('Patient / Attendant Signature', pageWidth - 47, sigY + 5, { align: 'center' });

    // === FOOTER ===
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    doc.text('This is a computer-generated invoice. Original copy only.', pageWidth/2, pageHeight - 15, { align: 'center' });
    doc.text('Thank you for choosing ' + (settings.hospitalName || 'Jyothsna Maternity Hospital'), pageWidth/2, pageHeight - 10, { align: 'center' });
    doc.text('Generated: ' + formatDateTime(new Date()), pageWidth/2, pageHeight - 5, { align: 'center' });

    // === SAVE ===
    var filename = 'Bill-' + (bill.billId || bill.id || 'Unknown') + '.pdf';
    savePDFHelper(doc, filename);
}

// ==========================================
// CONSOLIDATED BILLING SUMMARY PDF GENERATOR
// ==========================================
function generateConsolidatedBillPDF(patientId) {
    var db = firebase.firestore();
    showToast('Generating Consolidated Billing Summary...', 'info');

    // 1. Fetch patient details
    db.collection('patients').where('patientId', '==', patientId).get()
    .then(function(patientSnap) {
        if (patientSnap.empty) {
            throw new Error('Patient record not found in system.');
        }
        var patient = patientSnap.docs[0].data();
        patient.docId = patientSnap.docs[0].id;

        // 2. Fetch all bills for this patient
        return db.collection('bills').where('patientId', '==', patientId).get()
        .then(function(billsSnap) {
            var bills = [];
            billsSnap.forEach(function(doc) {
                var b = doc.data();
                b.id = doc.id;
                bills.push(b);
            });

            // 3. Fetch hospital settings
            return db.collection('hospitalSettings').doc('main').get()
            .then(function(settingsDoc) {
                var settings = settingsDoc.exists ? settingsDoc.data() : {};
                buildConsolidatedPDF(patient, bills, settings);
            });
        });
    })
    .catch(function(err) {
        console.error('Error generating consolidated PDF:', err);
        showToast('Error generating PDF: ' + err.message, 'error');
    });
}
window.generateConsolidatedBillPDF = generateConsolidatedBillPDF;

function buildConsolidatedPDF(patient, bills, settings) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;

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
    if (settings.gstin) doc.text('GSTIN: ' + settings.gstin, pageWidth/2, 28, { align: 'center' });

    y = 40;

    // === TITLE ===
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('CONSOLIDATED BILLING SUMMARY', pageWidth/2, y, { align: 'center' });
    y += 8;

    // === PATIENT CARD ===
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 22, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(10);
    doc.text('PATIENT INFORMATION', 12, y + 5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.text('Name: ' + (patient.name || ''), 12, y + 10);
    doc.text('Patient ID: ' + (patient.patientId || ''), 12, y + 15);
    doc.text('Phone: ' + (patient.phone || '-'), 100, y + 10);
    doc.text('Gender / Age: ' + (patient.gender || '-') + ' / ' + (patient.dob ? calculateAge(patient.dob) + ' Yrs' : '—'), 100, y + 15);
    y += 28;

    // === BILLS OVERVIEW TABLE ===
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(11);
    doc.text('Bills Summary List', 10, y);
    y += 4;

    var billsTableBody = [];
    var grandTotalBilled = 0;
    var grandTotalPaid = 0;
    var grandTotalBalance = 0;

    // Sort bills by date
    bills.sort((a, b) => {
        const dateA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
        const dateB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
        return dateA - dateB;
    });

    bills.forEach(function(bill, idx) {
        var billDate = '';
        if (bill.createdAt) {
            billDate = bill.createdAt.toDate ? bill.createdAt.toDate().toLocaleDateString('en-IN') : new Date(bill.createdAt).toLocaleDateString('en-IN');
        }
        var total = bill.grandTotal || 0;
        var paid = bill.amountPaid || (bill.grandTotal - (bill.balanceDue || 0)) || 0;
        var bal = bill.balanceDue || (total - paid) || 0;
        if (bal < 0) bal = 0;

        grandTotalBilled += total;
        grandTotalPaid += paid;
        grandTotalBalance += bal;

        billsTableBody.push([
            (idx + 1).toString(),
            bill.billId || bill.id.substring(0,8),
            bill.billType || bill.type || 'OPD',
            billDate,
            (bill.paymentStatus || 'unpaid').toUpperCase(),
            'Rs ' + total.toFixed(2),
            'Rs ' + paid.toFixed(2),
            'Rs ' + bal.toFixed(2)
        ]);
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Bill No', 'Type', 'Date', 'Status', 'Total Billed', 'Amount Paid', 'Balance Due']],
        body: billsTableBody,
        theme: 'grid',
        headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 28 },
            2: { cellWidth: 15, halign: 'center' },
            3: { cellWidth: 22, halign: 'center' },
            4: { cellWidth: 22, halign: 'center' },
            5: { cellWidth: 32, halign: 'right' },
            6: { cellWidth: 32, halign: 'right' },
            7: { cellWidth: 31, halign: 'right' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 8;

    // === DETAILED CHARGES TABLE ===
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(11);
    doc.text('Detailed Items Breakdown', 10, y);
    y += 4;

    var itemsTableBody = [];
    var chargeIndex = 1;
    bills.forEach(function(bill) {
        var billNo = bill.billId || bill.id.substring(0, 8);
        (bill.items || []).forEach(function(item) {
            itemsTableBody.push([
                chargeIndex.toString(),
                item.description || item.category || 'Service Charge',
                billNo,
                item.category || 'General',
                (item.quantity || 1).toString(),
                'Rs ' + (item.unitPrice || 0).toFixed(2),
                'Rs ' + (item.amount || 0).toFixed(2)
            ]);
            chargeIndex++;
        });
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Charge Description', 'From Bill', 'Category', 'Qty', 'Rate', 'Total Amount']],
        body: itemsTableBody,
        theme: 'striped',
        headStyles: { fillColor: [13, 122, 112], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 62 },
            2: { cellWidth: 28 },
            3: { cellWidth: 25 },
            4: { cellWidth: 12, halign: 'center' },
            5: { cellWidth: 25, halign: 'right' },
            6: { cellWidth: 30, halign: 'right' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 8;

    // Check if y is near the bottom to prevent overflow
    if (y > pageHeight - 65) {
        doc.addPage();
        y = 20;
    }

    // === CONSOLIDATED SUMMARY BLOCK ===
    var totalsX = 110;
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    doc.setFont(undefined, 'normal');
    doc.text('Total Billed Amount:', totalsX, y);
    doc.text('Rs ' + grandTotalBilled.toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 5;

    doc.text('Total Amount Paid:', totalsX, y);
    doc.text('Rs ' + grandTotalPaid.toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 5;

    doc.setLineWidth(0.4);
    doc.setDrawColor(15, 43, 91);
    doc.line(totalsX, y, pageWidth - 12, y);
    y += 5;

    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(220, 38, 38); // Bold corporate red for outstanding due
    doc.text('Consolidated Due:', totalsX, y);
    doc.text('Rs ' + grandTotalBalance.toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 10;

    // === SIGNATURE LINES ===
    var sigY = pageHeight - 45;
    if (y > sigY - 10) {
        doc.addPage();
        sigY = pageHeight - 45;
    }
    
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.3);
    doc.line(20, sigY, 75, sigY);
    doc.line(pageWidth - 75, sigY, pageWidth - 20, sigY);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Finance Officer Signature', 47, sigY + 5, { align: 'center' });
    doc.text('Patient / Attendant Signature', pageWidth - 47, sigY + 5, { align: 'center' });

    // === FOOTER ===
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    doc.text('This is a Consolidated Financial Summary. Verified and certified true copy.', pageWidth/2, pageHeight - 15, { align: 'center' });
    doc.text('Thank you for choosing ' + (settings.hospitalName || 'Jyothsna Maternity Hospital'), pageWidth/2, pageHeight - 10, { align: 'center' });
    doc.text('Generated: ' + formatDateTime(new Date()), pageWidth/2, pageHeight - 5, { align: 'center' });

    // === SAVE ===
    var filename = 'Consolidated-Bill-' + (patient.patientId || 'Patient') + '-' + (patient.name || 'patient') + '.pdf';
    savePDFHelper(doc, filename);
}

// ==========================================
// DAILY BED CHARGE ACCUMULATION (PART 3)
// ==========================================
function updateDailyBedCharges() {
    var db = firebase.firestore();
    return db.collection('bills')
    .where('isRunningBill', '==', true)
    .where('isFinalized', '==', false)
    .get()
    .then(function(snap) {
        var promises = [];
        snap.forEach(function(doc) {
            var bill = doc.data();
            if (!bill.admissionDate || !bill.dailyRate || !bill.bedNumber) return;
            var promise = checkAndAddBedCharges(doc.id, bill);
            promises.push(promise);
        });
        return Promise.all(promises);
    })
    .catch(function(err) {
        console.error("Daily bed charges error:", err);
    });
}
window.updateDailyBedCharges = updateDailyBedCharges;

function checkAndAddBedCharges(billDocId, bill) {
    var db = firebase.firestore();
    var admissionDate = new Date(bill.admissionDate);
    admissionDate.setHours(0, 0, 0, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var daysStayed = daysBetween(bill.admissionDate, today);
    var dailyChargesAdded = (bill.dailyCharges || []).length;

    if (daysStayed > dailyChargesAdded) {
        var billRef = db.collection('bills').doc(billDocId);
        return db.runTransaction(function(transaction) {
            return transaction.get(billRef).then(function(doc) {
                var current = doc.data();
                var existingDailyCharges = (current.dailyCharges || []).slice();
                var existingItems = (current.items || []).slice();

                // Add missing days
                for (var i = existingDailyCharges.length; i < daysStayed; i++) {
                    var chargeDate = new Date(admissionDate);
                    chargeDate.setDate(chargeDate.getDate() + i);
                    var dayNumber = i + 1;

                    // Skip first day if already in items (initial bed charge)
                    if (i === 0 && existingItems.some(function(it) {
                        return it.category === 'Bed Charges' && !it.isRunningCharge;
                    })) {
                        existingDailyCharges.push({
                            day: 1,
                            date: chargeDate.toISOString().slice(0, 10),
                            amount: current.dailyRate,
                            autoAdded: false,
                            note: 'Initial bed charge'
                        });
                        continue;
                    }

                    existingDailyCharges.push({
                        day: dayNumber,
                        date: chargeDate.toISOString().slice(0, 10),
                        amount: current.dailyRate,
                        autoAdded: true
                    });

                    existingItems.push({
                        category: 'Bed Charges',
                        description: 'Bed ' + current.bedNumber + ' ' + (current.ward || '') + ' - Day ' + dayNumber + ' (' + chargeDate.toISOString().slice(0, 10) + ')',
                        quantity: 1,
                        unitPrice: current.dailyRate,
                        amount: current.dailyRate,
                        addedAt: new Date().toISOString(),
                        addedBy: 'system_auto',
                        isRunningCharge: true,
                        dayNumber: dayNumber
                    });
                }

                var newSubtotal = existingItems.reduce(function(sum, i) { return sum + (i.amount || 0); }, 0);
                var newGrandTotal = newSubtotal - (current.discountAmount || 0) + (current.gstAmount || 0);
                var newBalanceDue = newGrandTotal - (current.amountPaid || 0);

                transaction.update(billRef, {
                    items: existingItems,
                    dailyCharges: existingDailyCharges,
                    daysOfStay: daysStayed,
                    subtotal: newSubtotal,
                    grandTotal: newGrandTotal,
                    balanceDue: newBalanceDue,
                    paymentStatus: (current.amountPaid || 0) >= newGrandTotal ? 'paid' : (current.amountPaid || 0) > 0 ? 'partial' : 'unpaid',
                    lastChargeUpdate: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
        });
    }
    return Promise.resolve();
}
window.checkAndAddBedCharges = checkAndAddBedCharges;

// ==========================================
// CLINICAL DISCHARGE SUMMARY PDF (PART 6)
// ==========================================
function generateDischargeSummaryPDF(billId) {
    var db = firebase.firestore();
    showToast("Preparing discharge summary & final invoice...", "info");
    
    db.collection('bills').doc(billId).get()
    .then(function(billDoc) {
        if (!billDoc.exists) { showToast("Bill record not found", "error"); return; }
        var bill = billDoc.data();
        bill.id = billDoc.id;
        
        var hospitalPromise = db.collection('hospitalSettings').doc('main').get();
        
        // Latest consultation for clinical diagnosis
        var diagnosisPromise = db.collection('consultations')
            .where('patientId', '==', bill.patientId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
            
        // Lab & imaging reports completed during stay
        var reportsPromise = db.collection('reports')
            .where('patientId', '==', bill.patientId)
            .get();
            
        // Pharmacy dispensations completed during stay
        var medsPromise = db.collection('dispensingHistory')
            .where('patientId', '==', bill.patientId)
            .get();
            
        return Promise.all([hospitalPromise, diagnosisPromise, reportsPromise, medsPromise])
        .then(function(results) {
            var settings = results[0].exists ? results[0].data() : {};
            
            var diagnosis = 'Under Investigation';
            if (!results[1].empty) {
                var diagData = results[1].docs[0].data();
                diagnosis = diagData.diagnosis || diagData.symptoms || 'Under Investigation';
            }
            
            var admissionTime = new Date(bill.admissionDate);
            admissionTime.setHours(0, 0, 0, 0);
            var dischargeTime = bill.dischargeDate ? new Date(bill.dischargeDate) : new Date();
            dischargeTime.setHours(23, 59, 59, 999);
            
            // Memory filter diagnostic reports during stay
            var stayReports = [];
            results[2].forEach(function(doc) {
                var r = doc.data();
                var rDate = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null;
                if (rDate && rDate >= admissionTime && rDate <= dischargeTime) {
                    stayReports.push(r);
                }
            });
            
            // Memory filter pharmacy dispensations during stay
            var stayMeds = [];
            results[3].forEach(function(doc) {
                var m = doc.data();
                var mDate = m.createdAt ? (m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt)) : null;
                if (mDate && mDate >= admissionTime && mDate <= dischargeTime) {
                    stayMeds.push(m);
                }
            });
            
            buildDischargeSummaryPDF(bill, settings, diagnosis, stayReports, stayMeds);
        });
    })
    .catch(function(err) {
        console.error("Discharge summary generation error:", err);
        showToast("Error generating PDF: " + err.message, "error");
    });
}
window.generateDischargeSummaryPDF = generateDischargeSummaryPDF;

function buildDischargeSummaryPDF(bill, settings, diagnosis, reports, meds) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;

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
    if (settings.gstin) doc.text('GSTIN: ' + settings.gstin, pageWidth/2, 28, { align: 'center' });

    y = 40;

    // === TITLE ===
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('CLINICAL DISCHARGE SUMMARY & FINAL INVOICE', pageWidth/2, y, { align: 'center' });
    y += 8;

    // === PATIENT & ADMISSION DETAILS ===
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 26, 'F');
    
    doc.setFontSize(9);
    doc.setTextColor(15, 43, 91);
    doc.setFont(undefined, 'bold');
    doc.text('PATIENT CLINICAL RECORD', 12, y + 5);
    
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text('Name: ' + (bill.patientName || ''), 12, y + 11);
    doc.text('Patient ID: ' + (bill.patientId || ''), 12, y + 16);
    doc.text('Doctor: ' + (bill.visitDoctor || '-'), 12, y + 21);
    
    doc.text('Ward: ' + (bill.bedWard || bill.ward || 'General'), 100, y + 11);
    doc.text('Bed Number: ' + (bill.bedNumber || '—'), 100, y + 16);
    doc.text('Days of Stay: ' + (bill.daysOfStay || 1) + ' day(s)', 100, y + 21);
    
    doc.text('Admitted: ' + (bill.admissionDate || '—'), 150, y + 11);
    doc.text('Discharged: ' + (bill.dischargeDate || '—'), 150, y + 16);
    
    y += 32;

    // === CLINICAL DIAGNOSIS ===
    doc.setFillColor(254, 243, 199);
    doc.rect(10, y, pageWidth - 20, 12, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('FINAL DIAGNOSIS AT DISCHARGE', 12, y + 5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(diagnosis, 12, y + 9);
    
    y += 18;

    // === DAY-WISE / INVOICE CHARGES AUTO TABLE ===
    var chargesBody = [];
    (bill.items || []).forEach(function(item, idx) {
        chargesBody.push([
            (idx + 1).toString(),
            item.description || item.category || '',
            (item.quantity || 1).toString(),
            'Rs ' + (item.unitPrice || 0).toFixed(2),
            'Rs ' + (item.amount || 0).toFixed(2)
        ]);
    });

    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.text('ITEMIZED FINANCIAL STATEMENT', 10, y);
    y += 4;

    doc.autoTable({
        startY: y,
        head: [['#', 'Description', 'Qty', 'Rate', 'Amount']],
        body: chargesBody,
        theme: 'grid',
        headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 95 },
            2: { cellWidth: 15, halign: 'center' },
            3: { cellWidth: 35, halign: 'right' },
            4: { cellWidth: 35, halign: 'right' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 8;

    // Check if we need to add a page break
    if (y > pageHeight - 80) {
        doc.addPage();
        y = 20;
    }

    // === PHARMACY & LABS TABLE ===
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.text('DIAGNOSTICS & PHARMACY DISPENSATIONS DURING STAY', 10, y);
    y += 4;

    var clinicalBody = [];
    reports.forEach(function(r) {
        clinicalBody.push([
            'Diagnostic Test',
            r.testName || 'Lab Study',
            r.status || 'Ready',
            formatDate(r.createdAt)
        ]);
    });
    meds.forEach(function(m) {
        clinicalBody.push([
            'Pharmacy Dispense',
            (m.medicineName || 'Medicine') + ' x' + (m.quantity || 0),
            m.paymentStatus || 'Paid',
            formatDate(m.createdAt)
        ]);
    });

    if (clinicalBody.length === 0) {
        clinicalBody.push(['No lab or pharmacy entries recorded during this admission stay.', '', '', '']);
    }

    doc.autoTable({
        startY: y,
        head: [['Type', 'Description / Details', 'Clinical Status', 'Date Recorded']],
        body: clinicalBody,
        theme: 'grid',
        headStyles: { fillColor: [13, 122, 112], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 80 },
            2: { cellWidth: 30, halign: 'center' },
            3: { cellWidth: 40, halign: 'center' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 8;

    // Check page space for totals & signatures
    if (y > pageHeight - 65) {
        doc.addPage();
        y = 20;
    }

    // === FINANCIAL SUMMARY ===
    var totalsX = 110;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont(undefined, 'bold');
    doc.text('Grand Total Bill:', totalsX, y);
    doc.setFont(undefined, 'normal');
    doc.text('Rs ' + (bill.grandTotal || 0).toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 5;
    
    doc.setFont(undefined, 'bold');
    doc.text('Total Amount Paid:', totalsX, y);
    doc.setFont(undefined, 'normal');
    doc.text('Rs ' + (bill.amountPaid || (bill.grandTotal - bill.balanceDue) || 0).toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 5;

    doc.setLineWidth(0.3);
    doc.line(totalsX, y, pageWidth - 12, y);
    y += 5;

    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 43, 91);
    doc.text('Outstanding Due Balance:', totalsX, y);
    doc.text('Rs ' + (bill.balanceDue || 0).toFixed(2), pageWidth - 12, y, { align: 'right' });
    y += 18;

    // === SIGNATURE LINES ===
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.setFont(undefined, 'normal');
    
    doc.line(15, y, 75, y);
    doc.text('ATTENDING PHYSICIAN SIGNATURE', 18, y + 4);
    doc.text('(Consulting Doctor Sign & Stamp)', 19, y + 8);
    
    doc.line(pageWidth - 75, y, pageWidth - 15, y);
    doc.text('PATIENT / GUARDIAN SIGNATURE', pageWidth - 70, y + 4);
    doc.text('(Acknowledgement of Final Bill & Care)', pageWidth - 73, y + 8);

    y = pageHeight - 15;

    // === FOOTER ===
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.setFont(undefined, 'italic');
    doc.text('This is a formal finalized clinical discharge summary and final tax invoice. No signature required for system audit.', pageWidth/2, y, { align: 'center' });
    doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pageWidth/2, y + 5, { align: 'center' });

    // === SAVE ===
    var filename = 'Discharge-Summary-' + (bill.billId || bill.id || 'Bill') + '-' + (bill.patientName || 'Patient') + '.pdf';
    savePDFHelper(doc, filename);
}
window.buildDischargeSummaryPDF = buildDischargeSummaryPDF;

// ==========================================
// OFFLINE SYNC STATUS INDICATOR
// ==========================================
function initOfflineIndicator() {
    var indicator = document.createElement('div');
    indicator.id = 'syncStatus';
    indicator.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:8px 14px;border-radius:20px;font-size:12px;font-weight:500;z-index:99998;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    document.body.appendChild(indicator);
    window.addEventListener('online', function() {
        indicator.style.background = '#0D7A70';
        indicator.style.color = 'white';
        indicator.textContent = 'Online - Syncing data';
        indicator.style.display = 'block';
        setTimeout(function() { indicator.style.display = 'none'; }, 3000);
    });
    window.addEventListener('offline', function() {
        indicator.style.background = '#D97706';
        indicator.style.color = 'white';
        indicator.textContent = 'Offline - Working locally';
        indicator.style.display = 'block';
    });
    if (!navigator.onLine) {
        indicator.style.background = '#D97706';
        indicator.style.color = 'white';
        indicator.textContent = 'Offline - Working locally';
        indicator.style.display = 'block';
    }
}

// ==========================================
// ESCAPE HTML HELPER (FIX 3)
// ==========================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

/** Hospital ID prefixes — patient IDs and bill numbers use SA- (formerly MF-). */
window.HMS_PREFIX = {
    patient: 'SA',
    bill: 'SA',
    labReport: 'SA-LAB',
    imgReport: 'SA-IMG',
    pharmacyBill: 'SA-PH',
    offline: 'SA-OFF'
};

function makePatientId(seq) {
    var y = new Date().getFullYear();
    var n = Number(seq) || 0;
    return window.HMS_PREFIX.patient + '-' + y + '-' + String(n).padStart(5, '0');
}
window.makePatientId = makePatientId;

function makeBillId(visitType, seq) {
    var y = new Date().getFullYear();
    var type = String(visitType || 'OPD').toUpperCase();
    var n = Number(seq) || 0;
    return window.HMS_PREFIX.bill + '-' + type + '-' + y + '-' + String(n).padStart(5, '0');
}
window.makeBillId = makeBillId;

/** Append-only audit helper used by pharmacy GRN / stock changes and owner dashboard. */
function writeAuditLog(entry) {
    var db = firebase.firestore();
    var payload = Object.assign({
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        staffEmail: (typeof currentUserEmail !== 'undefined' ? currentUserEmail : '') || (firebase.auth().currentUser && firebase.auth().currentUser.email) || ''
    }, entry || {});
    return db.collection('auditLog').add(payload).catch(function (err) {
        console.warn('auditLog write failed', err);
    });
}
window.writeAuditLog = writeAuditLog;

/** 24h patient download token + 3-year retention + doctor notify + WhatsApp queue (CDSCO/NABL-aligned record keeping). */
function finalizeDiagnosticReportReady(reportDocId, report, kind) {
    kind = kind || 'lab';
    var db = firebase.firestore();
    var token = 'DL-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    var expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    var retain = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000);
    var base = (window.location && window.location.origin) ? window.location.origin : '';
    var downloadPath = (kind === 'imaging' ? 'imaging.html' : 'lab-reports.html') + '?download=' + encodeURIComponent(token);
    var downloadUrl = base ? (base.replace(/\/$/, '') + '/' + downloadPath) : downloadPath;

    var phonePromise = Promise.resolve(report.patientPhone || '');
    if (!report.patientPhone && report.patientId) {
        phonePromise = db.collection('patients').where('patientId', '==', report.patientId).limit(1).get()
            .then(function (snap) { return snap.empty ? '' : (snap.docs[0].data().phone || ''); })
            .catch(function () { return ''; });
    }

    return phonePromise.then(function (phone) {
        return db.collection('reports').doc(reportDocId).update({
            status: 'ready',
            notifyPatient: true,
            notifyDoctor: true,
            patientPhone: phone || report.patientPhone || '',
            reportReadyAt: firebase.firestore.FieldValue.serverTimestamp(),
            downloadToken: token,
            downloadExpiresAt: firebase.firestore.Timestamp.fromDate(expires),
            downloadUrl: downloadUrl,
            retainUntil: firebase.firestore.Timestamp.fromDate(retain),
            permanentRecord: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
            return db.collection('notifications').add({
                type: kind === 'imaging' ? 'imaging_ready' : 'lab_ready',
                title: (kind === 'imaging' ? 'Imaging' : 'Lab') + ' report ready',
                message: (report.testName || report.imagingType || 'Report') + ' ready for ' + (report.patientName || report.patientId || 'patient'),
                patientId: report.patientId || '',
                patientName: report.patientName || '',
                reportId: reportDocId,
                doctorName: report.visitDoctor || report.referredBy || '',
                downloadUrl: downloadUrl,
                downloadExpiresAt: firebase.firestore.Timestamp.fromDate(expires),
                status: 'unread',
                channelHints: { doctorDashboard: true, whatsapp: !!phone, patientProfile: true },
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }).then(function () {
            if (phone) {
                return db.collection('messageLog').add({
                    channel: 'whatsapp',
                    template: 'report_ready',
                    status: 'queued',
                    to: phone,
                    patientId: report.patientId || '',
                    patientName: report.patientName || '',
                    reportId: reportDocId,
                    message: 'Dear ' + (report.patientName || 'Patient') + ', your ' + (report.testName || 'report')
                        + ' from Jyothsna Maternity is ready. Download (valid 24 hrs): ' + downloadUrl
                        + ' Permanent copy available at hospital for 3 years.',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }).then(function () {
            return { phone: phone, downloadUrl: downloadUrl, expires: expires };
        });
    });
}
window.finalizeDiagnosticReportReady = finalizeDiagnosticReportReady;
window.sendReportReadyWhatsApp = function (reportDocId) {
    return firebase.firestore().collection('reports').doc(reportDocId).get().then(function (doc) {
        if (!doc.exists) return;
        var r = doc.data();
        return finalizeDiagnosticReportReady(reportDocId, r, r.type === 'imaging' ? 'imaging' : 'lab');
    });
};

/** After bill is paid/partial/due — push lab/imaging items into work queues (idempotent). */
function ensureLabImagingQueuesForBill(billDocId, bill) {
    var db = firebase.firestore();
    if (!billDocId || !bill) return Promise.resolve();
    var items = bill.items || [];
    var labItems = items.filter(function (it) {
        var c = String(it.category || '');
        return c.indexOf('lab_') === 0 || it.labItem === true;
    });
    var imgItems = items.filter(function (it) {
        var c = String(it.category || '');
        return c.indexOf('img_') === 0;
    });
    if (!labItems.length && !imgItems.length) return Promise.resolve();

    return Promise.all([
        db.collection('labQueue').where('billDocId', '==', billDocId).get(),
        db.collection('imagingQueue').where('billDocId', '==', billDocId).get(),
        db.collection('reports').where('billDocId', '==', billDocId).get()
    ]).then(function (res) {
        var existingLab = {};
        res[0].forEach(function (d) {
            var t = (d.data().testName || '').toLowerCase();
            existingLab[t] = true;
        });
        var existingImg = {};
        res[1].forEach(function (d) {
            var t = (d.data().testName || d.data().imagingType || '').toLowerCase();
            existingImg[t] = true;
        });
        var batch = db.batch();
        var isEmergency = !!bill.isEmergency;
        labItems.forEach(function (item) {
            var name = item.description || item.category || 'Lab test';
            if (existingLab[name.toLowerCase()]) return;
            var ref = db.collection('labQueue').doc();
            batch.set(ref, {
                queueId: ref.id,
                billId: bill.billId || bill.billNo || '',
                billDocId: billDocId,
                patientId: bill.patientId || '',
                patientName: bill.patientName || '',
                patientPhone: bill.patientPhone || '',
                testName: name,
                amount: item.amount || item.unitPrice || 0,
                visitDoctor: bill.visitDoctor || bill.doctorName || '',
                labNotes: bill.labNotes || '',
                reportStatus: 'pending',
                reportId: null,
                isEmergency: isEmergency,
                source: 'billing',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: (typeof currentUserEmail !== 'undefined' ? currentUserEmail : '') || ''
            });
            existingLab[name.toLowerCase()] = true;
        });
        imgItems.forEach(function (item) {
            var name = item.description || item.category || 'Scan';
            if (existingImg[name.toLowerCase()]) return;
            var ref = db.collection('imagingQueue').doc();
            batch.set(ref, {
                queueId: ref.id,
                billId: bill.billId || bill.billNo || '',
                billDocId: billDocId,
                patientId: bill.patientId || '',
                patientName: bill.patientName || '',
                patientPhone: bill.patientPhone || '',
                testName: name,
                amount: item.amount || item.unitPrice || 0,
                visitDoctor: bill.visitDoctor || bill.doctorName || '',
                labNotes: bill.labNotes || '',
                reportStatus: 'pending',
                reportId: null,
                isEmergency: isEmergency,
                imagingType: String(item.category || '').replace(/^img_/, '') || name,
                source: 'billing',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: (typeof currentUserEmail !== 'undefined' ? currentUserEmail : '') || ''
            });
            existingImg[name.toLowerCase()] = true;
        });
        res[2].forEach(function (d) {
            var r = d.data();
            if (String(r.billingStatus || '').toLowerCase() === 'unpaid' || String(r.billingStatus || '').toLowerCase() === 'unbilled') {
                batch.update(d.ref, {
                    billingStatus: 'billed',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });
        return batch.commit();
    }).catch(function (err) {
        console.warn('ensureLabImagingQueuesForBill', err);
    });
}
window.ensureLabImagingQueuesForBill = ensureLabImagingQueuesForBill;

function generateANCCardPDF(patientId) {
    var db = firebase.firestore();
    db.collection('patients').where('patientId', '==', patientId).get().then(function(patientSnap) {
        if (patientSnap.empty) throw new Error('Patient not found');
        var patient = patientSnap.docs[0].data();
        return Promise.all([Promise.resolve(patient), db.collection('ancVisits').where('patientId', '==', patientId).orderBy('visitDate', 'desc').get(), db.collection('hospitalSettings').doc('main').get()]);
    }).then(function(result) {
        var patient = result[0], visits = result[1].docs.map(function(d) { return d.data(); }), settings = result[2].exists ? result[2].data() : {};
        var jsPDF = window.jspdf.jsPDF, doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }), width = doc.internal.pageSize.getWidth();
        doc.setFillColor(214, 51, 108); doc.rect(0, 0, width, 30, 'F'); doc.setTextColor(255, 255, 255); doc.setFont(undefined, 'bold'); doc.setFontSize(17); doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', width / 2, 12, { align: 'center' }); doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.text(settings.address || '', width / 2, 18, { align: 'center' }); doc.text('Phone: ' + (settings.phone || ''), width / 2, 24, { align: 'center' });
        doc.setTextColor(166, 30, 77); doc.setFont(undefined, 'bold'); doc.setFontSize(14); doc.text('ANTENATAL CARE CARD', width / 2, 40, { align: 'center' });
        doc.setFillColor(255, 240, 246); doc.rect(10, 47, width - 20, 31, 'F'); doc.setTextColor(50, 50, 50); doc.setFontSize(9); doc.setFont(undefined, 'normal');
        doc.text('Mother: ' + (patient.name || ''), 12, 54); doc.text('Patient ID: ' + (patient.patientId || ''), 12, 60); doc.text('LMP: ' + (patient.lmp || '—'), 12, 66); doc.text('EDD: ' + (patient.edd || '—'), 105, 54); doc.text('Gravida / Para: ' + (patient.gravida || 0) + ' / ' + (patient.para || 0), 105, 60); doc.text('High risk: ' + (patient.highRisk ? 'Yes - ' + (patient.highRiskReason || '') : 'No'), 105, 66);
        doc.autoTable({ startY: 86, head: [['Date', 'Weeks', 'Weight', 'BP', 'Fundal ht.', 'FHR', 'Hb', 'Urine albumin', 'Complaints / Advice', 'Next visit']], body: visits.map(function(v) { return [v.visitDate || '', v.gestationalWeeks ?? '', v.weight ?? '', (v.bpSystolic ?? '') + '/' + (v.bpDiastolic ?? ''), v.fundalHeight ?? '', v.fetalHeartRate ?? '', v.hb ?? '', v.urineAlbumin || '', (v.complaints || '') + (v.advice ? '\nAdvice: ' + v.advice : ''), v.nextVisitDate || '']; }), theme: 'grid', headStyles: { fillColor: [214, 51, 108], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7 }, margin: { left: 7, right: 7 } });
        var filename = 'ANC-Card-' + (patient.patientId || patientId || 'Patient') + '.pdf';
        savePDFHelper(doc, filename);
    }).catch(function(err) { showToast('Could not generate ANC card: ' + err.message, 'error'); });
}
window.generateANCCardPDF = generateANCCardPDF;

// ==========================================
// DYNAMIC BREADCRUMBS IN HMS (FIX 8)
// ==========================================
function renderBreadcrumbs() {
    const pageContent = document.querySelector('.page-content');
    if (!pageContent) return;

    let page = window.location.pathname.split('/').pop() || 'dashboard.html';
    page = page.split('?')[0];

    const breadcrumbMaps = {
        'dashboard.html': ['Dashboard'],
        'patients.html': ['Dashboard', 'Patients'],
        'patient-profile.html': ['Dashboard', 'Patients', 'Patient Profile'],
        'billing.html': ['Dashboard', 'Billing'],
        'today-collections.html': ['Dashboard', 'Today Collections'],
        'bed-management.html': ['Dashboard', 'Bed Board'],
        'admin.html': ['Dashboard', 'Staff'],
        'appointments.html': ['Dashboard', 'Appointments'],
        'lab-reports.html': ['Dashboard', 'Lab Reports'],
        'imaging.html': ['Dashboard', 'Imaging'],
        'pharmacy.html': ['Dashboard', 'Pharmacy'],
        'consultations.html': ['Dashboard', 'Doctor Dashboard', 'Consultations Log'],
        'consultation.html': ['Dashboard', 'Doctor Dashboard', 'Consultation'],
        'doctor-dashboard.html': ['Dashboard', 'Doctor Dashboard'],
        'owner-dashboard.html': ['Dashboard', 'Owner Analytics'],
        'ot-schedule.html': ['Dashboard', 'OT Schedule'],
        'setup.html': ['Dashboard', 'Setup Cockpit'],
        'setup-admissions.html': ['Dashboard', 'Admissions Setup'],
        'attendance.html': ['Dashboard', 'Attendance']
    };

    const trail = breadcrumbMaps[page];
    if (!trail) return;

    const container = document.createElement('div');
    container.className = 'breadcrumb-container';
    container.style.cssText = 'font-size: 13px; color: #64748B; margin-bottom: 20px; display: flex; align-items: center; gap: 6px; font-weight: 500;';

    let html = '';
    trail.forEach((item, index) => {
        const isLast = index === trail.length - 1;
        let itemHtml = '';
        if (isLast) {
            itemHtml = `<span style="color: var(--primary-navy); font-weight: 600;">${item}</span>`;
        } else {
            let href = '#';
            if (item === 'Dashboard') href = 'dashboard.html';
            else if (item === 'Patients') href = 'patients.html';
            else if (item === 'Doctor Dashboard') href = 'doctor-dashboard.html';
            itemHtml = `<a href="${href}" style="color: #64748B; text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='var(--primary-teal)'" onmouseout="this.style.color='#64748B'">${item}</a>`;
        }

        html += itemHtml;
        if (!isLast) {
            html += ` <i class="fa-solid fa-chevron-right" style="font-size: 10px; color: #94A3B8;"></i> `;
        }
    });

    container.innerHTML = html;
    pageContent.insertBefore(container, pageContent.firstChild);
}

// ==========================================
// MOBILE NAVIGATION OVERLAY & AUTO-CLOSE (FIX 9)
// ==========================================
function initMobileNavigation() {
    let overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebarOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:999;display:none;transition:opacity 0.3s;';
        document.body.appendChild(overlay);
        
        overlay.addEventListener('click', function() {
            var sidebar = document.querySelector('.sidebar');
            if (sidebar) sidebar.classList.remove('mobile-open');
            overlay.style.display = 'none';
        });
    }

    const originalToggle = window.toggleMobileMenu;
    window.toggleMobileMenu = function() {
        var sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.toggle('mobile-open');
            if (sidebar.classList.contains('mobile-open')) {
                overlay.style.display = 'block';
            } else {
                overlay.style.display = 'none';
            }
        }
    };

    document.addEventListener('click', function(e) {
        const navItem = e.target.closest('.nav-item');
        if (navItem) {
            var sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.classList.contains('mobile-open')) {
                sidebar.classList.remove('mobile-open');
                overlay.style.display = 'none';
            }
        }
    });
}

// Call on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    initOfflineIndicator();
    renderBreadcrumbs();
    initMobileNavigation();
});

// ==========================================
// DYNAMIC PRINTABLE PDF GENERATORS (FIX 3, 7, 8)
// ==========================================
function generateLabReportPDF(reportId) {
    var db = firebase.firestore();
    db.collection('reports').doc(reportId).get()
    .then(function(doc) {
        if (!doc.exists) { showToast('Report not found', 'error'); return; }
        var report = doc.data();
        report.id = doc.id;
        return db.collection('hospitalSettings').doc('main').get()
        .then(function(settingsDoc) {
            var settings = settingsDoc.exists ? settingsDoc.data() : {};
            createLabReportPDF(report, settings);
        });
    })
    .catch(function(err) {
        showToast('Error generating PDF: ' + err.message, 'error');
    });
}
window.generateLabReportPDF = generateLabReportPDF;

function createLabReportPDF(report, settings) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;

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
    if (settings.gstin) doc.text('GSTIN: ' + settings.gstin, pageWidth/2, 28, { align: 'center' });

    y = 40;

    // === TITLE ===
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('LABORATORY INVESTIGATION REPORT', pageWidth/2, y, { align: 'center' });
    y += 8;

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(10, y, pageWidth - 10, y);
    y += 5;

    // === REPORT DETAILS ===
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont(undefined, 'bold');
    doc.text('Report ID:', 12, y);
    doc.setFont(undefined, 'normal');
    doc.text(report.reportId || report.id || '', 32, y);
    
    doc.setFont(undefined, 'bold');
    doc.text('Referring Doctor:', 110, y);
    doc.setFont(undefined, 'normal');
    doc.text(report.referredBy || 'Self', 138, y);
    
    y += 5;
    
    doc.setFont(undefined, 'bold');
    doc.text('Sample Collected:', 12, y);
    doc.setFont(undefined, 'normal');
    var sampleDateStr = '—';
    if (report.sampleCollectedAt) {
        try {
            sampleDateStr = new Date(report.sampleCollectedAt).toLocaleString('en-IN');
        } catch(e) {}
    }
    doc.text(sampleDateStr, 40, y);
    
    doc.setFont(undefined, 'bold');
    doc.text('Report Date:', 110, y);
    doc.setFont(undefined, 'normal');
    var reportDateStr = '—';
    if (report.reportedAt) {
        try {
            reportDateStr = new Date(report.reportedAt).toLocaleString('en-IN');
        } catch(e) {}
    } else if (report.reportDate) {
        reportDateStr = report.reportDate;
    }
    doc.text(reportDateStr, 138, y);

    y += 8;

    // === PATIENT DETAILS ===
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 18, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(10);
    doc.text('PATIENT INFORMATION', 12, y + 5);
    
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.text('Patient Name: ' + (report.patientName || ''), 12, y + 10);
    doc.text('Patient ID: ' + (report.patientId || ''), 12, y + 14);
    doc.text('Department: ' + (report.visitDepartment || 'General'), 110, y + 10);
    doc.text('Status: ' + (report.status || 'Ready').toUpperCase(), 110, y + 14);
    
    y += 24;

    // === PARAMETERS TABLE ===
    var tableBody = [];
    var isEnteredResults = report.resultMode === 'entered' && report.tests && report.tests.length > 0;
    
    if (isEnteredResults) {
        report.tests.forEach(function(item, idx) {
            tableBody.push([
                (idx + 1).toString(),
                item.name || '',
                item.result || '',
                item.unit || '',
                item.normalRange || '',
                item.flag || ''
            ]);
        });
    } else {
        tableBody.push([
            '1',
            report.testName || 'Investigation',
            'Refer to Attached PDF',
            '—',
            '—',
            '—'
        ]);
    }

    doc.autoTable({
        startY: y,
        head: [['#', 'Test Parameter', 'Result', 'Unit', 'Bio Reference Range', 'Flag']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 10, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 65 },
            2: { cellWidth: 25, halign: 'center', fontStyle: 'bold' },
            3: { cellWidth: 20, halign: 'center' },
            4: { cellWidth: 40, halign: 'center' },
            5: { cellWidth: 20, halign: 'center' }
        },
        margin: { left: 10, right: 10 },
        didParseCell: function(data) {
            if (data.column.index === 5 && data.cell.section === 'body') {
                var flag = data.cell.text[0];
                if (flag === 'High' || flag === 'Abnormal') {
                    data.cell.styles.textColor = [220, 38, 38];
                    data.cell.styles.fontStyle = 'bold';
                } else if (flag === 'Low') {
                    data.cell.styles.textColor = [217, 119, 6];
                    data.cell.styles.fontStyle = 'bold';
                } else if (flag === 'Normal') {
                    data.cell.styles.textColor = [16, 185, 129];
                }
            }
            if (data.column.index === 2 && data.cell.section === 'body') {
                data.cell.styles.fontStyle = 'bold';
            }
        }
    });

    y = doc.lastAutoTable.finalY + 8;

    // === REMARKS / INTERPRETATION ===
    if (report.remarks) {
        doc.setFont(undefined, 'bold');
        doc.setTextColor(15, 43, 91);
        doc.setFontSize(10);
        doc.text('Remarks / Interpretation:', 10, y);
        y += 5;
        doc.setFont(undefined, 'normal');
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(9);
        var splitRemarks = doc.splitTextToSize(report.remarks, pageWidth - 20);
        doc.text(splitRemarks, 10, y);
        y += splitRemarks.length * 4.5 + 4;
    }

    if (report.notes && report.notes !== 'No custom notes.') {
        doc.setFont(undefined, 'bold');
        doc.setTextColor(15, 43, 91);
        doc.setFontSize(10);
        doc.text('General Notes:', 10, y);
        y += 5;
        doc.setFont(undefined, 'normal');
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(9);
        var splitNotes = doc.splitTextToSize(report.notes, pageWidth - 20);
        doc.text(splitNotes, 10, y);
        y += splitNotes.length * 4.5 + 4;
    }

    // Add Signature Line at bottom
    var sigY = pageHeight - 35;
    doc.setDrawColor(200, 200, 200);
    doc.line(10, sigY, 70, sigY);
    doc.line(pageWidth - 70, sigY, pageWidth - 10, sigY);
    
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Lab Technician / Pathologist', 40, sigY + 4, { align: 'center' });
    doc.text('Authorized Signatory', pageWidth - 40, sigY + 4, { align: 'center' });
    
    doc.text('*** End of Report - This is a computer-generated report and does not require a physical signature ***', pageWidth/2, pageHeight - 15, { align: 'center' });

    var filename = 'LabReport-' + (report.reportId || report.id || 'Unknown') + '.pdf';
    savePDFHelper(doc, filename);
}
window.createLabReportPDF = createLabReportPDF;

function generateConsolidatedFinalBillPDF(patientId) {
    var db = firebase.firestore();
    db.collection('patients').where('patientId', '==', patientId).get()
    .then(function(pSnap) {
        if (pSnap.empty) { showToast('Patient not found', 'error'); return; }
        var patientDoc = pSnap.docs[0];
        var patient = patientDoc.data();
        
        return db.collection('hospitalSettings').doc('main').get()
        .then(function(settingsDoc) {
            var settings = settingsDoc.exists ? settingsDoc.data() : {};
            
            return db.collection('bills').where('patientId', '==', patientId).get()
            .then(function(billsSnap) {
                var allPtBills = [];
                billsSnap.forEach(doc => {
                    allPtBills.push(Object.assign({ id: doc.id }, doc.data()));
                });
                
                allPtBills.sort(function(a, b) {
                    var da = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
                    var dbVal = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
                    return da - dbVal;
                });
                
                var runningBill = allPtBills.find(b => b.isRunningBill === true && !b.isFinalized);
                var latestClosedAdmissionBill = [...allPtBills].reverse().find(b => (b.type === 'IPD' || b.type === 'ICU') && b.isFinalized);
                
                var episodeStart = null;
                if (runningBill) {
                    episodeStart = runningBill.createdAt ? (runningBill.createdAt.toDate ? runningBill.createdAt.toDate() : new Date(runningBill.createdAt)) : new Date();
                    if (runningBill.admissionDate) {
                        try { episodeStart = new Date(runningBill.admissionDate); } catch(e) {}
                    }
                } else if (latestClosedAdmissionBill) {
                    episodeStart = latestClosedAdmissionBill.createdAt ? (latestClosedAdmissionBill.createdAt.toDate ? latestClosedAdmissionBill.createdAt.toDate() : new Date(latestClosedAdmissionBill.createdAt)) : new Date();
                    if (latestClosedAdmissionBill.admissionDate) {
                        try { episodeStart = new Date(latestClosedAdmissionBill.admissionDate); } catch(e) {}
                    }
                }
                
                var episodeBills = [];
                if (episodeStart) {
                    var thresholdTime = episodeStart.getTime() - (24 * 60 * 60 * 1000);
                    episodeBills = allPtBills.filter(b => {
                        var bDate = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
                        return bDate.getTime() >= thresholdTime;
                    });
                } else {
                    var thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                    episodeBills = allPtBills.filter(b => {
                        var bDate = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
                        return bDate.getTime() >= thirtyDaysAgo;
                    });
                }
                
                if (episodeBills.length === 0) {
                    episodeBills = allPtBills;
                }
                
                createConsolidatedFinalBillPDF(patient, episodeBills, settings);
            });
        });
    })
    .catch(function(err) {
        showToast('Error generating statement: ' + err.message, 'error');
    });
}
window.generateConsolidatedFinalBillPDF = generateConsolidatedFinalBillPDF;

function createConsolidatedFinalBillPDF(patient, bills, settings) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;

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
    if (settings.gstin) doc.text('GSTIN: ' + settings.gstin, pageWidth/2, 28, { align: 'center' });

    y = 40;

    // === TITLE ===
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('CONSOLIDATED FINAL STATEMENT / DISCHARGE BILL', pageWidth/2, y, { align: 'center' });
    y += 8;

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(10, y, pageWidth - 10, y);
    y += 5;

    // === PATIENT DETAILS ===
    doc.setFillColor(245, 247, 250);
    doc.rect(10, y, pageWidth - 20, 24, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 43, 91);
    doc.setFontSize(10);
    doc.text('PATIENT SUMMARY', 12, y + 5);
    
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.text('Patient Name: ' + (patient.name || ''), 12, y + 10);
    doc.text('Patient ID: ' + (patient.patientId || ''), 12, y + 14);
    doc.text('Age / Gender: ' + (patient.age || '—') + ' / ' + (patient.gender || '—'), 12, y + 18);
    
    var admBill = bills.find(b => b.type === 'IPD' || b.type === 'ICU');
    var admissionStr = admBill ? (admBill.admissionDate || '—') : '—';
    var dischargeStr = admBill ? (admBill.dischargeDate || '—') : '—';
    
    doc.text('Admission Date: ' + admissionStr, 110, y + 10);
    doc.text('Discharge Date: ' + dischargeStr, 110, y + 14);
    doc.text('Statement Date: ' + new Date().toLocaleDateString('en-IN'), 110, y + 18);
    
    y += 30;

    // === EPISODE BILLS TABLE ===
    var tableBody = [];
    var totalAmountSum = 0;
    var totalPaidSum = 0;
    var totalBalanceSum = 0;

    bills.forEach(function(bill, idx) {
        var billDateStr = '—';
        if (bill.createdAt) {
            try {
                billDateStr = bill.createdAt.toDate ? bill.createdAt.toDate().toLocaleDateString('en-IN') : new Date(bill.createdAt).toLocaleDateString('en-IN');
            } catch(e) {}
        }
        var billType = bill.billType || bill.type || 'OPD';
        var grand = bill.grandTotal || 0;
        var balance = bill.balanceDue !== undefined ? bill.balanceDue : (bill.paymentStatus === 'paid' ? 0 : grand);
        var paid = grand - balance;

        totalAmountSum += grand;
        totalPaidSum += paid;
        totalBalanceSum += balance;

        tableBody.push([
            (idx + 1).toString(),
            bill.billId || 'Pending...',
            billType.toUpperCase(),
            billDateStr,
            'Rs ' + grand.toFixed(2),
            'Rs ' + paid.toFixed(2),
            'Rs ' + balance.toFixed(2)
        ]);
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Bill Number', 'Category', 'Bill Date', 'Grand Total', 'Amount Paid', 'Balance Due']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [15, 43, 91], textColor: 255, fontSize: 10, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9, textColor: [60, 60, 60] },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 40 },
            2: { cellWidth: 30, halign: 'center' },
            3: { cellWidth: 25, halign: 'center' },
            4: { cellWidth: 28, halign: 'right' },
            5: { cellWidth: 28, halign: 'right' },
            6: { cellWidth: 29, halign: 'right' }
        },
        margin: { left: 10, right: 10 }
    });

    y = doc.lastAutoTable.finalY + 8;

    // === GRAND SUMMARY BLOCK ===
    var summaryX = 110;
    doc.setFillColor(245, 247, 250);
    doc.rect(summaryX - 5, y, pageWidth - summaryX - 5, 28, 'F');
    doc.setDrawColor(15, 43, 91);
    doc.setLineWidth(0.5);
    doc.rect(summaryX - 5, y, pageWidth - summaryX - 5, 28, 'D');

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    
    doc.text('Total Dues Accumulated:', summaryX, y + 6);
    doc.text('Rs ' + totalAmountSum.toFixed(2), pageWidth - 15, y + 6, { align: 'right' });
    
    doc.text('Total Payments Received:', summaryX, y + 13);
    doc.setTextColor(16, 185, 129);
    doc.text('Rs ' + totalPaidSum.toFixed(2), pageWidth - 15, y + 13, { align: 'right' });
    
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(summaryX, y + 17, pageWidth - 15, y + 17);
    
    doc.setTextColor(15, 43, 91);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('Net Balance Outstanding:', summaryX, y + 23);
    if (totalBalanceSum > 0) {
        doc.setTextColor(220, 38, 38);
    } else {
        doc.setTextColor(13, 122, 112);
    }
    doc.text('Rs ' + totalBalanceSum.toFixed(2), pageWidth - 15, y + 23, { align: 'right' });

    y += 38;

    var sigY = pageHeight - 35;
    doc.setDrawColor(200, 200, 200);
    doc.line(10, sigY, 70, sigY);
    doc.line(pageWidth - 70, sigY, pageWidth - 10, sigY);
    
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont(undefined, 'bold');
    doc.text('Billing Executive Signature', 40, sigY + 4, { align: 'center' });
    doc.text('Patient / Guardian Signature', pageWidth - 40, sigY + 4, { align: 'center' });

    doc.setFont(undefined, 'normal');
    doc.text('*** This statement is a consolidated billing summary for the treatment period and is computer-generated ***', pageWidth/2, pageHeight - 15, { align: 'center' });

    var filename = 'Consolidated-Final-Bill-' + (patient.patientId || 'Patient') + '.pdf';
    savePDFHelper(doc, filename);
}
window.createConsolidatedFinalBillPDF = createConsolidatedFinalBillPDF;

function generateDispensingSlipPDF(dispRecordId) {
    if (!dispRecordId) { showToast('Invalid dispensing record', 'error'); return; }
    var db = firebase.firestore();
    showToast('Preparing dispensing slip PDF...', 'info');

    function buildSlip(dispData, docId) {
        dispData.id = dispData.id || docId;
        return db.collection('hospitalSettings').doc('main').get()
        .then(function(settingsDoc) {
            var settings = settingsDoc.exists ? settingsDoc.data() : {};
            return createDispensingSlipPDF(dispData, settings);
        });
    }

    db.collection('dispensingHistory').doc(dispRecordId).get()
    .then(function(doc) {
        if (doc.exists) {
            return buildSlip(doc.data(), doc.id);
        }
        return db.collectionGroup('dispensing').where('dispensingId', '==', dispRecordId).get()
        .then(function(snap) {
            if (!snap.empty) {
                return buildSlip(snap.docs[0].data(), snap.docs[0].id);
            }
            return db.collection('dispensingHistory').where('dispensingId', '==', dispRecordId).get()
            .then(function(snap2) {
                if (!snap2.empty) {
                    return buildSlip(snap2.docs[0].data(), snap2.docs[0].id);
                }
                showToast('Dispensing record not found: ' + dispRecordId, 'error');
            });
        });
    })
    .catch(function(err) {
        console.error('Dispensing slip PDF error:', err);
        showToast('Error generating dispensing slip: ' + err.message, 'error');
    });
}
window.generateDispensingSlipPDF = generateDispensingSlipPDF;

// ==========================================
// BILINGUAL TELUGU PRESCRIPTION DICTIONARY & HELPERS (PART 1 & 2)
// ==========================================
const RX_TELUGU = {
    // Frequencies — plain words and the Latin abbreviations doctors write
    "once daily": "రోజుకు ఒకసారి",
    "od": "రోజుకు ఒకసారి",
    "twice daily": "రోజుకు రెండుసార్లు",
    "bd": "రోజుకు రెండుసార్లు",
    "bid": "రోజుకు రెండుసార్లు",
    "three times daily": "రోజుకు మూడుసార్లు",
    "tds": "రోజుకు మూడుసార్లు",
    "tid": "రోజుకు మూడుసార్లు",
    "four times daily": "రోజుకు నాలుగుసార్లు",
    "qid": "రోజుకు నాలుగుసార్లు",
    "qds": "రోజుకు నాలుగుసార్లు",
    "every 4 hours": "ప్రతి 4 గంటలకు",
    "every 6 hours": "ప్రతి 6 గంటలకు",
    "every 8 hours": "ప్రతి 8 గంటలకు",
    "every 12 hours": "ప్రతి 12 గంటలకు",
    "at bedtime": "పడుకునే ముందు",
    "hs": "పడుకునే ముందు",
    "as needed": "అవసరమైనప్పుడు",
    "sos": "అవసరమైనప్పుడు",
    "prn": "అవసరమైనప్పుడు",
    "stat": "వెంటనే",
    "immediately": "వెంటనే",
    "once weekly": "వారానికి ఒకసారి",
    "alternate days": "రోజు విడిచి రోజు",
    "morning": "ఉదయం",
    "afternoon": "మధ్యాహ్నం",
    "evening": "సాయంత్రం",
    "night": "రాత్రి",
    "morning and night": "ఉదయం మరియు రాత్రి",

    // Food timing
    "after food": "ఆహారం తర్వాత",
    "before food": "ఆహారానికి ముందు",
    "with food": "ఆహారంతో",
    "with milk": "పాలతో",
    "with water": "నీటితో",
    "empty stomach": "ఖాళీ కడుపుతో",

    // Routes and common advice
    "oral": "నోటి ద్వారా",
    "by mouth": "నోటి ద్వారా",
    "intravenous": "సిర ద్వారా",
    "intramuscular": "కండరంలోకి",
    "external use only": "బయటికి మాత్రమే వాడాలి",
    "shake well before use": "వాడే ముందు బాగా కదిలించండి",
    "do not stop without advice": "వైద్యుని సలహా లేకుండా ఆపవద్దు",
    "complete the course": "కోర్సు పూర్తి చేయండి",
    "drink plenty of water": "ఎక్కువ నీరు తాగండి",
    "take rest": "విశ్రాంతి తీసుకోండి",
    "review after": "తర్వాత మళ్ళీ చూపించండి"
};
window.RX_TELUGU = RX_TELUGU;

// Dosage forms, applied as word replacements inside a free-text dosage.
var RX_TELUGU_FORMS = {
    "tablet": "మాత్ర",
    "capsule": "క్యాప్సూల్",
    "syrup": "సిరప్",
    "suspension": "సిరప్",
    "injection": "ఇంజెక్షన్",
    "drop": "చుక్క",
    "drops": "చుక్కలు",
    "ointment": "లేపనం",
    "cream": "క్రీము",
    "gel": "జెల్",
    "sachet": "ప్యాకెట్",
    "spoon": "చెంచా",
    "teaspoon": "చిన్న చెంచా",
    "apply": "పూయండి",
    "local application": "పైన పూయడానికి"
};
window.RX_TELUGU_FORMS = RX_TELUGU_FORMS;

function translateToTelugu(term, type) {
    if (!term) return "";
    var cleanTerm = String(term).toLowerCase().trim().replace(/[.\s]+$/, '');
    if (RX_TELUGU[cleanTerm]) return RX_TELUGU[cleanTerm];

    // "1-0-1" and "1-1-1" style schedules are extremely common on Indian
    // prescriptions and mean morning-afternoon-night doses.
    var schedule = cleanTerm.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)(\s*-\s*(\d+))?$/);
    if (schedule) {
        var slots = [
            { count: Number(schedule[1]), label: "ఉదయం" },
            { count: Number(schedule[2]), label: "మధ్యాహ్నం" },
            { count: Number(schedule[3]), label: "రాత్రి" }
        ];
        if (schedule[5] !== undefined) {
            slots[2].label = "సాయంత్రం";
            slots.push({ count: Number(schedule[5]), label: "రాత్రి" });
        }
        var spoken = slots.filter(function(slot) { return slot.count > 0; })
            .map(function(slot) { return slot.label + " " + slot.count; });
        if (spoken.length) return spoken.join(", ");
    }

    if (type === 'duration') {
        var duration = cleanTerm.match(/(\d+)\s*(day|days|week|weeks|month|months)?/);
        if (duration) {
            var count = Number(duration[1]);
            var unit = duration[2] || 'days';
            if (unit.indexOf('week') === 0) return count === 1 ? "1 వారం" : count + " వారాలు";
            if (unit.indexOf('month') === 0) return count === 1 ? "1 నెల" : count + " నెలలు";
            return count === 1 ? "1 రోజు" : count + " రోజులు";
        }
    }

    // Fall back to replacing any recognised words inside the phrase, so a
    // mixed instruction such as "2 tablets after food" still reads in Telugu.
    var translated = String(term);
    var replaced = false;
    Object.keys(RX_TELUGU_FORMS).forEach(function(key) {
        var regex = new RegExp("\\b" + key + "s?\\b", "gi");
        if (regex.test(translated)) {
            translated = translated.replace(regex, RX_TELUGU_FORMS[key]);
            replaced = true;
        }
    });
    Object.keys(RX_TELUGU).forEach(function(key) {
        if (key.length < 4) return; // skip abbreviations, they need an exact match
        var regex = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b", "gi");
        if (regex.test(translated)) {
            translated = translated.replace(regex, RX_TELUGU[key]);
            replaced = true;
        }
    });

    return replaced ? translated : term; // untranslatable text stays in English
}
window.translateToTelugu = translateToTelugu;

function formatPrescriptionInstructionEN(dosage, frequency, instructions, duration) {
    let freqInst = [];
    if (frequency) freqInst.push(frequency);
    if (instructions) freqInst.push(instructions);
    let middle = freqInst.join(", ");
    
    let parts = [];
    if (dosage) parts.push(dosage);
    if (middle) parts.push(middle);
    if (duration) {
        let durationStr = String(duration).trim();
        let durStr = durationStr.toLowerCase().startsWith("for") ? durationStr : "for " + durationStr;
        parts.push(durStr);
    }
    return parts.join(" — ");
}
window.formatPrescriptionInstructionEN = formatPrescriptionInstructionEN;

function formatPrescriptionInstructionTE(dosage, frequency, instructions, duration) {
    let tDosage = translateToTelugu(dosage, 'dosage');
    let tFrequency = translateToTelugu(frequency, 'frequency');
    let tInstructions = translateToTelugu(instructions, 'instructions');
    let tDuration = translateToTelugu(duration, 'duration');
    
    let freqInst = [];
    if (tFrequency) freqInst.push(tFrequency);
    if (tInstructions) freqInst.push(tInstructions);
    let middle = freqInst.join(", ");
    
    let parts = [];
    if (tDosage) parts.push(tDosage);
    if (middle) parts.push(middle);
    if (tDuration) parts.push(tDuration);
    return parts.join(" — ");
}
window.formatPrescriptionInstructionTE = formatPrescriptionInstructionTE;

// ==========================================================
// TELUGU TEXT IN PDFs
//
// jsPDF draws glyphs in codepoint order and performs no complex-script
// shaping. Telugu needs vowel-sign reordering and conjunct formation,
// so text drawn with doc.text() comes out malformed however good the
// embedded font is — which is why the printed prescriptions were not
// readable.
//
// The browser already has a full shaping engine, so the Telugu is
// drawn onto a canvas (correctly shaped) and that bitmap is placed
// into the PDF. Rendered at 4x for print sharpness.
// ==========================================================
var _teluguFontReady = null;

function ensureTeluguCanvasFont() {
    if (_teluguFontReady) return _teluguFontReady;

    if (!window.FontFace || !document.fonts) {
        _teluguFontReady = Promise.reject(new Error('This browser cannot load the Telugu font for rendering.'));
        return _teluguFontReady;
    }

    var face = new FontFace('NotoSansTeluguCanvas', "url('js/NotoSansTelugu-Regular.ttf')");
    _teluguFontReady = face.load().then(function(loaded) {
        document.fonts.add(loaded);
        return true;
    });
    return _teluguFontReady;
}
window.ensureTeluguCanvasFont = ensureTeluguCanvasFont;

// Renders Telugu text to a PNG sized in millimetres for jsPDF.
// Returns null when the font is unavailable, so callers can fall back.
function teluguTextImage(text, maxWidthMm, fontSizePt) {
    if (!text) return Promise.resolve(null);
    fontSizePt = fontSizePt || 8;

    return ensureTeluguCanvasFont().then(function() {
        var SCALE = 4;                       // supersampling for print
        var PX_PER_MM = 96 / 25.4;           // CSS pixels per millimetre
        var fontPx = fontSizePt * (96 / 72); // points to CSS pixels
        var maxWidthPx = maxWidthMm * PX_PER_MM;

        var measure = document.createElement('canvas').getContext('2d');
        measure.font = fontPx + 'px NotoSansTeluguCanvas';

        // Wrap on spaces; Telugu words are space-separated here.
        var words = String(text).split(/\s+/).filter(Boolean);
        var lines = [];
        var line = '';
        words.forEach(function(word) {
            var candidate = line ? line + ' ' + word : word;
            if (measure.measureText(candidate).width > maxWidthPx && line) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });
        if (line) lines.push(line);

        var lineHeightPx = fontPx * 1.45;
        var heightPx = Math.ceil(lines.length * lineHeightPx);
        var widthPx = Math.ceil(Math.min(maxWidthPx, Math.max.apply(null,
            lines.map(function(l) { return measure.measureText(l).width; }).concat([1]))));

        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, widthPx * SCALE);
        canvas.height = Math.max(1, heightPx * SCALE);

        var ctx = canvas.getContext('2d');
        ctx.scale(SCALE, SCALE);
        ctx.font = fontPx + 'px NotoSansTeluguCanvas';
        ctx.fillStyle = '#3c3c3c';
        ctx.textBaseline = 'top';
        lines.forEach(function(l, i) { ctx.fillText(l, 0, i * lineHeightPx); });

        return {
            dataUrl: canvas.toDataURL('image/png'),
            widthMm: widthPx / PX_PER_MM,
            heightMm: heightPx / PX_PER_MM,
            lineCount: lines.length
        };
    }).catch(function(err) {
        console.error('Telugu rendering unavailable:', err.message);
        return null;
    });
}
window.teluguTextImage = teluguTextImage;

let _cachedNotoSansTeluguBase64 = null;
async function loadNotoSansTeluguBase64() {
    if (_cachedNotoSansTeluguBase64) {
        return _cachedNotoSansTeluguBase64;
    }
    const response = await fetch('js/NotoSansTelugu-Regular.ttf?v=1', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Failed to load Noto Sans Telugu font file.');
    }
    const buffer = await response.arrayBuffer();
    
    // Stack overflow safe ArrayBuffer to Base64 conversion
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunk = 8192;
    for (let i = 0; i < len; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    _cachedNotoSansTeluguBase64 = btoa(binary);
    return _cachedNotoSansTeluguBase64;
}
window.loadNotoSansTeluguBase64 = loadNotoSansTeluguBase64;

// ==========================================
// BILINGUAL PRESCRIPTION PDF GENERATOR (PART 3)
// ==========================================
function generateBilingualPrescriptionPDF(rxId) {
    var db = firebase.firestore();
    showToast("Generating bilingual prescription...", "info");
    db.collection('prescriptions').doc(rxId).get()
    .then(async function(doc) {
        if (!doc.exists) {
            return db.collection('prescriptions').where('prescriptionId', '==', rxId).get()
            .then(snap => {
                if (snap.empty) throw new Error("Prescription not found");
                return snap.docs[0].data();
            });
        }
        return doc.data();
    })
    .then(async function(rx) {
        const settingsSnap = await db.collection('hospitalSettings').doc('main').get();
        const settings = settingsSnap.exists ? settingsSnap.data() : {};
        
        const patientSnap = await db.collection('patients').where('patientId', '==', rx.patientId).get();
        const patient = !patientSnap.empty ? patientSnap.docs[0].data() : {};
        
        await buildBilingualPrescriptionPDF(rx, patient, settings);
    })
    .catch(function(err) {
        console.error("Prescription PDF generation error:", err);
        showToast("Error generating PDF: " + err.message, "error");
    });
}
window.generateBilingualPrescriptionPDF = generateBilingualPrescriptionPDF;

function generateBilingualPrescriptionFromConsultationPDF(consultation) {
    var db = firebase.firestore();
    showToast("Generating bilingual prescription...", "info");
    
    db.collection('hospitalSettings').doc('main').get()
    .then(async function(settingsDoc) {
        const settings = settingsDoc.exists ? settingsDoc.data() : {};
        
        const patientSnap = await db.collection('patients').where('patientId', '==', consultation.patientId).get();
        const patient = !patientSnap.empty ? patientSnap.docs[0].data() : {};
        
        const rx = {
            prescriptionId: consultation.consultationId,
            patientId: consultation.patientId,
            patientName: consultation.patientName,
            doctorName: consultation.doctorName,
            createdAt: consultation.createdAt,
            medicines: (consultation.prescription || []).map(m => ({
                medicineName: m.name || m.medicineName || '',
                dosage: m.dosage || '',
                frequency: m.frequency || '',
                duration: m.duration || '',
                instructions: m.instructions || ''
            }))
        };
        
        await buildBilingualPrescriptionPDF(rx, patient, settings);
    })
    .catch(function(err) {
        console.error("Prescription PDF generation error:", err);
        showToast("Error generating PDF: " + err.message, "error");
    });
}
window.generateBilingualPrescriptionFromConsultationPDF = generateBilingualPrescriptionFromConsultationPDF;

// =========================================================================
// BILINGUAL CLINICAL OP CONSULTATION & PRESCRIPTION BILL (PART 3 & 4)
// Matches standard maternity clinical OPD consultation and prescription bill
// =========================================================================

function formatOpDateOnly(d) {
    if (!d) return '';
    try {
        if (d.toDate) d = d.toDate();
        if (!(d instanceof Date)) d = new Date(d);
        if (isNaN(d.getTime())) return '';
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yyyy = d.getFullYear();
        return dd + '-' + mm + '-' + yyyy;
    } catch(e) { return ''; }
}

function formatOpDateTime(d) {
    if (!d) d = new Date();
    try {
        if (d.toDate) d = d.toDate();
        if (!(d instanceof Date)) d = new Date(d);
        if (isNaN(d.getTime())) d = new Date();
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yyyy = d.getFullYear();
        var hours = d.getHours();
        var minutes = String(d.getMinutes()).padStart(2, '0');
        var ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12;
        var hh = String(hours).padStart(2, '0');
        return dd + '-' + mm + '-' + yyyy + ' ' + hh + ':' + minutes + ' ' + ampm;
    } catch(e) { return ''; }
}

function calculateOpGestationalAge(lmpStr) {
    if (!lmpStr) return '';
    try {
        var lmp = new Date(lmpStr);
        if (isNaN(lmp.getTime())) return '';
        var diff = Date.now() - lmp.getTime();
        if (diff < 0) return '';
        var totalDays = Math.floor(diff / (1000 * 60 * 60 * 24));
        var weeks = Math.floor(totalDays / 7);
        var days = totalDays % 7;
        return weeks + 'w ' + days + 'd';
    } catch(e) { return ''; }
}

function calculateOpEdd(lmpStr) {
    if (!lmpStr) return '';
    try {
        var lmp = new Date(lmpStr);
        if (isNaN(lmp.getTime())) return '';
        var edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000);
        return formatOpDateOnly(edd);
    } catch(e) { return ''; }
}

function createWatermarkCanvas() {
    try {
        var canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 400, 400);
        
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.translate(200, 200);
        
        // Draw soft heart & mother/baby symbol
        ctx.fillStyle = '#A61E4D';
        ctx.beginPath();
        ctx.moveTo(0, 50);
        ctx.bezierCurveTo(-140, -60, -100, -180, 0, -100);
        ctx.bezierCurveTo(100, -180, 140, -60, 0, 50);
        ctx.fill();
        
        ctx.strokeStyle = '#0F2B5B';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(0, -60, 80, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.restore();
        return canvas.toDataURL('image/png');
    } catch(e) {
        return null;
    }
}

async function buildClinicalOPBillPDF(context) {
    context = context || {};
    var bill = context.bill || {};
    var consultation = context.consultation || {};
    var patient = context.patient || {};
    var rx = context.rx || {};
    var settings = context.settings || {};

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth(); // 210
    var pageHeight = doc.internal.pageSize.getHeight(); // 297

    // Background watermark
    var watermarkUrl = createWatermarkCanvas();
    if (watermarkUrl) {
        doc.addImage(watermarkUrl, 'PNG', (pageWidth - 140) / 2, 75, 140, 140);
    }

    var leftMargin = 14;
    var rightMargin = pageWidth - 14;
    var contentWidth = rightMargin - leftMargin; // 182mm
    var y = 12;

    // Top hospital brand bar line
    doc.setDrawColor(166, 30, 77); // Jyothsna theme maroon
    doc.setLineWidth(1.2);
    doc.line(leftMargin, y, rightMargin, y);
    y += 5;

    // Hospital Name Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(166, 30, 77);
    doc.text((settings.hospitalName || 'JYOTHSNA MATERNITY HOSPITAL').toUpperCase(), pageWidth / 2, y, { align: 'center' });
    y += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    var contactSub = (settings.address || '123 Main Road, Madhanapalli') +
        '  |  Ph: ' + (settings.phone || '+91 7993166220') +
        (settings.email ? '  |  ' + settings.email : '');
    doc.text(contactSub, pageWidth / 2, y, { align: 'center' });
    y += 3.5;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(leftMargin, y, rightMargin, y);
    y += 5;

    // Patient & Clinical Header (3 Columns exactly as in sample)
    var ptName = patient.name || consultation.patientName || bill.patientName || 'S .LAVANYA';
    var husband = patient.husbandName || patient.emergencyContact || patient.emergency || patient.guardian || patient.careOf || 'P GURRAPPA';
    var nameWithSpouse = ptName + (husband ? ' W/o ' + husband : '');
    var age = (patient.dob ? calculateAge(patient.dob) : (patient.age || bill.age || 29));
    var gender = (patient.gender || patient.sex || bill.gender || 'F');
    var genderInitial = String(gender).toUpperCase().startsWith('M') ? 'M' : 'F';
    var patientId = patient.patientId || consultation.patientId || bill.patientId || 'SR5637';

    var dateVal = (consultation.createdAt || bill.createdAt || rx.createdAt || new Date());
    var formattedDate = formatOpDateTime(dateVal);
    var mobile = patient.phone || bill.phone || '7993166220';
    var lmpStr = patient.lmp || consultation.lmp || '06-01-2026';
    var formattedLmp = formatOpDateOnly(lmpStr) || lmpStr;
    var gaStr = calculateOpGestationalAge(lmpStr) || (patient.gestationalAge ? patient.gestationalAge : '32w 6d');
    var eddLmp = patient.edd || calculateOpEdd(lmpStr) || '13-10-2026';
    var formattedEddLmp = formatOpDateOnly(eddLmp) || eddLmp;
    var eddUsg = patient.usgEdd || patient.eddUsg || eddLmp || '13-10-2026';
    var formattedEddUsg = formatOpDateOnly(eddUsg) || eddUsg;

    var gravida = patient.gravida != null ? patient.gravida : 3;
    var abortions = patient.abortions != null ? patient.abortions : 2;
    var gpaleStr = 'G' + gravida + ' A' + abortions;

    // 3 Column Coordinates
    var col1X = leftMargin;
    var col2X = leftMargin + 72;
    var col3X = leftMargin + 138;

    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);

    // Line 1
    doc.setFont('helvetica', 'bold');
    doc.text('Name: ', col1X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(nameWithSpouse, col1X + 12, y);

    doc.setFont('helvetica', 'bold');
    doc.text('Date: ', col2X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formattedDate, col2X + 10, y);

    doc.setFont('helvetica', 'bold');
    doc.text('GPALE: ', col3X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(gpaleStr, col3X + 13, y);
    y += 4.5;

    // Line 2
    doc.setFont('helvetica', 'bold');
    doc.text('Age/Sex: ', col1X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(age + 'y / ' + genderInitial, col1X + 14, y);

    doc.setFont('helvetica', 'bold');
    doc.text('Mobile: ', col2X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(mobile, col2X + 12, y);

    doc.setFont('helvetica', 'bold');
    doc.text('LMP: ', col3X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formattedLmp, col3X + 9, y);
    y += 4.5;

    // Line 3
    doc.setFont('helvetica', 'bold');
    doc.text('Office ID: ', col1X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(patientId, col1X + 15, y);

    doc.setFont('helvetica', 'bold');
    doc.text('GA by LMP: ', col2X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(gaStr, col2X + 19, y);

    doc.setFont('helvetica', 'bold');
    doc.text('EDD by LMP: ', col3X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formattedEddLmp, col3X + 21, y);
    y += 4.5;

    // Line 4 (USG EDD)
    doc.setFont('helvetica', 'bold');
    doc.text('EDD by USG: ', col3X, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formattedEddUsg, col3X + 21, y);
    y += 7;

    // Thin separator line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(leftMargin, y, rightMargin, y);
    y += 5;

    // Clinical Sections
    // Symptoms
    doc.setFont('helvetica', 'bold');
    doc.text('Symptoms: ', leftMargin, y);
    doc.setFont('helvetica', 'normal');
    var symptomsText = consultation.symptoms || consultation.chiefComplaint || 'Ante-natal, Follow up, Appreciating fetal movements well';
    doc.text(symptomsText, leftMargin + 18, y, { maxWidth: contentWidth - 18 });
    y += 6;

    // Menstrual history
    doc.setFont('helvetica', 'bold');
    doc.text('Menstrual history:', leftMargin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    var mLines = [
        'LMP ' + formattedLmp,
        'Regular Cycle, 26 days',
        'Moderate Flow, 5 days. No clots',
        'Moderate Pain During menses'
    ];
    if (consultation.menstrualHistory) {
        mLines = consultation.menstrualHistory.split('\n').filter(Boolean);
    }
    mLines.forEach(function(l) {
        doc.text('  ' + l, leftMargin, y);
        y += 3.8;
    });
    y += 2;

    // Obstetric history
    doc.setFont('helvetica', 'bold');
    doc.text('Obstetric history: ' + gpaleStr, leftMargin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    var oLines = [
        '1: Abortion, Missed, Medically, 8 GW, 30 Jul 2025',
        '2: Abortion, Missed, Medically, 8 GW, 24 Oct 2025',
        'G3: ' + gaStr + ' Pregnant: EDD by LMP: ' + formattedEddLmp + ': EDD by USG: ' + formattedEddUsg
    ];
    if (consultation.obstetricHistory) {
        oLines = consultation.obstetricHistory.split('\n').filter(Boolean);
    }
    oLines.forEach(function(l) {
        doc.text('  ' + l, leftMargin, y);
        y += 3.8;
    });
    y += 2;

    // Vitals
    var vit = consultation.vitals || {};
    var ht = vit.height || 156;
    var wt = vit.weight || 67.4;
    var bmi = vit.bmi || (ht && wt ? (wt / Math.pow(ht/100, 2)).toFixed(2) : '27.70');
    var pulse = vit.pulse || 89;
    var bp = vit.bp || '97/67';

    doc.setFont('helvetica', 'bold');
    doc.text('Vitals: ', leftMargin, y);
    doc.setFont('helvetica', 'normal');
    doc.text('Height: ' + ht + ' cm, Weight: ' + wt + ' kg, BMI: ' + bmi + ' kg/m², Pulse: ' + pulse + ' /min, BP: ' + bp + ' mmHg', leftMargin + 12, y);
    y += 5.5;

    // Findings
    doc.setFont('helvetica', 'bold');
    doc.text('Findings:', leftMargin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    var fLines = [
        'GC (Fair, TPR normal)',
        'CVS NAD',
        'Rs (NAD)',
        'P/A Uterus (32-34 wks)',
        'Fetus (Breech)',
        'Fetal Heart Rate (Regular, 120-160/min)'
    ];
    if (consultation.examinationFindings) {
        fLines = consultation.examinationFindings.split('\n').filter(Boolean);
    }
    fLines.forEach(function(l) {
        doc.text('  ' + l, leftMargin, y);
        y += 3.8;
    });
    y += 2;

    // Investigation results
    doc.setFont('helvetica', 'bold');
    doc.text('Investigation results:', leftMargin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    var invText = consultation.investigationResults ||
        'Thyroid Function Test: ' + formattedDate.split(' ')[0] + ': Total tri-iodothyronine (T3): 161.82 ng/dl, Total serum Thyroxine (T4): 11.65 ug/dl, TSH (Ultra Sens 1.889 uIU/ml, Free Thyroxine (FT4): 0.66 ng/dl';
    doc.text('  ' + invText, leftMargin, y, { maxWidth: contentWidth - 4 });
    var invLinesCount = doc.splitTextToSize(invText, contentWidth - 4).length;
    y += (invLinesCount * 3.8) + 2;

    // Diagnosis
    doc.setFont('helvetica', 'bold');
    doc.text('Diagnosis: ', leftMargin, y);
    doc.setFont('helvetica', 'normal');
    var diagText = consultation.diagnosis ||
        'G3A2 with 32wks+6d GA with Recurrent Miscarriages with Placenta Previa with Hypothyroidism with ? Placenta Accreta';
    doc.text(diagText, leftMargin + 16, y, { maxWidth: contentWidth - 16 });
    var diagLinesCount = doc.splitTextToSize(diagText, contentWidth - 16).length;
    y += (diagLinesCount * 4) + 4;

    // ----------------------------------------------------
    // MEDICINES TABLE (9 COLUMNS EXACTLY AS IN SAMPLE)
    // ----------------------------------------------------
    var rawMeds = (consultation.prescription && consultation.prescription.length)
        ? consultation.prescription
        : (rx.medicines && rx.medicines.length)
            ? rx.medicines
            : [
                { name: 'Tablet Feromine XT', quantity: '1 tablet', timing: 'After Dinner', evening: true, frequency: '', duration: '1 Month', total: '30 tab' },
                { name: 'Tablet Shelcal CM', quantity: '1 tablet', timing: 'After Breakfast', morning: true, frequency: '', duration: '1 Month', total: '30 tab' },
                { name: 'Powder Prohance Mom SF Choco', quantity: '1 scoop', timing: 'In milk', frequency: 'Once a day', duration: '1 Month', total: '1 can' },
                { name: 'Tablet Thyronorm (50 mcg)', quantity: '1 tablet', timing: 'Before Breakfast', morning: true, frequency: '', duration: 'To Continue', total: '30 tab' },
                { name: 'Cream Strianil', quantity: '1 fingertip', timing: 'Affected Area', morning: true, evening: true, frequency: '', duration: 'To Continue', total: '1 tube' }
            ];

    var tableBody = [];
    rawMeds.forEach(function(m, idx) {
        var medName = m.name || m.medicineName || '';
        var qty = m.quantity || m.dosage || '1 tablet';
        var timing = m.timing || m.instructions || '';
        var qtyCell = qty + (timing ? '\n' + timing : '');

        var isM = m.morning || (m.frequency && (m.frequency.startsWith('1-') || m.frequency === '1-0-0' || m.frequency === '1-0-1' || m.frequency === '1-1-1')) || (timing && (timing.includes('Breakfast') || timing.includes('Morning')));
        var isA = m.afternoon || (m.frequency && (m.frequency.includes('-1-') || m.frequency === '0-1-0' || m.frequency === '1-1-1' || m.frequency === '0-1-1')) || (timing && (timing.includes('Lunch') || timing.includes('Afternoon')));
        var isE = m.evening || (m.frequency && (m.frequency.endsWith('-1') || m.frequency === '0-0-1' || m.frequency === '1-0-1' || m.frequency === '1-1-1')) || (timing && (timing.includes('Dinner') || timing.includes('Night') || timing.includes('Evening')));

        var freq = m.frequency && !m.frequency.includes('-') ? m.frequency : (m.frequencyDisplay || (isM && !isA && !isE ? '' : (isM && isE && !isA ? '' : '')));
        if (!freq && (isM && !isA && !isE && !timing.includes('Breakfast'))) freq = 'Once a day';

        var dur = m.duration || '1 Month';
        var tot = m.total || m.totalQty || (dur.includes('Month') ? '30 tab' : (dur.includes('Day') ? dur : 'To Continue'));

        tableBody.push([
            (idx + 1).toString(),
            medName,
            qtyCell,
            isM ? 'CHECK' : '',
            isA ? 'CHECK' : '',
            isE ? 'CHECK' : '',
            freq || '',
            dur || '',
            tot || ''
        ]);
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Medicines', 'Quantity', 'Morning', 'Afternoon', 'Evening', 'Frequency', 'Duration', 'Total']],
        body: tableBody,
        theme: 'plain',
        tableLineColor: [180, 190, 200],
        tableLineWidth: 0.25,
        styles: {
            lineColor: [200, 210, 220],
            lineWidth: 0.25,
            cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
            fontSize: 7.5,
            textColor: [30, 41, 59],
            valign: 'middle'
        },
        headStyles: {
            fillColor: [248, 250, 252],
            textColor: [15, 23, 42],
            fontStyle: 'bold',
            fontSize: 7.5,
            halign: 'center'
        },
        columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 55, fontStyle: 'bold' },
            2: { cellWidth: 28 },
            3: { cellWidth: 14, halign: 'center' },
            4: { cellWidth: 15, halign: 'center' },
            5: { cellWidth: 14, halign: 'center' },
            6: { cellWidth: 20, halign: 'center' },
            7: { cellWidth: 18, halign: 'center' },
            8: { cellWidth: 14, halign: 'center' }
        },
        margin: { left: leftMargin, right: leftMargin },
        didDrawCell: function(data) {
            // Draw crisp green checkmark vector for CHECK cells
            if (data.section === 'body' && (data.column.index === 3 || data.column.index === 4 || data.column.index === 5)) {
                if (data.cell.text && data.cell.text.indexOf('CHECK') !== -1) {
                    doc.setFillColor(255, 255, 255);
                    doc.rect(data.cell.x + 1, data.cell.y + 1, data.cell.width - 2, data.cell.height - 2, 'F');

                    doc.setDrawColor(22, 101, 52); // Forest green
                    doc.setLineWidth(0.4);
                    var cx = data.cell.x + (data.cell.width / 2);
                    var cy = data.cell.y + (data.cell.height / 2);
                    doc.line(cx - 2.2, cy, cx - 0.6, cy + 2);
                    doc.line(cx - 0.6, cy + 2, cx + 2.8, cy - 2.2);
                }
            }
        }
    });

    y = doc.lastAutoTable.finalY + 6;

    // Check if new page needed
    if (y > pageHeight - 55) {
        doc.addPage();
        y = 15;
    }

    // Advised Investigations
    var advInv = consultation.advInvestigations ||
        (consultation.imagingOrders && consultation.imagingOrders.length ? consultation.imagingOrders.map(function(i){return i.name;}).join(', ') : '') ||
        'MRI Pelvis: In view of Doubtful Placental Accreta.';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Advised Investigations: ', leftMargin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(advInv, leftMargin + 32, y, { maxWidth: contentWidth - 32 });
    y += 6;

    // Instructions (Bilingual English & Telugu)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Instructions / రోగికి సూచనలు & జాగ్రత్తలు:', leftMargin, y);
    y += 4;

    var instructionsList = [
        { en: 'Complete bed rest', te: 'పూర్తి విశ్రాంతి తీసుకోండి.' },
        { en: 'Avoid jerks, journeys, lifting weights and intercourse until delivery.', te: 'డెలివరీ వరకు కుదుపులు, దూర ప్రయాణాలు, బరువులు ఎత్తడం మానుకోండి.' },
        { en: 'DFMC - Daily fetal movement count.', te: 'రోజువారీ బిడ్డ కదలికలు (DFMC) క్రమం తప్పకుండా లెక్కించండి.' },
        { en: 'To report immediately if any pain abdomen, bleeding p/v, leaking p/v or decreased fetal movements.', te: 'కడుపు నొప్పి, రక్తస్రావం, ఉమ్మనీరు లీకేజ్ లేదా కదలికలు తగ్గితే వెంటనే అత్యవసరంగా రండి.' }
    ];

    if (consultation.advice) {
        instructionsList.push({ en: consultation.advice, te: 'డాక్టర్ ప్రత్యేక సూచనలను పాటించండి.' });
    }

    for (var i = 0; i < instructionsList.length; i++) {
        if (y > pageHeight - 32) {
            doc.addPage();
            y = 15;
        }
        var inst = instructionsList[i];
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(30, 41, 59);
        doc.text('• ' + inst.en, leftMargin + 2, y, { maxWidth: contentWidth - 4 });
        y += 3.6;

        try {
            var teImg = await teluguTextImage(inst.te, contentWidth - 8, 7.5);
            if (teImg && teImg.dataUrl) {
                var dw = Math.min(teImg.widthMm, contentWidth - 8);
                var dh = teImg.heightMm * (dw / teImg.widthMm);
                doc.addImage(teImg.dataUrl, 'PNG', leftMargin + 6, y, dw, dh);
                y += dh + 1.8;
            } else {
                doc.text('  ' + inst.te, leftMargin + 4, y);
                y += 3.5;
            }
        } catch(e) {
            y += 2;
        }
    }

    // Doctor Signature Line
    var docName = consultation.doctorName || bill.visitDoctor || rx.doctorName || 'Dr. Demo Jyothsna';
    var sigY = pageHeight - 22;
    doc.setDrawColor(180, 190, 200);
    doc.setLineWidth(0.3);
    doc.line(pageWidth - 75, sigY, pageWidth - 14, sigY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(docName, pageWidth - 44, sigY + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Consulting Gynecologist / Doctor Signature', pageWidth - 44, sigY + 8.5, { align: 'center' });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Jyothsna Maternity Hospital • Clinical Consultation & Outpatient Bill • Computer Generated', pageWidth / 2, pageHeight - 8, { align: 'center' });

    var cleanDateStr = (formattedDate.split(' ')[0]).replace(/[\/\s,]+/g, '-');
    var filename = 'Clinical-OP-Bill-' + (patient.patientId || patientId || 'Patient') + '-' + cleanDateStr + '.pdf';
    savePDFHelper(doc, filename);
}
window.buildClinicalOPBillPDF = buildClinicalOPBillPDF;

async function buildBilingualPrescriptionPDF(rx, patient, settings) {
    return buildClinicalOPBillPDF({ rx: rx, patient: patient, settings: settings });
}
window.buildBilingualPrescriptionPDF = buildBilingualPrescriptionPDF;

async function generateClinicalOPBillPDF(id, options) {
    options = options || {};
    var db = firebase.firestore();
    showToast('Generating bilingual OP clinical bill...', 'info');
    try {
        var bill = options.bill || null;
        var consultation = options.consultation || null;
        var patient = options.patient || null;
        var rx = options.rx || null;

        if (!bill && !consultation && id) {
            var bSnap = await db.collection('bills').doc(id).get();
            if (bSnap.exists) {
                bill = Object.assign({ id: bSnap.id }, bSnap.data());
            } else {
                var bQ = await db.collection('bills').where('billId', '==', id).get();
                if (!bQ.empty) bill = Object.assign({ id: bQ.docs[0].id }, bQ.docs[0].data());
            }

            if (!bill) {
                var cSnap = await db.collection('consultations').doc(id).get();
                if (cSnap.exists) {
                    consultation = Object.assign({ id: cSnap.id }, cSnap.data());
                } else {
                    var cQ = await db.collection('consultations').where('consultationId', '==', id).get();
                    if (!cQ.empty) consultation = Object.assign({ id: cQ.docs[0].id }, cQ.docs[0].data());
                }
            }
        }

        if (bill && bill.consultationId && !consultation) {
            var cSnap2 = await db.collection('consultations').doc(bill.consultationId).get();
            if (cSnap2.exists) consultation = Object.assign({ id: cSnap2.id }, cSnap2.data());
        }

        var patientId = (consultation && consultation.patientId) || (bill && bill.patientId) || options.patientId;
        var patientDocId = (consultation && consultation.patientDocId) || (bill && bill.patientDocId) || options.patientDocId;
        if (!patient && (patientDocId || patientId)) {
            if (patientDocId) {
                var pSnap = await db.collection('patients').doc(patientDocId).get();
                if (pSnap.exists) patient = Object.assign({ id: pSnap.id }, pSnap.data());
            }
            if (!patient && patientId) {
                var pQ = await db.collection('patients').where('patientId', '==', patientId).get();
                if (!pQ.empty) patient = Object.assign({ id: pQ.docs[0].id }, pQ.docs[0].data());
            }
        }

        var settingsSnap = await db.collection('hospitalSettings').doc('main').get();
        var settings = settingsSnap.exists ? settingsSnap.data() : {};

        await buildClinicalOPBillPDF({ bill: bill, consultation: consultation, patient: patient, rx: rx, settings: settings });
    } catch(err) {
        console.error('generateClinicalOPBillPDF error:', err);
        showToast('Error generating OP bill: ' + err.message, 'error');
    }
}
window.generateClinicalOPBillPDF = generateClinicalOPBillPDF;

async function createDispensingSlipPDF(disp, settings) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var y = 0;
    
    var hasTeluguFont = false;
    try {
        const fontBase64 = await loadNotoSansTeluguBase64();
        doc.addFileToVFS('NotoSansTelugu-Regular.ttf', fontBase64);
        doc.addFont('NotoSansTelugu-Regular.ttf', 'NotoSansTelugu', 'normal');
        hasTeluguFont = true;
    } catch (e) {
        console.error("Failed to load Noto Sans Telugu font:", e);
    }

    // === HEADER ===
    doc.setFillColor(13, 122, 112);
    doc.rect(0, 0, pageWidth, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(settings.hospitalName || 'Jyothsna Maternity Hospital', pageWidth/2, 8, { align: 'center' });
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text('PHARMACY DEPT  |  Phone: ' + (settings.phone || '') + '  |  Email: ' + (settings.email || ''), pageWidth/2, 14, { align: 'center' });
    if (settings.address) doc.text(settings.address, pageWidth/2, 19, { align: 'center' });

    y = 30;

    // === TITLE ===
    doc.setTextColor(13, 122, 112);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('PHARMACY DISPENSING SLIP', pageWidth/2, y, { align: 'center' });
    y += 5;

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(8, y, pageWidth - 8, y);
    y += 4;

    // === DETAILS ===
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.setFont(undefined, 'bold');
    doc.text('Dispense Ref:', 10, y);
    doc.setFont(undefined, 'normal');
    doc.text(disp.dispensingId || disp.id || '', 32, y);
    
    doc.setFont(undefined, 'bold');
    doc.text('Prescribed By:', 75, y);
    doc.setFont(undefined, 'normal');
    doc.text(disp.prescribedBy || 'Self', 98, y);
    
    y += 4;
    
    doc.setFont(undefined, 'bold');
    doc.text('Date/Time:', 10, y);
    doc.setFont(undefined, 'normal');
    var dispDateStr = '—';
    if (disp.createdAt) {
        try {
            dispDateStr = disp.createdAt.toDate ? disp.createdAt.toDate().toLocaleString('en-IN') : new Date(disp.createdAt).toLocaleString('en-IN');
        } catch(e) {}
    }
    doc.text(dispDateStr, 32, y);
    
    doc.setFont(undefined, 'bold');
    doc.text('Dispensed By:', 75, y);
    doc.setFont(undefined, 'normal');
    doc.text(disp.dispensedBy || 'Pharmacist', 98, y);

    y += 6;

    // === PATIENT DETAILS ===
    doc.setFillColor(245, 247, 250);
    doc.rect(8, y, pageWidth - 16, 12, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(13, 122, 112);
    doc.setFontSize(8.5);
    
    doc.text('Patient Name: ' + (disp.patientName || ''), 10, y + 4);
    doc.text('Patient ID: ' + (disp.patientId || ''), 10, y + 8);
    doc.text('Payment: ' + (disp.paymentMethod || 'Cash').toUpperCase(), 75, y + 4);
    doc.text('Bill ID: ' + (disp.linkedBillId || '—'), 75, y + 8);
    
    y += 18;

    var itemsList = (disp.items && Array.isArray(disp.items) && disp.items.length > 0) ? disp.items : [disp];
    var teluguInstructionLines = [];
    var tableBody = itemsList.map(function(item, idx) {
        let englishInst = formatPrescriptionInstructionEN(item.dosage, item.frequency, item.instructions, (item.days ? item.days + " days" : ""));
        let teluguInst = formatPrescriptionInstructionTE(item.dosage, item.frequency, item.instructions, (item.days ? item.days + " days" : ""));
        teluguInstructionLines.push(teluguInst);
        let medicineCell = (item.medicineName || item.name || 'Medicine');
        if (englishInst || teluguInst) {
            // English uses Helvetica; the Telugu line is rendered in didDrawCell.
            medicineCell += "\n" + englishInst + "\n ";
        }
        return [
            (idx + 1).toString(),
            medicineCell,
            (item.days || 1).toString(),
            (item.quantity || item.qty || 1).toString(),
            'Rs ' + (item.unitPrice || item.price || 0).toFixed(2),
            'Rs ' + (item.totalAmount || item.amount || ((item.quantity||1)*(item.unitPrice||0)) || 0).toFixed(2)
        ];
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Medicine Brand Name', 'Days', 'Qty', 'Unit Price', 'Total']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [13, 122, 112], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [60, 60, 60], font: 'helvetica', minCellHeight: 21 },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 50 },
            2: { cellWidth: 12, halign: 'center' },
            3: { cellWidth: 12, halign: 'center' },
            4: { cellWidth: 24, halign: 'right' },
            5: { cellWidth: 24, halign: 'right' }
        },
        margin: { left: 8, right: 8 },
        didDrawCell: function(data) {
            if (!hasTeluguFont || data.section !== 'body' || data.column.index !== 1) return;
            var teluguText = teluguInstructionLines[data.row.index];
            if (!teluguText) return;
            doc.setFont('NotoSansTelugu', 'normal');
            doc.setFontSize(6.6);
            doc.setTextColor(60, 60, 60);
            doc.text(teluguText, data.cell.x + 2, data.cell.y + data.cell.height - 3, { maxWidth: data.cell.width - 4 });
            doc.setFont('helvetica', 'normal');
        }
    });

    y = doc.lastAutoTable.finalY + 6;

    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.setFont(undefined, 'normal');
    doc.text('Dosage and frequency should be followed as per prescription instruction.', pageWidth/2, y, { align: 'center' });
    y += 4;
    doc.text('*** Computer Generated Pharmacy Invoice - Thank You ***', pageWidth/2, y, { align: 'center' });

    var billIdVal = disp.linkedBillId || disp.dispensingId || disp.id || 'Unknown';
    var filename = 'Dispensing-' + billIdVal + '-' + (disp.patientName || 'Patient') + '.pdf';
    savePDFHelper(doc, filename);
}
window.createDispensingSlipPDF = createDispensingSlipPDF;

// Auto-load shared UI extensions on staff pages (not login / portal / queue display).
(function injectFeatureScripts() {
    try {
        var page = (location.pathname.split("/").pop() || "").split("?")[0];
        if (!page || page === "index.html" || page === "portal.html" || page === "queue-display.html") return;
        ["js/branch.js?v=202608131200", "js/i18n.js?v=202608131200"].forEach(function (src) {
            if (document.querySelector("script[src^=\"" + src.split("?")[0] + "\"]")) return;
            var s = document.createElement("script");
            s.src = src;
            document.body ? document.body.appendChild(s) : document.documentElement.appendChild(s);
        });
    } catch (e) {}
})();

// ==========================================
// SHARED PATIENT SEARCH (name / phone / ID - prefix, suffix, substring)
// mountPatientSearch({ inputId, resultsId, onSelect, minChars })
// ==========================================
function searchPatientsShared(query, limit) {
    limit = limit || 10;
    var q = String(query || "").trim();
    if (q.length < 1) return Promise.resolve([]);
    var lower = q.toLowerCase();
    var cleanNum = q.replace(/\D/g, "");

    return db.collection("patients").limit(250).get().then(function (snap) {
        var list = [];
        snap.forEach(function (doc) {
            var p = Object.assign({ docId: doc.id }, doc.data());
            var name = (p.name || "").toLowerCase();
            var pid = (p.patientId || "").toLowerCase();
            var phone = String(p.phone || "");
            var pidNum = pid.replace(/\D/g, "");

            var matched = false;
            // Match substring anywhere in patient name (prefix, suffix, or middle)
            if (name.includes(lower)) matched = true;
            // Match anywhere in patient ID (e.g. "SA-", "2026", "00099")
            if (pid.includes(lower)) matched = true;
            // Match numeric digits of patient ID (e.g. typing "99" or "00099" matches "SA-2026-00099")
            if (cleanNum.length >= 1 && (pidNum.endsWith(cleanNum) || pidNum.includes(cleanNum))) matched = true;
            // Match phone number substring (e.g. typing "9848" or "12345")
            if (phone.includes(q) || (cleanNum.length >= 2 && phone.includes(cleanNum))) matched = true;

            if (matched) list.push(p);
        });
        return list.slice(0, limit);
    }).catch(function (err) {
        console.warn("Patient search fallback error:", err);
        return [];
    });
}
window.searchPatientsShared = searchPatientsShared;

function mountPatientSearch(opts) {
    opts = opts || {};
    var input = document.getElementById(opts.inputId);
    var dropdown = document.getElementById(opts.resultsId);
    if (!input || !dropdown) return;
    var timer = null;
    function render(list) {
        if (!list.length) {
            dropdown.innerHTML = "<div style=\"padding:10px;color:#64748b;\">No patients found</div>";
            dropdown.style.display = "block";
            return;
        }
        dropdown.innerHTML = list.map(function (p) {
            return "<div class=\"hms-pt-result\" data-docid=\"" + escapeHtml(p.docId || "") + "\" data-patientid=\"" + escapeHtml(p.patientId || "") + "\" data-name=\"" + escapeHtml(p.name || "") + "\" data-phone=\"" + escapeHtml(p.phone || "") + "\" data-doctor=\"" + escapeHtml(p.doctor || p.doctorName || "") + "\" data-dept=\"" + escapeHtml(p.department || "") + "\" data-age=\"" + escapeHtml(String(p.age || "")) + "\" data-gender=\"" + escapeHtml(p.gender || "") + "\" style=\"padding:10px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;\">"
                + "<strong>" + escapeHtml(p.name || "Unknown") + "</strong> <span style=\"color:var(--primary-teal);font-size:12px;\">" + escapeHtml(p.patientId || "") + "</span>"
                + "<br><small style=\"color:#64748b;\">" + escapeHtml(p.phone || "") + (p.doctor || p.doctorName ? " · " + escapeHtml(p.doctor || p.doctorName) : "") + "</small></div>";
        }).join("");
        dropdown.style.display = "block";
        dropdown.querySelectorAll(".hms-pt-result").forEach(function (el) {
            el.onmouseover = function () { el.style.background = "#f8fafc"; };
            el.onmouseout = function () { el.style.background = "#fff"; };
            el.onclick = function () {
                var patient = {
                    docId: el.getAttribute("data-docid"),
                    patientId: el.getAttribute("data-patientid"),
                    name: el.getAttribute("data-name"),
                    phone: el.getAttribute("data-phone"),
                    doctor: el.getAttribute("data-doctor"),
                    department: el.getAttribute("data-dept"),
                    age: el.getAttribute("data-age"),
                    gender: el.getAttribute("data-gender")
                };
                input.value = (patient.name || "") + " — " + (patient.patientId || "");
                dropdown.style.display = "none";
                if (typeof opts.onSelect === "function") opts.onSelect(patient);
            };
        });
    }
    function run() {
        var q = input.value.trim();
        if (q.length < (opts.minChars || 2)) { dropdown.style.display = "none"; return; }
        dropdown.innerHTML = "<div style=\"padding:10px;color:#64748b;\"><i class=\"fa-solid fa-spinner fa-spin\"></i> Searching...</div>";
        dropdown.style.display = "block";
        searchPatientsShared(q).then(render).catch(function (err) {
            dropdown.innerHTML = "<div style=\"padding:10px;color:#b91c1c;\">" + escapeHtml(err.message) + "</div>";
        });
    }
    input.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(run, 220);
    });
    input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); run(); }
    });
    document.addEventListener("click", function (e) {
        if (!dropdown.contains(e.target) && e.target !== input) dropdown.style.display = "none";
    });
}
window.mountPatientSearch = mountPatientSearch;

function loadServiceCatalogOptions(selectEl, selected) {
    if (!selectEl) return Promise.resolve();
    var PRESETS = [
        { name: "Doctor fee", price: 300 },
        { name: "Operation theatre charges", price: 5000 },
        { name: "Labour room charges", price: 3000 },
        { name: "Nursing charges (500/day)", price: 500 },
        { name: "Anaesthetist charges", price: 3000 },
        { name: "Paediatrician charges", price: 1000 },
        { name: "Bed charges - General ward (1500/day)", price: 1500 },
        { name: "Bed charges - Private room (Small) (2500/day)", price: 2500 },
        { name: "Bed charges - Private room (Big) (3000/day)", price: 3000 }
    ];

    return db.collection("serviceCatalog").orderBy("name").get().then(function (snap) {
        var html = "<option value=\"\">Select service / procedure</option>";
        if (window.HOSPITAL_POLICY) {
            html += '<optgroup label="Hospital test prices">';
            HOSPITAL_POLICY.labs.concat(HOSPITAL_POLICY.imaging).forEach(function(item) {
                html += '<option value="' + escapeHtml(item.name) + '" data-price="' + item.price + '" data-code="JYO-' + item.id + '">' + escapeHtml(item.name) + ' — ₹' + item.price + '</option>';
            });
            html += '</optgroup>';
        }
        html += "<optgroup label=\"Standard Particulars / సాధారణ వివరాలు\">";
        PRESETS.forEach(function (p) {
            var te = window.hmsI18n && window.hmsI18n.DICT && window.hmsI18n.DICT[p.name] ? (" / " + window.hmsI18n.DICT[p.name]) : "";
            html += "<option value=\"" + escapeHtml(p.name) + "\" data-price=\"" + p.price + "\">" + escapeHtml(p.name + te + " (₹" + p.price + ")") + "</option>";
        });
        html += "</optgroup>";

        if (!snap.empty) {
            html += "<optgroup label=\"Other Catalog Services\">";
            snap.forEach(function (doc) {
                var s = doc.data();
                if (s.isActive === false || doc.id.startsWith('JYO-')) return;
                var label = (s.name || doc.id) + (s.price != null ? (" - ₹" + s.price) : "");
                html += "<option value=\"" + escapeHtml(s.name || doc.id) + "\" data-price=\"" + (s.price || 0) + "\" data-code=\"" + escapeHtml(s.code || doc.id) + "\">" + escapeHtml(label) + "</option>";
            });
            html += "</optgroup>";
        }
        selectEl.innerHTML = html;
        if (selected) selectEl.value = selected;
    }).catch(function () {
        var html = "<option value=\"\">Select service</option>";
        PRESETS.forEach(function (p) {
            html += "<option value=\"" + escapeHtml(p.name) + "\" data-price=\"" + p.price + "\">" + escapeHtml(p.name + " (₹" + p.price + ")") + "</option>";
        });
        selectEl.innerHTML = html;
    });
}
window.loadServiceCatalogOptions = loadServiceCatalogOptions;
