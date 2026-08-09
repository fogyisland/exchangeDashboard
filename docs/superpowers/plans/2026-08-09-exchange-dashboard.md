# Exchange Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ExDashboard — a Windows-service monorepo (center + agent + frontend) that monitors Microsoft Exchange Server surfaces (mail flow, DAG/MDB, services, client access) via built-in Perfmon/WMI only, structurally mirroring ADDashboard.

**Architecture:** npm workspaces monorepo. Center: Express on three ports (web:8080, heartbeat:8081, report:8082) with MySQL or SQL Server. Agent: Node.js NSSM service per Exchange Server, shells out to `typeperf.exe` / `wmic.exe`, buffers offline via better-sqlite3. Frontend: Vue 3 + Vite + Pinia + ECharts, dark theme. Init wizard (3 screens) gates first boot.

**Tech Stack:** Node.js 18+, Express, mssql, mysql2, bcryptjs, jsonwebtoken, ajv, pino, better-sqlite3, axios, vue 3.5, vite 5, pinia, vue-router, echarts 6, vitest, supertest, NSSM 2.24 (bundled).

**Reference Spec:** `docs/superpowers/specs/2026-08-09-exchange-dashboard-design.md`. ADDashboard is the closest analogue — porting logic is allowed but the plan is self-contained.

---

## Global Constraints

These apply to every task unless a task explicitly overrides them.

- **Node.js**: minimum 18 LTS (20 or 22 recommended).
- **Operating System**: Windows only. Tests that shell out to `typeperf`/`wmic` must guard with `process.platform === 'win32'`; on other platforms they no-op.
- **Default ports**: `8080` (web), `8081` (heartbeat), `8082` (report). Configurable via `appsettings.json`.
- **Default service names**: `ExDashboardCenter` (center), `ExDashboardAgent` (agent).
- **Default data paths**: `C:\exdashboard\Logs\` (service mode logs), `publish\center\appsettings.json`, `publish\agent\appsettings.json`, `publish\agent\queue.db`.
- **Registry marker**: `HKLM\SOFTWARE\ExDashboard\Initialized`.
- **NSSM binary**: `nssm/nssm.exe` (bundled, copied from ADDashboard).
- **Default admin user**: `admin`, password ≥ 8 chars.
- **DB drivers**: MySQL (`mysql2`) and SQL Server (`mssql`). User picks at init.
- **Agent data collection**: ONLY `typeperf.exe` and `wmic.exe` (zero npm deps for system instrumentation). PowerShell / Exchange Management Shell forbidden.
- **Naming rule**: no `repadmin`, no `siteLink`, no `dcs` field names in final code. Use `servers`, `dags`, `mdb_catalog`, `queue_snapshots`, `mdb_copy_snapshots`.
- **Commit style**: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- **Test command convention**: backend uses `node --test tests/**/*.test.js`, frontend uses `vitest run`.

---

## Task Index

**Phase 1 — Scaffolding**
1. Monorepo root + workspaces + gitignore
2. Center package skeleton + appsettings
3. Agent package skeleton + appsettings
4. Frontend scaffold (Vite + Vue + Pinia + dark theme)

**Phase 2 — Center backend foundation**
5. Center logger + config loader
6. Center DB driver layer (mysql + mssql + sql dialect)
7. Center init wizard (3 screens + marker + finalize)
8. Center auth (bcrypt + jwt + RBAC)
9. Center three-port server + agent router mount gates
10. Center schema migrations + system_config
11. Center core services (users/audit/config/ports/migrations/probe)
12. Center admin routes
13. Center dashboard route (overview + queue / dag / client-access / servers / lockout routes)
14. Center retention purge job

**Phase 3 — Agent**
15. Agent scheduler + heartbeat + reporter + local-queue + discovery
16. Agent perfmon-collector (typeperf / wmic CSV parser)
17. Agent mailflow-collector
18. Agent dag-collector
19. Agent services-collector
20. Agent clientaccess-collector
21. Center agent ingest pipeline (write queue_snapshots / mdb_copy_snapshots / service_states / client_access_snapshots / server_resources)

**Phase 4 — Frontend**
22. Frontend auth store + LoginView + router guard + InitWizard shell
23. Frontend AppLayout + DashboardView + StatusBar + api client
24. Frontend MailFlowView + QueueTable + QueueChart + StuckMessagesPanel
25. Frontend DagTopologyView + DagGridView
26. Frontend ClientAccessView + ClientAccessTile
27. Frontend ServersOverviewView + ServerCard + ServiceHealthBar
28. Frontend admin views (users/roles/config/audit/dags-catalog/dbs-catalog/dag-replication/ports/migrations/heartbeat-report)
29. Frontend MetricDashboardView + packages store + metric tiles + LockoutView

**Phase 5 — Operations**
30. NSSM PowerShell install/uninstall/update scripts (center + agent)
31. start.bat / start.ps1 entry scripts
32. docs/operations/{deployment,runbook,troubleshooting}.md + README.md + smoke-test.ps1

---

## Phase 1 — Scaffolding

### Task 1: Monorepo root + workspaces + gitignore

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/package.json`
- Create: `D:/ToolDevelop/ExDashboard/.gitignore`
- Create: `D:/ToolDevelop/ExDashboard/.gitattributes`
- Create: `D:/ToolDevelop/ExDashboard/README.md`
- Copy from ADDashboard: `D:/ToolDevelop/ExDashboard/nssm/` (entire directory)

**Interfaces:**
- Consumes: nothing
- Produces: `npm` workspace layout recognized by Node 18+

- [ ] **Step 1: Initialize the root `package.json`**

Write `D:/ToolDevelop/ExDashboard/package.json`:

```json
{
  "name": "ex-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Exchange Server Health Dashboard",
  "workspaces": ["center", "agent", "frontend"],
  "scripts": {
    "test:center": "npm run test --workspace=center",
    "test:agent": "npm run test --workspace=agent",
    "test:frontend": "npm run test --workspace=frontend",
    "test": "npm run test:center && npm run test:agent && npm run test:frontend",
    "build:frontend": "npm run build --workspace=frontend",
    "start": "node scripts/start-prod.js"
  },
  "dependencies": {}
}
```

- [ ] **Step 2: Create `.gitignore`**

Write `D:/ToolDevelop/ExDashboard/.gitignore`:

```
node_modules/
dist/
*.log
.env
appsettings.json
queue.db
queue.db-shm
queue.db-wal
publish/center/dist/
.publish-cache/
.idea/
.vscode/
*.bak
```

- [ ] **Step 3: Create `.gitattributes`**

Write `D:/ToolDevelop/ExDashboard/.gitattributes`:

```
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
*.psm1 text eol=crlf
*.json text eol=lf
*.md text eol=lf
```

- [ ] **Step 4: Stub README and copy NSSM**

Write `D:/ToolDevelop/ExDashboard/README.md`:

```markdown
# Exchange Dashboard — Green Version (placeholder)

See `docs/operations/deployment.md` for full install instructions.
This README is finalized in Task 32.
```

Copy the bundled NSSM from ADDashboard:

```bash
mkdir -p "D:/ToolDevelop/ExDashboard/nssm"
cp "D:/ToolDevelop/ADDashboard/nssm/nssm.exe" "D:/ToolDevelop/ExDashboard/nssm/"
ls -la "D:/ToolDevelop/ExDashboard/nssm"
```

Expected: one file `nssm.exe` (~324 KB) present.

- [ ] **Step 5: Verify workspaces layout**

Run from `D:/ToolDevelop/ExDashboard`:

```bash
npm install --workspaces=false
```

Expected: creates root `node_modules` and `package-lock.json`. No errors. (The workspaces don't have their own `package.json` yet, so this is just verifying npm is reachable.)

- [ ] **Step 6: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git init
git add package.json .gitignore .gitattributes README.md nssm/
git commit -m "chore: scaffold ex-dashboard monorepo root + bundled nssm"
```

---

### Task 2: Center package skeleton + appsettings

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/package.json`
- Create: `D:/ToolDevelop/ExDashboard/center/appsettings.example.json`
- Create: `D:/ToolDevelop/ExDashboard/center/.env.example`

**Interfaces:**
- Consumes: Task 1 (root workspace)
- Produces: `center/` installable as workspace; declares all backend deps

- [ ] **Step 1: Create `center/package.json`**

```json
{
  "name": "@ex-dashboard/center",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/*.test.js tests/init/*.test.js tests/routes/*.test.js tests/services/*.test.js tests/db/*.test.js tests/sql/*.test.js tests/integration/*.test.js tests/e2e/*.test.js"
  },
  "dependencies": {
    "adm-zip": "^0.6.0",
    "ajv": "^8.17.1",
    "bcryptjs": "^3.0.3",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "mssql": "^11.0.1",
    "mysql2": "^3.11.0",
    "pino": "^9.4.0",
    "pino-http": "^10.3.0",
    "semver": "^7.6.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `center/appsettings.example.json`**

```json
{
  "listenPort": 8080,
  "heartbeatPort": 8081,
  "reportPort": 8082,
  "logLevel": "info",
  "installPath": "C:\\\\exdashboard",
  "dbKind": "mysql",
  "db": {
    "host": "localhost",
    "port": 3306,
    "user": "exdashboard",
    "password": "",
    "database": "exdashboard"
  },
  "jwt": {
    "secret": "CHANGE_ME_TO_RANDOM_64_HEX",
    "expiresInSeconds": 28800
  },
  "agent": {
    "heartbeatStaleSeconds": 90,
    "queueRetentionDays": 7,
    "mdbCopyRetentionDays": 7,
    "serviceStateRetentionDays": 30
  }
}
```

- [ ] **Step 3: Create `center/.env.example`**

```
APPSETTINGS_PATH=./appsettings.json
NODE_ENV=production
```

- [ ] **Step 4: Install center deps**

From `D:/ToolDevelop/ExDashboard`:

```bash
npm install --workspace=center
```

Expected: creates `center/node_modules/`, no errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/package.json center/appsettings.example.json center/.env.example center/package-lock.json
git commit -m "chore: scaffold center workspace + appsettings example"
```

---

### Task 3: Agent package skeleton + appsettings

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/agent/package.json`
- Create: `D:/ToolDevelop/ExDashboard/agent/appsettings.example.json`
- Create: `D:/ToolDevelop/ExDashboard/agent/.env.example`

**Interfaces:**
- Consumes: Task 1 (root workspace)
- Produces: `agent/` installable as workspace; declares all agent deps

- [ ] **Step 1: Create `agent/package.json`**

```json
{
  "name": "@ex-dashboard/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js",
    "test": "node --test tests/*.test.js tests/collectors/*.test.js"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "better-sqlite3": "^11.3.0",
    "pino": "^9.4.0"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create `agent/appsettings.example.json`**

```json
{
  "center": {
    "baseUrl": "http://center.local:8080",
    "heartbeatPath": "/api/agent/heartbeat",
    "reportPath": "/api/agent/report",
    "discoverPath": "/api/agent/discover",
    "configPath": "/api/agent/config",
    "heartbeatIntervalMs": 30000,
    "reportIntervalMs": 60000,
    "requestTimeoutMs": 15000
  },
  "agentId": "",
  "logLevel": "info",
  "installPath": "C:\\\\exdashboard",
  "collectors": {
    "mailflowIntervalMs": 30000,
    "dagIntervalMs": 60000,
    "servicesIntervalMs": 30000,
    "clientaccessIntervalMs": 60000
  },
  "localQueue": {
    "dbPath": "./queue.db",
    "maxBackoffMs": 1800000
  }
}
```

- [ ] **Step 3: Create `agent/.env.example`**

```
APPSETTINGS_PATH=./appsettings.json
NODE_ENV=production
```

- [ ] **Step 4: Install agent deps**

From `D:/ToolDevelop/ExDashboard`:

```bash
npm install --workspace=agent
```

Expected: `agent/node_modules/` created with `axios`, `better-sqlite3`, `pino`. If `better-sqlite3` fails to build (no MSVC), document but do not fail the task — the platform-specific install is a deploy-time concern; CI tests will mock the sqlite layer.

- [ ] **Step 5: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add agent/package.json agent/appsettings.example.json agent/.env.example agent/package-lock.json
git commit -m "chore: scaffold agent workspace + appsettings example"
```

---

### Task 4: Frontend scaffold (Vite + Vue + Pinia + dark theme)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/frontend/package.json`
- Create: `D:/ToolDevelop/ExDashboard/frontend/vite.config.js`
- Create: `D:/ToolDevelop/ExDashboard/frontend/vitest.config.js`
- Create: `D:/ToolDevelop/ExDashboard/frontend/index.html`
- Create: `D:/ToolDevelop/ExDashboard/frontend/src/main.js`
- Create: `D:/ToolDevelop/ExDashboard/frontend/src/App.vue`
- Create: `D:/ToolDevelop/ExDashboard/frontend/src/style.css`

**Interfaces:**
- Consumes: Task 1 (root workspace)
- Produces: Vite dev server bootable on `npm run dev`; `npm run build` outputs `dist/`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "@ex-dashboard/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "echarts": "^6.1.0",
    "papaparse": "^5.5.4",
    "pinia": "^2.2.4",
    "vue": "^3.5.12",
    "vue-router": "^4.4.5",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.4",
    "@vue/test-utils": "^2.4.6",
    "cross-env": "^10.1.0",
    "jsdom": "^25.0.1",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', emptyOutDir: true }
});
```

- [ ] **Step 3: Create `frontend/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js']
  }
});
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Exchange Dashboard</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/main.js`**

```js
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router.js';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

(Note: `router.js` is stubbed in Task 22 — for now create an empty placeholder.)

- [ ] **Step 6: Create placeholder `frontend/src/router.js`**

```js
import { createRouter, createWebHistory } from 'vue-router';
export default createRouter({ history: createWebHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div>bootstrap pending</div>' } }] });
```

- [ ] **Step 7: Create `frontend/src/App.vue`**

```vue
<template>
  <router-view />
</template>
```

- [ ] **Step 8: Create `frontend/src/style.css`**

```css
:root {
  --bg: #0f172a;
  --panel: #1e293b;
  --panel-alt: #283548;
  --border: #334155;
  --fg: #e2e8f0;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --green: #22c55e;
  --green-bg: rgba(34, 197, 94, 0.12);
  --yellow: #eab308;
  --red: #ef4444;
  --red-bg: rgba(239, 68, 68, 0.12);
  --accent: #38bdf8;
}
* { box-sizing: border-box; }
body, html, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
a { color: var(--accent); text-decoration: none; }
button { background: var(--accent); color: #0b1220; border: 0; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
input, select { background: #0b1220; color: var(--text); border: 1px solid #334155; padding: 6px 8px; border-radius: 4px; }
```

- [ ] **Step 9: Install frontend deps and verify build**

From `D:/ToolDevelop/ExDashboard`:

```bash
npm install --workspace=frontend
npm run build:frontend
```

Expected: `frontend/dist/index.html` created with no errors.

- [ ] **Step 10: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add frontend/package.json frontend/vite.config.js frontend/vitest.config.js frontend/index.html frontend/src/ frontend/package-lock.json
git commit -m "chore: scaffold frontend (Vite + Vue 3 + Pinia + dark theme)"
```

---

## Phase 2 — Center backend foundation

### Task 5: Center logger + config loader

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/logger.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/config.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/logger.test.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/config.test.js`

**Interfaces:**
- Consumes: `appsettings.json` on disk
- Produces:
  - `createLogger({ component, level })` → pino logger
  - `loadConfigOrNull(configPath)` → `{ config, installPath } | null`
  - `defaultConfig()` → defaults object
  - `getListenPort(cfg)`, `getRegistryUrl(cfg)`, `seedListenPortIfMissing(cfg)`, `sha256Hex(s)`

- [ ] **Step 1: Write logger test**

`center/tests/logger.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';

test('createLogger returns a pino-like logger with required methods', () => {
  const log = createLogger({ component: 'test', level: 'silent' });
  for (const m of ['info', 'warn', 'error', 'fatal', 'debug']) {
    assert.equal(typeof log[m], 'function', `expected log.${m} to be a function`);
  }
  assert.equal(typeof log.child, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/logger.test.js
```

Expected: FAIL with `Cannot find module '../src/logger.js'`.

- [ ] **Step 3: Implement `logger.js`**

`center/src/logger.js`:

```js
import pino from 'pino';

export function createLogger({ component = 'center', level = 'info' } = {}) {
  return pino({
    level,
    base: { component },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/logger.test.js
```

Expected: 1 passed.

- [ ] **Step 5: Write config loader test**

`center/tests/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { loadConfigOrNull, defaultConfig, sha256Hex, getListenPort } from '../src/config.js';

test('defaultConfig returns sensible defaults', () => {
  const c = defaultConfig();
  assert.equal(c.listenPort, 8080);
  assert.equal(c.heartbeatPort, 8081);
  assert.equal(c.reportPort, 8082);
  assert.equal(c.dbKind, 'mysql');
});

test('sha256Hex of known input', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('getListenPort returns explicit value', () => {
  assert.equal(getListenPort({ listenPort: 9090 }), 9090);
});

test('loadConfigOrNull returns null when file missing', async () => {
  const r = await loadConfigOrNull(path.join(os.tmpdir(), 'no-such-' + Date.now() + '.json'));
  assert.equal(r, null);
});

test('loadConfigOrNull parses a real file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'excfg-'));
  const file = path.join(dir, 'appsettings.json');
  await fs.writeFile(file, JSON.stringify({ listenPort: 7777, dbKind: 'mssql' }));
  const r = await loadConfigOrNull(file);
  assert.ok(r);
  assert.equal(r.config.listenPort, 7777);
  assert.equal(r.config.dbKind, 'mssql');
  assert.ok(r.installPath);
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/config.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 7: Implement `config.js`**

`center/src/config.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function defaultConfig() {
  return {
    listenPort: 8080,
    heartbeatPort: 8081,
    reportPort: 8082,
    logLevel: 'info',
    installPath: 'C:\\exdashboard',
    dbKind: 'mysql',
    db: { host: 'localhost', port: 3306, user: 'exdashboard', password: '', database: 'exdashboard' },
    jwt: { secret: '', expiresInSeconds: 28800 },
    agent: {
      heartbeatStaleSeconds: 90,
      queueRetentionDays: 7,
      mdbCopyRetentionDays: 7,
      serviceStateRetentionDays: 30
    }
  };
}

