import { urlFor } from './url.js';

export function startHeartbeat({ config, logger, getSummary, packageRunner }) {
  let stopped = false;
  const url = urlFor(config.center.baseUrl, config.center.heartbeatPort, config.center.heartbeatPath);
  const tick = async () => {
    if (stopped) return;
    try {
      const installed = packageRunner ? await packageRunner.readInstalledSnapshot() : [];
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: config.agentId,
          hostname: getSummary().hostname,
          ts: new Date().toISOString(),
          summary: getSummary(),
          installedPackages: installed.map((p) => p.name)
        }),
        signal: AbortSignal.timeout(config.center.requestTimeoutMs || 10000)
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'heartbeat non-2xx');
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.pendingInstalls && packageRunner) {
        await packageRunner.reconcile(body.pendingInstalls, null);
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'heartbeat failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.heartbeatIntervalMs);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}