'use strict';
const auth = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { getAuthDomains, updateAuthDomains } = require('firebase-tools/lib/gcp/auth');
const project = process.env.FIREBASE_PROJECT_ID || 'YOUR-FIREBASE-PROJECT-ID';
const hostname = process.env.DEPLOY_HOSTNAME;
if (!hostname) {
  console.error('Set DEPLOY_HOSTNAME to the domain you are authorising, e.g. DEPLOY_HOSTNAME=hms.example.com');
  process.exit(1);
}
async function main() {
    const options = { project, nonInteractive: true };
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('Sign in with firebase login first.');
    auth.setActiveAccount(options, account);
    await requireAuth(options, true);
    const existing = await getAuthDomains(project);
    if (existing.includes(hostname)) { console.log('Vercel production hostname is already authorized in Firebase.'); return; }
    await updateAuthDomains(project, [...existing, hostname]);
    const verified = await getAuthDomains(project);
    if (!verified.includes(hostname) || existing.some(domain => !verified.includes(domain))) throw new Error('Domain verification failed.');
    console.log('Authorized ' + hostname + ' in Firebase; existing domains preserved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
