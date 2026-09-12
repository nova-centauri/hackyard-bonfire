import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ashAmount, createAshBed, rasterizeCoalHeat, updateAshBed } from '../src/ash-bed.js';
import { clearingFalloff } from '../src/ground.js';

const surface = () => createAshBed(new THREE.Mesh(new THREE.PlaneGeometry(5, 5, 3, 3), new THREE.MeshStandardMaterial()));
const cycle = () => ({ seed: 42, resetSerial: 1, time: 0, coalMass: .5, ashMass: 0, ashDeposits: Array(7).fill(0), logs: [] });
const coals = pieces => ({ userData: { coalState: { pieces } } });
const heatAt = (state, x, z) => {
  const { width, height, data } = state.heatMap.image;
  const column = THREE.MathUtils.clamp(Math.floor((x + 2.4) / 4.8 * width), 0, width - 1);
  const row = THREE.MathUtils.clamp(Math.floor((z + 2.4) / 4.8 * height), 0, height - 1);
  return data[(row * width + column) * 4] / 255;
};

test('ash accumulates across replaced log slots and only resets for a new fire', () => {
  const soil = surface(), burn = cycle(), state = soil.userData.ashState;
  updateAshBed(soil, burn, coals([]), 0);
  assert.equal(state.amount, 0);
  burn.logs = [{ fuelType: 'log', ash: .2 }]; burn.ashMass = .12; burn.time = 1;
  updateAshBed(soil, burn, coals([]), .25);
  const first = state.amount;
  assert.ok(first > 0 && first < 1);
  assert.equal(state.uniforms.uAshAmount.value, first);
  // Reusing a log slot discards that log object, not the ash already on soil.
  burn.logs = [{ fuelType: 'log', ash: 0 }]; burn.ashMass = .02; burn.time = 2;
  updateAshBed(soil, burn, coals([]), .5);
  assert.equal(state.amount, first);
  burn.ashDeposits[0] = 1; burn.ashMass = .8; burn.time = 3;
  updateAshBed(soil, burn, coals([]), .75);
  assert.ok(state.amount > first && state.amount <= 1);
  burn.resetSerial++; burn.logs = []; burn.ashMass = 0; burn.ashDeposits.fill(0); burn.time = 0;
  updateAshBed(soil, burn, coals([]), 0);
  assert.equal(state.amount, 0);
  assert.equal(state.uniforms.uAshAmount.value, 0);
  assert.equal(ashAmount({ ashMass: 0 }), 0, 'static scenes need no lifecycle log list');
  assert.equal(ashAmount({ ashMass: 100 }), 1, 'large accumulated deposits stay bounded');
});

