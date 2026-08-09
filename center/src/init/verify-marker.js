import { hasMarker } from './marker.js';

export function verifyMarker({ configPath }) {
  return hasMarker({ configPath });
}