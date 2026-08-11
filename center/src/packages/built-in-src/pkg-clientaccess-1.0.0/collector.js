// Ported from agent/src/clientaccess-collector.js
const COUNTERS = [
  ['RpcClientAccess\\RPC Average Latency', '\\MSExchange RpcClientAccess\\RPC Average Latency'],
  ['RpcClientAccess\\RPC Operations/sec', '\\MSExchange RpcClientAccess\\RPC Operations/sec'],
  ['RpcClientAccess\\Active User Count', '\\MSExchange RpcClientAccess\\Active User Count']
];
export default {
  name: 'pkg-clientaccess',
  async collect({ perfmon }) {
    if (!perfmon || typeof perfmon.counterMulti !== 'function') return [];
    const paths = COUNTERS.map(([, p]) => p);
    let raw;
    try { raw = await perfmon.counterMulti(paths); } catch { return []; }
    const rows = [];
    for (const [metric, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (Number.isNaN(v)) continue;
      rows.push({ metric, value: v });
    }
    return rows;
  }
};
