export async function listServers(db) {
  return await db.query(
    `SELECT id, agent_id, hostname, fqdn, os_version, exchange_version, server_role, dag_id, last_heartbeat_at, last_report_at, enabled
     FROM servers ORDER BY hostname`
  );
}

export async function getServer(db, id) {
  const rows = await db.query('SELECT * FROM servers WHERE id = ?', [id]);
  return rows && rows[0] ? rows[0] : null;
}

export async function getServerHealth(db, id) {
  const services = await db.query(
    `SELECT service_name, state, start_mode
     FROM service_states
     WHERE server_id = ? AND captured_at = (SELECT MAX(captured_at) FROM service_states WHERE server_id = ?)
     ORDER BY service_name`,
    [id, id]
  );
  const resources = await db.query(
    `SELECT cpu_pct, memory_available_mb, disk_c_free_pct, net_bytes_per_sec, captured_at
     FROM server_resources
     WHERE server_id = ?
     ORDER BY captured_at DESC LIMIT 1`,
    [id]
  );
  return { services, resources: resources && resources[0] ? resources[0] : null };
}
