export class Scheduler {
  constructor() { this.jobs = []; this.handles = []; }
  add(job) { this.jobs.push(job); }
  start() {
    for (const job of this.jobs) {
      const tick = async () => {
        try { await job.fn(); } catch (e) { if (job.onError) job.onError(e); }
      };
      tick();
      this.handles.push({ name: job.name, handle: setInterval(tick, job.intervalMs) });
    }
  }
  stop() { for (const h of this.handles) clearInterval(h.handle); this.handles = []; }
}