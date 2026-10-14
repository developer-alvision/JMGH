'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const zipFile = path.join(root, 'jmgh-hms-static.zip');

console.log('1. Building production dist folder...');
execFileSync(process.execPath, [path.join(__dirname, 'build.cjs')], { stdio: 'inherit', cwd: root });

if (!fs.existsSync(dist)) {
  throw new Error('dist directory not found after build!');
}

console.log('2. Gathering dist files for Vercel deployment archive...');
const entries = [];
function collect(dir, prefix) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      collect(full, rel);
    } else if (item.isFile()) {
      entries.push({ full, rel: rel.replace(/\\/g, '/') });
    }
  }
}
collect(dist, '');
const staticConfigPath = path.join(root, '.runtime/vercel-static.json');
fs.mkdirSync(path.dirname(staticConfigPath), { recursive: true });
const staticConfig = { ...JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')),
  buildCommand: '', installCommand: '', outputDirectory: '.' };
fs.writeFileSync(staticConfigPath, JSON.stringify(staticConfig, null, 2));
entries.push({ full: staticConfigPath, rel: 'vercel.json' });

// Sort entries deterministically
entries.sort((a, b) => a.rel.localeCompare(b.rel));

console.log(`Packaging ${entries.length} files into ${path.basename(zipFile)}...`);

const localChunks = [];
const cdChunks = [];
let localOffset = 0;

for (const entry of entries) {
  const content = fs.readFileSync(entry.full);
  const uncompressedSize = content.length;
  const crc = zlib.crc32(content);

  // Deflate compression
  const deflated = zlib.deflateRawSync(content, { level: 9 });
  const useDeflate = deflated.length < uncompressedSize;
  const body = useDeflate ? deflated : content;
  const compMethod = useDeflate ? 8 : 0;
  const compSize = body.length;

  const stat = fs.statSync(entry.full);
  const mtime = new Date(stat.mtime);
  const dosTime = ((mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate()) & 0xffff;

  const nameBuf = Buffer.from(entry.rel, 'utf8');

  // Local File Header (30 bytes + name)
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);       // Signature
  lfh.writeUInt16LE(20, 4);               // Version needed to extract (2.0)
  lfh.writeUInt16LE(0x0800, 6);           // Flags: UTF-8 filename
  lfh.writeUInt16LE(compMethod, 8);       // Compression method
  lfh.writeUInt16LE(dosTime, 10);         // DOS time
  lfh.writeUInt16LE(dosDate, 12);         // DOS date
  lfh.writeUInt32LE(crc, 14);             // CRC-32
  lfh.writeUInt32LE(compSize, 18);        // Compressed size
  lfh.writeUInt32LE(uncompressedSize, 22);// Uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26);  // Filename length
  lfh.writeUInt16LE(0, 28);               // Extra field length

  localChunks.push(lfh, nameBuf, body);

  // Central Directory Header (46 bytes + name)
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);       // Signature
  cdh.writeUInt16LE(0x0314, 4);           // Made by UNIX, zip 2.0
  cdh.writeUInt16LE(20, 6);               // Version needed (2.0)
  cdh.writeUInt16LE(0x0800, 8);           // Flags: UTF-8
  cdh.writeUInt16LE(compMethod, 10);      // Compression method
  cdh.writeUInt16LE(dosTime, 12);         // DOS time
  cdh.writeUInt16LE(dosDate, 14);         // DOS date
  cdh.writeUInt32LE(crc, 16);             // CRC-32
  cdh.writeUInt32LE(compSize, 20);        // Compressed size
  cdh.writeUInt32LE(uncompressedSize, 24);// Uncompressed size
  cdh.writeUInt16LE(nameBuf.length, 28);  // Filename length
  cdh.writeUInt16LE(0, 30);               // Extra field length
  cdh.writeUInt16LE(0, 32);               // Comment length
  cdh.writeUInt16LE(0, 34);               // Disk number start
  cdh.writeUInt16LE(0, 36);               // Internal attributes
  cdh.writeUInt32LE((0o100644 << 16) >>> 0, 38); // External attributes (UNIX permissions: -rw-r--r--)
  cdh.writeUInt32LE(localOffset, 42);     // Relative offset of local header

  cdChunks.push(cdh, nameBuf);
  localOffset += lfh.length + nameBuf.length + body.length;
}

const cdOffset = localOffset;
let cdSize = 0;
for (const b of cdChunks) cdSize += b.length;

// End of Central Directory Record (22 bytes)
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);        // Signature
eocd.writeUInt16LE(0, 4);                // Disk number
eocd.writeUInt16LE(0, 6);                // Disk with CD
eocd.writeUInt16LE(entries.length, 8);   // Entries on this disk
eocd.writeUInt16LE(entries.length, 10);  // Total entries
eocd.writeUInt32LE(cdSize, 12);          // Central directory size
eocd.writeUInt32LE(cdOffset, 16);        // Central directory offset
eocd.writeUInt16LE(0, 20);               // Comment length

const fullArchive = Buffer.concat([...localChunks, ...cdChunks, eocd]);
fs.writeFileSync(zipFile, fullArchive);

const zipStat = fs.statSync(zipFile);
const sizeMb = (zipStat.size / (1024 * 1024)).toFixed(2);
console.log(`\nSuccessfully created Vercel deployment zip:`);
console.log(`  File: ${zipFile}`);
console.log(`  Size: ${sizeMb} MB (${zipStat.size} bytes)`);
console.log(`  Files: ${entries.length} items`);
console.log(`\nDeploy options:`);
console.log(`  Extract '${path.basename(zipFile)}' into a new folder.`);
console.log(`  Run inside that folder: npx vercel deploy --prod --yes`);
