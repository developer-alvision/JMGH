'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
require('./build-functions.cjs');
// The target project comes from FIREBASE_PROJECT_ID, or from .firebaserc when
// `firebase use` has already selected one. Nothing is hardcoded, so this
// checkout cannot accidentally deploy into someone else's project.
const projectId = process.env.FIREBASE_PROJECT_ID
  || (() => {
    try {
      const rc = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
      const id = rc.projects && rc.projects.default;
      return id && id !== 'YOUR-FIREBASE-PROJECT-ID' ? id : null;
    } catch (err) { return null; }
  })();
if (!projectId) {
  console.error('No Firebase project selected. Run `firebase use <project-id>` or set FIREBASE_PROJECT_ID.');
  process.exit(1);
}
// Select explicit local functions so deploying this checkout never deletes
// independently managed functions already present in the Firebase project.
const source = fs.readFileSync('functions/index.js', 'utf8');
const core = new Set(['applyHospitalPolicy', 'issueHospitalCertificate', 'syncStaffUid', 'syncStaffProfile', 'publishQueueDisplay', 'publishHospitalDisplay', 'refreshPublicDisplays', 'setPatientPortalPin', 'getPatientPortalData']);
const functions = [...source.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)]
  .filter(match => process.argv.includes('--all-local-functions') || core.has(match[1]))
  .map(match => 'functions:' + match[1]);
if (!functions.length) throw new Error('No functions found; refusing incomplete deployment.');
// Indexes ship with every deploy: several screens combine an equality filter
// with a sort on another field, which fails outright against the live backend
// without the matching composite index declared in firestore.indexes.json.
const only = ['hosting', 'firestore:rules', 'firestore:indexes', 'storage', ...functions].join(',');
const manifest = JSON.parse(fs.readFileSync('functions/package.json', 'utf8'));
const originalManifest = fs.readFileSync('functions/package.json', 'utf8');
if (process.argv.includes('--all-local-functions')) {
  manifest.main = 'index.js'; fs.writeFileSync('functions/package.json', JSON.stringify(manifest, null, 2) + '\n');
}
let result;
try {
  result = spawnSync(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'deploy', '--project', projectId, '--only', only, '--non-interactive'], { stdio: 'inherit', env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: '60' } });
} finally {
  if (process.argv.includes('--all-local-functions')) fs.writeFileSync('functions/package.json', originalManifest);
}
process.exitCode = result.status || (result.error ? 1 : 0);
