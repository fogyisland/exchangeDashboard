<template>
  <div class="counter-tile tile" :class="severityClass" data-testid="counter-tile">
    <div class="tile-title" :title="label">{{ label }}</div>
    <div class="tile-row">
      <div class="tile-value">
        <span class="value-number" data-testid="counter-value">{{ formattedValue }}</span>
        <span v-if="unit" class="value-unit">{{ unit }}</span>
      </div>
      <div v-if="hasDelta" class="delta" :class="deltaClass" data-testid="counter-delta">
        <span class="delta-arrow">{{ deltaArrow }}</span>
        <span class="delta-number">{{ formattedDelta }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: null },
  unit: { type: String, default: '' },
  delta: { type: [Number, String, null], default: null }
});

const numericValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return null;
  const n = Number(props.value);
  return Number.isFinite(n) ? n : null;
});

const numericDelta = computed(() => {
  if (props.delta === null || props.delta === undefined || props.delta === '') return null;
  const n = Number(props.delta);
  return Number.isFinite(n) ? n : null;
});

const hasDelta = computed(() => numericDelta.value !== null);

const formattedValue = computed(() => {
  if (numericValue.value === null) return '-';
  const n = numericValue.value;
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
});

const formattedDelta = computed(() => {
  const d = numericDelta.value;
  if (d === null) return '';
  const abs = Math.abs(d);
  if (abs >= 100) return abs.toFixed(0);
  if (abs >= 10) return abs.toFixed(1);
  return abs.toFixed(2);
});

const deltaArrow = computed(() => {
  const d = numericDelta.value;
  if (d === null) return '';
  if (d > 0) return '▲';
  if (d < 0) return '▼';
  return '·';
});

const deltaClass = computed(() => {
  const d = numericDelta.value;
  if (d === null) return '';
  if (d > 0) return 'delta-up';
  if (d < 0) return 'delta-down';
  return 'delta-flat';
});

const severityClass = computed(() => 'severity-ok');
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
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}
.tile-value {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: var(--text);
}
.value-number {
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
}
.value-unit {
  color: var(--muted);
  font-size: 12px;
}
.delta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.delta-up { color: var(--green, #22c55e); }
.delta-down { color: var(--red, #ef4444); }
.delta-flat { color: var(--muted); }
.delta-number { font-weight: 600; }
.severity-ok .value-number { color: var(--text); }
</style>