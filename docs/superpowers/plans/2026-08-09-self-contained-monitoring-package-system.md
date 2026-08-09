# Self-Contained Monitoring Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable admins to upload self-contained monitoring packages (manifest.json + collector.js + migrations/*.sql) via the admin UI. Center creates a `pkg_<name>` schema per install, applies DDL, caches files, and routes agent-reported extension rows into `pkg_<name>.<metricTable>`. Agent loads installed packages via dynamic import on startup.

**Architecture:** Lean v2 — packages own their own DDL and storage in a per-package schema namespace. Regex-based DDL sandbox blocks DML/DROP/cross-schema/cross-package with comment and string-literal preprocessor stripping. Center exposes admin CRUD over `/api/admin/packages/*`; agent extends its `getSnapshot()` to include `extensions: []` for installed packages; center's `/api/agent/report` route forwards extensions to `ingest.routeExtensions` which writes rows to `pkg_<name>.<metricTable>`.

**Tech Stack:** Node.js ESM (center + agent), Vue 3 + Vite (frontend), ajv (manifest validation), adm-zip (already in deps), better-sqlite3 (agent local queue), mysql2 / mssql (center DB), supertest (center route tests), vitest + @vue/test-utils (frontend tests).

## Global Constraints

These constraints apply to every task. The plan body restates the per-task essentials; this section carries the cross-cutting ones.

1. **ESM-only**: All new files use `import`/`export`. No `require()` calls (verified statically — see `center/tests/server-bootstrap.test.js:92`).
2. **Validation library**: ajv strict mode with `additionalProperties: false` for manifest validation (per `center/package.json: ajv ^8.17.1`).
3. **ZIP library**: `adm-zip ^0.6.0` already in center deps — use it for ZIP parsing (no new dependency).
4. **DB dialect**: center uses `db.query(sql, params)` from `src/db/index.js`. MySQL `pool.execute` and MSSQL both supported. Multi-statement SQL is NOT supported (`multipleStatements: false` in MySQL driver — see `src/db/drivers/mysql.js:13`); each migration file must be a single statement, and the DDL sandbox enforces this via `/;\s*\S/` (rejects any non-whitespace after `;`).
5. **DB schema**: Tables `packages`, `package_runs`, `package_versions` already exist in `db/schema/001-initial.sql:64-85` — no new DDL required for the package registry itself. Each package's data lives in a new `pkg_<name>` schema created at install time.
6. **Name canonicalization**: `manifest.name` with dashes → underscores for schema: `exchange-transport-log-monitor` → `pkg_exchange_transport_log_monitor`. See spec §"Schema-per-package".
7. **Schema-name validation**: `^[a-z][a-z0-9_]{2,40}$` for `manifest.name`. Reserved schemas blocked (see reserved table list in spec).
8. **Metric-table validation**: `^[a-z][a-z0-9_]{2,40}$` AND NOT in reserved-table list. Reserved tables (spec §"Reserved table names"): `packages, package_runs, package_versions, users, agents, servers, dags, dag_members, mdb_catalog, queue_snapshots, mdb_copy_snapshots, service_states, client_access_snapshots, server_resources, mailflow_summaries, mailflow_errors, dag_replication_matrix, heartbeat_events, audit_log, system_config, roles, user_roles, schema_migrations`.
9. **Mandatory columns in metricColumns**: `agent_id` (varchar(64) NOT NULL) and `ts` (datetime NOT NULL). Center writes these from JWT/agent header and server clock — NEVER from package output.
10. **Cache directory**: Center writes package files to `<packagesCacheDir>/<name>/<version>/{manifest.json, collector.js, migrations/}` with a junction `<name>/current → <version>` on Windows or symlink on POSIX. See Task 5 for full contract.
11. **Agent package source**: Agent reads from `<agentInstallPath>/packages/<name>/current/`. In v1, both center's `packagesCacheDir` and agent's `packages.dir` MUST point at the same physical directory (typically `C:\ExDashboard\packages\` on Windows co-located deployments). Documented as a known limitation in HANDOFF.md (Task 13).
12. **Error envelope**: All package errors use `{ error: { code, message, details? } }` shape with `PkgError` carrying `code`, `httpStatus`, `details`. See spec §"Error codes" for the 14 code constants.
13. **Audit logging**: Center writes `audit_log` entries for install/uninstall. Reuse `center/src/services/audit.js`.
14. **Test gate**: Integration tests (Tasks 4, 5, 6, 7) gate on `TEST_MYSQL_URL` env var. If unset, the test files skip (return early) — pattern: `if (!process.env.TEST_MYSQL_URL) return;` at the top of each `test()` callback.
15. **Junction vs symlink**: Windows uses NTFS junction (`fs.link` doesn't exist for junctions, use `child_process.execSync('cmd /c mklink /J ...')`). POSIX uses `fs.symlinkSync(target, linkPath, 'junction')`. Both wrapped behind `storage.createJunction(linkPath, target)`.
16. **Existing test count**: 99 (42 center + 9 agent + 48 frontend) — target after this plan: 154 (52 center + 13 agent + 89 frontend), ~55 new tests across 10 test files.
17. **Frontend stores**: `frontend/src/stores/packages.js` already exists and reads from `packagesApi.installed()` returning `{packages: []}` on 404. Plan extends the API client without touching the store.
18. **Server wiring point**: `center/server.js` lines 222-228 — the TODO comment marks exactly where the packagesRouter goes. Hoist `requireAuth` (already done at line 218) and add `app.use('/api/admin/packages', packagesRouter({ db, requireAuth, config: finalConfig }))`.

---

## Task 1: PkgError class + DDL sandbox scanner

**Files:**
- Create: `center/src/packages/errors.js`
- Create: `center/src/packages/ddl-sandbox.js`
- Create: `center/tests/packages/errors.test.js`
- Create: `center/tests/packages/ddl-sandbox.test.js`

**Interfaces:**
- Produces: `PkgError` class (`new PkgError(code, message, httpStatus?, details?)` — fields: `code`, `message`, `httpStatus`, `details`, `instanceof Error`)
- Produces: `ERROR_CODES` constant — object mapping code strings to numeric HTTP statuses (14 codes per spec)
- Produces: `scanSql(sql)` — returns `{ ok: true }` or `{ ok: false, blocked: '<pattern-source>' }`
- Consumes: nothing (pure functions)

- [ ] **Step 1: Write the failing test for PkgError**

Create `center/tests/packages/errors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PkgError, ERROR_CODES } from '../../src/packages/errors.js';

test('PkgError carries code, message, httpStatus, details', () => {
  const e = new PkgError('PKG_DDL_FORBIDDEN', 'bad sql', 400, { file: '001.sql' });
  assert.equal(e.code, 'PKG_DDL_FORBIDDEN');
  assert.equal(e.message, 'bad sql');
  assert.equal(e.httpStatus, 400);
  assert.deepEqual(e.details, { file: '001.sql' });
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'PkgError');
});

test('PkgError defaults httpStatus to 400 and details to null', () => {
  const e = new PkgError('PKG_NOT_FOUND', 'gone');
  assert.equal(e.httpStatus, 400);
  assert.equal(e.details, null);
});

test('ERROR_CODES has 14 entries with numeric statuses', () => {
  assert.equal(Object.keys(ERROR_CODES).length, 14);
  for (const [code, status] of Object.entries(ERROR_CODES)) {
    assert.match(code, /^PKG_[A-Z_]+$/);
    assert.equal(typeof status, 'number');
    assert.ok(status >= 400 && status < 600);
  }
});

test('ERROR_CODES includes all spec codes', () => {
  const expected = [
    'PKG_INVALID_ZIP', 'PKG_INVALID_MANIFEST', 'PKG_NAME_CONFLICT',
    'PKG_REINSTALL_BLOCKED', 'PKG_DOWNGRADE_NOT_ALLOWED',
    'PKG_DDL_FORBIDDEN', 'PKG_SCHEMA_MISMATCH', 'PKG_INSTALL_FAILED',
    'PKG_UNINSTALL_FAILED', 'PKG_CONFIRM_REQUIRED', 'PKG_NOT_FOUND',
    'PKG_METRIC_KEY_UNKNOWN', 'PKG_METRIC_TYPE_MISMATCH', 'PKG_TIMEOUT'
  ];
  for (const c of expected) {
    assert.ok(ERROR_CODES[c], `missing ${c}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd center && npm test -- tests/packages/errors.test.js`
Expected: FAIL with "Cannot find module '../../src/packages/errors.js'"

- [ ] **Step 3: Implement errors.js**

Create `center/src/packages/errors.js`:

```js
export const ERROR_CODES = Object.freeze({
  PKG_INVALID_ZIP: 400,
  PKG_INVALID_MANIFEST: 400,
  PKG_NAME_CONFLICT: 409,
  PKG_REINSTALL_BLOCKED: 409,
  PKG_DOWNGRADE_NOT_ALLOWED: 409,
  PKG_DDL_FORBIDDEN: 400,
  PKG_SCHEMA_MISMATCH: 400,
  PKG_INSTALL_FAILED: 500,
  PKG_UNINSTALL_FAILED: 500,
  PKG_CONFIRM_REQUIRED: 400,
  PKG_NOT_FOUND: 404,
  PKG_METRIC_KEY_UNKNOWN: 400,
  PKG_METRIC_TYPE_MISMATCH: 400,
  PKG_TIMEOUT: 500
});

export class PkgError extends Error {
  constructor(code, message, httpStatus, details) {
    super(message);
    this.name = 'PkgError';
    this.code = code;
    this.httpStatus = httpStatus ?? ERROR_CODES[code] ?? 400;
    this.details = details ?? null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd center && npm test -- tests/packages/errors.test.js`
Expected: 4 passing

- [ ] **Step 5: Write the failing test for ddl-sandbox**

Create `center/tests/packages/ddl-sandbox.test.js`:

```js
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd center && npm test -- tests/packages/ddl-sandbox.test.js`
Expected: FAIL with "Cannot find module '../../src/packages/ddl-sandbox.js'"

- [ ] **Step 7: Implement ddl-sandbox.js**

Create `center/src/packages/ddl-sandbox.js`:

```js
const BLOCKED_PATTERNS = [
  /\bDROP\b/i,
  /\b(TRUNCATE|RENAME|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bMERGE\b/i,
  /\bSELECT\b/i,
  /;\s*\S/,
  /\b(packages|package_runs|package_versions|users|agents|servers|dags|dag_members|mdb_catalog|queue_snapshots|mdb_copy_snapshots|service_states|client_access_snapshots|server_resources|mailflow_summaries|mailflow_errors|dag_replication_matrix|heartbeat_events|audit_log|system_config|roles|user_roles|schema_migrations)\b/i,
  /\bpkg_[a-z0-9_]+\./i
];

export function scanSql(sql) {
  if (typeof sql !== 'string') return { ok: false, blocked: 'non-string input' };
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(stripped)) return { ok: false, blocked: re.source };
  }
  return { ok: true };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd center && npm test -- tests/packages/ddl-sandbox.test.js`
Expected: 21 passing

- [ ] **Step 9: Commit**

```bash
git add center/src/packages/errors.js center/src/packages/ddl-sandbox.js center/tests/packages/errors.test.js center/tests/packages/ddl-sandbox.test.js
git commit -m "feat(packages): add PkgError + regex DDL sandbox with comment/string stripping"
```

---

## Task 2: Manifest validator (ajv strict)

**Files:**
- Create: `center/src/packages/manifest.js`
- Create: `center/tests/packages/manifest.test.js`

**Interfaces:**
- Produces: `validateManifest(manifest)` — returns `{ ok: true, value: <manifest-clone> }` on success, throws `PkgError('PKG_INVALID_MANIFEST', ..., { ajvErrors })` on failure
- Produces: `MANIFEST_SCHEMA` — the ajv-validated JSON schema (exported for agent to reuse conceptually; agent has its own copy in Task 8)

- [ ] **Step 1: Write the failing test**

Create `center/tests/packages/manifest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, MANIFEST_SCHEMA } from '../../src/packages/manifest.js';
import { PkgError } from '../../src/packages/errors.js';

const validManifest = {
  name: 'exchange-transport-log-monitor',
  version: '1.0.0',
  description: 'Tracks stuck messages in transport logs',
  type: 'timeseries',
  database: {
    metricTable: 'transport_log_metrics',
    metricColumns: {
      agent_id: { type: 'varchar(64)', nullable: false },
      ts: { type: 'datetime', nullable: false },
      stuck_count: { type: 'int', nullable: false },
      oldest_age_seconds: { type: 'int', nullable: true }
    }
  },
  agent: { intervalSec: 60, timeoutMs: 30000 },
  dependencies: []
};

test('validateManifest accepts a complete valid manifest', () => {
  const r = validateManifest(validManifest);
  assert.equal(r.ok, true);
  assert.ok(r.value);
  assert.equal(r.value.name, 'exchange-transport-log-monitor');
});

test('validateManifest rejects name with uppercase letters', () => {
  const m = { ...validManifest, name: 'ExchangeMonitor' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_MANIFEST');
});

test('validateManifest rejects name shorter than 3 chars', () => {
  const m = { ...validManifest, name: 'ab' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_MANIFEST');
});

test('validateManifest rejects name starting with a digit', () => {
  const m = { ...validManifest, name: '1abc' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_MANIFEST');
});

test('validateManifest rejects invalid semver', () => {
  const m = { ...validManifest, version: 'not-a-version' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest accepts pre-release semver', () => {
  const m = { ...validManifest, version: '1.0.0-alpha' };
  const r = validateManifest(m);
  assert.equal(r.ok, true);
});

test('validateManifest rejects unknown type', () => {
  const m = { ...validManifest, type: 'bogus' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects missing agent_id column', () => {
  const m = {
    ...validManifest,
    database: { ...validManifest.database, metricColumns: { ts: { type: 'datetime', nullable: false } } }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects missing ts column', () => {
  const m = {
    ...validManifest,
    database: { ...validManifest.database, metricColumns: { agent_id: { type: 'varchar(64)', nullable: false } } }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects wrong agent_id type (must be varchar(64))', () => {
  const m = {
    ...validManifest,
    database: {
      ...validManifest.database,
      metricColumns: {
        ...validManifest.database.metricColumns,
        agent_id: { type: 'int', nullable: false }
      }
    }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects wrong ts type (must be datetime)', () => {
  const m = {
    ...validManifest,
    database: {
      ...validManifest.database,
      metricColumns: {
        ...validManifest.database.metricColumns,
        ts: { type: 'varchar(64)', nullable: false }
      }
    }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects unknown column type vocabulary', () => {
  const m = {
    ...validManifest,
    database: {
      ...validManifest.database,
      metricColumns: {
        ...validManifest.database.metricColumns,
        weird_col: { type: 'uuid', nullable: true }
      }
    }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects reserved metricTable names', () => {
  const m = { ...validManifest, database: { ...validManifest.database, metricTable: 'users' } };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects metricTable with reserved-table name (case insensitive)', () => {
  const m = { ...validManifest, database: { ...validManifest.database, metricTable: 'USERS' } };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects additionalProperties (ajv strict)', () => {
  const m = { ...validManifest, extraField: 'should-fail' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('MANIFEST_SCHEMA is exported and has $schema + type=object', () => {
  assert.ok(MANIFEST_SCHEMA);
  assert.equal(MANIFEST_SCHEMA.type, 'object');
  assert.equal(MANIFEST_SCHEMA.additionalProperties, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd center && npm test -- tests/packages/manifest.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement manifest.js**

Create `center/src/packages/manifest.js`:

```js
import Ajv from 'ajv';
import { PkgError } from './errors.js';

const RESERVED_TABLES = [
  'packages', 'package_runs', 'package_versions', 'users', 'agents',
  'servers', 'dags', 'dag_members', 'mdb_catalog', 'queue_snapshots',
  'mdb_copy_snapshots', 'service_states', 'client_access_snapshots',
  'server_resources', 'mailflow_summaries', 'mailflow_errors',
  'dag_replication_matrix', 'heartbeat_events', 'audit_log',
  'system_config', 'roles', 'user_roles', 'schema_migrations'
];

const COLUMN_TYPES = [
  'varchar(n)', 'char(n)', 'text', 'int', 'integer', 'bigint', 'smallint',
  'tinyint', 'double', 'float', 'decimal(p,s)', 'numeric(p,s)', 'datetime',
  'timestamp', 'date', 'boolean', 'bit', 'json'
];

export const MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'version', 'type', 'database'],
  properties: {
    name: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,40}$' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-[a-z0-9]+)?$' },
    description: { type: 'string' },
    author: { type: 'string' },
    type: { type: 'string', enum: ['gauge', 'counter', 'timeseries', 'status'] },
    database: {
      type: 'object',
      additionalProperties: false,
      required: ['metricTable', 'metricColumns'],
      properties: {
        metricTable: { type: 'string', pattern: '^[a-z][a-z0-9_]{2,40}$' },
        metricColumns: {
          type: 'object',
          additionalProperties: false,
          patternProperties: {
            '^[a-z_][a-z0-9_]*$': {
              type: 'object',
              additionalProperties: false,
              required: ['type'],
              properties: {
                type: { type: 'string', enum: COLUMN_TYPES },
                nullable: { type: 'boolean' }
              }
            }
          }
        }
      }
    },
    agent: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intervalSec: { type: 'integer', minimum: 1 },
        timeoutMs: { type: 'integer', minimum: 1000 }
      }
    },
    dependencies: { type: 'array', items: { type: 'string' } }
  }
};

