<template>
  <div ref="chartEl" class="dag-topology-chart" data-testid="dag-topology-chart"></div>
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
  members: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['server-click']);

const chartEl = ref(null);
let chart = null;
let resizeObserver = null;

function normalize(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({
    server_id: Number(m.server_id ?? m.serverId),
    hostname: m.hostname || m.server_hostname || ('#' + (m.server_id ?? m.serverId)),
    fqdn: m.fqdn || '',
    preferred_activations: m.preferred_activations ?? m.preferredActivations ?? 0,
    replication_enabled:
      m.replication_enabled === undefined && m.replicationEnabled === undefined
        ? 1
        : Number(m.replication_enabled ?? m.replicationEnabled)
  }));
}

function nodeColor(m) {
  return m.replication_enabled === 0 ? '#facc15' /* yellow */ : '#22c55e' /* green */;
}

function buildOption(members) {
  const nodes = members.map((m) => ({
    id: String(m.server_id),
    name: m.hostname,
    value: m.server_id,
    symbolSize: 60,
    itemStyle: { color: nodeColor(m) },
    label: { show: true, color: '#e2e8f0', fontSize: 12 },
    raw: m
  }));
  // Simple ring topology: connect each member to next (n to n+1).
  const edges = [];
  for (let i = 0; i < members.length; i++) {
    const a = members[i];
    const b = members[(i + 1) % members.length];
    if (a.server_id !== b.server_id) {
      edges.push({
        source: String(a.server_id),
        target: String(b.server_id),
        lineStyle: { color: '#64748b', width: 1.5 }
      });
    }
  }
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        if (p.dataType === 'node') {
          const m = members.find((mm) => String(mm.server_id) === p.data.id);
          if (!m) return '';
          return [
            `<b>${m.hostname}</b>`,
            m.fqdn ? `FQDN: ${m.fqdn}` : '',
            `Preferred Activations: ${m.preferred_activations}`,
            `Replication: ${m.replication_enabled ? 'Enabled' : 'Disabled'}`
          ]
            .filter(Boolean)
            .join('<br/>');
        }
        return '';
      }
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        focusNodeAdjacency: true,
        edgeSymbol: ['none', 'none'],
        force: { repulsion: 220, edgeLength: 120 },
        lineStyle: { color: '#64748b', curveness: 0.1 },
        emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
        data: nodes,
        links: edges
      }
    ],
    backgroundColor: 'transparent',
    textStyle: { color: '#e2e8f0' }
  };
}

function render() {
  if (!chart) return;
  const norm = normalize(props.members);
  chart.setOption(buildOption(norm), true);
}

onMounted(async () => {
  await nextTick();
  if (!chartEl.value) return;
  const echarts = await loadEcharts();
  chart = echarts.init(chartEl.value);
  chart.on('click', (params) => {
    if (params?.dataType === 'node' && params.data?.raw) {
      emit('server-click', params.data.raw.server_id);
    }
  });
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
  () => props.members,
  () => render(),
  { deep: true }
);
</script>

<style scoped>
.dag-topology-chart {
  width: 100%;
  height: 360px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>