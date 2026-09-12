import test from 'node:test';
import assert from 'node:assert/strict';
import { BurnCycle } from '../src/lifecycle.js';
import { FUEL_TYPES, getFuelType } from '../src/fuel-types.js';

const physicalState = cycle => ({ time: cycle.time, coalHeat: cycle.coalHeat, coalMass: cycle.coalMass, ashMass: cycle.ashMass, logs: cycle.logs });

// Match the wood, bed, and placement so only the tested condition changes.
const isolatedLog = (moisture, coreHeat = .9, fuelType = 'log') => {
  const cycle = new BurnCycle(100); cycle.setAutoFeed(false);
  for (const log of cycle.logs) { log.phase = 'queued'; log.flame = 0; }
  cycle.coalHeat = coreHeat; cycle.coalMass = .65;
  const log = cycle.logs[0];
  Object.assign(log, { fuelType, wood: 1, char: 0, ash: 0, moisture, initialMoisture: moisture, temperature: .025,
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
  assert.equal(cycle.addLog('log'), true);
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
  // Kindling can already have burned away during the 300-second pause.
  const emptySlots = cycle.logs.filter(log => log.phase === 'ash').length;
  for (let slot = 0; slot < emptySlots; slot++) assert.equal(cycle.addLog(), true);
  assert.equal(cycle.canAdd, false); assert.equal(cycle.addLog(), false);
});

test('fuel definitions are immutable, distinct, and safely fall back for unknown types', () => {
  assert.deepEqual(Object.keys(FUEL_TYPES), ['log', 'small-log', 'kindling', 'plank', 'stump']);
  assert.equal(getFuelType(), FUEL_TYPES.log);
  for (const invalid of ['missing', '__proto__', 'constructor', null]) assert.equal(getFuelType(invalid), FUEL_TYPES.log);
  assert.ok(Object.isFrozen(FUEL_TYPES));
  for (const definition of Object.values(FUEL_TYPES)) {
    assert.ok(Object.isFrozen(definition));
    for (const key of ['lengthScale', 'radiusScale', 'burnRate', 'heatRate', 'heatOutput', 'mass']) {
      assert.ok(Number.isFinite(definition[key]) && definition[key] > 0, key);
    }
  }
  assert.ok(FUEL_TYPES.kindling.radiusScale < FUEL_TYPES['small-log'].radiusScale);
  assert.ok(FUEL_TYPES['small-log'].radiusScale < FUEL_TYPES.log.radiusScale);
  assert.ok(FUEL_TYPES.stump.radiusScale > FUEL_TYPES.log.radiusScale);
});

test('seeded piles keep solid supports and lighter fuel, with occasional planks and stumps', () => {
  const counts = Object.fromEntries(Object.keys(FUEL_TYPES).map(type => [type, 0]));
  const samples = 512 * 3;
  for (let seed = 1; seed <= 512; seed++) {
    const cycle = new BurnCycle(seed);
    assert.deepEqual(cycle.logs.slice(0, 4).map(log => log.fuelType), ['log', 'log', 'small-log', 'kindling']);
    for (const log of cycle.logs.slice(4)) counts[log.fuelType]++;
  }
  assert.ok(counts.log / samples > .4);
  assert.ok(counts['small-log'] > counts.plank && counts.kindling > counts.plank);
  assert.ok(counts.plank / samples > .04 && counts.plank / samples < .10);
  assert.ok(counts.stump / samples > .01 && counts.stump / samples < .055);
});

test('explicit feeds select one waiting piece and reject invalid categories without changing the cycle', () => {
  for (const fuelType of Object.keys(FUEL_TYPES)) {
    const cycle = new BurnCycle(42); cycle.setAutoFeed(false);
    const queued = cycle.queued, serial = cycle.serial;
    const waiting = cycle.logs.find(log => log.phase === 'queued');
    const otherIds = cycle.logs.filter(log => log !== waiting).map(log => [log.id, log.phase, log.fuelType]);
    assert.equal(cycle.addLog(fuelType), true);
    assert.equal(waiting.fuelType, fuelType); assert.equal(waiting.phase, 'fresh');
    assert.equal(waiting.wood, 1); assert.equal(waiting.char, 0); assert.equal(waiting.everLit, false);
    assert.equal(cycle.queued, queued - 1); assert.equal(cycle.serial, serial);
    assert.deepEqual(cycle.logs.filter(log => log !== waiting).map(log => [log.id, log.phase, log.fuelType]), otherIds);
    assert.equal(cycle.events[0].title, `${FUEL_TYPES[fuelType].label} ${String(waiting.id).padStart(2, '0')} added`);
    for (const invalid of ['missing', '__proto__', 'constructor', null]) {
      const before = JSON.stringify(cycle);
      assert.equal(cycle.addLog(invalid), false);
      assert.equal(JSON.stringify(cycle), before);
    }
  }
});

test('category selection preserves the seeded physical random stream and replacement sequence', () => {
  const mixed = new BurnCycle(42), standard = new BurnCycle(42);
  const withoutType = ({ fuelType, ...log }) => log;
  for (const cycle of [mixed, standard]) {
    cycle.setAutoFeed(false);
    for (const log of cycle.logs) { log.phase = 'ash'; log.flame = 0; }
  }
  for (const fuelType of Object.keys(FUEL_TYPES)) {
    assert.equal(mixed.addLog(fuelType), true);
    assert.equal(standard.addLog('log'), true);
    assert.deepEqual(mixed.logs.map(withoutType), standard.logs.map(withoutType));
  }
  const first = new BurnCycle(7), second = new BurnCycle(7);
  for (const cycle of [first, second]) {
    cycle.advance(12000);
    for (let piece = 0; piece < 7; piece++) cycle.addLog();
  }
  assert.deepEqual(physicalState(first), physicalState(second));
});

test('kindling catches first and stumps catch last on an otherwise identical coal bed', () => {
  const order = ['kindling', 'small-log', 'plank', 'log', 'stump'];
  const samples = order.map(type => isolatedLog(.09, .9, type));
  const ignitionTimes = Array(samples.length);
  for (let second = 1; second <= 600; second++) {
    for (let index = 0; index < samples.length; index++) {
      const { cycle, log } = samples[index];
      cycle.advance(1);
      if (log.everLit && ignitionTimes[index] === undefined) ignitionTimes[index] = second;
    }
  }
  assert.ok(ignitionTimes.every(Number.isFinite));
  for (let index = 1; index < ignitionTimes.length; index++) {
    assert.ok(ignitionTimes[index] > ignitionTimes[index - 1], `${order[index]} catches after ${order[index - 1]}`);
  }
  const consumed = order.map(type => {
    const { cycle, log } = isolatedLog(0, .9, type);
    Object.assign(log, { temperature: 1, flame: 1, phase: 'burning', everLit: true });
    cycle.advance(.5);
    return 1 - log.wood;
  });
  for (let index = 1; index < consumed.length; index++) assert.ok(consumed[index] < consumed[index - 1]);
});

test('every explicit fuel type can reuse an ash slot but remains unlit on a cold bed', () => {
  for (const fuelType of Object.keys(FUEL_TYPES)) {
    const cycle = new BurnCycle(42); cycle.advance(12000);
    const beforeAsh = cycle.ashMass, serial = cycle.serial;
    assert.equal(cycle.coalHeat, 0); assert.equal(cycle.queued, 0);
    assert.equal(cycle.addLog(fuelType), true);
    const piece = cycle.logs.find(log => log.phase === 'fresh');
    assert.equal(piece.fuelType, fuelType); assert.equal(piece.id, serial + 1);
    assert.equal(cycle.ashDeposits[piece.slot], 1); assert.equal(cycle.ashMass, beforeAsh);
    cycle.advance(1800);
    assert.equal(piece.phase, 'cold'); assert.equal(piece.everLit, false);
    assert.equal(piece.wood, 1); assert.equal(piece.char, 0); assert.equal(cycle.coreHeat, 0);
  }
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
