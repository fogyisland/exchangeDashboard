# Self-Contained Monitoring Packages — Design Spec (ExDashboard Plugin System v1)

**Date:** 2026-08-09
**Status:** Draft (pending user approval of written spec)
**Scope:** ExDashboard package system v1 — self-contained packages that ship their own DB schema
**Adapted from:** AD Dashboard `docs/superpowers/specs/2026-08-09-self-contained-monitoring-package-design.md` (full v2 with registry, upgrade flow, orphan tracking, full token scanner) — simplified for ExDashboard v1 per user choice.

## Goal

Enable admins to author **self-contained monitoring packages** that ship their own database schema and Node.js collector. Packages = manifest.json + collector.js + migrations/*.sql. Install creates a `pkg_<name>` schema in the center DB, applies the package's DDL, caches the files to disk. Uninstall drops the schema. The agent discovers installed packages, dynamic-imports each `collector.js`, and includes the rows in the existing report payload. Data flows into `pkg_<name>.<metricTable>`.

## Motivation

ExDashboard currently monitors Exchange Server surfaces via 5 built-in collectors (mailflow, dag, services, clientaccess, plus the perfmon helper). Adding new monitoring surfaces (e.g., Exchange transport log parsing, EWS mailbox size polling, third-party backup status, SQL transaction log growth) requires editing the agent and shipping a new release. This blocks ops teams that need to monitor domain-specific Exchange surfaces on their own cadence.

The package system lets an admin author a ZIP file locally and upload it via the admin UI. The package's DDL creates the storage tables; the package's collector produces the data. No agent release needed for new monitoring surfaces.

## Scope

**In scope:**
1. Package format: ZIP with `manifest.json` + `collector.js` + `migrations/*.sql`.
2. Manifest validation: ajv-strict JSON schema with `additionalProperties: false`.
3. DDL sandbox: regex-based blacklist + reserved-table/cross-schema/cross-package ban.
4. Schema-per-package: `pkg_<name>` namespace, fully owned by the package.
5. Install flow: validate manifest → scan DDL → CREATE SCHEMA → apply migrations → register → cache files.
6. Uninstall flow: confirm-drop checkbox → DROP SCHEMA → unregister → remove cache.
7. Data flow: agent's `getSnapshot()` includes `extensions: []` in the report payload; center routes to `pkg_<name>.<metricTable>`.
8. Frontend: PackagesView (list + upload), PackageEditView (show manifest + uninstall).
9. Tests: unit + integration (real MySQL via `TEST_MYSQL_URL`).

**Out of scope (deferred to follow-up plans):**
- No registry pull (admin UI upload only)
- No package upgrade flow (admin uninstalls + reinstalls)
- No package downgrade protection beyond blocking lower versions
- No `orphan_schemas` tracking table (failed DROP logged to `package_runs.error`)
- No code signing / Ed25519
- No full AD-style token scanner (regex blacklist only)
- No package marketplace
- No per-package permissions (any admin can install/uninstall)
- No automatic agent refresh on install (agent picks up new packages on next restart)
- No custom Vue widgets per package (data accessible via generic /admin/packages/:name view)

## Architecture

```
                     ┌──────────────────┐
                     │  Package ZIP     │
                     │  manifest.json   │
                     │  collector.js    │
                     │  migrations/     │
                     │  ├ 001.sql       │
                     │  └ 002.sql       │
                     └────────┬─────────┘
                              │ upload via admin UI
                              ▼
  ┌──────────────────────────────────────────────────────────┐
  │                       Center                              │
  │                                                           │
  │   installer.installPackage                                │
  │     1. validateManifest(manifest)                         │
  │     2. ddlSandbox.scanAll(migrationFiles)                 │
  │     3. verify 001_initial.sql CREATE TABLE matches        │
  │        manifest.database.metricColumns                    │
  │     4. db.execute("CREATE SCHEMA pkg_<name>")             │
  │     5. for each sqlFile:                                   │
  │          db.execute(sqlFile.content)                      │
  │     6. installedPackages.upsert(...)                      │
  │     7. cache files → center/data/packages/<name>/<ver>/  │
  │                                                           │
  │   ingest.routeExtensions                                   │
  │     for each extension:                                   │
  │       pkg = installedPackages.get(db, name)               │
  │       if !pkg || !pkg.enabled → skip                      │
  │       INSERT INTO pkg_<name>.<metricTable> (...)          │
  │       packageRuns.record(...)                             │
  │                                                           │
  │   installer.uninstallPackage                               │
  │     DROP SCHEMA pkg_<name> (best-effort)                  │
  │     installedPackages.delete + cache cleanup              │
  └──────────────────────────────────────────────────────────┘
                              │
                  package_runs INSERT (every run)
                              │
                              ▼
                     ┌──────────────────┐
                     │  pkg_<name>.     │
                     │  <metricTable>   │
                     └──────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Agent (per Exchange Server)                 │
│                                                                   │
│   packages/loader.js                                              │
│     - scan installPath/packages/<name>/current/                   │
│     - for each: read manifest.json, dynamic-import collector.js  │
│     - validate default export shape                              │
│                                                                   │
│   agent/agent.js getSnapshot()                                    │
│     for each loaded package:                                      │
│       Promise.race([pkg.collect(), timeout])                    │
│       append {packageName, metricTable, rows} to extensions     │
└─────────────────────────────────────────────────────────────────┘
```

## Package format

### ZIP layout

```
my-exchange-monitor-1.0.0.zip
├── manifest.json          # required
├── collector.js           # required — Node.js ESM module
├── migrations/            # required (at least 001)
│   ├── 001_initial.sql
│   └── 002_add_swap.sql   # optional
└── README.md              # optional
```

### `manifest.json` shape

```jsonc
{
  "name": "exchange-transport-log-monitor",   // required, ^[a-z][a-z0-9-]{2,40}$
  "version": "1.0.0",                          // required, semver
  "description": "Parses Exchange transport logs and reports stuck message count",
  "author": "ops@corp.local",                  // optional
  "type": "timeseries",                        // required: gauge|counter|timeseries|status

  "database": {
    "metricTable": "transport_log_metrics",     // required, ^[a-z][a-z0-9_]{2,40}$
    "metricColumns": {                         // required — type declarations
      "agent_id":           { "type": "varchar(64)", "nullable": false },
      "ts":                 { "type": "datetime",    "nullable": false },
      "stuck_count":        { "type": "int",         "nullable": false },
      "oldest_age_seconds": { "type": "int",         "nullable": true },
      "log_file_path":      { "type": "varchar(255)","nullable": true }
    }
  },

  "agent": {                                   // optional — agent-side hints
    "intervalSec": 60,
    "timeoutMs": 30000
  },

  "dependencies": []                            // optional — other package names
}
```

**Validation rules (ajv strict, `additionalProperties: false`):**
1. `name` matches `^[a-z][a-z0-9-]{2,40}$`
2. `version` matches semver `\d+\.\d+\.\d+(-[a-z0-9]+)?`
3. `type` ∈ `{gauge, counter, timeseries, status}`
4. `database.metricTable` matches `^[a-z][a-z0-9_]{2,40}$` AND is NOT in reserved-table list
5. `metricColumns` MUST contain `agent_id` (varchar(64) NOT NULL) and `ts` (datetime NOT NULL); other columns may be `nullable: true/false` (default true)
6. Column types must be in canonical vocabulary: `varchar(n)`, `char(n)`, `text`, `int`, `integer`, `bigint`, `smallint`, `tinyint`, `double`, `float`, `decimal(p,s)`, `numeric(p,s)`, `datetime`, `timestamp`, `date`, `boolean`, `bit`, `json`

### Reserved table names (cannot be used as `metricTable`)

```
packages, package_runs, package_versions, users, agents, servers, dags,
dag_members, mdb_catalog, queue_snapshots, mdb_copy_snapshots,
service_states, client_access_snapshots, server_resources,
mailflow_summaries, mailflow_errors, dag_replication_matrix,
heartbeat_events, audit_log, system_config, roles, user_roles, schema_migrations
```

### `collector.js` contract

```js
// Required default export — shape-validated on load
export default {
  name: 'exchange-transport-log-monitor',   // must match manifest.name

  async collect({ config, logger }) {
    // Author code: read transport logs, parse, return rows
    return {
      rows: [
        { stuck_count: 12, oldest_age_seconds: 340, log_file_path: 'C:\\Exchange\\TransportRoles\\logs\\...' }
        // ...
      ]
    };
  },

  async init({ config, logger }) { /* optional, called once on agent startup */ }
};
```

### `migrations/*.sql` files

- Plain SQL, applied in lexical order (`001_*.sql`, `002_*.sql`, ...)
- `001_initial.sql` MUST contain `CREATE TABLE <metricTable>` whose columns exactly match `metricColumns` (case-insensitive, whitespace-insensitive)
- Subsequent files: `ALTER TABLE ADD COLUMN/INDEX/CONSTRAINT`, `CREATE INDEX`, etc.
- Every file scanned by `ddl-sandbox.js` before apply

## Schema-per-package

**Naming:** `pkg_<name-with-dashes-as-underscores>`. e.g., `exchange-transport-log-monitor` → `pkg_exchange_transport_log_monitor`. Fixed by `manifest.name` to prevent squatting.

**Per-package `schema_migrations` table** (created by installer before applying user migrations):

```sql
CREATE TABLE IF NOT EXISTS <schemaName>.schema_migrations (
  filename    VARCHAR(255) NOT NULL PRIMARY KEY,
  version     VARCHAR(32)  NOT NULL,
  applied_at  DATETIME     NOT NULL
);
```

## DDL sandbox (`center/src/packages/ddl-sandbox.js`)

```js
const BLOCKED_PATTERNS = [
  /\bDROP\b/i,                                          // uninstall handles DROP explicitly
  /\b(TRUNCATE|RENAME|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b/i,               // DML UPDATE: <table> SET ...; must NOT match ON UPDATE CASCADE
  /\bDELETE\s+FROM\b/i,
  /\bMERGE\b/i,
  // SELECT: blocked everywhere — even inside CREATE VIEW (views not supported in v1)
  /\bSELECT\b/i,
  /;\s*\S/,                                             // multi-statement
  // Cross-schema ban: cannot reference any reserved table
  /\b(packages|package_runs|package_versions|users|agents|servers|dags|dag_members|mdb_catalog|queue_snapshots|mdb_copy_snapshots|service_states|client_access_snapshots|server_resources|mailflow_summaries|mailflow_errors|dag_replication_matrix|heartbeat_events|audit_log|system_config|roles|user_roles|schema_migrations)\b/i,
  // Cross-package ban
  /\bpkg_[a-z0-9_]+\./i,
];

export function scanSql(sql) {
  if (typeof sql !== 'string') return { ok: false, blocked: 'non-string input' };
  // Strip comments AND string literals first so reserved words inside them don't trigger blocks.
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')                   // /* ... */ block comments
    .replace(/--[^\n]*/g, '')                            // -- line comments
    .replace(/'(?:[^']|'')*'/g, "''")                    // 'string' literals (SQL standard doubled-quote escape)
    .replace(/"(?:""|[^"])*"/g, '""');                   // "quoted identifiers"
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(stripped)) return { ok: false, blocked: re.source };
  }
  return { ok: true };
}
```

**Allowed:** CREATE TABLE/SCHEMA/INDEX, ALTER TABLE ADD COLUMN/INDEX/CONSTRAINT, all standard DDL keywords, FK clauses including `ON UPDATE CASCADE` / `ON DELETE CASCADE`, CHECK constraints, default values, comments on columns/tables.

**Not allowed in v1:** CREATE VIEW (would require SELECT — banned), CREATE TRIGGER (would require DML inside body), CREATE FUNCTION/PROCEDURE (requires EXECUTE privilege + body DML).

**Blocked:** any DML (INSERT/UPDATE/DELETE/MERGE/SELECT), DROP/TRUNCATE/RENAME, GRANT/REVOKE, EXEC/CALL, multi-statement, any reserved-table reference, any cross-package `pkg_*.` reference, any reserved keyword inside string literals or comments (preprocessor strips these first).

**Trade-off acknowledged:** regex-based sandbox is less rigorous than AD's full token-by-token scanner. A package could craft a CREATE TABLE with edge-case syntax that slips past a regex but causes the DB to fail. We accept this for v1 — worst case is install fails and rollback DROP SCHEMA cleans up. The package's `collector.js` is in-process JS; any bug is contained by the agent's try/catch (Node ESM default has no eval / no fs.write / no network calls allowed by default — but author code can require those).

## Install flow

```
1. validateManifest(manifest)                     // ajv strict
2. check !installedPackages.get(db, name)         // PKG_NAME_CONFLICT
3. existing = installedPackages.get(db, name)
   if existing && existing.version >= manifest.version:
     PKG_REINSTALL_BLOCKED (or PKG_DOWNGRADE_NOT_ALLOWED)
