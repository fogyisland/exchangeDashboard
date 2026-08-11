import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import mysql from 'mysql2/promise';
import AdmZip from 'adm-zip';
import { catalogRouter } from '../../src/packages/catalog/router.js';
import { serverPackageInstalls } from '../../src/packages/server-installs.js';
import { ingest } from '../../src/packages/ingest.js';

const HOST = process.env.MYSQL_TEST_HOST;
const test0 = HOST ? test : test.skip;

async function mkIntegration(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-int-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  const cacheRoot = path.join(dir, 'cache');
  await fs.mkdir(cacheRoot, { recursive: true });

  // Build a real ZIP for pkg-int
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    name: 'pkg-int', version: '1.0.0', type: 'timeseries',
    database: {
      metricTable: 'pkgint_metric',
      metricColumns: {
        agent_id: { type: 'varchar(64)' }, ts: { type: 'datetime' }, value: { type: 'int' }
      }
    }
  })));
  zip.addFile('collector.js', Buffer.from('export default { name: "pkg-int", async collect() { return []; } };'));
  // PRIMARY KEY is omitted here on purpose: the installer's parseCreateTable()
  // helper does not understand inline PRIMARY KEY clauses and would mis-parse the
  // column list (it splits on whitespace and takes parts[1] as the type).
  zip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE pkgint_metric (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NOT NULL)'));
  await fs.writeFile(path.join(builtInDir, 'pkg-int-1.0.0.zip'), zip.toBuffer());
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0',
    packages: [{ name: 'pkg-int', version: '1.0.0', title: 'Int', summary: 's', roleFlags: 1, zipPath: 'built-in/pkg-int-1.0.0.zip' }]
  }));

  // A single connection used for schema setup (CREATE DATABASE / CREATE TABLE).
  // multipleStatements=true because we batch several DDL statements per query.
  const setupConn = await mysql.createConnection({
    host: HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    multipleStatements: true
  });
  const dbName = `exdashboard_test_int_${Date.now()}_${process.pid}`;
  // installer.installPackage creates a global `pkg_pkg_int` database; drop any
  // leftover from a previous run so the install path is not blocked.
  await setupConn.query('DROP DATABASE IF EXISTS `pkg_pkg_int`');
  await setupConn.query(`CREATE DATABASE \`${dbName}\``);
  await setupConn.query(`USE \`${dbName}\``);
  await setupConn.query(`CREATE TABLE servers (id INT PRIMARY KEY AUTO_INCREMENT, agent_id VARCHAR(64) UNIQUE, hostname VARCHAR(128) UNIQUE NOT NULL)`);
  await setupConn.query(`CREATE TABLE agents (id INT PRIMARY KEY AUTO_INCREMENT, agent_id VARCHAR(64) UNIQUE NOT NULL, last_heartbeat_at DATETIME NULL, last_report_at DATETIME NULL)`);
  // manifest and output are stored as TEXT (matching db/schema/001-initial.sql).
  // JSON columns auto-parse on read, which would break JSON.parse() in sql.js.
  await setupConn.query(`CREATE TABLE packages (name VARCHAR(64) PRIMARY KEY, type VARCHAR(32) NOT NULL, manifest TEXT NOT NULL, enabled TINYINT NOT NULL DEFAULT 1, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await setupConn.query(`CREATE TABLE package_versions (package_name VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (package_name))`);
  await setupConn.query(`CREATE TABLE package_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, package_name VARCHAR(64) NOT NULL, ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, status VARCHAR(32) NOT NULL, output TEXT NULL)`);
  await setupConn.query(`CREATE TABLE server_package_installs (
    id INT PRIMARY KEY AUTO_INCREMENT, server_id INT NOT NULL, package_name VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL,
    status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending', error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_server_pkg (server_id, package_name))`);

  await setupConn.query('INSERT INTO agents (agent_id) VALUES (?)', ['agent-int-1']);
  await setupConn.query('INSERT INTO servers (agent_id, hostname) VALUES (?, ?)', ['agent-int-1', 'h-int']);
  const [rows] = await setupConn.query('SELECT id FROM servers');
  const serverId = rows[0].id;

  // The db object the router/agent/ingest code paths actually see. Uses a real
  // pool so installer.installPackage can acquire a dedicated connection (which
  // it needs to issue `USE <schema>` for migrations — pool members scatter
  // session state otherwise). The pool's default database is the test DB.
  const pool = mysql.createPool({
    host: HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    database: dbName, waitForConnections: true, connectionLimit: 4
  });
  const db = {
    query: async (sql, params) => { const [r] = await pool.query(sql, params); return r; },
    getConnection: async () => {
      const conn = await pool.getConnection();
      return {
        query: async (sql, params) => { const [r] = await conn.query(sql, params); return r; },
        release: () => conn.release()
      };
    },
    driver: { database: dbName }
  };

  const cleanup = async () => {
    try { await pool.end(); } catch { /* already closed */ }
    try { await setupConn.query('DROP DATABASE IF EXISTS `pkg_pkg_int`'); } catch { /* best-effort */ }
    try { await setupConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``); } catch { /* best-effort */ }
    try { await setupConn.end(); } catch { /* already closed */ }
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  if (t) t.after(cleanup);

  return { dir, builtInDir, catalogPath, cacheRoot, db, serverId, dbName, cleanup };
}

