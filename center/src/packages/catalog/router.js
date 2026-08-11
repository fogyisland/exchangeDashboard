import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from './loader.js';
import { installer } from '../installer.js';
import { serverPackageInstalls } from '../server-installs.js';

function readZipBuffer(builtInDir, zipPath) {
  const full = path.join(builtInDir, '..', zipPath);
  return fs.promises.readFile(full);
}

export function catalogRouter({ config, db, dbKind, cacheRoot, builtInDir, catalogJsonPath, logger }) {
  const r = express.Router();
  r.use(express.json());

  r.get('/', async (_req, res) => {
    const cat = await loadCatalog({ config, builtInDir, catalogJsonPath, logger });
    res.json(cat);
  });

  r.get('/installs', async (_req, res) => {
    const rows = await serverPackageInstalls.listAll(db);
    res.json({ installs: rows });
  });

  r.post('/:name/install', async (req, res) => {
    const { name } = req.params;
    const { serverIds } = req.body || {};
    if (!Array.isArray(serverIds) || serverIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'serverIds array required' } });
    }
    const cat = await loadCatalog({ config, builtInDir, catalogJsonPath, logger });
    const entry = cat.packages.find((p) => p.name === name);
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `package ${name} not in catalog` } });

    // Try to install the package on center (creates schema). Idempotent — installer throws PKG_REINSTALL_BLOCKED.
    let zipBuffer;
    try { zipBuffer = await readZipBuffer(builtInDir, entry.zipPath); }
    catch (e) { return res.status(500).json({ error: { code: 'ZIP_READ_FAILED', message: e.message } }); }
    try {
      await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer, logger });
    } catch (e) {
      // If already installed, we still proceed to assign rows. Otherwise return 500.
      if (e.code !== 'PKG_REINSTALL_BLOCKED' && e.code !== 'PKG_DOWNGRADE_NOT_ALLOWED') {
        if (logger && typeof logger.error === 'function') {
          logger.error({ err: e.message, code: e.code }, 'installPackage failed');
        }
        return res.status(500).json({ error: { code: e.code || 'INSTALL_FAILED', message: e.message } });
      }
    }

    const failed = [];
    let assigned = 0;
    for (const serverId of serverIds) {
      try {
        await serverPackageInstalls.assign(db, { serverId, packageName: name, version: entry.version });
        assigned++;
      } catch (e) {
        failed.push({ serverId, error: e.message });
      }
    }
    const status = failed.length === 0 ? 200 : 207;
    res.status(status).json({ assigned, failed });
  });

  r.get('/:name/zip', async (req, res) => {
    const { name } = req.params;
    const cat = await loadCatalog({ config, builtInDir, catalogJsonPath, logger });
    const entry = cat.packages.find((p) => p.name === name);
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `package ${name} not in catalog` } });
    try {
      const buf = await readZipBuffer(builtInDir, entry.zipPath);
      res.set('Content-Type', 'application/zip');
      res.send(buf);
    } catch (e) {
      res.status(500).json({ error: { code: 'ZIP_READ_FAILED', message: e.message } });
    }
  });

  return r;
}
