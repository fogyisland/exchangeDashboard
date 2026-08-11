# Built-in Exchange Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 8 Exchange monitoring packages (5 migrated from hardcoded collectors + 3 new common ones) as a built-in catalog with the center release, and let admins install them onto individual servers in one click.

**Architecture:** Add a catalog layer on top of the existing self-contained monitoring package system. Built-in catalog (8 ZIPs + a JSON manifest) ships with the center release; an optional `packageCatalogUrl` in `appsettings.json` overrides it. Center stores per-server install state in a new `server_package_installs` table. Agent pulls assigned packages on heartbeat, validates, installs locally, and reports new data via the existing `extensions` ingest. The 5 legacy `queues`/`dag`/`services`/`clientAccess`/`resources` fields in `/api/agent/report` are dropped — new writes accumulate in `pkg_<name>` schemas only.

**Tech Stack:** Node `crypto` / `fs` / `node:https` (built-in), `adm-zip` (center, already a dep), `axios` (agent, already a dep), `ajv` (both, already a dep). No new npm deps.

## Global Constraints

- **No new deps.** `adm-zip` already in `center/`. Agent HTTP via existing `axios`. ZIP parsing on agent uses Node `zlib` (built-in), no new package.
- **Built-in catalog is trusted** — no signing/verification. Remote catalog override is HTTPS only and only points at the manifest; ZIPs always come from the center's own `built-in/` directory.
- **Per-server install, shared schema.** One center install creates one `pkg_<name>` MySQL schema; many servers write into it (each with its own `agent_id`). Center's `installer.installPackage` runs on the center, not the agent.
- **Agent only sends `extensions` after migration.** The 5 legacy `queues`/`dag`/`services`/`clientAccess`/`resources` fields in `/api/agent/report` are dropped. The legacy tables stay for reads (historical data, existing UI views) but receive no new writes.
- **No data migration.** Historical rows in legacy tables stay put. New writes accumulate in `pkg_<name>` schemas from install time forward.
- **YAGNI.** No package config UI, no per-server enable/disable, no dependency resolution, no downgrade UI, no multi-version concurrent install.
- **MySQL tests gate on env var.** Tests requiring real MySQL check `process.env.MYSQL_TEST_HOST` and self-skip if absent. See `memory/feedback_mysql_test_env.md`.
- **Existing schema style.** `db/schema/001-initial.sql` does not use foreign keys. New tables follow the same pattern.
- **Implementation workspace.** All work happens on `master` branch directly. The user has previously confirmed this workflow for prior SDD plans.

---

## File Structure

**New files (center):**
- `db/schema/002-server-package-installs.sql`
- `center/src/packages/server-installs.js` (CRUD on `server_package_installs`)
- `center/src/packages/catalog/loader.js` (built-in + remote catalog loader)
- `center/src/packages/catalog/router.js` (admin endpoints)
- `center/src/packages/built-in-catalog.json` (manifest)
- `center/src/packages/built-in/pkg-<name>-1.0.0.zip` × 8 (compiled ZIPs)
- `center/src/packages/built-in-src/pkg-<name>-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}` × 8 (unpacked source, used to build ZIPs)
- `center/scripts/build-builtin-packages.mjs` (zips the 8 source dirs)
- `center/tests/catalog/loader.test.js`
- `center/tests/packages/server-installs.test.js`
- `center/tests/catalog/router.test.js`
- `center/tests/catalog/install-flow.test.js`

**Modified files (center):**
- `center/src/config.js` — add `packageCatalogUrl` to `defaultConfig()`
- `center/server.js` — mount `catalogRouter` on admin mount
- `center/src/routes/agent.js` — heartbeat returns `pendingInstalls`; report drops legacy `queues`/`dag`/`services`/`clientAccess`/`resources` INSERTs
- `center/src/packages/ingest.js` — call `serverPackageInstalls.markInstalled` after successful ext write
- `center/package.json` — add `tests/catalog/*.test.js` to `npm test` glob

**New files (agent):**
- `agent/src/packages/assigned.js` (read/write `packages-installed.json`)
- `agent/src/packages/pull.js` (download + parse ZIP + validate + write)
- `agent/tests/packages/assigned.test.js`
- `agent/tests/packages/pull.test.js`

**Modified files (agent):**
- `agent/src/heartbeat.js` — send `installedPackages`; process `pendingInstalls` from response
- `agent/src/reporter.js` — drop legacy payload; only send `extensions` + `installedPackages` snapshot
- `agent/src/package-runner.js` — replace stub with `PackagesLoader`-backed implementation
- `agent/src/scheduler.js` — wire `packageRunner.loadInstalled()` into the snapshot loop
- `agent/package.json` — no change (test glob already includes `tests/packages/*.test.js`)

**Modified files (frontend):**
- `frontend/src/views/admin/PackagesView.vue` — add `Catalog` tab (existing tab is "Installed")

**New files (docs):**
- `docs/handoff/2026-08-11-built-in-exchange-packages.md`

---

### Task 1: Schema migration for `server_package_installs`

**Files:**
- Create: `db/schema/002-server-package-installs.sql`

**Interfaces:** none (pure schema).

- [ ] **Step 1: Create the schema file**

Write `db/schema/002-server-package-installs.sql`:

```sql
-- Per-server package install state.
-- One row per (server, package) pair. Statuses: pending (assigned, agent hasn't pulled yet),
-- installed (agent reported data successfully), failed (install/pull failed; error column populated).
CREATE TABLE server_package_installs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  server_id INT NOT NULL,
  package_name VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending',
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_server_pkg (server_id, package_name),
  KEY idx_status (status, server_id),
  KEY idx_server (server_id)
);
```

(No FK to `servers(id)` — matches the existing `001-initial.sql` style which has no FKs.)

- [ ] **Step 2: Apply the migration to the local MySQL instance**

Run against the configured MySQL (`reference_local_mysql.md` has the connection string):

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p < db/schema/002-server-package-installs.sql
```

- [ ] **Step 3: Verify the table exists**

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p -e "DESCRIBE exdashboard.server_package_installs;"
```

Expected: 8 columns matching the schema above.

- [ ] **Step 4: Commit**

```bash
git add db/schema/002-server-package-installs.sql
git commit -m "feat(schema): add server_package_installs table for per-server package state"
```

---

### Task 2: Catalog loader + built-in catalog JSON + `packageCatalogUrl` config

**Files:**
- Create: `center/src/packages/catalog/loader.js`
- Create: `center/src/packages/built-in-catalog.json`
- Modify: `center/src/config.js` (add `packageCatalogUrl` to `defaultConfig`)
- Test: `center/tests/catalog/loader.test.js`

**Interfaces:**
- Produces: `loadCatalog({ config, builtInDir, fetcher? }) → Promise<{ source: 'built-in' | 'remote' | 'none', packages: CatalogEntry[] }>` where `CatalogEntry = { name, version, title, summary, roleFlags, zipPath }`. `fetcher` is optional; defaults to a built-in `https.get` wrapper. Tests pass a stub.

- [ ] **Step 1: Add `packageCatalogUrl` to defaultConfig**

In `center/src/config.js`, find the `defaultConfig()` function and add:

```js
packageCatalogUrl: null,
```

(at the same level as `db`, `jwt`, etc.)

- [ ] **Step 2: Write the failing test**

Create `center/tests/catalog/loader.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadCatalog } from '../../src/packages/catalog/loader.js';

test('loadCatalog returns built-in when no remote URL set', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0', updatedAt: '2026-08-11',
    packages: [{ name: 'pkg-x', version: '1.0.0', title: 'X', summary: 's', roleFlags: 1, zipPath: 'built-in/x.zip' }]
  }));
  // Need a real (empty) ZIP at built-in/x.zip
  await fs.writeFile(path.join(builtInDir, 'x.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const out = await loadCatalog({ config: {}, builtInDir, catalogJsonPath: catalogPath });
  assert.equal(out.source, 'built-in');
  assert.equal(out.packages.length, 1);
  assert.equal(out.packages[0].name, 'pkg-x');
});

test('loadCatalog falls back to built-in when remote fetch throws', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0', packages: [{ name: 'pkg-y', version: '1.0.0', zipPath: 'built-in/y.zip' }]
  }));
  await fs.writeFile(path.join(builtInDir, 'y.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const brokenFetcher = async () => { throw new Error('network down'); };
  const out = await loadCatalog({ config: { packageCatalogUrl: 'https://example.com/cat.json' }, builtInDir, catalogJsonPath: catalogPath, fetcher: brokenFetcher });
  assert.equal(out.source, 'built-in');
  assert.equal(out.packages[0].name, 'pkg-y');
});

test('loadCatalog merges in remote entries when fetch OK and ZIPs present', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0', packages: [{ name: 'pkg-z', version: '1.0.0', zipPath: 'built-in/z.zip' }]
  }));
  await fs.writeFile(path.join(builtInDir, 'z.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const goodFetcher = async () => JSON.stringify({
    version: '2.0.0', packages: [{ name: 'pkg-z', version: '1.5.0', zipPath: 'built-in/z.zip' }]
  });
  const out = await loadCatalog({ config: { packageCatalogUrl: 'https://example.com/cat.json' }, builtInDir, catalogJsonPath: catalogPath, fetcher: goodFetcher });
  // Remote entry overrides built-in for same name
  assert.equal(out.source, 'remote');
  assert.equal(out.packages[0].version, '1.5.0');
});

test('loadCatalog skips remote entries whose zipPath is not in built-in/', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({ version: '1.0.0', packages: [] }));

  const fetcher = async () => JSON.stringify({
    version: '1.0.0', packages: [
      { name: 'pkg-ok', version: '1.0.0', zipPath: 'built-in/ok.zip' },
      { name: 'pkg-bad', version: '1.0.0', zipPath: 'built-in/does-not-exist.zip' }
    ]
  });
  const out = await loadCatalog({ config: { packageCatalogUrl: 'https://example.com/cat.json' }, builtInDir, catalogJsonPath: catalogPath, fetcher });
  assert.equal(out.packages.length, 0); // both skipped (ok.zip not present, bad entry has no zip)
});

test('loadCatalog returns source none when neither built-in nor remote resolves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const out = await loadCatalog({ config: {}, builtInDir: path.join(dir, 'missing'), catalogJsonPath: path.join(dir, 'missing.json') });
  assert.equal(out.source, 'none');
  assert.equal(out.packages.length, 0);
});

test('loadCatalog is idempotent across multiple calls', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-'));
  const builtInDir = path.join(dir, 'built-in');
  await fs.mkdir(builtInDir, { recursive: true });
  const catalogPath = path.join(dir, 'built-in-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify({ version: '1.0.0', packages: [{ name: 'pkg-i', version: '1.0.0', zipPath: 'built-in/i.zip' }] }));
  await fs.writeFile(path.join(builtInDir, 'i.zip'), Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  const a = await loadCatalog({ config: {}, builtInDir, catalogJsonPath: catalogPath });
  const b = await loadCatalog({ config: {}, builtInDir, catalogJsonPath: catalogPath });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
cd center && npm test -- tests/catalog/loader.test.js
```

Expected: failures citing `loadCatalog` not found.

- [ ] **Step 4: Add the test glob to `npm test`**

In `center/package.json`, change the `test` script to include `tests/catalog/*.test.js`:

```json
"test": "node --test tests/*.test.js tests/config/*.test.js tests/init/*.test.js tests/packages/*.test.js tests/routes/*.test.js tests/services/*.test.js tests/db/*.test.js tests/sql/*.test.js tests/catalog/*.test.js tests/integration/*.test.js tests/e2e/*.test.js"
```

- [ ] **Step 5: Implement the loader**

