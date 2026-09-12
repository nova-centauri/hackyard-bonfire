// Relative dimensions and thermal behavior for each piece of firewood.
// Fractions of wood/char are local to a piece; mass converts them to log units.
// Board thickness is the short side of the rectangle enclosed by radius; keep
// it above the settling contact skin (~12 mm) so thin sheets rest on the bed.
const DEFAULTS = Object.freeze({
  shape: 'round', finish: 'bark', charYield: .26, ashYield: .035,
  moistureMin: .07, moistureSpan: .28, popScale: 1, flameScale: 1,
});

const define = definition => Object.freeze({ ...DEFAULTS, ...definition });

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
  newspaper: { label: 'Newspaper', lengthScale: .28, radiusScale: .30, burnRate: 7.6, heatRate: 5.3, heatOutput: .24, mass: .018,
    shape: 'board', finish: 'paper', aspect: 9, charYield: .04, moistureMin: .008, moistureSpan: .05, popScale: .12, flameScale: 1.4 },
}).map(([key, definition]) => [key, define(definition)])));

export const FUEL_KIND_IDS = Object.freeze(Object.keys(FUEL_TYPES));

export const getFuelType = (type = 'log') => Object.hasOwn(FUEL_TYPES, type) ? FUEL_TYPES[type] : FUEL_TYPES.log;

export const isBoard = type => getFuelType(type).shape === 'board';

export function pickRandomFuelKind(rand = Math.random) {
  const ids = FUEL_KIND_IDS;
  const roll = Number(rand());
  const index = Math.min(ids.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * ids.length)));
  return ids[index];
}
