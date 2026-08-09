# ExDashboard — Handoff Notes

**Audience:** future maintainers and operators picking up the project after
the initial 2026-08-09 build.

This document summarizes what was built, what's tested, what's known to
work in production, what's known *not* to work, and how to extend it.
For day-to-day operations see `docs/operations/runbook.md`.

---

## What ExDashboard Is

A Windows-service monorepo that monitors Microsoft Exchange Server
surfaces via Perfmon/WMI and ships the data to a Node.js admin backend:

- **Center** — admin UI (port 8080), heartbeat ingest (8081), report
  ingest (8082), MySQL or SQL Server backend, 3-screen init wizard,
  RBAC, retention purge.
- **Agent** — runs on each Exchange Server. Discovers identity,
  heartbeats to center every 30 s, sends full perfmon snapshot every
  60 s, retries failed reports through a local SQLite-backed queue.
- **Frontend** — Vue 3 + Vite + Pinia + vue-router + ECharts. Dark
  theme. 11 dashboard views + 14 admin views.

Mirrors the structure of `ADDashboard` with `ADDashboard*` swapped to
`ExDashboard*` and adapted to Exchange's specific surfaces (mail-flow
queues, DAG/MDB, MSExchange services, client-access counters).

---

## Repository Layout

```
ExDashboard/
├── center/                 — Node.js admin backend (Express, 3-port split)
│   ├── server.js           — entry point (NSSM launches this)
│   ├── appsettings.example.json
│   ├── db/schema/          — SQL migration files (001-initial.sql)
│   ├── src/                — routes, services, db drivers, auth, init wizard
│   └── tests/              — node:test, 42 specs
├── agent/                  — Node.js agent (runs on each Exchange Server)
│   ├── appsettings.example.json
│   ├── src/                — collectors, heartbeat, reporter, local queue
│   └── tests/              — node:test, 9 specs
├── frontend/               — Vue 3 admin UI
│   ├── src/                — views, components, api, stores, router
│   ├── tests/              — vitest, 48 specs
│   └── vite.config.js
├── scripts/                — PowerShell install / uninstall / update / smoke
├── start.bat / start.ps1   — NSSM install + console launch
├── docs/                   — operations guides + design + plan
├── .superpowers/sdd/2026-08-09-exchange-dashboard/   — implementation ledger
└── HANDOFF.md              — this file
```

---

## What Works

### Tested at 99/99 green
- **Backend unit + integration:** center (42) + agent (9) cover auth,
  init wizard, schema migrations, agent ingest, retention purge, all
  five collector streams, local-queue retry, three-port server split,
  RBAC, error handling.
- **Frontend:** vitest covers every component (DagGrid, ServerCard,
  CounterTile, QueueTable, ClientAccessTile, ServiceHealthBar,
  StuckMessagesPanel, AppLayout) plus view-level snapshots for all
  admin pages and stores (auth, packages).

### Wired end-to-end
- Agent: all 5 collectors (Perfmon → Mailflow → DAG → Services →
  ClientAccess) instantiated and called inside `getSnapshot()` with
  per-collector try/catch. Output keys (`queues`, `dag.copies`,
  `services`, `clientAccess`, `resources`) match the center's report
  ingest handler.
- Agent ports: heartbeat→8081, report/discover→8082 (via the
  `urlFor(baseUrl, port, path)` helper in `agent/src/url.js`). Web
  traffic stays on 8080.
- Center: heartbeatApp + reportApp + webApp are independent Express
  apps with their own body limits. WebApp mounts `/api/auth`,
  `/api/dashboard`, `/api/admin`, `/api/dags`, `/api/lockout`
  (requireAuth-gated), `/api/schema-migrations` (requireAuth-gated),
  `/api/heartbeat-report`, `/api/init`. Init-mode serves only
  `/api/init/*` until the wizard finalizes.

### Build + bundle
- `npm run build` (frontend) produces `frontend/dist/` with three
  manual chunks: `vendor` (Vue + Pinia + vue-router, ~97 KB / 37 KB
  gz), `echarts` (echarts + zrender, ~1.14 MB / 382 KB gz — lazy
  loaded by chart views), `index` (app code, ~60 KB / 23 KB gz).

---

## Known Limitations / Not-Yet-Done

These were deferred from the original plan and remain as TODOs in code:

- **DAG database membership is static** — `DagCollector` is
  instantiated with `{databases: []}`. The `db_id` / `server_id`
  columns are written as `null`/`0` until center discovers and
  populates them. To fix: have center respond to `/api/agent/config`
  with the DAG topology, agent reads it on startup + periodically.