test('only nearby hot coal heats the ash and cooling clears its previous halo', () => {
  const state = surface().userData.ashState;
  const hot = { x: .65, z: -.35, radius: .12, heat: .95 };
  const cold = { x: -.8, z: .7, radius: .2, heat: .06 };
  rasterizeCoalHeat(state, [hot, cold]);
  assert.ok(heatAt(state, hot.x, hot.z) > .9, 'ash touching hot coal glows');
  assert.equal(heatAt(state, cold.x, cold.z), 0, 'cold coal cannot radiate an orange patch');
  assert.equal(heatAt(state, 0, 0), 0, 'gaps stay dark instead of joining a global glowing disk');
  assert.equal(heatAt(state, 1.8, -1.8), 0);
  assert.ok(state.field.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  hot.heat = .08;
  rasterizeCoalHeat(state, [hot, cold]);
  assert.ok(state.field.every(value => value === 0));
  for (let i = 0; i < state.heatMap.image.data.length; i += 4) assert.equal(state.heatMap.image.data[i], 0);
});

test('overlapping coal halos remain bounded and small spent coals heat less surrounding ash', () => {
  const state = surface().userData.ashState;
  const coal = { x: 0, z: 0, radius: .2, heat: .65 };
  rasterizeCoalHeat(state, [coal]);
  const single = heatAt(state, 0, 0), wideHeat = state.field.reduce((sum, value) => sum + value, 0);
  rasterizeCoalHeat(state, [coal, coal]);
  assert.ok(heatAt(state, 0, 0) > single);
  assert.ok(state.field.every(value => value >= 0 && value <= 1));
  rasterizeCoalHeat(state, [coal], .28);
  assert.ok(state.field.reduce((sum, value) => sum + value, 0) < wideHeat * .5, 'shrinking coal has a smaller thermal footprint');
});

test('heat texture updates at five Hz, stays unchanged during a paused burn, and resets immediately', () => {
  const soil = surface(), burn = cycle(), state = soil.userData.ashState;
  const coal = { x: 0, z: 0, radius: .15, heat: .95 }, bed = coals([coal]);
  updateAshBed(soil, burn, bed, 0);
  const original = state.heatMap.version, hot = heatAt(state, 0, 0);
  coal.heat = .06; burn.time = 1;
  updateAshBed(soil, burn, bed, .1);
  assert.equal(state.heatMap.version, original, 'sub-200 ms calls reuse the field');
  assert.equal(heatAt(state, 0, 0), hot);
  updateAshBed(soil, burn, bed, .21);
  assert.equal(state.heatMap.version, original + 1);
  assert.equal(heatAt(state, 0, 0), 0);
  coal.heat = .95;
  updateAshBed(soil, burn, bed, 2);
  assert.equal(state.heatMap.version, original + 1, 'a stationary burn clock does not age/rebuild heat');
  updateAshBed(soil, burn, bed, 2, true);
  assert.equal(state.heatMap.version, original + 2, 'explicit refresh still works while paused');
  assert.ok(heatAt(state, 0, 0) > .9);
  burn.resetSerial++; coal.heat = 0;
  updateAshBed(soil, burn, bed, 0);
  assert.equal(state.heatMap.version, original + 3, 'reset ignores throttle and backward visual time');
  assert.equal(heatAt(state, 0, 0), 0, 'reset removes stale glowing patches');
});

test('ash preserves the ground material shader and callback context while adding local heat uniforms', () => {
  const material = clearingFalloff(new THREE.MeshStandardMaterial());
  const clearingCompile = material.onBeforeCompile;
  const renderer = { name: 'renderer supplied by THREE' };
  let calls = 0;
  material.onBeforeCompile = function(shader, actualRenderer) {
    calls++;
    assert.equal(this, material);
    assert.equal(actualRenderer, renderer);
    clearingCompile.call(this, shader, actualRenderer);
    shader.uniforms.uExistingGround = { value: .7 };
  };
  const key = material.customProgramCacheKey();
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  assert.equal(createAshBed(soil), soil);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, renderer);
  assert.equal(calls, 1);
  assert.equal(shader.uniforms.uExistingGround.value, .7);
  assert.equal(shader.uniforms.uAshAmount, soil.userData.ashState.uniforms.uAshAmount);
  assert.equal(shader.uniforms.uAshHeat.value, soil.userData.ashState.heatMap);
  assert.ok(shader.vertexShader.includes('vClearingPosition') && shader.vertexShader.includes('vAshWorld'));
  assert.ok(shader.fragmentShader.includes('outgoingLight *= firePool * firePool'), 'distant soil retains its existing darkness falloff');
  assert.ok(material.customProgramCacheKey().startsWith(key + ':'), 'ash and plain-ground programs cannot share an incompatible cache entry');
});

test('growing and heating ash changes neither geometry nor material program versions', () => {
  const soil = surface(), burn = cycle(), parent = new THREE.Group(); parent.add(soil);
  soil.updateMatrixWorld();
  const geometry = soil.geometry, material = soil.material, positions = geometry.attributes.position;
  const positionsBefore = positions.array.slice(), indexBefore = geometry.index.array.slice();
  const matrixBefore = soil.matrixWorld.elements.slice(), childCount = parent.children.length;
  const positionVersion = positions.version, indexVersion = geometry.index.version, materialVersion = material.version;
  for (let i = 0; i < 12; i++) {
    burn.time = i; burn.ashMass = i * .1;
    updateAshBed(soil, burn, coals([{ x: .4, z: .2, radius: .16, heat: i / 12 }]), i * .25);
  }
  assert.equal(soil.geometry, geometry); assert.equal(soil.material, material);
  assert.deepEqual(positions.array, positionsBefore); assert.deepEqual(geometry.index.array, indexBefore);
  assert.deepEqual(soil.matrixWorld.elements, matrixBefore); assert.equal(parent.children.length, childCount);
  assert.equal(positions.version, positionVersion); assert.equal(geometry.index.version, indexVersion);
  assert.equal(material.version, materialVersion, 'heat and cover use uniforms, not shader recompiles');
  assert.ok(soil.userData.ashState.amount > .7);
});
