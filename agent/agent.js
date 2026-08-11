import fs from 'node:fs';
import { createLogger } from './src/logger.js';
import { loadConfig, defaultConfig } from './src/config.js';
import { startHeartbeat } from './src/heartbeat.js';
import { startReporter } from './src/reporter.js';
import { discover } from './src/discovery.js';
import { healthcheck } from './src/healthcheck.js';
import { PackageRunner } from './src/package-runner.js';
import { urlFor } from './src/url.js';
import path from 'node:path';

const configPath = process.argv[2] || process.env.APPSETTINGS_PATH || './appsettings.json';

(async () => {
  const cfg = fs.existsSync(configPath) ? { ...defaultConfig(), ...loadConfig(configPath) } : defaultConfig();
  const logger = createLogger({ component: 'agent', level: cfg.logLevel });
  const installPath = path.resolve(cfg.installPath);

  const identity = await discover({});
  cfg.agentId = identity.agentId;
  logger.info({ agentId: cfg.agentId, hostname: identity.hostname }, 'discovered');

  // POST discover to center (best-effort, retried on next tick). Discover
  // is mounted on reportApp (8082) alongside /report — see server.js.
  try {
    const url = urlFor(cfg.center.baseUrl, cfg.center.reportPort, cfg.center.discoverPath);
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity) });
  } catch (e) { logger.warn({ err: e.message }, 'discover post failed'); }

  // PackageRunner is the single source of truth for installed packages.
  // It loads any pre-installed packages at startup, and reconcile() (called
  // from the heartbeat tick) pulls new ones assigned by the center.
  const packageRunner = new PackageRunner({
    installPath,
    logger,
    downloadUrlBase: cfg.center.baseUrl
  });
  await packageRunner.loadInstalled();

  const getSummary = () => identity;
  const getCtx = async () => ({ config: cfg, logger, identity });

  const hb = startHeartbeat({ config: cfg, logger, getSummary, packageRunner });
  const rep = startReporter({ config: cfg, logger, packageRunner, getCtx });
  healthcheck({ logger });

  logger.info({ agentId: cfg.agentId }, 'agent started');

  process.on('SIGINT', () => { hb.stop(); rep.stop(); process.exit(0); });
  process.on('SIGTERM', () => { hb.stop(); rep.stop(); process.exit(0); });
})();