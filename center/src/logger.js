import pino from 'pino';

export function createLogger({ component = 'center', level = 'info' } = {}) {
  return pino({
    level,
    base: { component },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
