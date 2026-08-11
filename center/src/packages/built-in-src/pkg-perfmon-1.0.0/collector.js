// Ported from agent/src/perfmon-collector.js
const COUNTERS = [
  ['cpu_pct', '\\Processor(_total)\\% Processor Time'],
  ['memory_available_mb', '\\Memory\\Available MBytes'],
  ['disk_c_free_pct', '\\LogicalDisk(C:)\\% Free Space'],
  ['net_bytes_per_sec', '\\Network Interface(*)\\Bytes Total/sec']
];
export default {
  name: 'pkg-perfmon',
  async collect({ perfmon }) {
    if (!perfmon || typeof perfmon.counterMulti !== 'function') return [];
    const paths = COUNTERS.map(([, p]) => p);
    let raw;
    try { raw = await perfmon.counterMulti(paths); } catch { return []; }
    const out = {};
    for (const [k, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (!Number.isNaN(v)) out[k] = v;
    }
    return [out]; // single row per tick
  }
};