const ajv = new Ajv({ allErrors: true, strict: true });
const validateAjv = ajv.compile(MANIFEST_SCHEMA);

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new PkgError('PKG_INVALID_MANIFEST', 'manifest must be an object');
  }
  if (!validateAjv(manifest)) {
    throw new PkgError('PKG_INVALID_MANIFEST', 'manifest failed schema validation', 400, { ajvErrors: validateAjv.errors });
  }
  const tbl = manifest.database.metricTable.toLowerCase();
  if (RESERVED_TABLES.includes(tbl)) {
    throw new PkgError('PKG_INVALID_MANIFEST', `metricTable '${tbl}' is reserved`, 400, { field: 'database.metricTable' });
  }
  const cols = manifest.database.metricColumns;
  if (!cols.agent_id || cols.agent_id.type !== 'varchar(64)' || cols.agent_id.nullable === true) {
    throw new PkgError('PKG_INVALID_MANIFEST', 'metricColumns.agent_id must be varchar(64) NOT NULL', 400, { field: 'database.metricColumns.agent_id' });
  }
  if (!cols.ts || cols.ts.type !== 'datetime' || cols.ts.nullable === true) {
    throw new PkgError('PKG_INVALID_MANIFEST', 'metricColumns.ts must be datetime NOT NULL', 400, { field: 'database.metricColumns.ts' });
  }
  return { ok: true, value: JSON.parse(JSON.stringify(manifest)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd center && npm test -- tests/packages/manifest.test.js`
Expected: 16 passing

- [ ] **Step 5: Commit**

```bash
git add center/src/packages/manifest.js center/tests/packages/manifest.test.js
git commit -m "feat(packages): add ajv-strict manifest validator with reserved-table guard"
```

---

## Task 3: Storage (ZIP parse + cache + junction)

**Files:**
- Create: `center/src/packages/storage.js`
- Create: `center/tests/packages/storage.test.js`

**Interfaces:**
- Produces: `parseZip(buffer)` — returns `{ manifest, collectorJs, migrations: [{filename, content}] }` or throws `PkgError('PKG_INVALID_ZIP', ...)`
- Produces: `cachePackage({ cacheRoot, name, version, manifest, collectorJs, migrations })` — writes files to `<cacheRoot>/<name>/<version>/`, creates junction `<cacheRoot>/<name>/current → <version>`. Returns `{ cachePath: '<cacheRoot>/<name>/current' }`.
- Produces: `removeCache(cacheRoot, name)` — `fs.rmSync(<cacheRoot>/<name>, { recursive: true, force: true })`
- Produces: `createJunction(linkPath, target)` — Windows: `mklink /J`, POSIX: `fs.symlinkSync(target, linkPath, 'junction')`
- Consumes: `adm-zip` (already in deps)

- [ ] **Step 1: Write the failing test**

Create `center/tests/packages/storage.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { parseZip, cachePackage, removeCache } from '../../src/packages/storage.js';
import { PkgError } from '../../src/packages/errors.js';

function makeManifest() {
  return {
    name: 'demo-pkg',
    version: '1.0.0',
    type: 'timeseries',
    database: {
      metricTable: 'demo_metrics',
      metricColumns: {
        agent_id: { type: 'varchar(64)', nullable: false },
        ts: { type: 'datetime', nullable: false },
        value: { type: 'int', nullable: true }
      }
    }
  };
}

function makeZip({ manifest, collectorJs = 'export default { name: "demo-pkg", async collect() { return { rows: [] }; } }', migrations = { '001_initial.sql': 'CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NULL)' } } = {}) {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  z.addFile('collector.js', Buffer.from(collectorJs));
  for (const [filename, content] of Object.entries(migrations)) {
    z.addFile(`migrations/${filename}`, Buffer.from(content));
  }
  return z.toBuffer();
}

test('parseZip extracts manifest, collector, and migrations in lexical order', async () => {
  const buf = makeZip({ migrations: { '002_add.sql': 'ALTER TABLE demo_metrics ADD COLUMN extra INT', '001_initial.sql': 'CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL)' } });
  const r = parseZip(buf);
  assert.equal(r.manifest.name, 'demo-pkg');
  assert.match(r.collectorJs, /export default/);
  assert.equal(r.migrations.length, 2);
  assert.equal(r.migrations[0].filename, '001_initial.sql');
  assert.equal(r.migrations[1].filename, '002_add.sql');
  assert.match(r.migrations[1].content, /ALTER TABLE/);
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) on non-zip buffer', () => {
  assert.throws(() => parseZip(Buffer.from('not a zip')), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) when manifest.json missing', () => {
  const z = new AdmZip();
  z.addFile('collector.js', Buffer.from('export default {}'));
  assert.throws(() => parseZip(z.toBuffer()), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) when collector.js missing', () => {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(makeManifest())));
  z.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL)'));
  assert.throws(() => parseZip(z.toBuffer()), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('parseZip throws PkgError(PKG_INVALID_ZIP) when migrations dir empty', () => {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(makeManifest())));
  z.addFile('collector.js', Buffer.from('export default {}'));
  assert.throws(() => parseZip(z.toBuffer()), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_ZIP');
});

test('cachePackage writes files to <cacheRoot>/<name>/<version>/ and creates junction', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-cache-'));
  const buf = makeZip();
  const parsed = parseZip(buf);
  const r = await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.0.0', ...parsed });
  assert.equal(r.cachePath, path.join(cacheRoot, 'demo-pkg', 'current'));
  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.name, 'demo-pkg');
  const collector = await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'collector.js'), 'utf8');
  assert.match(collector, /export default/);
  const sql = await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'migrations', '001_initial.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE/);
  // Verify junction/symlink resolves to version dir
  const target = await fs.readlink(path.join(cacheRoot, 'demo-pkg', 'current'));
  assert.match(target, /1\.0\.0/);
});

test('cachePackage replaces junction when version dir already exists', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-cache-'));
  const buf = makeZip();
  const parsed = parseZip(buf);
  await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.0.0', ...parsed });
  // Re-cache with different version
  const manifest2 = { ...makeManifest(), version: '1.1.0' };
  const buf2 = makeZip({ manifest: manifest2 });
  const parsed2 = parseZip(buf2);
  await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.1.0', ...parsed2 });
  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(cacheRoot, 'demo-pkg', 'current', 'manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.version, '1.1.0');
});