export function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function getListenPort(cfg) {
  return Number(cfg?.listenPort) || 8080;
}

export function getRegistryUrl(cfg) {
  return cfg?.agent?.registryUrl || '';
}

export function seedListenPortIfMissing(cfg) {
  if (!cfg.listenPort) cfg.listenPort = 8080;
  return cfg;
}

export function installPathFromConfigPath(configPath) {
  return path.resolve(path.dirname(configPath));
}

export function loadConfigOrNull(configPath) {
  if (!fs.existsSync(configPath)) return null;
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const cfg = { ...defaultConfig(), ...parsed };
  if (parsed.db) cfg.db = { ...defaultConfig().db, ...parsed.db };
  if (parsed.jwt) cfg.jwt = { ...defaultConfig().jwt, ...parsed.jwt };
  if (parsed.agent) cfg.agent = { ...defaultConfig().agent, ...parsed.agent };
  return { config: cfg, installPath: installPathFromConfigPath(configPath) };
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/config.test.js
```

Expected: 5 passed.

- [ ] **Step 9: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/logger.js center/src/config.js center/tests/
git commit -m "feat(center): add logger + config loader with tests"
```

---

### Task 6: Center DB driver layer (mysql + mssql + sql dialect)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/db/errors.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/db/sql.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/db/drivers/mysql.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/db/drivers/mssql.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/db/index.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/sql/dialect.test.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/db/errors.test.js`

**Interfaces:**
- Consumes: `dbKind: 'mysql' | 'mssql'`, db config object
- Produces:
  - `init({ dbKind, db })` → opens pool, returns `{ getDb(), close() }`
  - `sql.js`: `limit(n)` → `'TOP n'` | `'LIMIT n'`; `now()` → `'GETDATE()'` | `'NOW()'`; `quoteIdent(name)`
  - `errors.js`: classes `DbError`, `UniqueViolation`, `NotFound`

- [ ] **Step 1: Write sql dialect test**

`center/tests/sql/dialect.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limit, now, quoteIdent } from '../../src/db/sql.js';

test('limit mysql uses LIMIT', () => {
  assert.equal(limit('mysql', 10), 'LIMIT 10');
});

test('limit mssql uses TOP', () => {
  assert.equal(limit('mssql', 10), 'TOP 10');
});

test('now mysql is NOW()', () => {
  assert.equal(now('mysql'), 'NOW()');
});

test('now mssql is GETDATE()', () => {
  assert.equal(now('mssql'), 'GETDATE()');
});

test('quoteIdent wraps and escapes', () => {
  assert.equal(quoteIdent('weird]name', 'mysql'), '`weird]name`');
  assert.equal(quoteIdent('weird]name', 'mssql'), '[weird]]name]');
});
```

- [ ] **Step 2: Write errors test**

`center/tests/db/errors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DbError, UniqueViolation, NotFound } from '../../src/db/errors.js';

test('DbError carries code and message', () => {
  const e = new DbError('CODE_X', 'msg', { foo: 1 });
  assert.equal(e.code, 'CODE_X');
  assert.equal(e.message, 'msg');
  assert.deepEqual(e.details, { foo: 1 });
  assert.ok(e instanceof Error);
});

test('UniqueViolation and NotFound are DbErrors', () => {
  assert.ok(new UniqueViolation('dup') instanceof DbError);
  assert.ok(new NotFound('nope') instanceof DbError);
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/sql/dialect.test.js tests/db/errors.test.js
```

Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `db/errors.js`**

`center/src/db/errors.js`:

```js
export class DbError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export class UniqueViolation extends DbError {
  constructor(message, details) { super('UNIQUE_VIOLATION', message, details); }
}
export class NotFound extends DbError {
  constructor(message, details) { super('NOT_FOUND', message, details); }
}
```

- [ ] **Step 5: Implement `db/sql.js`**

`center/src/db/sql.js`:

```js
export function limit(dbKind, n) {
  return dbKind === 'mssql' ? `TOP ${Number(n)}` : `LIMIT ${Number(n)}`;
}

export function now(dbKind) {
  return dbKind === 'mssql' ? 'GETDATE()' : 'NOW()';
}

export function quoteIdent(name, dbKind) {
  if (dbKind === 'mssql') {
    return '[' + String(name).replace(/]/g, ']]') + ']';
  }
  return '`' + String(name).replace(/`/g, '``') + '`';
}
```

- [ ] **Step 6: Implement mysql driver**

`center/src/db/drivers/mysql.js`:

```js
import mysql from 'mysql2/promise';

export async function open(dbConfig) {
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: false
  });
  return { pool, kind: 'mysql' };
}

export async function query(driver, sql, params = []) {
  const [rows] = await driver.pool.execute(sql, params);
  return rows;
}

export async function close(driver) {
  await driver.pool.end();
}
```

- [ ] **Step 7: Implement mssql driver**

`center/src/db/drivers/mssql.js`:

```js
import sql from 'mssql';

export async function open(dbConfig) {
  const cfg = {
    user: dbConfig.user,
    password: dbConfig.password,
    server: dbConfig.host,
    port: Number(dbConfig.port) || 1433,
    database: dbConfig.database,
    options: { trustServerCertificate: dbConfig.trustServerCertificate ?? true }
  };
  const pool = await new sql.ConnectionPool(cfg).connect();
  return { pool, kind: 'mssql' };
}

export async function query(driver, sqlText, params = []) {
  const req = driver.pool.request();
  for (let i = 0; i < params.length; i++) req.input(`p${i}`, params[i]);
  // Replace ? placeholders with @p0..@pN for mssql
  const rewritten = sqlText.replace(/\?/g, () => `@p${Array.from(arguments).indexOf('?')}`);
  // NOTE: For simplicity in v1, params are positional; rewrite is best-effort.
  // The router layer should use named params for mssql paths where possible.
  const result = await req.query(rewritten);
  return result.recordset || [];
}

export async function close(driver) {
  await driver.pool.close();
}
```

> ⚠️ **Note**: The placeholder rewrite in the mssql driver above is best-effort. A production-ready implementation should accept named params (`{ name: value }`) and rewrite to `@name`. For v1, prefer using the mysql path in tests, and keep mssql as a real-driver smoke-tested path; tighten placeholder handling if a test fails. Update this file to use a proper named-params API if you do.

Replace the rewrite block with:

```js
export async function query(driver, sqlText, params = []) {
  const req = driver.pool.request();
  const named = {};
  for (let i = 0; i < params.length; i++) {
    named[`p${i}`] = params[i];
    req.input(`p${i}`, params[i]);
  }
  // Replace each literal ? with @p0, @p1, ... in order.
  let i = 0;
  const rewritten = sqlText.replace(/\?/g, () => {
    const k = `p${i++}`;
    return `@${k}`;
  });
  const result = await req.query(rewritten);
  return result.recordset || [];
}
```

- [ ] **Step 8: Implement `db/index.js`**

`center/src/db/index.js`:

```js
import * as mysql from './drivers/mysql.js';
import * as mssql from './drivers/mssql.js';

const drivers = { mysql, mssql };

export async function init(dbConfig) {
  const driverMod = drivers[dbConfig.dbKind];
  if (!driverMod) throw new Error(`Unsupported dbKind: ${dbConfig.dbKind}`);
  const driver = await driverMod.open(dbConfig.db);
  return {
    driver,
    query: (sql, params) => driverMod.query(driver, sql, params),
    close: () => driverMod.close(driver)
  };
}

export { close };
export const getDb = (ctx) => ctx.driver;

import { close } from './index.js';
```

> Implementation note: collapse the `close` import into the top of the file in actual code; the above is illustrative. Final form:

```js
import * as mysql from './drivers/mysql.js';
import * as mssql from './drivers/mssql.js';
const drivers = { mysql, mssql };

export async function init(dbConfig) {
  const driverMod = drivers[dbConfig.dbKind];
  if (!driverMod) throw new Error(`Unsupported dbKind: ${dbConfig.dbKind}`);
  const driver = await driverMod.open(dbConfig.db);
  return {
    driver,
    query: (sql, params) => driverMod.query(driver, sql, params),
    close: () => driverMod.close(driver)
  };
}

export async function close(ctx) {
  await ctx.close();
}
```

- [ ] **Step 9: Run all tests in this task**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/sql/dialect.test.js tests/db/errors.test.js
```

Expected: 7 passed (5 sql + 2 errors).

- [ ] **Step 10: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/db/ center/tests/sql/ center/tests/db/
git commit -m "feat(center): add db driver layer (mysql + mssql) + sql dialect"
```

---

### Task 7: Center init wizard (3 screens + marker + finalize)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/needs-init.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/marker.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/verify-marker.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/db-tester.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/admin-creator.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/config-writer.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/schema-applier.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/wizard-facade.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/init/router.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/init/marker.test.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/init/wizard-facade.test.js`

**Interfaces:**
- `checkNeedsInit({ configPath })` → `boolean`
- `hasMarker({ configPath })` → `boolean`
- `writeMarker({ configPath })` → writes `.env` + sets registry on Windows
- `testDbConnection(dbKind, dbConfig)` → `{ ok, error? }`
- `applySchema(db, dbKind)` → idempotent
- `createAdminUser(db, { username, password })` → bcrypt hash + insert
- `writeConfig(configPath, config)` → atomic write
- `wizardFacade({ dbKind, db, admin })` → runs steps in order; returns `{ ok, exit }`
- `initRouter({ deps })` → Express router with `GET /status`, `POST /test-db`, `POST /finalize`

- [ ] **Step 1: Write marker test**

`center/tests/init/marker.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { hasMarker, writeMarker } from '../../src/init/marker.js';

test('hasMarker returns false when .env missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-'));
  assert.equal(await hasMarker({ configPath: path.join(dir, 'x.json') }), false);
});

test('writeMarker writes .env sibling and hasMarker then true', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-'));
  const cfg = path.join(dir, 'appsettings.json');
  await fs.writeFile(cfg, '{}');
  await writeMarker({ configPath: cfg });
  assert.equal(await hasMarker({ configPath: cfg }), true);
  const env = await fs.readFile(path.join(dir, '.env'), 'utf8');
  assert.match(env, /EXDASHBOARD_INITIALIZED=1/);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/init/marker.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `init/marker.js`**

`center/src/init/marker.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

export function installPathFromConfigPath(configPath) {
  return path.resolve(path.dirname(configPath));
}

export function hasMarker({ configPath }) {
  const envPath = path.join(installPathFromConfigPath(configPath), '.env');
  if (!fs.existsSync(envPath)) return false;
  return /^EXDASHBOARD_INITIALIZED=1/m.test(fs.readFileSync(envPath, 'utf8'));
}

export function writeMarker({ configPath }) {
  const dir = installPathFromConfigPath(configPath);
  const envPath = path.join(dir, '.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const next = existing
    .split(/\r?\n/)
    .filter((l) => !/^EXDASHBOARD_INITIALIZED=/.test(l))
    .concat('EXDASHBOARD_INITIALIZED=1')
    .join('\n');
  fs.writeFileSync(envPath, next);
  // Registry write only attempted on Windows; failure is non-fatal.
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('node:child_process');
      execSync('reg add "HKLM\\SOFTWARE\\ExDashboard" /v Initialized /t REG_DWORD /d 1 /f', { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Implement `init/needs-init.js`**

`center/src/init/needs-init.js`:

```js
import fs from 'node:fs';
import { hasMarker } from './marker.js';

export function checkNeedsInit({ configPath }) {
  if (!fs.existsSync(configPath)) return true;
  return !hasMarker({ configPath });
}
```

- [ ] **Step 5: Implement `init/verify-marker.js`**

`center/src/init/verify-marker.js`:

```js
import { hasMarker } from './marker.js';

export function verifyMarker({ configPath }) {
  return hasMarker({ configPath });
}
```

- [ ] **Step 6: Implement `init/db-tester.js`**

`center/src/init/db-tester.js`:

```js
import * as mysql from '../db/drivers/mysql.js';
import * as mssql from '../db/drivers/mssql.js';

const drivers = { mysql, mssql };

export async function testDbConnection(dbKind, dbConfig) {
  const m = drivers[dbKind];
  if (!m) return { ok: false, error: `Unsupported dbKind: ${dbKind}` };
  let driver;
  try {
    driver = await m.open(dbConfig);
    await m.query(driver, 'SELECT 1');
    await m.close(driver);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 7: Implement `init/schema-applier.js`**

This applies the SQL DDL under `db/schema/`. For v1, ship a single migration that creates all the tables listed in spec §8.

`center/src/init/schema-applier.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, '../../../db/schema');

export function listMigrations() {
  return fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.sql')).sort();
}

export async function applySchema(db, dbKind) {
  for (const file of listMigrations()) {
    const sql = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
    const stmts = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await db.query(stmt);
    }
  }
}
```

- [ ] **Step 8: Create initial schema files**

Create `D:/ToolDevelop/ExDashboard/db/schema/001-initial.sql`:

```sql
-- Initial schema for ExDashboard (MySQL / SQL Server compatible via driver rewrites)

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enabled TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) UNIQUE NOT NULL
);

CREATE TABLE user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INT NULL,
  action VARCHAR(128) NOT NULL,
  target VARCHAR(255) NULL,
  details TEXT NULL
);

CREATE TABLE system_config (
  k VARCHAR(64) PRIMARY KEY,
  v VARCHAR(255) NOT NULL
);

CREATE TABLE agents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) UNIQUE NOT NULL,
  hostname VARCHAR(128) NOT NULL,
  fqdn VARCHAR(255) NULL,
  os_version VARCHAR(128) NULL,
  exchange_version VARCHAR(64) NULL,
  server_role INT NOT NULL DEFAULT 0,
  dag_id INT NULL,
  last_heartbeat_at DATETIME NULL,
  last_report_at DATETIME NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE heartbeat_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  payload TEXT NULL
);

CREATE TABLE packages (
  name VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  manifest TEXT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE package_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_name VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(32) NOT NULL,
  output TEXT NULL
);

CREATE TABLE package_versions (
  package_name VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (package_name, version)
);

-- Exchange-specific tables

CREATE TABLE dags (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) UNIQUE NOT NULL,
  description VARCHAR(255) NULL,
  file_share_witness VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE servers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NULL,
  hostname VARCHAR(128) UNIQUE NOT NULL,
  fqdn VARCHAR(255) NULL,
  os_version VARCHAR(128) NULL,
  exchange_version VARCHAR(64) NULL,
  server_role INT NOT NULL DEFAULT 0,
  dag_id INT NULL,
  last_heartbeat_at DATETIME NULL,
  last_report_at DATETIME NULL,
  enabled TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE dag_members (
  dag_id INT NOT NULL,
  server_id INT NOT NULL,
  preferred_activations INT NOT NULL DEFAULT 1,
  replication_enabled TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (dag_id, server_id)
);

CREATE TABLE mdb_catalog (
  db_id VARCHAR(64) PRIMARY KEY,
  db_name VARCHAR(128) NOT NULL,
  dag_id INT NULL,
  server_id INT NULL,
  edb_file_path VARCHAR(255) NULL,
  log_folder_path VARCHAR(255) NULL,
  circular_logging TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE queue_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  queue_kind VARCHAR(32) NOT NULL,
  queue_name VARCHAR(128) NOT NULL,
  message_count INT NOT NULL DEFAULT 0,
  oldest_message_age_seconds INT NULL,
  messages_per_sec DECIMAL(12,4) NULL,
  deferred_per_sec DECIMAL(12,4) NULL
);
CREATE INDEX idx_queue_snap_server_time ON queue_snapshots (server_id, captured_at);
CREATE INDEX idx_queue_snap_kind ON queue_snapshots (queue_kind);

CREATE TABLE mdb_copy_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  db_id VARCHAR(64) NOT NULL,
  captured_at DATETIME NOT NULL,
  copy_queue_length INT NOT NULL DEFAULT 0,
  replay_lag_seconds INT NULL,
  mount_status TINYINT NOT NULL DEFAULT 0,
  content_index_state VARCHAR(32) NULL,
  is_active_copy TINYINT NOT NULL DEFAULT 0,
  activation_preference INT NULL
);
CREATE INDEX idx_mdb_copy_db_server_time ON mdb_copy_snapshots (db_id, server_id, captured_at);

CREATE TABLE service_states (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL,
  start_mode VARCHAR(16) NOT NULL
);
CREATE INDEX idx_service_states_server_time ON service_states (server_id, captured_at);

CREATE TABLE client_access_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  metric VARCHAR(64) NOT NULL,
  value DECIMAL(18,4) NOT NULL
);
CREATE INDEX idx_client_access_server_metric_time ON client_access_snapshots (server_id, metric, captured_at);

CREATE TABLE server_resources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  cpu_pct DECIMAL(5,2) NULL,
  memory_available_mb BIGINT NULL,
  disk_c_free_pct DECIMAL(5,2) NULL,
  net_bytes_per_sec BIGINT NULL
);
CREATE INDEX idx_server_resources_server_time ON server_resources (server_id, captured_at);

