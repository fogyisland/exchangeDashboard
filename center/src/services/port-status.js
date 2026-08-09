import { probePort } from './ports.js';

export async function getPortStates({ webHost, webPort, heartbeatHost, heartbeatPort, reportHost, reportPort }) {
  const [web, heartbeat, report] = await Promise.all([
    probePort(webHost, webPort),
    probePort(heartbeatHost, heartbeatPort),
    probePort(reportHost, reportPort)
  ]);
  return { web, heartbeat, report };
}
