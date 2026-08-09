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

export async function discover({ hostname = os.hostname(), fqdn = os.hostname(), osVersion = `${os.platform()} ${os.release()}`, registry = null } = {}) {
  const agentIdSeed = `${hostname}-${os.hostname()}`.toLowerCase();
  const agentId = crypto.createHash('sha1').update(agentIdSeed).digest('hex').slice(0, 16);

  let exchangeVersion = null;
  let serverRole = 0;
  let dagId = null;

  if (registry) {
    exchangeVersion = await registry.readExchangeVersion();
    serverRole = await registry.readServerRoleFlags();
    dagId = await registry.readDagMembership();
  } else {
    exchangeVersion = await readExchangeVersion();
    serverRole = await readServerRoleFlags();
    dagId = await readDagMembership();
  }

  return {
    agentId,
    hostname,
    fqdn,
    osVersion,
    exchangeVersion,
    serverRole,
    dagId
  };
}