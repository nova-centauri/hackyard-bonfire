import * as THREE from 'three';
import { createLogGeometry, sampleLogSurface } from './log-geometry.js';
import { getFuelType, isBoard } from './fuel-types.js';
import { random } from './textures.js';

// A nominal 2×4 has a 3.5 : 1.5 cross-section. Radius is the distance to
// a corner, so the scene can continue to use a single transverse size.
export const PLANK_ASPECT_RATIO = 7 / 3;

export function boardAspectRatio(fuelType = 'plank') {
  return getFuelType(fuelType).aspect ?? PLANK_ASPECT_RATIO;
}

function createBoardGeometry({ radius, length, fuelType = 'plank', seed = 1 }) {
  const aspect = boardAspectRatio(fuelType);
  const halfDepth = radius / Math.hypot(aspect, 1), halfWidth = halfDepth * aspect;
  const type = getFuelType(fuelType);
  const ySegs = fuelType === 'pallet' ? 4 : type.finish === 'paper' ? 5 : 1;
  const geometry = new THREE.BoxGeometry(halfWidth * 2, length, halfDepth * 2, 1, ySegs, 1);
  const indices = [], originalIndices = geometry.index.array;
  const longFaces = [0, 1, 4, 5], endFaces = [2, 3];
  for (const face of [...longFaces, ...endFaces]) {
    const group = geometry.groups[face];
    indices.push(...originalIndices.slice(group.start, group.start + group.count));
  }
  geometry.setIndex(indices);
  geometry.clearGroups();
  const longCount = longFaces.length * 6 * ySegs;
  geometry.addGroup(0, longCount, 0);
  geometry.addGroup(longCount, 12, 1);
  // Every side's longitudinal grain runs along y, including the narrow edges.
  const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
  const rand = random(seed);
  let deformed = false;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(normal.getY(i)) > .5) continue;
    const u = Math.abs(normal.getX(i)) > .5 ? position.getZ(i) / (halfDepth * 2) + .5 : position.getX(i) / (halfWidth * 2) + .5;
    uv.setXY(i, u, position.getY(i) / length + .5);
    const along = Math.abs(position.getY(i)) / (length * .5);
    if (fuelType === 'pallet' && along > .78) {
      const chip = .05 + rand() * .07;
      position.setX(i, position.getX(i) * (1 - chip * (along - .78) / .22));
      deformed = true;
    } else if (type.finish === 'paper') {
      const wrinkle = Math.sin(position.getY(i) * 11 + seed) * .55 + Math.sin(position.getX(i) * 17 + seed * .4) * .2;
      if (Math.abs(normal.getZ(i)) > .5) {
        position.setZ(i, position.getZ(i) + Math.sign(normal.getZ(i)) * wrinkle * halfDepth * .28);
        deformed = true;
      }
    }
  }
  if (deformed) geometry.computeVertexNormals();
  geometry.userData.profile = { shape: 'board', fuelType, radius, length, halfWidth, halfDepth, aspect };
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function createFuelGeometry({ fuelType = 'log', ...options }) {
  const geometry = isBoard(fuelType) ? createBoardGeometry({ ...options, fuelType }) : createLogGeometry({ ...options, fuelType });
  geometry.userData.fuelType = fuelType;
  return geometry;
}

export function createFuelMesh(options, sideMaterial, endMaterial) {
  return new THREE.Mesh(createFuelGeometry(options), [sideMaterial, endMaterial]);
}

export function sampleFuelSurface(profile, angle, t, offset = 0, target = new THREE.Vector3()) {
  if (profile.halfWidth == null) return sampleLogSurface(profile, angle, t, offset, target);
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const toX = profile.halfWidth / Math.abs(dx), toZ = profile.halfDepth / Math.abs(dz);
  const r = Math.min(toX, toZ);
  return target.set(dx * r + (toX <= toZ ? Math.sign(dx) * offset : 0),
    (t - .5) * profile.length, dz * r + (toZ <= toX ? Math.sign(dz) * offset : 0));
}
