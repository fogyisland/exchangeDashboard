// Ported from agent/src/dag-collector.js
export default {
  name: 'pkg-dag',
  async collect({ perfmon, dag }) {
    if (!perfmon) return [];
    let counterResults = [];
    try {
      counterResults = await perfmon.copySnapshot() || [];
    } catch { return []; }
    return counterResults.map((c) => ({
      db_id: c.db_id || c.DatabaseName || 'unknown',
      copy_queue_length: Number(c.copy_queue_length) || 0,
      replay_lag_seconds: c.replay_lag_seconds == null ? null : Number(c.replay_lag_seconds),
      mount_status: Number(c.mount_status) || 0,
      content_index_state: c.content_index_state == null ? null : Number(c.content_index_state),
      is_active_copy: c.is_active_copy ? 1 : 0,
      activation_preference: c.activation_preference == null ? null : Number(c.activation_preference)
    }));
  }
};
