import express from 'express';
import { checkNeedsInit } from './needs-init.js';
import { testDbConnection } from './db-tester.js';
import { wizardFacade } from './wizard-facade.js';

export function initRouter({ configPath }) {
  const r = express.Router();
  r.use(express.json());

  r.get('/status', (req, res) => {
    res.json({ needsInit: checkNeedsInit({ configPath }) });
  });

  r.post('/test-db', async (req, res) => {
    const { dbKind, db } = req.body || {};
    const out = await testDbConnection(dbKind, db);
    res.json(out);
  });

  r.post('/finalize', async (req, res) => {
    const { dbKind, db, admin, installPath } = req.body || {};
    const out = await wizardFacade({ dbKind, db, admin, installPath, configPath });
    if (!out.ok) {
      return res.status(400).json({ error: { code: 'INIT_FAILED', message: out.error, details: { stage: out.stage } } });
    }
    res.json({ ok: true });
    // Caller is expected to gracefully shut down after finalize.
  });

  return r;
}