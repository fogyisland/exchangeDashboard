import { installedPackages, packageRuns } from './sql.js';

function schemaName(name) {
  return 'pkg_' + name.replace(/-/g, '_');
}

export const ingest = {
  async routeExtensions({ db, agentId, capturedAt, extensions = [] }) {
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
      for (const row of ext.rows || []) {
        const values = userCols.map((c) => (row[c] === undefined ? null : row[c]));
        await db.query(
          `INSERT INTO \`${schema}\`.\`${table}\` (agent_id, ts, ${userCols.map((c) => `\`${c}\``).join(', ')}) VALUES (?, ?, ${userCols.map(() => '?').join(', ')})`,
          [agentId, capturedAt, ...values]
        );
      }
      await packageRuns.record(db, { packageName: ext.packageName, ts: capturedAt, status: 'recorded', output: { rowCount: (ext.rows || []).length } });
      out.push({ packageName: ext.packageName, recorded: true, rowCount: (ext.rows || []).length });
    }
    return out;
  }
};
