<template>
  <div class="timeseries-tile tile" data-testid="timeseries-tile">
    <div class="tile-header">
      <div class="tile-title" :title="label">{{ label }}</div>
      <div v-if="latest !== null" class="tile-latest" data-testid="timeseries-latest">
        <span class="latest-number">{{ formattedLatest }}</span>
        <span v-if="unit" class="latest-unit">{{ unit }}</span>
      </div>
    </div>
    <div ref="chartEl" class="chart" data-testid="timeseries-chart" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue';

let echartsLib = null;
async function loadEcharts() {
  if (echartsLib) return echartsLib;
  const mod = await import('echarts');
  echartsLib = mod;
  return echartsLib;
}

const props = defineProps({
  points: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  unit: { type: String, default: '' }
});

const chartEl = ref(null);
let chart = null;
let resizeObserver = null;

function normalizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      ts: p.ts || p.captured_at || p.capturedAt || p.t || null,
      value: Number(p.value ?? p.v ?? 0)
    }))
    .filter((p) => p.ts !== null && Number.isFinite(p.value));
}

const normalized = computed(() => normalizePoints(props.points));

const latest = computed(() => {
  if (normalized.value.length === 0) return null;
  return normalized.value[normalized.value.length - 1].value;
});

const formattedLatest = computed(() => {
  const v = latest.value;
  if (v === null) return '-';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
});

function buildOption(data) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 12, top: 16, bottom: 28 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.ts),
      axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v) => String(v).slice(5, 16) },
      axisLine: { lineStyle: { color: '#334155' } }
    },
    yAxis: {
      type: 'value',
      name: props.unit || '',
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      axisLabel: { color: '#94a3b8', fontSize: 10 },
      splitLine: { lineStyle: { color: '#334155' } }
    },
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: data.map((d) => d.value),
        lineStyle: { color: '#38bdf8', width: 2 },
        areaStyle: { color: 'rgba(56, 189, 248, 0.12)' }
      }
    ],
    backgroundColor: 'transparent',
    textStyle: { color: '#e2e8f0' }
  };
}

function render() {
  if (!chart) return;
  chart.setOption(buildOption(normalized.value), true);
}

onMounted(async () => {
  await nextTick();
  if (!chartEl.value) return;
  const echarts = await loadEcharts();
  chart = echarts.init(chartEl.value);
  render();
  resizeObserver = new ResizeObserver(() => {
    if (chart) chart.resize();
  });
  resizeObserver.observe(chartEl.value);
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart) {
    chart.dispose();
    chart = null;
  }
});

watch(
  () => props.points,
  () => render(),
  { deep: true }
);
</script>

<style scoped>
.tile {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.tile-latest {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: var(--text);
}
.latest-number {
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
}
.latest-unit {
  color: var(--muted);
  font-size: 11px;
}
.chart {
  width: 100%;
  height: 180px;
}
</style>