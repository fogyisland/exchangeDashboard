import fs from 'node:fs';
import path from 'node:path';

export async function getCurrentVersion(db) {
  const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  return rows && rows[0] ? rows[0].version : null;
}

export async function listApplied(db) {
  const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version ASC');
  return (rows || []).map((r) => r.version);
}

export async function listPending(dir, applied) {
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const set = new Set(applied);
  return all.filter((f) => !set.has(f));
}

export async function applyPendingMigrations(db, dir) {
  const applied = await listApplied(db);
  const pending = await listPending(dir, applied);
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const stmts = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await db.query(stmt);
    }
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [file.replace(/\.sql$/, '')]);
  }
  return pending.length;
}