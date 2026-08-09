const RULES = [
  { match: /^login$|^logout$/, cat: 'auth' },
  { match: /^users\.|^roles\.|^init\./, cat: 'admin' },
  { match: /^config\.|^system_config\./, cat: 'config' },
  { match: /^queues\.|^dags?\.|^servers\.|^mdb\.|^mailflow\./, cat: 'data' }
];

export function classify({ action }) {
  for (const r of RULES) {
    if (r.match.test(action || '')) return r.cat;
  }
  return 'unknown';
}
