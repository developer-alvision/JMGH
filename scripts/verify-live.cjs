'use strict';
const fs = require('node:fs');
const path = require('node:path');
const project = process.env.FIREBASE_PROJECT_ID || 'YOUR-FIREBASE-PROJECT-ID';
const website = process.argv[2] || ('https://' + project + '.web.app');
if (new URL(website).protocol !== 'https:') throw new Error('Verification target must be https.');
async function main() {
    const checks = [];
    for (const file of ['index.html', 'js/hospital-policy.js', 'js/hospital-forms.js', 'vendor/firebase-functions-compat.js', 'certificates.html']) {
        const response = await fetch(website + '/' + file + '?verification=20261013', { signal: AbortSignal.timeout(30000) });
        if (response.status !== 200) throw new Error(file + ' returned ' + response.status);
        const content = await response.text();
        if (file === 'js/hospital-policy.js' && !content.includes('phoneSurcharge: 100')) throw new Error('Live fee policy is outdated.');
        if (file === 'certificates.html' && !content.includes('Generated automatically when issued')) throw new Error('Live certificate UI is outdated.');
        checks.push({ file, status: response.status });
    }
    for (const file of ['setup.html', 'functions/index.js']) {
        const response = await fetch(website + '/' + file, { signal: AbortSignal.timeout(30000) });
        if (response.status !== 404) throw new Error('Private/setup resource is publicly served: ' + file);
        checks.push({ file, status: response.status });
    }
    // Unauthenticated calls prove deployment/readiness and do not access data.
    for (const name of ['applyHospitalPolicy', 'issueHospitalCertificate']) {
        const response = await fetch('https://asia-south1-' + project + '.cloudfunctions.net/' + name, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}', signal: AbortSignal.timeout(30000)
        });
        if (response.status !== 401) throw new Error(name + ' expected authenticated access, got ' + response.status);
        checks.push({ function: name, status: response.status });
    }
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
    const evidence = new URL(website).hostname.endsWith('.vercel.app') ? 'vercel-live-verification.json' : 'live-verification.json';
    fs.writeFileSync(path.resolve(__dirname, '../test-results/' + evidence), JSON.stringify({ at: new Date().toISOString(), website, checks }, null, 2));
    console.log('PASS: live website assets, new fee policy, automatic certificates and authenticated core endpoints.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
