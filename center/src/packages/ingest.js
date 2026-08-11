import { installedPackages, packageRuns } from './sql.js';
import { serverPackageInstalls } from './server-installs.js';

function schemaName(name) {
  return 'pkg_' + name.replace(/-/g, '_');
}

export const ingest = {
  async routeExtensions({ db, agentId, capturedAt, extensions = [], serverId = null }) {
    // Normalize capturedAt at the ingestion boundary. The agent sends an ISO
    // string via Date.toISOString(); collectors may pass a Date object. mysql2
    // auto-formats Date objects for DATETIME columns but rejects ISO strings
    // ("Incorrect datetime value: '2026-08-11T...'"). Coercing here keeps the
    // public API contract unchanged.
    const _raw = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
    const ts = Number.isNaN(_raw.getTime()) ? new Date() : _raw;
    const out = [];
    for (const ext of extensions) {
      const pkg = await installedPackages.get(db, ext.packageName);
      if (!pkg) {
        out.push({ packageName: ext.packageName, error: 'PKG_NOT_FOUND' });
        continue;
      }
      if (!pkg.enabled) {
        out.push({ packageName: ext.packageName, skipped: 'disabled' });
        continue;
      }
      const schema = schemaName(ext.packageName);
      // Use the installed manifest's metricTable, never the agent-supplied value.
      // Otherwise a malicious agent could target any table in the package schema.
      const installedTable = pkg.manifest.database.metricTable;
      if (ext.metricTable !== installedTable) {
        out.push({ packageName: ext.packageName, skipped: 'metricTable mismatch', error: 'METRIC_TABLE_MISMATCH' });
        continue;
      }
      const table = installedTable;
      const columns = Object.keys(pkg.manifest.database.metricColumns);
      const userCols = columns.filter((c) => c !== 'agent_id' && c !== 'ts');
      try {
        for (const row of ext.rows || []) {
          const values = userCols.map((c) => (row[c] === undefined ? null : row[c]));
          await db.query(
            `INSERT INTO \`${schema}\`.\`${table}\` (agent_id, ts, ${userCols.map((c) => `\`${c}\``).join(', ')}) VALUES (?, ?, ${userCols.map(() => '?').join(', ')})`,
            [agentId, ts, ...values]
          );
        }
        await packageRuns.record(db, { packageName: ext.packageName, ts, status: 'recorded', output: { rowCount: (ext.rows || []).length } });
        if (serverId) {
          await serverPackageInstalls.markInstalled(db, serverId, ext.packageName);
        }
        out.push({ packageName: ext.packageName, recorded: true, rowCount: (ext.rows || []).length });
      } catch (e) {
        out.push({ packageName: ext.packageName, error: e.message });
      }
    }
    return out;
  }
};
