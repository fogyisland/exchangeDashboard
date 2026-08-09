import { parseZip, cachePackage, removeCache } from './storage.js';
import { validateManifest } from './manifest.js';
import { scanSql } from './ddl-sandbox.js';
import { installedPackages, packageRuns, packageVersions } from './sql.js';
import { PkgError } from './errors.js';

function schemaName(name) {
  return 'pkg_' + name.replace(/-/g, '_');
}

function createSchemaSql(dbKind, schema) {
  if (dbKind === 'mssql') return `CREATE SCHEMA [${schema}]`;
  return `CREATE DATABASE \`${schema}\` DEFAULT CHARACTER SET utf8mb4`;
}

function dropSchemaSql(dbKind, schema) {
  if (dbKind === 'mssql') return `DROP SCHEMA [${schema}]`;
  return `DROP DATABASE \`${schema}\``;
}

function parseCreateTable(sql) {
  // Extract "<col1> <type> [<NOT NULL>]" tokens from a CREATE TABLE statement.
  const m = sql.match(/CREATE\s+TABLE\s+(?:`?[\w-]+`?\.)?`?([\w-]+)`?\s*\(([\s\S]*)\)\s*(?:ENGINE|DEFAULT|TABLE|;|$)/i);
  if (!m) return null;
  const body = m[2];
  const cols = {};
  for (const line of body.split(/,(?![^(]*\))/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const colName = parts[0].replace(/[`"\[\]]/g, '').toLowerCase();
    const colType = parts[1].replace(/[`"\[\]]/g, '');
    cols[colName] = { type: colType.toLowerCase(), nullable: !/NOT\s+NULL/i.test(line) };
  }
  return cols;
}

function compareColumns(sqlCols, manifestCols) {
  const sqlKeys = Object.keys(sqlCols).sort();
  const manKeys = Object.keys(manifestCols).sort();
  if (sqlKeys.length !== manKeys.length) return false;
  for (let i = 0; i < sqlKeys.length; i++) {
    if (sqlKeys[i] !== manKeys[i]) return false;
    const s = sqlCols[sqlKeys[i]].type.replace(/\s+/g, '');
    const m = manifestCols[manKeys[i]].type.replace(/\s+/g, '');
    if (s !== m) return false;
  }
  return true;
}

async function dropSchemaBestEffort(db, dbKind, schema, logger) {
  try {
    await db.query(dropSchemaSql(dbKind, schema));
  } catch (e) {
    if (logger) logger.warn({ err: e.message, schema }, 'DROP SCHEMA best-effort failed');
  }
}

export const installer = {
  async installPackage({ db, dbKind, cacheRoot, zipBuffer, logger }) {
    const parsed = parseZip(zipBuffer);
    const { value: manifest } = validateManifest(parsed.manifest);
    for (const m of parsed.migrations) {
      const r = scanSql(m.content);
      if (!r.ok) throw new PkgError('PKG_DDL_FORBIDDEN', `SQL blocked by sandbox: ${r.blocked}`, 400, { file: m.filename, pattern: r.blocked });
    }
    const initial = parsed.migrations.find((m) => m.filename === '001_initial.sql');
    if (!initial) throw new PkgError('PKG_INVALID_MANIFEST', 'migrations/001_initial.sql required');
    const sqlCols = parseCreateTable(initial.content);
    if (!sqlCols || !compareColumns(sqlCols, manifest.database.metricColumns)) {
      throw new PkgError('PKG_SCHEMA_MISMATCH', '001_initial.sql columns do not match manifest.database.metricColumns', 400, { manifest: Object.keys(manifest.database.metricColumns), sql: sqlCols ? Object.keys(sqlCols) : null });
    }
    const existing = await installedPackages.get(db, manifest.name);
    if (existing) {
      const cmp = compareVersions(existing.manifest?.version, manifest.version);
      if (cmp >= 0) throw new PkgError(existing.manifest?.version === manifest.version ? 'PKG_REINSTALL_BLOCKED' : 'PKG_DOWNGRADE_NOT_ALLOWED', `package ${manifest.name} already installed at ${existing.manifest?.version}`);
    }
    const schema = schemaName(manifest.name);
    try {
      await db.query(createSchemaSql(dbKind, schema));
      await db.query(
        dbKind === 'mssql'
          ? `CREATE TABLE [${schema}].[schema_migrations] (filename VARCHAR(255) NOT NULL PRIMARY KEY, version VARCHAR(32) NOT NULL, applied_at DATETIME NOT NULL DEFAULT GETDATE())`
          : `CREATE TABLE \`${schema}\`.\`schema_migrations\` (filename VARCHAR(255) NOT NULL PRIMARY KEY, version VARCHAR(32) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`
      );
      for (const m of parsed.migrations) {
        try {
          // LIMITATION: with connection pooling, each pool member has its own
          // default database. `USE` only affects the connection that runs it.
          // For production with pooled DB connections, package migrations
          // should fully qualify table names (e.g. `pkg_demo.demo_metrics`).
          if (dbKind !== 'mssql') {
            await db.query(`USE \`${schema}\``);
          }
          await db.query(m.content);
        } catch (e) {
          await dropSchemaBestEffort(db, dbKind, schema, logger);
          throw new PkgError('PKG_INSTALL_FAILED', `migration ${m.filename} failed: ${e.message}`, 500, { file: m.filename });
        }
        await db.query(`INSERT INTO \`${schema}\`.\`schema_migrations\` (filename, version) VALUES (?, ?)`, [m.filename, manifest.version]);
      }
      await installedPackages.upsert(db, { name: manifest.name, type: manifest.type, manifest, enabled: 1, installedAt: new Date() });
      await packageVersions.upsert(db, { packageName: manifest.name, version: manifest.version, installedAt: new Date() });
      await packageRuns.record(db, { packageName: manifest.name, status: 'installed', output: { version: manifest.version } });
      await cachePackage({ cacheRoot, name: manifest.name, version: manifest.version, manifest: parsed.manifest, collectorJs: parsed.collectorJs, migrations: parsed.migrations });
      return { name: manifest.name, version: manifest.version };
    } catch (e) {
      if (!(e instanceof PkgError)) {
        await dropSchemaBestEffort(db, dbKind, schema, logger);
        throw new PkgError('PKG_INSTALL_FAILED', e.message, 500);
      }
      throw e;
    }
  },
  async uninstallPackage({ db, dbKind, cacheRoot, name, confirmDropSchema, logger }) {
    if (!confirmDropSchema) throw new PkgError('PKG_CONFIRM_REQUIRED', 'uninstall requires confirmDropSchema=true');
    const existing = await installedPackages.get(db, name);
    if (!existing) throw new PkgError('PKG_NOT_FOUND', `package ${name} not installed`);
    const schema = schemaName(name);
    try {
      await db.query(dropSchemaSql(dbKind, schema));
    } catch (e) {
      if (logger) logger.warn({ err: e.message, schema }, 'DROP SCHEMA failed — continuing uninstall');
      await packageRuns.record(db, { packageName: name, status: 'uninstall-drop-failed', output: { error: e.message } });
    }
    try {
      await installedPackages.delete(db, name);
      await packageVersions.delete(db, name);
      await packageRuns.record(db, { packageName: name, status: 'uninstalled' });
      await removeCache(cacheRoot, name);
      return { ok: true };
    } catch (e) {
      throw new PkgError('PKG_UNINSTALL_FAILED', e.message, 500);
    }
  }
};

function compareVersions(a, b) {
  // Returns a-b semver-style (positive if a > b). Accepts '1.0.0-alpha'.
  const parse = (v) => String(v).split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [aa, bb] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0, y = bb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x - y; }
    else if (typeof x === 'number') return 1;
    else if (typeof y === 'number') return -1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}