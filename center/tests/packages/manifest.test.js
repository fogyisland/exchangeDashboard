import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, MANIFEST_SCHEMA } from '../../src/packages/manifest.js';
import { PkgError } from '../../src/packages/errors.js';

const validManifest = {
  name: 'exchange-transport-log-monitor',
  version: '1.0.0',
  description: 'Tracks stuck messages in transport logs',
  type: 'timeseries',
  database: {
    metricTable: 'transport_log_metrics',
    metricColumns: {
      agent_id: { type: 'varchar(64)', nullable: false },
      ts: { type: 'datetime', nullable: false },
      stuck_count: { type: 'int', nullable: false },
      oldest_age_seconds: { type: 'int', nullable: true }
    }
  },
  agent: { intervalSec: 60, timeoutMs: 30000 },
  dependencies: []
};

test('validateManifest accepts a complete valid manifest', () => {
  const r = validateManifest(validManifest);
  assert.equal(r.ok, true);
  assert.ok(r.value);
  assert.equal(r.value.name, 'exchange-transport-log-monitor');
});

test('validateManifest rejects name with uppercase letters', () => {
  const m = { ...validManifest, name: 'ExchangeMonitor' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_MANIFEST');
});

test('validateManifest rejects name shorter than 3 chars', () => {
  const m = { ...validManifest, name: 'ab' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_MANIFEST');
});

test('validateManifest rejects name starting with a digit', () => {
  const m = { ...validManifest, name: '1abc' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError && e.code === 'PKG_INVALID_MANIFEST');
});

test('validateManifest rejects invalid semver', () => {
  const m = { ...validManifest, version: 'not-a-version' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest accepts pre-release semver', () => {
  const m = { ...validManifest, version: '1.0.0-alpha' };
  const r = validateManifest(m);
  assert.equal(r.ok, true);
});

test('validateManifest rejects unknown type', () => {
  const m = { ...validManifest, type: 'bogus' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects missing agent_id column', () => {
  const m = {
    ...validManifest,
    database: { ...validManifest.database, metricColumns: { ts: { type: 'datetime', nullable: false } } }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects missing ts column', () => {
  const m = {
    ...validManifest,
    database: { ...validManifest.database, metricColumns: { agent_id: { type: 'varchar(64)', nullable: false } } }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects wrong agent_id type (must be varchar(64))', () => {
  const m = {
    ...validManifest,
    database: {
      ...validManifest.database,
      metricColumns: {
        ...validManifest.database.metricColumns,
        agent_id: { type: 'int', nullable: false }
      }
    }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects wrong ts type (must be datetime)', () => {
  const m = {
    ...validManifest,
    database: {
      ...validManifest.database,
      metricColumns: {
        ...validManifest.database.metricColumns,
        ts: { type: 'varchar(64)', nullable: false }
      }
    }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects unknown column type vocabulary', () => {
  const m = {
    ...validManifest,
    database: {
      ...validManifest.database,
      metricColumns: {
        ...validManifest.database.metricColumns,
        weird_col: { type: 'uuid', nullable: true }
      }
    }
  };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects reserved metricTable names', () => {
  const m = { ...validManifest, database: { ...validManifest.database, metricTable: 'users' } };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects metricTable with reserved-table name (case insensitive)', () => {
  const m = { ...validManifest, database: { ...validManifest.database, metricTable: 'USERS' } };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('validateManifest rejects additionalProperties (ajv strict)', () => {
  const m = { ...validManifest, extraField: 'should-fail' };
  assert.throws(() => validateManifest(m), (e) => e instanceof PkgError);
});

test('MANIFEST_SCHEMA is exported and has $schema + type=object', () => {
  assert.ok(MANIFEST_SCHEMA);
  assert.equal(MANIFEST_SCHEMA.type, 'object');
  assert.equal(MANIFEST_SCHEMA.additionalProperties, false);
});