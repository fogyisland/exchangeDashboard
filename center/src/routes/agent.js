import express from 'express';
import { ingest } from '../packages/ingest.js';

export function agentRouter({ config, logger, mount = 'web' }) {
  const r = express.Router();
  r.use(express.json({ limit: mount === 'report' ? '10mb' : '256kb' }));

  if (mount === 'heartbeat' || mount === 'web') {
    r.post('/heartbeat', async (req, res) => {
      const { agentId, hostname, installedPackages = [] } = req.body || {};
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
      // Resolve server_id, look up pending installs
      let pendingInstalls = [];
      try {
        const db = req.app.locals.db;
        let serverRow = await db.query('SELECT id FROM servers WHERE agent_id = ?', [agentId]);
        if (serverRow && serverRow.length > 0) {
          const serverId = serverRow[0].id;
          const { serverPackageInstalls } = await import('../packages/server-installs.js');
          const pending = await serverPackageInstalls.pendingFor(db, serverId);
          // Filter out packages the agent already has (defensive: shouldn't happen because markInstalled flips status, but tolerate drift)
          const installedSet = new Set(installedPackages);
          pendingInstalls = pending.filter((p) => !installedSet.has(p.name));
        }
      } catch (e) {
        logger.warn({ err: e.message }, 'pendingInstalls lookup failed');
      }
      res.json({ ok: true, ts: new Date().toISOString(), pendingInstalls });
    });
  }

  if (mount === 'report' || mount === 'web') {
    r.post('/report', async (req, res) => {
      const { agentId, hostname, capturedAt, extensions = [] } = req.body || {};
      if (!agentId || !hostname) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId + hostname required' } });

      const db = req.app.locals.db;
      try {
        // Resolve server_id
        let serverRow = await db.query('SELECT id FROM servers WHERE agent_id = ?', [agentId]);
        let serverId = serverRow && serverRow[0] ? serverRow[0].id : null;
        if (!serverId) {
          await db.query('INSERT INTO servers (agent_id, hostname) VALUES (?, ?)', [agentId, hostname]);
          serverRow = await db.query('SELECT id FROM servers WHERE agent_id = ?', [agentId]);
          serverId = serverRow[0].id;
        }
        const ingestResult = await ingest.routeExtensions({ db, agentId, capturedAt, extensions, serverId });
        await db.query('UPDATE agents SET last_report_at = NOW() WHERE agent_id = ?', [agentId]);
        res.status(202).json({ ok: true, ingest: ingestResult });
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
