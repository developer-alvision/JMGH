'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, FIREBASE_CLI_DISABLE_TELEMETRY: '1', FIREBASE_SKIP_UPDATE_CHECK: '1', FUNCTIONS_DISCOVERY_TIMEOUT: '60' };
const javaDir = path.join(root, '.runtime/java');
if (fs.existsSync(javaDir)) {
  const runtime = fs.readdirSync(javaDir).find(name => fs.existsSync(path.join(javaDir, name, 'bin/java.exe')));
  if (runtime) {
    env.JAVA_HOME = path.join(javaDir, runtime);
    env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env.PATH || env.Path || '');
  }
}
const java = spawnSync('java', ['-version'], { env, encoding: 'utf8', windowsHide: true });
const version = (java.stderr || java.stdout || '').match(/version "(\d+)/);
if (java.error || !version || Number(version[1]) < 21) {
  console.error('Java 21+ is required by Firebase. On Windows run: npm run setup:java');
  process.exit(1);
}
if (spawnSync(process.execPath, ['scripts/build.cjs'], { cwd: root, stdio: 'inherit' }).status !== 0) process.exit(1);
const args = ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:start', '--project', 'demo-jyothsna-hms',
  '--only', 'auth,firestore,functions,storage,hosting', '--export-on-exit', '.emulator-data'];
if (fs.existsSync(path.join(root, '.emulator-data/firebase-export-metadata.json'))) args.push('--import', '.emulator-data');
const emulator = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
let ended = false;
emulator.on('exit', code => { ended = true; process.exitCode = code || 0; });
process.on('SIGINT', () => { emulator.kill('SIGINT'); });
process.on('SIGTERM', () => { emulator.kill('SIGTERM'); });
function portReady(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(600);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
(async () => {
  for (let attempt = 0; attempt < 600 && !ended; attempt++) {
    if ((await Promise.all([5000, 5001, 8080, 9099, 9199].map(portReady))).every(Boolean)) {
      const health = await fetch('http://127.0.0.1:5001/demo-jyothsna-hms/asia-south1/syncStaffUid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}', signal: AbortSignal.timeout(10000)
      }).catch(() => null);
      if (!health || health.status !== 401) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
      const seed = spawn(process.execPath, ['scripts/seed.cjs'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
      seed.on('exit', code => {
        if (!code) console.log('\nApp ready: http://127.0.0.1:5000\nLocal admin: admin@jyothsna.test / DemoHospital123!\nCtrl+C saves the local database and stops the app.');
      });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ended) console.error('Services have not started. Check emulator errors above.');
})();