Create `center/src/packages/catalog/loader.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const NAME_RE = /^[a-z][a-z0-9-]{2,40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z0-9]+)?$/;

function defaultFetcher(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function readBuiltIn(catalogJsonPath, builtInDir, logger) {
  try {
    const raw = await fs.readFile(catalogJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = (parsed.packages || []).filter((e) => e && e.name && e.version && e.zipPath);
    const verified = [];
    for (const e of entries) {
      const zipFullPath = path.join(builtInDir, '..', e.zipPath);
      try {
        await fs.access(zipFullPath);
        verified.push({ ...e, name: e.name, version: e.version, title: e.title || e.name, summary: e.summary || '', roleFlags: e.roleFlags || 0, zipPath: e.zipPath });
      } catch {
        if (logger) logger.warn({ pkg: e.name, zipPath: e.zipPath }, 'built-in catalog entry zipPath not found; skipping');
      }
    }
    return verified;
  } catch (e) {
    if (logger) logger.warn({ err: e.message }, 'built-in catalog read failed');
    return [];
  }
}

async function readRemote(url, builtInDir, fetcher, logger) {
  try {
    const text = await fetcher(url);
    const parsed = JSON.parse(text);
    const entries = (parsed.packages || []).filter((e) => e && e.name && e.version && e.zipPath);
    const verified = [];
    for (const e of entries) {
      if (!NAME_RE.test(e.name) || !VERSION_RE.test(e.version)) {
        if (logger) logger.warn({ pkg: e.name }, 'remote catalog entry has invalid name/version; skipping');
        continue;
      }
      const zipFullPath = path.join(builtInDir, '..', e.zipPath);
      try {
        await fs.access(zipFullPath);
        verified.push({ ...e, name: e.name, version: e.version, title: e.title || e.name, summary: e.summary || '', roleFlags: e.roleFlags || 0, zipPath: e.zipPath });
      } catch {
        if (logger) logger.warn({ pkg: e.name, zipPath: e.zipPath }, 'remote catalog entry zipPath not in built-in/; skipping');
      }
    }
    return verified;
  } catch (e) {
    if (logger) logger.warn({ err: e.message }, 'remote catalog fetch failed; falling back to built-in');
    return null; // signal fallback
  }
}

export async function loadCatalog({ config, builtInDir, catalogJsonPath, fetcher, logger }) {
  const f = fetcher || defaultFetcher;
  const builtIn = await readBuiltIn(catalogJsonPath, builtInDir, logger);
  if (!config?.packageCatalogUrl) {
    return builtIn.length > 0 ? { source: 'built-in', packages: builtIn } : { source: 'none', packages: [] };
  }
  const remote = await readRemote(config.packageCatalogUrl, builtInDir, f, logger);
  if (remote === null) {
    // fetch failed; fall back
    return builtIn.length > 0 ? { source: 'built-in', packages: builtIn } : { source: 'none', packages: [] };
  }
  if (remote.length === 0) {
    return builtIn.length > 0 ? { source: 'built-in', packages: builtIn } : { source: 'none', packages: [] };
  }
  // remote overrides built-in by name
  const map = new Map(builtIn.map((e) => [e.name, e]));
  for (const e of remote) map.set(e.name, e);
  return { source: 'remote', packages: [...map.values()] };
}
```

- [ ] **Step 6: Create the initial empty built-in-catalog.json**

Create `center/src/packages/built-in-catalog.json`:

```json
{
  "version": "1.0.0",
  "updatedAt": "2026-08-11",
  "packages": []
}
```

(Will be populated by Task 4.)

- [ ] **Step 7: Run tests, verify they pass**

```bash
cd center && npm test -- tests/catalog/loader.test.js
```

Expected: 6 passes.

- [ ] **Step 8: Commit**

```bash
git add center/src/packages/catalog/loader.js center/src/packages/built-in-catalog.json center/src/config.js center/tests/catalog/loader.test.js center/package.json
git commit -m "feat(catalog): add built-in + remote catalog loader with packageCatalogUrl override"
```

---

### Task 3: `serverPackageInstalls` CRUD

**Files:**
- Create: `center/src/packages/server-installs.js`
- Test: `center/tests/packages/server-installs.test.js`

