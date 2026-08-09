// agent/src/services-collector.js
export class ServicesCollector {
  constructor(perfmon) { this.perfmon = perfmon; }
  async collect() {
    const resources = await this.perfmon.counterMulti([
      '\\Processor(_total)\\% Processor Time',
      '\\Memory\\Available MBytes',
      '\\LogicalDisk(C:)\\% Free Space',
      '\\Network Interface(*)\\Bytes Total/sec'
    ]);
    const wmiRows = await this._wmiServices();
    return {
      services: wmiRows.map((r) => ({ service_name: r.Name, state: r.State, start_mode: r.StartMode })),
      resources: {
        cpu_pct: Number(resources['\\Processor(_total)\\% Processor Time']) || null,
        memory_available_mb: Number(resources['\\Memory\\Available MBytes']) || null,
        disk_c_free_pct: Number(resources['\\LogicalDisk(C:)\\% Free Space']) || null,
        net_bytes_per_sec: Number(resources['\\Network Interface(*)\\Bytes Total/sec']) || null
      }
    };
  }
  async _wmiServices() {
    try {
      return await this.perfmon.wmi('service', ['Name', 'State', 'StartMode']);
    } catch { return []; }
  }
}
