import express from 'express';
import { checkNeedsInit } from '../init/needs-init.js';

export function healthzRouter({ configPath } = {}) {
  const r = express.Router();
  r.get('/healthz', (_req, res) => {
    const needsInit = configPath ? checkNeedsInit({ configPath }) : false;
    res.json({ ok: true, needsInit });
  });
  return r;
}
