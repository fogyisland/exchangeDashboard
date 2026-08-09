// agent/src/perfmon-collector.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

export function parseTypeperfCsv(stdout) {
  // typeperf output: "(\\path)", "timestamp", "value" rows
  const lines = stdout.trim().split(/\r?\n/);
  // skip "(PDH-CSV 4.0)" header line if present
  const dataLines = lines[0] && lines[0].startsWith('"(PDH-CSV') ? lines.slice(1) : lines;
  return dataLines.filter(Boolean).map((line) => {
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    // cols: [counterPath, timestamp, value]
    return { timestamp: cols[1] || null, value: cols[2] || null };
  });
}

export function parseWmicCsv(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}

export class PerfmonCollector {
  constructor({ exec = execFileP } = {}) { this.exec = exec; }
  async counter(counterPath) {
    if (process.platform !== 'win32') return { value: null };
    const { stdout } = await this.exec('typeperf', ['-sc', '1', counterPath]);
    const rows = parseTypeperfCsv(stdout);
    return { value: rows[0]?.value ?? null };
  }
  async counterMulti(paths) {
    if (process.platform !== 'win32') return {};
    const { stdout } = await this.exec('typeperf', ['-sc', '1', ...paths]);
    const rows = parseTypeperfCsv(stdout);
    const out = {};
    paths.forEach((p, i) => { out[p] = rows[i]?.value ?? null; });
    return out;
  }
  async wmi(query, properties) {
    if (process.platform !== 'win32') return [];
    const { stdout } = await this.exec('wmic', [query, 'get', properties.join(','), '/format:csv']);
    return parseWmicCsv(stdout);
  }
}
