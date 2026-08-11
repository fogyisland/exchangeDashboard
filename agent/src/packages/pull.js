import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import axios from 'axios';
import { loadManifest } from './manifest.js';

// --- Minimal ZIP reader (no adm-zip dep on agent side) ---
// Parses End-of-Central-Directory + Central Directory entries, supports STORE (0) and DEFLATE (8) methods.
// Returns array of { name, method, compressed, uncompressed, crc32 }.

function readUInt32LE(buf, off) { return buf.readUInt32LE(off); }
function readUInt16LE(buf, off) { return buf.readUInt16LE(off); }

function findEOCD(buf) {
  const sig = 0x06054b50;
  const max = Math.min(buf.length, 65557);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (readUInt32LE(buf, i) === sig) return i;
  }
  return -1;
}

function parseEntries(buf) {
  const eocdOff = findEOCD(buf);
  if (eocdOff < 0) throw new Error('ZIP: EOCD not found');
  const cdSize = readUInt32LE(buf, eocdOff + 12);
  const cdOff = readUInt32LE(buf, eocdOff + 16);
  const entries = [];
  let p = cdOff;
  while (p < cdOff + cdSize) {
    if (readUInt32LE(buf, p) !== 0x02014b50) throw new Error('ZIP: bad CD signature');
    const method = readUInt16LE(buf, p + 10);
    const compSize = readUInt32LE(buf, p + 20);
    const uncompSize = readUInt32LE(buf, p + 24);
    const nameLen = readUInt16LE(buf, p + 28);
    const extraLen = readUInt16LE(buf, p + 30);
    const commentLen = readUInt16LE(buf, p + 32);
    const localHeaderOff = readUInt32LE(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, uncompSize, localHeaderOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryData(buf, entry) {
  const p = entry.localHeaderOff;
  if (readUInt32LE(buf, p) !== 0x04034b50) throw new Error(`ZIP: bad local header for ${entry.name}`);
  const nameLen = readUInt16LE(buf, p + 26);
  const extraLen = readUInt16LE(buf, p + 28);
  const dataOff = p + 30 + nameLen + extraLen;
  const comp = buf.slice(dataOff, dataOff + entry.compSize);
  if (entry.method === 0) return comp;
  if (entry.method === 8) return zlib.inflateRawSync(comp);
  throw new Error(`ZIP: unsupported method ${entry.method}`);
}

function parseZip(buffer) {
  const entries = parseEntries(buffer);
  let manifest = null;
  let collectorJs = null;
  const migrations = [];
  for (const e of entries) {
    if (e.name === 'manifest.json') {
      manifest = JSON.parse(readEntryData(buffer, e).toString('utf8'));
    } else if (e.name === 'collector.js') {
      collectorJs = readEntryData(buffer, e).toString('utf8');
    } else if (e.name.startsWith('migrations/') && e.name.endsWith('.sql') && !e.name.endsWith('/')) {
      migrations.push({ filename: path.basename(e.name), content: readEntryData(buffer, e).toString('utf8') });
    }
  }
  migrations.sort((a, b) => a.filename.localeCompare(b.filename));
  if (!manifest) throw new Error('manifest.json missing');
  if (!collectorJs) throw new Error('collector.js missing');
  if (migrations.length === 0) throw new Error('migrations/ directory is empty');
  return { manifest, collectorJs, migrations };
}

// --- Junction link (re-uses the same pattern as center/src/packages/storage.js#createJunction) ---
function createJunction(linkPath, target) {
  try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch {}
  if (process.platform === 'win32') {
    execSync(`cmd /c mklink /J "${linkPath}" "${target}"`, { stdio: 'pipe' });
  } else {
    fs.symlinkSync(target, linkPath, 'junction');
  }
}

// --- Public API ---
function defaultHttp(url) {
  return axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
}

export async function pullPackage({ name, version, downloadUrl, installPath, http, logger }) {
  const fetcher = http || defaultHttp;
  const res = await fetcher(downloadUrl);
  const buf = Buffer.from(res.data || res);
  const parsed = parseZip(buf);
  // Inline validation against the existing manifest schema by writing to a temp dir and reading back.
  const tmpDir = await fsp.mkdtemp(path.join(installPath, '.validate-'));
  try {
    const validateDir = path.join(tmpDir, parsed.manifest.name || name, 'current');
    await fsp.mkdir(validateDir, { recursive: true });
    await fsp.writeFile(path.join(validateDir, 'manifest.json'), JSON.stringify(parsed.manifest, null, 2));
    const validated = await loadManifest(tmpDir, parsed.manifest.name || name);
    if (!validated) throw new Error('manifest validation failed');
    if (validated.manifest.name !== name) throw new Error(`manifest name mismatch: got ${validated.manifest.name}, expected ${name}`);
    if (validated.manifest.version !== version) throw new Error(`manifest version mismatch: got ${validated.manifest.version}, expected ${version}`);
  } finally {
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
  // Write to installPath/packages/<name>/<version>/
  const versionDir = path.join(installPath, 'packages', name, version);
  await fsp.rm(versionDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(versionDir, 'migrations'), { recursive: true });
  await fsp.writeFile(path.join(versionDir, 'manifest.json'), JSON.stringify(parsed.manifest, null, 2));
  await fsp.writeFile(path.join(versionDir, 'collector.js'), parsed.collectorJs);
  for (const m of parsed.migrations) {
    await fsp.writeFile(path.join(versionDir, 'migrations', m.filename), m.content);
  }
  // Create or refresh the junction link
  const linkPath = path.join(installPath, 'packages', name, 'current');
  createJunction(linkPath, versionDir);
  if (logger) logger.info({ name, version }, 'package pulled and installed');
  return parsed;
}
