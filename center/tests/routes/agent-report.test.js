import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { agentRouter } from '../../src/routes/agent.js';

function setup() {
  const writes = [];
  const db = { async query(sql, params) { writes.push({ sql, params }); return [{ id: 7 }]; } };
  const app = express();
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.use('/api/agent', agentRouter({ config: { heartbeatPort: 8081, reportPort: 8082 }, logger: app.locals.logger, mount: 'report' }));
  return { app, writes };
}

test('POST /api/agent/report ingests queues, dag copies, services, clientAccess, resources', async () => {
  const { app, writes } = setup();
  const r = await supertest(app).post('/api/agent/report').send({
    agentId: 'a1', hostname: 'ex01', capturedAt: '2026-08-09T00:00:00Z',
    queues: [{ queue_kind: 'Poison', queue_name: 'Poison', message_count: 3 }],
    dag: { copies: [{ db_id: 'db-1', copy_queue_length: 10, mount_status: 1 }] },
    services: [{ service_name: 'MSExchangeTransport', state: 'Running', start_mode: 'Auto' }],
    clientAccess: [{ metric: 'RpcClientAccess.AverageLatency', value: 12 }],
    resources: { cpu_pct: 50, memory_available_mb: 4096 }
  });
  assert.equal(r.status, 202);
  // Expect at least: server lookup, queue insert, dag insert, services insert, clientAccess insert, resources insert
  const tables = writes.map((w) => w.sql).join('\n');
  assert.match(tables, /INSERT INTO queue_snapshots/);
  assert.match(tables, /INSERT INTO mdb_copy_snapshots/);
  assert.match(tables, /INSERT INTO service_states/);
  assert.match(tables, /INSERT INTO client_access_snapshots/);
  assert.match(tables, /INSERT INTO server_resources/);
});
