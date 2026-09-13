import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BurnCycle } from '../src/lifecycle.js';
import { FUEL_KIND_IDS, getFuelType } from '../src/fuel-types.js';
import { FIRE_SCENES, getFireScene, createSceneCycle, sceneLogDefinitions } from '../src/fire-scenes.js';
import { mouthColliders } from '../src/fire-sets.js';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { createSceneFuelMesh, disposeFuelMesh } from '../src/fuel-mesh.js';
import { createHybridFire } from '../src/hybrid-fire.js';

function legalFuel(cycle, scene) {
  assert.equal(cycle.logs.length, scene.maxPieces);
  assert.ok(cycle.logs.filter(log => log.phase !== 'ash' && log.phase !== 'queued').length <= scene.maxPieces);
  const definitions = sceneLogDefinitions(scene.id);
  for (const log of cycle.logs) {
    assert.ok(scene.fuelTypes.includes(log.fuelType), `${scene.id}: illegal ${log.fuelType}`);
    if (!scene.mouth) continue;
    const type = getFuelType(log.fuelType), [a, b, radius] = definitions[log.slot];
    const length = Math.hypot(...a.map((n, i) => n - b[i])) * type.lengthScale * log.scale;
    assert.ok(length <= scene.maxLength + 1e-8, `${scene.id}: cut too long`);
    assert.ok(radius * type.radiusScale * log.scale <= scene.maxRadius + 1e-8, `${scene.id}: cut too thick`);
  }
}

test('outdoor pit preserves the existing seeded burn and feed behavior exactly', () => {
  for (const seed of [22, 8108, 9784]) {
    const before = new BurnCycle(seed), after = createSceneCycle('pit', seed);
    assert.equal(JSON.stringify(after), JSON.stringify(before));
    for (const fuel of FUEL_KIND_IDS) {
      assert.equal(after.addLog(fuel), before.addLog(fuel));
      before.advance(400); after.advance(400);
      assert.equal(JSON.stringify(after), JSON.stringify(before));
    }
  }
});

