<template>
  <div class="dag-grid">
    <table v-if="uniqueDbNames.length" class="grid" data-testid="dag-grid">
      <thead>
        <tr>
          <th class="db-col">Database</th>
          <th
            v-for="server in serverColumns"
            :key="server.server_id"
            class="server-col"
          >
            <div class="srv-name">{{ server.hostname }}</div>
            <div class="srv-id">#{{ server.server_id }}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="dbName in uniqueDbNames" :key="dbName">
          <th scope="row" class="db-cell">
            <div class="db-name">{{ dbName }}</div>
            <div class="db-path" :title="firstDbForName(dbName).edb_file_path">
              {{ truncate(firstDbForName(dbName).edb_file_path, 40) }}
            </div>
          </th>
          <td
            v-for="server in serverColumns"
            :key="dbName + ':' + server.server_id"
            :class="['cell', cellClassName(dbName, server.server_id)]"
            data-testid="dag-grid-cell"
          >
            <template v-if="cellData(dbName, server.server_id)">
              <div class="queue">Queue: {{ cellData(dbName, server.server_id).copy_queue_length ?? '-' }}</div>
              <div class="lag">Lag: {{ cellData(dbName, server.server_id).replay_lag_seconds ?? '-' }}s</div>
              <div :class="['mount', mountBadgeClass(cellData(dbName, server.server_id).mount_status)]">
                {{ mountLabel(cellData(dbName, server.server_id).mount_status) }}
              </div>
            </template>
            <template v-else>
              <span class="muted">no data</span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">No databases for this DAG.</p>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  databases: {
    type: Array,
    default: () => []
  },
  copyStatus: {
    type: Array,
    default: () => []
  }
});

function normalizeDb(raw) {
  return {
    db_id: raw.db_id ?? raw.dbId,
    db_name: raw.db_name ?? raw.dbName,
    server_id: Number(raw.server_id ?? raw.serverId),
    edb_file_path: raw.edb_file_path ?? raw.edbFilePath ?? '',
    log_folder_path: raw.log_folder_path ?? raw.logFolderPath ?? '',
    circular_logging: raw.circular_logging ?? raw.circularLogging ?? 0
  };
}

function normalizeCopy(raw) {
  return {
    server_id: Number(raw.server_id ?? raw.serverId),
    db_id: raw.db_id ?? raw.dbId,
    hostname: raw.hostname || raw.server_hostname || '',
    copy_queue_length: raw.copy_queue_length ?? raw.copyQueueLength ?? 0,
    replay_lag_seconds: raw.replay_lag_seconds ?? raw.replayLagSeconds ?? 0,
    mount_status: Number(raw.mount_status ?? raw.mountStatus ?? 0),
    is_active_copy: raw.is_active_copy ?? raw.isActiveCopy ?? 0
  };
}

const normDbs = computed(() => (Array.isArray(props.databases) ? props.databases.map(normalizeDb) : []));
const normCopies = computed(() => (Array.isArray(props.copyStatus) ? props.copyStatus.map(normalizeCopy) : []));

const uniqueDbNames = computed(() => {
  const set = new Set();
  const out = [];
  for (const d of normDbs.value) {
    if (!set.has(d.db_name)) {
      set.add(d.db_name);
      out.push(d.db_name);
    }
  }
  return out;
});

const serverColumns = computed(() => {
  // Unique servers ordered as they first appear in databases list
  const seen = new Set();
  const out = [];
  for (const d of normDbs.value) {
    if (!seen.has(d.server_id)) {
      seen.add(d.server_id);
      const c = normCopies.value.find((cc) => cc.server_id === d.server_id);
      out.push({
        server_id: d.server_id,
        hostname: c?.hostname || ('#' + d.server_id)
      });
    }
  }
  return out;
});

function firstDbForName(name) {
  return normDbs.value.find((d) => d.db_name === name) || { db_id: '', edb_file_path: '' };
}

function cellData(dbName, serverId) {
  const db = normDbs.value.find((d) => d.db_name === dbName && d.server_id === serverId);
  if (!db) return null;
  return normCopies.value.find((c) => c.server_id === serverId && (c.db_id === db.db_id || c.db_id === undefined)) || null;
}

function cellClassName(dbName, serverId) {
  const data = cellData(dbName, serverId);
  if (!data) return 'cell-empty';
  if (data.mount_status === 1) return 'cell-mounted';
  if (data.mount_status === 0) return 'cell-unmounted';
  return 'cell-unknown';
}

function mountLabel(status) {
  if (status === 1) return 'Mounted';
  if (status === 0) return 'Dismounted';
  return 'Unknown';
}

function mountBadgeClass(status) {
  if (status === 1) return 'badge-ok';
  if (status === 0) return 'badge-bad';
  return 'badge-unknown';
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
</script>

<style scoped>
.dag-grid { width: 100%; overflow-x: auto; }
.grid { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.grid th, .grid td { padding: 8px 12px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); text-align: left; font-size: 13px; vertical-align: top; }
.grid th { color: var(--muted); font-weight: 600; background: var(--panel-alt); }
.db-col { min-width: 200px; }
.server-col { min-width: 160px; }
.srv-name { color: var(--text); font-weight: 600; }
.srv-id { color: var(--muted); font-size: 11px; }
.db-name { color: var(--text); font-weight: 600; }
.db-path { color: var(--muted); font-size: 11px; margin-top: 2px; word-break: break-all; }
.cell { background: var(--panel); }
.cell-mounted { background: rgba(34, 197, 94, 0.12); border-left: 3px solid #22c55e; }
.cell-unmounted { background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444; }
.cell-unknown { background: rgba(148, 163, 184, 0.12); border-left: 3px solid #94a3b8; }
.cell-empty { background: var(--panel-alt); color: var(--muted); }
.queue { color: var(--text); font-size: 12px; }
.lag { color: var(--muted); font-size: 11px; }
.mount { display: inline-block; margin-top: 4px; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-ok { background: rgba(34, 197, 94, 0.25); color: #22c55e; }
.badge-bad { background: rgba(239, 68, 68, 0.25); color: #ef4444; }
.badge-unknown { background: rgba(148, 163, 184, 0.25); color: #94a3b8; }
.muted { color: var(--muted); }
</style>