import { FUEL_TYPES, getFuelType, pickRandomFuelKind } from './fuel-types.js';
import { copyCombustionPose, combustionEnvironment, ensureLogSurface, extinguishLogSurface, nearbyFlameCoupling, updateLogSurface } from './log-combustion.js';

// An art-directed heat / fuel model. Units are simulation seconds and normalized heat.
// Keep the slow burn independent of the flame shader's motion clock.
export const BURN_SETTINGS = Object.freeze({ step: .5, woodRate: .00165, charRate: .00072, cooling: .0015 });
export const SPEEDS = [0.5, 0.75, 1, 2, 5, 10, 30, 60, 300, 1200];
// A piece catches once it is dry enough and its bulk heat passes this level.
export const IGNITION = Object.freeze({ temperature: .39, moisture: .055 });
// Tending: add when less than this much wood can still burn, never onto a
// roaring fire, and never with this many pieces already waiting to catch.
export const TENDING = Object.freeze({ lowWood: 1.1, roaringFlame: 2.2, recheck: 45, waitingPieces: 2 });
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const randFor = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
};
export const PHASE_LABELS = { queued: 'Waiting', fresh: 'Fresh wood', drying: 'Drying', catching: 'Catching', burning: 'Burning', charred: 'Charring', glowing: 'Glowing char', ash: 'Ash', cold: 'Unlit' };

