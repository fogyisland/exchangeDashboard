# Exchange Dashboard — Design Spec (2026-08-09)

## 1. Goal & Scope

Build **ExDashboard** as a structural mirror of `ADDashboard`, repurposed for
**Microsoft Exchange Server** monitoring. Same monorepo, same Windows-service
deploy model, same init wizard / RBAC / multi-DB / multi-port architecture,
same dark-theme Vue 3 frontend. Domain content is swapped: AD replication
surface is replaced with Exchange surfaces (mail flow & queues, DAG/MDB
database availability, server health & services, client access).

What gets reused unchanged: monorepo shell, init wizard, RBAC, NSSM service
wrapper, multi-DB driver layer, the package/plugin metrics system, the
heartbeat + report split, and most of the admin views.

What gets rewritten: collector code on the agent, dashboard data model
(servers / dags / mdbs), and the customer-facing views.

## 2. Non-Goals

- No Exchange Management Shell (EMS) cmdlets in the agent. The agent uses
  Windows-native `typeperf.exe` and `wmic.exe` only.
- No Linux/macOS deploy. Center runs on Windows; agent runs on Windows
  (Exchange Server is Windows-only anyway).
- No automatic remediation. ExDashboard observes and alerts; it does not
  remount databases, restart services, or move active mailbox copies.
- No multi-tenant or hosted-Exchange support. Single-tenant, on-prem only.

## 3. Architecture

```
[Exchange Server A]    [Exchange Server B]    [Exchange Server N]
  agent.js (NSSM)        agent.js (NSSM)        agent.js (NSSM)
   └─ perfmon collector   └─ perfmon collector   └─ perfmon collector
       │ POST /api/agent/report        │                       │
       │ POST /api/agent/heartbeat ────┴───────────────────────┘
       ▼                                  ▼                       ▼
+─────────────────────────────────────────────────────────────────────+
|  center (NSSM Windows Service: ExDashboardCenter)                  |
|  ┌─ webApp :8080 (UI + auth + admin + dashboard)                   |
|  ├─ heartbeatApp :8081 (high-frequency, low payload)               |
|  └─ reportApp :8082 (10MB+ snapshots)                              |
|  + MySQL or SQL Server (chosen at init)                            |
+─────────────────────────────────────────────────────────────────────+
       ▲
       │ HTTPS
       ▼
[Admin Browser @ http://server:8080]
```

## 4. Directory Layout

