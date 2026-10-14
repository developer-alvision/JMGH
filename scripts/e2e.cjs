'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5000';
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, { recursive: true });
async function main() {
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { browser = await chromium.launch({ headless: true }); }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const failures = [], pages = [];
  function watch(target) {
    target.on('pageerror', error => failures.push({ url: target.url(), type: 'javascript', message: error.message }));
    target.on('console', message => {
      if (message.type() === 'error' && /permission|undefined|not a function|Error loading|failed-precondition/i.test(message.text()))
        failures.push({ url: target.url(), type: 'console', message: message.text() });
    });
  }
  watch(page);
  try {
    await page.goto(base);
    await page.locator('#email').fill('admin@jyothsna.test');
    await page.locator('#password').fill('DemoHospital123!');
    await page.locator('#loginBtn').click();
    await page.waitForURL('**/dashboard.html', { timeout: 60000 });
    await page.locator('.sidebar-nav a').first().waitFor();
    assert.equal(await page.evaluate(() => firebase.app().options.projectId), 'demo-jyothsna-hms');
    await page.screenshot({ path: path.join(output, 'dashboard.png'), fullPage: true });
    // Register through the actual form and prove a second tab updates live.
    await page.goto(base + '/patients.html');
    await page.locator('#addNewBtn').waitFor();
    const observer = await context.newPage();
    watch(observer);
    await observer.goto(base + '/patients.html');
    await observer.locator('.sidebar-nav a').first().waitFor();
    const suffix = Date.now().toString().slice(-7);
    const name = 'Browser Test ' + suffix;
    await page.locator('#addNewBtn').click();
    await page.locator('#patientName').fill(name);
    await page.locator('#patientDob').fill('1996-05-12');
    await page.locator('#patientPhone').fill('988' + suffix);
    await page.locator('#patientBlood').selectOption('O+');
    await page.locator('#patientGender').selectOption('Female');
    await page.locator('#patientDoctor').selectOption({ label: 'Dr. Demo Jyothsna' });
    await page.locator('#patientDepartment').selectOption('Gynaecology');
    await page.locator('#savePatientBtn').click();
    await page.locator('#addPatientModal').waitFor({ state: 'hidden' });
    await observer.locator('#patientsTableBody').getByText(name, { exact: true }).waitFor();
    pages.push({ flow: 'Patient registration and live second-tab update', status: 'passed' });
    await observer.close();
    await page.screenshot({ path: path.join(output, 'patients.png'), fullPage: true });
    // Load every staff module as an administrator and catch runtime/database errors.
    const modules = ['appointments', 'doctor-dashboard', 'owner-dashboard', 'patient-profile', 'consultations',
      'consultation', 'maternity-care', 'partograph', 'discharge', 'op-queue', 'bed-management',
      'billing', 'today-collections', 'pharmacy', 'inventory-alerts', 'lab-reports', 'imaging',
      'ot-schedule', 'attendance', 'certificates', 'accounts', 'claims', 'packages', 'quality',
      'teleconsult', 'usg-templates', 'admin'];
    for (const module of modules) {
      const query = ['patient-profile', 'consultation'].includes(module) ? '?id=SA-' + new Date().getFullYear() + '-00001&patientId=SA-' + new Date().getFullYear() + '-00001' : '';
      await page.goto(base + '/' + module + '.html' + query);
      await page.locator('.sidebar-nav a').first().waitFor();
      await page.waitForTimeout(750);
      pages.push({ page: module, status: 'loaded' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/dashboard.html');
    await page.locator('#mobileMenuBtn').click();
    await page.locator('.sidebar.mobile-open').waitFor();
    await page.screenshot({ path: path.join(output, 'mobile-dashboard.png'), fullPage: true });
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    watch(publicPage);
    await publicPage.goto(base + '/queue-display.html');
    await publicPage.locator('#qdToken').waitFor();
    await publicPage.goto(base + '/portal.html');
    await publicPage.locator('#portalPatientId').waitFor();
    await publicContext.close();
    assert.deepEqual(failures, [], 'Runtime or permission failures: ' + JSON.stringify(failures));
    console.log('PASS: login, patient creation, real-time sync, 27 staff modules, mobile navigation and public pages.');
  } finally {
    fs.writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), pages, failures }, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