**Interfaces:**
- Produces: `serverPackageInstalls = { assign(db, { serverId, packageName, version }) → Promise<void>, pendingFor(db, serverId) → Promise<Array<{name, version, downloadUrl}>>, listByServer(db, serverId) → Promise<Array<{name, version, status, error, updatedAt}>>, markInstalled(db, serverId, packageName) → Promise<void>, markFailed(db, serverId, packageName, error) → Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `center/tests/packages/server-installs.test.js`:

```js
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
  await conn.query(`CREATE TABLE IF NOT EXISTS servers (
    id INT PRIMARY KEY AUTO_INCREMENT, hostname VARCHAR(128) UNIQUE NOT NULL
  )`);
  await conn.query(`CREATE TABLE IF NOT EXISTS server_package_installs (
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
  const [[srv]] = await db.query('INSERT INTO servers (hostname) VALUES (?)', ['h1']);
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
  const [[srv]] = await db.query('INSERT INTO servers (hostname) VALUES (?)', ['h2']);
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
  const [[srv]] = await db.query('INSERT INTO servers (hostname) VALUES (?)', ['h3']);
  const serverId = srv.insertId;
  const wrapper = { query: (sql, params) => db.query(sql, params).then(([r]) => r) };
  await serverPackageInstalls.assign(wrapper, { serverId, packageName: 'pkg-c', version: '1.0.0' });
  await serverPackageInstalls.markFailed(wrapper, serverId, 'pkg-c', 'download timed out');
  const rows = await serverPackageInstalls.listByServer(wrapper, serverId);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[0].error, 'download timed out');
  await db.end();
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test -- tests/packages/server-installs.test.js
```

Expected: failure citing `server-installs.js` not found.

- [ ] **Step 3: Implement the CRUD module**

Create `center/src/packages/server-installs.js`:

```js
function downloadUrlFor(packageName) {
  return `/api/admin/catalog/${encodeURIComponent(packageName)}/zip`;
}

export const serverPackageInstalls = {
  async assign(db, { serverId, packageName, version }) {
    await db.query(
      'INSERT INTO server_package_installs (server_id, package_name, version, status) VALUES (?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE version = VALUES(version), status = IF(status = "installed", "installed", "pending"), error = NULL',
      [serverId, packageName, version, 'pending']
    );
  },
  async pendingFor(db, serverId) {
    const rows = await db.query(
      'SELECT package_name, version FROM server_package_installs WHERE server_id = ? AND status = ?',
      [serverId, 'pending']
    );
    return rows.map((r) => ({ name: r.package_name, version: r.version, downloadUrl: downloadUrlFor(r.package_name) }));
  },
  async listByServer(db, serverId) {
    const rows = await db.query(
      'SELECT package_name, version, status, error, updated_at FROM server_package_installs WHERE server_id = ? ORDER BY package_name',
      [serverId]
    );
    return rows.map((r) => ({ name: r.package_name, version: r.version, status: r.status, error: r.error, updatedAt: r.updated_at }));
  },
  async listAll(db) {
    const rows = await db.query(
      'SELECT server_id, package_name, version, status, error, updated_at FROM server_package_installs ORDER BY server_id, package_name'
    );
    return rows.map((r) => ({ serverId: r.server_id, name: r.package_name, version: r.version, status: r.status, error: r.error, updatedAt: r.updated_at }));
  },
  async markInstalled(db, serverId, packageName) {
    await db.query(
      'UPDATE server_package_installs SET status = ?, error = NULL WHERE server_id = ? AND package_name = ? AND status = ?',
      ['installed', serverId, packageName, 'pending']
    );
  },
  async markFailed(db, serverId, packageName, error) {
    await db.query(
      'UPDATE server_package_installs SET status = ?, error = ? WHERE server_id = ? AND package_name = ?',
      ['failed', String(error).slice(0, 1000), serverId, packageName]
    );
  }
};
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test -- tests/packages/server-installs.test.js
```

Expected: 3 passes.

- [ ] **Step 5: Commit**

```bash
git add center/src/packages/server-installs.js center/tests/packages/server-installs.test.js
git commit -m "feat(packages): serverPackageInstalls CRUD with assign/pendingFor/markInstalled/markFailed"
```

---

### Task 4: Build script + 5 migrated packages

**Files:**
- Create: `center/scripts/build-builtin-packages.mjs`
- Create: `center/src/packages/built-in-src/pkg-mailflow-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Create: `center/src/packages/built-in-src/pkg-dag-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Create: `center/src/packages/built-in-src/pkg-services-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Create: `center/src/packages/built-in-src/pkg-clientaccess-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Create: `center/src/packages/built-in-src/pkg-perfmon-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`

**Interfaces:**
- Produces: 5 ZIPs at `center/src/packages/built-in/pkg-<name>-1.0.0.zip`, ready to be listed in `built-in-catalog.json` (Task 5 updates the catalog).

- [ ] **Step 1: Create the build script**

Create `center/scripts/build-builtin-packages.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src/packages/built-in-src');
const DST = path.join(ROOT, 'src/packages/built-in');
fs.mkdirSync(DST, { recursive: true });

const dirs = fs.readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory());
for (const d of dirs) {
  const srcDir = path.join(SRC, d.name);
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  const outPath = path.join(DST, `${d.name}.zip`);
  zip.writeZip(outPath);
  console.log(`built ${outPath}`);
}
```

- [ ] **Step 2: Create `pkg-mailflow-1.0.0` source files**

Create `center/src/packages/built-in-src/pkg-mailflow-1.0.0/manifest.json`:

```json
{
  "name": "pkg-mailflow",
  "version": "1.0.0",
  "description": "Mailflow transport queue depth + throughput from MSExchangeTransport perfmon",
  "author": "ExDashboard",
  "type": "timeseries",
  "database": {
    "metricTable": "mailflow_queue",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "queue_kind": { "type": "varchar(64)" },
      "queue_name": { "type": "varchar(64)" },
      "message_count": { "type": "int" },
      "messages_per_sec": { "type": "double", "nullable": true },
      "deferred_per_sec": { "type": "double", "nullable": true }
    }
  },
  "agent": { "intervalSec": 60, "timeoutMs": 15000 },
  "roleFlags": 3
}
```

Create `center/src/packages/built-in-src/pkg-mailflow-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE mailflow_queue (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  queue_kind VARCHAR(64) NOT NULL,
  queue_name VARCHAR(64) NOT NULL,
  message_count INT NOT NULL,
  messages_per_sec DOUBLE NULL,
  deferred_per_sec DOUBLE NULL,
  PRIMARY KEY (agent_id, ts, queue_kind),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-mailflow-1.0.0/collector.js`:

```js
// Ported from agent/src/mailflow-collector.js
const COUNTERS = [
  ['ActiveMailboxDelivery', '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length'],
  ['Poison', '\\MSExchangeTransport Queues(_total)\\Poison Queue Length'],
  ['Retry', '\\MSExchangeTransport Queues(_total)\\Retry Queue Length'],
  ['Submission', '\\MSExchangeTransport Submission Queue(_total)\\Submission Queue Length']
];

export default {
  name: 'pkg-mailflow',
  async collect({ perfmon }) {
    if (!perfmon || typeof perfmon.counterMulti !== 'function') return [];
    const paths = COUNTERS.map(([, p]) => p);
    let raw;
    try { raw = await perfmon.counterMulti(paths); } catch { return []; }
    const mpsPath = '\\MSExchangeTransport Queues(_total)\\Messages Queued Per Second';
    const dpsPath = '\\MSExchangeTransport Queues(_total)\\Deferred Messages Per Second';
    const mps = Number(raw[mpsPath]); const dps = Number(raw[dpsPath]);
    const rows = [];
    for (const [kind, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (Number.isNaN(v)) continue;
      rows.push({
        queue_kind: kind,
        queue_name: kind,
        message_count: v,
        messages_per_sec: Number.isNaN(mps) ? null : mps,
        deferred_per_sec: Number.isNaN(dps) ? null : dps
      });
    }
    return rows;
  }
};
```

- [ ] **Step 3: Create `pkg-dag-1.0.0` source files**

Create `center/src/packages/built-in-src/pkg-dag-1.0.0/manifest.json`:

```json
{
  "name": "pkg-dag",
  "version": "1.0.0",
  "description": "Mailbox database copy status + replay lag from MDB replication perfmon",
  "author": "ExDashboard",
  "type": "timeseries",
  "database": {
    "metricTable": "mdb_copy_status",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "db_id": { "type": "varchar(64)" },
      "copy_queue_length": { "type": "int" },
      "replay_lag_seconds": { "type": "double", "nullable": true },
      "mount_status": { "type": "int" },
      "content_index_state": { "type": "int", "nullable": true },
      "is_active_copy": { "type": "int" },
      "activation_preference": { "type": "int", "nullable": true }
    }
  },
  "agent": { "intervalSec": 120, "timeoutMs": 30000 },
  "roleFlags": 1
}
```

Create `center/src/packages/built-in-src/pkg-dag-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE mdb_copy_status (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  db_id VARCHAR(64) NOT NULL,
  copy_queue_length INT NOT NULL,
  replay_lag_seconds DOUBLE NULL,
  mount_status INT NOT NULL,
  content_index_state INT NULL,
  is_active_copy INT NOT NULL,
  activation_preference INT NULL,
  PRIMARY KEY (agent_id, ts, db_id),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-dag-1.0.0/collector.js`:

```js
// Ported from agent/src/dag-collector.js
export default {
  name: 'pkg-dag',
  async collect({ perfmon, dag }) {
    if (!perfmon) return [];
    let counterResults = [];
    try {
      counterResults = await perfmon.copySnapshot() || [];
    } catch { return []; }
    return counterResults.map((c) => ({
      db_id: c.db_id || c.DatabaseName || 'unknown',
      copy_queue_length: Number(c.copy_queue_length) || 0,
      replay_lag_seconds: c.replay_lag_seconds == null ? null : Number(c.replay_lag_seconds),
      mount_status: Number(c.mount_status) || 0,
      content_index_state: c.content_index_state == null ? null : Number(c.content_index_state),
      is_active_copy: c.is_active_copy ? 1 : 0,
      activation_preference: c.activation_preference == null ? null : Number(c.activation_preference)
    }));
  }
};
```

- [ ] **Step 4: Create `pkg-services-1.0.0` source files**

Create `center/src/packages/built-in-src/pkg-services-1.0.0/manifest.json`:

```json
{
  "name": "pkg-services",
  "version": "1.0.0",
  "description": "Windows service state for MSExchange* services",
  "author": "ExDashboard",
  "type": "status",
  "database": {
    "metricTable": "windows_service",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "service_name": { "type": "varchar(128)" },
      "state": { "type": "varchar(32)" },
      "start_mode": { "type": "varchar(32)" }
    }
  },
  "agent": { "intervalSec": 60, "timeoutMs": 10000 },
  "roleFlags": 7
}
```

Create `center/src/packages/built-in-src/pkg-services-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE windows_service (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL,
  start_mode VARCHAR(32) NOT NULL,
  PRIMARY KEY (agent_id, ts, service_name),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-services-1.0.0/collector.js`:

```js
// Ported from agent/src/services-collector.js
export default {
  name: 'pkg-services',
  async collect({ execFile }) {
    if (!execFile || process.platform !== 'win32') return [];
    const { execFile: ef } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const pexec = promisify(ef);
    let stdout;
    try {
      const r = await pexec('wmic', ['service', 'where', "Name like 'MSExchange%'", 'get', 'Name,State,StartMode', '/format:csv'], { timeout: 8000 });
      stdout = r.stdout;
    } catch { return []; }
    const lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',');
    const nameIdx = headers.indexOf('Name');
    const stateIdx = headers.indexOf('State');
    const startIdx = headers.indexOf('StartMode');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < headers.length) continue;
      const name = parts[nameIdx];
      if (!name || !name.includes('MSExchange')) continue;
      out.push({ service_name: name, state: parts[stateIdx] || 'Unknown', start_mode: parts[startIdx] || 'Unknown' });
    }
    return out;
  }
};
```

- [ ] **Step 5: Create `pkg-clientaccess-1.0.0` source files**

Create `center/src/packages/built-in-src/pkg-clientaccess-1.0.0/manifest.json`:

```json
{
  "name": "pkg-clientaccess",
  "version": "1.0.0",
  "description": "RPC Client Access latency + CAS perfmon counters",
  "author": "ExDashboard",
  "type": "timeseries",
  "database": {
    "metricTable": "rpc_latency",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "metric": { "type": "varchar(128)" },
      "value": { "type": "double" }
    }
  },
  "agent": { "intervalSec": 60, "timeoutMs": 15000 },
  "roleFlags": 4
}
```

Create `center/src/packages/built-in-src/pkg-clientaccess-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE rpc_latency (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  metric VARCHAR(128) NOT NULL,
  value DOUBLE NOT NULL,
  PRIMARY KEY (agent_id, ts, metric),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-clientaccess-1.0.0/collector.js`:

```js
// Ported from agent/src/clientaccess-collector.js
const COUNTERS = [
  ['RpcClientAccess\\RPC Average Latency', '\\MSExchange RpcClientAccess\\RPC Average Latency'],
  ['RpcClientAccess\\RPC Operations/sec', '\\MSExchange RpcClientAccess\\RPC Operations/sec'],
  ['RpcClientAccess\\Active User Count', '\\MSExchange RpcClientAccess\\Active User Count']
];
export default {
  name: 'pkg-clientaccess',
  async collect({ perfmon }) {
    if (!perfmon || typeof perfmon.counterMulti !== 'function') return [];
    const paths = COUNTERS.map(([, p]) => p);
    let raw;
    try { raw = await perfmon.counterMulti(paths); } catch { return []; }
    const rows = [];
    for (const [metric, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (Number.isNaN(v)) continue;
      rows.push({ metric, value: v });
    }
    return rows;
  }
};
```

- [ ] **Step 6: Create `pkg-perfmon-1.0.0` source files**

Create `center/src/packages/built-in-src/pkg-perfmon-1.0.0/manifest.json`:

```json
{
  "name": "pkg-perfmon",
  "version": "1.0.0",
  "description": "Host-level CPU, memory, disk C: free %, net throughput",
  "author": "ExDashboard",
  "type": "timeseries",
  "database": {
    "metricTable": "host_resources",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "cpu_pct": { "type": "double", "nullable": true },
      "memory_available_mb": { "type": "int", "nullable": true },
      "disk_c_free_pct": { "type": "double", "nullable": true },
      "net_bytes_per_sec": { "type": "double", "nullable": true }
    }
  },
  "agent": { "intervalSec": 60, "timeoutMs": 10000 },
  "roleFlags": 7
}
```

Create `center/src/packages/built-in-src/pkg-perfmon-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE host_resources (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  cpu_pct DOUBLE NULL,
  memory_available_mb INT NULL,
  disk_c_free_pct DOUBLE NULL,
  net_bytes_per_sec DOUBLE NULL,
  PRIMARY KEY (agent_id, ts),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-perfmon-1.0.0/collector.js`:

```js
// Ported from agent/src/perfmon-collector.js
const COUNTERS = [
  ['cpu_pct', '\\Processor(_total)\\% Processor Time'],
  ['memory_available_mb', '\\Memory\\Available MBytes'],
  ['disk_c_free_pct', '\\LogicalDisk(C:)\\% Free Space'],
  ['net_bytes_per_sec', '\\Network Interface(*)\\Bytes Total/sec']
];
export default {
  name: 'pkg-perfmon',
  async collect({ perfmon }) {
    if (!perfmon || typeof perfmon.counterMulti !== 'function') return [];
    const paths = COUNTERS.map(([, p]) => p);
    let raw;
    try { raw = await perfmon.counterMulti(paths); } catch { return []; }
    const out = {};
    for (const [k, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (!Number.isNaN(v)) out[k] = v;
    }
    return [out]; // single row per tick
  }
};
```

- [ ] **Step 7: Run the build script**

```bash
cd center && node scripts/build-builtin-packages.mjs
```

Expected: 5 lines, one per `built <path>.zip`.

- [ ] **Step 8: Verify ZIPs exist**

```bash
ls -la center/src/packages/built-in/
```

Expected: 5 `.zip` files, each 1-5 KB.

- [ ] **Step 9: Commit**

```bash
git add center/scripts/build-builtin-packages.mjs center/src/packages/built-in-src/ center/src/packages/built-in/
git commit -m "feat(catalog): add 5 migrated Exchange packages (mailflow, dag, services, clientaccess, perfmon)"
```

---

### Task 5: 3 new packages + update built-in catalog

**Files:**
- Create: `center/src/packages/built-in-src/pkg-mailbox-size-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Create: `center/src/packages/built-in-src/pkg-message-tracking-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Create: `center/src/packages/built-in-src/pkg-hub-backpressure-1.0.0/{manifest.json, collector.js, migrations/001_initial.sql}`
- Modify: `center/src/packages/built-in-catalog.json` (now lists all 8)

- [ ] **Step 1: Create `pkg-mailbox-size-1.0.0`**

Create `center/src/packages/built-in-src/pkg-mailbox-size-1.0.0/manifest.json`:

```json
{
  "name": "pkg-mailbox-size",
  "version": "1.0.0",
  "description": "Per-mailbox total item size + item count from local Exchange Management Shell (Get-MailboxStatistics)",
  "author": "ExDashboard",
  "type": "gauge",
  "database": {
    "metricTable": "mailbox_quota",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "mailbox_identity": { "type": "varchar(255)" },
      "database": { "type": "varchar(128)" },
      "total_item_size_bytes": { "type": "bigint" },
      "item_count": { "type": "int" }
    }
  },
  "agent": { "intervalSec": 600, "timeoutMs": 300000 },
  "roleFlags": 1
}
```

Create `center/src/packages/built-in-src/pkg-mailbox-size-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE mailbox_quota (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  mailbox_identity VARCHAR(255) NOT NULL,
  database VARCHAR(128) NOT NULL,
  total_item_size_bytes BIGINT NOT NULL,
  item_count INT NOT NULL,
  PRIMARY KEY (agent_id, ts, mailbox_identity),
  KEY idx_ts (ts),
  KEY idx_db (database)
);
```

Create `center/src/packages/built-in-src/pkg-mailbox-size-1.0.0/collector.js`:

```js
// Calls Get-MailboxStatistics via local Exchange Management Shell.
// PowerShell truncates large numbers; this is acceptable for monitoring (max 2^53).
export default {
  name: 'pkg-mailbox-size',
  async collect({ execFile }) {
    if (!execFile || process.platform !== 'win32') return [];
    const { execFile: ef } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const pexec = promisify(ef);
    const ps = `
      $ErrorActionPreference = 'SilentlyContinue'
      Get-MailboxStatistics -ResultSize Unlimited |
        Select-Object @{N='Identity';E={$_.DisplayName}},
                       @{N='Db';E={$_.DatabaseName.ToString()}},
                       @{N='SizeBytes';E={[int64]$_.TotalItemSize.Value.ToBytes()}},
                       @{N='Count';E={[int]$_.ItemCount}} |
        ConvertTo-Json -Compress
    `;
    let stdout;
    try {
      const r = await pexec('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      stdout = r.stdout;
    } catch { return []; }
    let arr;
    try { arr = JSON.parse(stdout); } catch { return []; }
    if (!Array.isArray(arr)) arr = [arr];
    return arr
      .filter((m) => m && m.Identity)
      .map((m) => ({
        mailbox_identity: String(m.Identity).slice(0, 255),
        database: String(m.Db || '').slice(0, 128),
        total_item_size_bytes: Number(m.SizeBytes) || 0,
        item_count: Number(m.Count) || 0
      }));
  }
};
```

- [ ] **Step 2: Create `pkg-message-tracking-1.0.0`**

Create `center/src/packages/built-in-src/pkg-message-tracking-1.0.0/manifest.json`:

```json
{
  "name": "pkg-message-tracking",
  "version": "1.0.0",
  "description": "Counts of Exchange message tracking events by event_id, tailed from TransportRoles/Logs/MessageTracking",
  "author": "ExDashboard",
  "type": "counter",
  "database": {
    "metricTable": "tracking_event_counts",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "event_id": { "type": "varchar(8)" },
      "message_count": { "type": "int" }
    }
  },
  "agent": { "intervalSec": 60, "timeoutMs": 15000 },
  "roleFlags": 2
}
```

Create `center/src/packages/built-in-src/pkg-message-tracking-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE tracking_event_counts (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  event_id VARCHAR(8) NOT NULL,
  message_count INT NOT NULL,
  PRIMARY KEY (agent_id, ts, event_id),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-message-tracking-1.0.0/collector.js`:

```js
// Tails Exchange message tracking logs and counts by event_id in the last 60s window.
// Tracks file position in a sidecar JSON at <installPath>/state/pkg-message-tracking.pos.json.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const LOG_DIR = 'C:\\Program Files\\Microsoft\\Exchange Server\\V15\\TransportRoles\\Logs\\MessageTracking';

export default {
  name: 'pkg-message-tracking',
  async collect({ installPath }) {
    if (process.platform !== 'win32') return [];
    const stateDir = path.join(installPath || '.', 'state');
    await fsp.mkdir(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, 'pkg-message-tracking.pos.json');
    let state = { lastReadBytes: 0, lastReadFile: null };
    try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch {}

    let logFiles = [];
    try { logFiles = (await fsp.readdir(LOG_DIR)).filter((f) => f.endsWith('.LOG')).sort(); } catch { return []; }
    if (logFiles.length === 0) return [];

    // Find the file we were last reading, or the oldest if state is empty.
    let fileName = state.lastReadFile;
    if (!fileName || !logFiles.includes(fileName)) {
      fileName = logFiles[0];
      state.lastReadBytes = 0;
    }
    const filePath = path.join(LOG_DIR, fileName);
    let st;
    try { st = await fsp.stat(filePath); } catch { return []; }

    // If file rolled (smaller than lastReadBytes), start over.
    let start = state.lastReadBytes;
    if (st.size < start) start = 0;

    const fd = await fsp.open(filePath, 'r');
    try {
      const length = Math.max(0, st.size - start);
      if (length === 0) return [];
      const buf = Buffer.alloc(length);
      await fd.read(buf, 0, length, start);
      state.lastReadBytes = st.size;
      state.lastReadFile = fileName;
      await fsp.writeFile(stateFile, JSON.stringify(state));

      const text = buf.toString('utf8');
      const counts = new Map();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        // Format: <date-time>,<client-ip>,<hostname>,<event-id>,<...>
        const parts = line.split(',');
        if (parts.length < 4) continue;
        const eventId = parts[3].trim();
        if (!/^[A-Z]+$/.test(eventId)) continue;
        counts.set(eventId, (counts.get(eventId) || 0) + 1);
      }
      return Array.from(counts, ([event_id, message_count]) => ({ event_id, message_count }));
    } finally {
      await fd.close();
    }
  }
};
```

- [ ] **Step 3: Create `pkg-hub-backpressure-1.0.0`**

Create `center/src/packages/built-in-src/pkg-hub-backpressure-1.0.0/manifest.json`:

```json
{
  "name": "pkg-hub-backpressure",
  "version": "1.0.0",
  "description": "HUB transport queue pressure + age of oldest message via perfmon and Get-Queue",
  "author": "ExDashboard",
  "type": "gauge",
  "database": {
    "metricTable": "hub_queue_pressure",
    "metricColumns": {
      "agent_id": { "type": "varchar(64)" },
      "ts": { "type": "datetime" },
      "queue_kind": { "type": "varchar(64)" },
      "current_depth": { "type": "int" },
      "max_depth": { "type": "int", "nullable": true },
      "pct_full": { "type": "double", "nullable": true },
      "age_oldest_min": { "type": "int", "nullable": true }
    }
  },
  "agent": { "intervalSec": 60, "timeoutMs": 30000 },
  "roleFlags": 2
}
```

Create `center/src/packages/built-in-src/pkg-hub-backpressure-1.0.0/migrations/001_initial.sql`:

```sql
CREATE TABLE hub_queue_pressure (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  queue_kind VARCHAR(64) NOT NULL,
  current_depth INT NOT NULL,
  max_depth INT NULL,
  pct_full DOUBLE NULL,
  age_oldest_min INT NULL,
  PRIMARY KEY (agent_id, ts, queue_kind),
  KEY idx_ts (ts)
);
```

Create `center/src/packages/built-in-src/pkg-hub-backpressure-1.0.0/collector.js`:

```js
// Combines perfmon HUB queue counters with Get-Queue's oldest message age.
const COUNTERS = [
  ['ActiveMailboxDelivery', '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length'],
  ['Retry', '\\MSExchangeTransport Queues(_total)\\Retry Queue Length'],
  ['Poison', '\\MSExchangeTransport Queues(_total)\\Poison Queue Length'],
  ['Submission', '\\MSExchangeTransport Submission Queue(_total)\\Submission Queue Length']
];

export default {
  name: 'pkg-hub-backpressure',
  async collect({ perfmon, execFile }) {
    const out = [];
    if (perfmon && typeof perfmon.counterMulti === 'function') {
      const paths = COUNTERS.map(([, p]) => p);
      let raw;
      try { raw = await perfmon.counterMulti(paths); } catch { raw = {}; }
      for (const [kind, p] of COUNTERS) {
        const v = Number(raw[p]);
        if (Number.isNaN(v)) continue;
        out.push({ queue_kind: kind, current_depth: v });
      }
    }
    // Augment with age of oldest via Get-Queue on Windows
    if (execFile && process.platform === 'win32') {
      const { execFile: ef } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const pexec = promisify(ef);
      const ps = `
        $ErrorActionPreference = 'SilentlyContinue'
        Get-Queue | Select-Object QueueType,
                              @{N='Depth';E={$_.MessageCount}},
                              @{N='OldestMin';E={[int]([DateTime]::Now - $_.OldestMessage).TotalMinutes}} |
          ConvertTo-Json -Compress
      `;
      try {
        const r = await pexec('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
        const arr = JSON.parse(r.stdout);
        const list = Array.isArray(arr) ? arr : [arr];
        for (const q of list) {
          if (!q || !q.QueueType) continue;
          const kind = String(q.QueueType);
          const existing = out.find((o) => o.queue_kind === kind);
          const oldest = Number(q.OldestMin);
          if (existing) {
            if (Number.isFinite(oldest)) existing.age_oldest_min = Math.max(0, oldest);
          } else {
            out.push({ queue_kind: kind, current_depth: Number(q.Depth) || 0, age_oldest_min: Number.isFinite(oldest) ? Math.max(0, oldest) : null });
          }
        }
      } catch {}
    }
    return out;
  }
};
```

- [ ] **Step 4: Update `built-in-catalog.json` with all 8 entries**

Replace contents of `center/src/packages/built-in-catalog.json`:

```json
{
  "version": "1.0.0",
  "updatedAt": "2026-08-11",
  "packages": [
    { "name": "pkg-mailflow", "version": "1.0.0", "title": "Mailflow Transport Queues", "summary": "Per-queue length + throughput from MSExchangeTransport perfmon", "roleFlags": 3, "zipPath": "built-in/pkg-mailflow-1.0.0.zip" },
    { "name": "pkg-dag", "version": "1.0.0", "title": "DAG Mailbox Database Copies", "summary": "MDB copy queue length + replay lag from perfmon", "roleFlags": 1, "zipPath": "built-in/pkg-dag-1.0.0.zip" },
    { "name": "pkg-services", "version": "1.0.0", "title": "MSExchange Windows Services", "summary": "Service state for MSExchange* services via wmic", "roleFlags": 7, "zipPath": "built-in/pkg-services-1.0.0.zip" },
    { "name": "pkg-clientaccess", "version": "1.0.0", "title": "RPC Client Access", "summary": "RPC latency, ops/sec, active users from RpcClientAccess perfmon", "roleFlags": 4, "zipPath": "built-in/pkg-clientaccess-1.0.0.zip" },
    { "name": "pkg-perfmon", "version": "1.0.0", "title": "Host Resources", "summary": "CPU, memory, disk C: free %, net throughput", "roleFlags": 7, "zipPath": "built-in/pkg-perfmon-1.0.0.zip" },
    { "name": "pkg-mailbox-size", "version": "1.0.0", "title": "Mailbox Quota Usage", "summary": "Per-mailbox totalItemSize + itemCount via Get-MailboxStatistics", "roleFlags": 1, "zipPath": "built-in/pkg-mailbox-size-1.0.0.zip" },
    { "name": "pkg-message-tracking", "version": "1.0.0", "title": "Message Tracking Log Counts", "summary": "Counts by event_id from TransportRoles/Logs/MessageTracking", "roleFlags": 2, "zipPath": "built-in/pkg-message-tracking-1.0.0.zip" },
    { "name": "pkg-hub-backpressure", "version": "1.0.0", "title": "HUB Transport Backpressure", "summary": "HUB queue depth + age of oldest via perfmon + Get-Queue", "roleFlags": 2, "zipPath": "built-in/pkg-hub-backpressure-1.0.0.zip" }
  ]
}
```

- [ ] **Step 5: Re-run the build script**

```bash
cd center && node scripts/build-builtin-packages.mjs
```

Expected: 8 lines, one per `built <path>.zip`.

- [ ] **Step 6: Verify all 8 ZIPs exist and re-run loader test**

```bash
ls center/src/packages/built-in/*.zip | wc -l  # expect 8
cd center && npm test -- tests/catalog/loader.test.js  # still passes
```

- [ ] **Step 7: Commit**

```bash
git add center/src/packages/built-in-src/pkg-mailbox-size-1.0.0/ center/src/packages/built-in-src/pkg-message-tracking-1.0.0/ center/src/packages/built-in-src/pkg-hub-backpressure-1.0.0/ center/src/packages/built-in/ center/src/packages/built-in-catalog.json
git commit -m "feat(catalog): add 3 new common packages (mailbox-size, message-tracking, hub-backpressure) and finalize built-in catalog"
```

---

### Task 6: Catalog admin router + mount in server.js

**Files:**
- Create: `center/src/packages/catalog/router.js`
- Modify: `center/server.js` (mount the router)
- Test: `center/tests/catalog/router.test.js`

**Interfaces:**
- Produces: `catalogRouter({ config, db, dbKind, cacheRoot, logger })` returns an Express router mounted at `/api/admin/catalog` with routes:
  - `GET /` → `{ source, packages: [...] }`
  - `POST /:name/install` body `{ serverIds: number[] }` → `{ assigned: number, failed: [{ serverId, error }] }`
  - `GET /:name/zip` → streams the ZIP
  - `GET /installs` → `[{ serverId, name, version, status, error, updatedAt }]`

- [ ] **Step 1: Write the failing test**

Create `center/tests/catalog/router.test.js`:

```js
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
  const [[[srv]]] = await conn.query('SELECT id FROM servers');
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
  realZip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE pkgx_metric (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NOT NULL, PRIMARY KEY (agent_id, ts))'));
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
  await f.conn.end();
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
  const tableNames = tables.flat().map((n) => String(n));
  assert.ok(tableNames.includes('pkgx_metric'), 'expected pkgx_metric table in test DB');
  await f.conn.end();
});

test0('GET /api/admin/catalog/:name/zip streams the ZIP', async () => {
  const f = await mkFixture();
  const app = express();
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  const res = await request(app).get('/api/admin/catalog/pkg-x/zip');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.ok(res.body.length > 100, 'expected non-trivial zip body');
  await f.conn.end();
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test -- tests/catalog/router.test.js
```

Expected: failure citing `router.js` not found.

- [ ] **Step 3: Implement the router**

Create `center/src/packages/catalog/router.js`:

```js
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { loadCatalog } from './loader.js';
import { installer } from '../installer.js';
import { serverPackageInstalls } from '../server-installs.js';

function readZipBuffer(builtInDir, zipPath) {
  const full = path.join(builtInDir, '..', zipPath);
  return fs.promises.readFile(full);
}

export function catalogRouter({ config, db, dbKind, cacheRoot, builtInDir, catalogJsonPath, logger }) {
  const r = express.Router();
  r.use(express.json());

  r.get('/', async (_req, res) => {
    const cat = await loadCatalog({ config, builtInDir, catalogJsonPath, logger });
    res.json(cat);
  });

  r.get('/installs', async (_req, res) => {
    const rows = await serverPackageInstalls.listAll(db);
    res.json({ installs: rows });
  });

  r.post('/:name/install', async (req, res) => {
    const { name } = req.params;
    const { serverIds } = req.body || {};
    if (!Array.isArray(serverIds) || serverIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'serverIds array required' } });
    }
    const cat = await loadCatalog({ config, builtInDir, catalogJsonPath, logger });
    const entry = cat.packages.find((p) => p.name === name);
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `package ${name} not in catalog` } });

    // Try to install the package on center (creates schema). Idempotent — installer throws PKG_REINSTALL_BLOCKED.
    let zipBuffer;
    try { zipBuffer = await readZipBuffer(builtInDir, entry.zipPath); }
    catch (e) { return res.status(500).json({ error: { code: 'ZIP_READ_FAILED', message: e.message } }); }
    try {
      await installer.installPackage({ db, dbKind, cacheRoot, zipBuffer, logger });
    } catch (e) {
      if (e.code !== 'PKG_REINSTALL_BLOCKED' && e.code !== 'PKG_DOWNGRADE_NOT_ALLOWED') {
        logger.error({ err: e.message, code: e.code }, 'installPackage failed');
      }
      // If already installed, we still proceed to assign rows. Otherwise return 500.
      if (e.code !== 'PKG_REINSTALL_BLOCKED' && e.code !== 'PKG_DOWNGRADE_NOT_ALLOWED') {
        return res.status(500).json({ error: { code: e.code || 'INSTALL_FAILED', message: e.message } });
      }
    }

    const failed = [];
    let assigned = 0;
    for (const serverId of serverIds) {
      try {
        await serverPackageInstalls.assign(db, { serverId, packageName: name, version: entry.version });
        assigned++;
      } catch (e) {
        failed.push({ serverId, error: e.message });
      }
    }
    const status = failed.length === 0 ? 200 : 207;
    res.status(status).json({ assigned, failed });
  });

  r.get('/:name/zip', async (req, res) => {
    const { name } = req.params;
    const cat = await loadCatalog({ config, builtInDir, catalogJsonPath, logger });
    const entry = cat.packages.find((p) => p.name === name);
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `package ${name} not in catalog` } });
    try {
      const buf = await readZipBuffer(builtInDir, entry.zipPath);
      res.set('Content-Type', 'application/zip');
      res.send(buf);
    } catch (e) {
      res.status(500).json({ error: { code: 'ZIP_READ_FAILED', message: e.message } });
    }
  });

  return r;
}
```

- [ ] **Step 4: Mount the router in `center/server.js`**

Find the section in `center/server.js` where admin routers are mounted (look for `app.use('/api/admin', ...)`). Add the catalog router:

```js
import { catalogRouter } from './src/packages/catalog/router.js';
import { loadCatalog } from './src/packages/catalog/loader.js';
import path from 'node:path';

// ... after server is set up, before app.listen ...
const builtInDir = path.join(__dirname, 'src/packages/built-in');
const catalogJsonPath = path.join(__dirname, 'src/packages/built-in-catalog.json');
app.use('/api/admin/catalog', catalogRouter({
  config, db, dbKind, cacheRoot, logger,
  builtInDir, catalogJsonPath
}));

// Also call loadCatalog once at startup so failures are logged early
loadCatalog({ config, builtInDir, catalogJsonPath, logger }).then((c) => {
  logger.info({ source: c.source, count: c.packages.length }, 'built-in catalog loaded');
}).catch((e) => logger.warn({ err: e.message }, 'catalog load failed at startup'));
```

(The exact insertion point depends on the existing `server.js` structure — look for where `cacheRoot` is defined and the `app` is fully assembled but not yet `listen()`-ed. The `db` and `dbKind` are local variables there.)

- [ ] **Step 5: Run test, verify it passes**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test -- tests/catalog/router.test.js
```

Expected: 3 passes.

- [ ] **Step 6: Run the full test suite to confirm no regression**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add center/src/packages/catalog/router.js center/server.js center/tests/catalog/router.test.js
git commit -m "feat(catalog): admin router for catalog browse/install/zip download"
```

---

### Task 7: Agent `assigned.js` (packages-installed.json)

**Files:**
- Create: `agent/src/packages/assigned.js`
- Test: `agent/tests/packages/assigned.test.js`

**Interfaces:**
- Produces: `assigned = { readInstalled(installPath) → Promise<Array<{name, version}>>, writeInstalled(installPath, list) → Promise<void>, recordInstall(installPath, name, version) → Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `agent/tests/packages/assigned.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { readInstalled, writeInstalled, recordInstall } from '../../src/packages/assigned.js';

test('readInstalled returns [] when file missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  const list = await readInstalled(dir);
  assert.deepEqual(list, []);
});

