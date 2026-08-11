# Built-in Exchange Packages Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into a task-by-task implementation plan.

**Goal:** Ship 8 Exchange monitoring packages (5 migrated from hardcoded collectors + 3 new common ones) as a built-in catalog with the center release, and let admins install them onto individual servers in one click.

**Architecture:** Add a catalog layer on top of the existing self-contained monitoring package system. Built-in catalog (8 ZIPs + a JSON manifest) ships with the center release; `EXDASHBOARD_PACKAGE_CATALOG_URL` overrides it. Center stores per-server install state in a new `server_package_installs` table. Agent pulls assigned packages on heartbeat, validates, installs locally, and reports new data via the existing `extensions` ingest.

**Tech Stack:** Node `crypto` / `fs` / `node:https` (built-in). No new npm deps.

## Global Constraints

- **No new deps.** `adm-zip` already in `center/`. Agent HTTP via existing `axios`.
- **Built-in catalog is trusted** — no signing/verification. Remote catalog override is HTTPS only and only points at the manifest; ZIPs always come from the center's own `built-in/` directory.
- **Per-server install, shared schema.** One center install creates one `pkg_<name>` MySQL schema; many servers write into it (each with its own `agent_id`). Center's `installer.installPackage` runs on the center, not the agent.
- **Agent only sends `extensions` after migration.** The 5 legacy `queues`/`dag`/`services`/`clientAccess`/`resources` fields in `/api/agent/report` are dropped. The legacy tables stay for reads (historical data, existing UI views) but receive no new writes.
- **No data migration.** Historical rows in `queue_snapshots` / `mdb_copy_snapshots` / `service_states` / `client_access_snapshots` / `server_resources` stay put. New writes accumulate in `pkg_<name>` schemas from install time forward.
- **YAGNI.** No package config UI, no per-server enable/disable, no dependency resolution, no downgrade UI, no multi-version concurrent install. One installed version per package per center, applies to all servers assigned.
- **Schema migrations are additive.** `001-initial.sql` already exists. New `002-server-package-installs.sql` is the only schema change.

## Package Set (8 total)

5 migrated (replacements for the existing hardcoded collectors in `agent/src/*-collector.js`):

| Package name | Version | Role flags | metricTable | Interval (s) | Source |
|---|---|---|---|---|---|
| `pkg-mailflow` | 1.0.0 | Mailbox + HubTransport (3) | `mailflow_queue` | 60 | migrates `mailflow-collector.js` |
| `pkg-dag` | 1.0.0 | Mailbox (1) | `mdb_copy_status` | 120 | migrates `dag-collector.js` |
| `pkg-services` | 1.0.0 | any (7) | `windows_service` | 60 | migrates `services-collector.js` |
| `pkg-clientaccess` | 1.0.0 | ClientAccess (4) | `rpc_latency` | 60 | migrates `clientaccess-collector.js` |
| `pkg-perfmon` | 1.0.0 | any (7) | `host_resources` | 60 | migrates `perfmon-collector.js` (CPU, mem, disk) |

3 new:

| Package name | Version | Role flags | metricTable | Interval (s) | Source |
|---|---|---|---|---|---|
| `pkg-mailbox-size` | 1.0.0 | Mailbox (1) | `mailbox_quota` | 600 | EWS-equivalent via local Exchange Management Shell: `Get-MailboxStatistics` per database, totalItemSize + itemCount |
| `pkg-message-tracking` | 1.0.0 | HubTransport (2) | `tracking_event_counts` | 60 | tail `C:\Program Files\Microsoft\Exchange Server\V15\TransportRoles\Logs\MessageTracking\*.LOG`, bucket by event_id, count per minute |
| `pkg-hub-backpressure` | 1.0.0 | HubTransport (2) | `hub_queue_pressure` | 60 | perfmon `\SMTP Server\Current Queue Length` + `\MSExchangeTransport Queues(_total)\*` + `Get-Queue` age of oldest message |

