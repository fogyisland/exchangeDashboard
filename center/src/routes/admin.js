import express from 'express';
import { userAuth } from '../auth/user-auth.js';
import * as users from '../services/users.js';
import { writeAudit } from '../services/audit.js';
import { getAllConfig, setConfig } from '../services/config.js';
import { probePort } from '../services/ports.js';

export function adminRouter({ db, logger, config }) {
  const r = express.Router();
  const u = userAuth({ db, jwtSecret: config?.jwt?.secret || 'dev', expiresInSeconds: 60 });
  r.use(express.json());

  // Users
  r.get('/users', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    const list = await users.listUsers(db);
    res.json({ users: list.map((x) => ({ id: x.id, username: x.username, role: x.role, enabled: !!x.enabled, created_at: x.created_at })) });
  });
  r.post('/users', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'username + ≥8-char password required' } });
    }
    await users.createUser(db, { username, password, role });
    await writeAudit(db, { userId: req.user.id, action: 'users.create', target: username });
    res.status(201).json({ ok: true });
  });
  r.patch('/users/:id', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'id must be int' } });
    await users.setEnabled(db, id, !!req.body.enabled);
    await writeAudit(db, { userId: req.user.id, action: 'users.update', target: String(id), details: req.body });
    res.json({ ok: true });
  });
  r.delete('/users/:id', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    const id = Number(req.params.id);
    await users.deleteUser(db, id);
    await writeAudit(db, { userId: req.user.id, action: 'users.delete', target: String(id) });
    res.json({ ok: true });
  });

  // Config
  r.get('/config', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    res.json({ config: await getAllConfig(db) });
  });
  r.put('/config/:key', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    await setConfig(db, req.params.key, req.body.value);
    await writeAudit(db, { userId: req.user.id, action: 'config.update', target: req.params.key, details: req.body });
    res.json({ ok: true });
  });

  // Audit
  r.get('/audit', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    const rows = await db.query('SELECT id, ts, user_id, action, target FROM audit_log ORDER BY id DESC LIMIT 200');
    res.json({ rows });
  });

  // Port probe
  r.get('/ports/probe', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    const web = await probePort('localhost', config.listenPort);
    res.json({ web });
  });

  return r;
}
