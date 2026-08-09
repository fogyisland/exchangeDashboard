import axios from 'axios';
import { urlFor } from './url.js';

export function startReporter({ config, logger, queue, getSnapshot }) {
  let stopped = false;
  const url = urlFor(config.center.baseUrl, config.center.reportPort, config.center.reportPath);

  const sendOne = async (item) => {
    try {
      await axios.post(url, item.payload, { timeout: config.center.requestTimeoutMs });
      await queue.remove(item.id);
    } catch (e) {
      const backoff = Math.min((item.attempts + 1) * 30_000, config.localQueue.maxBackoffMs);
      await queue.bump(item.id, Date.now() + backoff);
      logger.warn({ err: e.message, attempts: item.attempts + 1 }, 'report failed');
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      // First, drain backlog
      const items = await queue.dequeueAll();
      for (const item of items) await sendOne(item);
      // Then enqueue the new snapshot
      const snapshot = await getSnapshot();
      await queue.enqueue(snapshot);
      // Try to send the just-enqueued snapshot immediately
      const fresh = await queue.dequeueAll();
      for (const item of fresh) await sendOne(item);
    } catch (e) {
      logger.error({ err: e.message }, 'reporter tick failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.reportIntervalMs);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}