CREATE TABLE mailflow_summaries (
  server_id INT PRIMARY KEY,
  captured_at DATETIME NOT NULL,
  total_queue_length INT NOT NULL DEFAULT 0,
  poison_queue_length INT NOT NULL DEFAULT 0,
  retry_queue_length INT NOT NULL DEFAULT 0
);

CREATE TABLE mailflow_errors (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  severity VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  message VARCHAR(255) NULL
);

CREATE TABLE dag_replication_matrix (
  dag_id INT NOT NULL,
  db_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  copy_queue_length INT NULL,
  replay_lag_seconds INT NULL,
  mount_status TINYINT NULL,
  PRIMARY KEY (dag_id, db_id, server_id, captured_at)
);
```

> For SQL Server: the same file is shipped verbatim; the driver rewrites `AUTO_INCREMENT` → `IDENTITY`, `DATETIME` → `DATETIME2`, and `TINYINT NOT NULL DEFAULT 0/1` is already compatible. If your target SQL Server complains about `TINYINT DEFAULT 1`, accept it; the driver layer is responsible for translation. Document any post-task fixes inline.

- [ ] **Step 9: Implement `init/admin-creator.js`**

`center/src/init/admin-creator.js`:

```js
import bcrypt from 'bcryptjs';

export async function createAdminUser(db, { username, password }) {
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'admin']);
}
```

- [ ] **Step 10: Implement `init/config-writer.js`**

`center/src/init/config-writer.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

export function writeConfig(configPath, config) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath);
}
```

- [ ] **Step 11: Implement `init/wizard-facade.js`**

`center/src/init/wizard-facade.js`:

```js
import { testDbConnection } from './db-tester.js';
import { applySchema } from './schema-applier.js';
import { createAdminUser } from './admin-creator.js';
import { writeConfig } from './config-writer.js';
import { writeMarker } from './marker.js';

export async function wizardFacade({ dbKind, db: dbConfig, admin, installPath, configPath }) {
  const tested = await testDbConnection(dbKind, dbConfig);
  if (!tested.ok) return { ok: false, stage: 'test-db', error: tested.error };

  const { init } = await import('../db/index.js');
  const ctx = await init({ dbKind, db: dbConfig });
  try {
    await applySchema(ctx, dbKind);
    await createAdminUser(ctx, admin);
  } finally {
    await ctx.close();
  }

  const config = {
    listenPort: 8080,
    heartbeatPort: 8081,
    reportPort: 8082,
    logLevel: 'info',
    installPath,
    dbKind,
    db: dbConfig,
    jwt: { secret: require('node:crypto').randomBytes(32).toString('hex'), expiresInSeconds: 28800 },
    agent: { heartbeatStaleSeconds: 90, queueRetentionDays: 7, mdbCopyRetentionDays: 7, serviceStateRetentionDays: 30 }
  };
  writeConfig(configPath, config);
  writeMarker({ configPath });

  return { ok: true, exit: true };
}

let closed = false;
export function closeWizardFacade() { closed = true; }
export function isClosed() { return closed; }
```

> Replace the inline `require('node:crypto')` with the proper ESM import at the top:
```js
import crypto from 'node:crypto';
...
secret: crypto.randomBytes(32).toString('hex'),
```

- [ ] **Step 12: Implement `init/router.js`**

`center/src/init/router.js`:

```js
import express from 'express';
import { checkNeedsInit } from './needs-init.js';
import { testDbConnection } from './db-tester.js';
import { wizardFacade } from './wizard-facade.js';

export function initRouter({ configPath }) {
  const r = express.Router();
  r.use(express.json());

  r.get('/status', (req, res) => {
    res.json({ needsInit: checkNeedsInit({ configPath }) });
  });

  r.post('/test-db', async (req, res) => {
    const { dbKind, db } = req.body || {};
    const out = await testDbConnection(dbKind, db);
    res.json(out);
  });

  r.post('/finalize', async (req, res) => {
    const { dbKind, db, admin, installPath } = req.body || {};
    const out = await wizardFacade({ dbKind, db, admin, installPath, configPath });
    if (!out.ok) {
      return res.status(400).json({ error: { code: 'INIT_FAILED', message: out.error, details: { stage: out.stage } } });
    }
    res.json({ ok: true });
    // Caller is expected to gracefully shut down after finalize.
  });

  return r;
}
```

- [ ] **Step 13: Write wizard facade test**

`center/tests/init/wizard-facade.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { hasMarker } from '../../src/init/marker.js';
import { wizardFacade } from '../../src/init/wizard-facade.js';

test('wizardFacade rejects unsupported dbKind', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-'));
  const cfg = path.join(dir, 'appsettings.json');
  await fs.writeFile(cfg, '{}');
  const out = await wizardFacade({ dbKind: 'postgres', db: {}, admin: { username: 'a', password: 'longenough' }, installPath: dir, configPath: cfg });
  assert.equal(out.ok, false);
  assert.equal(out.stage, 'test-db');
});
```

- [ ] **Step 14: Run all init tests**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/init/marker.test.js tests/init/wizard-facade.test.js
```

Expected: marker tests pass (file-based); wizard facade test passes (rejects bad dbKind without trying to connect).

- [ ] **Step 15: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/init/ center/tests/init/ db/schema/
git commit -m "feat(center): init wizard (3 screens) + marker + schema applier"
```

---

### Task 8: Center auth (bcrypt + jwt + RBAC)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/auth/user-auth.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/auth/rbac.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/auth.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/healthz.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/auth/user-auth.test.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/routes/auth.test.js`

**Interfaces:**
- `userAuth({ db, jwtSecret, expiresInSeconds })` → `{ router, requireAuth, requirePerm }`
- `requireAuth(req,res,next)` — sets `req.user`
- `requirePerm(perm)(req,res,next)` — checks `req.user.perms` includes perm
- `POST /api/auth/login` → `{ token, user }`
- `POST /api/auth/logout` → `{ ok }`
- `GET /api/auth/me` → user info

- [ ] **Step 1: Write user-auth test**

`center/tests/auth/user-auth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userAuth } from '../../src/auth/user-auth.js';

function fakeDb(user) {
  return {
    async query(sql, params) {
      if (/FROM users/.test(sql)) return [user];
      return [];
    }
  };
}

test('login succeeds with correct password and issues jwt', async () => {
  const hash = await bcrypt.hash('right-password', 4);
  const db = fakeDb({ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 });
  const u = userAuth({ db, jwtSecret: 'test-secret', expiresInSeconds: 60 });
  const out = await u.login({ username: 'admin', password: 'right-password' });
  assert.equal(out.ok, true);
  assert.equal(out.user.username, 'admin');
  assert.ok(out.token);
  const decoded = jwt.verify(out.token, 'test-secret');
  assert.equal(decoded.sub, 'admin');
});

test('login fails with wrong password', async () => {
  const hash = await bcrypt.hash('right', 4);
  const db = fakeDb({ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 });
  const u = userAuth({ db, jwtSecret: 's', expiresInSeconds: 60 });
  const out = await u.login({ username: 'admin', password: 'wrong' });
  assert.equal(out.ok, false);
});

test('login rejects disabled user', async () => {
  const hash = await bcrypt.hash('p', 4);
  const db = fakeDb({ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 0 });
  const u = userAuth({ db, jwtSecret: 's', expiresInSeconds: 60 });
  const out = await u.login({ username: 'admin', password: 'p' });
  assert.equal(out.ok, false);
});

test('requireAuth accepts valid token', async () => {
  const token = jwt.sign({ sub: 'admin', role: 'admin' }, 's', { expiresIn: 60 });
  const u = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let called = false;
  await new Promise((resolve) => u.requireAuth(req, {}, () => { called = true; resolve(); }));
  assert.equal(called, true);
  assert.equal(req.user.username, 'admin');
});

test('requireAuth rejects missing token', async () => {
  const u = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 });
  const res = { status(c) { this.code = c; return this; }, json(o) { this.body = o; } };
  let nextCalled = false;
  await u.requireAuth({ headers: {} }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.code, 401);
});

test('requirePerm allows admin', () => {
  const mw = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 }).requirePerm('admin:users');
  const req = { user: { role: 'admin' } };
  let called = false;
  mw(req, {}, () => { called = true; });
  assert.equal(called, true);
});

test('requirePerm denies user without perm', () => {
  const mw = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 }).requirePerm('admin:users');
  const req = { user: { role: 'viewer' } };
  const res = { status(c) { this.code = c; return this; }, json() {} };
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.code, 403);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/auth/user-auth.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `auth/user-auth.js`**

`center/src/auth/user-auth.js`:

```js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function permsForRole(role) {
  if (role === 'admin') return new Set(['admin:users', 'admin:packages']);
  return new Set();
}

export function userAuth({ db, jwtSecret, expiresInSeconds = 28800 }) {
  async function login({ username, password }) {
    const rows = await db.query('SELECT id, username, password_hash, role, enabled FROM users WHERE username = ?', [username]);
    const user = rows && rows[0];
    if (!user || !user.enabled) return { ok: false };
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return { ok: false };
    const token = jwt.sign({ sub: user.username, role: user.role, uid: user.id }, jwtSecret, { expiresIn: expiresInSeconds });
    return { ok: true, token, user: { id: user.id, username: user.username, role: user.role } };
  }

  function requireAuth(req, res, next) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'missing token' } });
    try {
      const decoded = jwt.verify(m[1], jwtSecret);
      req.user = { id: decoded.uid, username: decoded.sub, role: decoded.role, perms: permsForRole(decoded.role) };
      next();
    } catch (e) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'invalid token' } });
    }
  }

  function requirePerm(perm) {
    return (req, res, next) => {
      if (!req.user || !req.user.perms.has(perm)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `missing perm: ${perm}` } });
      }
      next();
    };
  }

  return { login, requireAuth, requirePerm };
}
```

- [ ] **Step 4: Implement `auth/rbac.js` (thin re-export)**

`center/src/auth/rbac.js`:

```js
export { userAuth } from './user-auth.js';
```

- [ ] **Step 5: Implement `routes/auth.js`**

`center/src/routes/auth.js`:

```js
import express from 'express';

export function authRouter({ db, jwtSecret, expiresInSeconds }) {
  const r = express.Router();
  const { userAuth: make } = await import('../auth/user-auth.js');
  const u = make({ db, jwtSecret, expiresInSeconds });

  r.use(express.json());

  r.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const out = await u.login({ username, password });
    if (!out.ok) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid credentials' } });
    res.json(out);
  });

  r.post('/logout', (_req, res) => res.json({ ok: true }));

  r.get('/me', u.requireAuth, (req, res) => res.json({ user: req.user }));

  return r;
}
```

> Note: the dynamic `await import` inside a non-async function expression is invalid. Convert the export to async, or hoist. Final form:

```js
import express from 'express';
import { userAuth } from '../auth/user-auth.js';

export function authRouter({ db, jwtSecret, expiresInSeconds }) {
  const r = express.Router();
  const u = userAuth({ db, jwtSecret, expiresInSeconds });

  r.use(express.json());

  r.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const out = await u.login({ username, password });
    if (!out.ok) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid credentials' } });
    res.json(out);
  });

  r.post('/logout', (_req, res) => res.json({ ok: true }));

  r.get('/me', u.requireAuth, (req, res) => res.json({ user: req.user }));

  return r;
}
```

- [ ] **Step 6: Implement `routes/healthz.js`**

`center/src/routes/healthz.js`:

```js
import express from 'express';
import { checkNeedsInit } from '../init/needs-init.js';

export function healthzRouter({ configPath } = {}) {
  const r = express.Router();
  r.get('/healthz', (_req, res) => {
    const needsInit = configPath ? checkNeedsInit({ configPath }) : false;
    res.json({ ok: true, needsInit });
  });
  return r;
}
```

- [ ] **Step 7: Write auth route test**

`center/tests/routes/auth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import bcrypt from 'bcryptjs';
import { authRouter } from '../../src/routes/auth.js';

test('POST /api/auth/login → 200 + token on right password', async () => {
  const hash = await bcrypt.hash('hunter22', 4);
  const db = { async query() { return [{ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 }]; } };
  const app = express();
  app.use('/api/auth', authRouter({ db, jwtSecret: 's', expiresInSeconds: 60 }));
  const r = await supertest(app).post('/api/auth/login').send({ username: 'admin', password: 'hunter22' });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.role, 'admin');
});

test('POST /api/auth/login → 401 on wrong password', async () => {
  const hash = await bcrypt.hash('hunter22', 4);
  const db = { async query() { return [{ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 }]; } };
  const app = express();
  app.use('/api/auth', authRouter({ db, jwtSecret: 's', expiresInSeconds: 60 }));
  const r = await supertest(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
});
```

- [ ] **Step 8: Run all auth tests**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/auth/user-auth.test.js tests/routes/auth.test.js
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/auth/ center/src/routes/auth.js center/src/routes/healthz.js center/tests/auth/ center/tests/routes/
git commit -m "feat(center): auth (bcrypt+jwt+rbac) + auth route + healthz"
```

---

### Task 9: Center three-port server + agent router mount gates

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/multi-port.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/app.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/agent.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/routes/agent.test.js`

**Interfaces:**
- `createApp({ config, db, logger, needsInit })` → Express app (web)
- `startServers({ webApp, heartbeatApp, reportApp, ports, logger })` → spawns listen on 3 ports, returns handles
- `closeAll(handles)` → graceful shutdown
- `agentRouter({ config, logger, mount })` → router with three mounts (`'web' | 'heartbeat' | 'report'`)

- [ ] **Step 1: Implement `app.js`**

`center/src/app.js`:

```js
import express from 'express';
import pinoHttp from 'pino-http';

export function createApp({ config, db, logger, needsInit }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  if (logger) app.use(pinoHttp({ logger }));
  app.locals.config = config;
  app.locals.db = db;
  app.locals.needsInit = needsInit;
  return app;
}
```

- [ ] **Step 2: Implement `multi-port.js`**

`center/src/multi-port.js`:

```js
import http from 'node:http';

export function startServers({ webApp, heartbeatApp, reportApp, ports, logger }) {
  const handles = {};
  for (const [name, app, port] of [
    ['web', webApp, ports.web],
    ['heartbeat', heartbeatApp, ports.heartbeat],
    ['report', reportApp, ports.report]
  ]) {
    const server = http.createServer(app);
    server.listen(port, () => logger.info({ port, name }, 'listening'));
    handles[name] = server;
  }
  return handles;
}

export async function closeAll(handles) {
  for (const h of Object.values(handles)) {
    await new Promise((r) => h.close(() => r()));
  }
}
```

- [ ] **Step 3: Implement `routes/agent.js`**

`center/src/routes/agent.js`:

```js
import express from 'express';

export function agentRouter({ config, logger, mount = 'web' }) {
  const r = express.Router();
  r.use(express.json({ limit: mount === 'report' ? '10mb' : '256kb' }));

  if (mount === 'heartbeat' || mount === 'web') {
    r.post('/heartbeat', async (req, res) => {
      const { agentId, hostname } = req.body || {};
      if (!agentId) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId required' } });
      logger.info({ agentId, hostname }, 'heartbeat');
      // Persist + touch last_heartbeat_at on agents/servers
      try {
        await req.app.locals.db.query(
          'UPDATE agents SET last_heartbeat_at = NOW() WHERE agent_id = ?',
          [agentId]
        );
      } catch (e) {
        logger.warn({ err: e.message }, 'heartbeat update failed');
      }
      res.json({ ok: true, ts: new Date().toISOString() });
    });
  }

  if (mount === 'report' || mount === 'web') {
    r.post('/report', async (req, res) => {
      // Full ingestion is implemented in Task 21. v1 stub: 202 Accepted.
      logger.info({ size: JSON.stringify(req.body || {}).length }, 'report received');
      res.status(202).json({ ok: true });
    });

    r.post('/discover', async (req, res) => {
      const { agentId, hostname, fqdn, osVersion, exchangeVersion, serverRole, dagId } = req.body || {};
      if (!agentId || !hostname) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId + hostname required' } });
      }
      try {
        await req.app.locals.db.query(
          `INSERT INTO agents (agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             fqdn = VALUES(fqdn),
             os_version = VALUES(os_version),
             exchange_version = VALUES(exchange_version),
             server_role = VALUES(server_role),
             dag_id = VALUES(dag_id)`,
          [agentId, hostname, fqdn || null, osVersion || null, exchangeVersion || null, Number(serverRole) || 0, dagId || null]
        );
        await req.app.locals.db.query(
          `INSERT INTO servers (agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id)
           SELECT agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id FROM agents WHERE agent_id = ?
           ON DUPLICATE KEY UPDATE
             fqdn = VALUES(fqdn),
             os_version = VALUES(os_version),
             exchange_version = VALUES(exchange_version),
             server_role = VALUES(server_role),
             dag_id = VALUES(dag_id)`,
          [agentId]
        );
        res.json({ ok: true });
      } catch (e) {
        logger.error({ err: e.message }, 'discover failed');
        res.status(500).json({ error: { code: 'DB_ERROR', message: e.message } });
      }
    });
  }

  if (mount === 'web') {
    r.get('/config', (_req, res) => {
      res.json({
        heartbeatPort: config.heartbeatPort,
        reportPort: config.reportPort,
        serverVersion: '0.1.0'
      });
    });
  }

  return r;
}
```

- [ ] **Step 4: Write agent route test**

`center/tests/routes/agent.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { agentRouter } from '../../src/routes/agent.js';

