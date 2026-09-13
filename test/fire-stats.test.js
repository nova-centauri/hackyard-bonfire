import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';
import { loadPreferences, savePreferences, sanitizeStats } from '../src/preferences.js';
import { createFireStats, cycleIdentity, formatDuration, renderFireStats } from '../src/fire-stats.js';
import { createSceneCycle } from '../src/fire-scenes.js';

const memory = () => { const map = new Map(); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map }; };
const zeros = { fires: 0, pieces: 0, burnSeconds: 0, tended: 0, pops: 0 };

test('stats sanitize garbage, keep finite burn-clock seconds, and ride along with preferences', () => {
  assert.deepEqual(sanitizeStats(undefined), zeros);
  assert.deepEqual(sanitizeStats([]), zeros);
  assert.deepEqual(sanitizeStats({ fires: -3, pieces: 1.9, burnSeconds: Infinity, tended: 'x', pops: 2 }),
    { fires: 0, pieces: 1, burnSeconds: 0, tended: 0, pops: 2 });
  assert.equal(sanitizeStats({ burnSeconds: 12.5 }).burnSeconds, 12.5);
  const storage = memory();
  assert.deepEqual(loadPreferences(storage).stats, zeros);
  assert.equal(savePreferences({ sound: true }, storage).stats.fires, 0);
  savePreferences({ stats: { fires: 4, pieces: 9 } }, storage);
  assert.deepEqual(savePreferences({ volume: .4 }, storage).stats, { fires: 4, pieces: 9, burnSeconds: 0, tended: 0, pops: 0 });
  assert.equal(loadPreferences(storage).sound, true);
  assert.equal(loadPreferences(storage).volume, .4);
  storage.setItem('bonfire.preferences.v2', JSON.stringify({ focus: false, stats: { fires: 'nope' } }));
  assert.deepEqual(loadPreferences(storage).stats, zeros);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const stats = createFireStats({ storage: broken });
  const cycle = new BurnCycle(3);
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().fires, 1);
  stats.flush();
});

test('a fire is a burn cycle start, fuel is pieces placed on the bed, and burn time is the burn clock', () => {
  const storage = memory();
  const stats = createFireStats({ storage, persistBurnEvery: 1e9 });
  const cycle = new BurnCycle(42);
  const opening = cycle.piecesPlaced;
  assert.equal(opening, cycle.logs.filter(log => log.phase !== 'queued').length);
  assert.equal(cycle.feedCount, 0);
  const started = stats.observeCycle(cycle);
  assert.equal(started.fires, 1); assert.equal(started.pieces, opening);
  assert.deepEqual(stats.snapshot(), { fires: 1, pieces: opening, burnSeconds: 0, tended: 0, pops: 0 });
  cycle.advance(40);
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().burnSeconds, 40);
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().burnSeconds, 40, 'a second look at the same burn time does not double-count');
  assert.equal(cycle.addLog(), true);
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().pieces, opening + 1);
  assert.equal(stats.snapshot().tended, 0);
  assert.equal(cycle.addLog(undefined, { tended: true }), true);
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().tended, 1);
  assert.equal(stats.snapshot().pieces, opening + 2);
  const animationTime = 999;
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().burnSeconds, 40, `animation time ${animationTime} is not the burn clock`);
  cycle.reset(99);
  stats.observeCycle(cycle);
  assert.equal(stats.snapshot().fires, 2);
  assert.equal(stats.snapshot().burnSeconds, 40, 'reset does not add wall time; the new fire starts at burn time 0');
  assert.equal(cycleIdentity(cycle), `${cycle.seed}:${cycle.resetSerial}`);
});

test('lifetime totals persist and accumulate across a simulated reload', () => {
  const storage = memory();
  const first = createFireStats({ storage, persistBurnEvery: 1e9 });
  const fire = new BurnCycle(7);
  const opening = fire.piecesPlaced;
  first.observeCycle(fire);
  fire.advance(120);
  assert.equal(fire.addLog(undefined, { tended: true }), true);
  first.observeCycle(fire);
  first.observePops({ serial: 3 });
  first.flush();
  const saved = loadPreferences(storage).stats;
  assert.equal(saved.fires, 1);
  assert.equal(saved.pieces, opening + 1);
  assert.equal(saved.burnSeconds, 120);
  assert.equal(saved.tended, 1);
  assert.equal(saved.pops, 3);

  const second = createFireStats({ storage, persistBurnEvery: 1e9 });
  assert.deepEqual(second.snapshot(), saved, 'reload restores the same totals before a new fire is observed');
  const next = new BurnCycle(11);
  second.observeCycle(next);
  next.advance(60);
  second.observeCycle(next);
  second.observePops({ serial: 2 });
  second.flush();
  const totals = second.snapshot();
  assert.equal(totals.fires, 2);
  assert.equal(totals.pieces, opening + 1 + next.piecesPlaced);
  assert.equal(totals.burnSeconds, 180);
  assert.equal(totals.tended, 1);
  assert.equal(totals.pops, 5);
  assert.equal(loadPreferences(storage).stats.burnSeconds, 180);
});

test('burn seconds follow cycle.advance, not a wall or animation interval, including after a reload', () => {
  const storage = memory();
  const stats = createFireStats({ storage, persistBurnEvery: 1e9 });
  const slow = new BurnCycle(8108), fast = new BurnCycle(8108);
  stats.observeCycle(slow);
  slow.advance(1 / 30 * 60);
  stats.observeCycle(slow);
  const afterRealtime = stats.snapshot().burnSeconds;
  stats.observeCycle(fast);
  fast.advance(40);
  stats.observeCycle(fast);
  assert.equal(afterRealtime, 2);
  assert.equal(stats.snapshot().burnSeconds, 42, 'two fires: 2s of 1/30 steps plus 40s of a long step');
  stats.flush();
  const reloaded = createFireStats({ storage, persistBurnEvery: 1e9 });
  const again = new BurnCycle(1);
  reloaded.observeCycle(again);
  again.advance(8);
  reloaded.observeCycle(again);
  reloaded.flush();
  assert.equal(reloaded.snapshot().burnSeconds, 50);
});

test('formatDuration is a quiet clock, not a dashboard', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(65), '01:05');
  assert.equal(formatDuration(3600), '1:00:00');
  assert.equal(formatDuration(90061), '1d 01:01:01');
  const html = renderFireStats({ fires: 2, pieces: 11, burnSeconds: 65, tended: 4, pops: 8 }, { fires: 40, pieces: 90, burnSeconds: 120 });
  assert.match(html, /Here/);
  assert.match(html, /Everyone/);
  assert.match(html, /Fires/);
  assert.match(html, />2</);
  assert.match(html, />40</);
  assert.match(html, /01:05/);
  assert.match(html, /Burn-clock time in this browser/);
  assert.match(html, /—/);
});

test('a hearth fire counts the mouth bed, not the pit’s seven slots', () => {
  const stove = createSceneCycle('stove', 4);
  assert.equal(stove.logs.length, 3);
  assert.equal(stove.piecesPlaced, stove.logs.filter(log => log.phase !== 'queued').length);
  const storage = memory();
  const stats = createFireStats({ storage, persistBurnEvery: 1e9 });
  stats.observeCycle(stove);
  assert.equal(stats.snapshot().fires, 1);
  assert.equal(stats.snapshot().pieces, stove.piecesPlaced);
});
