import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userAuth } from '../../src/auth/user-auth.js';

function fakeDb(user) {
  return {
    async query(sql, params) {
      if (/FROM users/.test(sql)) return [user];
      return [];
    }
  };
}

test('login succeeds with correct password and issues jwt', async () => {
  const hash = await bcrypt.hash('right-password', 4);
  const db = fakeDb({ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 });
  const u = userAuth({ db, jwtSecret: 'test-secret', expiresInSeconds: 60 });
  const out = await u.login({ username: 'admin', password: 'right-password' });
  assert.equal(out.ok, true);
  assert.equal(out.user.username, 'admin');
  assert.ok(out.token);
  const decoded = jwt.verify(out.token, 'test-secret');
  assert.equal(decoded.sub, 'admin');
});

test('login fails with wrong password', async () => {
  const hash = await bcrypt.hash('right', 4);
  const db = fakeDb({ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 });
  const u = userAuth({ db, jwtSecret: 's', expiresInSeconds: 60 });
  const out = await u.login({ username: 'admin', password: 'wrong' });
  assert.equal(out.ok, false);
});

test('login rejects disabled user', async () => {
  const hash = await bcrypt.hash('p', 4);
  const db = fakeDb({ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 0 });
  const u = userAuth({ db, jwtSecret: 's', expiresInSeconds: 60 });
  const out = await u.login({ username: 'admin', password: 'p' });
  assert.equal(out.ok, false);
});

test('requireAuth accepts valid token', async () => {
  const token = jwt.sign({ sub: 'admin', role: 'admin' }, 's', { expiresIn: 60 });
  const u = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let called = false;
  await new Promise((resolve) => u.requireAuth(req, {}, () => { called = true; resolve(); }));
  assert.equal(called, true);
  assert.equal(req.user.username, 'admin');
});

test('requireAuth rejects missing token', async () => {
  const u = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 });
  const res = { status(c) { this.code = c; return this; }, json(o) { this.body = o; } };
  let nextCalled = false;
  await u.requireAuth({ headers: {} }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.code, 401);
});

test('requirePerm allows admin', () => {
  const mw = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 }).requirePerm('admin:users');
  const req = { user: { role: 'admin' } };
  let called = false;
  mw(req, {}, () => { called = true; });
  assert.equal(called, true);
});

test('requirePerm denies user without perm', () => {
  const mw = userAuth({ db: fakeDb(null), jwtSecret: 's', expiresInSeconds: 60 }).requirePerm('admin:users');
  const req = { user: { role: 'viewer' } };
  const res = { status(c) { this.code = c; return this; }, json() {} };
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.code, 403);
});
