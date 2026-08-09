import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTypeperfCsv, parseWmicCsv } from '../src/perfmon-collector.js';

test('parseTypeperfCsv handles typical output', () => {
  const csv = `"\\Counter\\Value","03/15/2026 12:00:00.123","5"\n`;
  const out = parseTypeperfCsv(csv);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, '5');
});

test('parseWmicCsv parses rows', () => {
  const csv = `Node,Name,State\r\nHOST,MSExchangeTransport,Running\r\n`;
  const rows = parseWmicCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Name, 'MSExchangeTransport');
});
