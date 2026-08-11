// Combines perfmon HUB queue counters with Get-Queue's oldest message age.
const COUNTERS = [
  ['ActiveMailboxDelivery', '\\MSExchangeTransport Queues(_total)\\Active Mailbox Delivery Queue Length'],
  ['Retry', '\\MSExchangeTransport Queues(_total)\\Retry Queue Length'],
  ['Poison', '\\MSExchangeTransport Queues(_total)\\Poison Queue Length'],
  ['Submission', '\\MSExchangeTransport Submission Queue(_total)\\Submission Queue Length']
];

export default {
  name: 'pkg-hub-backpressure',
  async collect({ perfmon, execFile }) {
    const out = [];
    if (perfmon && typeof perfmon.counterMulti === 'function') {
      const paths = COUNTERS.map(([, p]) => p);
      let raw;
      try { raw = await perfmon.counterMulti(paths); } catch { raw = {}; }
      for (const [kind, p] of COUNTERS) {
        const v = Number(raw[p]);
        if (Number.isNaN(v)) continue;
        out.push({ queue_kind: kind, current_depth: v });
      }
    }
    // Augment with age of oldest via Get-Queue on Windows
    if (execFile && process.platform === 'win32') {
      const { execFile: ef } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const pexec = promisify(ef);
      const ps = `
        $ErrorActionPreference = 'SilentlyContinue'
        Get-Queue | Select-Object QueueType,
                              @{N='Depth';E={$_.MessageCount}},
                              @{N='OldestMin';E={[int]([DateTime]::Now - $_.OldestMessage).TotalMinutes}} |
          ConvertTo-Json -Compress
      `;
      try {
        const r = await pexec('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
        const arr = JSON.parse(r.stdout);
        const list = Array.isArray(arr) ? arr : [arr];
        for (const q of list) {
          if (!q || !q.QueueType) continue;
          const kind = String(q.QueueType);
          const existing = out.find((o) => o.queue_kind === kind);
          const oldest = Number(q.OldestMin);
          if (existing) {
            if (Number.isFinite(oldest)) existing.age_oldest_min = Math.max(0, oldest);
          } else {
            out.push({ queue_kind: kind, current_depth: Number(q.Depth) || 0, age_oldest_min: Number.isFinite(oldest) ? Math.max(0, oldest) : null });
          }
        }
      } catch {}
    }
    return out;
  }
};