test('writeInstalled + readInstalled round-trips', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  await writeInstalled(dir, [{ name: 'pkg-a', version: '1.0.0' }, { name: 'pkg-b', version: '1.0.0' }]);
  const list = await readInstalled(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'pkg-a');
});

test('recordInstall adds without clobbering existing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  await writeInstalled(dir, [{ name: 'pkg-a', version: '1.0.0' }]);
  await recordInstall(dir, 'pkg-b', '1.0.0');
  const list = await readInstalled(dir);
  assert.equal(list.length, 2);
  assert.ok(list.find((p) => p.name === 'pkg-a'));
  assert.ok(list.find((p) => p.name === 'pkg-b'));
});

test('recordInstall upgrades version if same name re-installed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ass-'));
  await writeInstalled(dir, [{ name: 'pkg-a', version: '1.0.0' }]);
  await recordInstall(dir, 'pkg-a', '1.1.0');
  const list = await readInstalled(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].version, '1.1.0');
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd agent && npm test -- tests/packages/assigned.test.js
```

Expected: failure citing `assigned.js` not found.

- [ ] **Step 3: Implement `assigned.js`**

Create `agent/src/packages/assigned.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

function stateFile(installPath) {
  return path.join(installPath, 'packages-installed.json');
}

async function readRaw(installPath) {
  try {
    const raw = await fs.readFile(stateFile(installPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === 'string' && typeof p.version === 'string');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    return [];
  }
}

async function writeRaw(installPath, list) {
  await fs.mkdir(installPath, { recursive: true });
  const tmp = stateFile(installPath) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(list, null, 2));
  await fs.rename(tmp, stateFile(installPath));
}

