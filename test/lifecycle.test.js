import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';

const physicalState = cycle => ({ time: cycle.time, coalHeat: cycle.coalHeat, coalMass: cycle.coalMass, ashMass: cycle.ashMass, logs: cycle.logs });

test('a seed reproduces the starting fuel, heat, moisture, and feed schedule', () => {
  const first = new BurnCycle(42), second = new BurnCycle(42), different = new BurnCycle(43);
  assert.deepEqual(physicalState(first), physicalState(second));
  assert.notDeepEqual(physicalState(first), physicalState(different));
  first.advance(3200); first.reset(42);
  assert.deepEqual(physicalState(first), physicalState(second));
  assert.equal(first.events.length, 1); assert.equal(first.remainder, 0);
});

test('accelerated time preserves the same fuel and heat integration', () => {
  const realtime = new BurnCycle(8108), fast = new BurnCycle(8108);
  for (let i = 0; i < 18000; i++) realtime.advance(1 / 30);
  for (let i = 0; i < 15; i++) fast.advance(40);
  assert.deepEqual(physicalState(realtime), physicalState(fast));
});

test('automatic feeding places one intact log at a time and stops after the finite queue', () => {
  const cycle = new BurnCycle(7), queued = cycle.queued;
  cycle.advance(Math.ceil(cycle.nextFeed * 2) / 2);
  const fresh = cycle.logs.filter(l => l.phase === 'fresh');
  assert.equal(fresh.length, 1); assert.equal(fresh[0].wood, 1); assert.equal(fresh[0].char, 0);
  assert.equal(cycle.queued, queued - 1);
  cycle.advance(12000);
  assert.equal(cycle.serial, 7); assert.equal(cycle.queued, 0);
  assert.equal(cycle.events.filter(e => e.title.endsWith('added')).length, queued);
});

test('a fresh log can ignite from retained coals after all visible flame is gone', () => {
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  while (cycle.logs.some(l => l.phase !== 'queued' && l.phase !== 'ash') && cycle.time < 5000) cycle.advance(5);
  assert.equal(cycle.flame, 0); assert.ok(cycle.coalHeat > .5);
  assert.equal(cycle.addLog(), true);
  const added = cycle.logs.find(l => l.addedAt === cycle.time);
  assert.equal(added.wood, 1); assert.equal(added.everLit, false);
  cycle.advance(350);
  assert.equal(added.everLit, true); assert.ok(added.flame > .1);
  assert.ok(cycle.events.some(e => e.detail === 'Retained coal heat ignited the wood'));
});

test('cold coals cannot ignite new wood and replenishing a slot retains its ash', () => {
  const cycle = new BurnCycle(42); cycle.advance(12000);
  assert.equal(cycle.coalHeat, 0); assert.equal(cycle.flame, 0);
  assert.equal(cycle.addLog(), true);
  const added = cycle.logs.find(l => l.phase === 'fresh');
  assert.equal(cycle.ashDeposits[added.slot], 1);
  cycle.advance(1800);
  assert.equal(added.everLit, false); assert.equal(added.phase, 'cold'); assert.equal(added.wood, 1);
});

test('stopping feed holds queued logs and manual addition takes exactly one', () => {
  const cycle = new BurnCycle(90); cycle.setAutoFeed(false); const count = cycle.queued;
  cycle.advance(300); assert.equal(cycle.queued, count);
  cycle.addLog(); assert.equal(cycle.queued, count - 1);
  while(cycle.queued) cycle.addLog();
  assert.equal(cycle.canAdd, false); assert.equal(cycle.addLog(), false);
});

test('complete seeded cycles shed char, leave ash, and extinguish without negative fuel', () => {
  for (let seed = 1; seed <= 32; seed++) {
    const cycle = new BurnCycle(seed);
    for (let minute = 0; minute < 200; minute++) {
      cycle.advance(60);
      assert.ok(Number.isFinite(cycle.coalHeat) && cycle.coalHeat >= 0 && cycle.coalHeat <= 1);
      assert.ok(cycle.coalMass >= 0);
      for (const log of cycle.logs) {
        assert.ok(log.wood >= 0 && log.char >= 0 && log.moisture >= 0);
        assert.ok(log.flame >= 0 && log.flame <= 1);
      }
    }
    assert.equal(cycle.phase, 'Cold fire bed', `seed ${seed}`);
    assert.equal(cycle.fuel, 0, `seed ${seed}`); assert.equal(cycle.flame, 0); assert.equal(cycle.coalHeat, 0);
    assert.ok(cycle.logs.every(l => l.phase === 'ash' && l.shed > 0));
    assert.ok(cycle.ashMass > .5); assert.ok(cycle.ashDeposits.every(value => value === 1));
  }
});
