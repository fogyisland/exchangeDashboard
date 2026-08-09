import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { listUsers, createUser } from '../../src/services/users.js';

function fakeDb() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (/INSERT INTO users/.test(sql)) { rows.push({ id: rows.length + 1, username: params[0], role: params[2] }); return []; }
      if (/SELECT id, username, role/.test(sql)) return rows;
      return [];
    }
  };
}

test('createUser hashes password and inserts row', async () => {
  const db = fakeDb();
  await createUser(db, { username: 'bob', password: 'hunter22', role: 'user' });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].username, 'bob');
  assert.equal(db.rows[0].role, 'user');
});

test('listUsers returns rows', async () => {
  const db = fakeDb();
  await createUser(db, { username: 'alice', password: 'hunter22', role: 'admin' });
  const list = await listUsers(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].username, 'alice');
});