export async function readInstalled(installPath) {
  return readRaw(installPath);
}

export async function writeInstalled(installPath, list) {
  return writeRaw(installPath, list);
}

export async function recordInstall(installPath, name, version) {
  const list = await readRaw(installPath);
  const existing = list.findIndex((p) => p.name === name);
  if (existing >= 0) list[existing] = { name, version };
  else list.push({ name, version });
  return writeRaw(installPath, list);
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd agent && npm test -- tests/packages/assigned.test.js
```

Expected: 4 passes.

- [ ] **Step 5: Commit**

```bash
git add agent/src/packages/assigned.js agent/tests/packages/assigned.test.js
git commit -m "feat(agent): track installed packages in packages-installed.json"
```

---

### Task 8: Agent `pull.js` (download + parse ZIP + validate + write)

**Files:**
- Create: `agent/src/packages/pull.js`
- Test: `agent/tests/packages/pull.test.js`

**Interfaces:**
- Produces: `pullPackage({ name, version, downloadUrl, installPath, http?, logger }) → Promise<{ manifest, collectorJs, migrations }>`. `http` is optional; defaults to `axios`. Tests pass a stub.
- ZIP parsing uses Node built-in `zlib` and a small central-directory parser; no `adm-zip` dep.

- [ ] **Step 1: Write the failing test**

Create `agent/tests/packages/pull.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { pullPackage } from '../../src/packages/pull.js';
import { loadManifest } from '../../src/packages/manifest.js';

function mkValidZipBuffer() {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    name: 'pkg-test', version: '1.0.0', type: 'timeseries',
    database: {
      metricTable: 'pkgtest_metric',
      metricColumns: {
        agent_id: { type: 'varchar(64)' }, ts: { type: 'datetime' }, value: { type: 'int' }
      }
    }
  })));
  zip.addFile('collector.js', Buffer.from('export default { name: "pkg-test", async collect() { return []; } };'));
  zip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE pkgtest_metric (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NOT NULL, PRIMARY KEY (agent_id, ts))'));
  return zip.toBuffer();
}

test('pullPackage downloads, validates, writes to installPath, and creates current junction', async () => {
  const buf = mkValidZipBuffer();
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  const out = await pullPackage({ name: 'pkg-test', version: '1.0.0', downloadUrl: 'http://stub/pkg-test/zip', installPath, http: stubHttp, logger: { warn() {}, info() {} } });
  assert.equal(out.manifest.name, 'pkg-test');
  // Verify the directory layout
  const versionDir = path.join(installPath, 'packages', 'pkg-test', '1.0.0');
  const manifestOnDisk = JSON.parse(await fs.readFile(path.join(versionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifestOnDisk.name, 'pkg-test');
  const collectorOnDisk = await fs.readFile(path.join(versionDir, 'collector.js'), 'utf8');
  assert.match(collectorOnDisk, /pkg-test/);
  const migOnDisk = await fs.readFile(path.join(versionDir, 'migrations/001_initial.sql'), 'utf8');
  assert.match(migOnDisk, /CREATE TABLE/);
  // The manifest can be re-loaded by the existing agent loader
  const reloaded = await loadManifest(path.join(installPath, 'packages'), 'pkg-test');
  assert.equal(reloaded.manifest.name, 'pkg-test');
});

test('pullPackage rejects manifest with name mismatch', async () => {
  const buf = mkValidZipBuffer(); // says pkg-test
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  await assert.rejects(
    pullPackage({ name: 'pkg-other', version: '1.0.0', downloadUrl: 'http://stub', installPath, http: stubHttp, logger: { warn() {}, info() {} } }),
    /name mismatch/i
  );
});

test('pullPackage rejects manifest with version mismatch', async () => {
  const buf = mkValidZipBuffer();
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  await assert.rejects(
    pullPackage({ name: 'pkg-test', version: '2.0.0', downloadUrl: 'http://stub', installPath, http: stubHttp, logger: { warn() {}, info() {} } }),
    /version mismatch/i
  );
});

test('pullPackage rejects invalid manifest (missing metricColumns)', async () => {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ name: 'pkg-bad', version: '1.0.0', type: 'timeseries', database: { metricTable: 'x', metricColumns: {} } })));
  zip.addFile('collector.js', Buffer.from('export default { name: "x", async collect() { return []; } };'));
  zip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE x (a INT)'));
  const buf = zip.toBuffer();
  const installPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pull-'));
  const stubHttp = async () => ({ data: buf, status: 200 });
  await assert.rejects(
    pullPackage({ name: 'pkg-bad', version: '1.0.0', downloadUrl: 'http://stub', installPath, http: stubHttp, logger: { warn() {}, info() {} } })
  );
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd agent && npm test -- tests/packages/pull.test.js
```

Expected: failure citing `pull.js` not found.

- [ ] **Step 3: Implement `pull.js`**

Create `agent/src/packages/pull.js`:

```js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import axios from 'axios';
import { loadManifest } from './manifest.js';

