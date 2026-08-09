import axios from 'axios';
import { urlFor } from './url.js';

export function startHeartbeat({ config, logger, getSummary }) {
  let stopped = false;
  const url = urlFor(config.center.baseUrl, config.center.heartbeatPort, config.center.heartbeatPath);
  const tick = async () => {
    if (stopped) return;
    try {
      await axios.post(url, {
        agentId: config.agentId,
        hostname: getSummary().hostname,
        ts: new Date().toISOString(),
        summary: getSummary()
      }, { timeout: config.center.requestTimeoutMs });
    } catch (e) {
      logger.warn({ err: e.message }, 'heartbeat failed');
    }
  };
  tick();
  const handle = setInterval(tick, config.center.heartbeatIntervalMs);
  return { stop: () => { stopped = true; clearInterval(handle); } };
}