for (const scene of FIRE_SCENES.filter(scene => scene.mouth)) {
  test(`${scene.id}: starts, manual additions, queued exchanges and random additions obey the mouth budget`, () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const kind of FUEL_KIND_IDS) {
        const cycle = createSceneCycle(scene.id, seed); legalFuel(cycle, scene);
        const snapshot = JSON.stringify(cycle);
        assert.equal(cycle.addLog(kind), scene.fuelTypes.includes(kind));
        if (!scene.fuelTypes.includes(kind)) assert.equal(JSON.stringify(cycle), snapshot, 'rejected fuel must not consume a slot or randomness');
        legalFuel(cycle, scene);
        while (cycle.canAdd) assert.equal(cycle.addRandomFuel(), true);
        assert.equal(cycle.addRandomFuel(), false, 'full hearth refuses another piece');
        legalFuel(cycle, scene);
      }
    }
  });

  test(`${scene.id}: reset replaces fuel, surface heat, ash, coals and queue`, () => {
    const cycle = createSceneCycle(scene.id, 99), originalLogs = cycle.logs;
    cycle.addRandomFuel(); cycle.advance(1200);
    cycle.fragmentChar = 9; cycle.fragmentHeat = 8; cycle.ashDeposits.fill(7);
    cycle.logPoses = [{ id: 987, position: new THREE.Vector3(4, 5, 6) }];
    cycle.coalMass = 999; cycle.ashMass = 999;
    cycle.reset(456);
    const fresh = createSceneCycle(scene.id, 456);
    const state = value => JSON.parse(JSON.stringify(value, (key, entry) => key === 'resetSerial' ? undefined : entry));
    assert.deepEqual(state(cycle), state(fresh));
    assert.ok(cycle.logs.every(log => !originalLogs.includes(log)));
    assert.equal(cycle.time, 0); assert.equal(cycle.logPoses.length, 0);
    legalFuel(cycle, scene);
  });

  test(`${scene.id}: automatic tending and real settling keep a contained fire for 75 burn minutes`, () => {
    const cycle = createSceneCycle(scene.id, 8108), definitions = sceneLogDefinitions(scene.id);
    const materials = { barkMat: new THREE.MeshStandardMaterial(), endMat: new THREE.MeshStandardMaterial(), exposedMat: new THREE.MeshStandardMaterial() };
    const meshes = [], keys = [];
    const settling = createLogSettling(definitions, cycle.seed, [], mouthColliders(scene)); settling.arrivalLift = .28;
    let maxY = 0, fed = false, cold = false;
    for (let frame = 0; frame <= 225; frame++) {
      if (frame) cycle.advance(20); // 1200x at 60 fps, as in the viewer.
      for (const log of cycle.logs) {
        const key = `${log.id}:${log.fuelType}`;
        if (keys[log.slot] === key) continue;
        if (meshes[log.slot]) disposeFuelMesh(meshes[log.slot]);
        meshes[log.slot] = createSceneFuelMesh({ definition: definitions[log.slot], fuelType: log.fuelType, seed: cycle.seed + log.id * 7919, mode: 2, hybrid: true }, materials);
        keys[log.slot] = key;
      }
      settling.profiles = meshes.map(mesh => mesh.geometry.userData.profile);
      updateLogSettling(settling, cycle, frame / 60, () => 0);
      cycle.setLogPoses(settling.logs); legalFuel(cycle, scene);
      fed ||= cycle.serial > 7; cold ||= cycle.phase === 'Cold fire bed';
      for (const pose of settling.logs.filter(pose => pose.live)) {
        maxY = Math.max(maxY, pose.y);
        assert.ok(pose.position.toArray().every(Number.isFinite));
        for (const point of pose.worldPoints) {
          assert.ok(Math.abs(point.x) <= scene.mouth.width / 2 + .04, 'wood stays inside the sides');
          assert.ok(Math.abs(point.z) <= scene.mouth.depth / 2 + .04, 'wood stays inside the front and back');
          assert.ok(point.y <= scene.mouth.height + .04, 'wood stays below the lintel');
        }
      }
    }
    assert.ok(fed, 'the fire received replacement fuel');
    assert.equal(cold, false, 'the unchanged tending model keeps this placement burning');
    assert.ok(maxY < scene.mouth.height);
    meshes.forEach(disposeFuelMesh); Object.values(materials).forEach(mat => mat.dispose());
  });

  test(`${scene.id}: unused shader slots cannot create phantom logs or flames`, () => {
    const fire = createHybridFire({ seed: 22, fireVariant: 2, mouth: scene.mouth, flameScale: scene.flameScale }, null, sceneLogDefinitions(scene.id));
    const u = fire.material.uniforms;
    assert.equal(u.uLogA.value.length, 7); assert.equal(u.uLogB.value.length, 7);
    for (let i = scene.maxPieces; i < 7; i++) assert.equal(u.uLogHeat.value[i], 0);
    for (let i = 0; i < 12; i++) if (i % 7 >= scene.maxPieces) assert.equal(u.uFuel.value[i], 0);
    fire.onBeforeRender();
    assert.ok(u.uLo.value.x >= -scene.mouth.width / 2);
    assert.ok(u.uHi.value.y <= scene.mouth.height);
    assert.ok(u.uHi.value.z <= scene.mouth.depth / 2);
    fire.geometry.dispose(); fire.material.dispose();
  });
}

test('only outdoor pit and home fireplace are available, with outdoor pit as the default', () => {
  assert.deepEqual(FIRE_SCENES.map(scene => scene.id), ['pit', 'home']);
  assert.equal(getFireScene().id, 'pit');
  assert.equal(JSON.stringify(createSceneCycle()), JSON.stringify(new BurnCycle(8108)));
});

test('removed and unknown scene identifiers fall back to the original pit', () => {
  for (const id of ['grand', 'stove', 'missing']) {
    assert.equal(getFireScene(id).id, 'pit');
    assert.equal(JSON.stringify(createSceneCycle(id, 22)), JSON.stringify(new BurnCycle(22)));
    assert.deepEqual(sceneLogDefinitions(id), sceneLogDefinitions('pit'));
  }
});
