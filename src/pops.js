import { getFuelType } from './fuel-types.js';

// Wood pops when trapped moisture flashes to steam or a resin pocket bursts.
// This schedules those events as a Poisson process on the animation clock,
// weighted toward wet, flaming wood, so a fresh log spits for a while after it
// catches and a dry, mature fire only pops now and then. Each pop feeds the
// same impact pipeline as a landing: an ember burst, a light spike, a sound.
const live = log => log.phase !== 'queued' && log.phase !== 'ash';

export function logPopRate(log) {
  if (!live(log) || log.flame < .04) return 0;
  const type = getFuelType(log.fuelType);
  return log.flame * (.022 + log.moisture * 1.6 + (1 - log.wood) * .012) * (.6 + .4 * type.heatOutput);
}

export function popRate(cycle, gust = 0) {
  let rate = 0;
  for (const log of cycle.logs) rate += logPopRate(log);
  return rate * (1 + gust * .6);
}

export function createPopState() { return { next: null, serial: 0, lastPop: -Infinity, token: null }; }

// Returns the pops that fire this frame (at most one). `poses` are the live
// physics bodies, so the burst leaves the upper surface of the actual wood.
export function updatePops(state, cycle, poses, time, rand, gust = 0) {
  const token = `${cycle.seed}:${cycle.resetSerial}`;
  if (state.token !== token) { state.token = token; state.next = null; state.lastPop = -Infinity; }
  const rate = popRate(cycle, gust);
  if (rate < 1e-4) { state.next = null; return []; }
  if (state.next === null) state.next = time + Math.max(.6, -Math.log(1 - rand()) / rate);
  if (time < state.next) return [];
  state.next = null;
  const weights = cycle.logs.map(logPopRate), total = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = rand() * total, slot = 0;
  for (let i = 0; i < weights.length; i++) { pick -= weights[i]; if (pick <= 0) { slot = i; break; } }
  const log = cycle.logs[slot], pose = poses?.[slot];
  if (!pose?.live) return [];
  const along = .15 + rand() * .7, angle = rand() * Math.PI * 2;
  const position = pose.a.clone().lerp(pose.b, along);
  const offset = pose.sectionX.clone().multiplyScalar(Math.cos(angle) * pose.radius).addScaledVector(pose.sectionZ, Math.sin(angle) * pose.radius);
  if (offset.y < 0) offset.negate();
  position.add(offset);
  const strength = .12 + rand() * .3 + Math.min(.35, log.moisture * 1.2);
  state.serial++; state.lastPop = time;
  return [{ slot, position, strength, heat: Math.max(.6, log.temperature), kind: 'pop' }];
}
