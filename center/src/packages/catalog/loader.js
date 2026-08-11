import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const NAME_RE = /^[a-z][a-z0-9-]{2,40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z0-9]+)?$/;

function defaultFetcher(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function readBuiltIn(catalogJsonPath, builtInDir, logger) {
  try {
    const raw = await fs.readFile(catalogJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = (parsed.packages || []).filter((e) => e && e.name && e.version && e.zipPath);
    const verified = [];
    for (const e of entries) {
      const zipFullPath = path.join(builtInDir, '..', e.zipPath);
      try {
        await fs.access(zipFullPath);
        verified.push({ ...e, name: e.name, version: e.version, title: e.title || e.name, summary: e.summary || '', roleFlags: e.roleFlags || 0, zipPath: e.zipPath });
      } catch {
        if (logger) logger.warn({ pkg: e.name, zipPath: e.zipPath }, 'built-in catalog entry zipPath not found; skipping');
      }
    }
    return verified;
  } catch (e) {
    if (logger) logger.warn({ err: e.message }, 'built-in catalog read failed');
    return [];
  }
}

async function readRemote(url, builtInDir, fetcher, logger) {
  try {
    const text = await fetcher(url);
    const parsed = JSON.parse(text);
    const entries = (parsed.packages || []).filter((e) => e && e.name && e.version && e.zipPath);
    const verified = [];
    for (const e of entries) {
      if (!NAME_RE.test(e.name) || !VERSION_RE.test(e.version)) {
        if (logger) logger.warn({ pkg: e.name }, 'remote catalog entry has invalid name/version; skipping');
        continue;
      }
      const zipFullPath = path.join(builtInDir, '..', e.zipPath);
      try {
        await fs.access(zipFullPath);
        verified.push({ ...e, name: e.name, version: e.version, title: e.title || e.name, summary: e.summary || '', roleFlags: e.roleFlags || 0, zipPath: e.zipPath });
      } catch {
        if (logger) logger.warn({ pkg: e.name, zipPath: e.zipPath }, 'remote catalog entry zipPath not in built-in/; skipping');
      }
    }
    return verified;
  } catch (e) {
    if (logger) logger.warn({ err: e.message }, 'remote catalog fetch failed; falling back to built-in');
    return null; // signal fallback
  }
}

export async function loadCatalog({ config, builtInDir, catalogJsonPath, fetcher, logger }) {
  const f = fetcher || defaultFetcher;
  const builtIn = await readBuiltIn(catalogJsonPath, builtInDir, logger);
  if (!config?.packageCatalogUrl) {
    return builtIn.length > 0 ? { source: 'built-in', packages: builtIn } : { source: 'none', packages: [] };
  }
  const remote = await readRemote(config.packageCatalogUrl, builtInDir, f, logger);
  if (remote === null) {
    // fetch failed; fall back
    return builtIn.length > 0 ? { source: 'built-in', packages: builtIn } : { source: 'none', packages: [] };
  }
  if (remote.length === 0) {
    return builtIn.length > 0 ? { source: 'built-in', packages: builtIn } : { source: 'none', packages: [] };
  }
  // remote overrides built-in by name
  const map = new Map(builtIn.map((e) => [e.name, e]));
  for (const e of remote) map.set(e.name, e);
  return { source: 'remote', packages: [...map.values()] };
}