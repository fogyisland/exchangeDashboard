import express from 'express';
import * as dags from '../services/dags.js';

export function dagRouter({ db }) {
  const r = express.Router();
  r.get('/list', async (_req, res) => res.json({ dags: await dags.listDags(db) }));
  r.get('/:id/topology', async (req, res) => res.json(await dags.getDagTopology(db, Number(req.params.id))));
  r.get('/:id/databases', async (req, res) => res.json({ databases: await dags.getDagDatabases(db, Number(req.params.id)) }));
  r.get('/:id/databases/:db/copy-status', async (req, res) => res.json({ copies: await dags.getCopyStatus(db, Number(req.params.id), req.params.db) }));
  return r;
}
