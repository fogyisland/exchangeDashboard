import express from 'express';
import { userAuth } from '../auth/user-auth.js';
import { getOfflineAgents } from '../services/heartbeat-report.js';

export function heartbeatReportRouter({ db, config }) {
  const r = express.Router();
  const u = userAuth({ db, jwtSecret: config?.jwt?.secret || 'dev', expiresInSeconds: 60 });
  r.get('/', u.requireAuth, async (_req, res) => {
    const stale = await getOfflineAgents(db, config.agent.heartbeatStaleSeconds);
    res.json({ stale });
  });
  return r;
}
