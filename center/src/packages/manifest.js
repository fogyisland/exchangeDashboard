import Ajv from 'ajv';
import { PkgError } from './errors.js';

const RESERVED_TABLES = [
  'packages', 'package_runs', 'package_versions', 'users', 'agents',
  'servers', 'dags', 'dag_members', 'mdb_catalog', 'queue_snapshots',
  'mdb_copy_snapshots', 'service_states', 'client_access_snapshots',
  'server_resources', 'mailflow_summaries', 'mailflow_errors',
  'dag_replication_matrix', 'heartbeat_events', 'audit_log',
  'system_config', 'roles', 'user_roles', 'schema_migrations'
];

// Allowed column type vocabulary. Patterns use regex where parameters are allowed.
// Each entry is { exact: string } for parameterless types or { pattern: RegExp } for parameterized.
const COLUMN_TYPE_RULES = [
  { exact: 'text' },
  { exact: 'int' },
  { exact: 'integer' },
  { exact: 'bigint' },
  { exact: 'smallint' },
  { exact: 'tinyint' },
  { exact: 'double' },
  { exact: 'float' },
  { exact: 'datetime' },
  { exact: 'timestamp' },
  { exact: 'date' },
  { exact: 'boolean' },
  { exact: 'bit' },
  { exact: 'json' },
  { pattern: /^varchar\(\d+\)$/ },
  { pattern: /^char\(\d+\)$/ },
  { pattern: /^decimal\(\d+,\d+\)$/ },
  { pattern: /^numeric\(\d+,\d+\)$/ }
];

function isValidColumnType(t) {
  if (typeof t !== 'string') return false;
  return COLUMN_TYPE_RULES.some(rule =>
    (rule.exact !== undefined && rule.exact === t) ||
    (rule.pattern && rule.pattern.test(t))
  );
}

export const MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'version', 'type', 'database'],
  properties: {
    name: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,40}$' },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-[a-z0-9]+)?$' },
    description: { type: 'string' },
    author: { type: 'string' },
    type: { type: 'string', enum: ['gauge', 'counter', 'timeseries', 'status'] },
    database: {
      type: 'object',
      additionalProperties: false,
      required: ['metricTable', 'metricColumns'],
      properties: {
        metricTable: { type: 'string', pattern: '^[a-z][a-z0-9_]{2,40}$' },
        metricColumns: {
          type: 'object',
          additionalProperties: false,
          patternProperties: {
            '^[a-z_][a-z0-9_]*$': {
              type: 'object',
              additionalProperties: false,
              required: ['type'],
              properties: {
                type: { type: 'string' },
                nullable: { type: 'boolean' }
              }
            }
          }
        }
      }
    },
    agent: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intervalSec: { type: 'integer', minimum: 1 },
        timeoutMs: { type: 'integer', minimum: 1000 }
      }
    },
    dependencies: { type: 'array', items: { type: 'string' } }
  }
};

const ajv = new Ajv({ allErrors: true, strict: true });
const validateAjv = ajv.compile(MANIFEST_SCHEMA);

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new PkgError('PKG_INVALID_MANIFEST', 'manifest must be an object');
  }
  if (!validateAjv(manifest)) {
    throw new PkgError('PKG_INVALID_MANIFEST', 'manifest failed schema validation', 400, { ajvErrors: validateAjv.errors });
  }
  const tbl = manifest.database.metricTable.toLowerCase();
  if (RESERVED_TABLES.includes(tbl)) {
    throw new PkgError('PKG_INVALID_MANIFEST', `metricTable '${tbl}' is reserved`, 400, { field: 'database.metricTable' });
  }
  const cols = manifest.database.metricColumns;
  // Validate column type vocabulary
  for (const [colName, colDef] of Object.entries(cols)) {
    if (!isValidColumnType(colDef.type)) {
      throw new PkgError('PKG_INVALID_MANIFEST', `metricColumns.${colName}.type '${colDef.type}' is not in the allowed vocabulary`, 400, { field: `database.metricColumns.${colName}.type` });
    }
  }
  if (!cols.agent_id || cols.agent_id.type !== 'varchar(64)' || cols.agent_id.nullable === true) {
    throw new PkgError('PKG_INVALID_MANIFEST', 'metricColumns.agent_id must be varchar(64) NOT NULL', 400, { field: 'database.metricColumns.agent_id' });
  }
  if (!cols.ts || cols.ts.type !== 'datetime' || cols.ts.nullable === true) {
    throw new PkgError('PKG_INVALID_MANIFEST', 'metricColumns.ts must be datetime NOT NULL', 400, { field: 'database.metricColumns.ts' });
  }
  return { ok: true, value: JSON.parse(JSON.stringify(manifest)) };
}