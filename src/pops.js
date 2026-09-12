import { getFuelType } from './fuel-types.js';
import { smoothNoise } from './weather.js';

// Wood pops when trapped moisture flashes to steam or a resin pocket bursts.
// This schedules those events as a Poisson process on the animation clock,
// weighted toward wet, flaming wood, so a fresh log spits for a while after it
// catches and a dry, mature fire only pops now and then. Each pop feeds the
// same impact pipeline as a landing: an ember burst, a light spike, a sound.
const live = log => log.phase !== 'queued' && log.phase !== 'ash';

// A real fire is not evenly restless: it has spells where it spits and cracks
// and long stretches where it only breathes. This slow, seeded envelope on the
// animation clock scales the pop rate (and, through burn-visuals, the audio's
// own crackle). It is zero about a fifth of the time, in stretches that
// typically last twenty seconds and sometimes close to a minute, and averages
// one, so the long-run pop count is unchanged. Capped so a lively spell never
// turns into a machine gun.
export const ACTIVITY_CAP = 2.8;
export function fireActivity(time, seed = 0) {
  const slow = smoothNoise(time * .021, seed + 101), medium = smoothNoise(time * .07, seed + 103);
  const field = slow * .65 + medium * .35;
  return Math.min(ACTIVITY_CAP, 4 * Math.pow(Math.max(0, (field - .3) / .7), 1.2));
}

export function logPopRate(log) {
  if (!live(log) || log.flame < .04) return 0;
  const type = getFuelType(log.fuelType);
  return log.flame * (.022 + log.moisture * 1.6 + (1 - log.wood) * .012) * (.6 + .4 * type.heatOutput);
}

export function popRate(cycle, gust = 0, activity = 1) {
  let rate = 0;
  for (const log of cycle.logs) rate += logPopRate(log);
  return rate * (1 + gust * .6) * activity;
}

// Occasionally a pocket bursts hard enough to throw a shower of embers and
// crack like a gunshot. Loud pops are a small share of the ordinary ones,
// spaced at least this far apart, and only from wood that is properly alight.
export const LOUD_POP_SHARE = .045, LOUD_POP_SPACING = 40;

export function createPopState() { return { next: null, serial: 0, lastPop: -Infinity, lastLoud: -Infinity, token: null }; }

// Returns the pops that fire this frame (at most one). `poses` are the live
// physics bodies, so the burst leaves the upper surface of the actual wood.
// Candidates are drawn at the envelope's ceiling and thinned by the current
// activity, so a lull never leaves a stale pop waiting when the fire livens.
export function updatePops(state, cycle, poses, time, rand, gust = 0) {
  const token = `${cycle.seed}:${cycle.resetSerial}`;
  if (state.token !== token) { state.token = token; state.next = null; state.lastPop = -Infinity; state.lastLoud = -Infinity; }
  const ceiling = popRate(cycle, gust, ACTIVITY_CAP);
  if (ceiling < 1e-4) { state.next = null; return []; }
  if (state.next === null) state.next = Math.max(state.lastPop + .6, time + -Math.log(1 - rand()) / ceiling);
  if (time < state.next) return [];
  state.next = null;
  const activity = fireActivity(time, cycle.seed);
  if (rand() * ACTIVITY_CAP > activity) return [];
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
  const loud = rand() < LOUD_POP_SHARE && time - state.lastLoud >= LOUD_POP_SPACING && log.flame >= .25;
  const strength = loud ? 1.1 + rand() * .5 : .12 + rand() * .3 + Math.min(.35, log.moisture * 1.2);
  state.serial++; state.lastPop = time;
  if (loud) state.lastLoud = time;
  return [{ slot, position, strength, heat: loud ? 1 : Math.max(.6, log.temperature), kind: 'pop', loud }];
}
