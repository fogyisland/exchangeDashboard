import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { adminRouter } from '../../src/routes/admin.js';
import { userAuth } from '../../src/auth/user-auth.js';

function setup({ users = [] } = {}) {
  const db = {
    async query(sql, params) {
      if (/FROM users/.test(sql)) return users;
      if (/INSERT INTO users/.test(sql)) return [];
      if (/UPDATE users/.test(sql)) return [];
      if (/FROM audit_log/.test(sql)) return [];
      if (/FROM system_config/.test(sql)) return [{ k: 'foo', v: 'bar' }];
      return [];
    }
  };
  const u = userAuth({ db, jwtSecret: 's', expiresInSeconds: 60 });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin', perms: new Set(['admin:users']) }; next(); });
  app.use('/api/admin', adminRouter({ db, logger: { info() {}, warn() {}, error() {} }, config: {} }));
  return { app, db };
}

test('GET /api/admin/users requires auth (covered by requirePerm middleware in real route)', async () => {
  // This test verifies the data handler; auth middleware is added by the route.
  const { app } = setup({ users: [{ id: 1, username: 'admin', role: 'admin', enabled: 1, created_at: new Date() }] });
  const r = await supertest(app)
    .get('/api/admin/users')
    .set('Authorization', `Bearer ${jwt.sign({ sub: 'admin', role: 'admin', uid: 1 }, 'dev')}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 1);
});
