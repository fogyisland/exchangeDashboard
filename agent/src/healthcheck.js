export function healthcheck({ logger }) {
  setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > 512 * 1024 * 1024) logger.warn({ heapUsed: mem.heapUsed }, 'high memory');
  }, 60_000).unref();
}