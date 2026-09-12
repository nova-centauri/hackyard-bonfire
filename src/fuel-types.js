// Relative dimensions and thermal behavior for each piece of firewood.
// Fractions of wood/char are local to a piece; mass converts them to log units.
export const FUEL_TYPES = Object.freeze(Object.fromEntries(Object.entries({
  log: { label: 'Log', lengthScale: 1, radiusScale: 1, burnRate: 1, heatRate: 1, heatOutput: 1, mass: 1 },
  'small-log': { label: 'Small log', lengthScale: .64, radiusScale: .60, burnRate: 1.65, heatRate: 1.65, heatOutput: .62, mass: .30 },
  kindling: { label: 'Kindling', lengthScale: .43, radiusScale: .22, burnRate: 3.5, heatRate: 3, heatOutput: .34, mass: .08 },
  // The plank radius encloses its rectangular cross-section (width/thickness 2.33).
  plank: { label: '2×4', lengthScale: .85, radiusScale: .48, burnRate: 1.35, heatRate: 1.4, heatOutput: .70, mass: .34 },
  stump: { label: 'Large stump', lengthScale: .36, radiusScale: 1.7, burnRate: .62, heatRate: .65, heatOutput: 1.35, mass: 1.55 },
}).map(([key, definition]) => [key, Object.freeze(definition)])));

export const getFuelType = (type = 'log') => Object.hasOwn(FUEL_TYPES, type) ? FUEL_TYPES[type] : FUEL_TYPES.log;
