'use strict';
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', 'functions/test/firestore.rules.test.cjs'], {
  stdio: 'inherit', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' }
});
process.exitCode = result.status || (result.error ? 1 : 0);
