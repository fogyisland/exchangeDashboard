// Ported from agent/src/mailflow-collector.js
const COUNTERS = [
  ['ActiveMailboxDelivery', '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length'],
  ['Poison', '\\MSExchangeTransport Queues(_total)\\Poison Queue Length'],
  ['Retry', '\\MSExchangeTransport Queues(_total)\\Retry Queue Length'],
  ['Submission', '\\MSExchangeTransport Submission Queue(_total)\\Submission Queue Length']
];

export default {
  name: 'pkg-mailflow',
  async collect({ perfmon }) {
    if (!perfmon || typeof perfmon.counterMulti !== 'function') return [];
    const paths = COUNTERS.map(([, p]) => p);
    let raw;
    try { raw = await perfmon.counterMulti(paths); } catch { return []; }
    const mpsPath = '\\MSExchangeTransport Queues(_total)\\Messages Queued Per Second';
    const dpsPath = '\\MSExchangeTransport Queues(_total)\\Deferred Messages Per Second';
    const mps = Number(raw[mpsPath]); const dps = Number(raw[dpsPath]);
    const rows = [];
    for (const [kind, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (Number.isNaN(v)) continue;
      rows.push({
        queue_kind: kind,
        queue_name: kind,
        message_count: v,
        messages_per_sec: Number.isNaN(mps) ? null : mps,
        deferred_per_sec: Number.isNaN(dps) ? null : dps
      });
    }
    return rows;
  }
};
