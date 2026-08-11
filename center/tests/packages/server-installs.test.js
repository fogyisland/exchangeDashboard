import { test } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { serverPackageInstalls } from '../../src/packages/server-installs.js';

const HOST = process.env.MYSQL_TEST_HOST;
const test0 = HOST ? test : test.skip;

async function mkDb() {
  const conn = await mysql.createConnection({
    host: HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || 'root',
    password: process.env.MYSQL_TEST_PASSWORD || '',
    multipleStatements: true
  });
  await conn.query('CREATE DATABASE IF NOT EXISTS exdashboard_test_spi');
  await conn.query('USE exdashboard_test_spi');
  await conn.query(`DROP TABLE IF EXISTS servers`);
  await conn.query(`DROP TABLE IF EXISTS server_package_installs`);
  await conn.query(`CREATE TABLE servers (
    id INT PRIMARY KEY AUTO_INCREMENT, hostname VARCHAR(128) UNIQUE NOT NULL
  )`);
  await conn.query(`CREATE TABLE server_package_installs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    package_name VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending',
    error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_server_pkg (server_id, package_name),
    KEY idx_status (status, server_id)
  )`);
  return conn;
}

test0('assign + pendingFor + markInstalled', async () => {
  const db = await mkDb();
  const [srv] = await db.query('INSERT INTO servers (hostname) VALUES (?)', ['h1']);
  const serverId = srv.insertId;
  const wrapper = { query: (sql, params) => db.query(sql, params).then(([r]) => r) };
  await serverPackageInstalls.assign(wrapper, { serverId, packageName: 'pkg-a', version: '1.0.0' });
  const pending = await serverPackageInstalls.pendingFor(wrapper, serverId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, 'pkg-a');
  assert.equal(pending[0].version, '1.0.0');
  assert.match(pending[0].downloadUrl, /\/api\/admin\/catalog\/pkg-a\/zip/);
  await serverPackageInstalls.markInstalled(wrapper, serverId, 'pkg-a');
  const pending2 = await serverPackageInstalls.pendingFor(wrapper, serverId);
  assert.equal(pending2.length, 0);
  const rows = await serverPackageInstalls.listByServer(wrapper, serverId);
  assert.equal(rows[0].status, 'installed');
  await db.end();
});

test0('assign is idempotent on duplicate (serverId, packageName)', async () => {
  const db = await mkDb();
  const [srv] = await db.query('INSERT INTO servers (hostname) VALUES (?)', ['h2']);
  const serverId = srv.insertId;
  const wrapper = { query: (sql, params) => db.query(sql, params).then(([r]) => r) };
  await serverPackageInstalls.assign(wrapper, { serverId, packageName: 'pkg-b', version: '1.0.0' });
  await serverPackageInstalls.assign(wrapper, { serverId, packageName: 'pkg-b', version: '1.0.0' });
  const rows = await serverPackageInstalls.listByServer(wrapper, serverId);
  assert.equal(rows.length, 1);
  await db.end();
});

test0('markFailed records error message', async () => {
  const db = await mkDb();
  const [srv] = await db.query('INSERT INTO servers (hostname) VALUES (?)', ['h3']);
  const serverId = srv.insertId;
  const wrapper = { query: (sql, params) => db.query(sql, params).then(([r]) => r) };
  await serverPackageInstalls.assign(wrapper, { serverId, packageName: 'pkg-c', version: '1.0.0' });
  await serverPackageInstalls.markFailed(wrapper, serverId, 'pkg-c', 'download timed out');
  const rows = await serverPackageInstalls.listByServer(wrapper, serverId);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].error, 'download timed out');
  await db.end();
});