// --- Minimal ZIP reader (no adm-zip dep on agent side) ---
// Parses End-of-Central-Directory + Central Directory entries, supports STORE (0) and DEFLATE (8) methods.
// Returns array of { name, method, compressed, uncompressed, crc32 }.

function readUInt32LE(buf, off) { return buf.readUInt32LE(off); }
function readUInt16LE(buf, off) { return buf.readUInt16LE(off); }

function findEOCD(buf) {
  const sig = 0x06054b50;
  const max = Math.min(buf.length, 65557);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (readUInt32LE(buf, i) === sig) return i;
  }
  return -1;
}

function parseEntries(buf) {
  const eocdOff = findEOCD(buf);
  if (eocdOff < 0) throw new Error('ZIP: EOCD not found');
  const cdSize = readUInt32LE(buf, eocdOff + 12);
  const cdOff = readUInt32LE(buf, eocdOff + 16);
  const entries = [];
  let p = cdOff;
  while (p < cdOff + cdSize) {
    if (readUInt32LE(buf, p) !== 0x02014b50) throw new Error('ZIP: bad CD signature');
    const method = readUInt16LE(buf, p + 10);
    const compSize = readUInt32LE(buf, p + 20);
    const uncompSize = readUInt32LE(buf, p + 24);
    const nameLen = readUInt16LE(buf, p + 28);
    const extraLen = readUInt16LE(buf, p + 30);
    const commentLen = readUInt16LE(buf, p + 32);
    const localHeaderOff = readUInt32LE(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, uncompSize, localHeaderOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryData(buf, entry) {
  const p = entry.localHeaderOff;
  if (readUInt32LE(buf, p) !== 0x04034b50) throw new Error(`ZIP: bad local header for ${entry.name}`);
  const nameLen = readUInt16LE(buf, p + 26);
  const extraLen = readUInt16LE(buf, p + 28);
  const dataOff = p + 30 + nameLen + extraLen;
  const comp = buf.slice(dataOff, dataOff + entry.compSize);
  if (entry.method === 0) return comp;
  if (entry.method === 8) return zlib.inflateRawSync(comp);
  throw new Error(`ZIP: unsupported method ${entry.method}`);
}

function parseZip(buffer) {
  const entries = parseEntries(buffer);
  let manifest = null;
  let collectorJs = null;
  const migrations = [];
  for (const e of entries) {
    if (e.name === 'manifest.json') {
      manifest = JSON.parse(readEntryData(buffer, e).toString('utf8'));
    } else if (e.name === 'collector.js') {
      collectorJs = readEntryData(buffer, e).toString('utf8');
    } else if (e.name.startsWith('migrations/') && e.name.endsWith('.sql') && !e.name.endsWith('/')) {
      migrations.push({ filename: path.basename(e.name), content: readEntryData(buffer, e).toString('utf8') });
    }
  }
  migrations.sort((a, b) => a.filename.localeCompare(b.filename));
  if (!manifest) throw new Error('manifest.json missing');
  if (!collectorJs) throw new Error('collector.js missing');
  if (migrations.length === 0) throw new Error('migrations/ directory is empty');
  return { manifest, collectorJs, migrations };
}

// --- Junction link (re-uses the same pattern as center/src/packages/storage.js#createJunction) ---
function createJunction(linkPath, target) {
  try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch {}
  if (process.platform === 'win32') {
    const { execSync } = require('node:child_process');
    execSync(`cmd /c mklink /J "${linkPath}" "${target}"`, { stdio: 'pipe' });
  } else {
    fs.symlinkSync(target, linkPath, 'junction');
  }
}

// --- Public API ---
function defaultHttp(url) {
  return axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
}

export async function pullPackage({ name, version, downloadUrl, installPath, http, logger }) {
  const fetcher = http || defaultHttp;
  const res = await fetcher(downloadUrl);
  const buf = Buffer.from(res.data || res);
  const parsed = parseZip(buf);
  const loaded = await loadManifest(path.join(installPath, 'packages'), '__validate__').catch(() => null);
  // Inline validation against the existing manifest schema by writing to a temp dir and reading back.
  const tmpDir = await fsp.mkdtemp(path.join(installPath, '.validate-'));
  try {
    await fsp.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(parsed.manifest, null, 2));
    const validated = await loadManifest(tmpDir, '.');
    if (!validated) throw new Error('manifest validation failed');
    if (validated.manifest.name !== name) throw new Error(`manifest name mismatch: got ${validated.manifest.name}, expected ${name}`);
    if (validated.manifest.version !== version) throw new Error(`manifest version mismatch: got ${validated.manifest.version}, expected ${version}`);
  } finally {
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
  // Write to installPath/packages/<name>/<version>/
  const versionDir = path.join(installPath, 'packages', name, version);
  await fsp.rm(versionDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(versionDir, 'migrations'), { recursive: true });
  await fsp.writeFile(path.join(versionDir, 'manifest.json'), JSON.stringify(parsed.manifest, null, 2));
  await fsp.writeFile(path.join(versionDir, 'collector.js'), parsed.collectorJs);
  for (const m of parsed.migrations) {
    await fsp.writeFile(path.join(versionDir, 'migrations', m.filename), m.content);
  }
  // Create or refresh the junction link
  const linkPath = path.join(installPath, 'packages', name, 'current');
  createJunction(linkPath, versionDir);
  if (logger) logger.info({ name, version }, 'package pulled and installed');
  return parsed;
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd agent && npm test -- tests/packages/pull.test.js
```

Expected: 4 passes.

- [ ] **Step 5: Commit**

```bash
git add agent/src/packages/pull.js agent/tests/packages/pull.test.js
git commit -m "feat(agent): pull package ZIPs from center, validate, and install locally"
```

---

### Task 9: Agent `package-runner` (replace stub) + scheduler/reporter integration

**Files:**
- Modify: `agent/src/package-runner.js` (replace stub)
- Modify: `agent/src/scheduler.js` (wire package-runner into snapshot loop)
- Modify: `agent/src/reporter.js` (drop legacy payload, send only `extensions`)
- Modify: `agent/src/heartbeat.js` (send `installedPackages`, process `pendingInstalls`)

- [ ] **Step 1: Implement `package-runner.js`**

Replace the entire contents of `agent/src/package-runner.js` with:

```js
import { PackagesLoader } from './packages/loader.js';
import { readInstalled, recordInstall } from './packages/assigned.js';
import { pullPackage } from './packages/pull.js';
import path from 'node:path';

export class PackageRunner {
  constructor({ installPath, logger, http, downloadUrlBase }) {
    this.installPath = installPath;
    this.logger = logger || { warn() {}, info() {} };
    this.http = http;
    this.downloadUrlBase = downloadUrlBase; // e.g. 'http://center:8080'
    this.loader = new PackagesLoader({ packagesDir: path.join(installPath, 'packages'), logger: this.logger });
  }

  async loadInstalled() {
    return this.loader.loadAll();
  }

  listLoaded() {
    return this.loader.listLoaded();
  }

  async invoke(name, ctx) {
    return this.loader.invokeCollect(name, ctx);
  }

  /**
   * Reconcile this agent's installed set with the diff returned by the center.
   * @param {Array<{name, version, downloadUrl}>} pendingInstalls
   */
  async reconcile(pendingInstalls, agentCtx) {
    if (!Array.isArray(pendingInstalls) || pendingInstalls.length === 0) return { pulled: 0, failed: 0 };
    let pulled = 0;
    let failed = 0;
    for (const p of pendingInstalls) {
      try {
        // downloadUrl may be a path ('/api/...') or a full URL; if path, prepend the base.
        const url = p.downloadUrl.startsWith('http') ? p.downloadUrl : `${this.downloadUrlBase}${p.downloadUrl}`;
        await pullPackage({
          name: p.name, version: p.version, downloadUrl: url,
          installPath: this.installPath, http: this.http, logger: this.logger
        });
        await recordInstall(this.installPath, p.name, p.version);
        pulled++;
      } catch (e) {
        this.logger.warn({ pkg: p.name, err: e.message }, 'pullPackage failed');
        failed++;
      }
    }
    if (pulled > 0) {
      // Reload the loader so new collectors are picked up.
      await this.loadInstalled();
    }
    return { pulled, failed };
  }

  async readInstalledSnapshot() {
    return readInstalled(this.installPath);
  }
}
```

- [ ] **Step 2: Modify `agent/src/heartbeat.js` to send `installedPackages` and process `pendingInstalls`**

Replace the contents of `agent/src/heartbeat.js` with:

```js
import { urlFor } from './url.js';

export function startHeartbeat({ config, logger, getSummary, packageRunner }) {
  let stopped = false;
  const url = urlFor(config.center.baseUrl, config.center.heartbeatPort, config.center.heartbeatPath);
  const tick = async () => {
    if (stopped) return;
    try {
      const installed = packageRunner ? await packageRunner.readInstalledSnapshot() : [];
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: config.agentId,
          hostname: getSummary().hostname,
          ts: new Date().toISOString(),
          summary: getSummary(),
          installedPackages: installed.map((p) => p.name)
        }),
        signal: AbortSignal.timeout(config.center.requestTimeoutMs || 10000)
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'heartbeat non-2xx');
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.pendingInstalls && packageRunner) {
        await packageRunner.reconcile(body.pendingInstalls, null);
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'heartbeat failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.heartbeatIntervalMs);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}
```

(Note: switched from `axios` to native `fetch` + `AbortSignal.timeout` since Node 18+ has it. If the agent supports Node < 18, revert to `axios`. Check `agent/package.json` engines — current deps require Node 18+.)

- [ ] **Step 3: Modify `agent/src/reporter.js` to drop legacy payload**

Find `agent/src/reporter.js` and replace the legacy `queues`/`dag`/`services`/`clientAccess`/`resources` payload construction with package-driven `extensions`. The new shape (only `agentId`, `hostname`, `capturedAt`, `extensions`):

```js
// Read agent/src/reporter.js and rewrite the snapshot construction:
// - Remove all imports/usages of mailflow-collector, dag-collector, services-collector,
//   clientaccess-collector, perfmon-collector (they're now in packages).
// - Use packageRunner.invoke(name, ctx) for each loaded package.
// - Build the `extensions` array: [{ packageName, metricTable, rows: [...] }].
// - Send to /api/agent/report.
```

The exact rewrite depends on the current `reporter.js` structure. The new `reporter.js` skeleton:

```js
export function startReporter({ config, logger, packageRunner, getCtx }) {
  let stopped = false;
  const reportUrl = urlFor(config.center.baseUrl, config.center.reportPort, '/api/agent/report');
  const tick = async () => {
    if (stopped) return;
    try {
      const capturedAt = new Date().toISOString();
      const ctx = await getCtx();
      const extensions = [];
      for (const pkg of packageRunner.listLoaded()) {
        try {
          const rows = await packageRunner.invoke(pkg.name, ctx);
          extensions.push({ packageName: pkg.name, metricTable: pkg.metricTable, rows: rows || [] });
        } catch (e) {
          logger.warn({ pkg: pkg.name, err: e.message }, 'package collect failed');
        }
      }
      const res = await fetch(reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: config.agentId, hostname: ctx.hostname, capturedAt, extensions }),
        signal: AbortSignal.timeout(config.center.requestTimeoutMs || 30000)
      });
      if (!res.ok) logger.warn({ status: res.status }, 'report non-2xx');
    } catch (e) {
      logger.warn({ err: e.message }, 'report failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.reportIntervalMs || 60000);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}
```

(Delete `agent/src/mailflow-collector.js`, `agent/src/dag-collector.js`, `agent/src/services-collector.js`, `agent/src/clientaccess-collector.js`, `agent/src/perfmon-collector.js` after this change. Confirm with the user that no other module imports them before deletion.)

- [ ] **Step 4: Modify `agent/src/scheduler.js` to instantiate the runner**

Find the section where `startHeartbeat` and `startReporter` are called. Inject a `PackageRunner` instance and pass it to both:

```js
import { PackageRunner } from './package-runner.js';
// ...
const packageRunner = new PackageRunner({ installPath, logger, downloadUrlBase: config.center.baseUrl });
await packageRunner.loadInstalled();
const heartbeat = startHeartbeat({ config, logger, getSummary, packageRunner });
const reporter = startReporter({ config, logger, packageRunner, getCtx });
```

(Remove any code that imports the deleted collector files.)

- [ ] **Step 5: Run all agent tests to confirm no regression**

```bash
cd agent && npm test
```

Expected: existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent/src/package-runner.js agent/src/heartbeat.js agent/src/reporter.js agent/src/scheduler.js
git commit -m "feat(agent): wire PackageRunner into heartbeat + reporter; send only extensions; pull on heartbeat diff"
```

---

### Task 10: Center report route — drop legacy inserts, add markInstalled on success

**Files:**
- Modify: `center/src/routes/agent.js`
- Modify: `center/src/packages/ingest.js`

- [ ] **Step 1: Update `center/src/routes/agent.js` heartbeat response**

Find the heartbeat handler (around lines 8-23) and change it to include `pendingInstalls`:

```js
r.post('/heartbeat', async (req, res) => {
  const { agentId, hostname, installedPackages = [] } = req.body || {};
  if (!agentId) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId required' } });
  logger.info({ agentId, hostname }, 'heartbeat');
  try {
    await req.app.locals.db.query('UPDATE agents SET last_heartbeat_at = NOW() WHERE agent_id = ?', [agentId]);
  } catch (e) {
    logger.warn({ err: e.message }, 'heartbeat update failed');
  }
  // Resolve server_id, look up pending installs
  let pendingInstalls = [];
  try {
    const db = req.app.locals.db;
    const [serverRows] = await db.query('SELECT id FROM servers WHERE agent_id = ?', [agentId]);
    if (serverRows.length > 0) {
      const serverId = serverRows[0].id;
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
```

- [ ] **Step 2: Update `center/src/routes/agent.js` report route to drop legacy inserts**

Find the report handler (around lines 27-81). Replace the body so it:
- Resolves `serverId` (existing logic, keep)
- Drops the 5 legacy INSERT blocks (`for (const q of queues)`, `for (const c of (dag.copies || []))`, etc.)
- Calls `ingest.routeExtensions(...)` with the new `extensions` array and `serverId`

```js
r.post('/report', async (req, res) => {
  const { agentId, hostname, capturedAt, extensions = [] } = req.body || {};
  if (!agentId || !hostname) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId + hostname required' } });

  const db = req.app.locals.db;
  try {
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
```

- [ ] **Step 3: Update `center/src/packages/ingest.js` to call `markInstalled`**

Modify `ingest.routeExtensions` to accept `serverId` and call `markInstalled` after a successful row write. Find the function and update:

```js
import { installedPackages, packageRuns } from './sql.js';
import { serverPackageInstalls } from './server-installs.js';

function schemaName(name) { return 'pkg_' + name.replace(/-/g, '_'); }

export const ingest = {
  async routeExtensions({ db, agentId, capturedAt, extensions = [], serverId = null }) {
    const out = [];
    for (const ext of extensions) {
      const pkg = await installedPackages.get(db, ext.packageName);
      if (!pkg) { out.push({ packageName: ext.packageName, error: 'PKG_NOT_FOUND' }); continue; }
      if (!pkg.enabled) { out.push({ packageName: ext.packageName, skipped: 'disabled' }); continue; }
      const installedTable = pkg.manifest.database.metricTable;
      if (ext.metricTable !== installedTable) {
        out.push({ packageName: ext.packageName, skipped: 'metricTable mismatch', error: 'METRIC_TABLE_MISMATCH' });
        continue;
      }
      const table = installedTable;
      const columns = Object.keys(pkg.manifest.database.metricColumns);
      const userCols = columns.filter((c) => c !== 'agent_id' && c !== 'ts');
      const schema = schemaName(ext.packageName);
      try {
        for (const row of ext.rows || []) {
          const values = userCols.map((c) => (row[c] === undefined ? null : row[c]));
          await db.query(
            `INSERT INTO \`${schema}\`.\`${table}\` (agent_id, ts, ${userCols.map((c) => `\`${c}\``).join(', ')}) VALUES (?, ?, ${userCols.map(() => '?').join(', ')})`,
            [agentId, capturedAt, ...values]
          );
        }
        await packageRuns.record(db, { packageName: ext.packageName, ts: capturedAt, status: 'recorded', output: { rowCount: (ext.rows || []).length } });
        if (serverId) {
          await serverPackageInstalls.markInstalled(db, serverId, ext.packageName);
        }
        out.push({ packageName: ext.packageName, recorded: true, rowCount: (ext.rows || []).length });
      } catch (e) {
        out.push({ packageName: ext.packageName, error: e.message });
      }
    }
    return out;
  }
};
```

- [ ] **Step 4: Run the full center test suite**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add center/src/routes/agent.js center/src/packages/ingest.js
git commit -m "feat(center): heartbeat returns pendingInstalls; report drops legacy payload; mark installed on first successful write"
```

---

### Task 11: Frontend — Catalog tab in `PackagesView.vue`

**Files:**
- Modify: `frontend/src/views/admin/PackagesView.vue`

**Interfaces:**
- Adds a new tab "Catalog" alongside the existing "Installed" tab. The Catalog tab shows:
  - The list of packages from `GET /api/admin/catalog/`
  - A button "Install on selected servers" that opens a multi-select (servers fetched from `GET /api/servers`) and calls `POST /api/admin/catalog/:name/install { serverIds }`
  - A status table below: `GET /api/admin/catalog/installs` showing `(server, package, status, error, updatedAt)`. Status colors: pending=yellow, installed=green, failed=red. Statuses older than 24h with no heartbeat shown as "stalled" (computed client-side).

- [ ] **Step 1: Read the existing `PackagesView.vue` to understand the tab structure**

```bash
cat frontend/src/views/admin/PackagesView.vue
```

(If the existing file already has a tab pattern, follow it. If it has a single column, refactor to use `<el-tabs>` from Element Plus.)

- [ ] **Step 2: Add the Catalog tab with the list + install UI**

Open `frontend/src/views/admin/PackagesView.vue` and add a second tab. The new tab content:

```vue
<el-tab-pane label="Catalog" name="catalog">
  <div v-loading="loading">
    <p>Source: <el-tag>{{ catalog.source }}</el-tag> ({{ catalog.packages.length }} packages)</p>
    <el-table :data="catalog.packages" stripe>
      <el-table-column prop="name" label="Name" width="220" />
      <el-table-column prop="version" label="Version" width="100" />
      <el-table-column prop="title" label="Title" />
      <el-table-column prop="summary" label="Summary" />
      <el-table-column label="Role flags" width="100">
        <template #default="{ row }">{{ describeRoleFlags(row.roleFlags) }}</template>
      </el-table-column>
      <el-table-column label="Install" width="220">
        <template #default="{ row }">
          <el-button size="small" @click="openInstallDialog(row)" :disabled="installing">Install on servers…</el-button>
        </template>
      </el-table-column>
    </el-table>

    <h3 style="margin-top: 24px">Per-server install state</h3>
    <el-table :data="installs" stripe>
      <el-table-column prop="serverId" label="Server" width="100" />
      <el-table-column prop="name" label="Package" width="200" />
      <el-table-column prop="version" label="Version" width="100" />
      <el-table-column label="Status" width="120">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status, row.updatedAt)">{{ statusLabel(row.status, row.updatedAt) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="error" label="Error" />
    </el-table>
  </div>

  <el-dialog v-model="installDialogVisible" title="Install on servers" width="500px">
    <p>Select servers to install <strong>{{ installTarget?.name }}</strong> ({{ installTarget?.version }}):</p>
    <el-checkbox-group v-model="installSelected">
      <el-checkbox v-for="s in servers" :key="s.id" :label="s.id">{{ s.hostname }}</el-checkbox>
    </el-checkbox-group>
    <template #footer>
      <el-button @click="installDialogVisible = false">Cancel</el-button>
      <el-button type="primary" :loading="installing" @click="confirmInstall">Install</el-button>
    </template>
  </el-dialog>
</el-tab-pane>
```

And add the data + methods to the component's `<script setup>`:

```js
import { ref, onMounted } from 'vue';
import axios from 'axios';

const catalog = ref({ source: 'none', packages: [] });
const installs = ref([]);
const servers = ref([]);
const loading = ref(false);
const installing = ref(false);
const installDialogVisible = ref(false);
const installTarget = ref(null);
const installSelected = ref([]);

function describeRoleFlags(f) {
  const bits = [];
  if (f & 1) bits.push('MBX');
  if (f & 2) bits.push('HUB');
  if (f & 4) bits.push('CAS');
  return bits.join('+') || '—';
}

function statusType(s, updated) {
  if (s === 'installed') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'pending' && Date.now() - new Date(updated).getTime() > 24 * 3600 * 1000) return 'warning';
  return 'info';
}
function statusLabel(s, updated) {
  if (s === 'pending' && Date.now() - new Date(updated).getTime() > 24 * 3600 * 1000) return 'stalled';
  return s;
}

