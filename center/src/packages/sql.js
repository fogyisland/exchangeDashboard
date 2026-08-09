const TABLES_READY = Symbol('tablesReady');

export const installedPackages = {
  async get(db, name) {
    const rows = await db.query('SELECT name, type, manifest, enabled, installed_at FROM packages WHERE name = ?', [name]);
    if (!rows.length) return null;
    const r = rows[0];
    return { name: r.name, type: r.type, manifest: JSON.parse(r.manifest), enabled: r.enabled, installedAt: r.installed_at };
  },
  async upsert(db, { name, type, manifest, enabled = 1, installedAt = new Date() }) {
    await db.query(
      'INSERT INTO packages (name, type, manifest, enabled, installed_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE type = VALUES(type), manifest = VALUES(manifest), enabled = VALUES(enabled), installed_at = VALUES(installed_at)',
      [name, type, JSON.stringify(manifest), enabled, installedAt]
    );
  },
  async delete(db, name) {
    await db.query('DELETE FROM packages WHERE name = ?', [name]);
  },
  async list(db) {
    const rows = await db.query('SELECT name, type, manifest, enabled, installed_at FROM packages ORDER BY installed_at DESC');
    return rows.map((r) => ({ name: r.name, type: r.type, manifest: JSON.parse(r.manifest), enabled: r.enabled, installedAt: r.installed_at }));
  }
};

export const packageRuns = {
  async record(db, { packageName, ts = new Date(), status, output = null }) {
    await db.query(
      'INSERT INTO package_runs (package_name, ts, status, output) VALUES (?, ?, ?, ?)',
      [packageName, ts, status, output == null ? null : JSON.stringify(output)]
    );
  }
};

export const packageVersions = {
  async upsert(db, { packageName, version, installedAt = new Date() }) {
    await db.query(
      'INSERT INTO package_versions (package_name, version, installed_at) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE installed_at = VALUES(installed_at)',
      [packageName, version, installedAt]
    );
  },
  async delete(db, packageName) {
    await db.query('DELETE FROM package_versions WHERE package_name = ?', [packageName]);
  }
};