```
ExDashboard/
├── package.json                  # name: ex-dashboard, workspaces: [center, agent, frontend]
├── start.bat / start.ps1         # default = service mode, --console = foreground
├── README.md
├── nssm/nssm.exe                 # bundled NSSM 2.24
├── scripts/                      # PowerShell install/uninstall/update
│   ├── install-center.ps1 / uninstall-center.ps1
│   ├── install-agent.ps1  / uninstall-agent.ps1
│   ├── update-center.ps1  / update-agent.ps1
│   ├── smoke-test.ps1
│   └── common/{Logger,NSSM,Service,Ensure-Nssm}.psm1
├── docs/
│   ├── operations/{deployment,runbook,troubleshooting}.md
│   └── superpowers/{specs,plans}/
├── db/
│   ├── migrations/
│   └── schema/                   # see §8
├── center/
│   ├── server.js                 # three-port split: 8080 / 8081 / 8082
│   ├── appsettings.example.json
│   ├── package.json              # express, mssql, mysql2, bcryptjs, jsonwebtoken, ajv, pino, pino-http, semver, adm-zip
│   └── src/
│       ├── app.js, config.js, db.js, logger.js, multi-port.js
│       ├── auth/{user-auth.js, rbac.js}
│       ├── db/{index.js, errors.js, sql.js, drivers/{mysql.js, mssql.js}}
│       ├── init/{router,needs-init,wizard-facade,db-tester,
│       │        schema-applier,config-writer,admin-creator,
│       │        marker,verify-marker}.js
│       ├── routes/{healthz,auth,agent,dashboard,queues,dag,
│       │           client-access,servers,lockout,
│       │           heartbeat-report,schema-migrations,admin}.js
│       ├── services/{config,users,audit,audit-classifier,
│       │             migrations,port-status,ports,
│       │             heartbeat-report,probe,
│       │             mailflow,dags,server-status}.js
│       └── packages/router.js    # plugin-style metric packages
├── agent/
│   ├── agent.js
│   ├── appsettings.example.json
│   ├── package.json              # axios, better-sqlite3, pino
│   └── src/
│       ├── config.js, logger.js, scheduler.js, local-queue.js
│       ├── collector.js
│       ├── perfmon-collector.js
│       ├── mailflow-collector.js
│       ├── dag-collector.js
│       ├── services-collector.js
│       ├── clientaccess-collector.js
│       ├── discovery.js
│       ├── healthcheck.js, heartbeat.js, reporter.js
│       ├── port-config-fetcher.js
│       └── package-manager.js, package-runner.js
└── frontend/
    ├── package.json              # axios, echarts, papaparse, pinia, vue, vue-router, xlsx
    ├── index.html, vite.config.js, vitest.config.js
    └── src/
        ├── main.js, App.vue, router.js, style.css
        ├── api/{client,init,auth,dashboard,queues,dag,
        │        clientAccess,servers,admin,lockout,
        │        migrations,heartbeatReport}.js
        ├── stores/{auth,init,packages,servers}.js
        ├── components/
        │   ├── AppLayout.vue, AdminLayout.vue, StatusBar.vue
        │   ├── QueueTable.vue, QueueChart.vue
        │   ├── StuckMessagesPanel.vue
        │   ├── DagTopologyChart.vue, DagGrid.vue
        │   ├── ServerCard.vue, ServiceHealthBar.vue
        │   ├── ClientAccessTile.vue
        │   ├── BulkImportDialog.vue, ErrorTable.vue
        │   └── metrics/{GaugeTile,CounterTile,TimeseriesTile,StatusTile}.vue
        └── views/
            ├── LoginView.vue, NotFoundView.vue, DashboardView.vue
            ├── MailFlowView.vue
            ├── DagTopologyView.vue, DagGridView.vue
            ├── ClientAccessView.vue, ServersOverviewView.vue
            ├── MetricDashboardView.vue, LockoutTroubleshootingView.vue
            ├── admin/{UsersView,RolesView,ConfigView,AuditView,
            │          SchemaMigrationsView,PortsView,
            │          HeartbeatReportMonitorView,
            │          PackagesView,PackageEditView,RegistryView,
            │          DagsCatalogView,DbsCatalogView,
            │          DagReplicationMatrixView}.vue
            └── init/InitWizardView.vue
```

## 5. Center Backend

### 5.1 Three-port split (`center/server.js → buildServerApps`)

| App | Port | Routes | Purpose |
|---|---|---|---|
| `webApp` | `8080` (configurable) | healthz + auth + init + dashboard + queues + dag + client-access + servers + lockout + admin + packages + static SPA | UI / admin / queries |
| `heartbeatApp` | `8081` (configurable) | healthz + `agentRouter(mount='heartbeat')` | High-frequency heartbeats (256KB body limit) |
| `reportApp` | `8082` (configurable) | healthz + `agentRouter(mount='report')` | Large snapshots (10MB body limit) |

### 5.2 Routes

| File | Key endpoints |
|---|---|
| `routes/healthz.js` | `GET /healthz` — mounted on all three apps |
| `routes/auth.js` | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| `init/router.js` | `GET /api/init/status`, `POST /api/init/test-db`, `POST /api/init/finalize` |
| `routes/agent.js` | `POST /api/agent/heartbeat`, `POST /api/agent/report`, `POST /api/agent/discover`, `GET /api/agent/config` — dual mount |
| `routes/dashboard.js` | `GET /api/dashboard/overview`, `GET /api/dashboard/metrics/summary`, `GET /api/dashboard/metrics/timeseries` |
| `routes/queues.js` | `GET /api/queues/current`, `GET /api/queues/history`, `GET /api/queues/by-server/:id`, `GET /api/queues/stuck` |
| `routes/dag.js` | `GET /api/dag/list`, `GET /api/dag/:id/topology`, `GET /api/dag/:id/databases`, `GET /api/dag/:id/databases/:db/copy-status` |
| `routes/client-access.js` | `GET /api/client-access/summary`, `GET /api/client-access/per-server`, `GET /api/client-access/latency` |
| `routes/servers.js` | `GET /api/servers`, `GET /api/servers/:id`, `GET /api/servers/:id/health` |
| `routes/lockout.js` | `POST /api/lockout/diagnose` |
| `routes/heartbeat-report.js` | `GET /api/heartbeat-report/*` |
| `routes/schema-migrations.js` | `GET /api/migrations`, `POST /api/migrations/apply` |
| `routes/admin.js` | `/api/admin/{users,roles,config,audit,servers,dags,dbs,dag-replication,ports,heartbeat-report}` |
| `packages/router.js` | plugin-style metric packages |

