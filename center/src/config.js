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
