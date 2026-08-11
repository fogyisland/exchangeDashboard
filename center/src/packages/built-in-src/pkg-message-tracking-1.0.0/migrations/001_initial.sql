CREATE TABLE tracking_event_counts (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  event_id VARCHAR(8) NOT NULL,
  message_count INT NOT NULL
);