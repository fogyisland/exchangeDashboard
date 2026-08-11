CREATE TABLE mailflow_queue (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  queue_kind VARCHAR(64) NOT NULL,
  queue_name VARCHAR(64) NOT NULL,
  message_count INT NOT NULL,
  messages_per_sec DOUBLE NULL,
  deferred_per_sec DOUBLE NULL
);