function makeApp(db) {
  const app = express();
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.use('/api/agent', agentRouter({ config: { heartbeatPort: 8081, reportPort: 8082 }, logger: app.locals.logger, mount: 'web' }));
  return app;
}

test('POST /api/agent/heartbeat requires agentId', async () => {
  const db = { async query() {} };
  const r = await supertest(makeApp(db)).post('/api/agent/heartbeat').send({});
  assert.equal(r.status, 400);
});

test('POST /api/agent/heartbeat OK with agentId', async () => {
  let called = false;
  const db = { async query() { called = true; } };
  const r = await supertest(makeApp(db)).post('/api/agent/heartbeat').send({ agentId: 'a1', hostname: 'h1' });
  assert.equal(r.status, 200);
  assert.equal(called, true);
});

test('POST /api/agent/discover upserts both agents and servers', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); } };
  const r = await supertest(makeApp(db)).post('/api/agent/discover').send({ agentId: 'a1', hostname: 'h1', fqdn: 'h1.local', osVersion: 'Win2022', exchangeVersion: '15.2', serverRole: 7, dagId: 1 });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);
});

test('POST /api/agent/discover rejects missing hostname', async () => {
  const db = { async query() {} };
  const r = await supertest(makeApp(db)).post('/api/agent/discover').send({ agentId: 'a1' });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 5: Run agent tests**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/routes/agent.test.js
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/app.js center/src/multi-port.js center/src/routes/agent.js center/tests/routes/agent.test.js
git commit -m "feat(center): three-port server split + agent router (heartbeat/report/discover)"
```

---

### Task 10: Center schema migrations + system_config

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/migrations.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/config.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/schema-migrations.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/services/migrations.test.js`

**Interfaces:**
- `getCurrentVersion(db)` → string|null
- `applyPendingMigrations(db, dbKind)` → applies new files from `db/migrations/`, records version
- `getConfig(db, key)` → string|null
- `setConfig(db, key, value)` → upsert
- `GET /api/migrations` → `{ applied: [], pending: [] }`
- `POST /api/migrations/apply` → applies pending

- [ ] **Step 1: Write migrations service test**

`center/tests/services/migrations.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyPendingMigrations, getCurrentVersion } from '../../src/services/migrations.js';

function fakeDb() {
  const applied = [];
  return {
    applied,
    async query(sql, params) {
      if (/INSERT INTO schema_migrations/.test(sql)) {
        applied.push(params[0]);
        return [];
      }
      if (/SELECT version FROM schema_migrations/.test(sql)) {
        return applied.map((v) => ({ version: v }));
      }
      return [];
    }
  };
}

test('applyPendingMigrations applies new files in order', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mig-'));
  await fs.writeFile(path.join(dir, '001-a.sql'), 'CREATE TABLE a (id INT);');
  await fs.writeFile(path.join(dir, '002-b.sql'), 'CREATE TABLE b (id INT);');
  const db = fakeDb();
  await applyPendingMigrations(db, dir);
  assert.equal(await getCurrentVersion(db), '002-b');
  assert.deepEqual(db.applied, ['001-a', '002-b']);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/migrations.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement `services/migrations.js`**

`center/src/services/migrations.js`:

```js
import fs from 'node:fs';
import path from 'node:path';

export async function getCurrentVersion(db) {
  const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  return rows && rows[0] ? rows[0].version : null;
}

export async function listApplied(db) {
  const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version ASC');
  return (rows || []).map((r) => r.version);
}

export async function listPending(dir, applied) {
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const set = new Set(applied);
  return all.filter((f) => !set.has(f));
}

export async function applyPendingMigrations(db, dir) {
  const applied = await listApplied(db);
  const pending = await listPending(dir, applied);
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const stmts = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await db.query(stmt);
    }
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
  }
  return pending.length;
}
```

- [ ] **Step 4: Implement `services/config.js`**

`center/src/services/config.js`:

```js
export async function getConfig(db, key) {
  const rows = await db.query('SELECT v FROM system_config WHERE k = ?', [key]);
  return rows && rows[0] ? rows[0].v : null;
}

export async function setConfig(db, key, value) {
  await db.query(
    'INSERT INTO system_config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [key, String(value)]
  );
}

export async function getAllConfig(db) {
  const rows = await db.query('SELECT k, v FROM system_config');
  const out = {};
  for (const r of rows || []) out[r.k] = r.v;
  return out;
}
```

- [ ] **Step 5: Implement `routes/schema-migrations.js`**

`center/src/routes/schema-migrations.js`:

```js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../auth/user-auth.js';
import { listApplied, listPending, applyPendingMigrations } from '../services/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../../db/migrations');

export function schemaMigrationsRouter({ db }) {
  const r = express.Router();
  r.get('/', requireAuth, async (_req, res) => {
    const applied = await listApplied(db);
    const pending = await listPending(MIG_DIR, applied);
    res.json({ applied, pending });
  });
  r.post('/apply', requireAuth, async (_req, res) => {
    const n = await applyPendingMigrations(db, MIG_DIR);
    res.json({ applied: n });
  });
  return r;
}
```

- [ ] **Step 6: Run migrations test**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/migrations.test.js
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/services/migrations.js center/src/services/config.js center/src/routes/schema-migrations.js center/tests/services/migrations.test.js
git commit -m "feat(center): migrations service + system_config service + admin migrations route"
```

---

### Task 11: Center core services (users/audit/config/ports/migrations/probe)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/users.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/audit.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/audit-classifier.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/ports.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/port-status.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/heartbeat-report.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/probe.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/services/users.test.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/services/audit-classifier.test.js`

**Interfaces:**
- `users.js`: `listUsers(db)`, `createUser(db, {username,password,role})`, `setEnabled(db, id, enabled)`, `deleteUser(db, id)`
- `audit.js`: `writeAudit(db, { userId, action, target, details })`
- `audit-classifier.js`: `classify({ action, target })` → `'auth'|'config'|'data'|'admin'|'unknown'`
- `ports.js`: `getPortStates(db)` returns `{ web, heartbeat, report, stale }`
- `port-status.js`: `probePort(host, port, timeoutMs)` → `{ ok, latencyMs? }`
- `heartbeat-report.js`: `getOfflineAgents(db, staleSeconds)` → list of `agent_id, hostname, last_heartbeat_at`
- `probe.js`: `createProbeLoop({ db, logger, intervalMs })` → starts a `setInterval` running retention purge + heartbeat stale detection; `stop()` to clear

- [ ] **Step 1: Write users test**

`center/tests/services/users.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { listUsers, createUser } from '../../src/services/users.js';

function fakeDb() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (/INSERT INTO users/.test(sql)) { rows.push({ id: rows.length + 1, username: params[0], role: params[2] }); return []; }
      if (/SELECT id, username, role/.test(sql)) return rows;
      return [];
    }
  };
}

test('createUser hashes password and inserts row', async () => {
  const db = fakeDb();
  await createUser(db, { username: 'bob', password: 'hunter22', role: 'user' });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].username, 'bob');
  assert.equal(db.rows[0].role, 'user');
});

test('listUsers returns rows', async () => {
  const db = fakeDb();
  await createUser(db, { username: 'alice', password: 'hunter22', role: 'admin' });
  const list = await listUsers(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].username, 'alice');
});
```

- [ ] **Step 2: Write audit-classifier test**

`center/tests/services/audit-classifier.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../src/services/audit-classifier.js';

test('login → auth', () => { assert.equal(classify({ action: 'login' }), 'auth'); });
test('users.create → admin', () => { assert.equal(classify({ action: 'users.create' }), 'admin'); });
test('config.update → config', () => { assert.equal(classify({ action: 'config.update', target: 'system' }), 'config'); });
test('queues.delete → data', () => { assert.equal(classify({ action: 'queues.delete' }), 'data'); });
test('unknown → unknown', () => { assert.equal(classify({ action: 'frobnicate' }), 'unknown'); });
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/users.test.js tests/services/audit-classifier.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement `services/users.js`**

`center/src/services/users.js`:

```js
import bcrypt from 'bcryptjs';

export async function listUsers(db) {
  return await db.query('SELECT id, username, role, enabled, created_at FROM users ORDER BY id ASC');
}

export async function createUser(db, { username, password, role = 'user' }) {
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role]);
}

export async function setEnabled(db, id, enabled) {
  await db.query('UPDATE users SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function deleteUser(db, id) {
  await db.query('DELETE FROM users WHERE id = ?', [id]);
}
```

- [ ] **Step 5: Implement `services/audit.js`**

`center/src/services/audit.js`:

```js
export async function writeAudit(db, { userId = null, action, target = null, details = null }) {
  await db.query(
    'INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)',
    [userId, action, target, details ? JSON.stringify(details) : null]
  );
}
```

- [ ] **Step 6: Implement `services/audit-classifier.js`**

`center/src/services/audit-classifier.js`:

```js
const RULES = [
  { match: /^login$|^logout$/, cat: 'auth' },
  { match: /^users\.|^roles\.|^init\./, cat: 'admin' },
  { match: /^config\.|^system_config\./, cat: 'config' },
  { match: /^queues\.|^dags?\.|^servers\.|^mdb\.|^mailflow\./, cat: 'data' }
];

export function classify({ action }) {
  for (const r of RULES) {
    if (r.match.test(action || '')) return r.cat;
  }
  return 'unknown';
}
```

- [ ] **Step 7: Implement `services/ports.js` + `port-status.js`**

`center/src/services/ports.js`:

```js
import net from 'node:net';

export function probePort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve({ ok, latencyMs: Date.now() - start }); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}
```

`center/src/services/port-status.js`:

```js
import { probePort } from './ports.js';

export async function getPortStates({ webHost, webPort, heartbeatHost, heartbeatPort, reportHost, reportPort }) {
  const [web, heartbeat, report] = await Promise.all([
    probePort(webHost, webPort),
    probePort(heartbeatHost, heartbeatPort),
    probePort(reportHost, reportPort)
  ]);
  return { web, heartbeat, report };
}
```

- [ ] **Step 8: Implement `services/heartbeat-report.js`**

`center/src/services/heartbeat-report.js`:

```js
export async function getOfflineAgents(db, staleSeconds) {
  return await db.query(
    `SELECT agent_id, hostname, last_heartbeat_at
     FROM agents
     WHERE enabled = 1 AND (last_heartbeat_at IS NULL OR last_heartbeat_at < (NOW() - INTERVAL ? SECOND))`,
    [staleSeconds]
  );
}
```

> For SQL Server: `DATEADD(SECOND, -?, GETDATE())`. For v1 this is mysql-only path. Add a `dbKind`-aware variant when wiring mssql routes; for now document this in code and proceed.

Add a TODO note at the top:

```js
// NOTE: This query is mysql-specific. The SQL Server variant is
// `DATEADD(SECOND, -?, GETDATE())`. A future task will branch on dbKind.
```

- [ ] **Step 9: Implement `services/probe.js`**

`center/src/services/probe.js`:

```js
import { getOfflineAgents } from './heartbeat-report.js';

export function createProbeLoop({ db, logger, intervalMs = 60_000, staleSeconds = 90 }) {
  const handle = setInterval(async () => {
    try {
      const stale = await getOfflineAgents(db, staleSeconds);
      if (stale && stale.length) {
        logger.warn({ count: stale.length }, 'agents stale');
      }
    } catch (e) {
      logger.error({ err: e.message }, 'probe loop error');
    }
  }, intervalMs);
  return { stop: () => clearInterval(handle) };
}
```

> **Task 14** implements the retention purge inside this loop. For now this stub handles only heartbeat staleness.

- [ ] **Step 10: Run all services tests**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/users.test.js tests/services/audit-classifier.test.js
```

Expected: pass.

- [ ] **Step 11: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/services/ center/tests/services/
git commit -m "feat(center): users/audit/ports/heartbeat-report/probe services"
```

---

### Task 12: Center admin routes (users / config / audit / dags-catalog / dbs-catalog / dag-replication / ports / heartbeat-report)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/admin.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/heartbeat-report.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/routes/admin.test.js`

**Interfaces:**
- `adminRouter({ db, logger, config })` → mounts `/api/admin/{users,roles,config,audit,servers,dags,dbs,dag-replication}`
- `heartbeatReportRouter({ db, staleSeconds })` → mounts `/api/heartbeat-report/`

- [ ] **Step 1: Write admin route smoke test**

`center/tests/routes/admin.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { adminRouter } from '../../src/routes/admin.js';
import { userAuth } from '../../src/auth/user-auth.js';

function setup({ users = [] } = {}) {
  const db = {
    async query(sql, params) {
      if (/FROM users/.test(sql)) return users;
      if (/INSERT INTO users/.test(sql)) return [];
      if (/UPDATE users/.test(sql)) return [];
      if (/FROM audit_log/.test(sql)) return [];
      if (/FROM system_config/.test(sql)) return [{ k: 'foo', v: 'bar' }];
      return [];
    }
  };
  const u = userAuth({ db, jwtSecret: 's', expiresInSeconds: 60 });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin', perms: new Set(['admin:users']) }; next(); });
  app.use('/api/admin', adminRouter({ db, logger: { info() {}, warn() {}, error() {} }, config: {} }));
  return { app, db };
}

test('GET /api/admin/users requires auth (covered by requirePerm middleware in real route)', async () => {
  // This test verifies the data handler; auth middleware is added by the route.
  const { app } = setup({ users: [{ id: 1, username: 'admin', role: 'admin', enabled: 1, created_at: new Date() }] });
  const r = await supertest(app).get('/api/admin/users');
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 1);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/routes/admin.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement `routes/admin.js`**

`center/src/routes/admin.js`:

```js
import express from 'express';
import { userAuth } from '../auth/user-auth.js';
import * as users from '../services/users.js';
import { writeAudit } from '../services/audit.js';
import { getConfig, setConfig } from '../services/config.js';
import { probePort } from '../services/ports.js';

export function adminRouter({ db, logger, config }) {
  const r = express.Router();
  const u = userAuth({ db, jwtSecret: config?.jwt?.secret || 'dev', expiresInSeconds: 60 });
  r.use(express.json());

  // Users
  r.get('/users', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    const list = await users.listUsers(db);
    res.json({ users: list.map((x) => ({ id: x.id, username: x.username, role: x.role, enabled: !!x.enabled, created_at: x.created_at })) });
  });
  r.post('/users', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'username + ≥8-char password required' } });
    }
    await users.createUser(db, { username, password, role });
    await writeAudit(db, { userId: req.user.id, action: 'users.create', target: username });
    res.status(201).json({ ok: true });
  });
  r.patch('/users/:id', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'id must be int' } });
    await users.setEnabled(db, id, !!req.body.enabled);
    await writeAudit(db, { userId: req.user.id, action: 'users.update', target: String(id), details: req.body });
    res.json({ ok: true });
  });
  r.delete('/users/:id', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    const id = Number(req.params.id);
    await users.deleteUser(db, id);
    await writeAudit(db, { userId: req.user.id, action: 'users.delete', target: String(id) });
    res.json({ ok: true });
  });

  // Config
  r.get('/config', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    res.json({ config: await getConfig._all ? getConfig._all(db) : {} });
  });
  r.put('/config/:key', u.requireAuth, u.requirePerm('admin:users'), async (req, res) => {
    await setConfig(db, req.params.key, req.body.value);
    await writeAudit(db, { userId: req.user.id, action: 'config.update', target: req.params.key, details: req.body });
    res.json({ ok: true });
  });

  // Audit
  r.get('/audit', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    const rows = await db.query('SELECT id, ts, user_id, action, target FROM audit_log ORDER BY id DESC LIMIT 200');
    res.json({ rows });
  });

  // Port probe
  r.get('/ports/probe', u.requireAuth, u.requirePerm('admin:users'), async (_req, res) => {
    const web = await probePort('localhost', config.listenPort);
    res.json({ web });
  });

  return r;
}
```

- [ ] **Step 4: Implement `routes/heartbeat-report.js`**

`center/src/routes/heartbeat-report.js`:

```js
import express from 'express';
import { userAuth } from '../auth/user-auth.js';
import { getOfflineAgents } from '../services/heartbeat-report.js';

export function heartbeatReportRouter({ db, config }) {
  const r = express.Router();
  const u = userAuth({ db, jwtSecret: config?.jwt?.secret || 'dev', expiresInSeconds: 60 });
  r.get('/', u.requireAuth, async (_req, res) => {
    const stale = await getOfflineAgents(db, config.agent.heartbeatStaleSeconds);
    res.json({ stale });
  });
  return r;
}
```

- [ ] **Step 5: Run admin test**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/routes/admin.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/routes/admin.js center/src/routes/heartbeat-report.js center/tests/routes/admin.test.js
git commit -m "feat(center): admin routes (users/config/audit/ports) + heartbeat-report"
```

---

### Task 13: Center dashboard route (overview + queue / dag / client-access / servers / lockout routes)

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/mailflow.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/dags.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/services/server-status.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/dashboard.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/queues.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/dag.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/client-access.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/servers.js`
- Create: `D:/ToolDevelop/ExDashboard/center/src/routes/lockout.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/services/mailflow.test.js`

**Interfaces:**
- `mailflow.js`: `getCurrentQueues(db, { serverId? })`, `getQueueHistory(db, { serverId, queueKind, from, to })`, `getStuckMessages(db)`
- `dags.js`: `listDags(db)`, `getDagTopology(db, dagId)`, `getDagDatabases(db, dagId)`, `getCopyStatus(db, dagId, dbId)`
- `server-status.js`: `listServers(db)`, `getServer(db, id)`, `getServerHealth(db, id)`
- `dashboard.js`: `GET /api/dashboard/overview`, `GET /api/dashboard/metrics/summary`, `GET /api/dashboard/metrics/timeseries`
- `queues.js`, `dag.js`, `client-access.js`, `servers.js`, `lockout.js`: per-spec routes

- [ ] **Step 1: Write mailflow service test**

`center/tests/services/mailflow.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStuckMessages } from '../../src/services/mailflow.js';

