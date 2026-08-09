import { getOfflineAgents } from './heartbeat-report.js';

// TODO: For SQL Server use `DATEADD(DAY, -?, GETDATE())`. v1 supports mysql.
async function purgeOld(db, days, table) {
  await db.query(
    `DELETE FROM ${table} WHERE captured_at < (NOW() - INTERVAL ? DAY)`,
    [days]
  );
}

async function runOnce({ db, logger, staleSeconds, retention }) {
  try {
    const stale = await getOfflineAgents(db, staleSeconds);
    if (stale && stale.length) logger.warn({ count: stale.length }, 'agents stale');
    if (retention) {
      await purgeOld(db, retention.queueDays, 'queue_snapshots');
      await purgeOld(db, retention.mdbDays, 'mdb_copy_snapshots');
      await purgeOld(db, retention.serviceDays, 'service_states');
      await purgeOld(db, retention.queueDays, 'client_access_snapshots');
      await purgeOld(db, retention.queueDays, 'server_resources');
    }
  } catch (e) {
    logger.error({ err: e.message }, 'probe loop error');
  }
}

export function createProbeLoop({ db, logger, intervalMs = 3600_000, staleSeconds = 90, retention = { queueDays: 7, mdbDays: 7, serviceDays: 30 } } = {}) {
  let stopped = false;
  const handle = setInterval(() => { if (!stopped) runOnce({ db, logger, staleSeconds, retention }); }, intervalMs);
  return {
    tick: () => runOnce({ db, logger, staleSeconds, retention }),
    stop: () => { stopped = true; clearInterval(handle); }
  };
}
