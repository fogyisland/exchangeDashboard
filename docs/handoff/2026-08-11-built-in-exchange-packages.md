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
- **Frontend Catalog tab will not render visually until `element-plus` is installed.** The new Catalog tab in `frontend/src/views/PackagesView.vue` uses `<el-table>`, `<el-tabs>`, `<el-dialog>`, `<el-tag>`, `<el-button>`, `<el-checkbox>`, and the `v-loading` directive — all of which are Element Plus components. `element-plus` is NOT in `frontend/package.json` and is NOT registered in `frontend/src/main.js`, so Vue renders these as inert unknown custom elements. Task 11's "no new npm deps" global constraint blocked adding the dep; the Installed tab (plain `<table>`) is unaffected. Follow-up: add `element-plus` to `frontend/package.json` and `app.use(ElementPlus)` in `main.js`, or rewrite the Catalog tab in plain HTML.
- **Agent's ISO `capturedAt` string is now coerced to a `Date` in the ingest path (fixed).** `agent/src/reporter.js` sends `new Date().toISOString()` for the `capturedAt` field; `ingest.routeExtensions` normalizes it to a `Date` (and falls back to `new Date()` if the input is missing/invalid) at `center/src/packages/ingest.js:15`, so mysql2 accepts it for the `metricTable.ts DATETIME` column. Regression guarded by `center/tests/catalog/install-flow.test.js:145` (the ISO-string capturedAt integration test).
- **Installer's `parseCreateTable` does not handle inline `PRIMARY KEY (...)` clauses inside a `CREATE TABLE` migration.** The column parser at `center/src/packages/installer.js:20-34` splits on commas (outside parens) and treats each piece as a `name type ...` token; an inline `PRIMARY KEY (col1, col2)` line therefore fails the `parts.length < 2` check and silently drops constraint info, and a trailing `PRIMARY KEY (...)` inside the same CREATE TABLE body can confuse the schema/manifest column diff. All 8 built-in packages avoid the pattern by defining `metricTable` columns only (no inline PKs — `agent_id`+`ts` are not declared PKs); any new package migration must also avoid it. Use separate `ALTER TABLE ... ADD PRIMARY KEY (...)` statements if a primary key is genuinely needed.

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

There are two env-var families gating MySQL-backed tests. To run the full integration suite locally, set both. Without them, MySQL-gated tests self-skip via `test.skip` (no failure).

### (a) `MYSQL_TEST_*` family
Set `MYSQL_TEST_HOST`, `MYSQL_TEST_PORT`, `MYSQL_TEST_USER`, `MYSQL_TEST_PASSWORD` per `memory/reference_local_mysql.md`. Affects:
- `center/tests/packages/server-installs.test.js`
- `center/tests/catalog/router.test.js`
- `center/tests/catalog/install-flow.test.js`

### (b) `TEST_MYSQL_URL` family
Set `TEST_MYSQL_HOST`, `TEST_MYSQL_PORT`, `TEST_MYSQL_USER`, `TEST_MYSQL_PASSWORD`, `TEST_MYSQL_DB` (see `center/tests/packages/ingest.test.js:7` and `center/tests/packages/sql.test.js:5`). Affects:
- `center/tests/packages/ingest.test.js`
- `center/tests/packages/sql.test.js`

To enable both groups in one command, export both sets:

```bash
export MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_PORT=3306 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='Admin909217'
export TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=3306 TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD='Admin909217' TEST_MYSQL_DB=exdashboard_test
```
