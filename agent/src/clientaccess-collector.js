// agent/src/clientaccess-collector.js
const METRICS = [
  ['RpcClientAccess.AverageLatency',      '\\MSExchange RpcClientAccess\\RPC Average Latency'],
  ['RpcClientAccess.ActiveUsers',        '\\MSExchange RpcClientAccess\\Active User Count'],
  ['ActiveSync.RequestsPerSec',          '\\MSExchange ActiveSync\\ActiveSync Requests/sec'],
  ['ActiveSync.AvgCmdTime',              '\\MSExchange ActiveSync\\Average Command Processing Time'],
  ['MapiHttp.AvgRequestTime',            '\\MSExchange MapiHttp\\Average Request Time'],
  ['OutlookAnywhere.AvgRpcResponseTime', '\\MSExchange Outlook Anywhere\\Average RPC Response Time']
];
export class ClientAccessCollector {
  constructor(perfmon) { this.perfmon = perfmon; }
  async collect() {
    const raw = await this.perfmon.counterMulti(METRICS.map(([, p]) => p));
    return METRICS.map(([metric, path]) => ({ metric, value: Number(raw[path]) || 0 }));
  }
}
