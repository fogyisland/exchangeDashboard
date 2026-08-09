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