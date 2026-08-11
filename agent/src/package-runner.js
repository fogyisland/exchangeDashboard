import { PackagesLoader } from './packages/loader.js';
import { readInstalled, recordInstall } from './packages/assigned.js';
import { pullPackage } from './packages/pull.js';
import path from 'node:path';

export class PackageRunner {
  constructor({ installPath, logger, http, downloadUrlBase }) {
    this.installPath = installPath;
    this.logger = logger || { warn() {}, info() {} };
    this.http = http;
    this.downloadUrlBase = downloadUrlBase; // e.g. 'http://center:8080'
    this.loader = new PackagesLoader({ packagesDir: path.join(installPath, 'packages'), logger: this.logger });
  }

  async loadInstalled() {
    return this.loader.loadAll();
  }

  listLoaded() {
    return this.loader.listLoaded();
  }

  async invoke(name, ctx) {
    return this.loader.invokeCollect(name, ctx);
  }

  /**
   * Reconcile this agent's installed set with the diff returned by the center.
   * @param {Array<{name, version, downloadUrl}>} pendingInstalls
   */
  async reconcile(pendingInstalls, agentCtx) {
    if (!Array.isArray(pendingInstalls) || pendingInstalls.length === 0) return { pulled: 0, failed: 0 };
    let pulled = 0;
    let failed = 0;
    for (const p of pendingInstalls) {
      try {
        // downloadUrl may be a path ('/api/...') or a full URL; if path, prepend the base.
        const url = p.downloadUrl.startsWith('http') ? p.downloadUrl : `${this.downloadUrlBase}${p.downloadUrl}`;
        await pullPackage({
          name: p.name, version: p.version, downloadUrl: url,
          installPath: this.installPath, http: this.http, logger: this.logger
        });
        await recordInstall(this.installPath, p.name, p.version);
        pulled++;
      } catch (e) {
        this.logger.warn({ pkg: p.name, err: e.message }, 'pullPackage failed');
        failed++;
      }
    }
    if (pulled > 0) {
      // Reload the loader so new collectors are picked up.
      await this.loadInstalled();
    }
    return { pulled, failed };
  }

  async readInstalledSnapshot() {
    return readInstalled(this.installPath);
  }
}