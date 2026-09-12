import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEmbers, EMBER_COUNT, TRAIL_COUNT } from '../src/embers.js';
import { createSteam } from '../src/steam.js';
import { createTwigInstances } from '../src/twig-render.js';
import { createTwigSettling, updateTwigSettling } from '../src/twig-settling.js';
import { createHybridFire } from '../src/hybrid-fire.js';

const finite = array => assert.ok(Array.from(array).every(Number.isFinite), 'attribute values are finite');

test('embers are two GPU draws seeded per particle and share the live fire sources by reference', () => {
  const fire = createHybridFire({ fireVariant: 2, seed: 22 }, null, Array.from({ length: 7 }, (_, i) => [[-1, .2 + i * .1, 0], [1, .2 + i * .1, 0], .2]));
  const embers = createEmbers({ seed: 22, sources: fire.material.uniforms.uSources.value, fuel: fire.material.uniforms.uFuel.value });
  assert.equal(embers.children.length, 2);
  assert.equal(embers.points.geometry.attributes.aSeed.count, EMBER_COUNT);
  assert.equal(embers.streaks.geometry.attributes.aSeed.count, TRAIL_COUNT * 2);
  finite(embers.points.geometry.attributes.aSeed.array); finite(embers.streaks.geometry.attributes.aSeed.array);
  const sources = embers.points.geometry.attributes.aSource.array;
  assert.ok(sources.every(s => s >= 0 && s < 12 && Number.isInteger(s)));
  assert.ok(new Set(sources).size >= 10, 'embers are spread across the flame roots');
  // Both halves of a trail describe the same ember.
  const trail = embers.streaks.geometry.attributes;
  for (let i = 0; i < TRAIL_COUNT; i++) {
    assert.deepEqual(Array.from(trail.aSeed.array.slice(i * 8, i * 8 + 4)), Array.from(trail.aSeed.array.slice(i * 8 + 4, i * 8 + 8)));
    assert.equal(trail.aTrail.array[i * 2], 0); assert.equal(trail.aTrail.array[i * 2 + 1], 1);
  }
  fire.material.uniforms.uFuel.value[3] = .25;
  assert.equal(embers.uniforms.uFuel.value[3], .25, 'fuel changes made for the fire reach the embers without copying');
  assert.strictEqual(embers.points.material.uniforms, embers.streaks.material.uniforms);
  embers.setDensity(2); assert.equal(embers.uniforms.uDensity.value, 1);
  embers.setDensity(.4); assert.equal(embers.uniforms.uDensity.value, .4);
  const standalone = createEmbers({ seed: 5 });
  assert.equal(standalone.uniforms.uSources.value.length, 12);
  assert.ok(standalone.uniforms.uSources.value.every(v => Number.isFinite(v.w) && v.w > 0));
  embers.dispose(); standalone.dispose();
});

test('steam is a single instanced draw whose origins and strengths follow the logs', () => {
  const steam = createSteam({ logs: 7, perLog: 15, map: new THREE.DataTexture(new Uint8Array(4), 1, 1) });
  assert.equal(steam.geometry.instanceCount, 105);
  assert.equal(steam.geometry.attributes.aLog.count, 105);
  assert.equal(steam.geometry.attributes.aSeed.count, 105);
  const logs = steam.geometry.attributes.aLog.array, phases = steam.geometry.attributes.aPhase.array;
  assert.equal(logs[0], 0); assert.equal(logs[104], 6);
  finite(phases); finite(steam.geometry.attributes.aSeed.array);
  assert.ok(phases.every(phase => phase >= 0 && phase < 1), 'no phase wraps to a duplicate endpoint');
  for (let li = 0; li < 7; li++) {
    const ages = Array.from(phases.slice(li * 15, (li + 1) * 15)).sort((a, b) => a - b);
    assert.equal(new Set(ages).size, 15, 'each log has distinct wisps');
    for (let k = 0; k < 15; k++) assert.ok(Math.abs((ages[(k + 1) % 15] - ages[k] + 1) % 1 - 1 / 15) < 1e-6, 'the plume stays evenly filled across recycling');
  }
  assert.equal(new Set(Array.from({ length: 7 }, (_, li) => phases[li * 15])).size, 7, 'logs do not release wisps in lockstep');
  const repeat = createSteam({ logs: 7, perLog: 15 });
  assert.deepEqual(repeat.geometry.attributes.aSeed.array, steam.geometry.attributes.aSeed.array, 'variation is deterministic');
  repeat.geometry.dispose(); repeat.material.dispose();
  steam.setOrigin(2, new THREE.Vector3(1, 2, 3)); steam.setOrigin(9, new THREE.Vector3(9, 9, 9));
  assert.deepEqual(steam.uniforms.uOrigins.value[2].toArray(), [1, 2, 3]);
  assert.equal(steam.uniforms.uOrigins.value.length, 7, 'an out-of-range log is ignored');
  steam.setStrength(0, 4); steam.setStrength(1, .3);
  assert.equal(steam.uniforms.uStrength.value[0], 1); assert.ok(Math.abs(steam.uniforms.uStrength.value[1] - .3) < 1e-6);
  assert.equal(steam.material.transparent, true); assert.equal(steam.material.depthWrite, false);
  assert.deepEqual(steam.uniforms.uWind.value.toArray(), [0, 0]);
});

