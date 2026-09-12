import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { groundHeight } from '../src/ground.js';

const definitions = [
  [[-1.45, .27, .8], [1.3, .43, -.6], .25], [[1.28, .31, 1.08], [-1.22, .42, -.72], .28],
  [[-.85, .32, 1.4], [.62, .66, -1.15], .23], [[-1.22, .43, -.96], [.1, 1.37, .1], .25],
  [[1.3, .45, -.8], [-.22, 1.4, .3], .24], [[-1.16, .56, .5], [.92, 1.03, -.17], .23],
  [[.85, .52, .95], [-.22, 1.62, -.12], .22],
];
const piece = (radius, extra = {}) => ({ slot: 0, id: 1, wood: 1, char: 0, scale: 1, angle: 0, offset: 0, fuelType: 'log',
  phase: 'burning', addedAt: -1, temperature: .03, ...extra });

// The app leaves this simulation running for hours. A settled, slowly burning
// pile must cost almost nothing between the moments it actually moves.
test('a settled burning pile sleeps between shrink settles instead of solving every frame', () => {
  let calls = 0;
  const counted = (x, z) => { calls++; return groundHeight(x, z); };
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  const state = createLogSettling(definitions, 8108, [], []);
  const wakes = new Map(), asleep = new Map(), previous = new Map(), heightAt = {};
  let lateCalls = 0, lateFrames = 0, lateAwake = 0, time = 0;
  for (let frame = 1; frame <= 30 * 120; frame++) {
    time += 1 / 30; cycle.advance(1 / 30); calls = 0;
    updateLogSettling(state, cycle, time, counted); cycle.setLogPoses(state.logs);
    for (const pose of state.logs) if (pose.live) {
      if (previous.get(pose.slot) && !pose.sleeping) wakes.set(pose.slot, (wakes.get(pose.slot) || 0) + 1);
      if (pose.sleeping) asleep.set(pose.slot, (asleep.get(pose.slot) || 0) + 1);
      previous.set(pose.slot, pose.sleeping);
      for (const point of pose.worldPoints) assert.ok(point.y >= groundHeight(point.x, point.z) - .003, 'wood never sinks through the soil');
    }
    if (frame === 900) for (const pose of state.logs) if (pose.live) heightAt[pose.slot] = pose.y;
    if (frame > 900) { lateCalls += calls; lateFrames++; if (state.logs.some(pose => pose.live && !pose.sleeping)) lateAwake++; }
  }
  const live = state.logs.filter(pose => pose.live);
  assert.ok(live.length >= 3);
  assert.ok(lateAwake / lateFrames < .5, `the pile is awake ${(lateAwake / lateFrames * 100).toFixed(0)}% of settled frames`);
  assert.ok(lateCalls / lateFrames < 1500, `${(lateCalls / lateFrames).toFixed(0)} terrain samples per settled frame`);
  for (const pose of live) {
    assert.ok(asleep.get(pose.slot) / 3600 > .6, `log ${pose.slot} sleeps most of the time`);
    // Thinning wood floats free of its support; a brief wake lets it sink again.
    assert.ok(wakes.get(pose.slot) >= 3, `log ${pose.slot} wakes to settle as it burns`);
  }
  assert.ok(live.some(pose => heightAt[pose.slot] - pose.y > .01), 'burning wood settles lower over time');
});

test('a big log rolls down a gentle slope while a char crumb of the same shape stays put', () => {
  const slope = (x, z) => -.2 + z * .15;
  const travelled = radius => {
    const state = createLogSettling([[[-1, radius, 0], [1, radius, 0], radius]], 21);
    const cycle = { logs: [piece(radius)] };
    updateLogSettling(state, cycle, 0, slope);
    for (let frame = 1; frame <= 240; frame++) updateLogSettling(state, cycle, frame / 60, slope);
    return { z: state.logs[0].z, sleeping: state.logs[0].sleeping };
  };
  const log = travelled(.2), crumb = travelled(.025);
  assert.ok(log.z < -.6, 'the log rolls downhill');
  assert.ok(Math.abs(crumb.z) < .02 && crumb.sleeping, 'rolling resistance holds the crumb where it lies');
});

test('round wood touches the ground along its true lowest line, not a sampled facet', () => {
  const state = createLogSettling([[[-1, .2, 0], [1, .2, 0], .2]], 3);
  const cycle = { logs: [piece(.2)] };
  updateLogSettling(state, cycle, 0, () => -.2);
  for (let frame = 1; frame <= 120; frame++) {
    // Spin the log through arbitrary roll angles; the rest height must not
    // ripple with the facet phase of the sampled collision points.
    state.logs[0].angularVelocity.set(1.5, 0, 0);
    updateLogSettling(state, cycle, frame / 60, () => -.2);
    assert.ok(Math.abs(state.logs[0].y - .012) < .004, `axis height ${state.logs[0].y} stays one radius plus the contact skin above the floor`);
  }
});
