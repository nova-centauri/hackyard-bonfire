import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityGovernor, TIERS, TIER_SETTINGS, pixelRatioFor, sizeCap, startingTier } from '../src/quality.js';

const run = (governor, { frames, interval, cpu = 4, from }) => {
  let now = from, changes = [];
  for (let i = 0; i < frames; i++) { now += interval; const tier = governor.observe(interval, cpu, now); if (tier) changes.push({ tier, at: now }); }
  return { now, changes };
};

test('tiers are ordered and every tier costs no more than the one above it', () => {
  for (let i = 1; i < TIERS.length; i++) {
    const lower = TIER_SETTINGS[TIERS[i - 1]], upper = TIER_SETTINGS[TIERS[i]];
    for (const key of ['pixelRatio', 'pixelBudget', 'fireSteps', 'smokeSteps', 'octaves', 'msaa', 'shadowSize', 'emberDensity'])
      assert.ok(lower[key] <= upper[key], `${key} must not exceed the next tier (${TIERS[i - 1]} vs ${TIERS[i]})`);
    assert.ok(lower.shadowInterval >= upper.shadowInterval);
  }
});

test('small windows cap the tier and the drawing buffer shrinks with the window', () => {
  assert.equal(sizeCap(1920, 1080), 'ultra'); assert.equal(sizeCap(1280, 500), 'high');
  assert.equal(sizeCap(640, 400), 'medium'); assert.equal(sizeCap(320, 240), 'low'); assert.equal(sizeCap(200, 150), 'minimal');
  assert.equal(startingTier('ultra'), 'high'); assert.equal(startingTier('low'), 'low');
  // A 4K retina window is bounded by the pixel budget, not the device ratio.
  const large = pixelRatioFor('high', 2560, 1440, 2);
  assert.ok(large < 1 && Math.abs(large * large * 2560 * 1440 - TIER_SETTINGS.high.pixelBudget) < 1);
  assert.equal(pixelRatioFor('high', 800, 500, 1), 1);
  assert.equal(pixelRatioFor('minimal', 300, 200, 2), .75);
  assert.ok(Math.abs(pixelRatioFor('ultra', 1200, 800, 3) - Math.sqrt(TIER_SETTINGS.ultra.pixelBudget / (1200 * 800))) < 1e-9, 'the budget wins over the tier ratio cap for a big retina window');
});

test('sustained dropped frames step the tier down after the settle period, one step at a time', () => {
  const governor = new QualityGovernor({ tier: 'high', now: 0 });
  // Settle window and a half-full sample window produce no decisions.
  assert.deepEqual(run(governor, { frames: 40, interval: 60, from: 0 }).changes, []);
  const first = run(governor, { frames: 50, interval: 60, from: 40 * 60 });
  assert.deepEqual(first.changes.map(c => c.tier), ['medium']);
  assert.ok(first.changes[0].at >= 3000);
  // Still dropping after the next settle: another step, never two at once.
  const second = run(governor, { frames: 50, interval: 60, from: first.now });
  assert.deepEqual(second.changes.map(c => c.tier), ['low']);
  assert.ok(second.changes[0].at - first.changes[0].at >= 3000);
});

test('steady pacing with idle CPU earns an upgrade only after the delay, up to the size cap', () => {
  const governor = new QualityGovernor({ tier: 'medium', cap: 'high', now: 0 });
  const early = run(governor, { frames: 200, interval: 33.4, cpu: 3, from: 0 });
  assert.deepEqual(early.changes, [], 'no upgrade inside the 8 s delay');
  const later = run(governor, { frames: 200, interval: 33.4, cpu: 3, from: early.now });
  assert.deepEqual(later.changes.map(c => c.tier), ['high']);
  const capped = run(governor, { frames: 600, interval: 33.4, cpu: 3, from: later.now });
  assert.deepEqual(capped.changes, [], 'the size cap is never exceeded');
  // Busy CPU with steady pacing means no headroom: stay put.
  const busy = new QualityGovernor({ tier: 'medium', cap: 'high', now: 0 });
  assert.deepEqual(run(busy, { frames: 600, interval: 33.4, cpu: 20, from: 0 }).changes, []);
});

test('an upgrade that causes drops is reverted and retried later with a doubled delay', () => {
  const governor = new QualityGovernor({ tier: 'medium', cap: 'high', now: 0 });
  let state = run(governor, { frames: 400, interval: 33.4, cpu: 3, from: 0 });
  assert.equal(state.changes.at(-1).tier, 'high');
  const failure = run(governor, { frames: 45, interval: 55, cpu: 3, from: state.now });
  assert.deepEqual(failure.changes.map(c => c.tier), ['medium']);
  assert.equal(governor.upgradeDelay, 16000);
  const retry = run(governor, { frames: 400, interval: 33.4, cpu: 3, from: failure.now });
  assert.deepEqual(retry.changes, [], 'the second attempt waits twice as long');
  const eventually = run(governor, { frames: 200, interval: 33.4, cpu: 3, from: retry.now });
  assert.deepEqual(eventually.changes.map(c => c.tier), ['high']);
});

test('a shrinking window lowers the tier immediately and a lock stops the governor', () => {
  const governor = new QualityGovernor({ tier: 'high', now: 0 });
  assert.equal(governor.setCap('low', 1000), 'low'); assert.equal(governor.tier, 'low');
  assert.equal(governor.setCap('ultra', 2000), null, 'growing again waits for measured headroom');
  governor.lock('minimal');
  assert.deepEqual(run(governor, { frames: 600, interval: 33.4, cpu: 2, from: 3000 }).changes, []);
  assert.equal(governor.tier, 'minimal');
  assert.equal(new QualityGovernor({ tier: 'ultra', cap: 'medium' }).tier, 'medium');
});
