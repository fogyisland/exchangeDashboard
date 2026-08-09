import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function permsForRole(role) {
  if (role === 'admin') return new Set(['admin:users', 'admin:packages']);
  return new Set();
}

export function userAuth({ db, jwtSecret, expiresInSeconds = 28800 }) {
  async function login({ username, password }) {
    const rows = await db.query('SELECT id, username, password_hash, role, enabled FROM users WHERE username = ?', [username]);
    const user = rows && rows[0];
    if (!user || !user.enabled) return { ok: false };
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return { ok: false };
    const token = jwt.sign({ sub: user.username, role: user.role, uid: user.id }, jwtSecret, { expiresIn: expiresInSeconds });
    return { ok: true, token, user: { id: user.id, username: user.username, role: user.role } };
  }

  function requireAuth(req, res, next) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'missing token' } });
    try {
      const decoded = jwt.verify(m[1], jwtSecret);
      req.user = { id: decoded.uid, username: decoded.sub, role: decoded.role, perms: permsForRole(decoded.role) };
      next();
    } catch (e) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'invalid token' } });
    }
  }

  function requirePerm(perm) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'missing token' } });
      }
      const perms = req.user.perms || permsForRole(req.user.role);
      if (!perms.has(perm)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `missing perm: ${perm}` } });
      }
      next();
    };
  }

  return { login, requireAuth, requirePerm };
}
