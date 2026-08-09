-- Initial schema for ExDashboard (MySQL / SQL Server compatible via driver rewrites)

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enabled TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) UNIQUE NOT NULL
);

CREATE TABLE user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INT NULL,
  action VARCHAR(128) NOT NULL,
  target VARCHAR(255) NULL,
  details TEXT NULL
);

CREATE TABLE system_config (
  k VARCHAR(64) PRIMARY KEY,
  v VARCHAR(255) NOT NULL
);

CREATE TABLE agents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) UNIQUE NOT NULL,
  hostname VARCHAR(128) NOT NULL,
  fqdn VARCHAR(255) NULL,
  os_version VARCHAR(128) NULL,
  exchange_version VARCHAR(64) NULL,
  server_role INT NOT NULL DEFAULT 0,
  dag_id INT NULL,
  last_heartbeat_at DATETIME NULL,
  last_report_at DATETIME NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE heartbeat_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL,
  payload TEXT NULL
);

CREATE TABLE packages (
  name VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  manifest TEXT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE package_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_name VARCHAR(64) NOT NULL,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(32) NOT NULL,
  output TEXT NULL
);

CREATE TABLE package_versions (
  package_name VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (package_name, version)
);

-- Exchange-specific tables

CREATE TABLE dags (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) UNIQUE NOT NULL,
  description VARCHAR(255) NULL,
  file_share_witness VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE servers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NULL,
  hostname VARCHAR(128) UNIQUE NOT NULL,
  fqdn VARCHAR(255) NULL,
  os_version VARCHAR(128) NULL,
  exchange_version VARCHAR(64) NULL,
  server_role INT NOT NULL DEFAULT 0,
  dag_id INT NULL,
  last_heartbeat_at DATETIME NULL,
  last_report_at DATETIME NULL,
  enabled TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE dag_members (
  dag_id INT NOT NULL,
  server_id INT NOT NULL,
  preferred_activations INT NOT NULL DEFAULT 1,
  replication_enabled TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (dag_id, server_id)
);

CREATE TABLE mdb_catalog (
  db_id VARCHAR(64) PRIMARY KEY,
  db_name VARCHAR(128) NOT NULL,
  dag_id INT NULL,
  server_id INT NULL,
  edb_file_path VARCHAR(255) NULL,
  log_folder_path VARCHAR(255) NULL,
  circular_logging TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE queue_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  queue_kind VARCHAR(32) NOT NULL,
  queue_name VARCHAR(128) NOT NULL,
  message_count INT NOT NULL DEFAULT 0,
  oldest_message_age_seconds INT NULL,
  messages_per_sec DECIMAL(12,4) NULL,
  deferred_per_sec DECIMAL(12,4) NULL
);
CREATE INDEX idx_queue_snap_server_time ON queue_snapshots (server_id, captured_at);
CREATE INDEX idx_queue_snap_kind ON queue_snapshots (queue_kind);

CREATE TABLE mdb_copy_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  db_id VARCHAR(64) NOT NULL,
  captured_at DATETIME NOT NULL,
  copy_queue_length INT NOT NULL DEFAULT 0,
  replay_lag_seconds INT NULL,
  mount_status TINYINT NOT NULL DEFAULT 0,
  content_index_state VARCHAR(32) NULL,
  is_active_copy TINYINT NOT NULL DEFAULT 0,
  activation_preference INT NULL
);
CREATE INDEX idx_mdb_copy_db_server_time ON mdb_copy_snapshots (db_id, server_id, captured_at);

CREATE TABLE service_states (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  service_name VARCHAR(128) NOT NULL,
  state VARCHAR(32) NOT NULL,
  start_mode VARCHAR(16) NOT NULL
);
CREATE INDEX idx_service_states_server_time ON service_states (server_id, captured_at);

CREATE TABLE client_access_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  metric VARCHAR(64) NOT NULL,
  value DECIMAL(18,4) NOT NULL
);
CREATE INDEX idx_client_access_server_metric_time ON client_access_snapshots (server_id, metric, captured_at);

CREATE TABLE server_resources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  cpu_pct DECIMAL(5,2) NULL,
  memory_available_mb BIGINT NULL,
  disk_c_free_pct DECIMAL(5,2) NULL,
  net_bytes_per_sec BIGINT NULL
);
CREATE INDEX idx_server_resources_server_time ON server_resources (server_id, captured_at);

CREATE TABLE mailflow_summaries (
  server_id INT PRIMARY KEY,
  captured_at DATETIME NOT NULL,
  total_queue_length INT NOT NULL DEFAULT 0,
  poison_queue_length INT NOT NULL DEFAULT 0,
  retry_queue_length INT NOT NULL DEFAULT 0
);

CREATE TABLE mailflow_errors (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  severity VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  message VARCHAR(255) NULL
);

CREATE TABLE dag_replication_matrix (
  dag_id INT NOT NULL,
  db_id VARCHAR(64) NOT NULL,
  server_id INT NOT NULL,
  captured_at DATETIME NOT NULL,
  copy_queue_length INT NULL,
  replay_lag_seconds INT NULL,
  mount_status TINYINT NULL,
  PRIMARY KEY (dag_id, db_id, server_id, captured_at)
);