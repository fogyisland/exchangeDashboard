import express from 'express';

export function clientAccessRouter({ db }) {
  const r = express.Router();
  r.get('/summary', async (_req, res) => {
    const rows = await db.query(
      `SELECT server_id, metric, value, captured_at
       FROM client_access_snapshots
       WHERE captured_at = (SELECT MAX(captured_at) FROM client_access_snapshots)
       ORDER BY server_id, metric`
    );
    res.json({ rows });
  });
  r.get('/per-server', async (_req, res) => {
    const rows = await db.query(
      `SELECT server_id, metric, AVG(value) AS avg_value, MAX(value) AS max_value, MIN(captured_at) AS first, MAX(captured_at) AS last
       FROM client_access_snapshots
       WHERE captured_at > (NOW() - INTERVAL 1 HOUR)
       GROUP BY server_id, metric
       ORDER BY server_id, metric`
    );
    res.json({ rows });
  });
  r.get('/latency', async (_req, res) => {
    const rows = await db.query(
      `SELECT server_id, AVG(value) AS avg_ms
       FROM client_access_snapshots
       WHERE metric = 'RpcClientAccess.AverageLatency' AND captured_at > (NOW() - INTERVAL 5 MINUTE)
       GROUP BY server_id
       ORDER BY avg_ms DESC`
    );
    res.json({ rows });
  });
  return r;
}
