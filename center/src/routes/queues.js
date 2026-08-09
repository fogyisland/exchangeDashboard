import express from 'express';
import * as mailflow from '../services/mailflow.js';

export function queuesRouter({ db }) {
  const r = express.Router();
  r.get('/current', async (req, res) => {
    const serverId = req.query.serverId ? Number(req.query.serverId) : undefined;
    res.json({ queues: await mailflow.getCurrentQueues(db, { serverId }) });
  });
  r.get('/history', async (req, res) => {
    const { serverId, queueKind, from, to } = req.query;
    res.json({ points: await mailflow.getQueueHistory(db, { serverId: Number(serverId), queueKind, from, to }) });
  });
  r.get('/by-server/:id', async (req, res) => {
    res.json({ queues: await mailflow.getCurrentQueues(db, { serverId: Number(req.params.id) }) });
  });
  r.get('/stuck', async (_req, res) => {
    res.json({ rows: await mailflow.getStuckMessages(db) });
  });
  return r;
}
