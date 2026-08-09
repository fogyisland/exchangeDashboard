// agent/src/mailflow-collector.js
const COUNTERS = [
  ['ActiveMailboxDelivery', '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length'],
  ['Poison',                '\\MSExchangeTransport Queues(_total)\\Poison Queue Length'],
  ['Retry',                 '\\MSExchangeTransport Queues(_total)\\Retry Queue Length'],
  ['Submission',            '\\MSExchangeTransport Submission Queue(_total)\\Submission Queue Length'],
  ['MessagesQueuedPerSec',  '\\MSExchangeTransport Queues(_total)\\Messages Queued Per Second'],
  ['MessagesCompletedPerSec','\\MSExchangeTransport Queues(_total)\\Messages Completed Per Second'],
  ['DeferredPerSec',        '\\MSExchangeTransport Queues(_total)\\Deferred Messages Per Second']
];

export class MailflowCollector {
  constructor(perfmon) { this.perfmon = perfmon; }
  async collect() {
    const paths = COUNTERS.map(([, p]) => p);
    const raw = await this.perfmon.counterMulti(paths);
    const now = new Date().toISOString();
    const rows = [];
    for (const [kind, path] of COUNTERS) {
      const v = Number(raw[path]);
      if (Number.isNaN(v)) continue;
      if (kind.endsWith('PerSec')) continue; // attach as ancillary, not own snapshot
      const anc = {};
      const mq = Number(raw[COUNTERS[4][1]]); if (!Number.isNaN(mq)) anc.messages_per_sec = mq;
      const md = Number(raw[COUNTERS[6][1]]); if (!Number.isNaN(md)) anc.deferred_per_sec = md;
      rows.push({ captured_at: now, queue_kind: kind, queue_name: kind, message_count: v, ...anc });
    }
    return rows;
  }
}
