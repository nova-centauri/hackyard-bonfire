import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { ACTIVITY_CAP, LOUD_POP_SPACING, createPopState, fireActivity, popRate, updatePops } from '../src/pops.js';
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
    if (pop.loud) assert.ok(pop.strength > 1 && pop.strength <= 1.6, 'a loud pop is stronger than any ordinary one');
    else assert.ok(pop.strength > .1 && pop.strength <= .8);
    assert.ok(pop.heat >= .6 && pop.heat <= 1);
    const axisPoint = pose.a.clone().lerp(pose.b, pose.a.distanceTo(pop.position) / pose.a.distanceTo(pose.b));
    assert.ok(pop.position.y >= axisPoint.y - .03, 'the burst leaves the top half of the log');
  }
  for (let i = 1; i < pops.length; i++) assert.ok(pops[i].time - pops[i - 1].time >= .6 - 1e-9, 'pops never machine-gun');
});

test('the restlessness envelope is seeded, smooth, averages one and falls silent for stretches', () => {
  let sum = 0, count = 0, quiet = 0, longestLull = 0, lull = 0, maxStep = 0;
  for (let seed = 1; seed <= 12; seed++) {
    let previous = null;
    for (let t = 0; t < 1800; t += 1 / 30) {
      const value = fireActivity(t, seed * 1013);
      assert.ok(value >= 0 && value <= ACTIVITY_CAP);
      if (previous !== null) maxStep = Math.max(maxStep, Math.abs(value - previous));
      previous = value; sum += value; count++;
      if (value < .05) { quiet++; lull += 1 / 30; longestLull = Math.max(longestLull, lull); } else lull = 0;
    }
  }
  const mean = sum / count, quietShare = quiet / count;
  assert.ok(Math.abs(mean - 1) < .15, `mean activity ${mean.toFixed(3)} keeps the long-run pop count`);
  assert.ok(quietShare > .1 && quietShare < .32, `quiet share ${quietShare.toFixed(3)}`);
  assert.ok(longestLull > 20, `lulls last long enough to notice (${longestLull.toFixed(1)} s)`);
  assert.ok(maxStep < .02, 'the envelope never jumps between frames');
  assert.equal(fireActivity(123.4, 7), fireActivity(123.4, 7));
  assert.notEqual(fireActivity(123.4, 7), fireActivity(123.4, 8), 'each fire has its own moods');
  assert.equal(popRate({ logs: [] }, 0, 2), 0);
});

test('pops cluster in lively spells and thin out in lulls, and loud pops are rare and spaced apart', () => {
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  const { pops } = run(cycle, 900, { seed: 11 });
  const gaps = pops.slice(1).map((pop, i) => pop.time - pops[i].time);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(Math.max(...gaps) > mean * 3.5, `a ${Math.max(...gaps).toFixed(1)} s silence against a ${mean.toFixed(1)} s mean gap`);
  assert.ok(gaps.filter(gap => gap < mean * .4).length > gaps.length * .2, 'spells of quick successive pops');
  // A pop is likelier during a lively spell than during a lull.
  const activityAt = pops.map(pop => fireActivity(pop.time, cycle.seed));
  const meanActivityAtPops = activityAt.reduce((a, b) => a + b, 0) / activityAt.length;
  assert.ok(meanActivityAtPops > 1.3, `pops arrive when the fire is restless (${meanActivityAtPops.toFixed(2)})`);
  const loud = pops.filter(pop => pop.loud);
  assert.ok(loud.length >= 2 && loud.length <= 20, `${loud.length} loud pops in fifteen minutes`);
  for (let i = 1; i < loud.length; i++) assert.ok(loud[i].time - loud[i - 1].time >= LOUD_POP_SPACING, 'loud pops are spaced out');
  for (const pop of loud) { assert.equal(pop.heat, 1); assert.ok(pop.strength >= 1.1); }
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
  assert.ok(popRate(dry, 0, 2) > popRate(dry, 0, 1), 'a lively spell raises the rate');
  const paper = new BurnCycle(8108), wood = new BurnCycle(8108);
  for (const cycle of [paper, wood]) cycle.setAutoFeed(false);
  for (const log of wood.logs) if (log.phase !== 'queued') { log.fuelType = 'log'; log.moisture = .2; log.flame = 1; }
  for (const log of paper.logs) if (log.phase !== 'queued') { log.fuelType = 'newspaper'; log.moisture = .02; log.flame = 1; }
  wood.updateSummary(); paper.updateSummary();
  assert.ok(popRate(paper) < popRate(wood) * .4, 'newsprint barely pops compared with wet wood');
  const state = createPopState(), rand = random(1);
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  const settling = createLogSettling(definitions, 42); updateLogSettling(settling, cycle, 0, floor);
  updatePops(state, cycle, settling.logs, 0, rand); const scheduled = state.next;
  assert.ok(scheduled > 0);
  cycle.reset(99);
  updatePops(state, cycle, settling.logs, 1, rand);
  assert.notEqual(state.token, null); assert.notEqual(state.next, scheduled, 'a new fire starts a new schedule');
});
