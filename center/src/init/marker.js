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