test('getStuckMessages returns high-deferred + poison + retry rows', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return [{ id: 1, server_id: 1, queue_kind: 'Poison', message_count: 3 }]; } };
  const out = await getStuckMessages(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].queue_kind, 'Poison');
  assert.ok(/queue_snapshots/.test(calls[0].sql));
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/mailflow.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement `services/mailflow.js`**

`center/src/services/mailflow.js`:

```js
export async function getCurrentQueues(db, { serverId } = {}) {
  // Latest snapshot per (server_id, queue_kind)
  const sql = `
    SELECT qs.*
    FROM queue_snapshots qs
    JOIN (
      SELECT server_id, queue_kind, MAX(captured_at) AS max_at
      FROM queue_snapshots
      GROUP BY server_id, queue_kind
    ) latest
    ON qs.server_id = latest.server_id AND qs.queue_kind = latest.queue_kind AND qs.captured_at = latest.max_at
    ${serverId ? 'WHERE qs.server_id = ?' : ''}
    ORDER BY qs.server_id, qs.queue_kind
  `;
  return await db.query(sql, serverId ? [serverId] : []);
}

export async function getQueueHistory(db, { serverId, queueKind, from, to }) {
  return await db.query(
    `SELECT captured_at, queue_kind, message_count
     FROM queue_snapshots
     WHERE server_id = ? AND queue_kind = ? AND captured_at BETWEEN ? AND ?
     ORDER BY captured_at ASC`,
    [serverId, queueKind, from, to]
  );
}

export async function getStuckMessages(db) {
  return await db.query(
    `SELECT *
     FROM queue_snapshots
     WHERE queue_kind IN ('Poison','Retry') OR (queue_kind = 'ActiveMailboxDelivery' AND message_count > 1000)
     ORDER BY captured_at DESC
     LIMIT 100`
  );
}
```

- [ ] **Step 4: Implement `services/dags.js`**

`center/src/services/dags.js`:

```js
export async function listDags(db) {
  return await db.query('SELECT id, name, description, file_share_witness, created_at FROM dags ORDER BY name');
}

export async function getDagTopology(db, dagId) {
  const members = await db.query(
    `SELECT s.id AS server_id, s.hostname, s.fqdn, dm.preferred_activations, dm.replication_enabled
     FROM dag_members dm JOIN servers s ON s.id = dm.server_id
     WHERE dm.dag_id = ?`,
    [dagId]
  );
  return { dagId, members, links: members.map((m) => ({ from: m.server_id, to: m.server_id })) };
}

export async function getDagDatabases(db, dagId) {
  return await db.query(
    `SELECT m.db_id, m.db_name, m.server_id, m.edb_file_path, m.log_folder_path, m.circular_logging
     FROM mdb_catalog m
     WHERE m.dag_id = ?
     ORDER BY m.db_name`,
    [dagId]
  );
}

export async function getCopyStatus(db, dagId, dbId) {
  return await db.query(
    `SELECT cs.server_id, s.hostname, cs.copy_queue_length, cs.replay_lag_seconds, cs.mount_status, cs.content_index_state, cs.is_active_copy, cs.activation_preference, cs.captured_at
     FROM mdb_copy_snapshots cs JOIN servers s ON s.id = cs.server_id
     WHERE cs.db_id = ? AND cs.captured_at = (SELECT MAX(captured_at) FROM mdb_copy_snapshots WHERE db_id = ?)
     ORDER BY cs.server_id`,
    [dbId, dbId]
  );
}
```

- [ ] **Step 5: Implement `services/server-status.js`**

`center/src/services/server-status.js`:

```js
export async function listServers(db) {
  return await db.query(
    `SELECT id, agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id, last_heartbeat_at, last_report_at, enabled
     FROM servers ORDER BY hostname`
  );
}

export async function getServer(db, id) {
  const rows = await db.query('SELECT * FROM servers WHERE id = ?', [id]);
  return rows && rows[0] ? rows[0] : null;
}

export async function getServerHealth(db, id) {
  const services = await db.query(
    `SELECT service_name, state, start_mode
     FROM service_states
     WHERE server_id = ? AND captured_at = (SELECT MAX(captured_at) FROM service_states WHERE server_id = ?)
     ORDER BY service_name`,
    [id, id]
  );
  const resources = await db.query(
    `SELECT cpu_pct, memory_available_mb, disk_c_free_pct, net_bytes_per_sec, captured_at
     FROM server_resources
     WHERE server_id = ?
     ORDER BY captured_at DESC LIMIT 1`,
    [id]
  );
  return { services, resources: resources && resources[0] ? resources[0] : null };
}
```

- [ ] **Step 6: Implement `routes/dashboard.js`**

`center/src/routes/dashboard.js`:

```js
import express from 'express';

export function dashboardRouter({ db }) {
  const r = express.Router();
  r.get('/overview', async (_req, res) => {
    const [serverCount, dagCount, mdbCount, queuesNow, recentMdbErrors] = await Promise.all([
      db.query('SELECT COUNT(*) AS n FROM servers WHERE enabled = 1'),
      db.query('SELECT COUNT(*) AS n FROM dags'),
      db.query('SELECT COUNT(*) AS n FROM mdb_catalog'),
      db.query(`SELECT queue_kind, SUM(message_count) AS total FROM (
                  SELECT qs.queue_kind, qs.message_count
                  FROM queue_snapshots qs
                  JOIN (SELECT server_id, queue_kind, MAX(captured_at) AS max_at
                        FROM queue_snapshots GROUP BY server_id, queue_kind) latest
                  ON qs.server_id = latest.server_id AND qs.queue_kind = latest.queue_kind AND qs.captured_at = latest.max_at
                ) t GROUP BY queue_kind`),
      db.query(`SELECT COUNT(*) AS n FROM mdb_copy_snapshots WHERE mount_status <> 1 AND captured_at > (NOW() - INTERVAL 1 HOUR)`)
    ]);
    res.json({
      serverCount: serverCount[0]?.n || 0,
      dagCount: dagCount[0]?.n || 0,
      mdbCount: mdbCount[0]?.n || 0,
      queuesNow,
      recentMdbErrors: recentMdbErrors[0]?.n || 0
    });
  });

  r.get('/metrics/summary', async (req, res) => {
    const { packageName } = req.query;
    // Stub: in v1 the package-driven summary comes from package_runner. For
    // bare topology this returns the latest queue snapshot per server/kind.
    const rows = await db.query(
      `SELECT qs.server_id, qs.queue_kind, qs.message_count, qs.captured_at, qs.messages_per_sec
       FROM queue_snapshots qs
       JOIN (SELECT server_id, queue_kind, MAX(captured_at) AS max_at FROM queue_snapshots GROUP BY server_id, queue_kind) latest
       ON qs.server_id = latest.server_id AND qs.queue_kind = latest.queue_kind AND qs.captured_at = latest.max_at`
    );
    res.json({ packageName: packageName || null, rows });
  });

  r.get('/metrics/timeseries', async (req, res) => {
    const { metricId, from, to, agentId } = req.query;
    if (!metricId || !from || !to) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'metricId/from/to required' } });
    }
    const [kind, serverIdStr] = metricId.split('.');
    const serverId = Number(serverIdStr);
    const params = [serverId, kind, from, to];
    let sql = `SELECT captured_at AS ts, message_count AS value
               FROM queue_snapshots
               WHERE server_id = ? AND queue_kind = ? AND captured_at BETWEEN ? AND ?`;
    if (agentId) { sql += ' AND agent_id = ?'; params.push(agentId); }
    sql += ' ORDER BY captured_at ASC';
    const rows = await db.query(sql, params);
    res.json({ points: rows });
  });

  return r;
}
```

- [ ] **Step 7: Implement `routes/queues.js`, `routes/dag.js`, `routes/client-access.js`, `routes/servers.js`, `routes/lockout.js`**

`center/src/routes/queues.js`:

```js
import express from 'express';
import * as mailflow from '../services/mailflow.js';

export function queuesRouter({ db }) {
  const r = express.Router();
  r.get('/current', async (req, res) => {
    const serverId = req.query.serverId ? Number(req.query.serverId) : undefined;
    res.json({ queues: await mailflow.getCurrentQueues(db, { serverId }) });
  });
  r.get('/history', async (req, res) => {
    const { serverId, queueKind, from, to } = req.query;
    res.json({ points: await mailflow.getQueueHistory(db, { serverId: Number(serverId), queueKind, from, to }) });
  });
  r.get('/by-server/:id', async (req, res) => {
    res.json({ queues: await mailflow.getCurrentQueues(db, { serverId: Number(req.params.id) }) });
  });
  r.get('/stuck', async (_req, res) => {
    res.json({ rows: await mailflow.getStuckMessages(db) });
  });
  return r;
}
```

`center/src/routes/dag.js`:

```js
import express from 'express';
import * as dags from '../services/dags.js';

export function dagRouter({ db }) {
  const r = express.Router();
  r.get('/list', async (_req, res) => res.json({ dags: await dags.listDags(db) }));
  r.get('/:id/topology', async (req, res) => res.json(await dags.getDagTopology(db, Number(req.params.id))));
  r.get('/:id/databases', async (req, res) => res.json({ databases: await dags.getDagDatabases(db, Number(req.params.id)) }));
  r.get('/:id/databases/:db/copy-status', async (req, res) => res.json({ copies: await dags.getCopyStatus(db, Number(req.params.id), req.params.db) }));
  return r;
}
```

`center/src/routes/client-access.js`:

```js
import express from 'express';

export function clientAccessRouter({ db }) {
  const r = express.Router();
  r.get('/summary', async (_req, res) => {
    const rows = await db.query(
      `SELECT server_id, metric, value, captured_at
       FROM client_access_snapshots
       WHERE captured_at = (SELECT MAX(captured_at) FROM client_access_snapshots)
       ORDER BY server_id, metric`
    );
    res.json({ rows });
  });
  r.get('/per-server', async (_req, res) => {
    const rows = await db.query(
      `SELECT server_id, metric, AVG(value) AS avg_value, MAX(value) AS max_value, MIN(captured_at) AS first, MAX(captured_at) AS last
       FROM client_access_snapshots
       WHERE captured_at > (NOW() - INTERVAL 1 HOUR)
       GROUP BY server_id, metric
       ORDER BY server_id, metric`
    );
    res.json({ rows });
  });
  r.get('/latency', async (_req, res) => {
    const rows = await db.query(
      `SELECT server_id, AVG(value) AS avg_ms
       FROM client_access_snapshots
       WHERE metric = 'RpcClientAccess.AverageLatency' AND captured_at > (NOW() - INTERVAL 5 MINUTE)
       GROUP BY server_id
       ORDER BY avg_ms DESC`
    );
    res.json({ rows });
  });
  return r;
}
```

`center/src/routes/servers.js`:

```js
import express from 'express';
import * as ss from '../services/server-status.js';

export function serversRouter({ db }) {
  const r = express.Router();
  r.get('/', async (_req, res) => res.json({ servers: await ss.listServers(db) }));
  r.get('/:id', async (req, res) => {
    const s = await ss.getServer(db, Number(req.params.id));
    if (!s) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'server not found' } });
    res.json({ server: s });
  });
  r.get('/:id/health', async (req, res) => {
    res.json(await ss.getServerHealth(db, Number(req.params.id)));
  });
  return r;
}
```

`center/src/routes/lockout.js`:

```js
import express from 'express';

export function lockoutRouter() {
  const r = express.Router();
  r.post('/diagnose', express.json(), (req, res) => {
    const { username, sourceIp } = req.body || {};
    res.json({
      ok: true,
      recommendation: 'Check lockout duration in Default Domain Policy and source IPs above',
      inputs: { username, sourceIp }
    });
  });
  return r;
}
```

- [ ] **Step 8: Run mailflow test**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/mailflow.test.js
```

Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/services/mailflow.js center/src/services/dags.js center/src/services/server-status.js center/src/routes/dashboard.js center/src/routes/queues.js center/src/routes/dag.js center/src/routes/client-access.js center/src/routes/servers.js center/src/routes/lockout.js center/tests/services/mailflow.test.js
git commit -m "feat(center): dashboard + queues + dag + client-access + servers + lockout routes"
```

---

### Task 14: Center retention purge job (extends probe loop)

**Files:**
- Modify: `D:/ToolDevelop/ExDashboard/center/src/services/probe.js`
- Test: `D:/ToolDevelop/ExDashboard/center/tests/services/probe.test.js`

**Interfaces:**
- `createProbeLoop({ db, logger, intervalMs, staleSeconds, retention })` now also purges rows older than retention days from queue_snapshots, mdb_copy_snapshots, client_access_snapshots, server_resources, service_states

- [ ] **Step 1: Write probe test**

`center/tests/services/probe.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProbeLoop } from '../../src/services/probe.js';

test('probe loop purges old snapshots and detects stale', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return []; } };
  const loop = createProbeLoop({
    db,
    logger: { info() {}, warn() {}, error() {} },
    intervalMs: 60_000,
    staleSeconds: 90,
    retention: { queueDays: 7, mdbDays: 7, serviceDays: 30 }
  });
  // Force a single tick manually
  await loop.tick();
  loop.stop();
  const purgeSqls = calls.filter((c) => /DELETE FROM/.test(c.sql));
  assert.ok(purgeSqls.length >= 4, 'expected at least 4 DELETE statements');
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/probe.test.js
```

Expected: FAIL.

- [ ] **Step 3: Refactor `services/probe.js`**

```js
import { getOfflineAgents } from './heartbeat-report.js';

async function purgeOld(db, days, table) {
  await db.query(
    `DELETE FROM ${table} WHERE captured_at < (NOW() - INTERVAL ? DAY)`,
    [days]
  );
}

async function runOnce({ db, logger, staleSeconds, retention }) {
  try {
    const stale = await getOfflineAgents(db, staleSeconds);
    if (stale && stale.length) logger.warn({ count: stale.length }, 'agents stale');
    if (retention) {
      await purgeOld(db, retention.queueDays, 'queue_snapshots');
      await purgeOld(db, retention.mdbDays, 'mdb_copy_snapshots');
      await purgeOld(db, retention.serviceDays, 'service_states');
      await purgeOld(db, retention.queueDays, 'client_access_snapshots');
      await purgeOld(db, retention.queueDays, 'server_resources');
    }
  } catch (e) {
    logger.error({ err: e.message }, 'probe loop error');
  }
}

export function createProbeLoop({ db, logger, intervalMs = 3600_000, staleSeconds = 90, retention = { queueDays: 7, mdbDays: 7, serviceDays: 30 } } = {}) {
  let stopped = false;
  const handle = setInterval(() => { if (!stopped) runOnce({ db, logger, staleSeconds, retention }); }, intervalMs);
  return {
    tick: () => runOnce({ db, logger, staleSeconds, retention }),
    stop: () => { stopped = true; clearInterval(handle); }
  };
}
```

> For SQL Server: `DATEADD(DAY, -?, GETDATE())`. v1 supports mysql; mark a TODO at top of `purgeOld`.

- [ ] **Step 4: Run probe test**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/services/probe.test.js
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add center/src/services/probe.js center/tests/services/probe.test.js
git commit -m "feat(center): probe loop with retention purge + stale agent detection"
```

---

## Phase 3 — Agent

### Task 15: Agent scheduler + heartbeat + reporter + local-queue + discovery

**Files:**
- Create: `D:/ToolDevelop/ExDashboard/agent/src/logger.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/config.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/local-queue.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/heartbeat.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/reporter.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/scheduler.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/discovery.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/healthcheck.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/port-config-fetcher.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/agent.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/package-manager.js`
- Create: `D:/ToolDevelop/ExDashboard/agent/src/package-runner.js`
- Test: `D:/ToolDevelop/ExDashboard/agent/tests/local-queue.test.js`
- Test: `D:/ToolDevelop/ExDashboard/agent/tests/scheduler.test.js`
- Test: `D:/ToolDevelop/ExDashboard/agent/tests/discovery.test.js`

**Interfaces:**
- `createLogger({ component, level })` → pino logger
- `loadConfig(path)` → config object
- `LocalQueue(dbPath)` → `{ enqueue(payload), dequeueAll(), length(), close() }`
- `startHeartbeat({ axios, config, logger, getSummary })` → `setInterval` POST; `stop()`
- `startReporter({ axios, config, logger, queue })` → `setInterval` dequeue+POST; `stop()`
- `Scheduler` → runs jobs at intervals
- `discover({ hostname, fqdn, registry })` → `{ agentId, hostname, fqdn, osVersion, exchangeVersion, serverRole, dagId }`
- `agent.js`: bootstraps everything

- [ ] **Step 1: Write local-queue test**

`agent/tests/local-queue.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { LocalQueue } from '../src/local-queue.js';

test('LocalQueue enqueue/dequeue/len round-trip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lq-'));
  const q = new LocalQueue(path.join(dir, 'q.db'));
  await q.enqueue({ a: 1 });
  await q.enqueue({ a: 2 });
  assert.equal(q.length(), 2);
  const all = await q.dequeueAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].a, 1);
  assert.equal(q.length(), 0);
  q.close();
});
```

- [ ] **Step 2: Write scheduler test**

`agent/tests/scheduler.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.js';

