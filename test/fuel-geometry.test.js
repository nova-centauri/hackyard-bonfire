import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFuelGeometry, createFuelMesh, sampleFuelSurface, PLANK_ASPECT_RATIO, boardAspectRatio } from '../src/fuel-geometry.js';
import { createLogGeometry, createBarkDetails } from '../src/log-geometry.js';

const pieces = [
  { fuelType: 'log', radius: .25, length: 2.7 },
  { fuelType: 'small-log', radius: .15, length: 1.65 },
  { fuelType: 'kindling', radius: .065, length: .85 },
  { fuelType: 'plank', radius: .14, length: 2.2 },
  { fuelType: 'stump', radius: .64, length: .82 },
  { fuelType: 'pallet', radius: .09, length: 1.4 },
  { fuelType: 'cardboard', radius: .11, length: 1.0 },
  { fuelType: 'newspaper', radius: .08, length: .75 },
];

function assertWatertight(geometry, label) {
  const p = geometry.attributes.position, ids = new Map(), vertices = [], edges = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(value => Math.round(value * 1e6)).join(',');
    if (!ids.has(key)) ids.set(key, ids.size);
    vertices.push(ids.get(key));
  }
  const index = geometry.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < index.length; i += 3) {
    a.fromBufferAttribute(p, index[i]); b.fromBufferAttribute(p, index[i + 1]); c.fromBufferAttribute(p, index[i + 2]);
    volume += a.dot(b.cross(c)) / 6;
    for (let j = 0; j < 3; j++) {
      const from = vertices[index[i + j]], to = vertices[index[i + (j + 1) % 3]];
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      const edge = edges.get(key) || { count: 0, winding: 0 };
      edge.count++; edge.winding += from < to ? 1 : -1; edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, `${label}: every edge joins two faces`);
    assert.equal(edge.winding, 0, `${label}: neighboring face winding agrees`);
  }
  assert.ok(volume > 0, `${label}: faces enclose positive volume`);
}

test('all fuel categories stay closed and show end grain on both outward-facing caps', () => {
  for (const piece of pieces) for (const faceted of [false, true]) for (const seed of [1, 42]) {
    const mesh = createFuelMesh({ ...piece, faceted, seed }, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial());
    assertWatertight(mesh.geometry, piece.fuelType);
    for (const sign of [-1, 1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(piece.radius * .12, sign * (piece.length + 2), piece.radius * .07), new THREE.Vector3(0, -sign, 0));
      const hit = ray.intersectObject(mesh, false)[0];
      assert.ok(hit, `${piece.fuelType}: missing cap`);
      assert.equal(hit.face.materialIndex, 1);
      assert.ok(hit.face.normal.y * sign > .98);
      assert.ok(hit.point.y * sign > piece.length * .44, `${piece.fuelType}: first hit is the near cap`);
    }
    const profile = mesh.geometry.userData.profile;
    assert.equal(profile.radius, piece.radius, 'category dimensions must not be scaled a second time');
    assert.equal(profile.length, piece.length);
    assert.equal(mesh.geometry.userData.fuelType, piece.fuelType);
    const bounds = mesh.geometry.boundingBox;
    assert.ok(bounds.min.y >= -piece.length * .5 - piece.radius * .16);
    assert.ok(bounds.max.y <= piece.length * .5 + piece.radius * .16);
    assert.ok(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z)) < piece.radius * 1.55);
  }
});

test('a 2×4 has a rectangular cross-section, flat sides, longitudinal grain UVs and exact supplied length', () => {
  const piece = pieces.find(piece => piece.fuelType === 'plank');
  const mesh = createFuelMesh(piece, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial());
  const { geometry } = mesh, size = geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x / size.z - PLANK_ASPECT_RATIO) < 1e-6);
  assert.ok(Math.abs(Math.hypot(size.x, size.z) * .5 - piece.radius) < 1e-7);
  assert.ok(Math.abs(size.y - piece.length) < 1e-6);
  assert.deepEqual(geometry.groups.map(group => group.materialIndex), [0, 1]);
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < n.count; i++) {
    assert.equal(Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i)), 1, 'faces retain axis-aligned flat normals');
    if (n.getY(i) === 0) assert.ok(Math.abs(uv.getY(i) - (p.getY(i) / piece.length + .5)) < 1e-6);
  }
  for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    const hit = new THREE.Raycaster(direction.clone().multiplyScalar(3), direction.clone().negate()).intersectObject(mesh)[0];
    assert.equal(hit.face.materialIndex, 0, 'sawn long faces use the side material');
  }
  const profile = geometry.userData.profile;
  for (let angle = 0; angle < Math.PI * 2; angle += .1) {
    const point = sampleFuelSurface(profile, angle, .25);
    assert.ok(Math.abs(point.x) <= profile.halfWidth + 1e-10);
    assert.ok(Math.abs(point.z) <= profile.halfDepth + 1e-10);
    assert.ok(Math.abs(Math.abs(point.x) - profile.halfWidth) < 1e-10 || Math.abs(Math.abs(point.z) - profile.halfDepth) < 1e-10);
    assert.equal(point.y, -.25 * piece.length);
  }
});

