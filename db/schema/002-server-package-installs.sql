-- Per-server package install state.
-- One row per (server, package) pair. Statuses: pending (assigned, agent hasn't pulled yet),
-- installed (agent reported data successfully), failed (install/pull failed; error column populated).
CREATE TABLE server_package_installs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  server_id INT NOT NULL,
  package_name VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  status ENUM('pending','installed','failed') NOT NULL DEFAULT 'pending',
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_server_pkg (server_id, package_name),
  KEY idx_status (status, server_id),
  KEY idx_server (server_id)
);
