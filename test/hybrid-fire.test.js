import test from 'node:test';
import assert from 'node:assert/strict';
import { createHybridFire } from '../src/hybrid-fire.js';

const makeFire = () => createHybridFire({ fireVariant: 1, seed: 22 }, null,
  Array.from({ length: 7 }, (_, i) => [[-1, .2 + i * .1, 0], [1, .2 + i * .1, 0], .2]));

// Dropped/rolling fuel is allowed to leave the original center-of-fire box.
// Both lifted plumes and their surface-contact combustion must remain enclosed.
test('the flame volume follows burning logs beyond the original pit bounds', () => {
  const fire = makeFire(), u = fire.material.uniforms;
  u.uFuel.value.fill(0); u.uFuel.value[0] = .8;
  u.uLogHeat.value.fill(0); u.uLogHeat.value[0] = .7;
  u.uSources.value[0].set(4.5, .7, -3.3, 2);
  u.uLogA.value[0].set(3.3, .2, -3.3, .2);
  u.uLogB.value[0].set(5.7, .4, -3.3, .18);
  fire.onBeforeRender();
  const lo = u.uLo.value, hi = u.uHi.value;
  assert.ok(lo.x < 3.1 && hi.x > 5.88, 'the complete emitting log fits');
  assert.ok(lo.z < -3.5 && hi.z > -3.1, 'the displaced flame has depth');
  assert.ok(lo.y <= 0 && hi.y > 2.7, 'the contact roots and plume tips fit');
  u.uFuel.value.fill(0); u.uLogHeat.value.fill(0);
  fire.onBeforeRender();
  assert.ok([...lo.toArray(), ...hi.toArray()].every(Number.isFinite), 'an extinguished fire retains finite bounds');
  fire.geometry.dispose(); fire.material.dispose();
});

test('flame motion is continuous and independent of how many frames were rendered', () => {
  const first = makeFire(), second = makeFire();
  const a = first.material.uniforms, b = second.material.uniforms;
  a.uTime.value = 2; first.onBeforeRender();
  a.uTime.value = 4; first.onBeforeRender();
  b.uTime.value = 4; second.onBeforeRender();
  assert.deepEqual(a.uSourceMotion.value.map(v => v.toArray()), b.uSourceMotion.value.map(v => v.toArray()));
  const before = a.uSourceMotion.value.map(v => v.clone());
  a.uTime.value += 1 / 60; first.onBeforeRender();
  assert.ok(a.uSourceMotion.value.every((v, i) => v.clone().sub(before[i]).length() < .01), 'source motion cannot snap between frames');
  assert.ok(a.uSourceMotion.value[0].clone().sub(a.uSourceMotion.value[1]).length() > .001, 'neighboring sources have independent motion');
  for (const fire of [first, second]) { fire.geometry.dispose(); fire.material.dispose(); }
});
