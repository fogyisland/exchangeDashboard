CREATE TABLE mdb_copy_status (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  db_id VARCHAR(64) NOT NULL,
  copy_queue_length INT NOT NULL,
  replay_lag_seconds DOUBLE NULL,
  mount_status INT NOT NULL,
  content_index_state INT NULL,
  is_active_copy INT NOT NULL,
  activation_preference INT NULL,
  PRIMARY KEY (agent_id, ts, db_id),
  KEY idx_ts (ts)
);
