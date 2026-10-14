const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness(filename, initial = {}) {
    const records = new Map(Object.entries(initial));
    const elements = new Map();
    const notifications = [];
    let sequence = 0;
    let failurePath = null;
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
            listeners: {}, classList: { add() {}, remove() {}, contains() { return false; } },
            addEventListener(name, listener) { this.listeners[name] = listener; },
            querySelector() { return null; }, querySelectorAll() { return []; },
            setAttribute() {}, removeAttribute() {}, reset() {}
        });
        return elements.get(id);
    }
    function snapshot(ref, store = records) {
        return { id: ref.id, exists: store.has(ref.path), data: () => store.get(ref.path) };
    }
    function collection(prefix) {
        return {
            doc(id = 'auto-' + ++sequence) {
                const ref = { path: prefix + '/' + id, id, collection: name => collection(prefix + '/' + id + '/' + name) };
                ref.get = async () => snapshot(ref);
                ref.set = async data => { records.set(ref.path, data); };
                ref.update = async data => { records.set(ref.path, { ...records.get(ref.path), ...data }); };
                return ref;
            },
            add: async data => { const ref = collection(prefix).doc(); records.set(ref.path, data); return ref; }
        };
    }
    const db = {
        collection,
        async runTransaction(work) {
            const pending = [];
            const transaction = {
                async get(ref) { assert.equal(pending.length, 0, 'all transaction reads must precede writes'); return snapshot(ref); },
                set(ref, data, options) { pending.push({ ref, data, merge: options && options.merge }); },
                update(ref, data) { pending.push({ ref, data, merge: true, mustExist: true }); },
                delete(ref) { pending.push({ ref, remove: true }); }
            };
            const result = await work(transaction);
            const next = new Map(records);
            for (const change of pending) {
                if (change.ref.path === failurePath) throw new Error('Simulated permission failure');
                if (change.mustExist && !next.has(change.ref.path)) throw new Error('Missing document');
                if (change.remove) next.delete(change.ref.path);
                else next.set(change.ref.path, change.merge ? { ...next.get(change.ref.path), ...change.data } : change.data);
            }
            records.clear(); next.forEach((value, key) => records.set(key, value));
            return result;
        }
    };
    const firestore = Object.assign(() => db, {
        FieldValue: { serverTimestamp: () => 'server-time' }, Timestamp: { fromDate: date => date.toISOString() }
    });
    const context = vm.createContext({
        console: { ...console, error() {}, warn() {} }, db, firebase: { firestore }, URL, URLSearchParams, Event: class {},
        checkAccess() {}, getCurrentUser() {}, debounce: fn => fn,
        showToast: (message, type) => notifications.push({ message, type }),
        todayIso: () => '2026-09-19', setTimeout, clearTimeout,
        document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
        window: { location: { href: 'http://localhost/consultation.html', search: '' }, history: { replaceState() {} } },
        navigator: { onLine: true }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', filename), 'utf8'), context, { filename });
    return { context, records, elements, notifications, element, failOn: path => { failurePath = path; }, run: code => vm.runInContext(code, context) };
}

function clinicalRecord(overrides = {}) {
    return {
        consultationId: 'CONS-A', patientId: 'SA-1', patientDocId: 'p1', patientName: 'Example',
        appointmentId: 'a1', doctorName: 'Doctor', department: 'Maternity', status: 'completed',
        labOrders: [{ name: 'CBC', amount: 250 }], imagingOrders: [],
        prescription: [{ name: 'Prescribed medicine', dosage: 'As directed' }], ...overrides
    };
}

test('consultation completion commits clinical record, orders, bill and appointment exactly once', async () => {
    const h = harness('consultation.js', { 'appointments/a1': { patientId: 'SA-1', status: 'in_progress' } });
    h.run("currentDoctor = { opFee: 0 }; currentDoctorName = 'Doctor';");
    await h.context.triggerDownstreamActions(clinicalRecord());
    const completed = h.records.get('consultations/CONS-A');
    assert.equal(completed.status, 'completed');
    assert.ok(completed.billDocId);
    assert.equal(h.records.get('bills/' + completed.billDocId).grandTotal, 250, 'zero fee is preserved');
    assert.equal(h.records.get('appointments/a1').status, 'completed');
    assert.equal(h.records.get('billCounters/opd').count, 1);
    const count = h.records.size;
    await h.context.triggerDownstreamActions(clinicalRecord());
    assert.equal(h.records.size, count, 'retry must not create duplicate orders or bills');
    assert.equal(h.records.get('billCounters/opd').count, 1);
});

test('failed downstream write does not complete consultation or consume bill sequence', async () => {
    const h = harness('consultation.js', { 'appointments/a1': { patientId: 'SA-1', status: 'in_progress' } });
    h.failOn('prescriptions/RX-CONS-A');
    await assert.rejects(h.context.triggerDownstreamActions(clinicalRecord()), /Simulated permission/);
    assert.equal(h.records.has('consultations/CONS-A'), false);
    assert.equal(h.records.has('billCounters/opd'), false);
    assert.equal(h.records.get('appointments/a1').status, 'in_progress');
});

test('cancelled appointment cannot be completed or billed', async () => {
    const h = harness('consultation.js', { 'appointments/a1': { patientId: 'SA-1', status: 'cancelled' } });
    await assert.rejects(h.context.triggerDownstreamActions(clinicalRecord()), /cancelled/);
    assert.equal(h.records.size, 1);
});

test('saving a consultation draft repeatedly updates one record and preserves its creation date', async () => {
    const h = harness('consultation.js');
    h.run("currentPatient = {id:'p1', patientId:'SA-1', name:'Example'}; activeConsultationId = 'draft-1'; consultationReady = true;");
    h.element('chiefComplaint').value = 'Follow-up';
    h.element('diagnosis').value = 'Recorded diagnosis';
    await h.context.saveConsultation(true);
    h.records.get('consultations/draft-1').createdAt = 'original-created-time';
    h.element('advice').value = 'Updated advice';
    await h.context.saveConsultation(true);
    assert.equal(h.records.size, 1);
    assert.equal(h.records.get('consultations/draft-1').advice, 'Updated advice');
    assert.equal(h.records.get('consultations/draft-1').createdAt, 'original-created-time');
});

test('booking failure rolls back token allocation and patient appointment update', async () => {
    const h = harness('appointments.js', { 'patients/p1': { patientId: 'SA-1' } });
    h.run("selectedPatient = {docId:'p1', patientId:'SA-1', name:'Example'}; allDoctors = [{id:'d1', name:'Doctor'}];");
    h.element('bookingDoctor').value = 'd1';
    h.element('bookingDate').value = '2026-09-20';
    h.element('bookingTime').value = '10:00';
    h.failOn('patients/p1');
    await h.element('bookingForm').listeners.submit({ preventDefault() {} });
    assert.equal(h.records.has('appointmentCounters/d1_2026-09-20'), false);
    assert.equal(h.records.size, 1);
    assert.equal(h.element('saveBookingBtn').disabled, false);
    assert.match(h.notifications.at(-1).message, /Failed to book/);
});

test('failed patient edit keeps edit identity so retry cannot register another patient', async () => {
    const h = harness('patients.js', { 'patients/p1': { patientId: 'SA-1', name: 'Example', phone: '1234567890' } });
    h.run("editingPatientId = 'p1'; existingPatientId = 'SA-1'; allPatients = [{id:'p1', patientId:'SA-1', name:'Example', phone:'1234567890'}];");
    h.failOn('patients/p1');
    await h.context.savePatientData(h.element('savePatientBtn'), 'Example Updated', '1234567890');
    assert.equal(h.run('editingPatientId'), 'p1');
    assert.equal(h.run('existingPatientId'), 'SA-1');
    assert.equal(h.records.size, 1);
    assert.equal(h.element('savePatientBtn').disabled, false);
});

test('rescheduling to another day allocates its next doctor token atomically', async () => {
    const h = harness('appointments.js', {
        'appointments/a1': { patientId: 'SA-1', doctorId: 'd1', status: 'scheduled', appointmentDate: '2026-09-19', timeSlot: '10:00', tokenNumber: 2 },
        'appointmentCounters/d1_2026-09-20': { count: 8 }
    });
    await h.context.rescheduleAppointment('a1', '2026-09-20', '11:00');
    assert.equal(h.records.get('appointments/a1').tokenNumber, 9);
    assert.equal(h.records.get('appointmentCounters/d1_2026-09-20').count, 9);
    await h.context.rescheduleAppointment('a1', '2026-09-20', '12:00');
    assert.equal(h.records.get('appointments/a1').tokenNumber, 9, 'time-only change retains token');
    assert.equal(h.records.get('appointmentCounters/d1_2026-09-20').count, 9);
});

test('completed appointment cannot be rescheduled', async () => {
    const h = harness('appointments.js', { 'appointments/a1': { patientId: 'SA-1', status: 'completed' } });
    await assert.rejects(h.context.rescheduleAppointment('a1', '2026-09-20', '12:00'), /Only active/);
    assert.equal(h.records.size, 1);
});

test('stale bed status cannot release an occupied bed', async () => {
    const h = harness('bed-management.js', { 'beds/b1': { status: 'occupied', patientId: 'SA-1' } });
    await assert.rejects(h.context.transitionBed('b1', 'reserved', { status: 'available' }), /Bed status changed/);
    assert.equal(h.records.get('beds/b1').status, 'occupied');
});

test('bed assignment refuses already admitted patients and already occupied beds', async () => {
    const h = harness('bed-management.js', {
        'beds/b1': { status: 'available', bedNumber: 'A1', ward: 'General', dailyRate: 1000 },
        'patients/p1': { patientId: 'SA-1', currentBedId: 'b2' }
    });
    h.run("_assignBedData = {docId:'b1', bedNumber:'A1'}; _assignSelectedPatient = {docId:'p1', patientId:'SA-1', name:'Example'};");
    h.element('assignAdmissionDate').value = '2026-09-19';
    await h.context.confirmAssignPatient();
    assert.match(h.notifications.at(-1).message, /already assigned/);
    assert.equal(h.records.get('beds/b1').status, 'available');
    h.records.set('patients/p1', { patientId: 'SA-1' });
    await h.context.confirmAssignPatient();
    assert.equal(h.records.get('beds/b1').status, 'occupied');
    assert.equal(h.records.get('patients/p1').currentBedId, 'b1');
    assert.equal([...h.records.keys()].filter(key => key.startsWith('admissions/')).length, 1);
});

test('discharge clears active links without falsely marking bills or reports complete', async () => {
    const h = harness('bed-management.js', {
        'beds/b1': { status: 'occupied', bedNumber: 'A1', patientId: 'SA-1', patientDocId: 'p1', activeAdmissionId: 'ad1', billDocId: 'bill1' },
        'patients/p1': { patientId: 'SA-1', currentBedId: 'b1', status: 'admitted' },
        'admissions/ad1': { status: 'admitted' },
        'bills/bill1': { isRunningBill: true, reportStatus: 'pending' }
    });
    await h.context.proceedDischarge('b1');
    assert.equal(h.records.get('beds/b1').status, 'cleaning');
    assert.equal(h.records.get('beds/b1').activeAdmissionId, null);
    assert.equal(h.records.get('beds/b1').billDocId, null);
    assert.equal(h.records.get('patients/p1').currentBedId, null);
    assert.equal(h.records.get('admissions/ad1').status, 'discharged');
    assert.equal(h.records.get('bills/bill1').reportStatus, 'pending');
});
