import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DbError, UniqueViolation, NotFound } from '../../src/db/errors.js';

test('DbError carries code and message', () => {
  const e = new DbError('CODE_X', 'msg', { foo: 1 });
  assert.equal(e.code, 'CODE_X');
  assert.equal(e.message, 'msg');
  assert.deepEqual(e.details, { foo: 1 });
  assert.ok(e instanceof Error);
});

test('UniqueViolation and NotFound are DbErrors', () => {
  assert.ok(new UniqueViolation('dup') instanceof DbError);
  assert.ok(new NotFound('nope') instanceof DbError);
});
