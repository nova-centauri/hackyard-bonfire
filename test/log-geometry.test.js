import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLogGeometry, createLogMesh, createBarkDetails, sampleLogSurface } from '../src/log-geometry.js';

function weldedEdges(geometry) {
  const position = geometry.attributes.position, ids = new Map(), vertices = [], edges = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(value => Math.round(value * 1e6)).join(',');
    if (!ids.has(key)) ids.set(key, ids.size);
    vertices.push(ids.get(key));
  }
  const index = geometry.index.array;
  for (let i = 0; i < index.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = vertices[index[i + j]], b = vertices[index[i + (j + 1) % 3]], key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const edge = edges.get(key) || { count: 0, winding: 0 };
      edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  return [...edges.values()];
}

test('both cut ends render from outside using the actual two-material scene mesh', () => {
  for (const faceted of [false, true]) for (const seed of [1, 42, 8108]) {
    const bark = new THREE.MeshStandardMaterial(), end = new THREE.MeshStandardMaterial();
    const log = createLogMesh({ radius: .25, length: 2.7, seed, faceted }, bark, end);
    assert.equal(log.material.length, 2); assert.equal(end.side, THREE.FrontSide);
    for (const sign of [-1, 1]) for (const offset of [[.017, -.013], [.10, .05], [-.07, -.12]]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(offset[0], sign * 4, offset[1]), new THREE.Vector3(0, -sign, 0));
      const hit = ray.intersectObject(log, false)[0];
      assert.ok(hit, `missing ${sign < 0 ? 'bottom' : 'top'} cap (seed ${seed})`);
      assert.equal(hit.face.materialIndex, 1);
      assert.ok(hit.face.normal.y * sign > .98, 'cut-face normal must point out of the wood');
      assert.ok(Math.abs(hit.point.y) > 1.3, 'first intersection must be the near cap, not the inside of the far cap');
    }
  }
});

test('bent trunks retain watertight cap rims, outward faces and smooth bark UV seams', () => {
  for (const faceted of [false, true]) for (const seed of [1, 42, 8108]) {
    const geometry = createLogGeometry({ radius: .25, length: 2.7, seed, faceted });
    for (const edge of weldedEdges(geometry)) {
      assert.equal(edge.count, 2, 'every geometric edge joins exactly two faces');
      assert.equal(edge.winding, 0, 'neighboring triangles must agree on inside and outside');
    }
    const p = geometry.attributes.position, n = geometry.attributes.normal, ids = geometry.index.array;
    let volume = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < ids.length; i += 3) {
      a.fromBufferAttribute(p, ids[i]); b.fromBufferAttribute(p, ids[i + 1]); c.fromBufferAttribute(p, ids[i + 2]);
      volume += a.dot(b.cross(c)) / 6;
    }
    assert.ok(volume > .35 && volume < .65, 'positive signed volume verifies consistent outward winding');
    for (let i = 0; i < n.count; i++) assert.ok(Math.abs(a.fromBufferAttribute(n, i).length() - 1) < 1e-5);
    if (!faceted) for (let row = 0; row <= 32; row++) {
      a.fromBufferAttribute(n, row * 37); b.fromBufferAttribute(n, row * 37 + 36);
      assert.ok(a.distanceTo(b) < 1e-6, 'duplicated bark seam must have matching smooth normals');
    }
  }
});

test('wood profiles vary deterministically while bark strips remain closed and parented through settling', () => {
  const geometry = createLogGeometry({ radius: .25, length: 2.7, seed: 42 });
  const same = createLogGeometry({ radius: .25, length: 2.7, seed: 42 });
  const different = createLogGeometry({ radius: .25, length: 2.7, seed: 43 });
  assert.deepEqual(geometry.attributes.position.array, same.attributes.position.array);
  assert.notDeepEqual(geometry.attributes.position.array, different.attributes.position.array);
  const profile = geometry.userData.profile;
  const center = sampleLogSurface(profile, 0, .5).add(sampleLogSurface(profile, Math.PI, .5)).multiplyScalar(.5);
  assert.ok(Math.hypot(center.x, center.z) > .004, 'the trunk has a real bend, not just a bark texture');
  const details = createBarkDetails(profile);
  for (const edge of weldedEdges(details.peeling)) { assert.equal(edge.count, 2); assert.equal(edge.winding, 0); }
  assert.equal(details.peeling.groups.length, 2, 'all peeling strips batch into two material draws');
  const trunk = new THREE.Mesh(geometry), peel = new THREE.Mesh(details.peeling); trunk.add(peel);
  trunk.position.set(.1, -.2, .5); trunk.rotation.set(.7, .1, 1.2); trunk.scale.set(.38, .83, .38); trunk.updateMatrixWorld(true);
  const localPoint = new THREE.Vector3().fromBufferAttribute(details.peeling.attributes.position, 17);
  const actual = localPoint.clone().applyMatrix4(peel.matrixWorld), expected = localPoint.clone().applyMatrix4(trunk.matrixWorld);
  assert.ok(actual.distanceTo(expected) < 1e-8, 'bark follows the shortened, tipped and sunken parent');
});

test('bark ridges and a sawn, checked end make firewood rather than a lathed cylinder', () => {
  const profile = createLogGeometry({ radius: .25, length: 2.7, seed: 42 }).userData.profile;
  assert.ok(profile.ridges >= 6 && profile.ridge > .02);
  const mid = Array.from({ length: 24 }, (_, i) => sampleLogSurface(profile, i / 24 * Math.PI * 2, .5));
  const radii = mid.map(p => Math.hypot(p.x, p.z));
  assert.ok(Math.max(...radii) - Math.min(...radii) > profile.radius * .08, 'the midsection is not circular');
  const endY = Array.from({ length: 24 }, (_, i) => sampleLogSurface(profile, i / 24 * Math.PI * 2, 1).y);
  assert.ok(Math.max(...endY) - Math.min(...endY) > .008, 'the cut is a sawn face, not a plane');
  const cap = Array.from({ length: 36 }, (_, i) => {
    const p = sampleLogSurface(profile, i / 36 * Math.PI * 2, 0);
    return Math.hypot(p.x, p.z);
  });
  assert.ok(Math.max(...cap) - Math.min(...cap) > profile.radius * .04, 'a drying check pinches the cap');
});