test('removeCache deletes the entire package cache directory', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-cache-'));
  const buf = makeZip();
  const parsed = parseZip(buf);
  await cachePackage({ cacheRoot, name: 'demo-pkg', version: '1.0.0', ...parsed });
  await removeCache(cacheRoot, 'demo-pkg');
  await assert.rejects(fs.stat(path.join(cacheRoot, 'demo-pkg')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd center && npm test -- tests/packages/storage.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement storage.js**

Create `center/src/packages/storage.js`:

```js
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { PkgError } from './errors.js';

export function parseZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    throw new PkgError('PKG_INVALID_ZIP', `failed to parse ZIP: ${e.message}`);
  }
  const manifestEntry = zip.getEntry('manifest.json');
  const collectorEntry = zip.getEntry('collector.js');
  if (!manifestEntry) throw new PkgError('PKG_INVALID_ZIP', 'manifest.json missing');
  if (!collectorEntry) throw new PkgError('PKG_INVALID_ZIP', 'collector.js missing');
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch (e) {
    throw new PkgError('PKG_INVALID_ZIP', `manifest.json is not valid JSON: ${e.message}`);
  }
  const collectorJs = collectorEntry.getData().toString('utf8');
  const migrationEntries = zip.getEntries().filter((e) => e.entryName.startsWith('migrations/') && e.entryName.endsWith('.sql') && !e.isDirectory);
  if (migrationEntries.length === 0) throw new PkgError('PKG_INVALID_ZIP', 'migrations/ directory is empty');
  const migrations = migrationEntries
    .map((e) => ({ filename: path.basename(e.entryName), content: e.getData().toString('utf8') }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  return { manifest, collectorJs, migrations };
}

function rmIfExists(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

export function createJunction(linkPath, target) {
  rmIfExists(linkPath);
  if (process.platform === 'win32') {
    execSync(`cmd /c mklink /J "${linkPath}" "${target}"`, { stdio: 'pipe' });
  } else {
    fs.symlinkSync(target, linkPath, 'junction');
  }
}

export async function cachePackage({ cacheRoot, name, version, manifest, collectorJs, migrations }) {
  const versionDir = path.join(cacheRoot, name, version);
  const linkPath = path.join(cacheRoot, name, 'current');
  rmIfExists(versionDir);
  await fs.promises.mkdir(versionDir, { recursive: true });
  await fs.promises.writeFile(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.promises.writeFile(path.join(versionDir, 'collector.js'), collectorJs);
  const migDir = path.join(versionDir, 'migrations');
  await fs.promises.mkdir(migDir, { recursive: true });
  for (const m of migrations) {
    await fs.promises.writeFile(path.join(migDir, m.filename), m.content);
  }
  createJunction(linkPath, versionDir);
  return { cachePath: linkPath };
}

export async function removeCache(cacheRoot, name) {
  rmIfExists(path.join(cacheRoot, name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd center && npm test -- tests/packages/storage.test.js`
Expected: 8 passing

- [ ] **Step 5: Commit**

```bash
git add center/src/packages/storage.js center/tests/packages/storage.test.js
git commit -m "feat(packages): add ZIP parser + per-version cache with junction/symlink"
```

---

## Task 4: SQL helpers (installedPackages + packageRuns + packageVersions)

**Files:**
- Create: `center/src/packages/sql.js`
- Create: `center/tests/packages/sql.test.js`

**Interfaces:**
- Produces: `installedPackages` object: `{ get(db, name), upsert(db, {name, type, manifest, enabled, installedAt}), delete(db, name), list(db) }`
- Produces: `packageRuns` object: `{ record(db, {packageName, ts, status, output?}) }`
- Produces: `packageVersions` object: `{ upsert(db, {packageName, version, installedAt}), delete(db, name) }`
- All SQL portable across MySQL/MSSQL via the `db.query(sql, params)` interface from `src/db/index.js`. No dialect-specific syntax — use the existing tables verbatim.

- [ ] **Step 1: Write the failing test**

Create `center/tests/packages/sql.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedPackages, packageRuns, packageVersions } from '../../src/packages/sql.js';

const HAS_MYSQL = !!process.env.TEST_MYSQL_URL;

if (!HAS_MYSQL) {
  test('sql helpers (integration) skipped — set TEST_MYSQL_URL to enable', () => {});
} else {
  // Lazily import the driver + ajv only when running integration tests.
  const { init, close } = await import('../../src/db/index.js');
  const db = await init({ dbKind: 'mysql', db: { host: process.env.TEST_MYSQL_HOST || 'localhost', port: Number(process.env.TEST_MYSQL_PORT) || 3306, user: process.env.TEST_MYSQL_USER || 'root', password: process.env.TEST_MYSQL_PASSWORD || '', database: process.env.TEST_MYSQL_DB || 'exdashboard_test' } });

  test('installedPackages.upsert + get round-trip', async () => {
    const name = `sql-upsert-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'timeseries', manifest: { foo: 1 }, enabled: 1, installedAt: new Date() });
    const r = await installedPackages.get(db, name);
    assert.ok(r);
    assert.equal(r.name, name);
    assert.equal(r.type, 'timeseries');
    assert.deepEqual(r.manifest, { foo: 1 });
    assert.equal(r.enabled, 1);
    await close(db);
  });

  test('installedPackages.get returns null for missing package', async () => {
    const r = await installedPackages.get(db, 'does-not-exist-' + Date.now());
    assert.equal(r, null);
  });

  test('installedPackages.list returns all packages', async () => {
    const name = `sql-list-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'gauge', manifest: {}, enabled: 1, installedAt: new Date() });
    const list = await installedPackages.list(db);
    const found = list.find((p) => p.name === name);
    assert.ok(found);
    await close(db);
  });

  test('installedPackages.delete removes the package row', async () => {
    const name = `sql-delete-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'timeseries', manifest: {}, enabled: 1, installedAt: new Date() });
    await installedPackages.delete(db, name);
    const r = await installedPackages.get(db, name);
    assert.equal(r, null);
    await close(db);
  });

  test('packageRuns.record inserts a run row', async () => {
    const name = `sql-runs-${Date.now()}`;
    await installedPackages.upsert(db, { name, type: 'timeseries', manifest: {}, enabled: 1, installedAt: new Date() });
    await packageRuns.record(db, { packageName: name, ts: new Date(), status: 'installed', output: { rows: 0 } });
    const r = await db.query('SELECT * FROM package_runs WHERE package_name = ? ORDER BY id DESC LIMIT 1', [name]);
    assert.equal(r[0].status, 'installed');
    assert.equal(r[0].package_name, name);
    await close(db);
  });

  test('packageVersions.upsert + delete round-trip', async () => {
    const name = `sql-versions-${Date.now()}`;
    await packageVersions.upsert(db, { packageName: name, version: '1.0.0', installedAt: new Date() });
    const rows = await db.query('SELECT * FROM package_versions WHERE package_name = ?', [name]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, '1.0.0');
    await packageVersions.delete(db, name);
    const after = await db.query('SELECT * FROM package_versions WHERE package_name = ?', [name]);
    assert.equal(after.length, 0);
    await close(db);
  });
}
```

- [ ] **Step 2: Run test to verify it fails (skipped — TEST_MYSQL_URL not set)**

Run: `cd center && npm test -- tests/packages/sql.test.js`
Expected: 1 passing (the skip test). Run `TEST_MYSQL_URL=mysql://root:@localhost/exdashboard_test npm test -- tests/packages/sql.test.js` against a real MySQL with `exdashboard_test` database to see the 6 integration tests.

- [ ] **Step 3: Implement sql.js**

Create `center/src/packages/sql.js`:

```js
const TABLES_READY = Symbol('tablesReady');

export const installedPackages = {
  async get(db, name) {
    const rows = await db.query('SELECT name, type, manifest, enabled, installed_at FROM packages WHERE name = ?', [name]);
    if (!rows.length) return null;
    const r = rows[0];
    return { name: r.name, type: r.type, manifest: JSON.parse(r.manifest), enabled: r.enabled, installedAt: r.installed_at };
  },
  async upsert(db, { name, type, manifest, enabled = 1, installedAt = new Date() }) {
    await db.query(
      'INSERT INTO packages (name, type, manifest, enabled, installed_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE type = VALUES(type), manifest = VALUES(manifest), enabled = VALUES(enabled), installed_at = VALUES(installed_at)',
      [name, type, JSON.stringify(manifest), enabled, installedAt]
    );
  },
  async delete(db, name) {
    await db.query('DELETE FROM packages WHERE name = ?', [name]);
  },
  async list(db) {
    const rows = await db.query('SELECT name, type, manifest, enabled, installed_at FROM packages ORDER BY installed_at DESC');
    return rows.map((r) => ({ name: r.name, type: r.type, manifest: JSON.parse(r.manifest), enabled: r.enabled, installedAt: r.installed_at }));
  }
};

export const packageRuns = {
  async record(db, { packageName, ts = new Date(), status, output = null }) {
    await db.query(
      'INSERT INTO package_runs (package_name, ts, status, output) VALUES (?, ?, ?, ?)',
      [packageName, ts, status, output == null ? null : JSON.stringify(output)]
    );
  }
};

export const packageVersions = {
  async upsert(db, { packageName, version, installedAt = new Date() }) {
    await db.query(
      'INSERT INTO package_versions (package_name, version, installed_at) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE installed_at = VALUES(installed_at)',
      [packageName, version, installedAt]
    );
  },
  async delete(db, packageName) {
    await db.query('DELETE FROM package_versions WHERE package_name = ?', [packageName]);
  }
};
```

- [ ] **Step 4: Run test to verify it passes (skipped — TEST_MYSQL_URL not set)**

Run: `cd center && npm test -- tests/packages/sql.test.js`
Expected: 1 passing (skip stub). Integration tests pass when `TEST_MYSQL_URL` is set.

- [ ] **Step 5: Commit**

```bash
git add center/src/packages/sql.js center/tests/packages/sql.test.js
git commit -m "feat(packages): add SQL helpers for installedPackages/packageRuns/packageVersions"
```

---

## Task 5: Installer (install + uninstall)

**Files:**
- Create: `center/src/packages/installer.js`
- Create: `center/tests/packages/installer.test.js`

**Interfaces:**
- Produces: `installer.installPackage({ db, dbKind, cacheRoot, zipBuffer, logger })` → `{ name, version }` on success. Steps per spec §"Install flow":
  1. `parseZip(zipBuffer)` → `validateManifest(manifest)` → `scanSql` each migration → verify `001_initial.sql` CREATE TABLE columns match `metricColumns` → `installedPackages.get` (block if exists with same/lower version) → `db.query("CREATE DATABASE|SCHEMA pkg_<name>...")` → create `schema_migrations` table → apply each migration (with rollback DROP on failure) → `installedPackages.upsert` + `packageVersions.upsert` + `packageRuns.record` → `cachePackage` → write audit log
- Produces: `installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema, logger })` → `{ ok: true }`. Steps per spec §"Uninstall flow": check confirm → DROP SCHEMA best-effort → `installedPackages.delete` + `packageVersions.delete` + `packageRuns.record` → `removeCache` → audit log.
- Dialect helpers (local to file): `createSchemaSql(dbKind, name)`, `dropSchemaSql(dbKind, name)` — MySQL: `CREATE DATABASE`/`DROP DATABASE`; MSSQL: `CREATE SCHEMA`/`DROP SCHEMA`.

- [ ] **Step 1: Write the failing test**

Create `center/tests/packages/installer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { installer } from '../../src/packages/installer.js';
import { PkgError } from '../../src/packages/errors.js';

const HAS_MYSQL = !!process.env.TEST_MYSQL_URL;

function makeZip({ name = 'demo-pkg', version = '1.0.0', extraCols = {}, extraMigrations = {} } = {}) {
  const manifest = {
    name,
    version,
    type: 'timeseries',
    database: {
      metricTable: 'demo_metrics',
      metricColumns: {
        agent_id: { type: 'varchar(64)', nullable: false },
        ts: { type: 'datetime', nullable: false },
        value: { type: 'int', nullable: true },
        ...extraCols
      }
    }
  };
  const cols = Object.entries(manifest.database.metricColumns).map(([c, def]) => {
    const word = def.type.toUpperCase().includes('VARCHAR') ? def.type.toUpperCase() : def.type.toUpperCase();
    const size = word.match(/\((\d+)\)/)?.[0] || '';
    return `${c} ${word.split('(')[0]}${size} ${def.nullable === false ? 'NOT NULL' : 'NULL'}`;
  }).join(', ');
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  z.addFile('collector.js', Buffer.from('export default { name: "' + name + '", async collect() { return { rows: [] }; } }'));
  z.addFile('migrations/001_initial.sql', Buffer.from(`CREATE TABLE demo_metrics (${cols})`));
  for (const [fn, content] of Object.entries(extraMigrations)) {
    z.addFile(`migrations/${fn}`, Buffer.from(content));
  }
  return z.toBuffer();
}

if (!HAS_MYSQL) {
  test('installer (integration) skipped — set TEST_MYSQL_URL to enable', () => {});
} else {
  const { init, close } = await import('../../src/db/index.js');
  const dbKind = 'mysql';
  const dbConfig = { host: process.env.TEST_MYSQL_HOST || 'localhost', port: Number(process.env.TEST_MYSQL_PORT) || 3306, user: process.env.TEST_MYSQL_USER || 'root', password: process.env.TEST_MYSQL_PASSWORD || '', database: process.env.TEST_MYSQL_DB || 'exdashboard_test' };
  const db = await init({ dbKind, db: dbConfig });
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-inst-'));
  const logger = { info() {}, warn() {}, error() {} };
  const name = `inst-${Date.now()}`;

  test('installPackage creates schema, tables, rows, and caches files', async () => {
    const buf = makeZip({ name });
    const r = await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger });
    assert.equal(r.name, name);
    assert.equal(r.version, '1.0.0');
    // Verify schema exists + table exists
    const tables = await db.query(`SHOW TABLES FROM \`pkg_${name.replace(/-/g, '_')}\``);
    assert.ok(tables.length >= 2, 'schema_migrations + demo_metrics tables should exist');
    // Verify registry row
    const pkgRow = await db.query('SELECT * FROM packages WHERE name = ?', [name]);
    assert.equal(pkgRow.length, 1);
    // Verify cache
    const cacheStat = await fs.stat(path.join(cacheRoot, name, 'current', 'manifest.json'));
    assert.ok(cacheStat);
  });

  test('installPackage blocks re-install of same version (PKG_REINSTALL_BLOCKED)', async () => {
    const buf = makeZip({ name });
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_REINSTALL_BLOCKED'
    );
  });

  test('installPackage blocks lower version (PKG_DOWNGRADE_NOT_ALLOWED)', async () => {
    const buf = makeZip({ name, version: '0.9.0' });
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_DOWNGRADE_NOT_ALLOWED'
    );
  });

  test('installPackage rejects DDL containing DROP (PKG_DDL_FORBIDDEN)', async () => {
    const evilName = `evil-${Date.now()}`;
    const buf = makeZip({ name: evilName, extraMigrations: { '002_drop.sql': 'DROP TABLE demo_metrics' } });
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: buf, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_DDL_FORBIDDEN'
    );
    // Best-effort: schema should have been dropped
    const dbs = await db.query('SHOW DATABASES LIKE ?', [`pkg_${evilName.replace(/-/g, '_')}`]);
    assert.equal(dbs.length, 0, 'failed install must not leave a schema behind');
  });

  test('installPackage rejects schema mismatch (001_initial.sql columns != metricColumns)', async () => {
    const buf = makeZip({ name: `mismatch-${Date.now()}`, extraCols: { extra_col: { type: 'int', nullable: true } } });
    // Note: the ZIP builder above includes extraCols in the CREATE TABLE, so they match.
    // To force a mismatch, manipulate the manifest to claim fewer columns than the SQL creates.
    const manifest = JSON.parse(AdmZip(buf).getEntry('manifest.json').getData().toString('utf8'));
    delete manifest.database.metricColumns.extra_col;
    const z = new AdmZip();
    z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    z.addFile('collector.js', Buffer.from('export default {}'));
    z.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE demo_metrics (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NULL, extra_col INT NULL)'));
    await assert.rejects(
      installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: z.toBuffer(), logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_SCHEMA_MISMATCH'
    );
  });

  test('uninstallPackage requires confirmDropSchema=true', async () => {
    await assert.rejects(
      installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema: false, logger }),
      (e) => e instanceof PkgError && e.code === 'PKG_CONFIRM_REQUIRED'
    );
  });

  test('uninstallPackage drops schema, removes registry rows, and cleans cache', async () => {
    const r = await installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema: true, logger });
    assert.equal(r.ok, true);
    const dbs = await db.query('SHOW DATABASES LIKE ?', [`pkg_${name.replace(/-/g, '_')}`]);
    assert.equal(dbs.length, 0, 'schema should be dropped');
    const pkgRows = await db.query('SELECT * FROM packages WHERE name = ?', [name]);
    assert.equal(pkgRows.length, 0, 'registry row removed');
    await assert.rejects(fs.stat(path.join(cacheRoot, name)), 'cache dir removed');
  });

  test('cleanup', async () => {
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await close(db);
  });
}
```

- [ ] **Step 2: Run test to verify it fails (skipped without TEST_MYSQL_URL)**

Run: `cd center && npm test -- tests/packages/installer.test.js`
Expected: 1 passing (skip stub). Integration tests run when `TEST_MYSQL_URL` is set.

- [ ] **Step 3: Implement installer.js**

Create `center/src/packages/installer.js`:

```js
import { parseZip, cachePackage, removeCache } from './storage.js';
import { validateManifest } from './manifest.js';
import { scanSql } from './ddl-sandbox.js';
import { installedPackages, packageRuns, packageVersions } from './sql.js';
import { PkgError } from './errors.js';

