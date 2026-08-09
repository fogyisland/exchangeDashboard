import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

export function installPathFromConfigPath(configPath) {
  return path.resolve(path.dirname(configPath));
}

// Default Windows-registry probe — returns true iff
// `HKLM\SOFTWARE\ExDashboard!Initialized = REG_DWORD 0x1` is present.
// Wrapped in try/catch: a non-admin user or a missing key both throw, and
// we treat both as "no registry marker". Non-Windows always returns false.
function defaultCheckRegistry() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\ExDashboard" /v Initialized',
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
    );
    // reg output includes a line like "    Initialized    REG_DWORD    0x1"
    return /\bInitialized\s+REG_DWORD\s+0x1\b/.test(out);
  } catch {
    return false;
  }
}

export function hasMarker({ configPath, _checkRegistry = defaultCheckRegistry }) {
  // 1) File marker (.env sibling of appsettings.json).
  const envPath = path.join(installPathFromConfigPath(configPath), '.env');
  let envOk = false;
  if (fs.existsSync(envPath)) {
    envOk = /^EXDASHBOARD_INITIALIZED=1/m.test(fs.readFileSync(envPath, 'utf8'));
  }
  // 2) Windows registry marker (HKLM\SOFTWARE\ExDashboard!Initialized = 0x1).
  // Either marker is sufficient — the wizard stays locked off until BOTH
  // the file and the registry are cleared, matching the spec.
  if (envOk) return true;
  try {
    if (_checkRegistry()) return true;
  } catch { /* probe failure → treat as no marker */ }
  return false;
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
      execSync('reg add "HKLM\\SOFTWARE\\ExDashboard" /v Initialized /t REG_DWORD /d 1 /f', { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
}