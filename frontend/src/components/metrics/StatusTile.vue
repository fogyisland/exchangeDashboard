<template>
  <div class="status-tile tile" :class="severityClass" data-testid="status-tile">
    <div class="tile-title" :title="label">{{ label }}</div>
    <div class="tile-row">
      <span class="badge" :class="badgeClass" data-testid="status-badge">
        <span class="badge-dot" />
        <span class="badge-text">{{ statusText }}</span>
      </span>
    </div>
    <div v-if="message" class="message" data-testid="status-message">{{ message }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: {
    type: String,
    default: 'unknown',
    validator: (v) => ['ok', 'warn', 'crit', 'unknown'].includes(v)
  },
  label: { type: String, required: true },
  message: { type: String, default: '' }
});

const severityClass = computed(() => `severity-${props.status}`);

const badgeClass = computed(() => `badge-${props.status}`);

const statusText = computed(() => {
  switch (props.status) {
    case 'ok': return 'OK';
    case 'warn': return 'Warning';
    case 'crit': return 'Critical';
    case 'unknown':
    default: return 'Unknown';
  }
});
</script>

<style scoped>
.tile {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tile-title {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--panel-alt);
  color: var(--text);
}
.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}
.badge-ok { background: var(--green-bg, rgba(34, 197, 94, 0.12)); color: var(--green, #22c55e); }
.badge-ok .badge-dot { background: var(--green, #22c55e); }
.badge-warn { background: rgba(234, 179, 8, 0.12); color: #eab308; }
.badge-warn .badge-dot { background: #eab308; }
.badge-crit { background: var(--red-bg, rgba(239, 68, 68, 0.12)); color: var(--red, #ef4444); }
.badge-crit .badge-dot { background: var(--red, #ef4444); }
.badge-unknown .badge-dot { background: var(--muted); }
.message {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
.severity-warn { border-color: #eab308; }
.severity-crit { border-color: var(--red, #ef4444); }
</style>