import fs from 'node:fs';
import path from 'node:path';

export function writeConfig(configPath, config) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath);
}