test('stumps have an uneven flared base and bark details follow that same profile', () => {
  const geometry = createFuelGeometry({ fuelType: 'stump', radius: .64, length: .82, seed: 42 });
  const profile = geometry.userData.profile;
  let base = 0, top = 0;
  const radii = [];
  for (let i = 0; i < 72; i++) {
    const angle = i / 72 * Math.PI * 2;
    const bottomPoint = sampleFuelSurface(profile, angle, 0), topPoint = sampleFuelSurface(profile, angle, 1);
    const r = Math.hypot(bottomPoint.x, bottomPoint.z);
    base += r; top += Math.hypot(topPoint.x, topPoint.z); radii.push(r);
  }
  assert.ok(base > top * 1.2, 'the stump spreads outward at the root end');
  assert.ok(Math.max(...radii) - Math.min(...radii) > profile.radius * .2, 'root buttresses create an uneven base rim');
  const details = createBarkDetails(profile);
  assertWatertight(details.peeling, 'stump bark strips');
  const patch = profile.patches[0];
  const expected = sampleFuelSurface(profile, patch.angle, patch.t - patch.height, .0025);
  const actual = new THREE.Vector3().fromBufferAttribute(details.exposed.attributes.position, 4);
  assert.ok(expected.distanceTo(actual) < 1e-6, 'exposed wood follows the flared stump surface');
});

test('pallet, cardboard and newspaper are thin boards with distinct proportions', () => {
  const plank = createFuelGeometry({ fuelType: 'plank', radius: .14, length: 2.2, seed: 7 });
  const pallet = createFuelGeometry({ fuelType: 'pallet', radius: .09, length: 1.4, seed: 7 });
  const cardboard = createFuelGeometry({ fuelType: 'cardboard', radius: .11, length: 1.0, seed: 7 });
  const newspaper = createFuelGeometry({ fuelType: 'newspaper', radius: .08, length: .75, seed: 7 });
  assert.equal(pallet.userData.profile.shape, 'board');
  assert.equal(cardboard.userData.profile.shape, 'board');
  assert.equal(newspaper.userData.profile.shape, 'board');
  assert.ok(pallet.userData.profile.length < plank.userData.profile.length);
  assert.ok(cardboard.userData.profile.halfDepth < pallet.userData.profile.halfDepth);
  assert.ok(newspaper.userData.profile.halfDepth <= cardboard.userData.profile.halfDepth);
  assert.ok(cardboard.userData.profile.aspect > PLANK_ASPECT_RATIO);
  assert.equal(boardAspectRatio('plank'), PLANK_ASPECT_RATIO);
  const same = createFuelGeometry({ fuelType: 'pallet', radius: .09, length: 1.4, seed: 7 });
  assert.deepEqual(pallet.attributes.position.array, same.attributes.position.array);
  assert.deepEqual(pallet.attributes.position.array, createFuelGeometry({ fuelType: 'pallet', radius: .09, length: 1.4, seed: 8 }).attributes.position.array);
});

test('kindling uses restrained bark and omitting fuelType preserves the existing log shape', () => {
  const options = { radius: .065, length: .85, seed: 42 };
  const kindling = createFuelGeometry({ ...options, fuelType: 'kindling' });
  const log = createFuelGeometry(options);
  assert.equal(kindling.userData.profile.patches.length, 1);
  assert.ok(kindling.userData.profile.patches[0].curl < log.userData.profile.patches[0].curl * .3);
  assert.deepEqual(log.attributes.position.array, createLogGeometry(options).attributes.position.array);
  assert.deepEqual(kindling.attributes.position.array, createFuelGeometry({ ...options, fuelType: 'kindling' }).attributes.position.array);
});
