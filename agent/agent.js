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