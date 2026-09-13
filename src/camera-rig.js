// Default look and orbit clamps. Pure so tests can assert poses without a
// browser. The viewer applies these to OrbitControls; it does not restyle
// hearths or change indoor framing.

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// Small right-drag (raise the look so the flame sits mid-frame) then a small
// left-drag (orbit a little higher for a more downward view). Modest on purpose.
export const PIT_FULL = Object.freeze({
  camera: Object.freeze([6.5, 5.35, 8]),
  target: Object.freeze([0, 2.15, 0]),
});

export const MAX_POLAR_ANGLE = Math.PI * .48;
export const INDOOR_AZIMUTH = .48;

// Room floor y in `fire-sets` is -.71. There is no ceiling mesh; 3.55 is a
// look stop so orbit cannot climb out over the back wall and mantel.
export function roomEnvelope(scene) {
  if (!scene?.mouth) return null;
  return Object.freeze({ floorY: -.71, ceilingY: 3.55 });
}

export function orbitLimits(scene) {
  const indoor = !!scene?.mouth;
  const room = roomEnvelope(scene);
  return {
    indoor,
    minAzimuthAngle: indoor ? -INDOOR_AZIMUTH : -Infinity,
    maxAzimuthAngle: indoor ? INDOOR_AZIMUTH : Infinity,
    minDistance: indoor ? scene.mouth.depth / 2 + 2 : 2.1,
    maxDistance: indoor ? 15 : 19,
    minPolarAngle: indoor ? Math.PI * .32 : 0,
    maxPolarAngle: indoor ? Math.PI * .5 : MAX_POLAR_ANGLE,
    minY: indoor ? .12 : .42,
    maxY: indoor ? room.ceilingY - .12 : Infinity,
    targetMinY: indoor ? .2 : .3,
    targetMaxY: indoor ? 1.8 : 8,
    enablePan: !indoor,
  };
}

export function polarLimits(radius, limits, targetY) {
  const r = Math.max(radius, 1e-4);
  let minPolarAngle = limits.minPolarAngle, maxPolarAngle = limits.maxPolarAngle;
  if (Number.isFinite(limits.maxY)) minPolarAngle = Math.max(minPolarAngle, Math.acos(clamp((limits.maxY - targetY) / r, -1, 1)));
  if (Number.isFinite(limits.minY)) maxPolarAngle = Math.min(maxPolarAngle, Math.acos(clamp((limits.minY - targetY) / r, -1, 1)));
  if (minPolarAngle > maxPolarAngle) minPolarAngle = maxPolarAngle;
  return { minPolarAngle, maxPolarAngle };
}

export function sphericalFrom(position, target) {
  const x = position.x - target.x, y = position.y - target.y, z = position.z - target.z;
  const radius = Math.hypot(x, y, z);
  return { radius, phi: radius > 1e-8 ? Math.acos(clamp(y / radius, -1, 1)) : 0, theta: Math.atan2(x, z) };
}

export function applySpherical(position, target, { radius, phi, theta }) {
  const sin = Math.sin(phi);
  position.x = target.x + radius * sin * Math.sin(theta);
  position.y = target.y + radius * Math.cos(phi);
  position.z = target.z + radius * sin * Math.cos(theta);
  return position;
}

export function fitLook(position, target, limits) {
  target.y = clamp(target.y, limits.targetMinY, limits.targetMaxY);
  const look = sphericalFrom(position, target);
  const polar = polarLimits(look.radius, limits, target.y);
  const theta = clamp(look.theta, limits.minAzimuthAngle, limits.maxAzimuthAngle);
  const phi = clamp(look.phi, polar.minPolarAngle, polar.maxPolarAngle);
  if (Math.abs(theta - look.theta) < 1e-9 && Math.abs(phi - look.phi) < 1e-9
      && position.y >= limits.minY - 1e-6 && position.y <= limits.maxY + 1e-6) return position;
  return applySpherical(position, target, { radius: look.radius, phi, theta });
}

export function lookInsideRoom(position, limits) {
  return position.y >= limits.minY - 1e-6 && position.y <= limits.maxY + 1e-6;
}
