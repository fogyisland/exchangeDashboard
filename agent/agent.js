import fs from 'node:fs';
import { createLogger } from './src/logger.js';
import { loadConfig, defaultConfig } from './src/config.js';
import { LocalQueue } from './src/local-queue.js';
import { startHeartbeat } from './src/heartbeat.js';
import { startReporter } from './src/reporter.js';
import { discover } from './src/discovery.js';
import { healthcheck } from './src/healthcheck.js';
import { PerfmonCollector } from './src/perfmon-collector.js';
import { MailflowCollector } from './src/mailflow-collector.js';
import { DagCollector } from './src/dag-collector.js';
import { ServicesCollector } from './src/services-collector.js';
import { ClientAccessCollector } from './src/clientaccess-collector.js';
import { urlFor } from './src/url.js';

const configPath = process.argv[2] || process.env.APPSETTINGS_PATH || './appsettings.json';

(async () => {
  const cfg = fs.existsSync(configPath) ? { ...defaultConfig(), ...loadConfig(configPath) } : defaultConfig();
  const logger = createLogger({ component: 'agent', level: cfg.logLevel });
  const queue = new LocalQueue(cfg.localQueue.dbPath);

  const identity = await discover({});
  cfg.agentId = identity.agentId;
  logger.info({ agentId: cfg.agentId, hostname: identity.hostname }, 'discovered');

  // POST discover to center (best-effort, retried on next tick). Discover
  // is mounted on reportApp (8082) alongside /report — see server.js.
  try {
    const url = urlFor(cfg.center.baseUrl, cfg.center.reportPort, cfg.center.discoverPath);
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity) });
  } catch (e) { logger.warn({ err: e.message }, 'discover post failed'); }

  // Instantiate the 5 collectors (Tasks 16-20) and call them in getSnapshot.
  // Each .collect() is wrapped in try/catch so one failing collector doesn't
  // take down the whole snapshot (non-Windows hosts return {value:null} / []
  // for perfmon calls, but some wmi calls can still throw).
  const perfmon = new PerfmonCollector();
  const mailflow = new MailflowCollector(perfmon);
  const dag = new DagCollector(perfmon, { databases: [] });
  const services = new ServicesCollector(perfmon);
  const clientAccess = new ClientAccessCollector(perfmon);

  const getSummary = () => identity;
  const getSnapshot = async () => {
    const capturedAt = new Date().toISOString();

    let queues = [];
    try {
      queues = await mailflow.collect();
    } catch (e) { logger.warn({ err: e.message }, 'mailflow collect failed'); }

    let dagResult = { copies: [] };
    try {
      dagResult = await dag.collect();
    } catch (e) { logger.warn({ err: e.message }, 'dag collect failed'); }

    let servicesResult = { services: [], resources: { cpu_pct: null, memory_available_mb: null, disk_c_free_pct: null, net_bytes_per_sec: null } };
    try {
      servicesResult = await services.collect();
    } catch (e) { logger.warn({ err: e.message }, 'services collect failed'); }

    let clientAccessRows = [];
    try {
      clientAccessRows = await clientAccess.collect();
    } catch (e) { logger.warn({ err: e.message }, 'clientAccess collect failed'); }

    return {
      agentId: cfg.agentId,
      hostname: identity.hostname,
      capturedAt,
      queues,
      dag: { members: [], copies: dagResult.copies || [] },
      services: servicesResult.services || [],
      clientAccess: clientAccessRows,
      resources: servicesResult.resources || {}
    };
  };

  const hb = startHeartbeat({ config: cfg, logger, getSummary });
  const rep = startReporter({ config: cfg, logger, queue, getSnapshot });
  healthcheck({ logger });

  logger.info({ agentId: cfg.agentId }, 'agent started');

  process.on('SIGINT', () => { hb.stop(); rep.stop(); queue.close(); process.exit(0); });
  process.on('SIGTERM', () => { hb.stop(); rep.stop(); queue.close(); process.exit(0); });
})();
