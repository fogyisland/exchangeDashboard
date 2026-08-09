<template>
  <div class="queue-table">
    <table v-if="rows.length" class="grid">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :class="['col-' + col.key, { sortable: col.sortable }]"
            @click="col.sortable && onSort(col.key)"
          >
            {{ col.label }}
            <span v-if="col.sortable && sortKey === col.key" class="sort-ind">
              {{ sortDir === 'asc' ? '▲' : '▼' }}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in sortedRows" :key="rowKey(row, i)">
          <td>{{ row.server_hostname || row.serverId || row.server_id || '-' }}</td>
          <td>{{ row.queueKind || row.queue_kind }}</td>
          <td>{{ fmt(row.messageCount ?? row.message_count) }}</td>
          <td>{{ fmt(row.messagesPerSec ?? row.messages_per_sec) }}</td>
          <td>{{ fmtTime(row.capturedAt || row.captured_at) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="loading" class="muted">Loading...</p>
    <p v-else class="muted">No queue data available.</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
});

const sortKey = ref('messageCount');
const sortDir = ref('desc');

const columns = [
  { key: 'server', label: 'Server', sortable: true },
  { key: 'queueKind', label: 'Queue Kind', sortable: true },
  { key: 'messageCount', label: 'Messages', sortable: true },
  { key: 'messagesPerSec', label: 'Msg/sec', sortable: true },
  { key: 'capturedAt', label: 'Captured At', sortable: true }
];

function rowKey(row, i) {
  return `${row.server_id ?? row.serverId ?? ''}-${row.queue_kind ?? row.queueKind ?? ''}-${row.captured_at ?? row.capturedAt ?? ''}-${i}`;
}

function fmt(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return Math.round(n * 100) / 100;
}

function fmtTime(v) {
  if (!v) return '-';
  try {
    const d = typeof v === 'string' ? new Date(v) : v;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return String(v);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return String(v);
  }
}

function onSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = 'desc';
  }
}

const sortedRows = computed(() => {
  const list = Array.isArray(props.rows) ? [...props.rows] : [];
  if (!sortKey.value) return list;
  const k = sortKey.value;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const av = a[k] ?? a[snake(k)];
    const bv = b[k] ?? b[snake(k)];
    if (av === bv) return 0;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    const as = av === null || av === undefined ? '' : String(av);
    const bs = bv === null || bv === undefined ? '' : String(bv);
    return as.localeCompare(bs) * dir;
  });
});

function snake(c) {
  return c.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}
</script>

<style scoped>
.queue-table { width: 100%; }
.grid { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 6px; overflow: hidden; }
.grid th, .grid td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; font-size: 13px; }
.grid th { color: var(--muted); font-weight: 600; background: var(--panel-alt); user-select: none; }
.grid th.sortable { cursor: pointer; }
.grid th.sortable:hover { color: var(--text); }
.sort-ind { color: var(--accent); margin-left: 4px; font-size: 11px; }
.muted { color: var(--muted); }
</style>
