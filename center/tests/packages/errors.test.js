import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PkgError, ERROR_CODES } from '../../src/packages/errors.js';

test('PkgError carries code, message, httpStatus, details', () => {
  const e = new PkgError('PKG_DDL_FORBIDDEN', 'bad sql', 400, { file: '001.sql' });
  assert.equal(e.code, 'PKG_DDL_FORBIDDEN');
  assert.equal(e.message, 'bad sql');
  assert.equal(e.httpStatus, 400);
  assert.deepEqual(e.details, { file: '001.sql' });
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'PkgError');
});

test('PkgError defaults httpStatus to 400 and details to null', () => {
  const e = new PkgError('PKG_NOT_FOUND', 'gone');
  assert.equal(e.httpStatus, 400);
  assert.equal(e.details, null);
});

test('ERROR_CODES has 14 entries with numeric statuses', () => {
  assert.equal(Object.keys(ERROR_CODES).length, 14);
  for (const [code, status] of Object.entries(ERROR_CODES)) {
    assert.match(code, /^PKG_[A-Z_]+$/);
    assert.equal(typeof status, 'number');
    assert.ok(status >= 400 && status < 600);
  }
});

test('ERROR_CODES includes all spec codes', () => {
  const expected = [
    'PKG_INVALID_ZIP', 'PKG_INVALID_MANIFEST', 'PKG_NAME_CONFLICT',
    'PKG_REINSTALL_BLOCKED', 'PKG_DOWNGRADE_NOT_ALLOWED',
    'PKG_DDL_FORBIDDEN', 'PKG_SCHEMA_MISMATCH', 'PKG_INSTALL_FAILED',
    'PKG_UNINSTALL_FAILED', 'PKG_CONFIRM_REQUIRED', 'PKG_NOT_FOUND',
    'PKG_METRIC_KEY_UNKNOWN', 'PKG_METRIC_TYPE_MISMATCH', 'PKG_TIMEOUT'
  ];
  for (const c of expected) {
    assert.ok(ERROR_CODES[c], `missing ${c}`);
  }
});