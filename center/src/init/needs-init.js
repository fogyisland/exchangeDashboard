import fs from 'node:fs';
import { hasMarker } from './marker.js';

export function checkNeedsInit({ configPath }) {
  if (!fs.existsSync(configPath)) return true;
  return !hasMarker({ configPath });
}