### 5.3 Services

| Service | Responsibility | Source relation |
|---|---|---|
| `config.js` | read/write `system_config` | reused |
| `users.js` | user CRUD + bcrypt | reused |
| `audit.js` + `audit-classifier.js` | audit log | reused |
| `migrations.js` | schema version tracking | reused |
| `port-status.js` + `ports.js` | port management | reused |
| `heartbeat-report.js` | offline-agent detection | reused |
| `probe.js` | background probe loop | reused |
| `mailflow.js` | queue snapshot ingestion + aggregation | replaces `replication.js` |
| `dags.js` | DAG topology / MDB copy status queries + summary | replaces `dcs.js` + `discovery.js` |
| `server-status.js` | Exchange services + resource summary | new |

### 5.4 Init Wizard (three screens)

Mirrors AD; only branding changed. Default service name
`ExDashboardCenter`, log path `C:\exdashboard\Logs\`, registry marker
`HKLM\SOFTWARE\ExDashboard\Initialized`.

1. **Database** — pick MySQL or SQL Server, fill params, test connection.
2. **Admin account** — `admin` + ≥8-char password.
3. **Apply** — schema + seed + admin creation + `appsettings.json` + marker.
   Then center exits via `setImmediate`, NSSM restarts with the new config,
   frontend polls `/api/init/status` and routes to `/login`.

### 5.5 RBAC & Auth

- `auth/user-auth.js`: bcryptjs + `jsonwebtoken`; `requireAuth` middleware.
- `auth/rbac.js`: `requirePerm('admin:users' | 'admin:packages')`.
- Pinia `stores/auth.js` stores token in `localStorage`.

### 5.6 Multi-DB drivers

`db/drivers/mysql.js` + `db/drivers/mssql.js`. `db/index.js` switches on
`appsettings.json.dbKind`. `db/sql.js` provides dialect translation
(`TOP n` vs `LIMIT n`, identifier quoting, identity insert, `GETDATE()` vs
`NOW()`). Migration files use ANSI SQL; the driver layer rewrites where
required.

## 6. Agent

### 6.1 Process Structure

```
agent.js (NSSM service: ExDashboardAgent)
├── scheduler.js          # multi-frequency timers
├── heartbeat.js          # POST /api/agent/heartbeat
├── reporter.js           # local queue + POST /api/agent/report
├── local-queue.js        # better-sqlite3 offline buffer
├── discovery.js          # identity: hostname, FQDN, DAG membership
├── healthcheck.js
├── port-config-fetcher.js
├── package-manager.js + package-runner.js    # plugin packages
└── collector.js (main)
    ├── perfmon-collector.js
    ├── mailflow-collector.js
    ├── dag-collector.js
    ├── services-collector.js
    └── clientaccess-collector.js
