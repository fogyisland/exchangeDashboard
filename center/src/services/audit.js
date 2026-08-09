export async function writeAudit(db, { userId = null, action, target = null, details = null }) {
  await db.query(
    'INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)',
    [userId, action, target, details ? JSON.stringify(details) : null]
  );
}