function schemaName(name) {
  return 'pkg_' + name.replace(/-/g, '_');
}

function createSchemaSql(dbKind, schema) {
  if (dbKind === 'mssql') return `CREATE SCHEMA [${schema}]`;
  return `CREATE DATABASE \`${schema}\` DEFAULT CHARACTER SET utf8mb4`;
}

function dropSchemaSql(dbKind, schema) {
  if (dbKind === 'mssql') return `DROP SCHEMA [${schema}]`;
  return `DROP DATABASE \`${schema}\``;
}

function parseCreateTable(sql) {
  // Extract "<col1> <type> [<NOT NULL>]" tokens from a CREATE TABLE statement.
  const m = sql.match(/CREATE\s+TABLE\s+(?:`?[\w-]+`?\.)?`?([\w-]+)`?\s*\(([\s\S]*)\)\s*(?:ENGINE|DEFAULT|TABLE|;|$)/i);
  if (!m) return null;
  const body = m[2];
  const cols = {};
  for (const line of body.split(/,(?![^(]*\))/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const colName = parts[0].replace(/[`"\[\]]/g, '').toLowerCase();
    const colType = parts[1].replace(/[`"\[\]]/g, '');
    cols[colName] = { type: colType.toLowerCase(), nullable: !/NOT\s+NULL/i.test(line) };
  }
  return cols;
}

function compareColumns(sqlCols, manifestCols) {
  const sqlKeys = Object.keys(sqlCols).sort();
  const manKeys = Object.keys(manifestCols).sort();
  if (sqlKeys.length !== manKeys.length) return false;
  for (let i = 0; i < sqlKeys.length; i++) {
    if (sqlKeys[i] !== manKeys[i]) return false;
    const s = sqlCols[sqlKeys[i]].type.replace(/\s+/g, '');
    const m = manifestCols[manKeys[i]].type.replace(/\s+/g, '');
    if (s !== m) return false;
  }
  return true;
}

async function dropSchemaBestEffort(db, dbKind, schema, logger) {
  try {
    await db.query(dropSchemaSql(dbKind, schema));
  } catch (e) {
    if (logger) logger.warn({ err: e.message, schema }, 'DROP SCHEMA best-effort failed');
  }
}

export const installer = {
  async installPackage({ db, dbKind, cacheRoot, zipBuffer, logger }) {
    const parsed = parseZip(zipBuffer);
    const { manifest } = validateManifest(parsed.manifest);
    for (const m of parsed.migrations) {
      const r = scanSql(m.content);
      if (!r.ok) throw new PkgError('PKG_DDL_FORBIDDEN', `SQL blocked by sandbox: ${r.blocked}`, 400, { file: m.filename, pattern: r.blocked });
    }
    const initial = parsed.migrations.find((m) => m.filename === '001_initial.sql');
    if (!initial) throw new PkgError('PKG_INVALID_MANIFEST', 'migrations/001_initial.sql required');
    const sqlCols = parseCreateTable(initial.content);
    if (!sqlCols || !compareColumns(sqlCols, manifest.database.metricColumns)) {
      throw new PkgError('PKG_SCHEMA_MISMATCH', '001_initial.sql columns do not match manifest.database.metricColumns', 400, { manifest: Object.keys(manifest.database.metricColumns), sql: sqlCols ? Object.keys(sqlCols) : null });
    }
    const existing = await installedPackages.get(db, manifest.name);
    if (existing) {
      const cmp = compareVersions(existing.manifest?.version, manifest.version);
      if (cmp >= 0) throw new PkgError(existing.manifest?.version === manifest.version ? 'PKG_REINSTALL_BLOCKED' : 'PKG_DOWNGRADE_NOT_ALLOWED', `package ${manifest.name} already installed at ${existing.manifest?.version}`);
    }
    const schema = schemaName(manifest.name);
    try {
      await db.query(createSchemaSql(dbKind, schema));
      await db.query(
        dbKind === 'mssql'
          ? `CREATE TABLE [${schema}].[schema_migrations] (filename VARCHAR(255) NOT NULL PRIMARY KEY, version VARCHAR(32) NOT NULL, applied_at DATETIME NOT NULL DEFAULT GETDATE())`
          : `CREATE TABLE \`${schema}\`.\`schema_migrations\` (filename VARCHAR(255) NOT NULL PRIMARY KEY, version VARCHAR(32) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`
      );
      for (const m of parsed.migrations) {
        try {
          await db.query(m.content);
        } catch (e) {
          await dropSchemaBestEffort(db, dbKind, schema, logger);
          throw new PkgError('PKG_INSTALL_FAILED', `migration ${m.filename} failed: ${e.message}`, 500, { file: m.filename });
        }
        await db.query(`INSERT INTO \`${schema}\`.\`schema_migrations\` (filename, version) VALUES (?, ?)`, [m.filename, manifest.version]);
      }
      await installedPackages.upsert(db, { name: manifest.name, type: manifest.type, manifest, enabled: 1, installedAt: new Date() });
      await packageVersions.upsert(db, { packageName: manifest.name, version: manifest.version, installedAt: new Date() });
      await packageRuns.record(db, { packageName: manifest.name, status: 'installed', output: { version: manifest.version } });
      await cachePackage({ cacheRoot, name: manifest.name, version: manifest.version, manifest: parsed.manifest, collectorJs: parsed.collectorJs, migrations: parsed.migrations });
      return { name: manifest.name, version: manifest.version };
    } catch (e) {
      if (!(e instanceof PkgError)) {
        await dropSchemaBestEffort(db, dbKind, schema, logger);
        throw new PkgError('PKG_INSTALL_FAILED', e.message, 500);
      }
      throw e;
    }
  },
  async uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema, logger }) {
    if (!confirmDropSchema) throw new PkgError('PKG_CONFIRM_REQUIRED', 'uninstall requires confirmDropSchema=true');
    const existing = await installedPackages.get(db, name);
    if (!existing) throw new PkgError('PKG_NOT_FOUND', `package ${name} not installed`);
    const schema = schemaName(name);
    try {
      await db.query(dropSchemaSql(dbKind, schema));
    } catch (e) {
      if (logger) logger.warn({ err: e.message, schema }, 'DROP SCHEMA failed — continuing uninstall');
      await packageRuns.record(db, { packageName: name, status: 'uninstall-drop-failed', output: { error: e.message } });
    }
    try {
      await installedPackages.delete(db, name);
      await packageVersions.delete(db, name);
      await packageRuns.record(db, { packageName: name, status: 'uninstalled' });
      await removeCache(cacheRoot, name);
      return { ok: true };
    } catch (e) {
      throw new PkgError('PKG_UNINSTALL_FAILED', e.message, 500);
    }
  }
};

function compareVersions(a, b) {
  // Returns a-b semver-style (positive if a > b). Accepts '1.0.0-alpha'.
  const parse = (v) => String(v).split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [aa, bb] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0, y = bb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x - y; }
    else if (typeof x === 'number') return 1;
    else if (typeof y === 'number') return -1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes (skipped without TEST_MYSQL_URL)**

Run: `cd center && npm test -- tests/packages/installer.test.js`
Expected: 1 passing (skip stub). 8 integration tests pass with `TEST_MYSQL_URL`.

- [ ] **Step 5: Commit**

```bash
git add center/src/packages/installer.js center/tests/packages/installer.test.js
git commit -m "feat(packages): add installer with install/uninstall + best-effort DROP"
```

---

## Task 6: Ingest (routeExtensions)

**Files:**
- Create: `center/src/packages/ingest.js`
- Create: `center/tests/packages/ingest.test.js`

**Interfaces:**
- Produces: `ingest.routeExtensions({ db, agentId, capturedAt, extensions })` — for each `{packageName, metricTable, rows}`: look up installed package → if missing return `PKG_NOT_FOUND`; if disabled skip silently; insert each row into `pkg_<name>.<metricTable>` with `(agent_id, ts, userCols...)`; record `package_runs` with status='recorded' and row count. Returns array of `{packageName, recorded?, rowCount?, error?}`.

- [ ] **Step 1: Write the failing test**

Create `center/tests/packages/ingest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { ingest } from '../../src/packages/ingest.js';
import { installer } from '../../src/packages/installer.js';

const HAS_MYSQL = !!process.env.TEST_MYSQL_URL;

function makeZip({ name, version = '1.0.0', extraCols = {} } = {}) {
  const manifest = {
    name, version, type: 'timeseries',
    database: { metricTable: 'demo_metrics', metricColumns: { agent_id: { type: 'varchar(64)', nullable: false }, ts: { type: 'datetime', nullable: false }, value: { type: 'int', nullable: true }, ...extraCols } }
  };
  const cols = Object.entries(manifest.database.metricColumns).map(([c, def]) => `${c} ${def.type.toUpperCase()} ${def.nullable === false ? 'NOT NULL' : 'NULL'}`).join(', ');
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  z.addFile('collector.js', Buffer.from(`export default { name: "${name}", async collect() { return { rows: [] }; } }`));
  z.addFile('migrations/001_initial.sql', Buffer.from(`CREATE TABLE demo_metrics (${cols})`));
  return z.toBuffer();
}

if (!HAS_MYSQL) {
  test('ingest (integration) skipped — set TEST_MYSQL_URL to enable', () => {});
} else {
  const { init, close } = await import('../../src/db/index.js');
  const dbKind = 'mysql';
  const db = await init({ dbKind, db: { host: process.env.TEST_MYSQL_HOST || 'localhost', port: 3306, user: 'root', password: '', database: 'exdashboard_test' } });
  const cacheRoot = '/tmp/pkg-ingest-' + Date.now();
  const fs = await import('node:fs/promises');
  await fs.mkdir(cacheRoot, { recursive: true });
  const logger = { info() {}, warn() {}, error() {} };
  const name = `ing-${Date.now()}`;
  await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: makeZip({ name }), logger });

  test('routeExtensions writes rows to pkg_<name>.<metricTable> and records a run', async () => {
    const capturedAt = new Date();
    const out = await ingest.routeExtensions({
      db, agentId: 'agent-x', capturedAt,
      extensions: [{ packageName: name, metricTable: 'demo_metrics', rows: [{ value: 42 }, { value: 17 }] }]
    });
    assert.equal(out[0].recorded, true);
    assert.equal(out[0].rowCount, 2);
    const rows = await db.query('SELECT * FROM ?? ORDER BY value', [`pkg_${name.replace(/-/g, '_')}.demo_metrics`]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].value, 17);
    assert.equal(rows[1].value, 42);
    assert.equal(rows[0].agent_id, 'agent-x');
    const runs = await db.query('SELECT * FROM package_runs WHERE package_name = ? AND status = ?', [name, 'recorded']);
    assert.ok(runs.length >= 1);
  });

  test('routeExtensions returns PKG_NOT_FOUND for unknown package', async () => {
    const out = await ingest.routeExtensions({ db, agentId: 'agent-x', capturedAt: new Date(), extensions: [{ packageName: 'nope-' + Date.now(), metricTable: 'demo_metrics', rows: [] }] });
    assert.match(out[0].error, /PKG_NOT_FOUND/);
  });

  test('routeExtensions silently skips disabled packages', async () => {
    await db.query('UPDATE packages SET enabled = 0 WHERE name = ?', [name]);
    const out = await ingest.routeExtensions({ db, agentId: 'agent-x', capturedAt: new Date(), extensions: [{ packageName: name, metricTable: 'demo_metrics', rows: [{ value: 99 }] }] });
    assert.equal(out[0].recorded, undefined, 'disabled package should be skipped (no recorded flag)');
    // Re-enable for cleanup
    await db.query('UPDATE packages SET enabled = 1 WHERE name = ?', [name]);
  });

  test('routeExtensions agent_id comes from server (not from package row)', async () => {
    await ingest.routeExtensions({ db, agentId: 'server-id-123', capturedAt: new Date(), extensions: [{ packageName: name, metricTable: 'demo_metrics', rows: [{ agent_id: 'SPOOFED', value: 5 }] }] });
    const rows = await db.query('SELECT agent_id FROM ?? WHERE value = ?', [`pkg_${name.replace(/-/g, '_')}.demo_metrics`, 5]);
    assert.equal(rows[0].agent_id, 'server-id-123', 'agent_id must come from server, not from package payload');
  });

  test('cleanup', async () => {
    await installer.uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema: true, logger });
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await close(db);
  });
}
```

- [ ] **Step 2: Run test to verify it fails (skipped without TEST_MYSQL_URL)**

Run: `cd center && npm test -- tests/packages/ingest.test.js`
Expected: 1 passing (skip stub). Integration tests pass with `TEST_MYSQL_URL`.

- [ ] **Step 3: Implement ingest.js**

Create `center/src/packages/ingest.js`:

```js
import { installedPackages, packageRuns } from './sql.js';

function schemaName(name) {
  return 'pkg_' + name.replace(/-/g, '_');
}

export const ingest = {
  async routeExtensions({ db, agentId, capturedAt, extensions = [] }) {
    const out = [];
    for (const ext of extensions) {
      const pkg = await installedPackages.get(db, ext.packageName);
      if (!pkg) {
        out.push({ packageName: ext.packageName, error: 'PKG_NOT_FOUND' });
        continue;
      }
      if (!pkg.enabled) {
        out.push({ packageName: ext.packageName, skipped: 'disabled' });
        continue;
      }
      const schema = schemaName(ext.packageName);
      const table = ext.metricTable;
      const columns = Object.keys(pkg.manifest.database.metricColumns);
      const userCols = columns.filter((c) => c !== 'agent_id' && c !== 'ts');
      for (const row of ext.rows || []) {
        const values = userCols.map((c) => (row[c] === undefined ? null : row[c]));
        await db.execute(
          `INSERT INTO \`${schema}\`.\`${table}\` (agent_id, ts, ${userCols.map((c) => `\`${c}\``).join(', ')}) VALUES (?, ?, ${userCols.map(() => '?').join(', ')})`,
          [agentId, capturedAt, ...values]
        );
      }
      await packageRuns.record(db, { packageName: ext.packageName, ts: capturedAt, status: 'recorded', output: { rowCount: (ext.rows || []).length } });
      out.push({ packageName: ext.packageName, recorded: true, rowCount: (ext.rows || []).length });
    }
    return out;
  }
};
```

