import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function isValidHex(s, bytes) {
  return typeof s === 'string' && s.length === bytes * 2 && /^[0-9a-f]+$/i.test(s);
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function deriveKey(keyHex) {
  if (!isValidHex(keyHex, KEY_BYTES)) {
    throw new Error('SECRET_KEY_MISMATCH — EXDASHBOARD_SECRET_KEY must be 64 hex chars');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encryptString(plaintext, keyHex) {
  const key = deriveKey(keyHex);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptString(token, keyHex) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) return token;
  const parts = token.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('SECRET_KEY_MISMATCH — malformed encrypted value');
  const [ivHex, ctHex, tagHex] = parts;
  if (!isValidHex(ivHex, IV_BYTES) || !isValidHex(tagHex, TAG_BYTES)) {
    throw new Error('SECRET_KEY_MISMATCH — malformed IV or tag');
  }
  const key = deriveKey(keyHex);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const ct = isValidHex(ctHex, 0) ? Buffer.alloc(0) : Buffer.from(ctHex, 'hex');
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    throw new Error('SECRET_KEY_MISMATCH — wrong key or tampered ciphertext');
  }
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function readEnvLines(envPath) {
  if (!fs.existsSync(envPath)) return [];
  return fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
}

function parseEnvValue(line, key) {
  const m = line.match(new RegExp(`^${key}=(.*)$`));
  return m ? m[1] : null;
}

export function loadOrCreateKey(envPath) {
  const lines = readEnvLines(envPath);
  const existing = lines.find((l) => l.startsWith('EXDASHBOARD_SECRET_KEY='));
  if (existing) {
    const key = parseEnvValue(existing, 'EXDASHBOARD_SECRET_KEY');
    return { key, created: false };
  }
  const key = crypto.randomBytes(KEY_BYTES).toString('hex');
  const filtered = lines.filter((l) => !l.startsWith('EXDASHBOARD_SECRET_KEY='));
  const next = [...filtered, `EXDASHBOARD_SECRET_KEY=${key}`].join(os.EOL) + os.EOL;
  atomicWrite(envPath, next);
  return { key, created: true };
}
