import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { agentRouter } from '../../src/routes/agent.js';

function makeApp(db) {
  const app = express();
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.use('/api/agent', agentRouter({ config: { heartbeatPort: 8081, reportPort: 8082 }, logger: app.locals.logger, mount: 'web' }));
  return app;
}

test('POST /api/agent/heartbeat requires agentId', async () => {
  const db = { async query() {} };
  const r = await supertest(makeApp(db)).post('/api/agent/heartbeat').send({});
  assert.equal(r.status, 400);
});

test('POST /api/agent/heartbeat OK with agentId', async () => {
  let called = false;
  const db = { async query() { called = true; } };
  const r = await supertest(makeApp(db)).post('/api/agent/heartbeat').send({ agentId: 'a1', hostname: 'h1' });
  assert.equal(r.status, 200);
  assert.equal(called, true);
});

test('POST /api/agent/discover upserts both agents and servers', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); } };
  const r = await supertest(makeApp(db)).post('/api/agent/discover').send({ agentId: 'a1', hostname: 'h1', fqdn: 'h1.local', osVersion: 'Win2022', exchangeVersion: '15.2', serverRole: 7, dagId: 1 });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);
});

test('POST /api/agent/discover rejects missing hostname', async () => {
  const db = { async query() {} };
  const r = await supertest(makeApp(db)).post('/api/agent/discover').send({ agentId: 'a1' });
  assert.equal(r.status, 400);
});
