import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSql } from '../../src/packages/ddl-sandbox.js';

test('scanSql returns ok for CREATE TABLE', () => {
  const sql = `CREATE TABLE foo (id INT PRIMARY KEY, name VARCHAR(64))`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql returns ok for ALTER TABLE ADD COLUMN', () => {
  const sql = `ALTER TABLE foo ADD COLUMN extra VARCHAR(64)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql returns ok for CREATE INDEX', () => {
  const sql = `CREATE INDEX idx_foo ON foo(name)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql returns ok for ON UPDATE CASCADE and ON DELETE CASCADE', () => {
  const sql = `CREATE TABLE foo (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES bar(id) ON UPDATE CASCADE ON DELETE CASCADE)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql blocks DROP', () => {
  const sql = `DROP TABLE foo`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /DROP/i);
});

test('scanSql blocks INSERT INTO', () => {
  const sql = `INSERT INTO foo VALUES (1)`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /INSERT/i);
});

test('scanSql blocks UPDATE table SET (DML)', () => {
  const sql = `UPDATE foo SET name = 'x' WHERE id = 1`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /UPDATE/i);
});

test('scanSql does NOT block ON UPDATE CASCADE', () => {
  // Regression: old regex `/\bUPDATE\s+[a-z_]/i` incorrectly blocked this.
  const sql = `CREATE TABLE foo (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES bar(id) ON UPDATE CASCADE)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql blocks DELETE FROM', () => {
  const sql = `DELETE FROM foo WHERE id = 1`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /DELETE/i);
});

test('scanSql blocks MERGE', () => {
  const sql = `MERGE INTO foo USING bar ON foo.id = bar.id`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /MERGE/i);
});

test('scanSql blocks SELECT (everywhere, including inside CREATE VIEW)', () => {
  const sql = `CREATE VIEW v_foo AS SELECT id FROM foo`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /SELECT/i);
});

test('scanSql blocks multi-statement', () => {
  const sql = `CREATE TABLE a (id INT); DROP TABLE b`;
  const r = scanSql(sql);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /;/);
});

test('scanSql blocks TRUNCATE / GRANT / REVOKE / EXEC / CALL / RENAME', () => {
  for (const kw of ['TRUNCATE TABLE x', 'GRANT SELECT ON x TO y', 'REVOKE SELECT ON x FROM y', 'EXEC sp_foo', 'EXECUTE sp_foo', 'CALL sp_foo', 'RENAME TABLE x TO y']) {
    const r = scanSql(kw);
    assert.equal(r.ok, false, `should block: ${kw}`);
  }
});

test('scanSql blocks cross-schema references to reserved tables', () => {
  const r = scanSql(`CREATE TABLE foo (id INT, user_id INT, FOREIGN KEY (user_id) REFERENCES users(id))`);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /users/);
});

test('scanSql blocks every reserved-table reference (parametrized)', () => {
  const reserved = [
    'packages', 'package_runs', 'package_versions', 'users', 'agents',
    'servers', 'dags', 'dag_members', 'mdb_catalog', 'queue_snapshots',
    'mdb_copy_snapshots', 'service_states', 'client_access_snapshots',
    'server_resources', 'mailflow_summaries', 'mailflow_errors',
    'dag_replication_matrix', 'heartbeat_events', 'audit_log',
    'system_config', 'roles', 'user_roles', 'schema_migrations'
  ];
  for (const tbl of reserved) {
    const sql = `CREATE TABLE foo (id INT, ref INT, FOREIGN KEY (ref) REFERENCES ${tbl}(id))`;
    const r = scanSql(sql);
    assert.equal(r.ok, false, `should block reference to ${tbl}`);
  }
});

test('scanSql blocks cross-package references (pkg_*.table)', () => {
  const r = scanSql(`CREATE TABLE foo AS SELECT id FROM pkg_other.metrics`);
  assert.equal(r.ok, false);
  assert.match(r.blocked, /pkg_/);
});

test('scanSql strips -- line comments before scanning', () => {
  const sql = `-- DROP TABLE evil\nCREATE TABLE foo (id INT)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql strips /* */ block comments before scanning', () => {
  const sql = `/* DROP TABLE evil */ CREATE TABLE foo (id INT)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql strips string literals before scanning (no false DROP trigger)', () => {
  // Regression: 'drop me' inside a string must not trigger DROP block.
  const sql = `CREATE TABLE foo (id INT, label VARCHAR(64) DEFAULT 'drop me')`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql strips double-quoted identifiers before scanning', () => {
  const sql = `CREATE TABLE "drop" (id INT)`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql returns blocked: non-string input for non-string', () => {
  assert.deepEqual(scanSql(null), { ok: false, blocked: 'non-string input' });
  assert.deepEqual(scanSql(42), { ok: false, blocked: 'non-string input' });
});

test('scanSql allows CREATE TABLE with CHECK constraints and DEFAULT values', () => {
  const sql = `CREATE TABLE foo (id INT PRIMARY KEY, status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')))`;
  assert.deepEqual(scanSql(sql), { ok: true });
});

test('scanSql allows CREATE TABLE with COMMENT ON columns', () => {
  const sql = `CREATE TABLE foo (id INT PRIMARY KEY COMMENT 'primary key', name VARCHAR(64))`;
  assert.deepEqual(scanSql(sql), { ok: true });
});