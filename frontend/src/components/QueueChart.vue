<template>
  <div ref="chartEl" class="chart" data-testid="queue-chart"></div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

let echartsLib = null;
async function loadEcharts() {
  if (echartsLib) return echartsLib;
  const mod = await import('echarts');
  echartsLib = mod;
  return echartsLib;
}

const props = defineProps({
  points: { type: Array, default: () => [] }
});

const chartEl = ref(null);
let chart = null;
let resizeObserver = null;

function normalizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      capturedAt: p.captured_at || p.capturedAt,
      queueKind: p.queue_kind || p.queueKind,
      messageCount: Number(p.message_count ?? p.messageCount ?? 0)
    }))
    .filter((p) => p.capturedAt && p.queueKind);
}

function buildOption(normPoints) {
  // Group by queue_kind
  const kinds = Array.from(new Set(normPoints.map((p) => p.queueKind)));
  const xSet = new Set();
  const byKind = new Map();
  for (const k of kinds) byKind.set(k, []);
  for (const p of normPoints) {
    xSet.add(p.capturedAt);
    if (!byKind.has(p.queueKind)) {
      kinds.push(p.queueKind);
      byKind.set(p.queueKind, []);
    }
    byKind.get(p.queueKind).push([p.capturedAt, p.messageCount]);
  }
  const xData = Array.from(xSet).sort();
  const series = kinds.map((k) => {
    const raw = byKind.get(k) || [];
    // Map to x-aligned series
    const map = new Map(raw.map((pair) => [pair[0], pair[1]]));
    return {
      name: k,
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: xData.map((x) => map.get(x) ?? null)
    };
  });
  return {
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#94a3b8' }, top: 0 },
    grid: { left: 40, right: 16, top: 32, bottom: 40 },
    xAxis: {
      type: 'category',
      data: xData,
      axisLabel: { color: '#94a3b8', formatter: (v) => String(v).slice(5, 16) }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#334155' } }
    },
    series,
    backgroundColor: 'transparent',
    textStyle: { color: '#e2e8f0' }
  };
}

function render() {
  if (!chart) return;
  const norm = normalizePoints(props.points);
  chart.setOption(buildOption(norm), true);
}

onMounted(async () => {
  await nextTick();
  if (!chartEl.value) return;
  const echarts = await loadEcharts();
  chart = echarts.init(chartEl.value);
  render();
  // Resize observer for responsiveness
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
.chart {
  width: 100%;
  height: 320px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>
