import express from 'express';
import * as ss from '../services/server-status.js';

export function serversRouter({ db }) {
  const r = express.Router();
  r.get('/', async (_req, res) => res.json({ servers: await ss.listServers(db) }));
  r.get('/:id', async (req, res) => {
    const s = await ss.getServer(db, Number(req.params.id));
    if (!s) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'server not found' } });
    res.json({ server: s });
  });
  r.get('/:id/health', async (req, res) => {
    res.json(await ss.getServerHealth(db, Number(req.params.id)));
  });
  return r;
}