4. for each migration file:
     ddlSandbox.scanSql(content)                  // PKG_DDL_FORBIDDEN on first fail
5. parse 001_initial.sql, extract CREATE TABLE for <metricTable>,
   compare columns against metricColumns         // PKG_SCHEMA_MISMATCH
6. begin DB transaction
7. db.execute("CREATE SCHEMA <pkg_<name>>")
     MySQL: CREATE DATABASE IF NOT EXISTS <name> DEFAULT CHARACTER SET utf8mb4
     MSSQL: CREATE SCHEMA <name>
8. db.execute("CREATE TABLE IF NOT EXISTS <schemaName>.schema_migrations (...)")
9. for each migration:
     try db.execute(content)
     catch (e):
       rollback; best-effort DROP SCHEMA <name>
       throw PkgError('PKG_INSTALL_FAILED', e.message, 500)
     db.execute("INSERT INTO <schemaName>.schema_migrations (...)")
10. installedPackages.upsert({name, version, manifest, enabled: true, installedAt: now})
11. packageVersions.upsert({name, version, installedAt: now})
12. packageRuns.record({name, status: 'installed', ts: now})
13. cache files to center/data/packages/<name>/<version>/{manifest.json, collector.js, migrations/}
    create junction: center/data/packages/<name>/current → <version>
