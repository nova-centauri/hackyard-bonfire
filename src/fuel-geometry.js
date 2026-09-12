import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLogGeometry, sampleLogSurface } from './log-geometry.js';
import { random } from './textures.js';
import { getFuelType, isBoard, isWad } from './fuel-types.js';

// A nominal 2×4 has a 3.5 : 1.5 cross-section. Radius is the distance to
// a corner, so the scene can continue to use a single transverse size.
export const PLANK_ASPECT_RATIO = 7 / 3;

export function boardAspectRatio(fuelType = 'plank') {
  return getFuelType(fuelType).aspect ?? PLANK_ASPECT_RATIO;
}

function createBoardGeometry({ radius, length, fuelType = 'plank' }) {
  const aspect = boardAspectRatio(fuelType);
  const halfDepth = radius / Math.hypot(aspect, 1), halfWidth = halfDepth * aspect;
  const geometry = new THREE.BoxGeometry(halfWidth * 2, length, halfDepth * 2);
  const indices = [], originalIndices = geometry.index.array;
  const longFaces = [0, 1, 4, 5], endFaces = [2, 3];
  for (const face of [...longFaces, ...endFaces]) {
    const group = geometry.groups[face];
    indices.push(...originalIndices.slice(group.start, group.start + group.count));
  }
  geometry.setIndex(indices);
  geometry.clearGroups();
  geometry.addGroup(0, 24, 0);
  geometry.addGroup(24, 12, 1);
  // Every side's longitudinal grain runs along y, including the narrow edges.
  const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(normal.getY(i)) > .5) continue;
    const u = Math.abs(normal.getX(i)) > .5 ? position.getZ(i) / (halfDepth * 2) + .5 : position.getX(i) / (halfWidth * 2) + .5;
    uv.setXY(i, u, position.getY(i) / length + .5);
  }
  geometry.userData.profile = { shape: 'board', fuelType, radius, length, halfWidth, halfDepth, aspect };
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const TAU = Math.PI * 2;

function createWadProfile({ radius, length, seed = 1, faceted = false, fuelType = 'newspaper' }) {
  const rand = random(seed);
  return {
    shape: 'wad', fuelType, radius, length, faceted,
    phase: rand() * TAU,
    squash: .80 + rand() * .08,
    bulge: .11 + rand() * .07,
    folds: Array.from({ length: faceted ? 4 : 6 }, () => ({
      angle: rand() * TAU, t: .16 + rand() * .68,
      width: .20 + rand() * .24, depth: .12 + rand() * .10,
      twist: (rand() - .5) * 1.6,
    })),
  };
}

function wadShape(profile, angle, t) {
  const { phase, folds } = profile, ny = t * 2 - 1;
  let s = 1 + profile.bulge * Math.sin(3 * angle + phase) * (1 - ny * ny)
    + .07 * Math.sin(5 * angle - t * 8 + phase)
    + .05 * Math.sin(t * 13 + phase)
    + .04 * Math.cos(2 * angle + t * 6 + phase);
  for (const fold of folds) {
    const across = Math.atan2(Math.sin(angle - fold.angle), Math.cos(angle - fold.angle)) / fold.width;
    const along = (t - fold.t) / .2;
    const g = Math.exp(-(across * across + along * along));
    s -= fold.depth * g;
    s += fold.depth * .4 * Math.exp(-(across * across * .4 + along * along));
  }
  return Math.max(.58, Math.min(1.32, s));
}

export function sampleWadSurface(profile, angle, t, offset = 0, target = new THREE.Vector3()) {
  const ny = (t - .5) * 2, ring = Math.sqrt(Math.max(0, 1 - ny * ny)), s = wadShape(profile, angle, t);
  const rx = profile.radius * profile.squash * ring * s + offset;
  return target.set(Math.cos(angle) * rx, (t - .5) * profile.length * (.92 + .08 * s), Math.sin(angle) * rx);
}

function createWadGeometry({ radius, length, seed = 1, faceted = false, fuelType = 'newspaper' }) {
  const profile = createWadProfile({ radius, length, seed, faceted, fuelType });
  const geometry = new THREE.IcosahedronGeometry(1, faceted ? 1 : 2);
  const positions = geometry.attributes.position, point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    sampleWadSurface(profile, Math.atan2(z, x), THREE.MathUtils.clamp(y * .5 + .5, 0, 1), 0, point);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  const indexed = mergeVertices(geometry, 1e-4);
  geometry.dispose();
  indexed.computeVertexNormals();
  indexed.userData.profile = profile;
  indexed.computeBoundingBox(); indexed.computeBoundingSphere();
  return indexed;
}

export function createFuelGeometry({ fuelType = 'log', ...options }) {
  const geometry = isWad(fuelType) ? createWadGeometry({ ...options, fuelType })
    : isBoard(fuelType) ? createBoardGeometry({ ...options, fuelType })
    : createLogGeometry({ ...options, fuelType });
  geometry.userData.fuelType = fuelType;
  return geometry;
}

export function createFuelMesh(options, sideMaterial, endMaterial) {
  const geometry = createFuelGeometry(options);
  return new THREE.Mesh(geometry, isWad(options.fuelType) ? sideMaterial : [sideMaterial, endMaterial]);
}

export function sampleFuelSurface(profile, angle, t, offset = 0, target = new THREE.Vector3()) {
  if (profile.shape === 'wad') return sampleWadSurface(profile, angle, t, offset, target);
  if (profile.halfWidth == null) return sampleLogSurface(profile, angle, t, offset, target);
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const toX = profile.halfWidth / Math.abs(dx), toZ = profile.halfDepth / Math.abs(dz);
  const r = Math.min(toX, toZ);
  return target.set(dx * r + (toX <= toZ ? Math.sign(dx) * offset : 0),
    (t - .5) * profile.length, dz * r + (toZ <= toX ? Math.sign(dz) * offset : 0));
}