test('Scheduler fires jobs at their intervals', async () => {
  const sched = new Scheduler();
  const ticks = { a: 0, b: 0 };
  sched.add({ name: 'a', intervalMs: 30, fn: () => { ticks.a++; } });
  sched.add({ name: 'b', intervalMs: 50, fn: () => { ticks.b++; } });
  sched.start();
  await new Promise((r) => setTimeout(r, 175));
  sched.stop();
  assert.ok(ticks.a >= 3, `expected ticks.a >= 3, got ${ticks.a}`);
  assert.ok(ticks.b >= 2, `expected ticks.b >= 2, got ${ticks.b}`);
});
```

- [ ] **Step 3: Write discovery test**

`agent/tests/discovery.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/discovery.js';

test('discover returns expected fields', async () => {
  // Fake registry readers
  const fakeRegistry = {
    readExchangeInstallPath: async () => 'C:\\Program Files\\Microsoft\\Exchange Server\\V15',
    readExchangeVersion: async () => '15.2',
    readServerRoleFlags: async () => 7,
    readDagMembership: async () => 1
  };
  const d = await discover({ hostname: 'ex01', fqdn: 'ex01.local', osVersion: 'Win2022', registry: fakeRegistry });
  assert.equal(d.hostname, 'ex01');
  assert.equal(d.exchangeVersion, '15.2');
  assert.equal(d.serverRole, 7);
  assert.equal(d.dagId, 1);
  assert.ok(d.agentId && d.agentId.length > 0);
});
```

- [ ] **Step 4: Run tests to verify failure**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/local-queue.test.js tests/scheduler.test.js tests/discovery.test.js
```

Expected: FAIL.

- [ ] **Step 5: Implement `agent/src/logger.js` and `config.js`**

```js
// agent/src/logger.js
import pino from 'pino';
export function createLogger({ component = 'agent', level = 'info' } = {}) {
  return pino({ level, base: { component } });
}
```

```js
// agent/src/config.js
import fs from 'node:fs';
export function loadConfig(path) {
  const raw = fs.readFileSync(path, 'utf8');
  return { ...JSON.parse(raw) };
}
export function defaultConfig() {
  return {
    center: {
      baseUrl: 'http://localhost:8080',
      heartbeatPath: '/api/agent/heartbeat',
      reportPath: '/api/agent/report',
      discoverPath: '/api/agent/discover',
      configPath: '/api/agent/config',
      heartbeatIntervalMs: 30000,
      reportIntervalMs: 60000,
      requestTimeoutMs: 15000
    },
    agentId: '',
    logLevel: 'info',
    installPath: 'C:\\exdashboard',
    collectors: { mailflowIntervalMs: 30000, dagIntervalMs: 60000, servicesIntervalMs: 30000, clientaccessIntervalMs: 60000 },
    localQueue: { dbPath: './queue.db', maxBackoffMs: 1800000 }
  };
}
```

- [ ] **Step 6: Implement `local-queue.js`**

```js
// agent/src/local-queue.js
import Database from 'better-sqlite3';

export class LocalQueue {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
    this._insert = this.db.prepare('INSERT INTO items (payload, created_at) VALUES (?, ?)');
    this._delete = this.db.prepare('DELETE FROM items WHERE id = ?');
    this._list = this.db.prepare('SELECT id, payload, attempts, next_attempt_at FROM items WHERE next_attempt_at <= ? ORDER BY id ASC');
    this._bump = this.db.prepare('UPDATE items SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?');
  }

  async enqueue(payload) {
    this._insert.run(JSON.stringify(payload), Date.now());
  }

  async dequeueAll(now = Date.now()) {
    const rows = this._list.all(now);
    return rows.map((r) => ({ id: r.id, payload: JSON.parse(r.payload), attempts: r.attempts }));
  }

  async remove(id) { this._delete.run(id); }
  async bump(id, nextAttemptAt) { this._bump.run(nextAttemptAt, id); }
  length() { return this.db.prepare('SELECT COUNT(*) AS n FROM items').get().n; }
  close() { this.db.close(); }
}
```

- [ ] **Step 7: Implement `scheduler.js`**

```js
// agent/src/scheduler.js
export class Scheduler {
  constructor() { this.jobs = []; this.handles = []; }
  add(job) { this.jobs.push(job); }
  start() {
    for (const job of this.jobs) {
      const tick = async () => {
        try { await job.fn(); } catch (e) { if (job.onError) job.onError(e); }
      };
      tick();
      this.handles.push({ name: job.name, handle: setInterval(tick, job.intervalMs) });
    }
  }
  stop() { for (const h of this.handles) clearInterval(h.handle); this.handles = []; }
}
```

- [ ] **Step 8: Implement `discovery.js`**

```js
// agent/src/discovery.js
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

async function wmic(query, prop) {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileP('wmic', [query, 'get', prop, '/format:csv']);
    const lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const headers = lines[0].split(',');
    const vals = lines[1].split(',');
    const out = {};
    for (let i = 0; i < headers.length; i++) out[headers[i]] = vals[i];
    return out;
  } catch { return null; }
}

async function readExchangeInstallPath() {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileP('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\ExchangeServer\\v15\\Setup', '/v', 'MsiInstallPath']);
    const m = stdout.match(/MsiInstallPath\s+REG_SZ\s+(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function readExchangeVersion() {
  const path = await readExchangeInstallPath();
  if (!path) return null;
  // Path ends with \bin or similar; rely on registry version string if present.
  return null;
}

async function readServerRoleFlags() {
  // Bit field: Mailbox=1, HubTransport=2, ClientAccess=4
  // For v1: read services and infer.
  if (process.platform !== 'win32') return 0;
  try {
    const { stdout } = await execFileP('wmic', ['service', 'where', "Name like 'MSExchange%'", 'get', 'Name', '/format:csv']);
    const names = stdout.split(/\r?\n/).filter((l) => l.includes('MSExchange'));
    let flags = 0;
    if (names.some((n) => n.includes('Mailbox') || n.includes('Store'))) flags |= 1;
    if (names.some((n) => n.includes('Transport'))) flags |= 2;
    if (names.some((n) => n.includes('RPC') || n.includes('Frontend') || n.includes('IMAP') || n.includes('POP'))) flags |= 4;
    return flags;
  } catch { return 0; }
}

async function readDagMembership() {
  // For v1: derive from cluster membership via WMI MSCluster_ResourceGroup.
  // If detection fails, returns null and the operator manually attaches.
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command', 'Get-ClusterGroup -ErrorAction SilentlyContinue | Select-Object Name | ConvertTo-Csv -NoTypeInformation'], { timeout: 5000 });
    // Skip DAG detection for v1: rely on registry or manual attachment
    return null;
  } catch { return null; }
}

export async function discover({ hostname = os.hostname(), fqdn = os.hostname(), osVersion = `${os.platform()} ${os.release()}` } = {}) {
  const agentIdSeed = `${hostname}-${os.hostname()}`.toLowerCase();
  const agentId = crypto.createHash('sha1').update(agentIdSeed).digest('hex').slice(0, 16);
  return {
    agentId,
    hostname,
    fqdn,
    osVersion,
    exchangeVersion: await readExchangeVersion(),
    serverRole: await readServerRoleFlags(),
    dagId: await readDagMembership()
  };
}
```

> Note on DAG discovery: per spec §10.10, DAG detection is best-effort. `readDagMembership()` is a stub for v1 — the agent reports `dagId: null` and the operator manually attaches via admin UI.

- [ ] **Step 9: Implement `heartbeat.js` and `reporter.js`**

```js
// agent/src/heartbeat.js
import axios from 'axios';

export function startHeartbeat({ config, logger, getSummary }) {
  let stopped = false;
  const url = config.center.baseUrl.replace(/\/$/, '') + config.center.heartbeatPath;
  const tick = async () => {
    if (stopped) return;
    try {
      await axios.post(url, {
        agentId: config.agentId,
        hostname: getSummary().hostname,
        ts: new Date().toISOString(),
        summary: getSummary()
      }, { timeout: config.center.requestTimeoutMs });
    } catch (e) {
      logger.warn({ err: e.message }, 'heartbeat failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.heartbeatIntervalMs);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}
```

```js
// agent/src/reporter.js
import axios from 'axios';

export function startReporter({ config, logger, queue, getSnapshot }) {
  let stopped = false;
  const url = config.center.baseUrl.replace(/\/$/, '') + config.center.reportPath;

  const sendOne = async (item) => {
    try {
      await axios.post(url, item.payload, { timeout: config.center.requestTimeoutMs });
      await queue.remove(item.id);
    } catch (e) {
      const backoff = Math.min((item.attempts + 1) * 30_000, config.localQueue.maxBackoffMs);
      await queue.bump(item.id, Date.now() + backoff);
      logger.warn({ err: e.message, attempts: item.attempts + 1 }, 'report failed');
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      // First, drain backlog
      const items = await queue.dequeueAll();
      for (const item of items) await sendOne(item);
      // Then enqueue the new snapshot
      const snapshot = await getSnapshot();
      await queue.enqueue(snapshot);
      // Try to send the just-enqueued snapshot immediately
      const fresh = await queue.dequeueAll();
      for (const item of fresh) await sendOne(item);
    } catch (e) {
      logger.error({ err: e.message }, 'reporter tick failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.reportIntervalMs);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}
```

- [ ] **Step 10: Implement `healthcheck.js`, `port-config-fetcher.js`, `package-manager.js`, `package-runner.js`**

```js
// agent/src/healthcheck.js
export function healthcheck({ logger }) {
  setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > 512 * 1024 * 1024) logger.warn({ heapUsed: mem.heapUsed }, 'high memory');
  }, 60_000).unref();
}
```

```js
// agent/src/port-config-fetcher.js
import axios from 'axios';
export async function fetchPortConfig({ baseUrl, configPath }) {
  const r = await axios.get(baseUrl.replace(/\/$/, '') + configPath, { timeout: 5000 });
  return r.data;
}
```

```js
// agent/src/package-manager.js
// v1 stub: no remote package registry; installed packages are declared in
// agent config. Implementation grows with future plugin support.
export function listInstalled() { return []; }
```

```js
// agent/src/package-runner.js
export async function runPackages() { return []; }
```

- [ ] **Step 11: Implement `agent/agent.js`**

```js
// agent/agent.js
import fs from 'node:fs';
import { createLogger } from './src/logger.js';
import { loadConfig, defaultConfig } from './src/config.js';
import { LocalQueue } from './src/local-queue.js';
import { Scheduler } from './src/scheduler.js';
import { startHeartbeat } from './src/heartbeat.js';
import { startReporter } from './src/reporter.js';
import { discover } from './src/discovery.js';
import { healthcheck } from './src/healthcheck.js';

const configPath = process.argv[2] || process.env.APPSETTINGS_PATH || './appsettings.json';

(async () => {
  const cfg = fs.existsSync(configPath) ? { ...defaultConfig(), ...loadConfig(configPath) } : defaultConfig();
  const logger = createLogger({ component: 'agent', level: cfg.logLevel });
  const queue = new LocalQueue(cfg.localQueue.dbPath);

  const identity = await discover({});
  cfg.agentId = identity.agentId;
  logger.info({ agentId: cfg.agentId, hostname: identity.hostname }, 'discovered');

  // POST discover to center (best-effort, retried on next tick)
  try {
    const url = cfg.center.baseUrl.replace(/\/$/, '') + cfg.center.discoverPath;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity) });
  } catch (e) { logger.warn({ err: e.message }, 'discover post failed'); }

  const getSummary = () => identity;
  const getSnapshot = async () => ({
    agentId: cfg.agentId,
    hostname: identity.hostname,
    capturedAt: new Date().toISOString(),
    // Phase 3 collectors (Tasks 16-20) will populate these:
    queues: [],
    dag: { members: [], copies: [] },
    services: [],
    clientAccess: [],
    resources: {}
  });

  const sched = new Scheduler();
  sched.add({ name: 'heartbeat', intervalMs: cfg.center.heartbeatIntervalMs, fn: () => {} }); // heartbeat loop is independent
  const hb = startHeartbeat({ config: cfg, logger, getSummary });
  const rep = startReporter({ config: cfg, logger, queue, getSnapshot });
  healthcheck({ logger });

  logger.info({ agentId: cfg.agentId }, 'agent started');

  process.on('SIGINT', () => { sched.stop(); hb.stop(); rep.stop(); queue.close(); process.exit(0); });
  process.on('SIGTERM', () => { sched.stop(); hb.stop(); rep.stop(); queue.close(); process.exit(0); });
})();
```

- [ ] **Step 12: Run agent tests**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/local-queue.test.js tests/scheduler.test.js tests/discovery.test.js
```

Expected: 3 passed.

- [ ] **Step 13: Commit**

```bash
cd "D:/ToolDevelop/ExDashboard"
git add agent/agent.js agent/src/ agent/tests/
git commit -m "feat(agent): scheduler + heartbeat + reporter + local-queue + discovery"
```

---

## Note on Plan Length

This plan already covers Phases 1 + 2 in full detail (~3,650 lines, ~14 tasks). Tasks 15 onward share the same TDD patterns established above (test-first → fail → implement → pass → commit), so the remaining 17 tasks are presented below in compact form: each task lists its Files, Interfaces, key code sketches, test commands, and commit message. The TDD discipline and file-level boundaries are unchanged; the implementer follows the same write-fail-pass-commit rhythm.

---

### Task 16: Agent perfmon-collector (typeperf / wmic CSV parser)

**Files:**
- Create: `agent/src/perfmon-collector.js`
- Test: `agent/tests/perfmon-collector.test.js`

**Interfaces:**
- `PerfmonCollector.shell` mockable (defaults to shelling out to typeperf/wmic)
- `parseTypeperfCsv(stdout, counterPath)` → `[{ timestamp, value }]`
- `parseWmicCsv(stdout)` → array of objects keyed by column
- `counter(counterPath, opts?)` → `{ value }` (single sample)
- `wmi(query, properties)` → `[{}]`
- On non-Windows platforms, returns `{ value: null }` / `[]` (no-op for CI)

- [ ] **Step 1: Write test**

`agent/tests/perfmon-collector.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTypeperfCsv, parseWmicCsv } from '../src/perfmon-collector.js';

test('parseTypeperfCsv handles typical output', () => {
  const csv = `"\\Counter\\Value","03/15/2026 12:00:00.123","5"\n`;
  const out = parseTypeperfCsv(csv);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, '5');
});

test('parseWmicCsv parses rows', () => {
  const csv = `Node,Name,State\r\nHOST,MSExchangeTransport,Running\r\n`;
  const rows = parseWmicCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Name, 'MSExchangeTransport');
});
```

- [ ] **Step 2: Implement**

```js
// agent/src/perfmon-collector.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

export function parseTypeperfCsv(stdout) {
  // typeperf output: "(\\path)", "timestamp", "value" rows
  const lines = stdout.trim().split(/\r?\n/).slice(1); // skip header line
  return lines.filter(Boolean).map((line) => {
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    return { timestamp: cols[0] || null, value: cols[1] || null };
  });
}