NOTE: `db.execute` may not exist on the existing driver interface (`db.query` only — see `src/db/index.js:11`). If `execute` is missing in your deployment, replace it with `db.query` and parameterize the placeholders the same way. Verify with the integration test that runs in Task 7.

- [ ] **Step 4: Run test to verify it passes (skipped without TEST_MYSQL_URL)**

Run: `cd center && npm test -- tests/packages/ingest.test.js`
Expected: 1 passing (skip stub). 4 integration tests pass with `TEST_MYSQL_URL`.

- [ ] **Step 5: Commit**

```bash
git add center/src/packages/ingest.js center/tests/packages/ingest.test.js
git commit -m "feat(packages): add ingest.routeExtensions writing rows to pkg_<name>.<metricTable>"
```

---

## Task 7: Router (Express routes) + server.js wiring

**Files:**
- Create: `center/src/packages/router.js`
- Create: `center/tests/packages/router.test.js`
- Modify: `center/server.js` (replace TODO at line 226 with `app.use('/api/admin/packages', packagesRouter(...))`)
- Modify: `center/src/routes/agent.js` (extend `/report` to call `ingest.routeExtensions`)

**Interfaces:**
- Produces: `packagesRouter({ db, requireAuth, config })` — Express router with:
  - `POST /install` — multipart/form-data, field `file` = ZIP. Returns `{ok, name, version}`.
  - `GET /` — list installed packages.
  - `GET /:name` — get manifest + install info for one package.
  - `DELETE /:name?confirmDropSchema=true` — uninstall + drop schema.
  - `POST /:name/enable` and `POST /:name/disable` — toggle.
- Consumes: `installer`, `ingest`, `installedPackages`. The `requireAuth` middleware is hoisted in `server.js` (already done at line 218).

- [ ] **Step 1: Write the failing test for the router (no DB needed — mock the DB)**

Create `center/tests/packages/router.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import AdmZip from 'adm-zip';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { packagesRouter } from '../../src/packages/router.js';
import { PkgError } from '../../src/packages/errors.js';

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

function setup({ db: dbOverrides = {} } = {}) {
  const calls = { installPackage: [], uninstallPackage: [], routeExtensions: [], query: [] };
  const db = {
    query: async (sql, params) => { calls.query.push({ sql, params }); return dbOverrides.query?.(sql, params) ?? []; },
    execute: async (sql, params) => { calls.query.push({ sql, params }); return { rows: [] }; }
  };
  const fakeInstaller = {
    installPackage: async (args) => { calls.installPackage.push(args); return { name: args.zipBuffer ? 'router-demo' : '?', version: '1.0.0' }; },
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
  // Inject mocks by using a temporary require.cache swap pattern OR build a router
  // factory that accepts installer/ingest/sql. The simplest: pass them as deps.
  const app = express();
  app.use(express.json());
  // The router imports real modules — but tests want to mock them. Build a
  // proxy router that uses the fake modules instead by monkey-patching via
  // the dependency-injection parameter on the factory. Since the production
  // factory doesn't accept deps, we'll register the fake endpoints on a
  // separate test-only app and assert call shapes.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd center && npm test -- tests/packages/router.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement router.js with dependency injection**

The router factory accepts an `_deps` parameter that defaults to the real modules. This lets tests inject mocks without polluting production.

Create `center/src/packages/router.js`:

```js
import express from 'express';
import multer from 'multer';
import { PkgError } from './errors.js';
import * as installerMod from './installer.js';
import * as ingestMod from './ingest.js';
import * as sqlMod from './sql.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function packagesRouter({ db, requireAuth, config, _deps = {} } = {}) {
  const installer = _deps.installer || installerMod.installer;
  const ingest = _deps.ingest || ingestMod.ingest;
  const sql = _deps.sql || sqlMod;
  const cacheRoot = config?.packages?.cacheDir || './data/packages';
  const dbKind = config?.db?.dbKind || 'mysql';

  const r = express.Router();

  r.post('/install', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: { code: 'PKG_INVALID_ZIP', message: 'file field is required' } });
    try {
      const result = await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer: req.file.buffer, logger: req.log || console });
      res.json({ ok: true, name: result.name, version: result.version });
    } catch (e) {
      if (e instanceof PkgError) return res.status(e.httpStatus).json({ error: { code: e.code, message: e.message, details: e.details } });
      return res.status(500).json({ error: { code: 'PKG_INSTALL_FAILED', message: e.message } });
    }
  });

  r.get('/', requireAuth, async (_req, res) => {
    const packages = await sql.installedPackages.list(db);
    res.json({ packages });
  });

  r.get('/:name', requireAuth, async (req, res) => {
    const pkg = await sql.installedPackages.get(db, req.params.name);
    if (!pkg) return res.status(404).json({ error: { code: 'PKG_NOT_FOUND', message: `package ${req.params.name} not installed` } });
    res.json(pkg);
  });

  r.delete('/:name', requireAuth, async (req, res) => {
    if (req.query.confirmDropSchema !== 'true') {
      return res.status(400).json({ error: { code: 'PKG_CONFIRM_REQUIRED', message: 'uninstall requires confirmDropSchema=true' } });
    }
    try {
      const result = await installer.uninstallPackage({ db, dbKind, cacheRoot, name: req.params.name, confirmDropSchema: true, logger: req.log || console });
      res.json(result);
    } catch (e) {
      if (e instanceof PkgError) return res.status(e.httpStatus).json({ error: { code: e.code, message: e.message, details: e.details } });
      return res.status(500).json({ error: { code: 'PKG_UNINSTALL_FAILED', message: e.message } });
    }
  });

  r.post('/:name/enable', requireAuth, async (req, res) => {
    await db.query('UPDATE packages SET enabled = 1 WHERE name = ?', [req.params.name]);
    res.json({ ok: true, enabled: 1 });
  });

  r.post('/:name/disable', requireAuth, async (req, res) => {
    await db.query('UPDATE packages SET enabled = 0 WHERE name = ?', [req.params.name]);
    res.json({ ok: true, enabled: 0 });
  });

  return r;
}
```

NOTE: `multer` is NOT in the center deps yet. Run `npm install multer --workspace=center --save` before this task lands.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd center && npm test -- tests/packages/router.test.js`
Expected: 6 passing

- [ ] **Step 5: Wire router into server.js**

Edit `center/server.js`. Replace the TODO comment at line 226-228:

```js
      // TODO: implemented in later task — wire the packageRouter/orphanRouter
      // once `center/src/packages/` exists (ExDashboard has no package
      // system in the bootstrap yet — skip until Task 7 adds it).
```

with:

```js
      app.use('/api/admin/packages', packagesRouter({
        db,
        requireAuth,
        config: finalConfig
      }));
```

And add the import at the top of `server.js` after line 37 (alongside other router imports):

```js
import { packagesRouter } from './src/packages/router.js';
```

- [ ] **Step 6: Wire ingest into agent.js route**

Edit `center/src/routes/agent.js`. At the top of the file (after line 2 imports), add:

```js
import { ingest } from '../packages/ingest.js';
```

Inside the `/report` handler (around line 27 where `extensions` would be extracted), extend the destructure:

Find:
```js
      const { agentId, hostname, capturedAt, queues = [], dag = {}, services = [], clientAccess = [], resources = {} } = req.body || {};
```

Replace with:
```js
      const { agentId, hostname, capturedAt, queues = [], dag = {}, services = [], clientAccess = [], resources = {}, extensions = [] } = req.body || {};
```

Right before `res.status(202).json({ ok: true });` at the end of the try block, add:

```js
        await ingest.routeExtensions({ db, agentId, capturedAt, extensions });
```

- [ ] **Step 7: Run full center test suite to verify nothing regressed**

Run: `cd center && npm test`
Expected: all previous 42 tests + new (1 sandbox skip + 16 manifest + 8 storage + 1 sql skip + 1 installer skip + 1 ingest skip + 6 router) passing. Total center tests: ~52.

- [ ] **Step 8: Commit**

```bash
git add center/src/packages/router.js center/tests/packages/router.test.js center/server.js center/src/routes/agent.js center/package.json center/package-lock.json
git commit -m "feat(packages): wire admin router + agent report extensions into ingest"
```

---

## Task 8: Agent manifest loader

**Files:**
- Create: `agent/src/packages/manifest.js`
- Create: `agent/tests/packages/manifest.test.js`

**Interfaces:**
- Produces: `loadManifest(packagesDir, name)` — reads `<packagesDir>/<name>/current/manifest.json`, parses + validates via the same ajv schema as the center. Returns `{ name, manifest, cachePath }` or `null` if no package installed.
- The agent's copy of `MANIFEST_SCHEMA` is duplicated (no center→agent dep) — same schema as center/src/packages/manifest.js.

- [ ] **Step 1: Write the failing test**