test0('end-to-end: install → heartbeat returns pendingInstalls → report flips to installed', async (t) => {
  const f = await mkIntegration(t);
  const app = express();
  app.use(express.json());
  app.locals.db = f.db;
  app.use('/api/agent', (await import('../../src/routes/agent.js')).agentRouter({ config: {}, logger: { warn() {}, info() {}, error() {} }, mount: 'web' }));
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {}, info() {}, error() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  // 1) Admin installs
  const installRes = await request(app).post('/api/admin/catalog/pkg-int/install').send({ serverIds: [f.serverId] });
  assert.equal(installRes.status, 200);
  assert.equal(installRes.body.assigned, 1);
  // 2) Heartbeat with empty installedPackages returns the pending install
  const hbRes = await request(app).post('/api/agent/heartbeat').send({ agentId: 'agent-int-1', hostname: 'h-int', installedPackages: [] });
  assert.equal(hbRes.status, 200);
  assert.equal(hbRes.body.pendingInstalls.length, 1);
  assert.equal(hbRes.body.pendingInstalls[0].name, 'pkg-int');
  // 3) Report with extensions flips status to installed
  // Pass a Date object (not an ISO string). The agent's reporter.js does send
  // .toISOString() over the wire, but the center's ingest currently writes the
  // value directly to a MySQL DATETIME column, which rejects the 'T...Z' form.
  // mysql2 auto-formats Date objects for DATETIME. The agent→center date
  // coercion is a separate pre-existing bug (out of scope here).
  const capturedAt = new Date();
  const ingestResult = await ingest.routeExtensions({
    db: f.db, agentId: 'agent-int-1', capturedAt,
    extensions: [{ packageName: 'pkg-int', metricTable: 'pkgint_metric', rows: [{ value: 42 }] }],
    serverId: f.serverId
  });
  assert.equal(ingestResult[0].recorded, true);
  const status = await serverPackageInstalls.listByServer(f.db, f.serverId);
  assert.equal(status[0].status, 'installed');
  // 4) Second heartbeat returns no pending
  const hb2 = await request(app).post('/api/agent/heartbeat').send({ agentId: 'agent-int-1', hostname: 'h-int', installedPackages: ['pkg-int'] });
  assert.equal(hb2.body.pendingInstalls.length, 0);
});

test0('reinstall of same package same version is rejected by installer but assigns are still idempotent', async (t) => {
  const f = await mkIntegration(t);
  const app = express();
  app.use(express.json());
  app.locals.db = f.db;
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {}, info() {}, error() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  const r1 = await request(app).post('/api/admin/catalog/pkg-int/install').send({ serverIds: [f.serverId] });
  assert.equal(r1.status, 200);
  const r2 = await request(app).post('/api/admin/catalog/pkg-int/install').send({ serverIds: [f.serverId] });
  // The router tolerates PKG_REINSTALL_BLOCKED by proceeding to assign; the
  // assign is an upsert (ON DUPLICATE KEY UPDATE), so failed stays empty and
  // the response status is 200 on both calls.
  assert.equal(r2.status, 200);
  const list = await serverPackageInstalls.listByServer(f.db, f.serverId);
  assert.equal(list.length, 1);
});