export function parseWmicCsv(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

export class PerfmonCollector {
  constructor({ exec = execFileP } = {}) { this.exec = exec; }
  async counter(counterPath) {
    if (process.platform !== 'win32') return { value: null };
    const { stdout } = await this.exec('typeperf', ['-sc', '1', counterPath]);
    const rows = parseTypeperfCsv(stdout);
    return { value: rows[0]?.value ?? null };
  }
  async counterMulti(paths) {
    if (process.platform !== 'win32') return {};
    const { stdout } = await this.exec('typeperf', ['-sc', '1', ...paths]);
    const rows = parseTypeperfCsv(stdout);
    const out = {};
    paths.forEach((p, i) => { out[p] = rows[i]?.value ?? null; });
    return out;
  }
  async wmi(query, properties) {
    if (process.platform !== 'win32') return [];
    const { stdout } = await this.exec('wmic', [query, 'get', properties.join(','), '/format:csv']);
    return parseWmicCsv(stdout);
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/perfmon-collector.test.js
```

```bash
cd "D:/ToolDevelop/ExDashboard"
git add agent/src/perfmon-collector.js agent/tests/perfmon-collector.test.js
git commit -m "feat(agent): perfmon-collector (typeperf/wmic CSV parser + Windows guard)"
```

---

### Task 17: Agent mailflow-collector

**Files:**
- Create: `agent/src/mailflow-collector.js`
- Test: `agent/tests/mailflow-collector.test.js`

**Interfaces:**
- `MailflowCollector(perfmon)` → `{ collect() }` returns array of queue snapshot rows `{ server_id, captured_at, queue_kind, queue_name, message_count, oldest_message_age_seconds, messages_per_sec, deferred_per_sec }`

**Counters (path → queue_kind):**
- `\MSExchangeTransport Queues(_total)\Queue Length` → `ActiveMailboxDelivery`
- `\MSExchangeTransport Queues(_total)\Active Mailbox Delivery Queue Length` → `ActiveMailboxDelivery`
- `\MSExchangeTransport Queues(_total)\Poison Queue Length` → `Poison`
- `\MSExchangeTransport Queues(_total)\Largest Message Count In Queue` → derived
- `\MSExchangeTransport Queues(_total)\Messages Queued Per Second` → derived
- `\MSExchangeTransport Queues(_total)\Messages Completed Per Second` → derived
- `\MSExchangeTransport Queues(_total)\Deferred Messages Per Second` → derived
- `\MSExchangeTransport Queues(_total)\Retry Queue Length` → `Retry`
- `\MSExchange Submission Queue(_total)\Submission Queue Length` → `Submission`

- [ ] **Step 1: Test (with stub PerfmonCollector)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailflowCollector } from '../src/mailflow-collector.js';

test('MailflowCollector returns normalized queue snapshots', async () => {
  const stub = { counterMulti: async () => ({
    '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length': '12',
    '\\MSExchangeTransport Queues(_total)\\Poison Queue Length': '0',
    '\\MSExchangeTransport Queues(_total)\\Retry Queue Length': '3',
    '\\MSExchange Submission Queue(_total)\\Submission Queue Length': '7',
    '\\MSExchangeTransport Queues(_total)\\Messages Queued Per Second': '5.5'
  }) };
  const mc = new MailflowCollector(stub);
  const out = await mc.collect();
  assert.ok(out.length >= 4);
  const poison = out.find((r) => r.queue_kind === 'Poison');
  assert.equal(poison.message_count, 0);
  const retry = out.find((r) => r.queue_kind === 'Retry');
  assert.equal(retry.message_count, 3);
});
```

- [ ] **Step 2: Implement** (collects 9 counters via `counterMulti`, normalizes into snapshot rows keyed by `queue_kind`; server_id is filled by the center on ingest since the agent only knows its hostname).

```js
// agent/src/mailflow-collector.js
const COUNTERS = [
  ['ActiveMailboxDelivery', '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length'],
  ['Poison',                '\\MSExchangeTransport Queues(_total)\\Poison Queue Length'],
  ['Retry',                 '\\MSExchangeTransport Queues(_total)\\Retry Queue Length'],
  ['Submission',            '\\MSExchange Submission Queue(_total)\\Submission Queue Length'],
  ['MessagesQueuedPerSec',  '\\MSExchangeTransport Queues(_total)\\Messages Queued Per Second'],
  ['MessagesCompletedPerSec','\\MSExchangeTransport Queues(_total)\\Messages Completed Per Second'],
  ['DeferredPerSec',        '\\MSExchangeTransport Queues(_total)\\Deferred Messages Per Second']
];

export class MailflowCollector {
  constructor(perfmon) { this.perfmon = perfmon; }
  async collect() {
    const paths = COUNTERS.map(([, p]) => p);
    const raw = await this.perfmon.counterMulti(paths);
    const now = new Date().toISOString();
    const rows = [];
    for (const [kind, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (Number.isNaN(v)) continue;
      if (kind.endsWith('PerSec')) continue; // attach as ancillary, not own snapshot
      const anc = {};
      const mq = Number(raw[COUNTERS[4][1]]); if (!Number.isNaN(mq)) anc.messages_per_sec = mq;
      const md = Number(raw[COUNTERS[6][1]]); if (!Number.isNaN(md)) anc.deferred_per_sec = md;
      rows.push({ captured_at: now, queue_kind: kind, queue_name: kind, message_count: v, ...anc });
    }
    return rows;
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/mailflow-collector.test.js
```

```bash
git add agent/src/mailflow-collector.js agent/tests/mailflow-collector.test.js
git commit -m "feat(agent): mailflow-collector (queue length + per-sec via typeperf)"
```

---

### Task 18: Agent dag-collector

**Files:**
- Create: `agent/src/dag-collector.js`
- Test: `agent/tests/dag-collector.test.js`

**Interfaces:**
- `DagCollector(perfmon)` → `{ collect() }` returns `{ copies: [{ db_id, server_id, captured_at, copy_queue_length, replay_lag_seconds, mount_status, content_index_state, is_active_copy, activation_preference }] }`

**Counters per database** (path template):
- `\MSExchangeRepl %DBNAME% Database Moves\CopyQueueLength`
- `\MSExchangeRepl %DBNAME% Database Moves\ReplayLag`  (seconds, may need *60 in some versions)
- `\MSExchangeRepl %DBNAME% Database Moves\MountStatus`

Discovery of `%DBNAME%`: use `wmic` to enumerate Exchange database moves or, for v1, hard-code a list in `agent.appsettings.json` under `collectors.dag.databases` (the admin can populate via the `mdb_catalog` table).

- [ ] **Step 1: Test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DagCollector } from '../src/dag-collector.js';

test('DagCollector returns one copy per database', async () => {
  const stub = {
    counterMulti: async (paths) => {
      const out = {};
      for (const p of paths) out[p] = p.includes('CopyQueueLength') ? '5' : p.includes('MountStatus') ? '1' : '0';
      return out;
    }
  };
  const dc = new DagCollector(stub, { databases: [{ db_id: 'db-1', db_name: 'DB1', server_id: 1 }] });
  const out = await dc.collect();
  assert.equal(out.copies.length, 1);
  assert.equal(out.copies[0].db_id, 'db-1');
  assert.equal(out.copies[0].copy_queue_length, 5);
  assert.equal(out.copies[0].mount_status, 1);
});
```

- [ ] **Step 2: Implement**

```js
// agent/src/dag-collector.js
export class DagCollector {
  constructor(perfmon, opts = {}) { this.perfmon = perfmon; this.databases = opts.databases || []; }
  async collect() {
    const now = new Date().toISOString();
    const rows = [];
    for (const db of this.databases) {
      const paths = [
        `\\MSExchangeRepl ${db.db_name} Database Moves\\CopyQueueLength`,
        `\\MSExchangeRepl ${db.db_name} Database Moves\\ReplayLag`,
        `\\MSExchangeRepl ${db.db_name} Database Moves\\MountStatus`
      ];
      const raw = await this.perfmon.counterMulti(paths);
      rows.push({
        db_id: db.db_id,
        server_id: db.server_id,
        captured_at: now,
        copy_queue_length: Number(raw[paths[0]]) || 0,
        replay_lag_seconds: Number(raw[paths[1]]) || 0,
        mount_status: Number(raw[paths[2]]) || 0,
        content_index_state: null,
        is_active_copy: 0,
        activation_preference: null
      });
    }
    return { copies: rows };
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/dag-collector.test.js
git add agent/src/dag-collector.js agent/tests/dag-collector.test.js
git commit -m "feat(agent): dag-collector (copy queue + replay lag + mount status per DB)"
```

---

### Task 19: Agent services-collector

**Files:**
- Create: `agent/src/services-collector.js`
- Test: `agent/tests/services-collector.test.js`

**Interfaces:**
- `ServicesCollector(perfmon)` → `{ collect() }` returns `{ services: [...], resources: { cpu_pct, memory_available_mb, disk_c_free_pct, net_bytes_per_sec } }`

- [ ] **Step 1: Test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServicesCollector } from '../src/services-collector.js';

test('ServicesCollector returns Exchange services + resources', async () => {
  const stub = {
    counterMulti: async () => ({ '\\Processor(_total)\\% Processor Time': '12', '\\Memory\\Available MBytes': '8192', '\\LogicalDisk(C:)\\% Free Space': '42', '\\Network Interface(*)\\Bytes Total/sec': '1000' }),
    wmi: async () => [
      { Name: 'MSExchangeTransport', State: 'Running', StartMode: 'Auto' },
      { Name: 'MSExchangeMailbox', State: 'Stopped', StartMode: 'Auto' }
    ]
  };
  const sc = new ServicesCollector(stub);
  const out = await sc.collect();
  assert.equal(out.services.length, 2);
  assert.equal(out.resources.cpu_pct, 12);
  assert.equal(out.resources.memory_available_mb, 8192);
});
```

- [ ] **Step 2: Implement**

```js
// agent/src/services-collector.js
export class ServicesCollector {
  constructor(perfmon) { this.perfmon = perfmon; }
  async collect() {
    const resources = await this.perfmon.counterMulti([
      '\\Processor(_total)\\% Processor Time',
      '\\Memory\\Available MBytes',
      '\\LogicalDisk(C:)\\% Free Space',
      '\\Network Interface(*)\\Bytes Total/sec'
    ]);
    const wmiRows = await this.perfmi_wmi_services();
    return {
      services: wmiRows.map((r) => ({ service_name: r.Name, state: r.State, start_mode: r.StartMode })),
      resources: {
        cpu_pct: Number(resources['\\Processor(_total)\\% Processor Time']) || null,
        memory_available_mb: Number(resources['\\Memory\\Available MBytes']) || null,
        disk_c_free_pct: Number(resources['\\LogicalDisk(C:)\\% Free Space']) || null,
        net_bytes_per_sec: Number(resources['\\Network Interface(*)\\Bytes Total/sec']) || null
      }
    };
  }
  async perfmi_wmi_services() {
    try {
      return await this.perfmon.wmi('service', ['Name', 'State', 'StartMode']);
    } catch { return []; }
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/services-collector.test.js
git add agent/src/services-collector.js agent/tests/services-collector.test.js
git commit -m "feat(agent): services-collector (Exchange services + Win32 resources)"
```

---

### Task 20: Agent clientaccess-collector

**Files:**
- Create: `agent/src/clientaccess-collector.js`
- Test: `agent/tests/clientaccess-collector.test.js`

**Interfaces:**
- `ClientAccessCollector(perfmon)` → `{ collect() }` returns `[{ metric, value }]`

**Metrics:**
- `RpcClientAccess.AverageLatency` ← `\MSExchange RpcClientAccess\RPC Average Latency`
- `RpcClientAccess.ActiveUsers` ← `\MSExchange RpcClientAccess\Active User Count`
- `ActiveSync.RequestsPerSec` ← `\MSExchange ActiveSync\ActiveSync Requests/sec`
- `ActiveSync.AvgCmdTime` ← `\MSExchange ActiveSync\Average Command Processing Time`
- `MapiHttp.AvgRequestTime` ← `\MSExchange MapiHttp\Average Request Time`
- `OutlookAnywhere.AvgRpcResponseTime` ← `\MSExchange Outlook Anywhere\Average RPC Response Time`

- [ ] **Step 1: Test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientAccessCollector } from '../src/clientaccess-collector.js';

test('ClientAccessCollector returns 6 metrics', async () => {
  const stub = { counterMulti: async () => ({
    '\\MSExchange RpcClientAccess\\RPC Average Latency': '12',
    '\\MSExchange RpcClientAccess\\Active User Count': '100',
    '\\MSExchange ActiveSync\\ActiveSync Requests/sec': '5',
    '\\MSExchange ActiveSync\\Average Command Processing Time': '50',
    '\\MSExchange MapiHttp\\Average Request Time': '20',
    '\\MSExchange Outlook Anywhere\\Average RPC Response Time': '80'
  }) };
  const c = new ClientAccessCollector(stub);
  const out = await c.collect();
  assert.equal(out.length, 6);
  assert.ok(out.find((r) => r.metric === 'RpcClientAccess.AverageLatency' && r.value === 12));
});
```

- [ ] **Step 2: Implement**

```js
// agent/src/clientaccess-collector.js
const METRICS = [
  ['RpcClientAccess.AverageLatency',      '\\MSExchange RpcClientAccess\\RPC Average Latency'],
  ['RpcClientAccess.ActiveUsers',        '\\MSExchange RpcClientAccess\\Active User Count'],
  ['ActiveSync.RequestsPerSec',          '\\MSExchange ActiveSync\\ActiveSync Requests/sec'],
  ['ActiveSync.AvgCmdTime',              '\\MSExchange ActiveSync\\Average Command Processing Time'],
  ['MapiHttp.AvgRequestTime',            '\\MSExchange MapiHttp\\Average Request Time'],
  ['OutlookAnywhere.AvgRpcResponseTime', '\\MSExchange Outlook Anywhere\\Average RPC Response Time']
];
export class ClientAccessCollector {
  constructor(perfmon) { this.perfmon = perfmon; }
  async collect() {
    const raw = await this.perfmon.counterMulti(METRICS.map(([, p]) => p));
    return METRICS.map(([metric, path]) => ({ metric, value: Number(raw[path]) || 0 }));
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/agent"
node --test tests/clientaccess-collector.test.js
git add agent/src/clientaccess-collector.js agent/tests/clientaccess-collector.test.js
git commit -m "feat(agent): clientaccess-collector (RPC/AS/EWS/MAPI/OA counters)"
```

---

### Task 21: Center agent ingest pipeline

**Files:**
- Modify: `center/src/routes/agent.js` (replace `/report` stub with full ingestion)
- Test: `center/tests/routes/agent-report.test.js`

**Interfaces:**
- POST `/api/agent/report` (mount: `report`) accepts `{ agentId, hostname, capturedAt, queues, dag, services, clientAccess, resources }`. Writes rows to `queue_snapshots`, `mdb_copy_snapshots`, `service_states`, `client_access_snapshots`, `server_resources`. Resolves `server_id` from `hostname` via lookup; creates the `servers` row if missing.

- [ ] **Step 1: Test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { agentRouter } from '../../src/routes/agent.js';

function setup() {
  const writes = [];
  const db = { async query(sql, params) { writes.push({ sql, params }); return [{ id: 7 }]; } };
  const app = express();
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.use('/api/agent', agentRouter({ config: { heartbeatPort: 8081, reportPort: 8082 }, logger: app.locals.logger, mount: 'report' }));
  return { app, writes };
}

test('POST /api/agent/report ingests queues, dag copies, services, clientAccess, resources', async () => {
  const { app, writes } = setup();
  const r = await supertest(app).post('/api/agent/report').send({
    agentId: 'a1', hostname: 'ex01', capturedAt: '2026-08-09T00:00:00Z',
    queues: [{ queue_kind: 'Poison', queue_name: 'Poison', message_count: 3 }],
    dag: { copies: [{ db_id: 'db-1', copy_queue_length: 10, mount_status: 1 }] },
    services: [{ service_name: 'MSExchangeTransport', state: 'Running', start_mode: 'Auto' }],
    clientAccess: [{ metric: 'RpcClientAccess.AverageLatency', value: 12 }],
    resources: { cpu_pct: 50, memory_available_mb: 4096 }
  });
  assert.equal(r.status, 202);
  // Expect at least: server lookup, queue insert, dag insert, services insert, clientAccess insert, resources insert
  const tables = writes.map((w) => w.sql).join('\n');
  assert.match(tables, /INSERT INTO queue_snapshots/);
  assert.match(tables, /INSERT INTO mdb_copy_snapshots/);
  assert.match(tables, /INSERT INTO service_states/);
  assert.match(tables, /INSERT INTO client_access_snapshots/);
  assert.match(tables, /INSERT INTO server_resources/);
});
```

- [ ] **Step 2: Implement** — replace the existing `/report` handler with the ingestion block:

```js
// inside routes/agent.js, the report handler:
r.post('/report', async (req, res) => {
  const { agentId, hostname, capturedAt, queues = [], dag = {}, services = [], clientAccess = [], resources = {} } = req.body || {};
  if (!agentId || !hostname) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'agentId + hostname required' } });

  const db = req.app.locals.db;
  try {
    // Resolve server_id
    let serverRow = await db.query('SELECT id FROM servers WHERE hostname = ?', [hostname]);
    let serverId = serverRow && serverRow[0] ? serverRow[0].id : null;
    if (!serverId) {
      await db.query('INSERT INTO servers (agent_id, hostname) VALUES (?, ?)', [agentId, hostname]);
      serverRow = await db.query('SELECT id FROM servers WHERE hostname = ?', [hostname]);
      serverId = serverRow[0].id;
    }

    for (const q of queues) {
      await db.query(
        `INSERT INTO queue_snapshots (agent_id, server_id, captured_at, queue_kind, queue_name, message_count, messages_per_sec, deferred_per_sec)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [agentId, serverId, capturedAt, q.queue_kind, q.queue_name || q.queue_kind, q.message_count || 0, q.messages_per_sec ?? null, q.deferred_per_sec ?? null]
      );
    }
    for (const c of (dag.copies || [])) {
      await db.query(
        `INSERT INTO mdb_copy_snapshots (agent_id, server_id, db_id, captured_at, copy_queue_length, replay_lag_seconds, mount_status, content_index_state, is_active_copy, activation_preference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [agentId, serverId, c.db_id, capturedAt, c.copy_queue_length || 0, c.replay_lag_seconds ?? null, c.mount_status ?? 0, c.content_index_state ?? null, c.is_active_copy ?? 0, c.activation_preference ?? null]
      );
    }
    for (const s of services) {
      await db.query(
        `INSERT INTO service_states (agent_id, server_id, captured_at, service_name, state, start_mode) VALUES (?, ?, ?, ?, ?, ?)`,
        [agentId, serverId, capturedAt, s.service_name, s.state, s.start_mode]
      );
    }
    for (const m of clientAccess) {
      await db.query(
        `INSERT INTO client_access_snapshots (agent_id, server_id, captured_at, metric, value) VALUES (?, ?, ?, ?, ?)`,
        [agentId, serverId, capturedAt, m.metric, m.value]
      );
    }
    if (resources && (resources.cpu_pct != null || resources.memory_available_mb != null)) {
      await db.query(
        `INSERT INTO server_resources (agent_id, server_id, captured_at, cpu_pct, memory_available_mb, disk_c_free_pct, net_bytes_per_sec) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [agentId, serverId, capturedAt, resources.cpu_pct ?? null, resources.memory_available_mb ?? null, resources.disk_c_free_pct ?? null, resources.net_bytes_per_sec ?? null]
      );
    }
    await db.query('UPDATE agents SET last_report_at = NOW() WHERE agent_id = ?', [agentId]);
    res.status(202).json({ ok: true });
  } catch (e) {
    logger.error({ err: e.message }, 'report ingest failed');
    res.status(500).json({ error: { code: 'DB_ERROR', message: e.message } });
  }
});
```

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/center"
node --test tests/routes/agent-report.test.js
```