Role flags bitfield: Mailbox=1, HubTransport=2, ClientAccess=4. The agent filters which packages to load based on its own `serverRole` from `discovery.js` (e.g., a pure Mailbox server doesn't try to load `pkg-message-tracking`).

## Catalog Format

`center/src/packages/built-in-catalog.json`:

```json
{
  "version": "1.0.0",
  "updatedAt": "2026-08-11",
  "packages": [
    {
      "name": "pkg-mailflow",
      "version": "1.0.0",
      "title": "Mailflow Transport Queues",
      "summary": "Per-queue length + throughput from MSExchangeTransport perfmon counters",
      "roleFlags": 3,
      "zipPath": "built-in/pkg-mailflow-1.0.0.zip"
    }
  ]
}
```

`zipPath` is relative to `center/src/packages/built-in/`. ZIPs are checked into git (each ~10KB; total <100KB).

## Remote Catalog Override

`appsettings.json` gains an optional field:

```json
{
  "packageCatalogUrl": "https://updates.example.com/exdashboard/catalog.json"
}
```

(not a secret — no encryption; it's a public URL or internal one)

`catalog/loader.js` (new) behavior:
1. If `packageCatalogUrl` is set, `https.get` with 5s timeout, parse JSON, validate each entry's `name` (regex `^[a-z][a-z0-9-]{2,40}$`) and `version` (semver).
2. For each entry, check that `zipPath` resolves to a file inside `built-in/`. If not, skip the entry with a warn log.
3. If the fetch fails, log warn and fall back to built-in catalog.
4. If neither resolves, return `{ source: 'none', packages: [] }` — UI shows "no catalog configured".

The remote catalog can gate availability (turn packages on/off across a fleet) but cannot inject new code — only ZIPs physically present in the center's `built-in/` directory are offered.

## New DB Schema

`db/schema/002-server-package-installs.sql`:

```sql
CREATE TABLE server_package_installs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  server_id INT NOT NULL,
  package_name VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending',
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_server_pkg (server_id, package_name),
  KEY idx_status (status, server_id),
  CONSTRAINT fk_spi_server FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);
```

## New Components

### `center/src/packages/catalog/loader.js`

- `loadCatalog({ configPath, builtInDir }) → { source, packages }`
- Reads `built-in-catalog.json` (always)
- If `config.packageCatalogUrl` set, merges in remote entries (after per-entry validation)
- Returns `packages` as the union (remote entries override built-in by `name`)
- Idempotent — call freely; no caching needed at this level

### `center/src/packages/catalog/router.js`

Mounted on the admin router (`/api/admin/catalog`):

- `GET /` → `{ source, packages: [...] }`
- `POST /:name/install` body `{ serverIds: number[] }` → for each serverId, run `installer.installPackage(zipBuffer)` once (creates schema), then `assign` per-server. Returns `{ assigned: number, failed: [{ serverId, error }] }`. HTTP 207 if any failed.
- `GET /:name/zip` → streams the ZIP from `built-in/`. Requires admin auth. Used by agent pull.
- `GET /installs` → `[{ serverId, packageName, version, status, error, updatedAt }]` for the UI status table

### `center/src/packages/server-installs.js`

CRUD on `server_package_installs`:

```js
export const serverPackageInstalls = {
  async assign(db, { serverId, packageName, version }) { /* INSERT IGNORE */ },
  async pendingFor(db, serverId) { /* SELECT WHERE status='pending' AND server_id=? */ },
  async listByServer(db, serverId) { /* SELECT all */ },
  async markInstalled(db, serverId, packageName) { /* UPDATE */ },
  async markFailed(db, serverId, packageName, error) { /* UPDATE */ }
};
```

### `agent/src/packages/assigned.js`

- `readInstalled(agentId) → string[]` — reads `<installPath>/packages-installed.json` (a JSON array of `{ name, version }`); returns `[]` on missing file
- `writeInstalled(agentId, list) → void` — atomic write (tmp + rename)
- `recordInstall(agentId, name, version) → void` — adds entry, writes

### `agent/src/packages/pull.js`

```js
export async function pullPackage({ name, version, downloadUrl, installPath, logger }) {
  const buffer = await downloadZip(downloadUrl);
  const parsed = parseZip(buffer);  // reused from center/src/packages/storage.js (re-implement minimal in agent)
  const { value: manifest } = validateManifest(parsed.manifest);
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`manifest name/version mismatch: got ${manifest.name}@${manifest.version}`);
  }
  // Write to installPath/packages/<name>/<version>/{manifest.json, collector.js, migrations/}
  // Create or update junction link <name>/current → <version>
  return { manifest, collectorJs: parsed.collectorJs, migrations: parsed.migrations };
}
```

The agent re-implements the minimal ZIP parser (no `adm-zip` on the agent — agent currently has zero npm deps, keep it that way). Use Node's built-in `zlib` for decompression. ZIP central directory parsing is ~100 lines.

## Modified Files

- `center/server.js` (or wherever the admin router is wired) — mount `catalog/router.js`
- `center/src/routes/agent.js` — heartbeat response includes `pendingInstalls`; report route drops the 5 legacy `INSERT` blocks (queues/dag/services/clientAccess/resources) and uses ONLY `ingest.routeExtensions`
- `center/src/packages/sql.js` — add `serverPackageInstalls` CRUD helpers (or new `server-installs.js` file)
- `agent/src/heartbeat.js` — send `installedPackages`; process `pendingInstalls` from response (call `pullPackage` for each)
- `agent/src/reporter.js` — drop legacy queue/dag/services/clientAccess/resources payload construction; collect all data from package collectors only
- `agent/src/package-runner.js` — currently a stub. Implement: read `packages-installed.json`, role-filter by agent's `serverRole`, return `[{ name, manifest, collectorJs }]` for each
- `agent/src/healthcheck.js` / `agent/src/scheduler.js` — integrate `package-runner` output into the collector loop (the existing `getSnapshot` extensions path already routes these through `ingest.routeExtensions` — verify wire compatibility)
- `frontend/src/views/admin/PackagesView.vue` — add a `Catalog` tab (existing tab is "Installed"); new tab shows catalog with one-click install UI; new section shows `installs` table
- `center/package.json` — add `tests/catalog/*.test.js` and `tests/packages/server-installs.test.js` to `npm test` glob
- `agent/package.json` — add `tests/packages/{assigned,pull}.test.js` to `npm test` glob

## Data Flow

**A. Admin browses catalog and installs:**
1. Admin → `GET /api/admin/catalog` → catalog list
2. Admin selects servers + package → `POST /api/admin/catalog/pkg-mailflow/install` `{ serverIds: [1,2,3] }`
3. Center: `installer.installPackage(zip)` once (creates `pkg_pkg_mailflow` schema + tables)
4. Center: `serverPackageInstalls.assign({ serverId, packageName, version })` for each (IGNORE on conflict)
5. UI: status table shows 3 rows in `pending`

**B. Agent heartbeat triggers pull:**
1. Agent: `POST /api/agent/heartbeat` body includes `installedPackages: ['pkg-mailflow', 'pkg-dag', ...]`
2. Center: `pendingFor(serverId)` → `[{ name: 'pkg-services', version: '1.0.0', downloadUrl: '...' }]`
3. Center response: `{ ok, pendingInstalls: [...] }`
4. Agent: for each entry, `GET <downloadUrl>` → ZIP bytes
5. Agent: `validateManifest`, write to disk, create junction link
6. Agent: `recordInstall(agentId, name, version)` → updates `packages-installed.json`
7. Next report: `package-runner` returns the new collector; data flows through `extensions`

**C. Status flip to `installed`:**
1. Agent's first report includes the new package's data
2. Center: `ingest.routeExtensions` writes rows; on success, `markInstalled(serverId, packageName)`
3. UI: status flips to `installed`

## Error Handling

| Condition | Behavior |
|---|---|
| Remote catalog fetch fails/timeout | Warn, fall back to built-in. UI badge "using built-in catalog". |
| Remote catalog entry's `zipPath` not in `built-in/` | Skip that entry, warn. UI shows "unavailable in this center version". |
| Center `installer.installPackage` throws | All `server_package_installs` rows for this install go to `status='failed'`. UI shows red badge with error. Admin can retry (re-POST same install). |
| Agent ZIP download fails (network) | Log warn, leave row `pending`. Next heartbeat retries. |
| Agent manifest validation fails | Log error, leave row `pending`. Agent refuses to load. |
| Agent reports data for package center has no record of | `ingest.routeExtensions` returns `error: 'PKG_NOT_FOUND'` for that ext (existing behavior, unchanged). No data loss. |
| Agent pulls but never reports (server offline) | Row stays `pending` indefinitely. UI marks `(now - updated_at) > 24h` AND no heartbeat from that server as "stalled". |
| Two admins install same package on same server simultaneously | UNIQUE constraint on `(server_id, package_name)`. One wins, other gets 409. |
| Agent's `installedPackages` includes a package the center doesn't know about (e.g., installed by a different center previously) | Center ignores (warn log). Agent still runs it locally; data still ingests via `extensions` (which will return `PKG_NOT_FOUND` for that ext — agent logs and continues). |

## Testing

**Unit** (`center/tests/catalog/loader.test.js`):
- Built-in catalog loads when `packageCatalogUrl` absent
- Remote catalog merges in when URL set + fetch OK
- Invalid remote entry (bad name/version) → skipped, others kept
- `zipPath` referring to missing file → entry skipped
- Fetch timeout → falls back to built-in
- Result is idempotent across multiple calls

**Unit** (`center/tests/packages/server-installs.test.js`):
- `assign` with duplicate `(serverId, packageName)` → no-op (INSERT IGNORE)
- `pendingFor(serverId)` returns only `pending` rows for that server
- `markInstalled` flips `pending → installed`; idempotent
- `markFailed` records error message

**Unit** (`agent/tests/packages/assigned.test.js`):
- `readInstalled` returns `[]` when file missing
- `writeInstalled` round-trips correctly
- `recordInstall` adds without clobbering existing entries

**Unit** (`agent/tests/packages/pull.test.js`):
- `pullPackage` rejects manifest with name mismatch
- `pullPackage` rejects manifest with version mismatch
- `pullPackage` writes correct directory layout: `<installPath>/packages/<name>/<version>/{manifest.json, collector.js, migrations/*.sql}`
- `pullPackage` creates/updates junction link `<name>/current` to `<version>`

**Integration** (`center/tests/catalog/install-flow.test.js`, requires real MySQL — see `feedback_mysql_test_env.md`):
- `POST /api/admin/catalog/pkg-mailflow/install { serverIds: [1,2] }` → schema `pkg_pkg_mailflow` exists, 2 rows in `server_package_installs` with `status='pending'`
- Heartbeat with empty `installedPackages` returns correct `pendingInstalls` list with valid download URLs
- Heartbeat after a successful report flips the row to `installed`
- Reinstall of same package same version → 409

**E2E manual smoke test** (doc'd in plan, runs against a real Exchange server):
1. Fresh center install, register one agent
2. Open PackagesView → Catalog tab
3. Click Install on all 8 packages for the agent's server
4. Wait for next heartbeat, verify `packages-installed.json` populated
5. Verify next report contains data for all 8 packages
6. Verify status table flips all rows to `installed`

## Out of Scope (Documented in Handoff)

- Checksum/SHA-256 verification of downloaded ZIPs
- Catalog signing (built-in is trusted; remote catalog uses HTTPS)
- Package dependencies / dependency resolution
- Per-package configuration UI (e.g., custom perfmon counter list for `pkg-perfmon`)
- Per-server enable/disable after install
- Downgrade UI (re-install older version)
- Multi-version concurrent install
- Migration of historical rows from `queue_snapshots` / `mdb_copy_snapshots` / etc. to `pkg_<name>` schemas
- Auto-installation on server registration (today it's admin-click only)