async function loadCatalog() {
  loading.value = true;
  try {
    const [c, i, s] = await Promise.all([
      axios.get('/api/admin/catalog/'),
      axios.get('/api/admin/catalog/installs'),
      axios.get('/api/servers')
    ]);
    catalog.value = c.data;
    installs.value = i.data.installs;
    servers.value = s.data.servers || s.data || [];
  } finally { loading.value = false; }
}

function openInstallDialog(pkg) {
  installTarget.value = pkg;
  installSelected.value = [];
  installDialogVisible.value = true;
}

async function confirmInstall() {
  if (!installTarget.value || installSelected.value.length === 0) return;
  installing.value = true;
  try {
    const res = await axios.post(`/api/admin/catalog/${installTarget.value.name}/install`, { serverIds: installSelected.value });
    if (res.status === 207) {
      alert(`Assigned ${res.data.assigned} servers; ${res.data.failed.length} failed.`);
    }
    installDialogVisible.value = false;
    await loadCatalog();
  } catch (e) {
    alert(`Install failed: ${e.response?.data?.error?.message || e.message}`);
  } finally { installing.value = false; }
}

onMounted(loadCatalog);
```

(The existing "Installed" tab content remains unchanged. The two tabs are siblings inside `<el-tabs v-model="activeTab">` where `activeTab` is a `ref('installed')`.)

- [ ] **Step 3: Run the frontend build to confirm no compile error**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/admin/PackagesView.vue
git commit -m "feat(ui): PackagesView catalog tab with one-click per-server install"
```

