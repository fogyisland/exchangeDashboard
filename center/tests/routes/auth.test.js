import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import bcrypt from 'bcryptjs';
import { authRouter } from '../../src/routes/auth.js';

test('POST /api/auth/login → 200 + token on right password', async () => {
  const hash = await bcrypt.hash('hunter22', 4);
  const db = { async query() { return [{ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 }]; } };
  const app = express();
  app.use('/api/auth', authRouter({ db, jwtSecret: 's', expiresInSeconds: 60 }));
  const r = await supertest(app).post('/api/auth/login').send({ username: 'admin', password: 'hunter22' });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.role, 'admin');
});

test('POST /api/auth/login → 401 on wrong password', async () => {
  const hash = await bcrypt.hash('hunter22', 4);
  const db = { async query() { return [{ id: 1, username: 'admin', password_hash: hash, role: 'admin', enabled: 1 }]; } };
  const app = express();
  app.use('/api/auth', authRouter({ db, jwtSecret: 's', expiresInSeconds: 60 }));
  const r = await supertest(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
});
