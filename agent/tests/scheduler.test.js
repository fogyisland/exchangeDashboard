import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.js';

test('Scheduler fires jobs at their intervals', async () => {
  const sched = new Scheduler();
  const ticks = { a: 0, b: 0 };
  sched.add({ name: 'a', intervalMs: 30, fn: () => { ticks.a++; } });
  sched.add({ name: 'b', intervalMs: 50, fn: () => { ticks.b++; } });
  sched.start();
  await new Promise((r) => setTimeout(r, 175));
  sched.stop();
  assert.ok(ticks.a >= 3, `expected ticks.a >= 3, got ${ticks.a}`);
  assert.ok(ticks.b >= 2, `expected ticks.b >= 2, got ${ticks.b}`);
});