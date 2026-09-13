import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addStoneRing, createStoneCollider } from '../src/rocks.js';
import { applyLogPoke, createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { groundHeight } from '../src/ground.js';

const floor = () => -.2;
const log = (slot = 0) => ({ slot, id: slot + 1, wood: 1, char: 0, scale: 1, angle: 0, offset: 0,
  fuelType: 'log', phase: 'burning', addedAt: -1, temperature: .03 });
const definition = [[-.65, .2, 0], [.65, .2, 0], .13];
const simulate = (state, cycle, seconds, start = 0) => {
  for (let frame = 1; frame <= seconds * 60; frame++) updateLogSettling(state, cycle, start + frame / 60, floor);
};
const wall = (x = 0, width = 2.4) => createStoneCollider(new THREE.BoxGeometry(width, .85, .35).translate(x, .15, .9));

test('rendered rocks expose distinct fixed colliders at their generated world positions', () => {
  const parent = new THREE.Group(), stones = addStoneRing(parent, { seed: 42, hybrid: true });
  assert.equal(stones.userData.placements.length, 21);
  assert.equal(stones.userData.colliders.length, stones.userData.placements.length);
  for (const [i, collider] of stones.userData.colliders.entries()) {
    const placement = stones.userData.placements[i];
    assert.equal(collider.fixed, true);
    assert.ok(Math.hypot(collider.position.x - placement.x, collider.position.z - placement.z) < .12);
    assert.ok(collider.axes.length >= 6 && collider.worldPoints.length >= 12);
    assert.ok(collider.worldPoints.every(point => collider.bounds.containsPoint(point)));
  }
  stones.geometry.dispose(); stones.material.dispose();
});

test('the reduced stone ring is buried, closes around the pit and keeps seeded weathering stable', () => {
  const stones = addStoneRing(new THREE.Group(), { seed: 22, hybrid: true });
  const repeat = addStoneRing(new THREE.Group(), { seed: 22, hybrid: true });
  const { placements, colliders } = stones.userData;
  assert.deepEqual(placements, repeat.userData.placements);
  assert.deepEqual(stones.geometry.attributes.position.array, repeat.geometry.attributes.position.array);
  assert.deepEqual(stones.geometry.attributes.color.array, repeat.geometry.attributes.color.array);
  assert.ok(stones.geometry.index.count / 3 < 7000, 'the whole ring stays within its triangle budget');
  for (let i = 0; i < placements.length; i++) {
    const stone = colliders[i], next = colliders[(i + 1) % colliders.length];
    const placement = placements[i];
    assert.ok(stone.bounds.min.y < groundHeight(placement.x, placement.z) - .025, 'the collider follows the buried stone');
    if (i % 2 === 0) {
      const smallerNeighbor = placements[i === placements.length - 1 ? i - 1 : i + 1];
      assert.ok(placement.width > smallerNeighbor.width, 'alternating broad rocks replace the removed stones');
    }
    const tangent = next.position.clone().sub(stone.position).setY(0).normalize();
    const end = Math.max(...stone.worldPoints.map(point => point.dot(tangent)));
    const start = Math.min(...next.worldPoints.map(point => point.dot(tangent)));
    assert.ok(start < end, 'neighboring silhouettes close the ring');
  }
  const position = stones.geometry.attributes.position, normal = stones.geometry.attributes.normal, color = stones.geometry.attributes.color;
  let inside = 0, outside = 0, insideCount = 0, outsideCount = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (y < groundHeight(x, z) + .025) continue;
    const facing = (-normal.getX(i) * x - normal.getZ(i) * z) / Math.hypot(x, z);
    const luminance = color.getX(i) * .2126 + color.getY(i) * .7152 + color.getZ(i) * .0722;
    if (facing > .6) { inside += luminance; insideCount++; }
    if (facing < -.6) { outside += luminance; outsideCount++; }
  }
  assert.ok(inside / insideCount < outside / outsideCount * .7, 'visible inward faces carry the baked scorching');
  for (const ring of [stones, repeat]) { ring.geometry.dispose(); ring.material.dispose(); }
});

test('a fixed stone stops a rolling log and keeps its own shape and position unchanged', () => {
  const stone = wall(), cycle = { logs: [log()] }, state = createLogSettling([definition], 42, [], [stone]);
  const before = JSON.stringify(stone);
  updateLogSettling(state, cycle, 0, floor);
  state.logs[0].linearVelocity.z = 2;
  simulate(state, cycle, 2);
  const pose = state.logs[0];
  assert.ok(pose.z > .2, 'the log reaches the rock');
  assert.ok(pose.z < .62, 'the log cannot roll through the rock face');
  assert.ok(Math.abs(pose.linearVelocity.z) < .1, 'the contact dissipates forward velocity');
  assert.equal(JSON.stringify(stone), before, 'rocks receive neither impulses nor positional correction');
});

