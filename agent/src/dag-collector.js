// agent/src/dag-collector.js
export class DagCollector {
  constructor(perfmon, opts = {}) { this.perfmon = perfmon; this.databases = opts.databases || []; }
  async collect() {
    const now = new Date().toISOString();
    const rows = [];
    for (const db of this.databases) {
      const paths = [
        `\\MSExchangeRepl ${db.db_name} Database Moves\\CopyQueueLength`,
        `\\MSExchangeRepl ${db.db_name} Database Moves\\ReplayLag`,
        `\\MSExchangeRepl ${db.db_name} Database Moves\\MountStatus`
      ];
      const raw = await this.perfmon.counterMulti(paths);
      rows.push({
        db_id: db.db_id,
        server_id: db.server_id,
        captured_at: now,
        copy_queue_length: Number(raw[paths[0]]) || 0,
        replay_lag_seconds: Number(raw[paths[1]]) || 0,
        mount_status: Number(raw[paths[2]]) || 0,
        content_index_state: null,
        is_active_copy: 0,
        activation_preference: null
      });
    }
    return { copies: rows };
  }
}