```

### 6.2 Perfmon/WMI Collection Method

The agent shells out to **built-in Windows tools only**:

| Tool | Purpose | Format |
|---|---|---|
| `typeperf.exe` | performance counters | CSV |
| `wmic.exe` | WMI queries | CSV |

Zero npm deps for system instrumentation. `perfmon-collector.js` exposes a
small `CounterQuery` / `WmiQuery` interface so future PDH bindings can drop
in without changing collectors above.

### 6.3 Collectors

**mailflow-collector.js** — Windows perf counters:

| Counter path | Meaning |
|---|---|
| `\MSExchangeTransport Queues(_total)\Queue Length` | Total queue length |
| `\MSExchangeTransport Queues(_total)\Active Mailbox Delivery Queue Length` | Active mailbox delivery |
| `\MSExchangeTransport Queues(_total)\Poison Queue Length` | Poison queue |
| `\MSExchangeTransport Queues(_total)\Largest Message Count In Queue` | Largest single queue |
| `\MSExchangeTransport Queues(_total)\Messages Queued Per Second` | Enqueue rate |
| `\MSExchangeTransport Queues(_total)\Messages Completed Per Second` | Completion rate |
| `\MSExchangeTransport Queues(_total)\Deferred Messages Per Second` | Deferred rate |
| `\MSExchangeTransport Queues(_total)\Retry Queue Length` | Retry queue |
| `\MSExchange Submission Queue(_total)\Submission Queue Length` | Submission queue |

**dag-collector.js** — DAG/MDB:

| Data | Source |
|---|---|
| DAG list + members | WMI `MsExchangeDag` (or equivalent) for this server |
| MDB copy queue length | `\MSExchangeRepl\*Database Moves\CopyQueueLength` |
| MDB replay lag | `\MSExchangeRepl\*Database Moves\ReplayLag` |
| MDB mount status | `\MSExchangeRepl\*Database Moves\MountStatus` (0/1/2 + text) |
| MDB content index state | `\MSExchange Search Indexes(*)\Document Indexing State` |

**services-collector.js** — services + system resources:

| Data | Source |
|---|---|
| Exchange service state | WMI `Win32_Service` filtered by `Name LIKE 'MSExchange%'` |
| CPU | `\Processor(_total)\% Processor Time` |
| Memory | `\Memory\Available MBytes` |
| Disk C: | `\LogicalDisk(C:)\% Free Space` |
| Network | `\Network Interface(*)\Bytes Total/sec` |

**clientaccess-collector.js** — client access counters:

| Counter path | Meaning |
|---|---|
| `\MSExchange RpcClientAccess\RPC Average Latency` | RPC avg latency |
| `\MSExchange RpcClientAccess\Active User Count` | Active users |
| `\MSExchange ActiveSync\ActiveSync Requests/sec` | AS req/s |
| `\MSExchange ActiveSync\Average Command Processing Time` | AS cmd time |
| `\MSExchangeWS(*)\Requests/sec` | EWS req/s |
| `\MSExchange Outlook Anywhere\Average RPC Response Time` | OA RPC time |
| `\MSExchange MapiHttp\Average Request Time` | MAPI/HTTP time |

### 6.4 Scheduling

- `heartbeat`: 30s → POST `:8081/api/agent/heartbeat`
  `{ agentId, hostname, version, ts, dag?, services?, summary }`
- `report`: 60s → merged collector snapshot → POST `:8082/api/agent/report`
- Each collector may have its own frequency (mailflow 30s, dag 60s,
  services 30s, client-access 60s).
- Failed reports queue locally in SQLite WAL with exponential backoff
  (30s / 1m / 5m / 30m).

### 6.5 discovery.js (host identity)

Detects: hostname, FQDN, OS version, Exchange version, server role
(flags: Mailbox / Hub-Transport / ClientAccess), DAG membership.

Because the agent must not use Exchange Management Shell, DAG membership
is derived from Windows Failover Cluster WMI (`MSCluster_ResourceGroup`
joined to DAG name) plus Active Directory attributes via `NTDSUTIL`-free
LDAP-free WMI queries (`Win32_Registry` for the Exchange install path
under `HKLM\Software\Microsoft\ExchangeServer\v15\Setup`, plus
`Win32_Service` to identify which Exchange services are installed).
If DAG detection fails for an agent, the agent reports `dag_id: null`
and center falls back to "ungrouped server" — the operator can manually
attach it to a DAG via the admin UI.

First call: POST `:8082/api/agent/discover`, center registers server.

### 6.6 Reuse vs Replace vs Delete

- **Reuse**: scheduler, heartbeat, reporter, local-queue, healthcheck,
  config, logger, port-config-fetcher, package-manager, package-runner.
- **Replace**: collector.js (rewritten) + 5 sub-collectors.
- **Delete**: any AD repadmin / site-link topology code.

## 7. Frontend

### 7.1 Routes

Mirror of AD's router guard (init → /init, no token → /login,
`meta.perm` check). Component mapping:

| Path | Component | perm |
|---|---|---|
| `/init` | `InitWizardView.vue` | public |
| `/login` | `LoginView.vue` | public |
| `/` | `DashboardView.vue` | — |
| `/mailflow` | `MailFlowView.vue` | — |
| `/dag` | `DagTopologyView.vue` | — |
| `/dag/grid` | `DagGridView.vue` | — |
| `/client-access` | `ClientAccessView.vue` | — |
| `/servers-overview` | `ServersOverviewView.vue` | — |
| `/dashboard/metrics` | `MetricDashboardView.vue` | — |
| `/lockout-troubleshooting` | `LockoutTroubleshootingView.vue` | — |
| `/admin/users` | `UsersView.vue` | `admin:users` |
| `/admin/roles` | `RolesView.vue` | `admin:users` |
| `/admin/config` | `ConfigView.vue` | `admin:users` |
| `/admin/audit` | `AuditView.vue` | `admin:users` |
| `/admin/dags-catalog` | `DagsCatalogView.vue` | `admin:users` |
| `/admin/dbs-catalog` | `DbsCatalogView.vue` | `admin:users` |
| `/admin/dag-replication` | `DagReplicationMatrixView.vue` | `admin:users` |
| `/admin/migrations` | `SchemaMigrationsView.vue` | `admin:users` |
| `/admin/ports` | `PortsView.vue` | `admin:users` |
| `/admin/heartbeat-report` | `HeartbeatReportMonitorView.vue` | `admin:users` |
| `/admin/packages` | `PackagesView.vue` | `admin:packages` |
| `/admin/packages/registry` | `RegistryView.vue` | `admin:packages` |
| `/admin/packages/:name` | `PackageEditView.vue` | `admin:packages` |
| `/:pathMatch(.*)*` | `NotFoundView.vue` | — |

### 7.2 Views (per-view goal)

- `DashboardView.vue` — top cards (server health, queue-backlog alerts,
  un-mounted databases, replay-lag violations, RPC high-latency servers);
  stacked area chart: queue length last 24h.
- `MailFlowView.vue` — filters (time window, server/DAG); left
  `QueueTable.vue` grouped by Server × QueueType; right `QueueChart.vue`
  (ECharts line) for queue length over time; bottom `StuckMessagesPanel.vue`
  (retry/deferred/poison).
- `DagTopologyView.vue` — ECharts `graph`: nodes = Exchange Servers, edges
  = DAG replication links; color by copy queue length / copy status;
  click-to-drill into MDB copies.
- `DagGridView.vue` — table: rows = databases, columns = servers, cells =
  mount status + copy queue + replay lag; DAG selector; color-coded.
- `ClientAccessView.vue` — `ClientAccessTile.vue` grid (RPC latency, AS
  req/s, EWS req/s, MAPI/HTTP response time), per-server switch.
- `ServersOverviewView.vue` — `ServerCard.vue` grid (one card per server
  with services, resources, key counters, last heartbeat).
- `MetricDashboardView.vue` / `LockoutTroubleshootingView.vue` / admin
  views — reused from AD, field names swapped.

### 7.3 Components

| Component | Purpose | Reuse vs new |
|---|---|---|
| `AppLayout.vue` | left nav + topbar | reuse, nav items swapped |
| `AdminLayout.vue` | admin sidebar | reuse, nav items swapped |
| `StatusBar.vue` | top status bar | reuse |
| `QueueTable.vue` | queue table | new |
| `QueueChart.vue` | ECharts queue line chart | new |
| `StuckMessagesPanel.vue` | retry/deferred/poison highlight | new |
| `DagTopologyChart.vue` | ECharts graph wrapper | new (replaces `TopologyChart.vue`) |
| `DagGrid.vue` | database/copy grid | new (replaces `SiteMatrixChart.vue`) |
| `ServerCard.vue` | single server summary card | new (replaces `DcCard.vue`) |
| `ServiceHealthBar.vue` | Exchange services bar | new (replaces `AgentStatusTable.vue`) |
| `ClientAccessTile.vue` | single client-access tile | new |
| `BulkImportDialog.vue`, `ErrorTable.vue` | generic | reuse |
| `metrics/{GaugeTile,CounterTile,TimeseriesTile,StatusTile}.vue` | metric tiles | reuse |

### 7.4 API clients (`api/`)

`client.js`, `init.js`, `auth.js`, `dashboard.js`, `queues.js`, `dag.js`,
`clientAccess.js`, `servers.js`, `admin.js`, `lockout.js`,
`migrations.js`, `heartbeatReport.js`.

### 7.5 Pinia stores

`auth.js`, `init.js`, `packages.js` — reused. New `servers.js` caches
agent registration info + online status to avoid repeated fetches.

### 7.6 Styling

`style.css` and `AppLayout.vue` reuse AD's color tokens (`--bg`, `--panel`,
`--accent`, `--green/yellow/red`) and dark theme. No visual redesign.

## 8. Database Schema

### 8.1 Reused unchanged

`users`, `roles`, `user_roles`, `audit_log`, `system_config`, `packages`,
`package_runs`, `package_versions`, `heartbeat_events`,
`schema_migrations`.

### 8.2 Renamed from AD (structure preserved, fields tweaked)

| AD table | Exchange table | Notes |
|---|---|---|
| `dcs` | `servers` | cols: `id`, `agent_id`, `hostname`, `fqdn`, `os_version`, `exchange_version`, `server_role` (bit flags Mailbox / Hub-Transport / ClientAccess), `dag_id` nullable, `last_heartbeat_at`, `last_report_at`, `enabled` |
| `sites` | `dags` | `id`, `name`, `description`, `file_share_witness`, `created_at` |
| `dc_site_links` | `dag_members` | `dag_id`, `server_id`, `preferred_activations` int, `replication_enabled` bool |
| `dc_catalog` / `site_catalog` | `mdb_catalog` | `db_id` (GUID), `db_name`, `dag_id`, `server_id` (primary copy host), `edb_file_path`, `log_folder_path`, `circular_logging` |
| `replication_summaries` | `mailflow_summaries` | latest per-server mail flow rollup |
| `replication_errors` | `mailflow_errors` | high-latency / retry / poison events |
| `site_replication_matrix` | `dag_replication_matrix` | materialized view: row = DB, col = Server |

### 8.3 New tables (Exchange-specific)

**`queue_snapshots`** — one row per `(agent_id, server_id, captured_at, queue_kind, queue_name)`:

```
id BIGINT PK
agent_id           VARCHAR FK agents
server_id          INT FK servers
captured_at        DATETIME
queue_kind         ENUM('Submission','Unreachable','Poison',
                        'ActiveMailboxDelivery','ActiveRemoteDelivery',
                        'Retry','Shadow')
