import express from 'express';
import multer from 'multer';
import { PkgError } from './errors.js';
import * as installerMod from './installer.js';
import * as ingestMod from './ingest.js';
import * as sqlMod from './sql.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function packagesRouter({ db, requireAuth, config, _deps = {} } = {}) {
  const installer = _deps.installer || installerMod.installer;
  const ingest = _deps.ingest || ingestMod.ingest;
  const sql = _deps.sql || sqlMod;
  const cacheRoot = config?.packages?.cacheDir || './data/packages';
  const dbKind = config?.db?.dbKind || 'mysql';

  const r = express.Router();

  r.post('/install', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: { code: 'PKG_INVALID_ZIP', message: 'file field is required' } });
    try {
      const result = await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: req.file.buffer, logger: req.log || console });
      res.json({ ok: true, name: result.name, version: result.version });
    } catch (e) {
      if (e instanceof PkgError) return res.status(e.httpStatus).json({ error: { code: e.code, message: e.message, details: e.details } });
      return res.status(500).json({ error: { code: 'PKG_INSTALL_FAILED', message: e.message } });
    }
  });

  r.get('/', requireAuth, async (_req, res) => {
    const packages = await sql.installedPackages.list(db);
    res.json({ packages });
  });

  r.get('/:name', requireAuth, async (req, res) => {
    const pkg = await sql.installedPackages.get(db, req.params.name);
    if (!pkg) return res.status(404).json({ error: { code: 'PKG_NOT_FOUND', message: `package ${req.params.name} not installed` } });
    res.json(pkg);
  });

  r.delete('/:name', requireAuth, async (req, res) => {
    if (req.query.confirmDropSchema !== 'true') {
      return res.status(400).json({ error: { code: 'PKG_CONFIRM_REQUIRED', message: 'uninstall requires confirmDropSchema=true' } });
    }
    try {
      const result = await installer.uninstallPackage({ db, dbKind, cacheRoot, name: req.params.name, confirmDropSchema: true, logger: req.log || console });
      res.json(result);
    } catch (e) {
      if (e instanceof PkgError) return res.status(e.httpStatus).json({ error: { code: e.code, message: e.message, details: e.details } });
      return res.status(500).json({ error: { code: 'PKG_UNINSTALL_FAILED', message: e.message } });
    }
  });

  r.post('/:name/enable', requireAuth, async (req, res) => {
    await db.query('UPDATE packages SET enabled = 1 WHERE name = ?', [req.params.name]);
    res.json({ ok: true, enabled: 1 });
  });

  r.post('/:name/disable', requireAuth, async (req, res) => {
    await db.query('UPDATE packages SET enabled = 0 WHERE name = ?', [req.params.name]);
    res.json({ ok: true, enabled: 0 });
  });

  return r;
}