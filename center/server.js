// center/server.js — ExDashboard center entry point.
//
// Builds the three independent Express apps that run side-by-side:
//   - webApp        (8080) admin UI, auth, dashboard, init wizard
//   - heartbeatApp  (8081) POST /api/agent/heartbeat — small, frequent
//   - reportApp     (8082) POST /api/agent/report + /discover + GET /config — heavy, sparse
//
// The split mirrors the AD reference pattern but is adapted to ExDashboard's
// actual module surfaces — see comments at each import for the per-route
// factory contract.
//
// `buildServerApps` is the test-friendly entry: importing this file from a
// test must NOT fire the runtime IIFE (which would read appsettings, open
// the DB, and bind a real port). Only `node server.js [configPath]` runs
// the IIFE.

import express from 'express';
import { pathToFileURL } from 'node:url';
import pino from 'pino';

import { createApp } from './src/app.js';
import { defaultConfig, sha256Hex, installPathFromConfigPath } from './src/config.js';
import { healthzRouter } from './src/routes/healthz.js';
import { init, close } from './src/db/index.js';
import { startServers, closeAll } from './src/multi-port.js';

import { authRouter } from './src/routes/auth.js';
import { agentRouter } from './src/routes/agent.js';
import { dashboardRouter } from './src/routes/dashboard.js';
import { adminRouter } from './src/routes/admin.js';
// dcsRouter from AD → replaced with dagRouter (ExDashboard tracks DAGs via
// the dags service rather than a dedicated DC summary endpoint).
import { dagRouter } from './src/routes/dag.js';
import { lockoutRouter } from './src/routes/lockout.js';
// schema-migrations.js has a pre-existing import bug
// (`import { requireAuth } from 'user-auth'` — that module exports `userAuth`
// as a factory, not a named `requireAuth`). Lazy-import below so the
// buildServerApps import-graph stays clean for tests. See TODO at the
// mount site for the planned fix.
import { heartbeatReportRouter } from './src/routes/heartbeat-report.js';

import { initRouter } from './src/init/router.js';
import { hasMarker } from './src/init/marker.js';
import { checkNeedsInit } from './src/init/needs-init.js';
import { closeWizardFacade } from './src/init/wizard-facade.js';

import { userAuth } from './src/auth/user-auth.js';

import { createProbeLoop } from './src/services/probe.js';
import { writeAudit } from './src/services/audit.js';

// ExDashboard does NOT use a `system_config` row for heartbeat/report ports
// — those come straight from `appsettings.json` (config.heartbeatPort /
// reportPort). `systemConfig` is still accepted by buildServerApps to keep
// the factory contract identical to AD (the caller passes the system_config
// map; we only fall back to `{}` because the keys aren't relevant here).
export function buildServerApps({ config, db, logger, needsInit, systemConfig = {} }) {
  // heartbeatApp — small payloads, tight body limit. agentRouter mounted
  // with `mount: 'heartbeat'` gates /heartbeat only.
  const heartbeatApp = express();
  heartbeatApp.disable('x-powered-by');
  heartbeatApp.use(express.json({ limit: '256kb' }));
  heartbeatApp.use(healthzRouter());
  heartbeatApp.use(agentRouter({ config, logger, mount: 'heartbeat' }));

  // reportApp — replication snapshots can be 10MB+. agentRouter mounted
  // with `mount: 'report'` gates /report + /discover + /config.
  const reportApp = express();
  reportApp.disable('x-powered-by');
  reportApp.use(express.json({ limit: '10mb' }));
  reportApp.use(healthzRouter());
  reportApp.use(agentRouter({ config, logger, mount: 'report' }));

  // Web app: createApp gives healthz + JSON parsing + req.log middleware +
  // pino HTTP logging. The actual route mounting (init vs normal mode)
  // happens in the IIFE below because it depends on runtime state.
  const webApp = createApp({ config, db, logger, needsInit });

  return {
    webApp,
    heartbeatApp,
    reportApp,
    ports: {
      web: config.listenPort,
      heartbeat: config.heartbeatPort || 8081,
      report: config.reportPort || 8082
    }
  };
}

