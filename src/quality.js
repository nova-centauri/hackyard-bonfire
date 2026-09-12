// Level-of-detail tiers and the governor that moves between them.
//
// Cost scales with two things the user controls without knowing it: how many
// pixels the fire covers, and how fast the machine is. The size cap answers the
// first from the canvas size alone (a small window cannot show fine flame
// detail, so it pays for less). The governor answers the second from measured
// frame pacing, stepping down quickly when frames are dropped and back up
// slowly when there is sustained headroom. Everything here is pure so it can
// be tested without a browser; the viewer applies the chosen settings.

export const TIERS = Object.freeze(['minimal', 'low', 'medium', 'high', 'ultra']);

export const TIER_SETTINGS = Object.freeze({
  // pixelRatio caps devicePixelRatio; pixelBudget caps the drawing buffer area.
  // fireSteps / smokeSteps are ray-march samples; octaves are noise layers in
  // the flame field. shadowInterval is the minimum milliseconds between
  // firelight shadow refreshes (Infinity keeps the first shadow map).
  minimal: Object.freeze({ label: 'Minimal', pixelRatio: .75, pixelBudget: 300e3, fireSteps: 28, smokeSteps: 12, octaves: 2, contactFire: false, msaa: 0, bloom: false, bloomScale: .5, shadowSize: 256, shadowInterval: Infinity, frameInterval: 1000 / 24, emberDensity: .5, heatHaze: false }),
  low: Object.freeze({ label: 'Low', pixelRatio: 1, pixelBudget: 600e3, fireSteps: 44, smokeSteps: 20, octaves: 2, contactFire: true, msaa: 0, bloom: true, bloomScale: .5, shadowSize: 256, shadowInterval: 500, frameInterval: 1000 / 30, emberDensity: .7, heatHaze: true }),
  medium: Object.freeze({ label: 'Medium', pixelRatio: 1.25, pixelBudget: 1.0e6, fireSteps: 64, smokeSteps: 28, octaves: 3, contactFire: true, msaa: 2, bloom: true, bloomScale: .75, shadowSize: 512, shadowInterval: 250, frameInterval: 1000 / 30, emberDensity: .85, heatHaze: true }),
  high: Object.freeze({ label: 'High', pixelRatio: 1.5, pixelBudget: 1.5e6, fireSteps: 88, smokeSteps: 40, octaves: 3, contactFire: true, msaa: 4, bloom: true, bloomScale: 1, shadowSize: 512, shadowInterval: 100, frameInterval: 1000 / 30, emberDensity: 1, heatHaze: true }),
  ultra: Object.freeze({ label: 'Ultra', pixelRatio: 2, pixelBudget: 3.2e6, fireSteps: 112, smokeSteps: 48, octaves: 3, contactFire: true, msaa: 4, bloom: true, bloomScale: 1, shadowSize: 1024, shadowInterval: 0, frameInterval: 1000 / 30, emberDensity: 1, heatHaze: true }),
});

export const tierIndex = tier => TIERS.indexOf(tier);
export const isTier = tier => tierIndex(tier) >= 0;
export const lowerTier = (a, b) => TIERS[Math.min(tierIndex(a), tierIndex(b))];

// The tier a canvas of this CSS size can usefully display. Areas are in CSS
// pixels, so a retina display does not raise the cap on its own.
export function sizeCap(width, height) {
  const area = Math.max(0, width) * Math.max(0, height);
  return area >= 900e3 ? 'ultra' : area >= 400e3 ? 'high' : area >= 150e3 ? 'medium' : area >= 60e3 ? 'low' : 'minimal';
}

// A fresh session starts one step below the size cap at most, so a large
// window on an unknown machine begins at High and earns Ultra.
export const startingTier = cap => lowerTier(cap, 'high');

export function pixelRatioFor(tier, width, height, devicePixelRatio = 1) {
  const settings = TIER_SETTINGS[tier];
  const area = Math.max(1, width * height);
  return Math.max(.5, Math.min(devicePixelRatio || 1, settings.pixelRatio, Math.sqrt(settings.pixelBudget / area)));
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};

export class QualityGovernor {
  constructor({ target = 1000 / 30, tier = 'high', cap = 'ultra', floor = 'minimal', now = 0, locked = false, window = 90, settle = 3000, upgradeDelay = 8000, maxUpgradeDelay = 120000 } = {}) {
    this.target = target; this.cap = cap; this.floor = floor; this.locked = locked;
    this.windowSize = window; this.settle = settle; this.baseUpgradeDelay = upgradeDelay; this.maxUpgradeDelay = maxUpgradeDelay;
    this.upgradeDelay = upgradeDelay;
    this.tier = lowerTier(tier, cap);
    this.intervals = []; this.cpu = [];
    this.lastChange = now; this.lastUpgrade = -Infinity; this.settleUntil = now + settle; this.lastEvaluation = now;
    this.reason = 'start';
  }

  // Forget recent samples after anything that changes the workload: a tier
  // switch, a resize, a new scene. Shader compiles and buffer allocations
  // would otherwise read as dropped frames.
  reset(now, reason = 'reset') {
    this.intervals.length = 0; this.cpu.length = 0;
    this.settleUntil = now + this.settle; this.lastEvaluation = now; this.reason = reason;
  }

  setCap(cap, now) {
    if (!isTier(cap) || cap === this.cap) return null;
    this.cap = cap;
    if (tierIndex(this.tier) > tierIndex(cap)) { this.tier = cap; this.lastChange = now; this.reset(now, 'window'); return cap; }
    // A larger window may allow more; wait the normal upgrade delay for it.
    return null;
  }

  lock(tier) {
    if (!isTier(tier)) return;
    this.locked = true; this.tier = tier; this.reason = 'locked';
  }

  // interval: milliseconds since the previous drawn frame; cpu: milliseconds
  // the main thread spent producing this frame. Returns the new tier when a
  // change is decided, otherwise null.
  observe(interval, cpu, now) {
    // A gap of a second or more is a hidden tab or a stall, not a frame.
    if (this.locked || !Number.isFinite(interval) || interval <= 0 || interval > 1000) return null;
    this.intervals.push(interval); this.cpu.push(Math.max(0, cpu || 0));
    if (this.intervals.length > this.windowSize) { this.intervals.shift(); this.cpu.shift(); }
    if (now < this.settleUntil || this.intervals.length < this.windowSize / 2 || now - this.lastEvaluation < 1000) return null;
    this.lastEvaluation = now;
    const pace = percentile(this.intervals, .75), busy = percentile(this.cpu, .75);
    const index = tierIndex(this.tier);
    if (pace > this.target * 1.25 && index > tierIndex(this.floor)) {
      // Dropping right after an upgrade means the upgrade was the cause: back
      // off, and wait longer before trying that step again.
      if (now - this.lastUpgrade < 30000) this.upgradeDelay = Math.min(this.maxUpgradeDelay, this.upgradeDelay * 2);
      this.tier = TIERS[index - 1]; this.lastChange = now; this.reset(now, 'frame-drops');
      return this.tier;
    }
    if (index < tierIndex(this.cap) && now - this.lastChange >= this.upgradeDelay
      && pace <= this.target * 1.08 && busy <= this.target * .4) {
      this.tier = TIERS[index + 1]; this.lastChange = now; this.lastUpgrade = now; this.reset(now, 'headroom');
      return this.tier;
    }
    return null;
  }

  get settings() { return TIER_SETTINGS[this.tier]; }
}
