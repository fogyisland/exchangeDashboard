// Ported from agent/src/services-collector.js
import { execFile as ef } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(ef);

export default {
  name: 'pkg-services',
  async collect() {
    if (process.platform !== 'win32') return [];
    let stdout;
    try {
      const r = await pexec('wmic', ['service', 'where', "Name like 'MSExchange%'", 'get', 'Name,State,StartMode', '/format:csv'], { timeout: 8000 });
      stdout = r.stdout;
    } catch { return []; }
    const lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',');
    const nameIdx = headers.indexOf('Name');
    const stateIdx = headers.indexOf('State');
    const startIdx = headers.indexOf('StartMode');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < headers.length) continue;
      const name = parts[nameIdx];
      if (!name || !name.includes('MSExchange')) continue;
      out.push({ service_name: name, state: parts[stateIdx] || 'Unknown', start_mode: parts[startIdx] || 'Unknown' });
    }
    return out;
  }
};
