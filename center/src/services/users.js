import bcrypt from 'bcryptjs';

export async function listUsers(db) {
  return await db.query('SELECT id, username, role, enabled, created_at FROM users ORDER BY id ASC');
}

export async function createUser(db, { username, password, role = 'user' }) {
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role]);
}

export async function setEnabled(db, id, enabled) {
  await db.query('UPDATE users SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function deleteUser(db, id) {
  await db.query('DELETE FROM users WHERE id = ?', [id]);
}