14. write audit_log entry
15. commit transaction
16. return { name, version }
```

## Uninstall flow

```
1. existing = installedPackages.get(db, name)
   if !existing → 404 PKG_NOT_FOUND
2. if !query.confirmDropSchema → 400 PKG_CONFIRM_REQUIRED
3. begin transaction
4. try db.execute("DROP SCHEMA <pkg_<name>>")
     MySQL: DROP DATABASE <name>
     MSSQL: DROP SCHEMA <name>
   catch (e):
     logger.warn({ err: e.message, name }, 'DROP SCHEMA failed — continuing uninstall')
     packageRuns.record({name, status: 'uninstall-drop-failed', error: e.message})
5. installedPackages.delete(db, name)
6. packageVersions.delete(db, name)
7. packageRuns.record({name, status: 'uninstalled', ts: now})
8. fs.rmSync(`center/data/packages/<name>`, { recursive: true, force: true })
9. write audit_log entry
10. commit transaction
11. return { ok: true }
```

**Note:** failed DROP does not block uninstall. Failed DROP is logged to `package_runs.error` for admin follow-up. No separate `orphan_schemas` table in v1.

## Data flow

### Agent side (`agent/agent.js`)

```js
import { PackagesLoader } from './src/packages/loader.js';

const packagesLoader = new PackagesLoader({ installPath: cfg.installPath });
await packagesLoader.loadAll();

