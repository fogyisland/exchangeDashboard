import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decryptString, loadOrCreateKey } from './config-crypto.js';

const SECRET_FIELDS = [
  ['db', 'password'],
  ['jwt', 'secret']
];

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
    },
    packageCatalogUrl: null
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

export async function loadConfigOrNull(configPath) {
  if (!fs.existsSync(configPath)) return null;
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  const envPath = path.join(installPathFromConfigPath(configPath), '.env');
  const { key } = loadOrCreateKey(envPath);

  const cfg = { ...defaultConfig(), ...parsed };
  if (parsed.db) cfg.db = { ...defaultConfig().db, ...parsed.db };
  if (parsed.jwt) cfg.jwt = { ...defaultConfig().jwt, ...parsed.jwt };
  if (parsed.agent) cfg.agent = { ...defaultConfig().agent, ...parsed.agent };

  let needsMigration = false;
  for (const [obj, field] of SECRET_FIELDS) {
    const value = cfg[obj]?.[field];
    const decrypted = decryptString(value, key);
    cfg[obj][field] = decrypted;
    if (!value || !value.startsWith?.('enc:v1:')) needsMigration = true;
  }

  return { config: cfg, installPath: installPathFromConfigPath(configPath), needsMigration };
}
