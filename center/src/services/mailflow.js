export async function getCurrentQueues(db, { serverId } = {}) {
  // Latest snapshot per (server_id, queue_kind)
  const sql = `
    SELECT qs.*
    FROM queue_snapshots qs
    JOIN (
      SELECT server_id, queue_kind, MAX(captured_at) AS max_at
      FROM queue_snapshots
      GROUP BY server_id, queue_kind
    ) latest
    ON qs.server_id = latest.server_id AND qs.queue_kind = latest.queue_kind AND qs.captured_at = latest.max_at
    ${serverId ? 'WHERE qs.server_id = ?' : ''}
    ORDER BY qs.server_id, qs.queue_kind
  `;
  return await db.query(sql, serverId ? [serverId] : []);
}

export async function getQueueHistory(db, { serverId, queueKind, from, to }) {
  return await db.query(
    `SELECT captured_at, queue_kind, message_count
     FROM queue_snapshots
     WHERE server_id = ? AND queue_kind = ? AND captured_at BETWEEN ? AND ?
     ORDER BY captured_at ASC`,
    [serverId, queueKind, from, to]
  );
}

export async function getStuckMessages(db) {
  return await db.query(
    `SELECT *
     FROM queue_snapshots
     WHERE queue_kind IN ('Poison','Retry') OR (queue_kind = 'ActiveMailboxDelivery' AND message_count > 1000)
     ORDER BY captured_at DESC
     LIMIT 100`
  );
}