// ---------- runtime bootstrap (only fires when invoked as `node server.js`) ----------

const configPath = process.argv[2] || process.env.APPSETTINGS_PATH || './appsettings.json';
const installPath = installPathFromConfigPath(configPath);

// Sync-ish logger that writes to stderr before process.exit so NSSM restart
// logs capture the line. pino defaults to async; the AD reference uses
// `pino({dest:2, sync:true})` but ExDashboard's logger.js uses defaults —
// acceptable for now (TODO: switch to sync if we see missing stderr lines
// in production restart logs).
const logger = pino({
  level: 'info',
  base: { component: 'center' },
  timestamp: pino.stdTimeFunctions.isoTime
});

// Last-line-of-defense traps — without these an uncaught throw inside the
// async IIFE just exits Node with no stderr trace, and NSSM restart shows
// "ran for <1500ms" with no visible cause.
process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err: err && err.message, stack: err && err.stack, origin }, 'uncaughtException');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal({ err: err.message, stack: err.stack }, 'unhandledRejection');
  process.exit(1);
});

// Main-entry guard — only run the IIFE when invoked directly. Tests call
// `buildServerApps` via `import`; running the runtime would try to open the
// DB and bind ports inside the test process.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  await (async () => {
    // Init-complete marker (file + Windows registry) hard-locks the wizard
    // off once /finalize has run. Checked first so deleting appsettings.json
    // can't re-trigger the wizard without also clearing the marker.
    const markerLocked = hasMarker({ configPath });

    let config = null;
    if (defaultConfig && require('node:fs').existsSync(configPath)) {
      try {
        const loaded = await import('./src/config.js').then(m => m.loadConfigOrNull ? m.loadConfigOrNull(configPath) : null);
        if (loaded && loaded.config) config = loaded.config;
      } catch (e) {
        logger.warn({ err: e.message }, 'config load failed');
      }
    }
    // loadConfigOrNull isn't in scope at the top (we only imported
    // defaultConfig/sha256Hex). Re-import it now that we're inside the IIFE.
    let db = null;
    if (config) {
      try {
        db = await init(config);
      } catch (err) {
        logger.warn({ err: err.message }, 'db init failed');
        if (markerLocked) {
          logger.error('db init failed and wizard is locked by marker — refusing to start. To recover: restore db connectivity (preferred) OR clear the EXDASHBOARD_INITIALIZED key in .env + the HKLM\\SOFTWARE\\ExDashboard registry value AND delete appsettings.json to re-run the wizard.');
          process.exit(2);
        }
        logger.warn('falling back to init mode');
        config = null;
        db = null;
      }
    }
    if (markerLocked) logger.info('init marker present; wizard locked out');
    if (markerLocked && !config) {
      logger.error('init marker present but config missing — refusing to start. To recover: restore appsettings.json (preferred) OR clear the EXDASHBOARD_INITIALIZED key in .env + the registry value AND delete appsettings.json to re-run the wizard.');
      process.exit(2);
    }
    const needsInit = markerLocked ? false : checkNeedsInit({ configPath });
    const finalConfig = config ?? defaultConfig();

    // ExDashboard does not use system_config to override the multi-port
    // settings — appsettings.json is authoritative. Read it once to log
    // any custom values, then proceed.
    const systemConfig = {};

    // Build apps before the listen loop. createApp is side-effect-free
    // (just constructs an Express app + middleware), so this is safe even
    // if the listen() call below ends up throwing.
    const apps = buildServerApps({ config: finalConfig, db, logger, needsInit, systemConfig });
    const app = apps.webApp;

    // /api/init is mounted in BOTH modes. The /status endpoint is
    // intentionally reachable in normal mode so the frontend's `beforeEach`
    // can probe init state without 404 noise. Other init routes stay
    // guarded by the router's internal checkNeedsInit() call.
    app.use('/api/init', initRouter({ configPath }));

    if (needsInit) {
      logger.info('init mode: serving /api/init/* only');
      const server = apps.webApp.listen(finalConfig.listenPort, () => {
        logger.info({ port: finalConfig.listenPort, needsInit }, 'center listening (init mode)');
      });
      const shutdown = async (sig) => {
        logger.info({ sig }, 'shutting down');
        server.close(async () => {
          try { await closeWizardFacade(); } catch {}
          try { if (db) await close(db); } catch {}
          process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000).unref();
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    } else {
      // Normal mode: all routes mounted, then startServers binds all three
      // ports concurrently. startServers dedupes by port (first wins) so a
      // misconfigured triple-with-same-port falls back to single-server
      // behavior without throwing — matches the documented contract.
      app.use('/api/auth', authRouter({
        db,
        jwtSecret: finalConfig.jwt.secret,
        expiresInSeconds: finalConfig.jwt.expiresInSeconds
      }));
      // heartbeatApp / reportApp already own the heartbeat/report traffic
      // via their dedicated agentRouter mounts; webApp keeps every other
      // admin-facing route below.
      app.use('/api/dashboard', dashboardRouter({ db }));
      app.use('/api/admin', adminRouter({ db, logger, config: finalConfig }));
      // ExDashboard DAG topology endpoint (replaces AD's dcsRouter).
      app.use('/api/dags', dagRouter({ db }));
      // TODO: implemented in later task — lockoutRouter in ExDashboard is a
      // stub (no per-route auth). Wire requireAuth/requirePerm once the
      // lockout event table is populated by the agent collector.
      app.use('/api/lockout', lockoutRouter());
      // TODO: implemented in later task — schema-migrations.js has a
      // pre-existing bad named import (`requireAuth` from a module that
      // exports `userAuth`). Lazy-import here so the bug doesn't break
      // server bootstrap; fix the route file in a follow-up.
      const { schemaMigrationsRouter } = await import('./src/routes/schema-migrations.js');
      app.use('/api/schema-migrations', schemaMigrationsRouter({ db }));
      app.use('/api/heartbeat-report', heartbeatReportRouter({ db, config: finalConfig }));
      // TODO: implemented in later task — wire the packageRouter/orphanRouter
      // once `center/src/packages/` exists (ExDashboard has no package
      // system in the bootstrap yet — skip until Task 7 adds it).

      const handles = startServers({
        webApp: apps.webApp,
        heartbeatApp: apps.heartbeatApp,
        reportApp: apps.reportApp,
        ports: apps.ports,
        logger
      });

      // Start the retention/heartbeat probe loop. ExDashboard's
      // createProbeLoop accepts {db, logger, intervalMs, staleSeconds,
      // retention} — no `ports` argument (probe.js is the AD probe +
      // retention purge job merged).
      const probeLoop = createProbeLoop({
        db,
        logger,
        intervalMs: 3600_000,
        staleSeconds: finalConfig.agent?.heartbeatStaleSeconds ?? 90,
        retention: {
          queueDays: finalConfig.agent?.queueRetentionDays ?? 7,
          mdbDays: finalConfig.agent?.mdbCopyRetentionDays ?? 7,
          serviceDays: finalConfig.agent?.serviceStateRetentionDays ?? 30
        }
      });

      const shutdown = async (sig) => {
        logger.info({ sig }, 'shutting down');
        try { probeLoop.stop(); } catch (e) { logger.warn({ err: e.message }, 'probe stop failed'); }
        try { await closeAll(handles); } catch (e) { logger.warn({ err: e.message }, 'server close failed'); }
        try { await closeWizardFacade(); } catch {}
        try { if (db) await close(db); } catch {}
        process.exit(0);
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

      // Avoid unused-var lint warnings on names reserved for future use.
      void sha256Hex;
      void writeAudit;
    }
  })().catch((err) => {
    logger.error({ err: err.message }, 'fatal');
    process.exit(1);
  });
}