const getSnapshot = async () => {
  // ... existing 5 collectors ...

  const extensions = [];
  for (const pkg of packagesLoader.listLoaded()) {
    try {
      const result = await Promise.race([
        pkg.collect({ config: cfg, logger }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('collect timeout')), pkg.timeoutMs || 30000))
      ]);
      const validRows = validateRows(result.rows, pkg.metricColumns, logger);
      extensions.push({ packageName: pkg.name, metricTable: pkg.metricTable, rows: validRows });
    } catch (e) {
      logger.warn({ err: e.message, pkg: pkg.name }, 'package collect failed');
      extensions.push({ packageName: pkg.name, metricTable: pkg.metricTable, rows: [] });
    }
  }

  return { agentId, hostname, capturedAt, queues, dag, services, clientAccess, resources, extensions };
};
```

### Center ingest (`center/src/routes/agent.js`)

```js
const { ..., extensions = [] } = req.body || {};
// existing ingest of queues/dag/services/clientAccess/resources unchanged
const extResults = await ingest.routeExtensions({ db, agentId, capturedAt, extensions });
res.status(202).json({ ok: true, extensions: extResults });
```

### Center `routeExtensions` (`center/src/packages/ingest.js`)

```js
export async function routeExtensions({ db, agentId, capturedAt, extensions }) {
  const out = [];
  for (const ext of extensions) {
    const pkg = await installedPackages.get(db, ext.packageName);
    if (!pkg) {
      out.push({ packageName: ext.packageName, error: 'PKG_NOT_FOUND' });
      continue;
    }
    if (!pkg.enabled) continue;  // silently skip disabled

    const schemaName = `pkg_${ext.packageName.replace(/-/g, '_')}`;
    const table = ext.metricTable;
    const columns = Object.keys(pkg.manifest.database.metricColumns);
    const userCols = columns.filter(c => c !== 'agent_id' && c !== 'ts');

    for (const row of ext.rows) {
      const values = userCols.map(c => row[c] ?? null);
      await db.execute(
        `INSERT INTO ${schemaName}.${table} (agent_id, ts, ${userCols.join(',')}) VALUES (?, ?, ${userCols.map(() => '?').join(',')})`,
        [agentId, capturedAt, ...values]
      );
    }
    await packageRuns.record(db, {
      packageName: ext.packageName,
      agentId,
      ts: capturedAt,
      status: 'recorded',
      rowCount: ext.rows.length
    });
    out.push({ packageName: ext.packageName, recorded: true, rowCount: ext.rows.length });
  }
  return out;
}
```

**Invariants:**
- `agent_id` always from JWT/agent header (NOT from package output)
- `ts` always from server clock (NOT from package output)
- Disabled packages silently skipped (no error, no data)
- Missing packages return `PKG_NOT_FOUND` in response but don't 500 the report

## Error codes (`center/src/packages/errors.js`)

```js
export class PkgError extends Error {
  constructor(code, message, httpStatus = 400, details = null) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
```

| Code | HTTP | Trigger |
|------|------|---------|
| `PKG_INVALID_ZIP` | 400 | Uploaded file not a valid ZIP |
| `PKG_INVALID_MANIFEST` | 400 | manifest.json missing or ajv validation failed |
| `PKG_NAME_CONFLICT` | 409 | Package with this name already installed |
| `PKG_REINSTALL_BLOCKED` | 409 | Re-uploading same version of installed package |
| `PKG_DOWNGRADE_NOT_ALLOWED` | 409 | Uploading lower version of installed package |
| `PKG_DDL_FORBIDDEN` | 400 | Sandbox scanner rejected a SQL file |
| `PKG_SCHEMA_MISMATCH` | 400 | 001_initial.sql CREATE TABLE doesn't match metricColumns |
| `PKG_INSTALL_FAILED` | 500 | Mid-install apply failure (schema dropped best-effort) |
| `PKG_UNINSTALL_FAILED` | 500 | installed_packages row removal failed |
| `PKG_CONFIRM_REQUIRED` | 400 | Uninstall without `confirmDropSchema=true` |
| `PKG_NOT_FOUND` | 404 | Uninstall/toggle on non-existent package |
| `PKG_METRIC_KEY_UNKNOWN` | 400 | Package sent a key not in metricColumns |
| `PKG_METRIC_TYPE_MISMATCH` | 400 | Column type coercion failed |
| `PKG_TIMEOUT` | 500 | collect() exceeded timeoutMs |

Error response shape:
```json
{ "error": { "code": "PKG_DDL_FORBIDDEN", "message": "...", "details": { "blocked": "\\bDROP\\b", "file": "001_initial.sql" } } }
```

## Database

Existing tables used as-is (already in `db/schema/001-initial.sql`):
- `packages` — installed package registry (`name` PK, `type`, `manifest` TEXT, `enabled`, `installed_at`)
- `package_runs` — install/run history (`id`, `package_name`, `ts`, `status`, `output` TEXT)
- `package_versions` — version history (PK `package_name + version`)

No new tables needed. Each package's data lives in `pkg_<name>.<metricTable>` (created at install time).

## API surface

### Admin (`/api/admin/packages/*`) — requires `requireAuth`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/packages/install` | multipart/form-data, field `file` = ZIP. Returns `{ok, name, version}` |
| GET | `/api/admin/packages` | List installed packages |
| GET | `/api/admin/packages/:name` | Get manifest + install info for one package |
| DELETE | `/api/admin/packages/:name?confirmDropSchema=true` | Uninstall + drop schema |
| POST | `/api/admin/packages/:name/enable` | Set `enabled=1` |
| POST | `/api/admin/packages/:name/disable` | Set `enabled=0` |

### Agent (`/api/agent/packages`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agent/packages` | List enabled packages (so agent can sync its in-memory loader) — **optional in v1**; agent reads from local cache only |

**v1 simplification:** agent reads installed packages from local cache (`installPath/packages/<name>/current/`). No agent↔center sync endpoint needed in v1. The PackagesList endpoint can be added later if multi-agent consistency becomes important.

## File Structure

### New files

**Center (8 source + 5 tests):**
- `center/src/packages/errors.js` — PkgError + code constants
- `center/src/packages/manifest.js` — ajv schema + validateManifest()
- `center/src/packages/ddl-sandbox.js` — scanSql() regex scanner
- `center/src/packages/storage.js` — ZIP parse, cache extract, junction creation
- `center/src/packages/installer.js` — installPackage + uninstallPackage
- `center/src/packages/ingest.js` — routeExtensions
- `center/src/packages/router.js` — Express router for /api/admin/packages/*
- `center/src/packages/sql.js` — installedPackages, packageRuns, packageVersions helpers
- `center/tests/packages/ddl-sandbox.test.js`
- `center/tests/packages/manifest.test.js`
- `center/tests/packages/storage.test.js`
- `center/tests/packages/installer.test.js` (gated on TEST_MYSQL_URL)
- `center/tests/packages/ingest.test.js` (gated on TEST_MYSQL_URL)
- `center/tests/packages/router.test.js`

**Agent (2 source + 2 tests):**
- `agent/src/packages/manifest.js` — manifest loader (re-uses schema from center conceptually, but duplicated to avoid center→agent dep)
- `agent/src/packages/loader.js` — scan install dir, dynamic-import collector.js, validate default export
- `agent/tests/packages/manifest.test.js`
- `agent/tests/packages/loader.test.js`

**Frontend (2 views + 1 component + 1 test file):**
- `frontend/src/views/admin/PackagesView.vue` — replace existing placeholder with real implementation (list + upload)
- `frontend/src/views/admin/PackageEditView.vue` — replace existing placeholder with real implementation (show manifest + uninstall with confirm modal)
- `frontend/src/components/PackageUpload.vue` — file picker
- `frontend/src/api/packages.js` — extend with upload/get/uninstall/list methods
- `frontend/tests/views/admin/PackagesView.test.js`
- `frontend/tests/components/PackageUpload.test.js`

### Modified files

- `agent/agent.js` — load packages, include `extensions` in `getSnapshot()`
- `agent/reporter.js` — pass through `extensions` (no change needed if snapshot shape flows through)
- `center/src/routes/agent.js` — read `extensions` from report body, call `ingest.routeExtensions`
- `center/server.js` — mount `packagesRouter` under `/api/admin/packages`
- `frontend/src/router.js` — confirm stub `PackagesView`/`PackageEditView` placeholder imports now resolve to real implementations
- `HANDOFF.md` — add package-system section to "What Works" and a new entry to "Known Limitations"

## Testing

### Center unit (no DB)

- `ddl-sandbox.test.js` — 14+ tests covering whitelist patterns, blacklist regex, multi-statement, FK allowance (`ON UPDATE CASCADE` / `ON DELETE CASCADE`), comment stripping (`--` and `/* */`), string-literal stripping (e.g., `DEFAULT 'drop me'` does NOT trigger DROP block), cross-schema, cross-package, every reserved-table reference, all BLOCKED_PATTERNS, CREATE VIEW rejection (SELECT banned)
- `manifest.test.js` — 10+ tests covering ajv strict validation, name/version/type/column validation, reserved-name rejection, missing agent_id/ts, wrong type vocabulary
- `storage.test.js` — 4+ tests covering ZIP parse, manifest extraction, migration file enumeration (lexical order), missing required files
- `router.test.js` — 6+ tests covering install happy path, uninstall happy path, error responses, confirmDropSchema required, missing file, malformed ZIP

### Center integration (real MySQL, gated on `TEST_MYSQL_URL`)

- `installer.test.js` — 5+ tests: install creates schema + tables + rows in `packages`/`package_runs`/`package_versions`, install fail on bad DDL (schema dropped best-effort), install fail on schema mismatch (schema dropped), uninstall drops schema + removes rows, uninstall without confirm = 400
- `ingest.test.js` — 4+ tests: routeExtensions writes rows to `pkg_<name>.<metricTable>`, handles missing package (PKG_NOT_FOUND), handles disabled package (silently skip), records `package_runs` row

### Agent unit

- `manifest.test.js` — 4+ tests covering manifest loading, name/version/column validation
- `loader.test.js` — 5+ tests covering load-all happy path, missing collector.js (warn + skip), bad default export (warn + skip), timeout enforcement, row validation against metricColumns

### Frontend

- `PackagesView.test.js` — 3+ tests: empty state, list of installed packages, upload button calls API
- `PackageUpload.test.js` — 3+ tests: file picker accepts .zip, shows upload progress, displays server error on PKG_DDL_FORBIDDEN

**Total new tests:** ~55 tests across center + agent + frontend

## Out-of-scope (deferred)

These are deliberately deferred to follow-up plans:

1. **No registry pull** — admin UI upload only
2. **No upgrade flow** — admin uninstalls + reinstalls (PKG_REINSTALL_BLOCKED enforces this)
3. **No `orphan_schemas` table** — failed DROP logged to `package_runs.error`
4. **No code signing** — admin trusts the upload
5. **No full AD-style token scanner** — regex blacklist only
6. **No package marketplace**
7. **No per-package permissions** — any admin can install/uninstall
8. **No automatic agent refresh** — agent picks up new packages on next restart
9. **No custom Vue widgets per package** — data accessible via generic /admin/packages/:name view
10. **No package dependencies resolution** — `dependencies` field accepted but ignored in v1
11. **No dual-dialect migrations** — package ships one set of SQL files (works on both MySQL and MSSQL via the dialect layer; if package needs dialect-specific syntax, can fork at install time using `dbKind`)
12. **No time-series retention policies per package** — global retention purge doesn't touch `pkg_*` schemas; packages own their retention

## Known limitations (will be documented in HANDOFF.md)

1. No package upgrade — admin must uninstall + reinstall
2. DDL sandbox is regex-based, not as rigorous as AD's token scanner
3. No automatic agent refresh — agent reads packages on startup
4. No per-package permissions
5. Failed DROP SCHEMA on uninstall leaves the schema; admin must drop manually via `DROP DATABASE pkg_<name>` or `DROP SCHEMA pkg_<name>`

## Migration / rollout

- **Existing installations:** no schema changes needed. The 3 tables (`packages`, `package_runs`, `package_versions`) already exist in `db/schema/001-initial.sql` (shipped with the original 32-task plan).
- **New installations:** same — tables created by `001-initial.sql`.
- **No breaking changes:** all existing endpoints, schemas, agent behavior, admin UI elements unchanged.
- **First ship:** the package system ships as opt-in (admin must explicitly upload a package to use it).

## Compatibility

- **v1 packages** (AD's old "extend shared metric tables" model): not supported in ExDashboard. ExDashboard's built-in tables are Exchange-specific, so the v1 model doesn't map cleanly. If needed in future, can be added as a v2 of this spec.
- **Existing built-in collectors** (mailflow, dag, services, clientaccess): unchanged. They write to the existing `queue_snapshots`, `mdb_copy_snapshots`, `service_states`, `client_access_snapshots`, `server_resources` tables as before.
- **Agent startup:** `packagesLoader.loadAll()` is called once at startup. If no packages installed, it's a no-op (returns empty list). Agent behavior unchanged.

## Trust model

- **No code signing.** Admin is responsible for vetting packages before upload.
- **DDL sandbox** blocks the most common classes of accidental damage (DROP, DML, cross-schema, cross-package). It does NOT substitute for trust — a malicious author who controls a package can still write a CREATE TABLE that fills the disk.
- **Admin UI surfaces a banner on install:** "未签名包 — install 前请审查 manifest + migrations".
- **In-process collector.js** runs in the agent's Node.js process. A malicious collector could read arbitrary files, make network calls, etc. Trust assumption: admin only uploads packages from trusted authors.
- **No fs.write / no child_process restrictions in v1.** If a stricter sandbox is needed later, can wrap collector.js in a worker_threads isolate or VM2 context.

## Open questions / backlog

1. Code signing of packages (Ed25519 public-key allow-list)
2. Upgrade flow with DDL diff application
3. Full AD-style token scanner (whitelist + blacklist)
4. orphan_schemas tracking table for failed uninstall drops
5. Per-package permissions (RBAC scope)
6. Package marketplace / author CLI
7. Cross-package JOIN (full-qualified `pkg_<name>.<table>` references)
8. Automatic agent refresh on install (push notification from center → agent)
9. Custom Vue widgets per package
10. Time-series retention policies per package
11. Dual-dialect migrations per package