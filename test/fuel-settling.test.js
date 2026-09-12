import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { createSceneFuelMesh, disposeFuelMesh } from '../src/fuel-mesh.js';
import { groundHeight } from '../src/ground.js';

const sceneDefinition = [[-1.45, .27, .8], [1.3, .43, -.6], .25];
const flatGround = () => 0;
const materials = { barkMat: new THREE.MeshStandardMaterial(), endMat: new THREE.MeshStandardMaterial(), exposedMat: new THREE.MeshStandardMaterial() };
const fuel = (fuelType, slot = 0) => ({ id: slot + 1, slot, fuelType, wood: 1, char: 0, scale: 1, angle: 0, offset: 0, phase: 'fresh', addedAt: -1, temperature: 0 });
const buildMesh = (definition, fuelType, seed = 16027) => createSceneFuelMesh({ definition, fuelType, seed, mode: 0, hybrid: true }, materials);

function settle(state, logs, ground = flatGround, frames = 180, startTime = 0) {
  for (let frame = 0; frame <= frames; frame++) updateLogSettling(state, { logs }, startTime + frame / 60, ground);
}

function applyPose(mesh, pose) {
  mesh.position.copy(pose.a).lerp(pose.b, .5);
  mesh.quaternion.copy(pose.quaternion);
  mesh.scale.set(pose.radius / mesh.userData.radius, pose.length / mesh.userData.length, pose.radius / mesh.userData.radius);
  mesh.updateMatrixWorld();
}

function minimumClearance(mesh, ground = flatGround) {
  const positions = mesh.geometry.attributes.position, point = new THREE.Vector3();
  let minimum = Infinity;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    minimum = Math.min(minimum, point.y - ground(point.x, point.z));
  }
  return minimum;
}

test('flared stump roots settle on the actual ground surface instead of sinking through it', () => {
  for (const seed of [1, 42, 16027]) for (const ground of [flatGround, groundHeight]) {
    const log = fuel('stump'), mesh = buildMesh(sceneDefinition, log.fuelType, seed);
    const state = createLogSettling([sceneDefinition], 8108, [mesh.geometry.userData.profile]);
    settle(state, [log], ground);
    applyPose(mesh, state.logs[0]);
    const clearance = minimumClearance(mesh, ground);
    assert.ok(clearance > .005 && clearance < .02, `stump seed ${seed} must touch the soil without buried roots: ${clearance}`);
    assert.ok(state.logs[0].collisionRadius > state.logs[0].radius * 1.2, 'root flare expands collision bounds without enlarging the rendered mesh again');
    // Shrinking/compression must continue to use the same physical surface.
    log.wood = .4; log.char = .1; log.scale = .88;
    settle(state, [log], ground, 180, 3);
    applyPose(mesh, state.logs[0]);
    const burnedClearance = minimumClearance(mesh, ground);
    assert.ok(burnedClearance > .005 && burnedClearance < .02, `burned stump remains seated: ${burnedClearance}`);
    disposeFuelMesh(mesh);
  }
});

test('side-by-side 2×4s with a visible gap do not create a phantom support', () => {
  const definitions = [[[-1, .2, 0], [1, .2, 0], .25], [[-1, .6, .15], [1, .6, .15], .25]];
  const logs = definitions.map((_, slot) => fuel('plank', slot));
  const meshes = definitions.map(definition => buildMesh(definition, 'plank'));
  const profiles = meshes.map(mesh => mesh.geometry.userData.profile);
  assert.ok(profiles[0].halfDepth + profiles[1].halfDepth < .15, 'the rectangular board footprints have a real gap');
  const state = createLogSettling(definitions, 1, profiles);
  settle(state, logs);
  state.logs.forEach((pose, index) => {
    assert.deepEqual(pose.supports, [], 'neither separated board rests on the other');
    applyPose(meshes[index], pose);
    assert.ok(Math.abs(minimumClearance(meshes[index]) - .012) < 1e-6, 'both boards rest directly on the ground');
    disposeFuelMesh(meshes[index]);
  });
});

test('plank ground contact follows its rectangular section as the board turns', () => {
  const definition = [[-1, .2, 0], [1, .2, 0], .25];
  for (const angle of [0, .35, .8, Math.PI / 2]) {
    const log = { ...fuel('plank'), angle }, mesh = buildMesh(definition, 'plank');
    const state = createLogSettling([definition], 1, [mesh.geometry.userData.profile]);
    settle(state, [log]); applyPose(mesh, state.logs[0]);
    const clearance = minimumClearance(mesh);
    assert.ok(clearance > .009 && clearance < .014, `the board's actual lowest corner settles within the contact skin at angle ${angle}: ${clearance}`);
    disposeFuelMesh(mesh);
  }
});

