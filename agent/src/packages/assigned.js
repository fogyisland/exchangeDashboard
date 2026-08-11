import fs from 'node:fs/promises';
import path from 'node:path';

function stateFile(installPath) {
  return path.join(installPath, 'packages-installed.json');
}

async function readRaw(installPath) {
  try {
    const raw = await fs.readFile(stateFile(installPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === 'string' && typeof p.version === 'string');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    return [];
  }
}

async function writeRaw(installPath, list) {
  await fs.mkdir(installPath, { recursive: true });
  const tmp = stateFile(installPath) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(list, null, 2));
  await fs.rename(tmp, stateFile(installPath));
}

export async function readInstalled(installPath) {
  return readRaw(installPath);
}

export async function writeInstalled(installPath, list) {
  return writeRaw(installPath, list);
}

export async function recordInstall(installPath, name, version) {
  const list = await readRaw(installPath);
  const existing = list.findIndex((p) => p.name === name);
  if (existing >= 0) list[existing] = { name, version };
  else list.push({ name, version });
  return writeRaw(installPath, list);
}
