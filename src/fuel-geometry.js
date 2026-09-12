import * as THREE from 'three';
import { createLogGeometry, sampleLogSurface } from './log-geometry.js';

// A nominal 2×4 has a 3.5 : 1.5 cross-section. Radius is the distance to
// a corner, so the scene can continue to use a single transverse size.
export const PLANK_ASPECT_RATIO = 7 / 3;

function createPlankGeometry({ radius, length }) {
  const halfDepth = radius / Math.hypot(PLANK_ASPECT_RATIO, 1), halfWidth = halfDepth * PLANK_ASPECT_RATIO;
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
  geometry.userData.profile = { shape: 'plank', fuelType: 'plank', radius, length, halfWidth, halfDepth };
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function createFuelGeometry({ fuelType = 'log', ...options }) {
  const geometry = fuelType === 'plank' ? createPlankGeometry(options) : createLogGeometry({ ...options, fuelType });
  geometry.userData.fuelType = fuelType;
  return geometry;
}

export function createFuelMesh(options, sideMaterial, endMaterial) {
  return new THREE.Mesh(createFuelGeometry(options), [sideMaterial, endMaterial]);
}

export function sampleFuelSurface(profile, angle, t, offset = 0, target = new THREE.Vector3()) {
  if (profile.shape !== 'plank') return sampleLogSurface(profile, angle, t, offset, target);
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const toX = profile.halfWidth / Math.abs(dx), toZ = profile.halfDepth / Math.abs(dz);
  const r = Math.min(toX, toZ);
  return target.set(dx * r + (toX <= toZ ? Math.sign(dx) * offset : 0),
    (t - .5) * profile.length, dz * r + (toZ <= toX ? Math.sign(dz) * offset : 0));
}
