import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { createPopState, popRate, updatePops } from '../src/pops.js';
import { random } from '../src/textures.js';

const definitions = [
  [[-1.45, .27, .8], [1.3, .43, -.6], .25], [[1.28, .31, 1.08], [-1.22, .42, -.72], .28],
  [[-.85, .32, 1.4], [.62, .66, -1.15], .23], [[-1.22, .43, -.96], [.1, 1.37, .1], .25],
  [[1.3, .45, -.8], [-.22, 1.4, .3], .24], [[-1.16, .56, .5], [.92, 1.03, -.17], .23],
  [[.85, .52, .95], [-.22, 1.62, -.12], .22],
];
const floor = () => -.2;

function run(cycle, seconds, { gust = 0, seed = 5 } = {}) {
  const state = createPopState(), settling = createLogSettling(definitions, 42), rand = random(seed), pops = [];
  updateLogSettling(settling, cycle, 0, floor);
  for (let frame = 1; frame <= seconds * 30; frame++) {
    const time = frame / 30;
    updateLogSettling(settling, cycle, time, floor);
    pops.push(...updatePops(state, cycle, settling.logs, time, rand, gust).map(pop => ({ ...pop, time })));
  }
  return { pops, settling };
}

test('an established fire pops now and then, from the upper surface of burning wood only', () => {
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  const { pops, settling } = run(cycle, 300);
  assert.ok(pops.length >= 12 && pops.length <= 120, `${pops.length} pops in five minutes`);
  for (const pop of pops) {
    const log = cycle.logs[pop.slot], pose = settling.logs[pop.slot];
    assert.equal(pop.kind, 'pop');
    assert.ok(log.phase !== 'queued' && log.phase !== 'ash', 'pops come from wood on the fire');
    assert.ok(pop.strength > .1 && pop.strength <= .8);
    assert.ok(pop.heat >= .6 && pop.heat <= 1);
    const axisPoint = pose.a.clone().lerp(pose.b, pose.a.distanceTo(pop.position) / pose.a.distanceTo(pose.b));
    assert.ok(pop.position.y >= axisPoint.y - .03, 'the burst leaves the top half of the log');
  }
  for (let i = 1; i < pops.length; i++) assert.ok(pops[i].time - pops[i - 1].time >= .6 - 1e-9, 'pops never machine-gun');
});

test('cold wood never pops, wet wood pops more, and gusts stir the fire', () => {
  const cold = new BurnCycle(8108); cold.setAutoFeed(false);
  for (const log of cold.logs) { log.flame = 0; log.phase = log.phase === 'queued' ? 'queued' : 'cold'; }
  cold.updateSummary();
  assert.equal(popRate(cold), 0);
  assert.equal(run(cold, 120).pops.length, 0);
  const dry = new BurnCycle(8108), wet = new BurnCycle(8108);
  for (const cycle of [dry, wet]) cycle.setAutoFeed(false);
  for (const log of wet.logs) if (log.phase !== 'queued') log.moisture = .25;
  assert.ok(popRate(wet) > popRate(dry) * 3, 'moisture drives the pop rate');
  assert.ok(popRate(dry, 1) > popRate(dry, 0));
  const state = createPopState(), rand = random(1);
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  const settling = createLogSettling(definitions, 42); updateLogSettling(settling, cycle, 0, floor);
  updatePops(state, cycle, settling.logs, 0, rand); const scheduled = state.next;
  assert.ok(scheduled > .6);
  cycle.reset(99);
  updatePops(state, cycle, settling.logs, 1, rand);
  assert.notEqual(state.token, null); assert.notEqual(state.next, scheduled, 'a new fire starts a new schedule');
});
