import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import AdmZip from 'adm-zip';
import path from 'node:path';
import { packagesRouter } from '../../src/packages/router.js';
import { PkgError } from '../../src/packages/errors.js';
import { parseZip } from '../../src/packages/storage.js';

function makeManifest(overrides = {}) {
  return JSON.stringify({
    name: 'router-demo',
    version: '1.0.0',
    type: 'timeseries',
    database: {
      metricTable: 'router_metrics',
      metricColumns: {
        agent_id: { type: 'varchar(64)', nullable: false },
        ts: { type: 'datetime', nullable: false },
        value: { type: 'int', nullable: true }
      }
    },
    ...overrides
  });
}

function makeZip() {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(makeManifest()));
  z.addFile('collector.js', Buffer.from('export default { name: "router-demo", async collect() { return { rows: [] }; } }'));
  z.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE router_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NULL)'));
  return z.toBuffer();
}

function setup({ dbOverrides = {} } = {}) {
  const calls = { installPackage: [], uninstallPackage: [], routeExtensions: [], query: [] };
  const db = {
    query: async (sql, params) => { calls.query.push({ sql, params }); return dbOverrides.query?.(sql, params) ?? []; },
    execute: async (sql, params) => { calls.query.push({ sql, params }); return { rows: [] }; }
  };
  const fakeInstaller = {
    installPackage: async (args) => {
      calls.installPackage.push(args);
      // Mimic real installer: parseZip throws PkgError(PKG_INVALID_ZIP) on bad buffer.
      parseZip(args.zipBuffer);
      return { name: args.zipBuffer ? 'router-demo' : '?', version: '1.0.0' };
    },
    uninstallPackage: async (args) => { calls.uninstallPackage.push(args); return { ok: true }; }
  };
  const fakeIngest = {
    routeExtensions: async (args) => { calls.routeExtensions.push(args); return []; }
  };
  const fakeSql = {
    installedPackages: {
      get: async (d, name) => dbOverrides.get?.(name) ?? null,
      list: async () => dbOverrides.list ?? [],
      upsert: async () => {},
      delete: async () => {}
    },
    packageRuns: { record: async () => {} },
    packageVersions: { upsert: async () => {}, delete: async () => {} }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/packages', packagesRouter({ db, requireAuth: (req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; next(); }, config: { packages: { cacheDir: '/tmp/x' } }, _deps: { installer: fakeInstaller, ingest: fakeIngest, sql: fakeSql } }));
  return { app, calls, db };
}

test('POST /install accepts a ZIP, calls installer, returns {ok, name, version}', async () => {
  const { app, calls } = setup();
  const buf = makeZip();
  const r = await supertest(app).post('/api/admin/packages/install').attach('file', buf, 'demo.zip');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.name, 'router-demo');
  assert.equal(calls.installPackage.length, 1);
  assert.ok(Buffer.isBuffer(calls.installPackage[0].zipBuffer));
});

test('POST /install returns 400 PKG_INVALID_ZIP for non-zip upload', async () => {
  const { app } = setup();
  const r = await supertest(app).post('/api/admin/packages/install').attach('file', Buffer.from('not a zip'), 'demo.zip');
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'PKG_INVALID_ZIP');
});

test('GET / returns list of installed packages', async () => {
  const { app } = setup({ dbOverrides: { list: [{ name: 'a', type: 'timeseries', manifest: {}, enabled: 1, installedAt: new Date() }] } });
  const r = await supertest(app).get('/api/admin/packages');
  assert.equal(r.status, 200);
  assert.equal(r.body.packages.length, 1);
});

test('DELETE /:name without confirmDropSchema returns 400 PKG_CONFIRM_REQUIRED', async () => {
  const { app } = setup();
  const r = await supertest(app).delete('/api/admin/packages/router-demo');
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'PKG_CONFIRM_REQUIRED');
});

test('DELETE /:name?confirmDropSchema=true calls uninstallPackage', async () => {
  const { app, calls } = setup();
  const r = await supertest(app).delete('/api/admin/packages/router-demo?confirmDropSchema=true');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(calls.uninstallPackage.length, 1);
  assert.equal(calls.uninstallPackage[0].name, 'router-demo');
  assert.equal(calls.uninstallPackage[0].confirmDropSchema, true);
});

test('POST /:name/enable and /:name/disable flip the enabled flag', async () => {
  const updates = [];
  const { app } = setup({ dbOverrides: { query: (sql, params) => { updates.push({ sql, params }); return []; } } });
  const a = await supertest(app).post('/api/admin/packages/router-demo/enable');
  const b = await supertest(app).post('/api/admin/packages/router-demo/disable');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.ok(updates.some((u) => /UPDATE packages SET enabled = 1/.test(u.sql)));
  assert.ok(updates.some((u) => /UPDATE packages SET enabled = 0/.test(u.sql)));
});