import Database from 'better-sqlite3';

export class LocalQueue {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
    this._insert = this.db.prepare('INSERT INTO items (payload, created_at) VALUES (?, ?)');
    this._delete = this.db.prepare('DELETE FROM items WHERE id = ?');
    this._list = this.db.prepare('SELECT id, payload, attempts, next_attempt_at FROM items WHERE next_attempt_at <= ? ORDER BY id ASC');
    this._bump = this.db.prepare('UPDATE items SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?');
  }

  async enqueue(payload) {
    this._insert.run(JSON.stringify(payload), Date.now());
  }

  async dequeueAll(now = Date.now()) {
    const rows = this._list.all(now);
    for (const r of rows) this._delete.run(r.id);
    return rows.map((r) => ({ id: r.id, attempts: r.attempts, ...JSON.parse(r.payload) }));
  }

  async remove(id) { this._delete.run(id); }
  async bump(id, nextAttemptAt) { this._bump.run(nextAttemptAt, id); }
  length() { return this.db.prepare('SELECT COUNT(*) AS n FROM items').get().n; }
  close() { this.db.close(); }
}