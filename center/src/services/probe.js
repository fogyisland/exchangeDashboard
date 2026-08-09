import { getOfflineAgents } from './heartbeat-report.js';

export function createProbeLoop({ db, logger, intervalMs = 60_000, staleSeconds = 90 }) {
  const handle = setInterval(async () => {
    try {
      const stale = await getOfflineAgents(db, staleSeconds);
      if (stale && stale.length) {
        logger.warn({ count: stale.length }, 'agents stale');
      }
    } catch (e) {
      logger.error({ err: e.message }, 'probe loop error');
    }
  }, intervalMs);
  return { stop: () => clearInterval(handle) };
}
