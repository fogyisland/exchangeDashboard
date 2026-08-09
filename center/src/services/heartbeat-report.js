// NOTE: This query is mysql-specific. The SQL Server variant is
// `DATEADD(SECOND, -?, GETDATE())`. A future task will branch on dbKind.
export async function getOfflineAgents(db, staleSeconds) {
  return await db.query(
    `SELECT agent_id, hostname, last_heartbeat_at
     FROM agents
     WHERE enabled = 1 AND (last_heartbeat_at IS NULL OR last_heartbeat_at < (NOW() - INTERVAL ? SECOND))`,
    [staleSeconds]
  );
}
