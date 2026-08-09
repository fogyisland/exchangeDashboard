import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { PkgError } from './errors.js';

export function parseZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    throw new PkgError('PKG_INVALID_ZIP', `failed to parse ZIP: ${e.message}`);
  }
  const manifestEntry = zip.getEntry('manifest.json');
  const collectorEntry = zip.getEntry('collector.js');
  if (!manifestEntry) throw new PkgError('PKG_INVALID_ZIP', 'manifest.json missing');
  if (!collectorEntry) throw new PkgError('PKG_INVALID_ZIP', 'collector.js missing');
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch (e) {
    throw new PkgError('PKG_INVALID_ZIP', `manifest.json is not valid JSON: ${e.message}`);
  }
  const collectorJs = collectorEntry.getData().toString('utf8');
  const migrationEntries = zip.getEntries().filter((e) => e.entryName.startsWith('migrations/') && e.entryName.endsWith('.sql') && !e.isDirectory);
  if (migrationEntries.length === 0) throw new PkgError('PKG_INVALID_ZIP', 'migrations/ directory is empty');
  const migrations = migrationEntries
    .map((e) => ({ filename: path.basename(e.entryName), content: e.getData().toString('utf8') }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  return { manifest, collectorJs, migrations };
}

function rmIfExists(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

export function createJunction(linkPath, target) {
  rmIfExists(linkPath);
  if (process.platform === 'win32') {
    execSync(`cmd /c mklink /J "${linkPath}" "${target}"`, { stdio: 'pipe' });
  } else {
    fs.symlinkSync(target, linkPath, 'junction');
  }
}

export async function cachePackage({ cacheRoot, name, version, manifest, collectorJs, migrations }) {
  const versionDir = path.join(cacheRoot, name, version);
  const linkPath = path.join(cacheRoot, name, 'current');
  rmIfExists(versionDir);
  await fs.promises.mkdir(versionDir, { recursive: true });
  await fs.promises.writeFile(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.promises.writeFile(path.join(versionDir, 'collector.js'), collectorJs);
  const migDir = path.join(versionDir, 'migrations');
  await fs.promises.mkdir(migDir, { recursive: true });
  for (const m of migrations) {
    await fs.promises.writeFile(path.join(migDir, m.filename), m.content);
  }
  createJunction(linkPath, versionDir);
  return { cachePath: linkPath };
}

export async function removeCache(cacheRoot, name) {
  rmIfExists(path.join(cacheRoot, name));
}