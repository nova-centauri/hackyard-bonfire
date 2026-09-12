import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';

const physicalState = cycle => ({ time: cycle.time, coalHeat: cycle.coalHeat, coalMass: cycle.coalMass, ashMass: cycle.ashMass, logs: cycle.logs });

// Match the wood, bed, and placement so only the tested condition changes.
const isolatedLog = (moisture, coreHeat = .9) => {
  const cycle = new BurnCycle(100); cycle.setAutoFeed(false);
  for (const log of cycle.logs) { log.phase = 'queued'; log.flame = 0; }
  cycle.coalHeat = coreHeat; cycle.coalMass = .65;
  const log = cycle.logs[0];
  Object.assign(log, { wood: 1, char: 0, ash: 0, moisture, initialMoisture: moisture, temperature: .025,
    flame: 0, density: 1, addedAt: 0, phase: 'fresh', everLit: false, shed: 0, shedNotice: 0 });
  cycle.updateSummary();
  return { cycle, log };
};

test('a seed reproduces the starting fuel, heat, moisture, and feed schedule', () => {
  const first = new BurnCycle(42), second = new BurnCycle(42), different = new BurnCycle(43);
  assert.deepEqual(physicalState(first), physicalState(second));
  assert.notDeepEqual(physicalState(first), physicalState(different));
  first.advance(3200); first.reset(42);
  assert.deepEqual(physicalState(first), physicalState(second));
  assert.equal(first.events.length, 1); assert.equal(first.remainder, 0);
});

test('every log carries its own moisture and initial moisture survives drying', () => {
  const cycle = new BurnCycle(42);
  assert.equal(new Set(cycle.logs.map(log => log.moisture)).size, cycle.logs.length);
  for (const log of cycle.logs) {
    assert.ok(log.moisture > 0 && log.moisture < 1);
    assert.equal(log.initialMoisture, log.moisture);
    if (log.phase === 'queued') assert.ok(log.moisture >= .07);
    else assert.ok(log.moisture < .055);
  }
  const initialMoistures = cycle.logs.map(log => log.initialMoisture);
  cycle.advance(180);
  assert.deepEqual(cycle.logs.map(log => log.initialMoisture), initialMoistures);
  assert.ok(cycle.logs.some(log => log.moisture < log.initialMoisture));
});

test('wet wood takes longer to ignite and consumes less fuel than dry wood on the same coal bed', () => {
  const dry = isolatedLog(.09), wet = isolatedLog(.28);
  let dryIgnition, wetIgnition;
  for (let second = 1; second <= 600; second++) {
    dry.cycle.advance(1); wet.cycle.advance(1);
    if (dry.log.everLit && dryIgnition === undefined) dryIgnition = second;
    if (wet.log.everLit && wetIgnition === undefined) wetIgnition = second;
    if (second === 180) {
      assert.equal(dry.log.everLit, true);
      assert.equal(wet.log.phase, 'drying'); assert.equal(wet.log.wood, 1);
    }
  }
  assert.ok(dryIgnition < 180); assert.ok(wetIgnition > dryIgnition * 3 && wetIgnition < 500);
  assert.ok(wet.log.wood - dry.log.wood > .5);
  assert.equal(wet.log.everLit, true);
});

test('drying wet wood spends core heat and moisture slows already lit wood', () => {
  const dry = isolatedLog(0, .3), wet = isolatedLog(.28, .3);
  for (const sample of [dry, wet]) { sample.log.temperature = .15; sample.cycle.advance(30); }
  assert.ok(wet.log.moisture < wet.log.initialMoisture);
  assert.ok(wet.cycle.coreHeat < dry.cycle.coreHeat);
  assert.ok(wet.log.temperature < dry.log.temperature);
  assert.equal(wet.log.everLit, false); assert.equal(dry.log.everLit, false);

  const seasoned = isolatedLog(0), dampSurface = isolatedLog(.05);
  for (const { cycle, log } of [seasoned, dampSurface]) {
    Object.assign(log, { temperature: 1, flame: 1, phase: 'burning', everLit: true });
    cycle.advance(.5);
  }
  assert.equal(seasoned.log.flame, dampSurface.log.flame);
  assert.ok(1 - seasoned.log.wood > (1 - dampSurface.log.wood) * 1.05);
});

test('even saturated wet wood cannot produce negative consumption or nonfinite heat', () => {
  const { cycle, log } = isolatedLog(1);
  Object.assign(log, { temperature: 1, flame: 1 });
  for (let second = 0; second < 600; second++) {
    const previousWood = log.wood;
    cycle.advance(1);
    assert.ok(log.wood >= 0 && log.wood <= previousWood);
    assert.ok(log.char >= 0 && log.moisture >= 0 && log.moisture <= 1);
    assert.ok(Number.isFinite(cycle.coreHeat) && cycle.coreHeat >= 0 && cycle.coreHeat <= 1);
  }
});

test('a hotter core consumes wood faster even at the same saturated flame', () => {
  const warm = isolatedLog(0, .55), hot = isolatedLog(0, .9);
  for (const { cycle, log } of [warm, hot]) {
    Object.assign(log, { temperature: 1, flame: 1, phase: 'burning', everLit: true });
    cycle.advance(.5);
    assert.equal(cycle.coreHeat, cycle.coalHeat);
    assert.ok(cycle.burnRateMultiplier > 1);
  }
  assert.equal(warm.log.flame, 1); assert.equal(hot.log.flame, 1);
  assert.equal(hot.cycle.coreStatus, 'Very hot'); assert.equal(warm.cycle.coreStatus, 'Healthy');
  assert.ok(1 - hot.log.wood > (1 - warm.log.wood) * 1.25);
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

test('a dry fresh log can ignite from retained coals after all visible flame is gone', () => {
  const cycle = new BurnCycle(8108); cycle.setAutoFeed(false);
  while (cycle.logs.some(l => l.phase !== 'queued' && l.phase !== 'ash') && cycle.time < 5000) cycle.advance(5);
  assert.equal(cycle.flame, 0); assert.ok(cycle.coalHeat > .5);
  assert.equal(cycle.addLog(), true);
  const added = cycle.logs.find(l => l.addedAt === cycle.time);
  assert.equal(added.wood, 1); assert.equal(added.everLit, false);
  // Fix moisture here: the wet-wood test covers the longer drying delay.
  added.moisture = added.initialMoisture = .12;
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
      assert.equal(cycle.coreHeat, cycle.coalHeat);
      assert.ok(cycle.coalMass >= 0);
      for (const log of cycle.logs) {
        assert.ok(log.wood >= 0 && log.char >= 0 && log.moisture >= 0 && log.moisture <= log.initialMoisture);
        assert.ok(log.flame >= 0 && log.flame <= 1);
      }
    }
    assert.equal(cycle.phase, 'Cold fire bed', `seed ${seed}`);
    assert.equal(cycle.fuel, 0, `seed ${seed}`); assert.equal(cycle.flame, 0); assert.equal(cycle.coalHeat, 0);
    assert.ok(cycle.logs.every(l => l.phase === 'ash' && l.shed > 0));
    assert.ok(cycle.ashMass > .5); assert.ok(cycle.ashDeposits.every(value => value === 1));
  }
});
