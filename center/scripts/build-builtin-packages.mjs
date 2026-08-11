#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src/packages/built-in-src');
const DST = path.join(ROOT, 'src/packages/built-in');
fs.mkdirSync(DST, { recursive: true });

const dirs = fs.readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory());
for (const d of dirs) {
  const srcDir = path.join(SRC, d.name);
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  const outPath = path.join(DST, `${d.name}.zip`);
  zip.writeZip(outPath);
  console.log(`built ${outPath}`);
}
