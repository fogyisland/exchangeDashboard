CREATE TABLE hub_queue_pressure (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  queue_kind VARCHAR(64) NOT NULL,
  current_depth INT NOT NULL,
  max_depth INT NULL,
  pct_full DOUBLE NULL,
  age_oldest_min INT NULL
);