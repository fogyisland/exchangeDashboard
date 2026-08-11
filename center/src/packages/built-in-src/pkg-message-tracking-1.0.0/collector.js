// Tails Exchange message tracking logs and counts by event_id in the last 60s window.
// Tracks file position in a sidecar JSON at <installPath>/state/pkg-message-tracking.pos.json.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const LOG_DIR = 'C:\\Program Files\\Microsoft\\Exchange Server\\V15\\TransportRoles\\Logs\\MessageTracking';

export default {
  name: 'pkg-message-tracking',
  async collect({ installPath }) {
    if (process.platform !== 'win32') return [];
    const stateDir = path.join(installPath || '.', 'state');
    await fsp.mkdir(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, 'pkg-message-tracking.pos.json');
    let state = { lastReadBytes: 0, lastReadFile: null };
    try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch {}

    let logFiles = [];
    try { logFiles = (await fsp.readdir(LOG_DIR)).filter((f) => f.endsWith('.LOG')).sort(); } catch { return []; }
    if (logFiles.length === 0) return [];

    // Find the file we were last reading, or the oldest if state is empty.
    let fileName = state.lastReadFile;
    if (!fileName || !logFiles.includes(fileName)) {
      fileName = logFiles[0];
      state.lastReadBytes = 0;
    }
    const filePath = path.join(LOG_DIR, fileName);
    let st;
    try { st = await fsp.stat(filePath); } catch { return []; }

    // If file rolled (smaller than lastReadBytes), start over.
    let start = state.lastReadBytes;
    if (st.size < start) start = 0;

    const fd = await fsp.open(filePath, 'r');
    try {
      const length = Math.max(0, st.size - start);
      if (length === 0) return [];
      const buf = Buffer.alloc(length);
      await fd.read(buf, 0, length, start);
      state.lastReadBytes = st.size;
      state.lastReadFile = fileName;
      await fsp.writeFile(stateFile, JSON.stringify(state));

      const text = buf.toString('utf8');
      const counts = new Map();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        // Format: <date-time>,<client-ip>,<hostname>,<event-id>,<...>
        const parts = line.split(',');
        if (parts.length < 4) continue;
        const eventId = parts[3].trim();
        if (!/^[A-Z]+$/.test(eventId)) continue;
        counts.set(eventId, (counts.get(eventId) || 0) + 1);
      }
      return Array.from(counts, ([event_id, message_count]) => ({ event_id, message_count }));
    } finally {
      await fd.close();
    }
  }
};