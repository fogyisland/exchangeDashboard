import bcrypt from 'bcryptjs';

export async function createAdminUser(db, { username, password }) {
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'admin']);
}