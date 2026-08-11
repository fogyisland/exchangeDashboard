CREATE TABLE rpc_latency (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  metric VARCHAR(128) NOT NULL,
  value DOUBLE NOT NULL,
  PRIMARY KEY (agent_id, ts, metric),
  KEY idx_ts (ts)
);
