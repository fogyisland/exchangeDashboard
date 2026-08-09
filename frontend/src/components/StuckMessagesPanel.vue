<template>
  <div class="stuck">
    <table v-if="filteredRows.length" class="grid">
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
          <th>Severity</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in filteredRows"
          :key="rowKey(row, i)"
          :class="severityClass(row)"
        >
          <td>{{ row.server_hostname || row.serverId || row.server_id || '-' }}</td>
          <td>{{ row.queueKind || row.queue_kind }}</td>
          <td>{{ fmt(row.messageCount ?? row.message_count) }}</td>
          <td>{{ fmtTime(row.capturedAt || row.captured_at) }}</td>
          <td>
            <span class="badge" :class="severityClass(row)">
              {{ severityLabel(row) }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="loading" class="muted">Loading...</p>
    <p v-else class="muted">No stuck messages detected.</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  threshold: { type: Number, default: 1000 }
});

const sortKey = ref('messageCount');
const sortDir = ref('desc');

const columns = [
  { key: 'server', label: 'Server', sortable: true },
  { key: 'queueKind', label: 'Queue Kind', sortable: true },
  { key: 'messageCount', label: 'Messages', sortable: true },
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

function rowKind(row) {
  return row.queueKind ?? row.queue_kind ?? '';
}
function rowCount(row) {
  return Number(row.messageCount ?? row.message_count ?? 0);
}

const filteredRows = computed(() => {
  const list = Array.isArray(props.rows) ? [...props.rows] : [];
  // Filter: stuck thresholds
  const filtered = list.filter((row) => {
    const k = rowKind(row);
    const c = rowCount(row);
    if (k === 'Poison' || k === 'Retry') return true;
    if (k === 'ActiveMailboxDelivery' && c > props.threshold) return true;
    return false;
  });
  if (!sortKey.value) return filtered;
  const k = sortKey.value;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    let av = a[k];
    let bv = b[k];
    if (k === 'queueKind') {
      av = rowKind(a);
      bv = rowKind(b);
    } else if (k === 'server') {
      av = a.server_hostname ?? a.serverId ?? a.server_id ?? '';
      bv = b.server_hostname ?? b.serverId ?? b.server_id ?? '';
    } else if (k === 'messageCount') {
      av = rowCount(a);
      bv = rowCount(b);
    } else if (k === 'capturedAt') {
      av = a.captured_at ?? a.capturedAt ?? '';
      bv = b.captured_at ?? b.capturedAt ?? '';
    }
    if (av === bv) return 0;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
});

function severityClass(row) {
  const k = rowKind(row);
  const c = rowCount(row);
  if (k === 'Poison') return 'sev-critical';
  if (k === 'Retry') return 'sev-warning';
  if (c > props.threshold) return 'sev-high';
  return 'sev-info';
}

function severityLabel(row) {
  const k = rowKind(row);
  const c = rowCount(row);
  if (k === 'Poison') return 'Critical';
  if (k === 'Retry') return 'Warning';
  if (c > props.threshold) return 'High';
  return 'Info';
}

function onSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = 'desc';
  }
}
</script>

<style scoped>
.stuck { width: 100%; }
.grid { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 6px; overflow: hidden; }
.grid th, .grid td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; font-size: 13px; }
.grid th { color: var(--muted); font-weight: 600; background: var(--panel-alt); user-select: none; }
.grid th.sortable { cursor: pointer; }
.grid th.sortable:hover { color: var(--text); }
.sort-ind { color: var(--accent); margin-left: 4px; font-size: 11px; }

.grid tr.sev-critical { background: var(--red-bg); }
.grid tr.sev-warning { background: rgba(234, 179, 8, 0.10); }
.grid tr.sev-high { background: rgba(56, 189, 248, 0.08); }

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.badge.sev-critical { background: var(--red-bg); color: var(--red); }
.badge.sev-warning { background: rgba(234, 179, 8, 0.15); color: #eab308; }
.badge.sev-high { background: rgba(56, 189, 248, 0.15); color: var(--accent); }
.badge.sev-info { background: var(--panel-alt); color: var(--muted); }

.muted { color: var(--muted); }
</style>
