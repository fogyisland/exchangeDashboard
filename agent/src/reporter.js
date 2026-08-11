import { urlFor } from './url.js';

export function startReporter({ config, logger, packageRunner, getCtx }) {
  let stopped = false;
  const reportUrl = urlFor(config.center.baseUrl, config.center.reportPort, config.center.reportPath || '/api/agent/report');
  const tick = async () => {
    if (stopped) return;
    try {
      const capturedAt = new Date().toISOString();
      const ctx = await getCtx();
      const extensions = [];
      for (const pkg of packageRunner.listLoaded()) {
        try {
          const result = await packageRunner.invoke(pkg.name, ctx);
          // Collectors return either an array of rows or { rows: [...] }; normalize.
          const rows = (result && result.rows) || result || [];
          extensions.push({ packageName: pkg.name, metricTable: pkg.metricTable, rows });
        } catch (e) {
          logger.warn({ pkg: pkg.name, err: e.message }, 'package collect failed');
        }
      }
      const res = await fetch(reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: config.agentId, hostname: ctx.hostname, capturedAt, extensions }),
        signal: AbortSignal.timeout(config.center.requestTimeoutMs || 30000)
      });
      if (!res.ok) logger.warn({ status: res.status }, 'report non-2xx');
    } catch (e) {
      logger.warn({ err: e.message }, 'report failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.reportIntervalMs || 60000);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}