import express from 'express';

export function dashboardRouter({ db }) {
  const r = express.Router();
  r.get('/overview', async (_req, res) => {
    const [serverCount, dagCount, mdbCount, queuesNow, recentMdbErrors] = await Promise.all([
      db.query('SELECT COUNT(*) AS n FROM servers WHERE enabled = 1'),
      db.query('SELECT COUNT(*) AS n FROM dags'),
      db.query('SELECT COUNT(*) AS n FROM mdb_catalog'),
      db.query(`SELECT queue_kind, SUM(message_count) AS total FROM (
                  SELECT qs.queue_kind, qs.message_count
                  FROM queue_snapshots qs
                  JOIN (SELECT server_id, queue_kind, MAX(captured_at) AS max_at
                        FROM queue_snapshots GROUP BY server_id, queue_kind) latest
                  ON qs.server_id = latest.server_id AND qs.queue_kind = latest.queue_kind AND qs.captured_at = latest.max_at
                ) t GROUP BY queue_kind`),
      db.query(`SELECT COUNT(*) AS n FROM mdb_copy_snapshots WHERE mount_status <> 1 AND captured_at > (NOW() - INTERVAL 1 HOUR)`)
    ]);
    res.json({
      serverCount: serverCount[0]?.n || 0,
      dagCount: dagCount[0]?.n || 0,
      mdbCount: mdbCount[0]?.n || 0,
      queuesNow,
      recentMdbErrors: recentMdbErrors[0]?.n || 0
    });
  });

  r.get('/metrics/summary', async (req, res) => {
    const { packageName } = req.query;
    // Stub: in v1 the package-driven summary comes from package_runner. For
    // bare topology this returns the latest queue snapshot per server/kind.
    const rows = await db.query(
      `SELECT qs.server_id, qs.queue_kind, qs.message_count, qs.captured_at, qs.messages_per_sec
       FROM queue_snapshots qs
       JOIN (SELECT server_id, queue_kind, MAX(captured_at) AS max_at FROM queue_snapshots GROUP BY server_id, queue_kind) latest
       ON qs.server_id = latest.server_id AND qs.queue_kind = latest.queue_kind AND qs.captured_at = latest.max_at`
    );
    res.json({ packageName: packageName || null, rows });
  });

  r.get('/metrics/timeseries', async (req, res) => {
    const { metricId, from, to, agentId } = req.query;
    if (!metricId || !from || !to) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'metricId/from/to required' } });
    }
    const [kind, serverIdStr] = metricId.split('.');
    const serverId = Number(serverIdStr);
    const params = [serverId, kind, from, to];
    let sql = `SELECT captured_at AS ts, message_count AS value
               FROM queue_snapshots
               WHERE server_id = ? AND queue_kind = ? AND captured_at BETWEEN ? AND ?`;
    if (agentId) { sql += ' AND agent_id = ?'; params.push(agentId); }
    sql += ' ORDER BY captured_at ASC';
    const rows = await db.query(sql, params);
    res.json({ points: rows });
  });

  return r;
}
