import express from 'express';
import { userAuth } from '../auth/user-auth.js';

export function authRouter({ db, jwtSecret, expiresInSeconds }) {
  const r = express.Router();
  const u = userAuth({ db, jwtSecret, expiresInSeconds });

  r.use(express.json());

  r.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const out = await u.login({ username, password });
    if (!out.ok) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid credentials' } });
    res.json(out);
  });

  r.post('/logout', (_req, res) => res.json({ ok: true }));

  r.get('/me', u.requireAuth, (req, res) => res.json({ user: req.user }));

  return r;
}
