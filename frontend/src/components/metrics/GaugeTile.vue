<template>
  <div class="gauge-tile tile" :class="severityClass" data-testid="gauge-tile">
    <div class="tile-title" :title="label">{{ label }}</div>
    <div class="tile-row">
      <svg
        class="gauge-svg"
        :viewBox="`0 0 ${size} ${size}`"
        :width="size"
        :height="size"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <path
          class="gauge-track"
          :d="trackPath"
        />
        <path
          class="gauge-fill"
          :class="severityClass"
          :d="fillPath"
        />
        <line
          class="gauge-needle"
          :x1="size / 2"
          :y1="size / 2"
          :x2="needleX"
          :y2="needleY"
        />
        <circle
          class="gauge-hub"
          :cx="size / 2"
          :cy="size / 2"
          :r="hubRadius"
        />
      </svg>
      <div class="gauge-readout">
        <span class="value-number" data-testid="gauge-value">{{ formattedValue }}</span>
        <span v-if="unit" class="value-unit">{{ unit }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  value: { type: [Number, String], default: null },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  unit: { type: String, default: '' },
  severity: {
    type: String,
    default: 'ok',
    validator: (v) => ['ok', 'warn', 'crit'].includes(v)
  },
  label: { type: String, default: '' }
});

const size = 120;
const hubRadius = 4;
const radius = size / 2 - 10;
// Sweep from -90deg (left) to +90deg (right) along an upper half-circle.
const startAngle = -Math.PI; // 180deg in SVG terms = left
const endAngle = 0; // 0deg = right

function polar(angleFrac) {
  // angleFrac: 0..1 across the sweep
  const angle = startAngle + (endAngle - startAngle) * angleFrac;
  return {
    x: size / 2 + radius * Math.cos(angle),
    y: size / 2 + radius * Math.sin(angle)
  };
}

const numericValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return null;
  const n = Number(props.value);
  return Number.isFinite(n) ? n : null;
});

const clampedFrac = computed(() => {
  const v = numericValue.value;
  if (v === null) return 0;
  const range = props.max - props.min;
  if (range <= 0) return 0;
  const frac = (v - props.min) / range;
  return Math.max(0, Math.min(1, frac));
});

const trackPath = computed(() => {
  const a = polar(0);
  const b = polar(1);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
});

const fillPath = computed(() => {
  if (clampedFrac.value <= 0) return '';
  const a = polar(0);
  const b = polar(clampedFrac.value);
  const largeArc = clampedFrac.value > 0.5 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
});

const needleX = computed(() => {
  const angle = startAngle + (endAngle - startAngle) * clampedFrac.value;
  return size / 2 + (radius - 6) * Math.cos(angle);
});
const needleY = computed(() => {
  const angle = startAngle + (endAngle - startAngle) * clampedFrac.value;
  return size / 2 + (radius - 6) * Math.sin(angle);
});

const formattedValue = computed(() => {
  const v = numericValue.value;
  if (v === null) return '-';
  if (!Number.isFinite(v)) return '-';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
});

const severityClass = computed(() => `severity-${props.severity}`);
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
  justify-content: space-between;
  gap: 12px;
}
.gauge-svg {
  flex-shrink: 0;
  display: block;
}
.gauge-track {
  fill: none;
  stroke: var(--border);
  stroke-width: 8;
  stroke-linecap: round;
}
.gauge-fill {
  fill: none;
  stroke: var(--green, #22c55e);
  stroke-width: 8;
  stroke-linecap: round;
}
.gauge-fill.severity-warn { stroke: #eab308; }
.gauge-fill.severity-crit { stroke: var(--red, #ef4444); }
.gauge-needle {
  stroke: var(--text);
  stroke-width: 2;
  stroke-linecap: round;
}
.gauge-hub {
  fill: var(--text);
}
.gauge-readout {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  color: var(--text);
}
.value-number {
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
}
.value-unit {
  color: var(--muted);
  font-size: 12px;
}
.severity-warn { border-color: #eab308; }
.severity-crit { border-color: var(--red, #ef4444); }
.severity-warn .value-number { color: #eab308; }
.severity-crit .value-number { color: var(--red, #ef4444); }
</style>