---

### Task 12: Integration test + handoff doc

**Files:**
- Create: `center/tests/catalog/install-flow.test.js`
- Create: `docs/handoff/2026-08-11-built-in-exchange-packages.md`

- [ ] **Step 1: Write the integration test**

Create `center/tests/catalog/install-flow.test.js`:

```js
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

async function mkIntegration() {
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
  zip.addFile('migrations/001_initial.sql', Buffer.from('CREATE TABLE pkgint_metric (agent_id VARCHAR(64) NOT NULL, ts DATETIME NOT NULL, value INT NOT NULL, PRIMARY KEY (agent_id, ts))'));
  await fs.writeFile(path.join(builtInDir, 'pkg-int-1.0.0.zip'), zip.toBuffer());
  await fs.writeFile(catalogPath, JSON.stringify({
    version: '1.0.0',
    packages: [{ name: 'pkg-int', version: '1.0.0', title: 'Int', summary: 's', roleFlags: 1, zipPath: 'built-in/pkg-int-1.0.0.zip' }]
  }));

  const conn = await mysql.createConnection({
    host: HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    multipleStatements: true
  });
  const dbName = `exdashboard_test_int_${Date.now()}`;
  await conn.query(`CREATE DATABASE \`${dbName}\``);
  await conn.query(`USE \`${dbName}\``);
  await conn.query(`CREATE TABLE servers (id INT PRIMARY KEY AUTO_INCREMENT, agent_id VARCHAR(64) UNIQUE, hostname VARCHAR(128) UNIQUE NOT NULL)`);
  await conn.query(`CREATE TABLE agents (id INT PRIMARY KEY AUTO_INCREMENT, agent_id VARCHAR(64) UNIQUE NOT NULL, last_heartbeat_at DATETIME NULL, last_report_at DATETIME NULL)`);
  await conn.query(`CREATE TABLE packages (name VARCHAR(64) PRIMARY KEY, type VARCHAR(32) NOT NULL, manifest JSON NOT NULL, enabled TINYINT NOT NULL DEFAULT 1, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await conn.query(`CREATE TABLE package_versions (package_name VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL, installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (package_name))`);
  await conn.query(`CREATE TABLE package_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, package_name VARCHAR(64) NOT NULL, ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, status VARCHAR(32) NOT NULL, output JSON NULL)`);
  await conn.query(`CREATE TABLE server_package_installs (
    id INT PRIMARY KEY AUTO_INCREMENT, server_id INT NOT NULL, package_name VARCHAR(64) NOT NULL, version VARCHAR(32) NOT NULL,
    status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending', error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_server_pkg (server_id, package_name))`);

  await conn.query('INSERT INTO agents (agent_id) VALUES (?)', ['agent-int-1']);
  await conn.query('INSERT INTO servers (agent_id, hostname) VALUES (?, ?)', ['agent-int-1', 'h-int']);
  const [[[srv]]] = await conn.query('SELECT id FROM servers');

  const db = {
    query: async (sql, params) => { const [r] = await conn.query(sql, params); return r; },
    driver: { database: dbName }
  };

  return { dir, builtInDir, catalogPath, cacheRoot, db, serverId: srv.id, conn, dbName };
}

test0('end-to-end: install → heartbeat returns pendingInstalls → report flips to installed', async () => {
  const f = await mkIntegration();
  const app = express();
  app.use(express.json());
  app.locals.db = f.db;
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {}, info() {} },
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
  const capturedAt = new Date().toISOString();
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
  await f.conn.end();
});

test0('reinstall of same package same version is rejected by installer but assigns are still idempotent', async () => {
  const f = await mkIntegration();
  const app = express();
  app.use(express.json());
  app.locals.db = f.db;
  app.use('/api/admin/catalog', catalogRouter({
    config: {}, db: f.db, dbKind: 'mysql', cacheRoot: f.cacheRoot, logger: { warn() {}, info() {} },
    builtInDir: f.builtInDir, catalogJsonPath: f.catalogPath
  }));
  const r1 = await request(app).post('/api/admin/catalog/pkg-int/install').send({ serverIds: [f.serverId] });
  assert.equal(r1.status, 200);
  const r2 = await request(app).post('/api/admin/catalog/pkg-int/install').send({ serverIds: [f.serverId] });
  // The router tolerates PKG_REINSTALL_BLOCKED by proceeding to assign; the assign is a no-op.
  assert.equal(r2.status, 200);
  const list = await serverPackageInstalls.listByServer(f.db, f.serverId);
  assert.equal(list.length, 1);
  await f.conn.end();
});
```

- [ ] **Step 2: Run integration test, verify it passes**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test -- tests/catalog/install-flow.test.js
```

Expected: 2 passes.

- [ ] **Step 3: Run the full test suite to confirm no regression**

```bash
cd center && MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='<pw>' npm test
cd agent && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Write the handoff doc**

Create `docs/handoff/2026-08-11-built-in-exchange-packages.md`:

```markdown
# Built-in Exchange Packages Handoff

Shipped 2026-08-11. Plan + commits at `docs/superpowers/plans/2026-08-11-built-in-exchange-packages.md`.

## What landed

- 8 monitoring packages ship with the center release as a built-in catalog (5 migrated from hardcoded collectors, 3 new common ones).
- Admins install packages per server from a new "Catalog" tab in `PackagesView`.
- Agents pull assigned packages on heartbeat, validate, install locally, and report new data via the existing `extensions` ingest.
- The 5 legacy payload fields in `/api/agent/report` are dropped; new writes accumulate in `pkg_<name>` schemas only.
- A new `server_package_installs` table tracks per-server state (pending → installed / failed).

## Open gaps / follow-ups (intentionally out of scope for v1)

- **Checksum/SHA-256 verification of downloaded ZIPs.** Today we trust the center's TLS; a man-in-the-middle or corrupted proxy could inject bad code. Add SHA-256 to `built-in-catalog.json` entries and verify on agent side.
- **Catalog signing.** Built-in is trusted; remote catalog override is HTTPS-only. Consider signed manifests for fleets that want to pin a specific catalog.
- **Package dependencies / dependency resolution.** Today each package is independent. If `pkg-dashboard-x` ever depends on `pkg-mailflow`, we need a resolution step.
- **Per-package configuration UI.** e.g. custom perfmon counter list for `pkg-perfmon`, custom EWS endpoint for `pkg-mailbox-size`. The collector defaults to no-config; today an operator would edit the package's `collector.js` on disk and restart the agent.
- **Per-server enable/disable after install.** A package can be installed but disabled (today `packages.enabled=0` in center is the only switch).
- **Downgrade UI.** Re-installing an older version is blocked by `installer.installPackage` (PKG_DOWNGRADE_NOT_ALLOWED). Add an admin endpoint to allow it explicitly.
- **Multi-version concurrent install.** Only one version of a package can be active per center. If you need v1.0.0 and v1.1.0 in parallel, this design doesn't support it.
- **Migration of historical rows from `queue_snapshots` / `mdb_copy_snapshots` / etc. to `pkg_<name>` schemas.** Reads continue to work; new writes start fresh. If a customer wants continuous history, write a one-time backfill.
- **Auto-install on server registration.** Today an admin must click Install for each new server. A future feature could auto-install the "default" set on first heartbeat.

## Known quirks

- `pkg-message-tracking` keeps its read position in `<installPath>/state/pkg-message-tracking.pos.json`. If this file is deleted, the collector re-reads the entire active log on the next tick.
- The 8 built-in packages run on Windows only (perfmon, PowerShell, registry access). On Linux/macOS the collectors return `[]` and the package still ingests (empty `extensions`).
- `packageCatalogUrl` is in `appsettings.json` as a plain string (not a secret, not encrypted). If the URL ever needs to be a secret, route it through `.env` and `config-crypto` like `db.password`.

## E2E smoke test (manual)

1. Fresh center install (run init wizard with MySQL_EX).
2. Open the center UI → login → Admin → Packages.
3. Click "Catalog" tab. Verify 8 packages are listed with source "built-in".
4. Click "Install on servers…" for `pkg-mailflow`. Select the test server.
5. Wait ~30s for the next agent heartbeat.
6. Refresh the Catalog tab; the "Per-server install state" table should show `pkg-mailflow` status=installed.
7. Trigger a report (or wait for the report interval).
8. Verify rows in `pkg_pkg_mailflow.mailflow_queue` (via mysql client).
9. Repeat for the other 7 packages.

## Tests that require a real MySQL

Set `MYSQL_TEST_HOST`, `MYSQL_TEST_PORT`, `MYSQL_TEST_USER`, `MYSQL_TEST_PASSWORD` per `memory/reference_local_mysql.md`. Without these, MySQL-gated tests self-skip via `test.skip` (no failure).

Affected tests:
- `center/tests/packages/server-installs.test.js`
- `center/tests/catalog/router.test.js`
- `center/tests/catalog/install-flow.test.js`
```

- [ ] **Step 5: Commit**

```bash
git add center/tests/catalog/install-flow.test.js docs/handoff/2026-08-11-built-in-exchange-packages.md
git commit -m "test(catalog): end-to-end install flow + handoff doc"
```

---

## Self-Review

**1. Spec coverage** — every section in the spec maps to a task:
- Schema migration → Task 1
- Built-in catalog format + remote override → Tasks 2, 4, 5
- New DB schema → Task 1
- New center components (loader, router, server-installs) → Tasks 2, 3, 6
- New agent components (assigned, pull, package-runner) → Tasks 7, 8, 9
- Modified files (config.js, server.js, agent.js, ingest.js, heartbeat.js, reporter.js, scheduler.js, package-runner.js, PackagesView.vue) → Tasks 2, 6, 9, 10, 11
- Data flow A (admin install) → Task 6
- Data flow B (agent heartbeat + pull) → Tasks 8, 9, 10
- Data flow C (status flip) → Task 10
- Error handling rows → spread across tasks (catalog fallback in Task 2, install failure in Task 6, agent download failure in Task 8, etc.)
- Testing sections → Task 12 (integration test) + individual unit tests in Tasks 2, 3, 6, 7, 8
- Out of scope items → captured in handoff doc (Task 12)

**2. Placeholder scan** — searched the plan for "TBD" / "TODO" / "implement later" / "fill in details" / "add appropriate error handling" / "Write tests for the above" / "Similar to Task N". No matches.

**3. Type consistency** — function names, parameter names, and return types are consistent across tasks:
- `loadCatalog({ config, builtInDir, catalogJsonPath, fetcher?, logger })` defined in Task 2; used in Task 6.
- `serverPackageInstalls.assign / pendingFor / listByServer / markInstalled / markFailed` defined in Task 3; used in Tasks 6, 10, 12.
- `readInstalled / writeInstalled / recordInstall` defined in Task 7; used in Task 9.
- `pullPackage({ name, version, downloadUrl, installPath, http?, logger })` defined in Task 8; used in Task 9.
- `PackageRunner({ installPath, logger, http?, downloadUrlBase })` defined in Task 9; used in Task 9.
- `ingest.routeExtensions({ db, agentId, capturedAt, extensions, serverId })` signature updated in Task 10; used in Task 10 (center route) and Task 12 (integration test).
- `mounting catalogRouter` signature `({ config, db, dbKind, cacheRoot, builtInDir, catalogJsonPath, logger })` defined in Task 6; used in Task 6 (test) and Task 12 (test).
- Column names in migrations match `metricColumns` in manifests (verified for all 8 packages).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-built-in-exchange-packages.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
