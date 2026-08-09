import express from 'express';

export function agentRouter({ config, logger, mount = 'web' }) {
  const r = express.Router();
  r.use(express.json({ limit: mount === 'report' ? '10mb' : '256kb' }));

  if (mount === 'heartbeat' || mount === 'web') {
    r.post('/heartbeat', async (req, res) => {
      const { agentId, hostname } = req.body || {};
      if (!agentId) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId required' } });
      logger.info({ agentId, hostname }, 'heartbeat');
      // Persist + touch last_heartbeat_at on agents/servers
      try {
        await req.app.locals.db.query(
          'UPDATE agents SET last_heartbeat_at = NOW() WHERE agent_id = ?',
          [agentId]
        );
      } catch (e) {
        logger.warn({ err: e.message }, 'heartbeat update failed');
      }
      res.json({ ok: true, ts: new Date().toISOString() });
    });
  }

  if (mount === 'report' || mount === 'web') {
    r.post('/report', async (req, res) => {
      // Full ingestion is implemented in Task 21. v1 stub: 202 Accepted.
      logger.info({ size: JSON.stringify(req.body || {}).length }, 'report received');
      res.status(202).json({ ok: true });
    });

    r.post('/discover', async (req, res) => {
      const { agentId, hostname, fqdn, osVersion, exchangeVersion, serverRole, dagId } = req.body || {};
      if (!agentId || !hostname) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId + hostname required' } });
      }
      try {
        await req.app.locals.db.query(
          `INSERT INTO agents (agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             fqdn = VALUES(fqdn),
             os_version = VALUES(os_version),
             exchange_version = VALUES(exchange_version),
             server_role = VALUES(server_role),
             dag_id = VALUES(dag_id)`,
          [agentId, hostname, fqdn || null, osVersion || null, exchangeVersion || null, Number(serverRole) || 0, dagId || null]
        );
        await req.app.locals.db.query(
          `INSERT INTO servers (agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id)
           SELECT agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id FROM agents WHERE agent_id = ?
           ON DUPLICATE KEY UPDATE
             fqdn = VALUES(fqdn),
             os_version = VALUES(os_version),
             exchange_version = VALUES(exchange_version),
             server_role = VALUES(server_role),
             dag_id = VALUES(dag_id)`,
          [agentId]
        );
        res.json({ ok: true });
      } catch (e) {
        logger.error({ err: e.message }, 'discover failed');
        res.status(500).json({ error: { code: 'DB_ERROR', message: e.message } });
      }
    });
  }

  if (mount === 'web') {
    r.get('/config', (_req, res) => {
      res.json({
        heartbeatPort: config.heartbeatPort,
        reportPort: config.reportPort,
        serverVersion: '0.1.0'
      });
    });
  }

  return r;
}
