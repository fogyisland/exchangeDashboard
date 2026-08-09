import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limit, now, quoteIdent } from '../../src/db/sql.js';

test('limit mysql uses LIMIT', () => {
  assert.equal(limit('mysql', 10), 'LIMIT 10');
});

test('limit mssql uses TOP', () => {
  assert.equal(limit('mssql', 10), 'TOP 10');
});

test('now mysql is NOW()', () => {
  assert.equal(now('mysql'), 'NOW()');
});

test('now mssql is GETDATE()', () => {
  assert.equal(now('mssql'), 'GETDATE()');
});

test('quoteIdent wraps and escapes', () => {
  assert.equal(quoteIdent('weird]name', 'mysql'), '`weird]name`');
  assert.equal(quoteIdent('weird]name', 'mssql'), '[weird]]name]');
});
