import { BurnCycle } from './lifecycle.js';
import { FUEL_KIND_IDS, getFuelType } from './fuel-types.js';

// A scene owns an opening and a fuel budget. These are admission/placement
// rules; combustion, heat transfer, tending cadence and the two clocks remain
// entirely in BurnCycle.
const indoorFuel = Object.freeze(FUEL_KIND_IDS.filter(id => id !== 'stump'));
const define = scene => Object.freeze(scene);
export const FIRE_SCENES = Object.freeze([
  define({ id: 'pit', label: 'Outdoor pit', description: 'The original open-air fire, with room for the whole woodpile.',
    limits: '7 pieces · all fuel types', maxPieces: 7, fuelTypes: FUEL_KIND_IDS, mouth: null }),
  define({ id: 'home', label: 'Home fireplace', description: 'Short-cut wood in a warm brick hearth, beneath a simple timber mantel.',
    limits: '5 pieces · short cuts · no stumps', maxPieces: 5, fuelTypes: indoorFuel,
    mouth: Object.freeze({ width: 2.65, height: 2.35, depth: 1.65 }),
    length: 1.65, radius: .20, maxLength: 1.8, maxRadius: .23,
    camera: [1.1, 2.1, 8.8], target: [0, 1.35, 0], flameScale: .66 }),
  define({ id: 'grand', label: 'Grand fireplace', description: 'A broad stone opening, a carved surround, and a generous hearth fire.',
    limits: '6 pieces · larger cuts · no stumps', maxPieces: 6, fuelTypes: indoorFuel,
    mouth: Object.freeze({ width: 3.9, height: 3.25, depth: 2.15 }),
    length: 2.35, radius: .26, maxLength: 2.6, maxRadius: .30,
    camera: [1.4, 2.8, 11.8], target: [0, 1.65, 0], flameScale: .86 }),
  define({ id: 'stove', label: 'Wood stove', description: 'A compact cast-iron stove, holding a few small pieces behind its open door.',
    limits: '3 pieces · small logs and kindling only', maxPieces: 3,
    fuelTypes: Object.freeze(['small-log', 'kindling']),
    mouth: Object.freeze({ width: 1.55, height: 1.6, depth: 1.15 }),
    length: 1.3, radius: .19, maxLength: .9, maxRadius: .13,
    camera: [1.2, 1.7, 6.6], target: [0, 1.0, 0], flameScale: .43 }),
]);

export const getFireScene = id => FIRE_SCENES.find(scene => scene.id === id) || FIRE_SCENES[0];

const pitDefinitions = [
  [[-1.45, .27, .8], [1.3, .43, -.6], .25],
  [[1.28, .31, 1.08], [-1.22, .42, -.72], .28],
  [[-.85, .32, 1.4], [.62, .66, -1.15], .23],
  [[-1.22, .43, -.96], [.1, 1.37, .1], .25],
  [[1.3, .45, -.8], [-.22, 1.4, .3], .24],
  [[-1.16, .56, .5], [.92, 1.03, -.17], .23],
  [[.85, .52, .95], [-.22, 1.62, -.12], .22],
];

export function sceneLogDefinitions(sceneId) {
  const scene = getFireScene(sceneId);
  if (!scene.mouth) return structuredClone(pitDefinitions);
  // Lay cuts across the opening in a low stack. Every slot has the same cut
  // length, so exchanging a queued piece cannot bypass the size limit.
  return Array.from({ length: scene.maxPieces }, (_, slot) => {
    const yaw = slot % 2 ? -.12 : .12, half = scene.length / 2;
    const z = ((slot % 3) - 1) * scene.mouth.depth * .19;
    const y = .22 + Math.floor(slot / 3) * .24;
    return [[-half * Math.cos(yaw), y, z - half * Math.sin(yaw)],
      [half * Math.cos(yaw), y, z + half * Math.sin(yaw)], scene.radius];
  });
}

const pick = (ids, rand) => ids[Math.min(ids.length - 1, Math.max(0, Math.floor(rand() * ids.length)))];

class HearthCycle extends BurnCycle {
  constructor(scene, seed) {
    super(seed);
    this.fireScene = scene;
    this.reset(seed);
  }
  reset(seed) {
    super.reset(seed);
    // BurnCycle's constructor calls reset before this subclass has its scene.
    if (!this.fireScene) return;
    this.logs.length = this.fireScene.maxPieces;
    const last = this.logs.length - 1;
    if (this.logs.every(log => log.phase !== 'queued')) this.logs[last] = this.makeLog(last);
    this.ashDeposits = this.logs.map(() => 0);
    this.events = []; this.phase = null;
    this.record('A new fire', `${this.logs.length - this.queued} pieces on the bed · ${this.queued} pieces waiting`);
    this.updateSummary();
  }
  randomFuelType() {
    return this.fireScene ? pick(this.fireScene.fuelTypes, this.fuelRandom) : super.randomFuelType();
  }
  fitCut(log) {
    const scene = this.fireScene;
    if (!scene) return log;
    const type = getFuelType(log.fuelType);
    log.scale = Math.min(log.scale, scene.maxLength / (scene.length * type.lengthScale),
      scene.maxRadius / (scene.radius * type.radiusScale));
    return log;
  }
  makeLog(slot, initial = false, fuelType = this.randomFuelType()) {
    if (this.fireScene && !this.fireScene.fuelTypes.includes(fuelType)) fuelType = this.fireScene.id === 'stove' ? 'small-log' : 'log';
    return this.fitCut(super.makeLog(slot, initial, fuelType));
  }
  addLog(fuelType, options) {
    if (fuelType !== undefined && !this.fireScene.fuelTypes.includes(fuelType)) return false;
    const slot = this.logs.find(log => log.phase === 'queued')?.slot ?? this.logs.find(log => log.phase === 'ash')?.slot;
    if (!super.addLog(fuelType, options)) return false;
    this.fitCut(this.logs[slot]);
    return true;
  }
  addRandomFuel(options) {
    return this.addLog(pick(this.fireScene.fuelTypes, this.choiceRandom), options);
  }
}

export function createSceneCycle(sceneId = 'pit', seed = 8108) {
  const scene = getFireScene(sceneId);
  return scene.mouth ? new HearthCycle(scene, seed) : new BurnCycle(seed);
}
