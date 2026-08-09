<template>
  <div class="tile" :class="severityClass" data-testid="client-access-tile">
    <div class="tile-title" :title="title">{{ title }}</div>
    <div class="tile-row">
      <div class="tile-value" data-testid="tile-value">
        <span class="value-number">{{ formattedValue }}</span>
        <span v-if="unit" class="value-unit">{{ unit }}</span>
      </div>
      <svg
        v-if="hasSparkline"
        class="tile-spark"
        :viewBox="`0 0 ${sparkWidth} ${sparkHeight}`"
        :width="sparkWidth"
        :height="sparkHeight"
        preserveAspectRatio="none"
        data-testid="tile-sparkline"
        aria-hidden="true"
      >
        <polyline
          class="sparkline-line"
          :points="sparkPoints"
        />
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  value: { type: Number, default: null },
  unit: { type: String, default: '' },
  sparkline: { type: Array, default: () => [] },
  threshold: {
    type: Object,
    default: () => null,
    // { warn: number, crit: number } or null
    validator: (v) => v === null || (typeof v === 'object' && 'warn' in v && 'crit' in v)
  }
});

const sparkWidth = 80;
const sparkHeight = 24;

const numericValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return null;
  const n = Number(props.value);
  return Number.isFinite(n) ? n : null;
});

const formattedValue = computed(() => {
  if (numericValue.value === null) return '-';
  const n = numericValue.value;
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
});

const severity = computed(() => {
  if (numericValue.value === null || !props.threshold) return 'ok';
  const { warn, crit } = props.threshold;
  const v = numericValue.value;
  if (v >= crit) return 'crit';
  if (v >= warn) return 'warn';
  return 'ok';
});

const severityClass = computed(() => `severity-${severity.value}`);

const hasSparkline = computed(() => Array.isArray(props.sparkline) && props.sparkline.length > 0);

const sparkPoints = computed(() => {
  const data = (props.sparkline || [])
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n));
  if (data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? sparkWidth / (data.length - 1) : 0;
  return data
    .map((v, i) => {
      const x = i * stepX;
      const y = sparkHeight - ((v - min) / range) * sparkHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
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
.tile-spark {
  flex-shrink: 0;
  display: block;
}
.sparkline-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.severity-ok .value-number { color: var(--green, #22c55e); }
.severity-warn { border-color: #eab308; }
.severity-warn .value-number { color: #eab308; }
.severity-warn .sparkline-line { stroke: #eab308; }
.severity-crit { border-color: var(--red, #ef4444); }
.severity-crit .value-number { color: var(--red, #ef4444); }
.severity-crit .sparkline-line { stroke: var(--red, #ef4444); }
</style>
