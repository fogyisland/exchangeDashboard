import net from 'node:net';

export function probePort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve({ ok, latencyMs: Date.now() - start }); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}