test('twig segments and glows are mirrored into instanced meshes that follow the settling', () => {
  const scene = new THREE.Scene(), twigs = new THREE.Group(), layers = { flames: new THREE.Group(), sparks: new THREE.Group() };
  scene.add(twigs, layers.flames, layers.sparks); twigs.position.y = -.16;
  const material = new THREE.MeshStandardMaterial();
  const add = (a, b, radius) => {
    const direction = b.clone().sub(a), branch = new THREE.Mesh(new THREE.CylinderGeometry(radius * .55, radius, direction.length(), 7, 3), material);
    branch.position.copy(a).lerp(b, .5); branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); twigs.add(branch); return branch;
  };
  const a = new THREE.Vector3(.9, .42, .7), b = new THREE.Vector3(.8, 1.1, .5);
  const main = add(a, b, .03); add(a.clone().lerp(b, .58), b.clone().add(new THREE.Vector3(.2, .12, -.18)), .015);
  const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(.018, 0), new THREE.MeshBasicMaterial());
  glow.userData.twigGlowOrigin = a.clone().lerp(b, .6); glow.position.copy(glow.userData.twigGlowOrigin).add(twigs.position); glow.scale.y = 2.2;
  layers.sparks.add(glow); scene.updateMatrixWorld(true);
  const instances = createTwigInstances(twigs, layers);
  assert.equal(instances.mesh.count, 2); assert.equal(instances.glowMesh.count, 1);
  assert.equal(main.visible, false); assert.equal(glow.visible, false);
  assert.strictEqual(instances.mesh.material, material);
  const matrix = new THREE.Matrix4(), expected = new THREE.Matrix4();
  instances.mesh.getMatrixAt(0, matrix);
  expected.makeScale(.03, a.distanceTo(b), .03).premultiply(main.matrix);
  assert.ok(matrix.elements.every((value, i) => Math.abs(value - expected.elements[i]) < 1e-6), 'the instance reproduces the segment mesh transform');
  instances.glowMesh.getMatrixAt(0, matrix);
  assert.ok(matrix.elements.every((value, i) => Math.abs(value - glow.matrix.elements[i]) < 1e-6));
  // Settling moves the logical meshes; a sync moves the instances with them.
  const settling = createTwigSettling(twigs, layers), cycle = { seed: 1, resetSerial: 0, time: 100 };
  updateTwigSettling(settling, cycle, 0, [], () => -.2); updateTwigSettling(settling, cycle, 2, [], () => -.2);
  const before = new THREE.Matrix4(); instances.mesh.getMatrixAt(0, before);
  instances.sync();
  instances.mesh.getMatrixAt(0, matrix);
  assert.ok(!matrix.equals(before), 'a fallen twig moves its instance');
  expected.makeScale(.03, a.distanceTo(b), .03).premultiply(main.matrix);
  assert.ok(matrix.elements.every((value, i) => Math.abs(value - expected.elements[i]) < 1e-6));
  assert.equal(instances.mesh.instanceMatrix.needsUpdate || instances.mesh.instanceMatrix.version > 0, true);
});
