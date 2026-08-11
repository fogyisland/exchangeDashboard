CREATE TABLE mailbox_quota (
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  mailbox_identity VARCHAR(255) NOT NULL,
  database VARCHAR(128) NOT NULL,
  total_item_size_bytes BIGINT NOT NULL,
  item_count INT NOT NULL
);