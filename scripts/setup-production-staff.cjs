'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const configFile = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
if (!fs.existsSync(configFile)) {
  console.error('Firebase CLI login tokens not found at', configFile);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const token = config.tokens && config.tokens.access_token;
const projectId = 'jmgh-9dbf9';

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: v.toString() } : { doubleValue: v };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map(item => ({ stringValue: String(item) })) } };
    else if (typeof v === 'object') fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
  }
  return fields;
}

async function writeDoc(docPath, data) {
  const fields = toFirestoreFields(data);
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to write doc ${docPath} (${res.status}): ${errText}`);
  }
  return res.json();
}

async function createAuthUser(email, password, displayName) {
  // Use Identity Toolkit REST API
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      displayName,
      emailVerified: true
    })
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error && data.error.message && data.error.message.includes('EMAIL_EXISTS')) {
      console.log(`User ${email} already exists in Auth. Fetching UID...`);
      const queryRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: [email] })
      });
      const queryData = await queryRes.json();
      return queryData.users[0].localId;
    }
    throw new Error(`Failed to create Auth user ${email}: ${JSON.stringify(data)}`);
  }
  return data.localId;
}

const staffList = [
  {
    email: 'admin@jmgh.in',
    password: 'Jyothsnaroyal@2018',
    role: 'admin',
    name: 'Admin',
    department: 'Administration',
    specialisation: '',
    opFee: 0,
    freeOP: false
  },
  {
    email: 'jyothsna@jmgh.in',
    password: 'Jyothsna@2018',
    role: 'doctor',
    name: 'Dr. Jyothsna',
    department: 'Obstetrics',
    specialisation: 'Obstetrics & Gynaecology',
    opFee: 500,
    freeOP: false
  },
  {
    email: 'lab@jmgh.in',
    password: 'Lab@38140',
    role: 'lab_technician',
    name: 'Lab Technician',
    department: 'Laboratory',
    specialisation: '',
    opFee: 0,
    freeOP: false
  },
  {
    email: 'pharmacy@jmgh.in',
    password: 'Pharmacy@38140',
    role: 'pharmacist',
    name: 'Pharmacist',
    department: 'Pharmacy',
    specialisation: '',
    opFee: 0,
    freeOP: false
  },
  {
    email: 'reception@jmgh.in',
    password: 'Receptionist@38140',
    role: 'receptionist',
    name: 'Receptionist',
    department: 'Front Desk',
    specialisation: '',
    opFee: 0,
    freeOP: false
  }
];

async function main() {
  console.log(`Setting up staff and initial settings for project: ${projectId}...`);

  for (const s of staffList) {
    console.log(`Creating Auth user: ${s.email}...`);
    const uid = await createAuthUser(s.email, s.password, s.name);
    console.log(`  -> UID: ${uid}`);

    console.log(`Creating Firestore staff document: staff/${uid}...`);
    await writeDoc(`staff/${uid}`, {
      uid,
      email: s.email,
      role: s.role,
      name: s.name,
      isActive: true,
      department: s.department,
      specialisation: s.specialisation,
      opFee: s.opFee,
      freeOP: s.freeOP,
      createdAt: new Date()
    });
    console.log(`  -> Created staff/${uid}`);
  }

  console.log('Initializing hospital settings...');
  await writeDoc('hospitalSettings/main', {
    hospitalName: 'Jyothsna Maternity and General Hospital',
    name: 'Jyothsna Maternity and General Hospital',
    email: 'admin@jmgh.in',
    phone: '',
    address: '',
    integrations: {},
    createdAt: new Date()
  });

  await writeDoc('publicHospital/main', {
    hospitalName: 'Jyothsna Maternity and General Hospital',
    name: 'Jyothsna Maternity and General Hospital'
  });

  console.log('Initializing departments...');
  const depts = ['Obstetrics', 'Gynaecology', 'Paediatrics', 'General', 'Emergency', 'NICU'];
  for (const d of depts) {
    await writeDoc(`departments/${d.toLowerCase()}`, {
      name: d,
      headDoctor: '',
      description: '',
      createdAt: new Date()
    });
  }

  console.log('Initializing counters...');
  await writeDoc('patientCounter/counter', { count: 0 });

  console.log('\nAll 5 staff accounts created and verified in production Firebase!');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