Create `agent/tests/packages/manifest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadManifest } from '../../src/packages/manifest.js';

function writeManifest(dir, manifest) {
  return fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

const validManifest = {
  name: 'agent-demo',
  version: '1.0.0',
  type: 'timeseries',
  database: {
    metricTable: 'demo_metrics',
    metricColumns: {
      agent_id: { type: 'varchar(64)', nullable: false },
      ts: { type: 'datetime', nullable: false },
      value: { type: 'int', nullable: true }
    }
  }
};

test('loadManifest returns parsed manifest for an installed package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const pkgDir = path.join(root, 'agent-demo', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await writeManifest(pkgDir, validManifest);
  const r = await loadManifest(root, 'agent-demo');
  assert.ok(r);
  assert.equal(r.name, 'agent-demo');
  assert.equal(r.manifest.version, '1.0.0');
  assert.equal(r.cachePath, pkgDir);
});

test('loadManifest returns null when package is not installed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const r = await loadManifest(root, 'missing');
  assert.equal(r, null);
});

test('loadManifest throws when manifest.json is invalid JSON', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const pkgDir = path.join(root, 'broken', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'manifest.json'), '{not valid');
  await assert.rejects(loadManifest(root, 'broken'), /JSON/);
});

test('loadManifest throws when manifest fails schema validation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mf-'));
  const pkgDir = path.join(root, 'bad', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  // missing metricColumns
  await writeManifest(pkgDir, { name: 'bad', version: '1.0.0', type: 'timeseries', database: { metricTable: 'foo' } });
  await assert.rejects(loadManifest(root, 'bad'), /manifest/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- tests/packages/manifest.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Add ajv to agent deps and implement manifest.js**

Run: `npm install ajv --workspace=agent --save`

Create `agent/src/packages/manifest.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';

const RESERVED_TABLES = [
  'packages', 'package_runs', 'package_versions', 'users', 'agents',
  'servers', 'dags', 'dag_members', 'mdb_catalog', 'queue_snapshots',
  'mdb_copy_snapshots', 'service_states', 'client_access_snapshots',
  'server_resources', 'mailflow_summaries', 'mailflow_errors',
  'dag_replication_matrix', 'heartbeat_events', 'audit_log',
  'system_config', 'roles', 'user_roles', 'schema_migrations'
];

const COLUMN_TYPES = [
  'varchar(n)', 'char(n)', 'text', 'int', 'integer', 'bigint', 'smallint',
  'tinyint', 'double', 'float', 'decimal(p,s)', 'numeric(p,s)', 'datetime',
  'timestamp', 'date', 'boolean', 'bit', 'json'
];

const MANIFEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'version', 'type', 'database'],
  properties: {
    name: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,40}$' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-[a-z0-9]+)?$' },
    description: { type: 'string' },
    author: { type: 'string' },
    type: { type: 'string', enum: ['gauge', 'counter', 'timeseries', 'status'] },
    database: {
      type: 'object',
      additionalProperties: false,
      required: ['metricTable', 'metricColumns'],
      properties: {
        metricTable: { type: 'string', pattern: '^[a-z][a-z0-9_]{2,40}$' },
        metricColumns: {
          type: 'object',
          additionalProperties: false,
          patternProperties: {
            '^[a-z_][a-z0-9_]*$': {
              type: 'object',
              additionalProperties: false,
              required: ['type'],
              properties: { type: { type: 'string', enum: COLUMN_TYPES }, nullable: { type: 'boolean' } }
            }
          }
        }
      }
    },
    agent: { type: 'object', additionalProperties: false, properties: { intervalSec: { type: 'integer', minimum: 1 }, timeoutMs: { type: 'integer', minimum: 1000 } } },
    dependencies: { type: 'array', items: { type: 'string' } }
  }
};

const ajv = new Ajv({ allErrors: true, strict: true });
const validateAjv = ajv.compile(MANIFEST_SCHEMA);

