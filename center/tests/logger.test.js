import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';

test('createLogger returns a pino-like logger with required methods', () => {
  const log = createLogger({ component: 'test', level: 'silent' });
  for (const m of ['info', 'warn', 'error', 'fatal', 'debug']) {
    assert.equal(typeof log[m], 'function', `expected log.${m} to be a function`);
  }
  assert.equal(typeof log.child, 'function');
});
