// Combined validation: schema validation + installer column check for all 5 built-in ZIPs
import AdmZip from 'adm-zip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../src/packages/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZIP_DIR = path.join(__dirname, '..', 'src/packages/built-in');

// Re-implement the installer's parseCreateTable + compareColumns verbatim so we
// verify against the exact logic the installer uses at runtime.
function parseCreateTable(sql) {
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

const names = ['pkg-mailflow', 'pkg-dag', 'pkg-services', 'pkg-clientaccess', 'pkg-perfmon'];

let pass = 0, fail = 0;
for (const n of names) {
  const zipPath = path.join(ZIP_DIR, `${n}-1.0.0.zip`);
  const z = new AdmZip(zipPath);
  const manifestRaw = z.getEntry('manifest.json').getData().toString('utf8');
  const sqlEntry = z.getEntry('migrations/001_initial.sql');
  const sql = sqlEntry ? sqlEntry.getData().toString('utf8') : null;
  const errors = [];

  // 1. Schema validation
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
    validateManifest(manifest);
  } catch (e) {
    errors.push(`schema: ${e.message}`);
  }

  // 2. Installer column check
  if (manifest) {
    const sqlCols = parseCreateTable(sql);
    if (!sqlCols) {
      errors.push('installer: parseCreateTable returned null');
    } else if (!compareColumns(sqlCols, manifest.database.metricColumns)) {
      errors.push(`installer: column mismatch\n    sql: ${Object.keys(sqlCols).sort().join(',')}\n    man: ${Object.keys(manifest.database.metricColumns).sort().join(',')}`);
    }
  }

  const status = errors.length === 0 ? 'OK' : 'FAIL';
  if (errors.length === 0) pass++; else fail++;
  console.log(`${status} ${n}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
