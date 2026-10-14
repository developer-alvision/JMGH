'use strict';
// A project-local JRE: no registry edits or system-wide PATH changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
async function main() {
  if (process.platform !== 'win32') throw new Error('Install Java 21 or later using your OS package manager, then run npm start.');
  const dir = path.resolve(__dirname, '../.runtime/java');
  fs.mkdirSync(dir, { recursive: true });
  const response = await fetch('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows');
  if (!response.ok) throw new Error('Unable to obtain Java release metadata: ' + response.status);
  const [release] = await response.json();
  const pkg = release.binary.package;
  const archive = path.join(dir, 'java21.zip');
  console.log('Downloading verified Eclipse Temurin Java 21 runtime…');
  const download = await fetch(pkg.link);
  if (!download.ok) throw new Error('Java download failed: ' + download.status);
  await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(archive));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (hash !== pkg.checksum) throw new Error('Java archive checksum did not match; installation stopped.');
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const extraction = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(dir)} -Force`], { stdio: 'inherit', windowsHide: true });
  if (extraction.status !== 0) throw new Error('Could not extract Java archive.');
  fs.unlinkSync(archive);
  console.log('Java installed in .runtime/java. Run npm start.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