test('a log rolling outward into the generated weathered ring stays inside its stones', () => {
  const ring = addStoneRing(new THREE.Group(), { hybrid: true }), stone = ring.userData.colliders[0];
  const outward = stone.position.clone().setY(0).normalize(), tangent = new THREE.Vector3(-outward.z, 0, outward.x);
  const center = stone.position.clone().addScaledVector(outward, -.48).setY(.2);
  const def = [center.clone().addScaledVector(tangent, -.35).toArray(), center.clone().addScaledVector(tangent, .35).toArray(), .13];
  const run = stones => {
    const cycle = { logs: [log()] }, state = createLogSettling([def], 42, [], stones);
    updateLogSettling(state, cycle, 0, groundHeight);
    state.logs[0].linearVelocity.copy(outward).multiplyScalar(1.4);
    for (let frame = 1; frame <= 120; frame++) updateLogSettling(state, cycle, frame / 60, groundHeight);
    return state.logs[0].position.clone().sub(stone.position).dot(outward);
  };
  assert.ok(run(ring.userData.colliders) < -.35, 'the visible rocks block the outward roll');
  assert.ok(run([]) > -.2, 'the same trajectory would otherwise reach the stone interior');
  ring.geometry.dispose(); ring.material.dispose();
});

test('stone collision is finite: a log can pass beside a stone or fall onto its top', () => {
  const stone = wall(1.5, .4), cycle = { logs: [log()] }, state = createLogSettling([definition], 42, [], [stone]);
  updateLogSettling(state, cycle, 0, floor); state.logs[0].linearVelocity.z = 2;
  simulate(state, cycle, 2);
  const clear = createLogSettling([definition], 42);
  updateLogSettling(clear, cycle, 0, floor); clear.logs[0].linearVelocity.z = 2;
  simulate(clear, cycle, 2);
  assert.ok(state.logs[0].z > .9, 'the log travels alongside the stone');
  assert.deepEqual(state.logs[0].position, clear.logs[0].position, 'there is no invisible circular barrier between rocks');

  const landing = createLogSettling([definition], 42, [], [wall()]);
  updateLogSettling(landing, cycle, 0, floor);
  Object.assign(landing.logs[0], { z: .9, y: 1.1, sleeping: false, inFlight: true, fallFrom: 1.1 });
  simulate(landing, cycle, 1.5);
  assert.ok(landing.logs[0].y > .68, 'a log rests above the stone top');
  assert.ok(landing.logs[0].y < .73);
});

test('fast char fragments collide with rocks without tunneling through', () => {
  const cycle = { logs: [log()] }, state = createLogSettling([definition], 42, [], [wall()]);
  updateLogSettling(state, cycle, 0, floor);
  const fragment = state.logs[0];
  Object.assign(fragment, { id: 'char-test', fragment: true, radius: .035, length: .07,
    fragmentRadius: .035, fragmentLength: .07, initialChar: .03, remainingChar: .03, thermalAge: 0,
    heat: .4, y: .05, inFlight: true, initialized: true, sleeping: false });
  state.logs = []; state.fragments = [fragment]; cycle.logs = [];
  fragment.linearVelocity.z = 20;
  simulate(state, cycle, .5);
  assert.ok(fragment.z < .73, 'thin hot debris cannot cross a rock during one frame');
  assert.ok(fragment.position.toArray().every(Number.isFinite));
});

test('a poke wakes sleeping stacked wood and an off-center hit gives a bounded tipping impulse', () => {
  const defs = [definition, [[0, .5, -.65], [0, .5, .65], .13]];
  const cycle = { logs: [log(), log(1)] }, state = createLogSettling(defs, 42);
  updateLogSettling(state, cycle, 0, floor);
  assert.ok(state.logs.every(pose => pose.sleeping));
  const pose = state.logs[0], original = pose.position.clone();
  const hit = original.clone().add(new THREE.Vector3(.55, 0, 0));
  assert.equal(applyLogPoke(state, 0, hit, new THREE.Vector3(0, 0, 1)), true);
  assert.ok(state.logs.every(body => !body.sleeping), 'supported wood wakes with the poked piece');
  assert.ok(pose.linearVelocity.z > 0 && Math.abs(pose.angularVelocity.y) > .1);
  assert.ok(pose.angularVelocity.length() <= 3.2 + 1e-8);
  simulate(state, cycle, .25);
  assert.ok(pose.position.distanceTo(original) > .02);
  for (let i = 0; i < 30; i++) applyLogPoke(state, pose, hit, new THREE.Vector3(0, 0, 1), 100);
  assert.ok(pose.linearVelocity.length() <= 3 + 1e-8 && pose.angularVelocity.length() <= 8 + 1e-8);
  const velocity = pose.linearVelocity.clone();
  assert.equal(applyLogPoke(state, 12, hit, new THREE.Vector3(0, 0, 1)), false);
  assert.equal(applyLogPoke(state, pose, hit, new THREE.Vector3()), false);
  assert.equal(applyLogPoke(state, pose, hit, new THREE.Vector3(0, 0, 1), -1), false);
  assert.ok(pose.linearVelocity.equals(velocity), 'invalid interactions do not alter a body');
});
