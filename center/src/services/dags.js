export async function listDags(db) {
  return await db.query('SELECT id, name, description, file_share_witness, created_at FROM dags ORDER BY name');
}

export async function getDagTopology(db, dagId) {
  const members = await db.query(
    `SELECT s.id AS server_id, s.hostname, s.fqdn, dm.preferred_activations, dm.replication_enabled
     FROM dag_members dm JOIN servers s ON s.id = dm.server_id
     WHERE dm.dag_id = ?`,
    [dagId]
  );
  return { dagId, members, links: members.map((m) => ({ from: m.server_id, to: m.server_id })) };
}

export async function getDagDatabases(db, dagId) {
  return await db.query(
    `SELECT m.db_id, m.db_name, m.server_id, m.edb_file_path, m.log_folder_path, m.circular_logging
     FROM mdb_catalog m
     WHERE m.dag_id = ?
     ORDER BY m.db_name`,
    [dagId]
  );
}

export async function getCopyStatus(db, dagId, dbId) {
  return await db.query(
    `SELECT cs.server_id, s.hostname, cs.copy_queue_length, cs.replay_lag_seconds, cs.mount_status, cs.content_index_state, cs.is_active_copy, cs.activation_preference, cs.captured_at
     FROM mdb_copy_snapshots cs JOIN servers s ON s.id = cs.server_id
     WHERE cs.db_id = ? AND cs.captured_at = (SELECT MAX(captured_at) FROM mdb_copy_snapshots WHERE db_id = ?)
     ORDER BY cs.server_id`,
    [dbId, dbId]
  );
}
