import pino from 'pino';
export function createLogger({ component = 'agent', level = 'info' } = {}) {
  return pino({ level, base: { component } });
}