- **lockoutRouter is a stub** — `POST /api/lockout/diagnose` returns a
  canned recommendation. It is now requireAuth-gated but the
  diagnostic logic (correlate AD lockout events, Exchange throttling,
  MAPI/RPC sessions) is not implemented.
- **Probe loop retention purge is portable** but uses a JS-computed
  cutoff; works on MySQL and SQL Server. The original brief's
  MySQL-only `INTERVAL ? DAY` syntax has been replaced.
- **No automated E2E / smoke** — `scripts/smoke-test.ps1` checks
  `/healthz`, `/api/init/status`, and queries `/api/servers` but
  requires a real Exchange Server to populate data. No synthetic
  agent is shipped.
- **Frontend has no Playwright/Cypress** — coverage is component +
  view-level vitest only. UI regressions on interaction paths (clicks,
  form submissions beyond the Lockout form) are not guarded.
- **`packageRouter` and `orphanRouter` not wired** — referenced in
  `center/server.js` TODO comments. The center has no package-system
  bootstrap. The frontend has `/admin/packages*` routes but the API
  stubs return empty data.

---

## Common Tasks

### Run the test suite

```bash
cd D:\ToolDevelop\ExDashboard
npm test --workspaces --if-present
```

Expected: `42 + 9 + 48 = 99` tests pass.

### Build the frontend

```bash
cd frontend
npm run build    # writes frontend/dist/
```

### Mirror frontend into center/dist (for start-prod.js)

The `scripts/start-prod.js` script does this automatically:

```bash
node scripts/start-prod.js
```

### Run the center in init mode (first install)

```bash
cd center
node server.js   # serves /api/init/* on :8080
```

Then visit `http://center:8080/init` to run the 3-screen wizard.

### Run the agent on an Exchange Server

```bash
cd agent
node agent.js appsettings.json
```

The agent discovers its identity, posts `/api/agent/discover` to the
center on port 8082, then starts heartbeating on port 8081 and
reporting on port 8082.

---

## Key File Pointers

| What | Where |
|------|-------|
| Center entry point | `center/server.js` |
| Agent entry point | `agent/agent.js` |
| Init wizard | `center/src/init/{router,wizard-facade,marker,needs-init}.js` |
| Auth + RBAC | `center/src/auth/user-auth.js`, `center/src/auth/rbac.js` |
| Agent router | `center/src/routes/agent.js` |
| Center routers | `center/src/routes/{auth,dashboard,admin,dag,lockout,schema-migrations,heartbeat-report}.js` |
| Retention purge | `center/src/services/probe.js` |
| Agent collectors | `agent/src/{perfmon,mailflow,dag,services,clientaccess}-collector.js` |
| Agent url helper | `agent/src/url.js` |
| Local retry queue | `agent/src/local-queue.js` |
| Frontend router | `frontend/src/router.js` |
| Frontend API clients | `frontend/src/api/*.js` |
| Frontend views | `frontend/src/views/*.vue`, `frontend/src/views/admin/*.vue` |
| Vite config (manualChunks) | `frontend/vite.config.js` |
| SQL schema | `db/schema/001-initial.sql` |
| NSSM scripts | `scripts/install-{center,agent}.ps1`, `scripts/uninstall-*.ps1`, `scripts/update-*.ps1` |
| Operations docs | `docs/operations/{deployment,runbook,troubleshooting}.md` |
| SDD ledger | `.superpowers/sdd/2026-08-09-exchange-dashboard/progress.md` |

---

## SDD Ledger Trail

The full implementation log lives in
`.superpowers/sdd/2026-08-09-exchange-dashboard/`. Per-task briefs,
implementer reports, review packages, and fix reports are all there if
you need to reconstruct the design rationale for a specific file.

| Round | Status |
|-------|--------|
| 32 implementation tasks | complete |
| 2 fix rounds (docs accuracy, missing server.js) | complete |
| Critical-fix round (final-review defects 1-5) | complete |
| Important-fix round (port targeting, lockout auth) | complete |
| Minor-fix round (test warnings, manualChunks) | complete |

Total: 42 commits on `master`.

---

## Future Work — Suggested Order

1. Wire the DAG topology endpoint → agent reads it on startup. Removes
   the `{databases: []}` empty-state.
2. Implement lockout diagnose logic (AD event log correlation).
3. Add Playwright E2E covering the init wizard + agent install.
4. Add `packageRouter` + `orphanRouter` to center (referenced in
   `docs/operations/runbook.md`).
5. Wire a synthetic agent for offline smoke testing.