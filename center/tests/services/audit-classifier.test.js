import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../src/services/audit-classifier.js';

test('login → auth', () => { assert.equal(classify({ action: 'login' }), 'auth'); });
test('users.create → admin', () => { assert.equal(classify({ action: 'users.create' }), 'admin'); });
test('config.update → config', () => { assert.equal(classify({ action: 'config.update', target: 'system' }), 'config'); });
test('queues.delete → data', () => { assert.equal(classify({ action: 'queues.delete' }), 'data'); });
test('unknown → unknown', () => { assert.equal(classify({ action: 'frobnicate' }), 'unknown'); });