queue_name         VARCHAR
message_count      INT
oldest_message_age_seconds INT NULL
messages_per_sec   DECIMAL(12,4) NULL
deferred_per_sec   DECIMAL(12,4) NULL
INDEX (server_id, captured_at)
INDEX (queue_kind)
```

**`mdb_copy_snapshots`** — one row per `(db_id, server_id, captured_at)`:

```
id BIGINT PK
agent_id           VARCHAR
server_id          INT
db_id              VARCHAR FK mdb_catalog
captured_at        DATETIME
copy_queue_length  INT
replay_lag_seconds INT NULL
mount_status       TINYINT       -- 0=Dismounted, 1=Mounted, 2=Mounting
content_index_state VARCHAR NULL -- Healthy/Crawling/Seeding/Failed
is_active_copy     BIT
activation_preference INT NULL
INDEX (db_id, server_id, captured_at)
```

**`service_states`** — periodic Exchange service state:

```
id BIGINT PK
agent_id           VARCHAR
server_id          INT
captured_at        DATETIME
service_name       VARCHAR        -- e.g. MSExchangeTransport
state              ENUM('Running','Stopped','StartPending','StopPending','Unknown')
start_mode         ENUM('Auto','Manual','Disabled')
INDEX (server_id, captured_at)
```

**`client_access_snapshots`** — one row per `(server_id, metric, captured_at)`:

```
id BIGINT PK
agent_id           VARCHAR
server_id          INT
captured_at        DATETIME
metric             VARCHAR        -- e.g. RpcClientAccess.AverageLatency
value              DECIMAL(18,4)
INDEX (server_id, metric, captured_at)
```

**`server_resources`** — Win32 resource counters:

```
id BIGINT PK
agent_id           VARCHAR
server_id          INT
captured_at        DATETIME
cpu_pct            DECIMAL(5,2) NULL
memory_available_mb BIGINT NULL
disk_c_free_pct    DECIMAL(5,2) NULL
net_bytes_per_sec  BIGINT NULL
INDEX (server_id, captured_at)
```

### 8.4 Extensions to reused tables

- `agents`: add `exchange_role_flags` (bit field), `dag_id` (nullable FK).
- `system_config`: add `queue_snapshot_retention_days` (default 7),
  `mdb_copy_snapshot_retention_days` (default 7).

### 8.5 Retention

Default retention:
- `queue_snapshots`, `mdb_copy_snapshots`, `client_access_snapshots`,
  `server_resources`: **7 days**, configurable via `system_config`.
- `service_states`: **30 days** (low cardinality).
- Background scheduled job purges by retention. Retention runs as a
  scheduled task inside `services/probe.js` (the existing background probe
  loop), every hour, deleting rows older than the configured retention.

## 9. Deployment & Operations

### 9.1 Service Names

| Service | NSSM name | Process |
|---|---|---|
| Center | `ExDashboardCenter` | `node center/server.js` |
| Agent (per Exchange Server) | `ExDashboardAgent` | `node agent/agent.js` |

### 9.2 Entry Scripts

`start.bat` / `start.ps1` mirror AD:
- Default = service mode (install + start, then exit).
- `--console` / `-Console` = foreground (`node center/server.js` /
  `node agent/agent.js`).
- `--help` / `-Help` = usage.

Service mode requires admin (to register Windows service). Console mode
does not.

### 9.3 PowerShell Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `install-center.ps1` | register `ExDashboardCenter` |
| `install-agent.ps1` | register `ExDashboardAgent` |
| `uninstall-center.ps1` | uninstall (default: keep `appsettings.json`, `.env`) |
| `uninstall-agent.ps1` | uninstall agent (keep `appsettings.json`) |
| `update-center.ps1` / `update-agent.ps1` | stop → backup → swap → start |
| `smoke-test.ps1` | GET `/healthz`, `/api/init/status`, agent heartbeat |
| `common/{Logger,NSSM,Service,Ensure-Nssm}.psm1` | shared modules |

### 9.4 Data on Disk (Service mode default)

| File | Location |
|---|---|
| center `appsettings.json` | `publish\center\appsettings.json` |
| center `.env` + registry marker | `publish\center\.env` + `HKLM\SOFTWARE\ExDashboard\Initialized` |
| center logs | `C:\exdashboard\Logs\ExDashboardCenter-{stdout,stderr}.log` (10MB rotate) |
| agent `appsettings.json` | `publish\agent\appsettings.json` |
| agent logs | `C:\exdashboard\Logs\ExDashboardAgent-{stdout,stderr}.log` (10MB rotate) |
| agent offline buffer | `publish\agent\queue.db` (+ WAL/SHM) |

Foreground mode (`--console`): logs to stdout, no file writes; data files
stay in `publish/` siblings, `C:\exdashboard\` not touched.

### 9.5 Ports & Firewall

Center defaults: `8080` (web), `8081` (heartbeat), `8082` (report) — all
configurable in `appsettings.json`.

Firewall guidance: inbound `8081` / `8082` open from Exchange Server
subnets only; inbound `8080` only from admin VLAN (or fronted by reverse
proxy on `443`).

### 9.6 Multi-Machine Deployment

Documented in `docs/operations/deployment.md`:
1. Pick one Windows Server for center. Install + run init wizard.
2. Distribute agent bundle to each Exchange Server. Run `install-agent.ps1`
   (or remote WinRM + `Invoke-Command`).
3. Agent discovers itself and POSTs `/api/agent/discover`. Center registers
   in `servers`, assigns `server_id`.
4. Agent heartbeat visible within 30s; reports visible within 60s.

### 9.7 Service Management (Runbook)

```powershell
Start-Service ExDashboardCenter
Stop-Service ExDashboardCenter
Restart-Service ExDashboardCenter -Force
Get-Service ExDashboardCenter

