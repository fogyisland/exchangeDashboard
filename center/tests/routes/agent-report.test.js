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

test('POST /api/agent/report resolves serverId and calls ingest.routeExtensions (no legacy INSERTs)', async () => {
  const { app, writes } = setup();
  const r = await supertest(app).post('/api/agent/report').send({
    agentId: 'a1', hostname: 'ex01', capturedAt: '2026-08-09T00:00:00Z',
    extensions: []
  });
  assert.equal(r.status, 202);
  // Should NOT touch the legacy 5 snapshot tables
  const tables = writes.map((w) => w.sql).join('\n');
  assert.doesNotMatch(tables, /INSERT INTO queue_snapshots/);
  assert.doesNotMatch(tables, /INSERT INTO mdb_copy_snapshots/);
  assert.doesNotMatch(tables, /INSERT INTO service_states/);
  assert.doesNotMatch(tables, /INSERT INTO client_access_snapshots/);
  assert.doesNotMatch(tables, /INSERT INTO server_resources/);
  // Should still touch servers and last_report_at
  assert.match(tables, /SELECT id FROM servers/);
  assert.match(tables, /UPDATE agents SET last_report_at/);
  // Returns ingest result
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.ingest));
});
