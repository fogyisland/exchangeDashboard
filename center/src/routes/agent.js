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
      const { agentId, hostname, capturedAt, queues = [], dag = {}, services = [], clientAccess = [], resources = {} } = req.body || {};
      if (!agentId || !hostname) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId + hostname required' } });

      const db = req.app.locals.db;
      try {
        // Resolve server_id
        let serverRow = await db.query('SELECT id FROM servers WHERE hostname = ?', [hostname]);
        let serverId = serverRow && serverRow[0] ? serverRow[0].id : null;
        if (!serverId) {
          await db.query('INSERT INTO servers (agent_id, hostname) VALUES (?, ?)', [agentId, hostname]);
          serverRow = await db.query('SELECT id FROM servers WHERE hostname = ?', [hostname]);
          serverId = serverRow[0].id;
        }

        for (const q of queues) {
          await db.query(
            `INSERT INTO queue_snapshots (agent_id, server_id, captured_at, queue_kind, queue_name, message_count, messages_per_sec, deferred_per_sec)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [agentId, serverId, capturedAt, q.queue_kind, q.queue_name || q.queue_kind, q.message_count || 0, q.messages_per_sec ?? null, q.deferred_per_sec ?? null]
          );
        }
        for (const c of (dag.copies || [])) {
          await db.query(
            `INSERT INTO mdb_copy_snapshots (agent_id, server_id, db_id, captured_at, copy_queue_length, replay_lag_seconds, mount_status, content_index_state, is_active_copy, activation_preference)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [agentId, serverId, c.db_id, capturedAt, c.copy_queue_length || 0, c.replay_lag_seconds ?? null, c.mount_status ?? 0, c.content_index_state ?? null, c.is_active_copy ?? 0, c.activation_preference ?? null]
          );
        }
        for (const s of services) {
          await db.query(
            `INSERT INTO service_states (agent_id, server_id, captured_at, service_name, state, start_mode) VALUES (?, ?, ?, ?, ?, ?)`,
            [agentId, serverId, capturedAt, s.service_name, s.state, s.start_mode]
          );
        }
        for (const m of clientAccess) {
          await db.query(
            `INSERT INTO client_access_snapshots (agent_id, server_id, captured_at, metric, value) VALUES (?, ?, ?, ?, ?)`,
            [agentId, serverId, capturedAt, m.metric, m.value]
          );
        }
        if (resources && (resources.cpu_pct != null || resources.memory_available_mb != null)) {
          await db.query(
            `INSERT INTO server_resources (agent_id, server_id, captured_at, cpu_pct, memory_available_mb, disk_c_free_pct, net_bytes_per_sec) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [agentId, serverId, capturedAt, resources.cpu_pct ?? null, resources.memory_available_mb ?? null, resources.disk_c_free_pct ?? null, resources.net_bytes_per_sec ?? null]
          );
        }
        await db.query('UPDATE agents SET last_report_at = NOW() WHERE agent_id = ?', [agentId]);
        res.status(202).json({ ok: true });
      } catch (e) {
        logger.error({ err: e.message }, 'report ingest failed');
        res.status(500).json({ error: { code: 'DB_ERROR', message: e.message } });
      }
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