test('all categories use the rendered dimensions once, including after shrinkage', () => {
  for (const fuelType of ['log', 'small-log', 'kindling', 'plank', 'stump', 'pallet', 'cardboard', 'newspaper']) {
    const log = { ...fuel(fuelType), scale: .9 }, mesh = buildMesh(sceneDefinition, fuelType);
    const state = createLogSettling([sceneDefinition], 1, [mesh.geometry.userData.profile]);
    settle(state, [log]);
    const pose = state.logs[0];
    assert.ok(Math.abs(pose.length - mesh.userData.length * .9) < 1e-8, `${fuelType}: length uses the category scale once`);
    assert.ok(Math.abs(pose.radius - mesh.userData.radius * .9) < 1e-8, `${fuelType}: radius uses the category scale once`);
    assert.ok(Math.abs(pose.a.distanceTo(pose.b) - pose.length) < 1e-8);
    log.wood = .3; log.char = .1;
    settle(state, [log], flatGround, 120, 3);
    assert.ok(pose.length < mesh.userData.length * .9);
    assert.ok(pose.radius < mesh.userData.radius * .9);
    assert.ok(pose.a.toArray().concat(pose.b.toArray()).every(Number.isFinite), `${fuelType}: burned contact remains finite`);
    disposeFuelMesh(mesh);
  }
});

test('replacing a slot with another category rebuilds its pose even when its id is unchanged', () => {
  const definition = [[-1, .2, 0], [1, .2, 0], .25], log = fuel('plank');
  let mesh = buildMesh(definition, 'plank');
  const state = createLogSettling([definition], 42, [mesh.geometry.userData.profile]);
  settle(state, [log]);
  for (const [index, fuelType] of ['stump', 'kindling'].entries()) {
    const oldPose = state.logs[0];
    disposeFuelMesh(mesh); mesh = buildMesh(definition, fuelType);
    Object.assign(log, { fuelType, addedAt: 10 + index });
    state.profiles[0] = mesh.geometry.userData.profile;
    settle(state, [log], flatGround, 180, 3 + index * 3);
    const newPose = state.logs[0];
    assert.notEqual(newPose, oldPose);
    assert.equal(newPose.id, oldPose.id);
    assert.equal(newPose.fuelType, fuelType);
    assert.ok(Math.abs(newPose.baseLength - mesh.userData.length) < 1e-8);
    assert.ok(Math.abs(newPose.baseRadius - mesh.userData.radius) < 1e-8);
    assert.equal(newPose.profile, mesh.geometry.userData.profile, 'collision samples use the replacement mesh profile');
    assert.equal(Boolean(newPose.profile.rootFlare), fuelType === 'stump', 'root flare must not carry over to kindling');
    assert.notEqual(newPose.localPoints, oldPose.localPoints, 'collision vertices are rebuilt for the new shape');
  }
  disposeFuelMesh(mesh);
});

test('pallet, cardboard and newspaper rest on their thin faces without tunneling into the ground', () => {
  for (const fuelType of ['pallet', 'cardboard', 'newspaper']) {
    const log = fuel(fuelType), mesh = buildMesh(sceneDefinition, fuelType);
    const state = createLogSettling([sceneDefinition], 1, [mesh.geometry.userData.profile]);
    settle(state, [log]);
    applyPose(mesh, state.logs[0]);
    const clearance = minimumClearance(mesh);
    assert.ok(clearance > .005 && clearance < .025, `${fuelType} must sit on the soil: ${clearance}`);
    assert.equal(state.logs[0].fuelType, fuelType);
    disposeFuelMesh(mesh);
  }
});

test('a new arrival is dropped onto the settled pile, never onto a piece that is still falling', () => {
  const definitions = [[[-1, .3, 0], [1, .3, 0], .25], [[0, .3, -1], [0, .3, 1], .25], [[-1, .3, .3], [1, .3, -.3], .25]];
  // Two identical piles; in one the second piece is still in the air when the
  // third arrives a few frames later, as happens at 1200× when wood is added
  // every few real tenths of a second. The third piece must start its drop
  // from the same height in both.
  const build = () => {
    const logs = definitions.map((_, slot) => ({ ...fuel('log', slot), phase: slot === 0 ? 'fresh' : 'queued', addedAt: slot === 0 ? -1 : null }));
    const state = createLogSettling(definitions, 5);
    settle(state, logs, flatGround, 120);
    return { logs, state };
  };
  const stacked = build(), control = build();
  Object.assign(stacked.logs[1], { phase: 'fresh', addedAt: 10 });
  for (let frame = 0; frame < 3; frame++) {
    updateLogSettling(stacked.state, { logs: stacked.logs }, 3 + frame / 60, flatGround);
    updateLogSettling(control.state, { logs: control.logs }, 3 + frame / 60, flatGround);
  }
  assert.ok(stacked.state.logs[1].inFlight && stacked.state.logs[1].y > stacked.state.logs[0].y + .5, 'the second piece is still falling');
  for (const sample of [stacked, control]) {
    Object.assign(sample.logs[2], { phase: 'fresh', addedAt: 11 });
    updateLogSettling(sample.state, { logs: sample.logs }, 3 + 3 / 60, flatGround);
  }
  assert.ok(Math.abs(stacked.state.logs[2].fallFrom - control.state.logs[2].fallFrom) < 1e-9, `the falling piece is not a support (${stacked.state.logs[2].fallFrom.toFixed(3)} vs ${control.state.logs[2].fallFrom.toFixed(3)})`);
  settle(stacked.state, stacked.logs, flatGround, 240, 4);
  for (const pose of stacked.state.logs) assert.ok(pose.y < 1.5 && !pose.inFlight, `every piece comes to rest on the pile (${pose.y.toFixed(2)}, flight ${pose.inFlight})`);
});
