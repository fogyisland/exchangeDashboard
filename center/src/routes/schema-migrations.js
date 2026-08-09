import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../auth/user-auth.js';
import { listApplied, listPending, applyPendingMigrations } from '../services/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../../db/migrations');

export function schemaMigrationsRouter({ db }) {
  const r = express.Router();
  r.get('/', requireAuth, async (_req, res) => {
    const applied = await listApplied(db);
    const pending = await listPending(MIG_DIR, applied);
    res.json({ applied, pending });
  });
  r.post('/apply', requireAuth, async (_req, res) => {
    const n = await applyPendingMigrations(db, MIG_DIR);
    res.json({ applied: n });
  });
  return r;
}