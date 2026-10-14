'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('./build-functions.cjs');
const out = path.join(root, 'dist');
// The same confirmed price list is used by browser defaults and server setup.
fs.copyFileSync(path.join(root, 'js/hospital-policy.js'), path.join(root, 'functions/hospital-policy.cjs'));
fs.mkdirSync(out, { recursive: true });
const excluded = new Set(['setup.html', 'setup-admissions.html']);
const sdk = /https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z-]+\.js)/g;
for (const file of fs.readdirSync(root)) {
  if ((!file.endsWith('.html') || excluded.has(file)) && !['sw.js', 'manifest.webmanifest'].includes(file)) continue;
  let content = fs.readFileSync(path.join(root, file), 'utf8');
  content = content.replace(sdk, 'vendor/$1');
  fs.writeFileSync(path.join(out, file), content);
}
for (const dir of ['css', 'images', 'js']) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), {
    recursive: true, filter: source => !/^setup(?:-demo|-admissions)?\.js$/.test(path.basename(source))
  });
}
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
for (const name of ['app', 'auth', 'firestore', 'functions', 'storage']) {
  const file = `firebase-${name}-compat.js`;
  fs.copyFileSync(path.join(root, 'node_modules', 'firebase', file), path.join(out, 'vendor', file));
}
fs.writeFileSync(path.join(out, 'vercel.json'), JSON.stringify({
  version: 2,
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "Cache-Control", value: "no-cache" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" }
      ]
    }
  ],
  rewrites: [
    { source: "/", destination: "/index.html" },
    { source: "/login", destination: "/index.html" }
  ]
}, null, 2) + '\n');
console.log('Built deployable app in dist/ (setup tools and server code excluded).');

