<template>
  <div class="service-health-bar" data-testid="service-health-bar">
    <div v-if="!services || services.length === 0" class="empty muted">
      no services reported
    </div>
    <ul v-else class="rows" data-testid="service-rows">
      <li
        v-for="svc in services"
        :key="svc.service_name"
        class="row"
        :class="stateClass(svc.state)"
        data-testid="service-row"
        :data-state="normalizedState(svc.state)"
        :title="rowTitle(svc)"
      >
        <span class="dot" :class="stateClass(svc.state)" aria-hidden="true"></span>
        <span class="name">{{ svc.service_name }}</span>
        <span class="state">{{ normalizedState(svc.state) }}</span>
        <span class="start">{{ svc.start_mode || '' }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
const props = defineProps({
  services: {
    type: Array,
    default: () => []
    // Each item: { service_name, state, start_mode }
  }
});

const STATE_MAP = {
  running: 'running',
  stopped: 'stopped',
  start_pending: 'starting',
  stop_pending: 'stopping',
  continue_pending: 'starting',
  pause_pending: 'pausing',
  paused: 'paused',
};

function normalizedState(state) {
  if (!state) return 'unknown';
  const key = String(state).toLowerCase().trim();
  return STATE_MAP[key] || 'unknown';
}

function stateClass(state) {
  const normalized = normalizedState(state);
  return `state-${normalized}`;
}

function rowTitle(svc) {
  const parts = [svc.service_name];
  if (svc.state) parts.push(`state: ${normalizedState(svc.state)}`);
  if (svc.start_mode) parts.push(`start mode: ${svc.start_mode}`);
  return parts.join(' — ');
}
</script>

<style scoped>
.service-health-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.empty {
  font-size: 12px;
  font-style: italic;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: grid;
  grid-template-columns: 12px 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--panel-alt, rgba(255, 255, 255, 0.03));
  font-size: 12px;
  border-left: 3px solid var(--muted);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
  display: inline-block;
}
.name {
  color: var(--text);
  font-family: var(--mono, monospace);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.state {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.start {
  font-size: 11px;
  color: var(--muted);
  font-style: italic;
}

/* State color variants — border-left accent + dot fill + state text color */
.state-running { border-left-color: var(--green, #22c55e); }
.state-running .dot { background: var(--green, #22c55e); }
.state-running .state { color: var(--green, #22c55e); }

.state-stopped { border-left-color: var(--red, #ef4444); }
.state-stopped .dot { background: var(--red, #ef4444); }
.state-stopped .state { color: var(--red, #ef4444); }

.state-starting,
.state-stopping,
.state-pausing { border-left-color: #eab308; }
.state-starting .dot,
.state-stopping .dot,
.state-pausing .dot { background: #eab308; }
.state-starting .state,
.state-stopping .state,
.state-pausing .state { color: #eab308; }

.state-paused { border-left-color: #eab308; }
.state-paused .dot { background: #eab308; }
.state-paused .state { color: #eab308; }

.state-unknown { border-left-color: var(--muted); }
.state-unknown .dot { background: var(--muted); }
.state-unknown .state { color: var(--muted); }

.muted { color: var(--muted); }
</style>