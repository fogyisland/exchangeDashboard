import express from 'express';

export function lockoutRouter() {
  const r = express.Router();
  r.post('/diagnose', express.json(), (req, res) => {
    const { username, sourceIp } = req.body || {};
    res.json({
      ok: true,
      recommendation: 'Check lockout duration in Default Domain Policy and source IPs above',
      inputs: { username, sourceIp }
    });
  });
  return r;
}