export class BurnCycle {
  constructor(seed = 8108) { this.reset(seed); }
  reset(seed) {
    this.resetSerial = (this.resetSerial ?? 0) + 1;
    this.seed = seed >>> 0; this.random = randFor(this.seed); this.fuelRandom = randFor(this.seed ^ 0xF17ECA7E); this.time = 0; this.remainder = 0;
    this.autoFeed = true; this.events = []; this.serial = 0; this.revision = 0; this.phase = null; this.logPoses = [];
    this.choiceRandom = randFor(this.seed ^ 0xADD1F00D);
    const r = this.random;
    this.coalMass = .32 + r() * .4; this.coalHeat = .57 + r() * .22; this.ashMass = .06 + r() * .12;
    this.fragmentChar = 0; this.fragmentHeat = 0;
    this.ashDeposits = Array(7).fill(0);
    this.nextFeed = 110 + r() * 90; this.feedInterval = 170 + r() * 95;
    const initialCount = 3 + Math.floor(r() * 2);
    // Keep the first crossed supports substantial. The lighter pieces start on
    // top or next in the queue; later pieces can occasionally be lumber or stump.
    const starterTypes = ['log', 'log', 'small-log', 'kindling'];
    this.logs = Array.from({ length: 7 }, (_, slot) => this.makeLog(slot, slot < initialCount, starterTypes[slot]));
    this.record('A new fire', `${initialCount} pieces on the bed · ${7 - initialCount} pieces waiting`);
    this.updateSummary();
  }
  randomFuelType() {
    // A separate random stream preserves seeded moisture, placement, and timing.
    // Auto-feed stays mostly wood; scrap shows up now and then. The focus-mode
    // button picks uniformly so cardboard and newspaper actually appear.
    const roll = this.fuelRandom();
    return roll < .44 ? 'log' : roll < .66 ? 'small-log' : roll < .82 ? 'kindling'
      : roll < .90 ? 'pallet' : roll < .97 ? 'plank' : 'stump';
  }
  makeLog(slot, initial = false, fuelType = this.randomFuelType()) {
    const r = this.random, wood = initial ? .24 + r() * .7 : 1;
    // Burning logs have already dried; waiting logs span seasoned to wet wood.
    // Paper still dries and burns faster via its heat and burn rates.
    const moisture = initial ? .008 + r() * .034 : .07 + r() * .28;
    return { slot, id: ++this.serial, fuelType, phase: initial ? (wood < .45 ? 'charred' : 'burning') : 'queued',
      wood, char: initial ? Math.min(1 - wood, .07 + (1 - wood) * .16) : 0, ash: initial ? (1 - wood) * .1 : 0,
      moisture, initialMoisture: moisture, temperature: initial ? .72 + r() * .2 : .025,
      flame: initial ? .55 + r() * .3 : 0, addedAt: initial ? -r() * 260 : null,
      scale: .91 + r() * .15, angle: (r() - .5) * .20, offset: (r() - .5) * .16,
      density: .86 + r() * .3, shed: 0, shedNotice: 0, hot: initial, everLit: initial, catching: true,
    };
  }
  record(title, detail) {
    this.events.unshift({ time: this.time, title, detail });
    this.events.length = Math.min(60, this.events.length); this.revision++;
  }
  get queued() { return this.logs.filter(l => l.phase === 'queued').length; }
  get canAdd() { return this.logs.some(l => l.phase === 'queued' || l.phase === 'ash'); }
  // Wood still on the bed, in whole-log units; ash slots and the queue do not count.
  get woodOnBed() { return this.logs.reduce((sum, l) => sum + (l.phase === 'queued' || l.phase === 'ash' ? 0 : l.wood * getFuelType(l.fuelType).mass), 0); }
  // Wood the fire can actually draw on: pieces that are alight, or lying where
  // the bed and their neighbours run hot enough to light them. A log that
  // rolled to the edge of the pit is still wood on the bed, but it will not
  // carry the fire, and counting it left the fire untended until it went out.
  get burnableWood() { return this.logs.reduce((sum, l) => sum + (l.phase === 'queued' || l.phase === 'ash' || !(l.flame > 0 || l.catching) ? 0 : l.wood * getFuelType(l.fuelType).mass), 0); }
  // Pieces on the bed that have never caught; fresh wood still drying counts.
  get waitingPieces() { return this.logs.filter(l => l.phase !== 'queued' && l.phase !== 'ash' && !l.everLit).length; }
  // Once the finite queue is spent, a fire left burning is kept alive the way
  // someone sitting beside it would tend it: a fresh piece only when the wood
  // that can burn is running low, never onto a roaring fire, never onto a cold
  // bed that could not light it, and never while two pieces are already
  // waiting to catch. This keeps a modest fire going for as long as the page
  // stays open without ever piling the bed high.
  get tending() { return this.autoFeed && this.queued === 0 && this.canAdd && this.coalHeat > .12; }
  get needsFuel() { return this.tending && this.burnableWood < TENDING.lowWood && this.flame < TENDING.roaringFlame && this.waitingPieces < TENDING.waitingPieces; }
  // Retained heat is a reservoir, so a flame-free coal bed can still be healthy
  // enough to ignite dry wood. Keep coalHeat as the shared rendering signal.
  get coreHeat() { return this.coalHeat; }
  get coreStatus() {
    return this.coreHeat >= .8 ? 'Very hot' : this.coreHeat >= .55 ? 'Healthy' : this.coreHeat >= .3 ? 'Warming' : this.coreHeat >= .08 ? 'Fading' : 'Cold';
  }
  get burnRateMultiplier() { return .65 + this.coreHeat * 1.1; }
  addLog(fuelType, { tended = false } = {}) {
    if (fuelType !== undefined && !Object.hasOwn(FUEL_TYPES, fuelType)) return false;
    let log = this.logs.find(l => l.phase === 'queued');
    if (!log) {
      const slot = this.logs.findIndex(l => l.phase === 'ash');
      if (slot < 0) return false;
      log = this.logs[slot] = this.makeLog(slot, false, fuelType);
    }
    if (fuelType !== undefined) log.fuelType = fuelType;
    log.phase = 'fresh'; log.addedAt = this.time; log.tended = tended;
    this.record(`${getFuelType(log.fuelType).label} ${String(log.id).padStart(2, '0')} added`, tended ? 'The fire was running low; a fresh piece keeps it going' : 'Fresh wood settles onto the bed');
    // A fast-burning piece needs a follow-up sooner to keep the stack alight.
    this.nextFeed = this.time + this.feedInterval / Math.max(1, getFuelType(log.fuelType).burnRate);
    this.updateSummary(); return true;
  }
  addRandomFuel(options) {
    return this.addLog(pickRandomFuelKind(this.choiceRandom), options);
  }
  setAutoFeed(value) {
    this.autoFeed = value;
    if (value) this.nextFeed = Math.max(this.nextFeed, this.time + 10);
  }
  setLogPoses(poses = []) {
    // Copy the physics transforms: accelerated lifecycle steps must not mutate
    // a render pose, and replacement pieces must not inherit the departed pose.
    // A piece still falling toward the pile has no bed contact yet, so it keeps
    // its last resting pose, or the calibrated slot for a new arrival, until it
    // lands: the drop lasts half a real second, which at 1200× would otherwise
    // be ten burn minutes of wood hanging in the air away from the coals.
    this.logPoses = poses.map((pose, slot) => {
      if (pose?.inFlight) { const previous = this.logPoses[slot]; return previous && previous.id === pose.id ? previous : null; }
      return copyCombustionPose(pose);
    });
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Burn time must be a finite positive duration.');
    this.remainder += seconds;
    // Fixed steps give the same heat transfer and feed order at 1× and 1200×.
    while (this.remainder + 1e-8 >= BURN_SETTINGS.step) {
      this.step(BURN_SETTINGS.step); this.remainder = Math.max(0, this.remainder - BURN_SETTINGS.step);
    }
    this.updateSummary();
  }
  step(dt) {
    this.time += dt;
    if (this.autoFeed && this.time >= this.nextFeed) {
      if (this.queued) this.addLog();
      else if (this.needsFuel) this.addLog(undefined, { tended: true });
      else this.nextFeed = this.time + TENDING.recheck;
    }
    const active = this.logs.filter(l => l.phase !== 'queued' && l.phase !== 'ash');
    const oldFlames = this.logs.map(l => l.flame);
    const oldCoalHeat = this.coalHeat;
    const coreBurnRate = this.burnRateMultiplier;
    for (const log of active) {
      const pose = this.logPoses[log.slot];
      combustionEnvironment(log, pose && (pose.id === undefined || pose.id === log.id) ? pose : null);
    }
    let flameSum = 0, evaporated = 0;
    for (const log of active) {
      const fuel = getFuelType(log.fuelType);
      const name = `${fuel.label} ${String(log.id).padStart(2, '0')}`;
      let neighbors = 0;
      for (const other of active) if (other !== log) {
        const coupling = this.logPoses[log.slot] && this.logPoses[other.slot]
          ? nearbyFlameCoupling(log.surface.pose, other.surface.pose)
          : Math.abs(other.slot - log.slot) < 3 ? .25 : .16;
        neighbors += oldFlames[other.slot] * getFuelType(other.fuelType).heatOutput * coupling;
      }
      const bedContact = log.slot < 3 ? .86 : .71;
      const bedCoupling = log.surface.bedCoupling;
      const target = clamp(oldCoalHeat * bedContact * bedCoupling + neighbors + oldFlames[log.slot] * (.43 + Math.min(1, bedCoupling) * .14));
      // Whether this piece, where it lies, is heading for ignition at all.
      log.catching = target >= IGNITION.temperature;
      log.temperature += (target - log.temperature) * (1 - Math.exp(-dt * fuel.heatRate / (log.moisture > .06 ? 55 : 24)));
      const dry = Math.min(log.moisture, dt * .00115 * fuel.heatRate * Math.max(0, log.temperature - .14));
      log.moisture -= dry;
      // Evaporation takes energy from the wood and bed before it can burn.
      log.temperature = Math.max(0, log.temperature - dry * .7);
      evaporated += dry * fuel.mass;
      const ignition = log.moisture < IGNITION.moisture && log.temperature > IGNITION.temperature && log.wood > .006;
      const targetFlame = ignition ? clamp((log.temperature - .35) * 2.2 * fuel.flameScale) * Math.min(1, log.wood / .17) : 0;
      log.flame += (targetFlame - log.flame) * (1 - Math.exp(-dt / 5));
      if (log.flame < .0005) log.flame = 0;
      const moistureBurnRate = clamp(1 - log.moisture * 1.8, .15, 1);
      const consumed = Math.min(log.wood, dt * BURN_SETTINGS.woodRate * fuel.burnRate * log.flame * coreBurnRate * moistureBurnRate / log.density);
      log.wood -= consumed; log.char += consumed * fuel.charYield; log.ash += consumed * fuel.ashYield;
      const charBurn = log.temperature > .10 ? Math.min(log.char, dt * BURN_SETTINGS.charRate * fuel.burnRate * log.temperature * Math.min(1, log.char / .025)) : 0;
      log.char -= charBurn; log.ash += charBurn * .8; this.ashMass += charBurn * .2 * fuel.mass;
      const shed = Math.min(log.char, dt * .00014 * fuel.burnRate * log.temperature * (1 - log.wood));
      log.char -= shed; log.shed += shed; this.coalMass += shed * fuel.mass * Math.min(1, bedCoupling);
      // Hot char keeps releasing heat after the visible flame has vanished.
      this.coalHeat += charBurn * 1.5 * fuel.mass * Math.min(1, bedCoupling);
      flameSum += log.flame * fuel.heatOutput * Math.min(1, bedCoupling);
      updateLogSurface(log, dt, fuel, { consumed, dry, charBurn, shed, coreHeat: oldCoalHeat });
      let phase;
      if (log.wood < .009 && log.char < .003) {
        this.ashMass += (log.wood + log.char) * fuel.mass; log.wood = 0; log.char = 0; log.flame = 0; phase = 'ash';
        extinguishLogSurface(log);
      } else if (this.time - log.addedAt < 3) phase = 'fresh';
      else if (log.wood < .015) phase = 'glowing';
      else if (log.flame > .08) phase = log.wood < .45 ? 'charred' : log.wood > .92 ? 'catching' : 'burning';
      else if (log.temperature > .12 && log.moisture > .015) phase = 'drying';
      else if (log.temperature > .20) phase = 'catching';
      else phase = 'cold';
      if (log.flame > .08 && !log.everLit) {
        log.everLit = true;
        this.record(`${name} caught fire`, oldFlames.some(f => f > .1) ? 'Flame spread from neighboring fuel' : 'Retained coal heat ignited the wood');
      }
      if (log.shed - log.shedNotice > .018) {
        log.shedNotice = log.shed;
        this.record(`${name} sheds char`, 'Glowing fragments join the ember bed');
      }
      if (phase !== log.phase) {
        if (phase === 'glowing') this.record(`${name} is charcoal`, 'Flame fades; the core keeps glowing');
        if (phase === 'ash') {
          this.ashDeposits[log.slot] = 1;
          this.record(`${name} became ash`, 'The last of this piece has burned away');
        }
        log.phase = phase;
      }
    }
    const coalBurn = this.coalHeat > .055 ? Math.min(this.coalMass, dt * .00055 * (.15 + this.coalHeat) * Math.min(1, this.coalMass * 8)) : 0;
    this.coalMass -= coalBurn; this.ashMass += coalBurn;
    this.coalHeat = clamp(this.coalHeat + flameSum * dt * .0011 + coalBurn * 1.8 - evaporated * .5 - this.coalHeat * dt * BURN_SETTINGS.cooling);
    if (this.coalHeat < .003 && flameSum < .001) this.coalHeat = 0;
  }
  updateSummary() {
    for (const log of this.logs) ensureLogSurface(log);
    this.flame = this.logs.reduce((n, l) => n + l.flame * getFuelType(l.fuelType).heatOutput, 0);
    this.visibleFlame = this.logs.reduce((n, l) => n + (l.phase === 'queued' || l.phase === 'ash' ? 0 : l.visibleFlame) * getFuelType(l.fuelType).heatOutput, 0);
    this.fuel = this.fragmentChar + this.logs.reduce((n, l) => n + (l.phase === 'queued' ? 0 : (l.wood + l.char) * getFuelType(l.fuelType).mass), 0);
    this.smoke = clamp(this.flame * .23 + this.logs.reduce((n, l) => n + (l.phase === 'queued' || l.phase === 'ash' ? 0 : l.temperature * (l.moisture * 1.5 + l.char * .2)), 0));
    const previous = this.phase;
    const emberHeat = Math.max(this.coalHeat, this.fragmentChar > 0 ? this.fragmentHeat : 0);
    this.phase = this.flame > 1.4 ? 'Established fire' : this.flame > .08 ? 'Low flames' : emberHeat > .12 ? 'Ember afterglow' : emberHeat > .015 ? 'Cooling ash' : 'Cold fire bed';
    if (previous && previous !== this.phase && this.phase === 'Cold fire bed') this.record('The fire is out', this.fuel > .02 ? 'Remaining wood needs a new source of heat' : 'Only cold ash remains');
  }
}
