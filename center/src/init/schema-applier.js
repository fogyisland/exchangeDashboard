import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, '../../../db/schema');

export function listMigrations() {
  return fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.sql')).sort();
}

export async function applySchema(db, dbKind) {
  for (const file of listMigrations()) {
    const sql = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
    const stmts = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await db.query(stmt);
    }
  }
}