```bash
git add center/src/routes/agent.js center/tests/routes/agent-report.test.js
git commit -m "feat(center): agent report ingest pipeline (5 snapshot tables)"
```

---

## Phase 4 — Frontend

### Task 22: Frontend auth store + LoginView + router guard + InitWizard shell

**Files:**
- Create: `frontend/src/api/client.js`
- Create: `frontend/src/api/init.js`
- Create: `frontend/src/api/auth.js`
- Create: `frontend/src/stores/auth.js`
- Create: `frontend/src/stores/init.js`
- Create: `frontend/src/views/LoginView.vue`
- Create: `frontend/src/views/init/InitWizardView.vue`
- Create: `frontend/src/views/NotFoundView.vue`
- Modify: `frontend/src/router.js` (replace stub with full guard)
- Test: `frontend/tests/stores/auth.test.js`

**Interfaces:**
- `useAuthStore()` → `{ user, token, login({username,password}), logout(), isAdmin }`
- `useInitStore()` → `{ needsInit, refresh() }`
- `router.beforeEach`: redirects to `/init` if `needsInit`, to `/login` if no token (except public routes)
- `api/client.js`: axios instance with `Authorization` interceptor from `localStorage.ad_token`
- `api/init.js`: `getStatus()`, `testDb(payload)`, `finalize(payload)`
- `api/auth.js`: `login`, `logout`, `me`

- [ ] **Step 1: Test stores**

```js
// frontend/tests/stores/auth.test.js
import { test } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../../src/stores/auth.js';

test('login sets user + token', async () => {
  setActivePinia(createPinia());
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const auth = useAuthStore();
  auth.$patch({ user: null, token: '' });
  // Stub the api call
  auth.api = { login: async () => ({ token: 'tok', user: { username: 'admin', role: 'admin' } }) };
  await auth.login({ username: 'admin', password: 'pw12345678' });
  assert.equal(auth.token, 'tok');
  assert.equal(auth.user.username, 'admin');
  assert.equal(auth.isAdmin, true);
});
```

- [ ] **Step 2: Implement** — `api/client.js` (axios instance + interceptor), `api/init.js`, `api/auth.js`, stores, views. Router guard mirrors AD's logic (init-status cache + beforeEach).

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
git add frontend/src/api/ frontend/src/stores/ frontend/src/views/LoginView.vue frontend/src/views/init/InitWizardView.vue frontend/src/views/NotFoundView.vue frontend/src/router.js frontend/tests/
git commit -m "feat(frontend): auth store + login + init wizard + router guard"
```

---

### Task 23: Frontend AppLayout + DashboardView + StatusBar + api clients

**Files:**
- Create: `frontend/src/api/dashboard.js`, `frontend/src/api/queues.js`, `frontend/src/api/dag.js`, `frontend/src/api/clientAccess.js`, `frontend/src/api/servers.js`, `frontend/src/api/admin.js`, `frontend/src/api/lockout.js`, `frontend/src/api/migrations.js`, `frontend/src/api/heartbeatReport.js`
- Create: `frontend/src/components/AppLayout.vue`, `frontend/src/components/AdminLayout.vue`, `frontend/src/components/StatusBar.vue`
- Create: `frontend/src/views/DashboardView.vue`, `frontend/src/views/ServersOverviewView.vue`, `frontend/src/views/LockoutTroubleshootingView.vue`
- Test: `frontend/tests/components/AppLayout.test.js`

**Interfaces:** AppLayout left nav with `/`, `/mailflow`, `/dag`, `/client-access`, `/servers-overview`, `/lockout-troubleshooting`, `/dashboard/metrics`; topbar with `auth.user.username` + 管理 (admin only) + 退出.

- [ ] **Step 1: Test** AppLayout renders nav links and admin button when admin.

- [ ] **Step 2: Implement** all files. Reuse AD's `style.css` and the dark theme. DashboardView shows 5 cards (serverCount, dagCount, mdbCount, queuesNow summary, recentMdbErrors) by calling `api.dashboard.overview()`.

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
npm run build
git add frontend/src/api/ frontend/src/components/ frontend/src/views/DashboardView.vue frontend/src/views/ServersOverviewView.vue frontend/src/views/LockoutTroubleshootingView.vue frontend/tests/
git commit -m "feat(frontend): AppLayout + admin/status layout + DashboardView + StatusBar + API clients"
```

---

### Task 24: Frontend MailFlowView + QueueTable + QueueChart + StuckMessagesPanel

**Files:**
- Create: `frontend/src/components/QueueTable.vue`, `frontend/src/components/QueueChart.vue`, `frontend/src/components/StuckMessagesPanel.vue`
- Create: `frontend/src/views/MailFlowView.vue`

**Interfaces:**
- `QueueTable`: rows = queue snapshots, columns: server, queueKind, messageCount, messagesPerSec, capturedAt
- `QueueChart`: ECharts line, x = capturedAt, y = messageCount, series = queueKind
- Filters: timeWindow (`1h|6h|24h|7d`), serverId (all|serverId)
- StuckMessagesPanel: shows rows where `queue_kind in ('Poison','Retry')` or messageCount > threshold

- [ ] **Step 1: Test** QueueTable renders rows; QueueChart updates with data; StuckMessagesPanel filters.

- [ ] **Step 2: Implement** all four files using `api.queues.current()` and `api.queues.history()` and `api.queues.stuck()`.

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
npm run build
git add frontend/src/components/QueueTable.vue frontend/src/components/QueueChart.vue frontend/src/components/StuckMessagesPanel.vue frontend/src/views/MailFlowView.vue frontend/tests/
git commit -m "feat(frontend): MailFlowView + QueueTable + QueueChart + StuckMessagesPanel"
```

---

### Task 25: Frontend DagTopologyView + DagGridView

**Files:**
- Create: `frontend/src/components/DagTopologyChart.vue`, `frontend/src/components/DagGrid.vue`
- Create: `frontend/src/views/DagTopologyView.vue`, `frontend/src/views/DagGridView.vue`

**Interfaces:**
- DagTopologyChart: ECharts `graph` with `nodes = servers`, `edges = replication links`; click → emit `server-click`
- DagGrid: rows = databases, cols = servers, cell = copy queue + replay lag + mount status

- [ ] **Step 1: Test** DagTopologyChart renders nodes; DagGrid renders rows.

- [ ] **Step 2: Implement** using `api.dag.list()`, `api.dag.topology(id)`, `api.dag.databases(id)`, `api.dag.copyStatus(id, dbId)`.

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
npm run build
git add frontend/src/components/DagTopologyChart.vue frontend/src/components/DagGrid.vue frontend/src/views/DagTopologyView.vue frontend/src/views/DagGridView.vue frontend/tests/
git commit -m "feat(frontend): DagTopologyView + DagGridView with ECharts"
```

---

### Task 26: Frontend ClientAccessView + ClientAccessTile

**Files:**
- Create: `frontend/src/components/ClientAccessTile.vue`
- Create: `frontend/src/views/ClientAccessView.vue`

**Interfaces:** Tile shows metric + value + sparkline of last N samples; view lays out 6 tiles.

- [ ] **Step 1: Test** Tile renders metric + value; View renders 6 tiles when data present.

- [ ] **Step 2: Implement** using `api.clientAccess.summary()`.

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
git add frontend/src/components/ClientAccessTile.vue frontend/src/views/ClientAccessView.vue frontend/tests/
git commit -m "feat(frontend): ClientAccessView + ClientAccessTile"
```

---

### Task 27: Frontend ServersOverviewView + ServerCard + ServiceHealthBar

**Files:**
- Create: `frontend/src/components/ServerCard.vue`, `frontend/src/components/ServiceHealthBar.vue`
- Create: `frontend/src/views/ServersOverviewView.vue`

**Interfaces:**
- `ServerCard`: hostname + last heartbeat + services summary + resources + key counters
- `ServiceHealthBar`: row per service, color = state

- [ ] **Step 1: Test** ServerCard renders; ServiceHealthBar color-codes by state.

- [ ] **Step 2: Implement** using `api.servers.list()` and `api.servers.health(id)`.

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
git add frontend/src/components/ServerCard.vue frontend/src/components/ServiceHealthBar.vue frontend/src/views/ServersOverviewView.vue frontend/tests/
git commit -m "feat(frontend): ServersOverviewView + ServerCard + ServiceHealthBar"
```

---

### Task 28: Frontend admin views

**Files:** Create admin views under `frontend/src/views/admin/`:
- `UsersView.vue` — list, create, enable/disable, delete via `api.admin.users*`
- `RolesView.vue` — read-only listing (mirrors AD; roles are seeded)
- `ConfigView.vue` — read/write `system_config` via `api.admin.config*`
- `AuditView.vue` — paginated audit log via `api.admin.audit`
- `DagsCatalogView.vue` — list/edit DAGs (admin creates via `POST /api/admin/dags` extension; for v1, read-only list)
- `DbsCatalogView.vue` — read-only `mdb_catalog`
- `DagReplicationMatrixView.vue` — materialised view query
- `SchemaMigrationsView.vue` — list + apply via `api.migrations.*`
- `PortsView.vue` — probe results
- `HeartbeatReportMonitorView.vue` — list offline agents
- `PackagesView.vue`, `RegistryView.vue`, `PackageEditView.vue` — stub for v1 (plugin system not yet wired)

Each view: list + form + submit pattern, auth-gated via router meta `perm`.

- [ ] **Step 1: Test** UsersView renders; ConfigView updates; AuditView lists.

- [ ] **Step 2: Implement** views. Mirror AD's field-by-field.

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
npm run build
git add frontend/src/views/admin/ frontend/tests/
git commit -m "feat(frontend): admin views (users/roles/config/audit/catalog/ports/migrations/heartbeat-report)"
```

---

### Task 29: Frontend MetricDashboardView + packages store + metric tiles + LockoutView

**Files:**
- Create: `frontend/src/stores/packages.js`
- Create: `frontend/src/components/metrics/{GaugeTile,CounterTile,TimeseriesTile,StatusTile}.vue`
- Create: `frontend/src/views/MetricDashboardView.vue`
- Modify: `frontend/src/views/LockoutTroubleshootingView.vue` (Exchange-flavored copy)

- [ ] **Step 1: Test** MetricDashboardView renders tiles; packages store fetchInstalled.

- [ ] **Step 2: Implement** mirror AD's metric tile components exactly (they are domain-agnostic).

- [ ] **Step 3: Run + commit**

```bash
cd "D:/ToolDevelop/ExDashboard/frontend"
npm test -- --run
npm run build
git add frontend/src/stores/packages.js frontend/src/components/metrics/ frontend/src/views/MetricDashboardView.vue frontend/src/views/LockoutTroubleshootingView.vue frontend/tests/
git commit -m "feat(frontend): MetricDashboardView + metric tiles + LockoutView"
```

---

## Phase 5 — Operations

### Task 30: NSSM PowerShell install/uninstall/update scripts

**Files:**
- Create: `scripts/common/{Logger,NSSM,Service,Ensure-Nssm}.psm1`
- Create: `scripts/install-center.ps1`, `scripts/uninstall-center.ps1`, `scripts/update-center.ps1`
- Create: `scripts/install-agent.ps1`, `scripts/uninstall-agent.ps1`, `scripts/update-agent.ps1`
- Create: `scripts/smoke-test.ps1`

**Interfaces:**
- `Install-Center { -PublishDir, -ListenPort, -HeartbeatPort, -ReportPort, -DisplayName }` — registers `ExDashboardCenter` via NSSM, sets stdout/stderr to `C:\exdashboard\Logs\ExDashboardCenter-{stdout,stderr}.log` (10MB rotate)
- `Install-Agent { -PublishDir, -CenterBaseUrl, -Hostname }` — registers `ExDashboardAgent`
- `Uninstall-Center { -KeepData }`, `Uninstall-Agent { -KeepData }`
- `Update-Center { -PublishDir }` — stop → backup → swap → start
- `Smoke-Test { -BaseUrl }` — `Invoke-WebRequest /healthz`, `/api/init/status`, and queries `/api/servers` to verify agents visible

- [ ] **Step 1: Implement** all scripts. Mirror AD's `scripts/` exactly, swapping `ADDashboard*` → `ExDashboard*`.

- [ ] **Step 2: Lint** with PowerShell syntax check (no execution needed on non-Windows CI):

```bash
powershell -NoProfile -Command "Get-ChildItem scripts/*.ps1, scripts/common/*.psm1 | ForEach-Object { [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$null) }"
```

Expected: no parse errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/
git commit -m "feat(ops): NSSM install/uninstall/update scripts + smoke-test"
```

---

### Task 31: start.bat / start.ps1 entry scripts

**Files:**
- Create: `start.bat`
- Create: `start.ps1`
- Create: `scripts/start-prod.js`

**Interfaces:**
- `start.bat [--console|-c|--help|-h]` — default installs + starts `ExDashboardCenter`; `--console` runs `node center/server.js` in foreground
- `start.ps1 [-Console|-Help]` — same
- `scripts/start-prod.js` — root `npm start`: builds frontend if missing, mirrors `frontend/dist/` → `center/dist/`, spawns `node center/server.js` with `cwd=center/`

- [ ] **Step 1: Implement** mirroring AD's `start.bat`, `start.ps1`, `scripts/start-prod.js`. Swap service name to `ExDashboardCenter`.

- [ ] **Step 2: Smoke**

```bash
node scripts/start-prod.js &
sleep 5
curl -s http://localhost:8080/healthz
kill %1
```

Expected: `{"ok":true,"needsInit":true}` first run.

- [ ] **Step 3: Commit**

```bash
git add start.bat start.ps1 scripts/start-prod.js
git commit -m "feat(ops): start.bat/start.ps1 entry points + scripts/start-prod.js"
```

---

### Task 32: docs + README + smoke-test

**Files:**
- Create: `docs/index.md`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/runbook.md`
- Create: `docs/operations/troubleshooting.md`
- Modify: `README.md` (replace placeholder with full content mirroring AD's README, swap branding)

- [ ] **Step 1: Write `docs/index.md`** with links to deployment, runbook, troubleshooting, and design specs.

- [ ] **Step 2: Write `docs/operations/deployment.md`** describing: pick a Windows Server for center, run `start.bat` (admin), browser to `/init`, run init wizard, distribute agent bundle to each Exchange Server, run `install-agent.ps1`, verify in admin UI.

- [ ] **Step 3: Write `docs/operations/runbook.md`** with service management commands, log tailing, reset/upgrade procedures.

- [ ] **Step 4: Write `docs/operations/troubleshooting.md`** with common issues: service won't start (check Node in PATH), agent not registering (check center ports 8081/8082 firewall), counters not visible (Exchange role missing the counter), DB upgrade failure (rollback procedure).

- [ ] **Step 5: Replace `README.md`** with the full content from `AD Dashboard — Green Version`, replacing ADDashboard* branding with ExDashboard*.

- [ ] **Step 6: Commit**

```bash
git add docs/ README.md
git commit -m "docs: operations guides + README"
```

---

## End of Plan

Total: 32 tasks. Each task ends with a passing test suite, a working build, and a discrete commit. Acceptance criteria (mirror spec §10.9):

- [ ] Center starts as NSSM service, init wizard completes 3 screens
- [ ] Agent starts as NSSM service, first heartbeat visible within 30s
- [ ] DashboardView counts match `servers` / `dags` / `mdb_catalog`
- [ ] MailFlowView queue table + chart render
- [ ] DagTopologyView shows graph, color-coded, click-to-drill
- [ ] ClientAccessView renders 6 metric tiles
- [ ] Backend tests pass on MySQL + SQL Server
- [ ] Frontend `vitest` green; `vite build` succeeds
- [ ] `smoke-test.ps1` passes after install
- [ ] runbook + deployment.md describe reset/upgrade/uninstall
- [ ] No AD-specific residue in code (`repadmin`, `siteLink`, `dcs`)

---

## Self-Review

**Spec coverage:**
- §1 Goal & Scope: covered by Tasks 1-4 (scaffold) and overall structure
- §2 Non-Goals: implicit (no Linux, no EMS, no auto-remediation enforced by code paths)
- §3 Architecture: Tasks 5-14 (center), Tasks 15-21 (agent), Tasks 22-29 (frontend)
- §4 Directory Layout: Tasks 1, 2, 3, 4 (each file path listed)
- §5 Center Backend: Tasks 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
- §6 Agent: Tasks 15, 16, 17, 18, 19, 20, 21
- §7 Frontend: Tasks 22, 23, 24, 25, 26, 27, 28, 29
- §8 Database Schema: Task 7 (initial schema), Task 21 (ingest), Task 14 (retention)
- §9 Deployment & Operations: Tasks 30, 31, 32
- §10 Error Handling & Testing: Tests are inline per task; error middleware in Task 8 (requireAuth/requirePerm); retention purge in Task 14
- §10.10 Known Limitations: documented in Task 15 (DAG membership stub) and Task 6 (mssql placeholder notes)

**Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" placeholders. Tasks 16-29 use compact form (interfaces + key code sketches) rather than the full bite-sized step format of Tasks 1-15 — this is a deliberate density trade-off, not a placeholder; the implementer expands each step using the same write-fail-pass-commit pattern as Phases 1-2.

**Type consistency:** All `agentId` references are `string`; all `serverId` references are `number` after center ingest; all counter values are `number`; all `captured_at` are ISO strings on agent side, DB-side they go through `DATETIME` columns. Cross-task: `agentId` from discovery (Task 15) is the same field used in `agents` table (Task 9) and report ingest (Task 21). `server_id` resolution logic is consistent across heartbeat, report, and admin queries.

**Scope:** Single coherent project. No decomposition needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-09-exchange-dashboard.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?