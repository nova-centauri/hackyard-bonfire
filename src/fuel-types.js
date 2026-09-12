// Relative dimensions and thermal behavior for each piece of firewood.
// Fractions of wood/char are local to a piece; mass converts them to log units.
// Board thickness is the short side of the rectangle enclosed by radius; keep
// it above the settling contact skin (~12 mm) so thin sheets rest on the bed.
const DEFAULTS = Object.freeze({
  shape: 'round', finish: 'bark', charYield: .26, ashYield: .035, ashPath: false,
  moistureMin: .07, moistureSpan: .28, popScale: 1, flameScale: 1,
});

const define = definition => Object.freeze({ ...DEFAULTS, ...definition });

const wood = (label, extra = {}) => define({
  label, lengthScale: 1, radiusScale: 1, burnRate: 1, heatRate: 1, heatOutput: 1, mass: 1, ...extra,
});

export const FUEL_TYPES = Object.freeze(Object.fromEntries(Object.entries({
  log: { label: 'Log', lengthScale: 1, radiusScale: 1, burnRate: 1, heatRate: 1, heatOutput: 1, mass: 1 },
  'small-log': { label: 'Small log', lengthScale: .64, radiusScale: .60, burnRate: 1.65, heatRate: 1.65, heatOutput: .62, mass: .30 },
  kindling: { label: 'Kindling', lengthScale: .43, radiusScale: .22, burnRate: 3.5, heatRate: 3, heatOutput: .34, mass: .08 },
  // The plank radius encloses its rectangular cross-section (width/thickness 2.33).
  plank: { label: '2×4', lengthScale: .85, radiusScale: .48, burnRate: 1.35, heatRate: 1.4, heatOutput: .70, mass: .34,
    shape: 'board', finish: 'sawn', aspect: 7 / 3 },
  stump: { label: 'Large stump', lengthScale: .36, radiusScale: 1.7, burnRate: .62, heatRate: .65, heatOutput: 1.35, mass: 1.55 },
  pallet: { label: 'Pallet piece', lengthScale: .52, radiusScale: .34, burnRate: 2.15, heatRate: 2.35, heatOutput: .46, mass: .16,
    shape: 'board', finish: 'sawn', aspect: 5.2, charYield: .22, popScale: .85 },
  cardboard: { label: 'Cardboard', lengthScale: .38, radiusScale: .42, burnRate: 5.6, heatRate: 4.4, heatOutput: .38, mass: .045,
    shape: 'board', finish: 'paper', aspect: 10, charYield: .08, moistureMin: .02, moistureSpan: .10, popScale: .28, flameScale: 1.22 },
  newspaper: { label: 'Newspaper', lengthScale: .14, radiusScale: .55, burnRate: 7.6, heatRate: 5.3, heatOutput: .24, mass: .018,
    shape: 'wad', finish: 'paper', charYield: 0, ashYield: .22, ashPath: true,
    moistureMin: .008, moistureSpan: .05, popScale: .12, flameScale: 1.4 },
  hickory: wood('Hickory', { burnRate: .72, heatRate: .78, heatOutput: 1.18, mass: 1.22, charYield: .29, popScale: .9,
    look: { oval: 1.15, ridge: 1.4, ridges: 8, peel: 1.85, peelWidth: 1.15, knotSize: .9, barkColor: '#4a4030', woodColor: '#c8a056' } }),
  maple: wood('Maple', { burnRate: .95, heatRate: .96, heatOutput: 1.02, mass: 1.0,
    look: { oval: .85, ridge: .55, ridges: 6, peel: .7, knotSize: .75, check: .7, barkColor: '#8a6b4c', woodColor: '#d2b078' } }),
  oak: wood('Oak', { burnRate: .78, heatRate: .82, heatOutput: 1.12, mass: 1.18, charYield: .30, popScale: .85, radiusScale: 1.06,
    look: { oval: 1.35, ridge: 1.55, ridges: 9, peel: .55, peelWidth: .8, knotSize: 1.1, check: 1.3, barkColor: '#5a3d24', woodColor: '#c4a05c' } }),
  spruce: wood('Spruce', { lengthScale: 1.06, radiusScale: .88, burnRate: 1.35, heatRate: 1.32, heatOutput: .88, mass: .74, charYield: .22, popScale: 1.35,
    look: { oval: .7, ridge: .9, ridges: 10, peel: .45, knotSize: 1.35, extraKnots: 2, barkColor: '#6a5538', woodColor: '#d6c486' } }),
  birch: wood('Birch', { lengthScale: .94, radiusScale: .90, burnRate: 1.28, heatRate: 1.25, heatOutput: .96, mass: .82, charYield: .20, popScale: .7,
    look: { oval: .75, ridge: .4, ridges: 5, peel: 1.35, peelWidth: 1.2, knotSize: .7, check: .5, barkColor: '#c9b89a', woodColor: '#e2d0a8' } }),
  'white-birch': wood('White birch', { lengthScale: .92, radiusScale: .86, burnRate: 1.38, heatRate: 1.34, heatOutput: .90, mass: .76, charYield: .18, popScale: .55,
    look: { oval: .65, ridge: .28, ridges: 4, peel: 2.1, peelWidth: 1.35, knotSize: .55, check: .35, barkColor: '#efeae0', woodColor: '#eee4c6' } }),
  pine: wood('Pine', { lengthScale: 1.08, radiusScale: .84, burnRate: 1.55, heatRate: 1.48, heatOutput: .92, mass: .68, charYield: .20, popScale: 1.55,
    look: { oval: .8, ridge: .85, ridges: 7, peel: .5, knotSize: 1.7, extraKnots: 3, barkColor: '#b06a32', woodColor: '#e0b45c' } }),
  cedar: wood('Cedar', { lengthScale: 1.04, radiusScale: .82, burnRate: 1.62, heatRate: 1.52, heatOutput: .84, mass: .60, charYield: .17, popScale: 1.25,
    look: { oval: .9, ridge: 1.15, ridges: 11, peel: .9, knotSize: .8, barkColor: '#8a3e28', woodColor: '#c87040' } }),
  walnut: wood('Walnut', { radiusScale: 1.04, burnRate: .88, heatRate: .9, heatOutput: 1.08, mass: 1.12, charYield: .27,
    look: { oval: 1.2, ridge: 1.2, ridges: 8, peel: .8, knotSize: 1.05, barkColor: '#3a2418', woodColor: '#7a4a28' } }),
}).map(([key, definition]) => [key, define(definition)])));

export const FUEL_KIND_IDS = Object.freeze(Object.keys(FUEL_TYPES));

export const WOOD_SPECIES_IDS = Object.freeze(FUEL_KIND_IDS.filter(id => FUEL_TYPES[id].look));

export const getFuelType = (type = 'log') => Object.hasOwn(FUEL_TYPES, type) ? FUEL_TYPES[type] : FUEL_TYPES.log;

export const isBoard = type => getFuelType(type).shape === 'board';

export const isWad = type => getFuelType(type).shape === 'wad';

export function pickRandomFuelKind(rand = Math.random) {
  const ids = FUEL_KIND_IDS;
  const roll = Number(rand());
  const index = Math.min(ids.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * ids.length)));
  return ids[index];
}
