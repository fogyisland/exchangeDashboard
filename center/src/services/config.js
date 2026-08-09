export async function getConfig(db, key) {
  const rows = await db.query('SELECT v FROM system_config WHERE k = ?', [key]);
  return rows && rows[0] ? rows[0].v : null;
}

export async function setConfig(db, key, value) {
  await db.query(
    'INSERT INTO system_config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [key, String(value)]
  );
}

export async function getAllConfig(db) {
  const rows = await db.query('SELECT k, v FROM system_config');
  const out = {};
  for (const r of rows || []) out[r.k] = r.v;
  return out;
}