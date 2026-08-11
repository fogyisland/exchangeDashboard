CREATE TABLE host_resources (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  cpu_pct DOUBLE NULL,
  memory_available_mb INT NULL,
  disk_c_free_pct DOUBLE NULL,
  net_bytes_per_sec DOUBLE NULL,
  PRIMARY KEY (agent_id, ts),
  KEY idx_ts (ts)
);
