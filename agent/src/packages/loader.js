import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadManifest } from './manifest.js';

export class PackagesLoader {
  constructor({ packagesDir, logger }) {
    this.packagesDir = packagesDir;
    this.logger = logger || { warn() {}, info() {} };
    this.loaded = [];
  }

  async loadAll() {
    this.loaded = [];
    let entries = [];
    try { entries = await fs.readdir(this.packagesDir, { withFileTypes: true }); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      try {
        const loaded = await loadManifest(this.packagesDir, name);
        if (!loaded) continue;
        const collectorPath = path.join(loaded.cachePath, 'collector.js');
        const mod = await import(pathToFileURL(collectorPath).href);
        const def = mod.default;
        if (!def || typeof def !== 'object' || typeof def.name !== 'string' || typeof def.collect !== 'function') {
          this.logger.warn({ pkg: name }, 'package default export invalid; skipping');
          continue;
        }
        const timeoutMs = loaded.manifest.agent?.timeoutMs ?? 30000;
        this.loaded.push({
          name,
          manifest: loaded.manifest,
          metricTable: loaded.manifest.database.metricTable,
          collector: def,
          timeoutMs,
          cachePath: loaded.cachePath
        });
      } catch (e) {
        this.logger.warn({ pkg: name, err: e.message }, 'failed to load package; skipping');
      }
    }
    return this.loaded;
  }

  listLoaded() { return this.loaded; }

  async invokeCollect(name, ctx, { timeoutMs } = {}) {
    const pkg = this.loaded.find((p) => p.name === name);
    if (!pkg) throw new Error(`package ${name} not loaded`);
    const ms = timeoutMs ?? pkg.timeoutMs;
    let timer;
    try {
      return await Promise.race([
        pkg.collector.collect(ctx),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`collect timeout after ${ms}ms`)), ms); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}