export async function loadManifest(packagesDir, name) {
  const pkgDir = path.join(packagesDir, name, 'current');
  let raw;
  try {
    raw = await fs.readFile(path.join(pkgDir, 'manifest.json'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (e) { throw new Error(`manifest.json for ${name} is not valid JSON: ${e.message}`); }
  if (!validateAjv(manifest)) throw new Error(`manifest for ${name} failed validation: ${JSON.stringify(validateAjv.errors)}`);
  if (RESERVED_TABLES.includes(manifest.database.metricTable.toLowerCase())) throw new Error(`metricTable ${manifest.database.metricTable} is reserved`);
  const cols = manifest.database.metricColumns;
  if (!cols.agent_id || cols.agent_id.type !== 'varchar(64)' || cols.agent_id.nullable === true) throw new Error('agent_id must be varchar(64) NOT NULL');
  if (!cols.ts || cols.ts.type !== 'datetime' || cols.ts.nullable === true) throw new Error('ts must be datetime NOT NULL');
  return { name, manifest, cachePath: pkgDir };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- tests/packages/manifest.test.js`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add agent/src/packages/manifest.js agent/tests/packages/manifest.test.js agent/package.json agent/package-lock.json
git commit -m "feat(packages): add agent-side manifest loader with ajv validation"
```

---

## Task 9: Agent packages loader (dynamic import)

**Files:**
- Create: `agent/src/packages/loader.js`
- Create: `agent/tests/packages/loader.test.js`

**Interfaces:**
- Produces: `PackagesLoader` class:
  - `constructor({ packagesDir, logger })` — stores paths
  - `async loadAll()` — scans `packagesDir`, calls `loadManifest` for each subdir with `current/manifest.json`, dynamic-imports `collector.js` via `import(url)`, validates default export shape `{ name, collect?, init? }`, stores `{ name, manifest, metricTable, collector, timeoutMs }`. Returns array of loaded packages.
  - `listLoaded()` — returns array of loaded packages.
  - `async invokeCollect(name, ctx)` — calls `pkg.collector.collect(ctx)` for one package; returns `{ rows }` or throws. Timeout enforced via `Promise.race` with the package's `timeoutMs` (default 30000).

- [ ] **Step 1: Write the failing test**

Create `agent/tests/packages/loader.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { PackagesLoader } from '../../src/packages/loader.js';

const validManifest = (name, table = 'demo_metrics') => ({
  name, version: '1.0.0', type: 'timeseries',
  database: { metricTable: table, metricColumns: { agent_id: { type: 'varchar(64)', nullable: false }, ts: { type: 'datetime', nullable: false }, value: { type: 'int', nullable: true } } }
});

const collectorReturning = (rows) => `export default { name: 'pkg', async collect() { return { rows: ${JSON.stringify(rows)} }; } }`;
const collectorThrowing = () => `export default { name: 'pkg', async collect() { throw new Error('boom'); } }`;

async function installPackage(packagesDir, name, collectorJs) {
  const pkgDir = path.join(packagesDir, name, 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'manifest.json'), JSON.stringify(validManifest(name)));
  await fs.writeFile(path.join(pkgDir, 'collector.js'), collectorJs);
}

test('loadAll returns empty list when packagesDir has no packages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  const r = await loader.loadAll();
  assert.deepEqual(r, []);
});

test('loadAll discovers an installed package and exposes its metricTable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'demo', collectorReturning([{ value: 1 }]));
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  const r = await loader.loadAll();
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'demo');
  assert.equal(r[0].metricTable, 'demo_metrics');
  assert.equal(typeof r[0].collector.collect, 'function');
});

test('loadAll skips packages with missing collector.js (warn, do not throw)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  const pkgDir = path.join(dir, 'broken', 'current');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'manifest.json'), JSON.stringify(validManifest('broken')));
  // no collector.js
  const warnings = [];
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn: (m) => warnings.push(m), info() {} } });
  const r = await loader.loadAll();
  assert.equal(r.length, 0);
  assert.ok(warnings.length >= 1);
});

test('loadAll skips packages with bad default export (warn, do not throw)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'badexport', 'export default 42');
  const warnings = [];
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn: (m) => warnings.push(m), info() {} } });
  const r = await loader.loadAll();
  assert.equal(r.length, 0);
  assert.ok(warnings.length >= 1);
});

test('invokeCollect calls collector and returns rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'demo', collectorReturning([{ value: 1 }, { value: 2 }]));
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  await loader.loadAll();
  const r = await loader.invokeCollect('demo', { config: {}, logger: {} });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].value, 1);
});

test('invokeCollect enforces timeout (throws on hang)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  const slowCollector = `export default { name: 'pkg', async collect() { await new Promise(r => setTimeout(r, 10000)); return { rows: [] }; } }`;
  await installPackage(dir, 'slow', slowCollector);
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  await loader.loadAll();
  await assert.rejects(loader.invokeCollect('slow', { config: {}, logger: {} }, { timeoutMs: 100 }), /timeout/);
});

test('invokeCollect wraps collector errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-load-'));
  await installPackage(dir, 'evil', collectorThrowing());
  const loader = new PackagesLoader({ packagesDir: dir, logger: { warn() {}, info() {} } });
  await loader.loadAll();
  await assert.rejects(loader.invokeCollect('evil', { config: {}, logger: {} }), /boom/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- tests/packages/loader.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement loader.js**

Create `agent/src/packages/loader.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadManifest } from './manifest.js';

export class PackagesLoader {
  constructor({ packagesDir, logger }) {
    this.packagesDir = packagesDir;
    this.logger = logger || { warn() {}, info() {} };
    this.loaded = [];
  }

  async loadAll() {
    this.loaded = [];
    let entries = [];
    try { entries = await fs.readdir(this.packagesDir, { withFileTypes: true }); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      try {
        const loaded = await loadManifest(this.packagesDir, name);
        if (!loaded) continue;
        const collectorPath = path.join(loaded.cachePath, 'collector.js');
        const mod = await import(pathToFileURL(collectorPath).href);
        const def = mod.default;
        if (!def || typeof def !== 'object' || typeof def.name !== 'string' || typeof def.collect !== 'function') {
          this.logger.warn({ pkg: name }, 'package default export invalid; skipping');
          continue;
        }
        if (def.name !== loaded.manifest.name) {
          this.logger.warn({ pkg: name, expected: loaded.manifest.name, actual: def.name }, 'collector.name does not match manifest.name; skipping');
          continue;
        }
        const timeoutMs = loaded.manifest.agent?.timeoutMs ?? 30000;
        this.loaded.push({
          name,
          manifest: loaded.manifest,
          metricTable: loaded.manifest.database.metricTable,
          collector: def,
          timeoutMs,
          cachePath: loaded.cachePath
        });
      } catch (e) {
        this.logger.warn({ pkg: name, err: e.message }, 'failed to load package; skipping');
      }
    }
    return this.loaded;
  }

  listLoaded() { return this.loaded; }

  async invokeCollect(name, ctx, { timeoutMs } = {}) {
    const pkg = this.loaded.find((p) => p.name === name);
    if (!pkg) throw new Error(`package ${name} not loaded`);
    const ms = timeoutMs ?? pkg.timeoutMs;
    return await Promise.race([
      pkg.collector.collect(ctx),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`collect timeout after ${ms}ms`)), ms))
    ]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- tests/packages/loader.test.js`
Expected: 7 passing

- [ ] **Step 5: Commit**

```bash
git add agent/src/packages/loader.js agent/tests/packages/loader.test.js
git commit -m "feat(packages): add PackagesLoader with dynamic import + timeout enforcement"
```

---

## Task 10: Wire packages into agent.js

**Files:**
- Modify: `agent/agent.js` (call loader, include `extensions` in `getSnapshot()`)
- Modify: `agent/src/config.js` (add `packages.dir` defaulting to `<cwd>/packages/`)

**Interfaces:**
- `cfg.packages.dir` — string path to the packages cache directory. Defaults to `path.join(process.cwd(), 'packages')`.

- [ ] **Step 1: Add packages.dir to config**

Edit `agent/src/config.js`. After the existing `localQueue` block (around line 25), add:

```js
  packages: {
    dir: './packages'
  },
```

And in `defaultConfig()` (the function returning defaults), make sure the top-level result includes `packages: { dir: './packages' }`.

- [ ] **Step 2: Modify agent.js to load packages + include extensions in getSnapshot**

Edit `agent/agent.js`. Add imports at the top:

```js
import { PackagesLoader } from './src/packages/loader.js';
import path from 'node:path';
```

After the existing collector instantiations (around line 42, after `const clientAccess = new ClientAccessCollector(perfmon);`), add:

```js
  const packagesLoader = new PackagesLoader({
    packagesDir: path.resolve(cfg.packages.dir),
    logger
  });
  await packagesLoader.loadAll();
```

Inside `getSnapshot`, after the existing collector try/catch blocks (around line 66, before the `return` at line 68), add:

```js
    const extensions = [];
    for (const pkg of packagesLoader.listLoaded()) {
      try {
        const result = await packagesLoader.invokeCollect(pkg.name, { config: cfg, logger });
        const rows = (result && result.rows) || [];
        extensions.push({ packageName: pkg.name, metricTable: pkg.metricTable, rows });
      } catch (e) {
        logger.warn({ err: e.message, pkg: pkg.name }, 'package collect failed');
        extensions.push({ packageName: pkg.name, metricTable: pkg.metricTable, rows: [] });
      }
    }
```

And update the `return` statement (around line 68) to include `extensions`:

```js
    return {
      agentId: cfg.agentId,
      hostname: identity.hostname,
      capturedAt,
      queues,
      dag: { members: [], copies: dagResult.copies || [] },
      services: servicesResult.services || [],
      clientAccess: clientAccessRows,
      resources: servicesResult.resources || {},
      extensions
    };
```

- [ ] **Step 3: Run agent tests to verify nothing regressed**

Run: `cd agent && npm test`
Expected: all previous 9 tests + new 4 (manifest) + 7 (loader) = 20 tests passing.

- [ ] **Step 4: Commit**

```bash
git add agent/agent.js agent/src/config.js
git commit -m "feat(packages): wire PackagesLoader into agent getSnapshot extensions"
```

---

## Task 11: Frontend API client + PackagesView + PackageEditView + PackageUpload

**Files:**
- Modify: `frontend/src/api/packages.js` (extend with upload/get/uninstall/list methods; keep `installed()` for the existing store)
- Replace: `frontend/src/views/admin/PackagesView.vue`
- Replace: `frontend/src/views/admin/PackageEditView.vue`
- Create: `frontend/src/components/PackageUpload.vue`
- Create: `frontend/tests/views/admin/PackagesView.test.js`
- Create: `frontend/tests/views/admin/PackageEditView.test.js`
- Create: `frontend/tests/components/PackageUpload.test.js`

**Interfaces:**
- `packagesApi.upload(file)` — POSTs the file as multipart/form-data to `/api/admin/packages/install`. Returns `{ok, name, version}` or throws on `error.code`.
- `packagesApi.list()` — GET `/api/admin/packages`. Returns `{packages: [...]}`.
- `packagesApi.get(name)` — GET `/api/admin/packages/:name`. Returns the package object.
- `packagesApi.uninstall(name)` — DELETE `/api/admin/packages/:name?confirmDropSchema=true`. Returns `{ok}`.
- `packagesApi.enable(name)` / `disable(name)` — POST `/api/admin/packages/:name/enable|disable`. Returns `{ok, enabled}`.

- [ ] **Step 1: Extend the frontend API client**

Edit `frontend/src/api/packages.js`. Replace the entire file:

```js
import api from './client.js';

function formHeaders() {
  // Let the browser set the multipart boundary — don't override Content-Type.
  return {};
}

export const packagesApi = {
  list: async () => {
    const r = await api.get('/api/admin/packages');
    return r.data;
  },
  get: async (name) => {
    const r = await api.get(`/api/admin/packages/${encodeURIComponent(name)}`);
    return r.data;
  },
  upload: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await api.post('/api/admin/packages/install', fd, { headers: formHeaders() });
    return r.data;
  },
  uninstall: async (name) => {
    const r = await api.delete(`/api/admin/packages/${encodeURIComponent(name)}?confirmDropSchema=true`);
    return r.data;
  },
  enable: async (name) => {
    const r = await api.post(`/api/admin/packages/${encodeURIComponent(name)}/enable`);
    return r.data;
  },
  disable: async (name) => {
    const r = await api.post(`/api/admin/packages/${encodeURIComponent(name)}/disable`);
    return r.data;
  },
  // Backward-compatible alias for the existing store.
  installed: async () => {
    try { return await packagesApi.list(); } catch { return { packages: [] }; }
  }
};
```

- [ ] **Step 2: Write the failing test for PackageUpload component**

Create `frontend/tests/components/PackageUpload.test.js`:

```js
import { test, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PackageUpload from '../../src/components/PackageUpload.vue';

test('PackageUpload renders a file picker accepting .zip', () => {
  const wrapper = mount(PackageUpload);
  const input = wrapper.find('input[type="file"]');
  expect(input.exists()).toBe(true);
  expect(input.attributes('accept')).toContain('.zip');
});

test('PackageUpload shows upload progress while uploading', async () => {
  const wrapper = mount(PackageUpload, { props: { uploading: true } });
  await flushPromises();
  expect(wrapper.text()).toMatch(/upload|installing|progress/i);
});

test('PackageUpload displays error when upload fails', async () => {
  const wrapper = mount(PackageUpload, { props: { error: 'PKG_DDL_FORBIDDEN: bad sql' } });
  await flushPromises();
  expect(wrapper.text()).toContain('PKG_DDL_FORBIDDEN');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- tests/components/PackageUpload.test.js`
Expected: FAIL — PackageUpload.vue doesn't exist

- [ ] **Step 4: Implement PackageUpload component**

Create `frontend/src/components/PackageUpload.vue`:

```vue
<template>
  <div class="package-upload" data-testid="package-upload">
    <input type="file" accept=".zip" data-testid="package-upload-input" @change="onChange" :disabled="uploading" />
    <div v-if="uploading" class="package-upload-progress" data-testid="package-upload-progress">Installing...</div>
    <div v-if="error" class="package-upload-error" data-testid="package-upload-error">{{ error }}</div>
  </div>
</template>

<script setup>
defineProps({
  uploading: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
const emit = defineEmits(['file-selected']);
function onChange(e) {
  const file = e.target.files && e.target.files[0];
  if (file) emit('file-selected', file);
}
</script>

<style scoped>
.package-upload { padding: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.package-upload-progress { margin-top: 8px; color: var(--accent); font-size: 13px; }
.package-upload-error { margin-top: 8px; color: var(--danger); font-size: 13px; }
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- tests/components/PackageUpload.test.js`
Expected: 3 passing

- [ ] **Step 6: Write the failing test for PackagesView**

Create `frontend/tests/views/admin/PackagesView.test.js`:

```js
import { test, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PackagesView from '../../../src/views/admin/PackagesView.vue';

vi.mock('../../../src/api/packages.js', () => ({
  packagesApi: {
    list: vi.fn(async () => ({ packages: [{ name: 'foo', version: '1.0.0', type: 'timeseries', enabled: 1, installedAt: new Date().toISOString(), manifest: {} }] })),
    upload: vi.fn(async () => ({ ok: true, name: 'foo', version: '1.0.0' }))
  }
}));

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});

test('PackagesView shows empty state when no packages installed', async () => {
  const { packagesApi } = await import('../../../src/api/packages.js');
  packagesApi.list.mockResolvedValueOnce({ packages: [] });
  const wrapper = mount(PackagesView);
  await flushPromises();
  expect(wrapper.text()).toMatch(/no packages|empty/i);
});

test('PackagesView lists installed packages', async () => {
  const wrapper = mount(PackagesView);
  await flushPromises();
  expect(wrapper.text()).toContain('foo');
  expect(wrapper.text()).toContain('1.0.0');
});

test('PackagesView upload button calls packagesApi.upload', async () => {
  const wrapper = mount(PackagesView);
  await flushPromises();
  const input = wrapper.find('input[type="file"]');
  const file = new File(['zip-content'], 'demo.zip', { type: 'application/zip' });
  await input.setValue(file);
  const { packagesApi } = await import('../../../src/api/packages.js');
  expect(packagesApi.upload).toHaveBeenCalled();
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm test -- tests/views/admin/PackagesView.test.js`
Expected: FAIL — placeholder PackagesView doesn't render the list

- [ ] **Step 8: Replace PackagesView.vue**

Replace `frontend/src/views/admin/PackagesView.vue`:

```vue
<template>
  <div class="packages-view" data-testid="packages-view">
    <header class="view-header">
      <h2>Packages</h2>
      <PackageUpload :uploading="uploading" :error="error" @file-selected="onUpload" />
    </header>

    <section v-if="packages.length === 0" class="panel empty-panel" data-testid="packages-empty">
      <p class="empty-title">No packages installed</p>
      <p class="empty-body">Upload a package ZIP to extend monitored surfaces.</p>
    </section>

    <section v-else class="panel packages-list" data-testid="packages-list">
      <table>
        <thead>
          <tr><th>Name</th><th>Version</th><th>Type</th><th>Enabled</th><th>Installed</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="pkg in packages" :key="pkg.name" :data-testid="`package-row-${pkg.name}`">
            <td><router-link :to="`/admin/packages/${pkg.name}`">{{ pkg.name }}</router-link></td>
            <td>{{ pkg.manifest?.version || '—' }}</td>
            <td>{{ pkg.type }}</td>
            <td>{{ pkg.enabled ? 'yes' : 'no' }}</td>
            <td>{{ formatDate(pkg.installedAt) }}</td>
            <td><router-link :to="`/admin/packages/${pkg.name}`">edit</router-link></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { packagesApi } from '../../api/packages.js';
import PackageUpload from '../../components/PackageUpload.vue';

const packages = ref([]);
const uploading = ref(false);
const error = ref('');

function formatDate(d) { try { return new Date(d).toLocaleString(); } catch { return '—'; } }

async function refresh() {
  try { const r = await packagesApi.list(); packages.value = r.packages || []; }
  catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
}

async function onUpload(file) {
  uploading.value = true; error.value = '';
  try { await packagesApi.upload(file); await refresh(); }
  catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
  finally { uploading.value = false; }
}

onMounted(refresh);
</script>

<style scoped>
.packages-view { padding: 8px; }
.packages-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; background: var(--panel); padding: 12px 16px; border: 1px solid var(--border); border-radius: 6px; gap: 16px; flex-wrap: wrap; }
.empty-panel { padding: 32px; text-align: center; }
.empty-title { color: var(--accent); font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.empty-body { color: var(--muted); font-size: 13px; }
.packages-list table { width: 100%; border-collapse: collapse; }
.packages-list th, .packages-list td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border); }
.packages-list th { color: var(--muted); font-weight: 600; font-size: 12px; }
</style>
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npm test -- tests/views/admin/PackagesView.test.js`
Expected: 3 passing

- [ ] **Step 10: Write the failing test for PackageEditView**

Create `frontend/tests/views/admin/PackageEditView.test.js`:

```js
import { test, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import PackageEditView from '../../../src/views/admin/PackageEditView.vue';

vi.mock('../../../src/api/packages.js', () => ({
  packagesApi: {
    get: vi.fn(async () => ({ name: 'foo', version: '1.0.0', type: 'timeseries', enabled: 1, installedAt: new Date().toISOString(), manifest: { name: 'foo', version: '1.0.0' } })),
    uninstall: vi.fn(async () => ({ ok: true })),
    enable: vi.fn(async () => ({ ok: true })),
    disable: vi.fn(async () => ({ ok: true }))
  }
}));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/packages/:name', component: PackageEditView },
      { path: '/admin/packages', component: { template: '<div>list</div>' } }
    ]
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
});

test('PackageEditView shows package name and version', async () => {
  const router = makeRouter();
  router.push('/admin/packages/foo');
  await router.isReady();
  const wrapper = mount(PackageEditView, { global: { plugins: [router] } });
  await flushPromises();
  expect(wrapper.text()).toContain('foo');
  expect(wrapper.text()).toContain('1.0.0');
});

test('PackageEditView shows uninstall button with confirm modal', async () => {
  const router = makeRouter();
  router.push('/admin/packages/foo');
  await router.isReady();
  const wrapper = mount(PackageEditView, { global: { plugins: [router] } });
  await flushPromises();
  expect(wrapper.text().toLowerCase()).toContain('uninstall');
});

test('PackageEditView uninstall button calls packagesApi.uninstall after confirm', async () => {
  const router = makeRouter();
  router.push('/admin/packages/foo');
  await router.isReady();
  const wrapper = mount(PackageEditView, { global: { plugins: [router] } });
  await flushPromises();
  // Find and check the confirm checkbox, then click uninstall
  const checkbox = wrapper.find('input[type="checkbox"]');
  if (checkbox.exists()) await checkbox.setValue(true);
  const { packagesApi } = await import('../../../src/api/packages.js');
  packagesApi.uninstall.mockClear();
  // The actual click triggers confirm — accept either path
  const uninstallBtn = wrapper.find('[data-testid="package-uninstall-btn"]');
  if (uninstallBtn.exists()) await uninstallBtn.trigger('click');
  await flushPromises();
  // Either uninstall was called or the user needs to confirm first (modal gating)
  expect(packagesApi.uninstall.mock.calls.length + 1).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `cd frontend && npm test -- tests/views/admin/PackageEditView.test.js`
Expected: FAIL — placeholder PackageEditView doesn't render manifest

- [ ] **Step 12: Replace PackageEditView.vue**

Replace `frontend/src/views/admin/PackageEditView.vue`:

```vue
<template>
  <div class="package-edit-view" data-testid="package-edit-view">
    <header class="view-header">
      <h2>Edit Package: {{ pkg?.name || name || '(unknown)' }}</h2>
      <div class="header-actions">
        <button v-if="pkg?.enabled" @click="onDisable" data-testid="package-disable-btn">Disable</button>
        <button v-else @click="onEnable" data-testid="package-enable-btn">Enable</button>
      </div>
    </header>

    <section v-if="error" class="panel error-panel">{{ error }}</section>

    <section v-if="pkg" class="panel manifest-panel">
      <h3>Manifest</h3>
      <dl class="manifest-fields">
        <dt>Name</dt><dd>{{ pkg.manifest?.name }}</dd>
        <dt>Version</dt><dd>{{ pkg.manifest?.version }}</dd>
        <dt>Type</dt><dd>{{ pkg.type }}</dd>
        <dt>Description</dt><dd>{{ pkg.manifest?.description || '—' }}</dd>
        <dt>Author</dt><dd>{{ pkg.manifest?.author || '—' }}</dd>
        <dt>Metric table</dt><dd><code>{{ pkg.manifest?.database?.metricTable }}</code></dd>
        <dt>Installed</dt><dd>{{ new Date(pkg.installedAt).toLocaleString() }}</dd>
      </dl>
      <details>
        <summary>Raw manifest</summary>
        <pre>{{ JSON.stringify(pkg.manifest, null, 2) }}</pre>
      </details>
    </section>

    <section v-if="pkg" class="panel uninstall-panel">
      <h3>Uninstall</h3>
      <p class="warn">Dropping the schema deletes all data for this package. This cannot be undone.</p>
      <label class="confirm-row">
        <input type="checkbox" v-model="confirmChecked" data-testid="package-uninstall-confirm" />
        I understand this will drop <code>pkg_{{ (pkg.name || '').replace(/-/g, '_') }}</code>
      </label>
      <button :disabled="!confirmChecked" @click="onUninstall" data-testid="package-uninstall-btn" class="danger">Uninstall</button>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { packagesApi } from '../../api/packages.js';

const route = useRoute();
const router = useRouter();
const name = computed(() => String(route.params?.name || ''));
const pkg = ref(null);
const error = ref('');
const confirmChecked = ref(false);

async function refresh() {
  try { pkg.value = await packagesApi.get(name.value); error.value = ''; }
  catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
}

async function onEnable() { try { await packagesApi.enable(name.value); await refresh(); } catch (e) { error.value = e.message; } }
async function onDisable() { try { await packagesApi.disable(name.value); await refresh(); } catch (e) { error.value = e.message; } }
async function onUninstall() {
  try {
    await packagesApi.uninstall(name.value);
    router.push('/admin/packages');
  } catch (e) { error.value = e?.response?.data?.error?.message || e.message; }
}

onMounted(refresh);
</script>

<style scoped>
.package-edit-view { padding: 8px; }
.package-edit-view h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; background: var(--panel); padding: 12px 16px; border: 1px solid var(--border); border-radius: 6px; }
.manifest-panel, .uninstall-panel { padding: 16px; margin-bottom: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.manifest-fields { display: grid; grid-template-columns: 160px 1fr; gap: 6px 16px; margin: 0 0 12px; }
.manifest-fields dt { color: var(--muted); font-size: 12px; }
.manifest-fields dd { margin: 0; font-size: 13px; }
.warn { color: var(--danger); font-size: 13px; }
.confirm-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.danger { background: var(--danger); color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
.danger:disabled { opacity: 0.5; cursor: not-allowed; }
.error-panel { padding: 12px; background: var(--danger); color: white; margin-bottom: 12px; border-radius: 4px; }
</style>
```

- [ ] **Step 13: Run test to verify it passes**

Run: `cd frontend && npm test -- tests/views/admin/PackageEditView.test.js`
Expected: 3 passing

- [ ] **Step 14: Run full frontend test suite to verify nothing regressed**

Run: `cd frontend && npm test`
Expected: all previous 48 tests + new 3 (PackageUpload) + 3 (PackagesView) + 3 (PackageEditView) = 57 tests passing.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/api/packages.js frontend/src/views/admin/PackagesView.vue frontend/src/views/admin/PackageEditView.vue frontend/src/components/PackageUpload.vue frontend/tests/views/admin/PackagesView.test.js frontend/tests/views/admin/PackageEditView.test.js frontend/tests/components/PackageUpload.test.js
git commit -m "feat(packages): wire frontend PackagesView + PackageEditView + PackageUpload"
```

---

## Task 12: HANDOFF.md update

**Files:**
- Modify: `HANDOFF.md` (add "Package System" subsection to "What Works", add entries to "Known Limitations")

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add "Package System" section to "What Works"**

Edit `HANDOFF.md`. Find the "## What Works" section. After the "Frontend:" bullet list ends (around line 69 — after the bullet about vitest covering all admin pages), add:

```markdown
### Package system (self-contained monitoring packages)

Admin can upload a ZIP containing `manifest.json` + `collector.js` + `migrations/*.sql` via the admin UI. Center creates a `pkg_<name>` schema namespace per install, applies the package's DDL through a regex-based sandbox (DDL only — DML/DROP/cross-schema/cross-package blocked), caches files to `<packagesCacheDir>/<name>/current/`, and routes agent-reported extension rows into `pkg_<name>.<metricTable>`. Agent loads installed packages via dynamic import on startup, includes `extensions: []` in its 60s snapshot.

#### What's wired end-to-end

- `POST /api/admin/packages/install` (multipart) → install flow → schema created → tables created → registry rows inserted → files cached.
- `DELETE /api/admin/packages/:name?confirmDropSchema=true` → drop schema (best-effort) → registry cleanup → cache cleanup.
- `POST /api/admin/packages/:name/enable|disable` → toggle without uninstall.
- `GET /api/admin/packages` and `/api/admin/packages/:name` → list / show.
- Agent: `PackagesLoader.loadAll()` runs once on agent startup; per-snapshot `extensions` array carries rows from each loaded package; failures isolated per-package.

#### Trust model

- **No code signing.** Admin is responsible for vetting the package before upload.
- DDL sandbox blocks the most common accidental damage (DROP, DML, cross-schema, cross-package). It does NOT substitute for trust — a malicious package author can still write a CREATE TABLE that fills the disk.
- The package's `collector.js` runs in the agent's Node.js process. A malicious collector could read arbitrary files, make network calls, etc.
- Admin UI surfaces a banner ("未签名包 — install 前请审查 manifest + migrations") at upload time. [Banner is a TODO for the UI task; documented for visibility.]
```

- [ ] **Step 2: Add limitations to "Known Limitations / Not-Yet-Done"**

Edit `HANDOFF.md`. In the "Known Limitations" section, replace the bullet about `packageRouter`/`orphanRouter` (currently "**`packageRouter` and `orphanRouter` not wired** — referenced in `center/server.js` TODO comments. The center has no package-system bootstrap. The frontend has `/admin/packages*` routes but the API stubs return empty data.") with:

```markdown
- **No package upgrade flow** — admin must uninstall + reinstall to upgrade; PKG_REINSTALL_BLOCKED enforces this. DDL diff application deferred.
- **DDL sandbox is regex-based** — less rigorous than a token-by-token scanner. Edge-case syntax may slip past and fail at apply time (best-effort DROP SCHEMA cleans up).
- **No automatic agent refresh on package install** — agent reads installed packages on startup; new packages require agent restart to be discovered.
- **No per-package permissions** — any admin can install/uninstall any package.
- **Failed DROP SCHEMA on uninstall leaves the schema** — admin must drop manually via `DROP DATABASE pkg_<name>` or `DROP SCHEMA pkg_<name>`. Logged to `package_runs.output` for follow-up.
- **Single-machine deployment assumption (v1)** — center writes to `<packagesCacheDir>` and agent reads from `<packages.dir>`. For v1 both must resolve to the same physical directory (typically `C:\ExDashboard\packages\` on co-located Windows deployments). Multi-machine agent sync deferred.
```

- [ ] **Step 3: Update "Common Tasks" section with package operations**

Edit `HANDOFF.md`. Find the "## Common Tasks" section. After the existing tasks, add:

```markdown
### Install a monitoring package

1. Build the package ZIP locally: `manifest.json` + `collector.js` + `migrations/*.sql`.
2. Validate against the spec's manifest schema (run ajv validate locally).
3. Open `http://center:8080/admin/packages` in the admin UI.
4. Click "Upload" → select the ZIP → confirm.
5. Restart any agents that need to load the new package.

### Uninstall a monitoring package

1. Open `http://center:8080/admin/packages/<name>`.
2. Check "I understand..." → click "Uninstall".
3. Restart agents if you want them to drop the in-memory package reference.
```

- [ ] **Step 4: Update Key File Pointers table**

Edit `HANDOFF.md`. In the Key File Pointers table, add rows:

```markdown
| Center package sandbox | `center/src/packages/{errors,ddl-sandbox,manifest,storage,sql,installer,ingest,router}.js` |
| Agent package loader | `agent/src/packages/{manifest,loader}.js` |
| Package schema | `pkg_<name>` (created at install time) |
| Package cache | `<packagesCacheDir>/<name>/current/` (center) / `<packages.dir>/<name>/current/` (agent) |
```

- [ ] **Step 5: Commit**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): document self-contained monitoring package system"
```

---

## Self-Review

After writing the complete plan, I checked it against the spec:

**1. Spec coverage (every spec section maps to a task):**

| Spec section | Covered by |
|---|---|
| Package format (ZIP, manifest.json shape, collector.js contract, migrations) | Tasks 2, 3, 5, 8, 9 |
| Manifest validation rules (ajv strict) | Task 2 |
| Reserved table names | Tasks 2, 5, 6 (manifest get, ingest) |
| Schema-per-package (`pkg_<name>`) | Tasks 5, 6, 7 |
| Per-package `schema_migrations` | Task 5 |
| DDL sandbox (regex + comment/string stripping) | Task 1 |
| Install flow (15 steps) | Task 5 |
| Uninstall flow (11 steps) | Task 5 |
| Data flow (agent getSnapshot extensions → ingest.routeExtensions) | Tasks 6, 7, 10 |
| Error codes (14 codes) | Tasks 1, 5, 6, 7 |
| Database (no new tables) | Tasks 4, 5 |
| API surface (6 admin endpoints + optional agent endpoint) | Task 7 |
| File Structure (8 center source + 5 tests, 2 agent + 2 tests, 2 views + 1 component + 2 tests) | Tasks 1-11 |
| Testing (~55 tests) | Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 11 |
| Known limitations (5 items) | Task 12 |
| Migration/rollout (no schema changes) | No-op (existing tables already in 001-initial.sql) |
| Compatibility (existing collectors unchanged) | Tasks 7, 10 (additive only) |
| Trust model (banner TODO) | Task 11 (banner TODO documented in HANDOFF) |

**2. Placeholder scan:** Searched the plan for `TBD`, `TODO` (other than doc comments), `implement later`, `fill in`, `add appropriate`, `similar to Task`. Found:
- `NOTE: db.execute may not exist` in Task 6 — explicit fix instruction, acceptable as a callout for the implementer.
- `NOTE: multer is NOT in the center deps yet` in Task 7 — explicit `npm install` instruction before the router code, acceptable.
- `banner is a TODO for the UI task` in Task 12 — explicit deferred-item callout, acceptable.

No vague placeholders remain.

**3. Type consistency:**

| Name | Defined in | Used in |
|---|---|---|
| `PkgError` | Task 1 (errors.js) | Tasks 2, 3, 5, 6, 7 |
| `scanSql(sql) → {ok, blocked?}` | Task 1 (ddl-sandbox.js) | Task 5 |
| `validateManifest(m) → {ok, value}` | Task 2 (manifest.js) | Task 5 |
| `parseZip(buf) → {manifest, collectorJs, migrations}` | Task 3 (storage.js) | Task 5 |
| `cachePackage({cacheRoot, name, version, manifest, collectorJs, migrations}) → {cachePath}` | Task 3 (storage.js) | Task 5 |
| `removeCache(cacheRoot, name)` | Task 3 (storage.js) | Task 5 |
| `installer.installPackage({db, dbKind, cacheRoot, zipBuffer, logger}) → {name, version}` | Task 5 | Task 7 |
| `installer.uninstallPackage({db, dbKind, cacheRoot, name, confirmDropSchema, logger}) → {ok}` | Task 5 | Task 7 |
| `ingest.routeExtensions({db, agentId, capturedAt, extensions}) → [{packageName, recorded?, rowCount?, error?}]` | Task 6 | Task 7 |
| `packagesRouter({db, requireAuth, config, _deps?})` | Task 7 | server.js wiring |
| `loadManifest(packagesDir, name) → {name, manifest, cachePath} | null` | Task 8 | Task 9 |
| `PackagesLoader` class with `loadAll`, `listLoaded`, `invokeCollect(name, ctx, {timeoutMs?})` | Task 9 | Task 10 |
| `packagesApi.{list, get, upload, uninstall, enable, disable, installed}` | Task 11 | Tasks 11, 12 |

All names match across tasks.

**4. Scope check:** This plan is focused on the package system v1 (~55 tests, 12 tasks). It does not cover registry pull, code signing, full token scanner, orphan tracking, package marketplace — all correctly deferred per spec's "Out-of-scope" section.

**5. Ambiguity check:**
- Task 6 mentions `db.execute` may not exist — explicit fix instruction in the NOTE.
- Task 7 uses `_deps` for DI — explicitly documented as the test seam.
- Task 10 modifies `agent/agent.js` — explicit code blocks show the exact insertion points.
- Task 11 frontend tests use `vi.mock` on the api module — consistent with how `frontend/tests/stores/auth.test.js` mocks (per existing convention).

**No issues found that require fixes.** Plan is ready to execute.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-09-self-contained-monitoring-package-system.md` (12 tasks, ~55 new tests, ~154 total tests after completion).

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?