Get-Content 'C:\exdashboard\Logs\ExDashboardCenter-stdout.log' -Tail 100 -Wait
Get-Content 'C:\exdashboard\Logs\ExDashboardCenter-stderr.log' -Tail 100 -Wait

.\scripts\uninstall-center.ps1
Stop-Service ExDashboardCenter; sc.exe delete ExDashboardCenter
```

### 9.8 Reset / Upgrade / DR

- **Reset**: delete `appsettings.json` + `.env`, restart service → re-enter
  `/init` wizard.
- **Upgrade**: `update-center.ps1` stops service, backs up
  `appsettings.json` + DB, swaps files, starts, runs schema migrations.
- **Agent offline tolerance**: network blip → SQLite WAL buffer; recovery →
  reporter drains backlog.

## 10. Error Handling & Testing

### 10.1 Error Response Format

```
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": { ... } } }
```

### 10.2 Exception Layers

| Layer | Conversion |
|---|---|
| `db/errors.js` | `DbError` / `UniqueViolation` / `NotFound` — translated to 4xx/5xx by route |
| `routes/*.js` | catch → write `audit_log` (writes only) → JSON response |
| `services/*.js` | throw domain errors (`QueueSnapshotError`, etc.) — mapped to 5xx |
| `process.on('uncaughtException')` + `process.on('unhandledRejection')` | `pino.fatal` + `exit(1)` — NSSM restarts |

### 10.3 Agent → Center Failure Handling

- Report failure → `local-queue.js` SQLite WAL with backoff (30s / 1m / 5m / 30m).
- Payload schema mismatch → `GET /api/agent/config`, refresh, retry.
- Counter path missing → log WARN, do **not** retry; next cycle re-probes.

### 10.4 DB Failure Handling

- Init: DB unreachable → `503 { retryable: true }`; frontend polls.
- Runtime: DB unreachable → `503`; frontend banner + exponential backoff
  (1s / 2s / 4s / 8s / 30s).
- `UniqueViolation` → `409` with field-level message.

### 10.5 Process Crash Handling

- NSSM `AppExit=Default Restart` + Windows Service Recovery (1s / 2s / 5s
  before reset).
- Logs kept ≥ 7 days via 10MB rotation.

### 10.6 Frontend Error UX

- axios interceptor: 401 → clear token + `/login?redirect=…`; 5xx → banner
  + retry; 4xx → toast with field details.
- Empty data → empty-state component, no errors.
- 404 → `NotFoundView.vue`.
- init period → only `/init` reachable.
- not logged in → only `meta.public` reachable.

### 10.7 Logging Conventions

pino, `level: info` default; context `{ component, agentId?, serverId? }`.

| Level | When |
|---|---|
| INFO | startup, init done, service registration, heartbeat summary |
| WARN | transient DB failure, single retry, missing counter path |
| ERROR | persistent failure, corrupted data, unreadable config |
| FATAL | uncaughtException, port conflict, missing critical dep → exit(1) |

### 10.8 Test Layers

| Layer | Tool | Coverage |
|---|---|---|
| Backend unit | `node --test` | service pure functions (queue aggregation, DAG health, retention) |
| Backend route | `supertest` + `node --test` | `/api/queues/*`, `/api/dag/*`, `/api/client-access/*`, `/api/servers/*` happy + error |
| DB migrations | `node --test` | schema applier idempotent on both MySQL and SQL Server |
| Init wizard | `node --test` | 3-screen flow + finalize exit code + marker write |
| Agent unit | `node --test` | `perfmon-collector.js` CSV/WMI parser pure functions |
| Agent route | `supertest` | `POST /api/agent/report` accepts valid / rejects invalid |
| Agent e2e | `node --test` | fake typeperf/wmic → scheduler → reporter → DB ingestion |
| Frontend unit | `vitest run` | stores (auth/init/packages/servers), composables |
| Frontend component | `@vue/test-utils` + `vitest` | `QueueTable`, `DagTopologyChart`, `ServerCard` |
| Integration | `node --test` | full center bootstrap + fake agent reports + DB + API assertions |
| Smoke | `scripts/smoke-test.ps1` | GET `/healthz`, heartbeat visible, init status correct |

Test fixtures under `tests/fixtures/`:

- `queue-snapshot.json`, `mdb-copy-snapshot.json`,
  `client-access-snapshot.json` — Exchange-shaped sample payloads.
- `fake-typeperf.js`, `fake-wmic.js` — stubs for deterministic output.

### 10.9 Acceptance Criteria (Definition of Done)

- [ ] Center installs as NSSM Windows service, init wizard completes 3
      screens, `appsettings.json` is written.
- [ ] Agent installs as NSSM Windows service on Exchange Server, first
      heartbeat visible in center within 30s.
- [ ] `DashboardView` numbers match `servers`, `dags`, `mdb_catalog`.
- [ ] `MailFlowView` renders queue table + chart with mock data; time
      windows 1h / 6h / 24h / 7d switchable.
- [ ] `DagTopologyView` shows DAG graph, nodes colored by copy health,
      click-to-drill works.
- [ ] `ClientAccessView` renders four metric tiles with mock data.
- [ ] Backend tests pass on both MySQL and SQL Server dialects.
- [ ] Frontend `vitest run` green; `vite build` produces working `dist/`.
- [ ] `smoke-test.ps1` passes after install.
- [ ] runbook + deployment.md describe reset / upgrade / uninstall cleanly.
- [ ] No AD-specific residue: no `repadmin`, no `siteLink`, no `dcs` field
      names anywhere in code.

### 10.10 Known Limitations / Constraints

- **No Exchange Management Shell**: all data acquisition uses built-in
  `typeperf.exe` and `wmic.exe` (plus ADSI-free registry + WMI for host
  identity). Counter paths are valid for Exchange 2013 / 2016 / 2019;
  Exchange 2007 / 2010 use different counter names and are out of scope
  for v1.
- **DAG topology without EMS**: DAG membership is best-effort via
  Failover Cluster WMI + Exchange install registry. If discovery fails,
  servers appear as "ungrouped" until manually attached.
- **Counter path availability varies by role**: a Hub Transport server
  exposes Transport queues but not MDB copies; a Mailbox server exposes
  MDB copies but not Transport queues. The agent reports only what its
  role exposes; absent counters are logged at WARN and skipped (not
  retried) — see §10.3.
- **No automatic remediation**: ExDashboard observes and surfaces alerts.
  Operators must remount databases / restart services / move mailbox
  copies themselves.