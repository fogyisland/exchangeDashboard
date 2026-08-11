function downloadUrlFor(packageName) {
  return `/api/admin/catalog/${encodeURIComponent(packageName)}/zip`;
}

export const serverPackageInstalls = {
  async assign(db, { serverId, packageName, version }) {
    await db.query(
      'INSERT INTO server_package_installs (server_id, package_name, version, status) VALUES (?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE version = VALUES(version), status = IF(status = "installed", "installed", "pending"), error = NULL',
      [serverId, packageName, version, 'pending']
    );
  },
  async pendingFor(db, serverId) {
    const rows = await db.query(
      'SELECT package_name, version FROM server_package_installs WHERE server_id = ? AND status = ?',
      [serverId, 'pending']
    );
    return rows.map((r) => ({ name: r.package_name, version: r.version, downloadUrl: downloadUrlFor(r.package_name) }));
  },
  async listByServer(db, serverId) {
    const rows = await db.query(
      'SELECT package_name, version, status, error, updated_at FROM server_package_installs WHERE server_id = ? ORDER BY package_name',
      [serverId]
    );
    return rows.map((r) => ({ name: r.package_name, version: r.version, status: r.status, error: r.error, updatedAt: r.updated_at }));
  },
  async listAll(db) {
    const rows = await db.query(
      'SELECT server_id, package_name, version, status, error, updated_at FROM server_package_installs ORDER BY server_id, package_name'
    );
    return rows.map((r) => ({ serverId: r.server_id, name: r.package_name, version: r.version, status: r.status, error: r.error, updatedAt: r.updated_at }));
  },
  async markInstalled(db, serverId, packageName) {
    await db.query(
      'UPDATE server_package_installs SET status = ?, error = NULL WHERE server_id = ? AND package_name = ? AND status = ?',
      ['installed', serverId, packageName, 'pending']
    );
  },
  async markFailed(db, serverId, packageName, error) {
    await db.query(
      'UPDATE server_package_installs SET status = ?, error = ? WHERE server_id = ? AND package_name = ?',
      ['failed', String(error).slice(0, 1000), serverId, packageName]
    );
  }
};
