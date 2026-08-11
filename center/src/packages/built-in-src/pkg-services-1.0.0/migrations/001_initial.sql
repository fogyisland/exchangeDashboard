CREATE TABLE windows_service (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL,
  start_mode VARCHAR(32) NOT NULL,
  PRIMARY KEY (agent_id, ts, service_name),
  KEY idx_ts (ts)
);
