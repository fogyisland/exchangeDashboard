const BLOCKED_PATTERNS = [
  /;\s*\S/,
  /\bpkg_[a-z0-9_]+\./i,
  /\bDROP\b/i,
  /\b(TRUNCATE|RENAME|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bMERGE\b/i,
  /\bSELECT\b/i,
  /\b(packages|package_runs|package_versions|users|agents|servers|dags|dag_members|mdb_catalog|queue_snapshots|mdb_copy_snapshots|service_states|client_access_snapshots|server_resources|mailflow_summaries|mailflow_errors|dag_replication_matrix|heartbeat_events|audit_log|system_config|roles|user_roles|schema_migrations)\b/i
];

export function scanSql(sql) {
  if (typeof sql !== 'string') return { ok: false, blocked: 'non-string input' };
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(stripped)) return { ok: false, blocked: re.source };
  }
  return { ok: true };
}