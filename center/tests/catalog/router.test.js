import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import mysql from 'mysql2/promise';
import { catalogRouter } from '../../src/packages/catalog/router.js';

const HOST = process.env.MYSQL_TEST_HOST;
const test0 = HOST ? test : test.skip;

async function mkFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-rt-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  const cacheRoot = path.join(dir, 'cache');
  await fs.mkdir(cacheRoot, { recursive: true });
  // Fake ZIP (must be at least 22 bytes to pass AdmZip)
  const fakeZip = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  await fs.writeFile(path.join(builtInDir, 'pkg-x-1.0.0.zip'), fakeZip);
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0',
    packages: [{ name: 'pkg-x', version: '1.0.0', title: 'X', summary: 's', roleFlags: 1, zipPath: 'built-in/pkg-x-1.0.0.zip' }]
  }));

  // Spin up a separate MySQL DB for this test
  const conn = await mysql.createConnection({
    host: HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    multipleStatements: true
  });
  const dbName = `exdashboard_test_cat_${Date.now()}`;
  // installer.installPackage creates a global `pkg_pkg_x` database; drop any
  // leftover from a previous run so the install path is not blocked.
  await conn.query('DROP DATABASE IF EXISTS `pkg_pkg_x`');
  await conn.query(`CREATE DATABASE \`${dbName}\``);
  await conn.query(`USE \`${dbName}\``);
  await conn.query(`CREATE TABLE servers (id INT PRIMARY KEY AUTO_INCREMENT, hostname VARCHAR(128) UNIQUE NOT NULL)`);
  await conn.query(`CREATE TABLE packages (name VARCHAR(64) PRIMARY KEY, type VARCHAR(32) NOT NULL, manifest JSON NOT NULL, enabled TINYINT NOT NULL DEFAULT 1, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await conn.query(`CREATE TABLE package_versions (package_name VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (package_name))`);
  await conn.query(`CREATE TABLE package_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, package_name VARCHAR(64) NOT NULL, ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, status VARCHAR(32) NOT NULL, output JSON NULL)`);
  await conn.query(`CREATE TABLE server_package_installs (
    id INT PRIMARY KEY AUTO_INCREMENT, server_id INT NOT NULL, package_name VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL,
    status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending', error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_server_pkg (server_id, package_name))`);

  // Insert one server
  await conn.query('INSERT INTO servers (hostname) VALUES (?)', ['h1']);
  const [[srv]] = await conn.query('SELECT id FROM servers');
  // Build a fake ZIP that AdmZip can actually parse - we need a real minimal zip
  // Use AdmZip to create a valid one
  const AdmZip = (await import('adm-zip')).default;
  const realZip = new AdmZip();
  realZip.addFile('manifest.json', Buffer.from(JSON.stringify({
    name: 'pkg-x', version: '1.0.0', type: 'timeseries',
    database: {
      metricTable: 'pkgx_metric',
      metricColumns: {
        agent_id: { type: 'varchar(64)' }, ts: { type: 'datetime' }, value: { type: 'int' }
      }
    }
  })));
  realZip.addFile('collector.js', Buffer.from('export default { name: "pkg-x", async collect() { return []; } };'));
  realZip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE pkgx_metric (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NOT NULL)'));
  const realZipPath = path.join(builtInDir, 'pkg-x-1.0.0.zip');
  await fs.writeFile(realZipPath, realZip.toBuffer());

  const db = {
    query: async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    }
  };

  return { dir, builtInDir, catalogPath, cacheRoot, db, dbName, serverId: srv.id, conn, app: null };
}

async function cleanup(f) {
  await f.conn.query(`DROP DATABASE IF EXISTS \`${f.dbName}\``);
  await f.conn.query('DROP DATABASE IF EXISTS `pkg_pkg_x`');
  await f.conn.end();
}

test0('GET /api/admin/catalog returns the built-in list', async () => {
  const f = await mkFixture();
  const app = express();
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  const res = await request(app).get('/api/admin/catalog/');
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'built-in');
  assert.equal(res.body.packages.length, 1);
  assert.equal(res.body.packages[0].name, 'pkg-x');
  await cleanup(f);
});

test0('POST /api/admin/catalog/:name/install assigns pending rows for the servers', async () => {
  const f = await mkFixture();
  const app = express();
  app.use(express.json());
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {}, info() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  const res = await request(app).post('/api/admin/catalog/pkg-x/install').send({ serverIds: [f.serverId] });
  assert.equal(res.status, 200);
  assert.equal(res.body.assigned, 1);
  // Verify schema was created
  const [tables] = await f.conn.query('SHOW TABLES');
  const tableNames = tables.map((row) => String(Object.values(row)[0]));
  assert.ok(tableNames.includes('pkgx_metric'), 'expected pkgx_metric table in test DB');
  await cleanup(f);
});

test0('GET /api/admin/catalog/:name/zip streams the ZIP', async () => {
  const f = await mkFixture();
  const app = express();
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  // superagent has no parser for application/zip — ask for a raw Buffer body.
  const res = await request(app).get('/api/admin/catalog/pkg-x/zip').responseType('blob');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.ok(res.body.length > 100, 'expected non-trivial zip body');
  await cleanup(f);
});
