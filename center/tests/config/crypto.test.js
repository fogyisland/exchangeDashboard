import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { isEncrypted, encryptString, decryptString, loadOrCreateKey } from '../../src/config-crypto.js';

const KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

test('isEncrypted detects enc:v1: prefix', () => {
  assert.equal(isEncrypted('hello'), false);
  assert.equal(isEncrypted(''), false);
  assert.equal(isEncrypted('enc:v1:deadbeef:00:00'), true);
});

test('encryptString + decryptString roundtrip preserves plaintext', () => {
  const ct = encryptString('super-secret', KEY);
  assert.equal(isEncrypted(ct), true);
  assert.equal(decryptString(ct, KEY), 'super-secret');
});

test('encryptString produces different ciphertext on each call (random IV)', () => {
  const a = encryptString('same', KEY);
  const b = encryptString('same', KEY);
  assert.notEqual(a, b);
  assert.equal(decryptString(a, KEY), 'same');
  assert.equal(decryptString(b, KEY), 'same');
});

test('decryptString accepts plaintext unchanged (idempotent for in-flight migration)', () => {
  assert.equal(decryptString('plain-text-value', KEY), 'plain-text-value');
  assert.equal(decryptString('', KEY), '');
});

test('decryptString throws SECRET_KEY_MISMATCH on wrong key', () => {
  const ct = encryptString('payload', KEY);
  const wrongKey = 'b'.repeat(64);
  assert.throws(() => decryptString(ct, wrongKey), /SECRET_KEY_MISMATCH/);
});

test('decryptString throws on tampered ciphertext (GCM tag mismatch)', () => {
  const ct = encryptString('payload', KEY);
  // Flip a hex char in the ciphertext portion.
  const parts = ct.split(':');
  const ctHex = parts[3];
  const tampered = ctHex.slice(0, -1) + (ctHex.slice(-1) === '0' ? '1' : '0');
  parts[3] = tampered;
  const bad = parts.join(':');
  assert.throws(() => decryptString(bad, KEY));
});

test('decryptString throws on malformed enc:v1: prefix', () => {
  assert.throws(() => decryptString('enc:v1:only-three-parts', KEY));
});

test('loadOrCreateKey generates new key + writes .env when missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-'));
  const envPath = path.join(dir, '.env');
  const out = await loadOrCreateKey(envPath);
  assert.equal(out.created, true);
  assert.match(out.key, /^[0-9a-f]{64}$/);
  const written = await fs.readFile(envPath, 'utf8');
  assert.match(written, /^EXDASHBOARD_SECRET_KEY=[0-9a-f]{64}$/m);
});

test('loadOrCreateKey preserves existing marker lines when creating key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-'));
  const envPath = path.join(dir, '.env');
  await fs.writeFile(envPath, 'EXDASHBOARD_INITIALIZED=1\nSOMETHING=else\n');
  const out = await loadOrCreateKey(envPath);
  assert.equal(out.created, true);
  const written = await fs.readFile(envPath, 'utf8');
  assert.match(written, /^EXDASHBOARD_INITIALIZED=1$/m);
  assert.match(written, /^SOMETHING=else$/m);
  assert.match(written, /^EXDASHBOARD_SECRET_KEY=[0-9a-f]{64}$/m);
});

test('loadOrCreateKey reuses existing key on subsequent calls', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-'));
  const envPath = path.join(dir, '.env');
  const first = await loadOrCreateKey(envPath);
  const second = await loadOrCreateKey(envPath);
  assert.equal(second.created, false);
  assert.equal(second.key, first.key);
});

test('loadOrCreateKey round-trips through encryptString / decryptString', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-'));
  const envPath = path.join(dir, '.env');
  const { key } = await loadOrCreateKey(envPath);
  const ct = encryptString('the quick brown fox', key);
  assert.equal(decryptString(ct, key), 'the quick brown fox');
});
