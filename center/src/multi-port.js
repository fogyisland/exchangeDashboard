import http from 'node:http';

export function startServers({ webApp, heartbeatApp, reportApp, ports, logger }) {
  const handles = {};
  for (const [name, app, port] of [
    ['web', webApp, ports.web],
    ['heartbeat', heartbeatApp, ports.heartbeat],
    ['report', reportApp, ports.report]
  ]) {
    const server = http.createServer(app);
    server.listen(port, () => logger.info({ port, name }, 'listening'));
    handles[name] = server;
  }
  return handles;
}

export async function closeAll(handles) {
  for (const h of Object.values(handles)) {
    await new Promise((r) => h.close(() => r()));
  }
}
