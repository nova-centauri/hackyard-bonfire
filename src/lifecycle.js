// An art-directed heat / fuel model. Units are simulation seconds and normalized heat.
// Keep the slow burn independent of the flame shader's motion clock.
export const BURN_SETTINGS = Object.freeze({ step: .5, woodRate: .00165, charRate: .00072, cooling: .0015 });
export const SPEEDS = [1, 10, 30, 60, 300, 1200];
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const randFor = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
};
export const PHASE_LABELS = { queued: 'Waiting', fresh: 'Whole log', drying: 'Drying', catching: 'Catching', burning: 'Burning', charred: 'Charring', glowing: 'Glowing char', ash: 'Ash', cold: 'Unlit' };

export class BurnCycle {
  constructor(seed = 8108) { this.reset(seed); }
  reset(seed) {
    this.seed = seed >>> 0; this.random = randFor(this.seed); this.time = 0; this.remainder = 0;
    this.autoFeed = true; this.events = []; this.serial = 0; this.revision = 0; this.phase = null;
    const r = this.random;
    this.coalMass = .32 + r() * .4; this.coalHeat = .57 + r() * .22; this.ashMass = .06 + r() * .12;
    this.ashDeposits = Array(7).fill(0);
    this.nextFeed = 110 + r() * 90; this.feedInterval = 170 + r() * 95;
    const initialCount = 3 + Math.floor(r() * 2);
    this.logs = Array.from({ length: 7 }, (_, slot) => this.makeLog(slot, slot < initialCount));
    this.record('A new fire', `${initialCount} logs on the bed · ${7 - initialCount} whole logs waiting`);
    this.updateSummary();
  }
  makeLog(slot, initial = false) {
    const r = this.random, wood = initial ? .24 + r() * .7 : 1;
    return { slot, id: ++this.serial, phase: initial ? (wood < .45 ? 'charred' : 'burning') : 'queued',
      wood, char: initial ? Math.min(1 - wood, .07 + (1 - wood) * .16) : 0, ash: initial ? (1 - wood) * .1 : 0,
      moisture: initial ? 0 : .10 + r() * .11, temperature: initial ? .72 + r() * .2 : .025,
      flame: initial ? .55 + r() * .3 : 0, addedAt: initial ? -r() * 260 : null,
      scale: .91 + r() * .15, angle: (r() - .5) * .20, offset: (r() - .5) * .16,
      density: .86 + r() * .3, shed: 0, shedNotice: 0, hot: initial, everLit: initial,
    };
  }
  record(title, detail) {
    this.events.unshift({ time: this.time, title, detail });
    this.events.length = Math.min(60, this.events.length); this.revision++;
  }
  get queued() { return this.logs.filter(l => l.phase === 'queued').length; }
  get canAdd() { return this.logs.some(l => l.phase === 'queued' || l.phase === 'ash'); }
  addLog() {
    let log = this.logs.find(l => l.phase === 'queued');
    if (!log) {
      const slot = this.logs.findIndex(l => l.phase === 'ash');
      if (slot < 0) return false;
      log = this.logs[slot] = this.makeLog(slot);
    }
    log.phase = 'fresh'; log.addedAt = this.time;
    this.record(`Log ${String(log.id).padStart(2, '0')} added`, 'Whole wood settles onto the bed');
    this.nextFeed = this.time + this.feedInterval;
    this.updateSummary(); return true;
  }
  setAutoFeed(value) {
    this.autoFeed = value;
    if (value) this.nextFeed = Math.max(this.nextFeed, this.time + 10);
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
    if (this.autoFeed && this.queued && this.time >= this.nextFeed) this.addLog();
    const active = this.logs.filter(l => l.phase !== 'queued' && l.phase !== 'ash');
    const oldFlames = this.logs.map(l => l.flame);
    const oldCoalHeat = this.coalHeat;
    let flameSum = 0;
    for (const log of active) {
      let neighbors = 0;
      for (const other of active) if (other !== log) {
        // The crossed stack is closely coupled; upper logs receive less coal contact.
        neighbors += oldFlames[other.slot] * (Math.abs(other.slot - log.slot) < 3 ? .25 : .16);
      }
      const bedContact = log.slot < 3 ? .86 : .71;
      const target = clamp(oldCoalHeat * bedContact + neighbors + oldFlames[log.slot] * .57);
      log.temperature += (target - log.temperature) * (1 - Math.exp(-dt / (log.moisture > .06 ? 55 : 24)));
      const dry = dt * .00115 * Math.max(0, log.temperature - .14);
      log.moisture = Math.max(0, log.moisture - dry);
      const ignition = log.moisture < .055 && log.temperature > .39 && log.wood > .006;
      const targetFlame = ignition ? clamp((log.temperature - .35) * 2.2) * Math.min(1, log.wood / .17) : 0;
      log.flame += (targetFlame - log.flame) * (1 - Math.exp(-dt / 5));
      if (log.flame < .0005) log.flame = 0;
      const consumed = Math.min(log.wood, dt * BURN_SETTINGS.woodRate * log.flame / log.density);
      log.wood -= consumed; log.char += consumed * .26; log.ash += consumed * .035;
      const charBurn = log.temperature > .10 ? Math.min(log.char, dt * BURN_SETTINGS.charRate * log.temperature * Math.min(1, log.char / .025)) : 0;
      log.char -= charBurn; log.ash += charBurn * .8; this.ashMass += charBurn * .2;
      const shed = Math.min(log.char, dt * .00014 * log.temperature * (1 - log.wood));
      log.char -= shed; log.shed += shed; this.coalMass += shed;
      // Hot char keeps releasing heat after the visible flame has vanished.
      this.coalHeat += charBurn * 1.5;
      flameSum += log.flame;
      let phase;
      if (log.wood < .009 && log.char < .003) {
        this.ashMass += log.wood + log.char; log.wood = 0; log.char = 0; log.flame = 0; phase = 'ash';
      } else if (this.time - log.addedAt < 3) phase = 'fresh';
      else if (log.wood < .015) phase = 'glowing';
      else if (log.flame > .08) phase = log.wood < .45 ? 'charred' : log.wood > .92 ? 'catching' : 'burning';
      else if (log.temperature > .12 && log.moisture > .015) phase = 'drying';
      else if (log.temperature > .20) phase = 'catching';
      else phase = 'cold';
      if (log.flame > .08 && !log.everLit) {
        log.everLit = true;
        this.record(`Log ${String(log.id).padStart(2, '0')} caught fire`, oldFlames.some(f => f > .1) ? 'Flame spread from neighboring fuel' : 'Retained coal heat ignited the wood');
      }
      if (log.shed - log.shedNotice > .018) {
        log.shedNotice = log.shed;
        this.record(`Log ${String(log.id).padStart(2, '0')} sheds char`, 'Glowing fragments join the ember bed');
      }
      if (phase !== log.phase) {
        if (phase === 'glowing') this.record(`Log ${String(log.id).padStart(2, '0')} is charcoal`, 'Flame fades; the core keeps glowing');
        if (phase === 'ash') {
          this.ashDeposits[log.slot] = 1;
          this.record(`Log ${String(log.id).padStart(2, '0')} became ash`, 'The last of this log has burned away');
        }
        log.phase = phase;
      }
    }
    const coalBurn = this.coalHeat > .055 ? Math.min(this.coalMass, dt * .00055 * (.15 + this.coalHeat) * Math.min(1, this.coalMass * 8)) : 0;
    this.coalMass -= coalBurn; this.ashMass += coalBurn;
    this.coalHeat = clamp(this.coalHeat + flameSum * dt * .0011 + coalBurn * 1.8 - this.coalHeat * dt * BURN_SETTINGS.cooling);
    if (this.coalHeat < .003 && flameSum < .001) this.coalHeat = 0;
  }
  updateSummary() {
    this.flame = this.logs.reduce((n, l) => n + l.flame, 0);
    this.fuel = this.logs.reduce((n, l) => n + (l.phase === 'queued' ? 0 : l.wood + l.char), 0);
    this.smoke = clamp(this.flame * .23 + this.logs.reduce((n, l) => n + (l.phase === 'queued' || l.phase === 'ash' ? 0 : l.temperature * (l.moisture * 1.5 + l.char * .2)), 0));
    const previous = this.phase;
    this.phase = this.flame > 1.4 ? 'Established fire' : this.flame > .08 ? 'Low flames' : this.coalHeat > .12 ? 'Ember afterglow' : this.coalHeat > .015 ? 'Cooling ash' : 'Cold fire bed';
    if (previous && previous !== this.phase && this.phase === 'Cold fire bed') this.record('The fire is out', this.fuel > .02 ? 'Remaining wood needs a new source of heat' : 'Only cold ash remains');
  }
}
