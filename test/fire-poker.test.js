import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirePoker, pickPokeTarget } from '../src/fire-poker.js';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';

function box(z = 0) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  object.position.z = z;
  return object;
}

function fixture(logMeshes, live = logMeshes.map(() => true)) {
  const opaque = new THREE.Group();
  for (const mesh of logMeshes) opaque.add(mesh);
  return { opaque, logMeshes, burnVisuals: { settling: { logs: live.map((value, slot) => ({ live: value, slot })) } } };
}

const forwardRay = () => new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));

test('poker targets the first visible live piece at the clicked surface', () => {
  const back = box(-2), front = box(1), study = fixture([back, front]);
  const hit = pickPokeTarget(study, forwardRay());
  assert.equal(hit.object, front);
  assert.equal(hit.slot, 1);
  assert.equal(hit.pose, study.burnVisuals.settling.logs[1]);
  assert.deepEqual(hit.point.toArray(), [0, 0, 1.5]);
});

test('a nearer fixed stone blocks a poke through it into wood', () => {
  const wood = box(), stone = box(2), study = fixture([wood]);
  study.opaque.add(stone);
  const hit = pickPokeTarget(study, forwardRay());
  assert.equal(hit.object, stone);
  assert.equal(hit.slot, null);
  assert.equal(hit.pose, undefined);
  stone.position.z = -2;
  assert.equal(pickPokeTarget(study, forwardRay()).pose, study.burnVisuals.settling.logs[0], 'a stone behind the wood does not block it');
});

test('bark nested inside a fuel mesh resolves to its owning fuel slot', () => {
  const root = box(-1), barkGroup = new THREE.Group(), bark = box(2);
  barkGroup.add(bark); root.add(barkGroup);
  const study = fixture([root]), hit = pickPokeTarget(study, forwardRay());
  assert.equal(hit.object, bark);
  assert.equal(hit.slot, 0);
  assert.equal(hit.pose, study.burnVisuals.settling.logs[0]);
});

test('hidden spent or queued wood and its child bark cannot intercept a poke', () => {
  const queued = box(3), spent = box(2), live = box();
  queued.add(box(.2)); spent.add(box(.2));
  queued.visible = spent.visible = false;
  const study = fixture([queued, spent, live], [false, false, true]);
  const hit = pickPokeTarget(study, forwardRay());
  assert.equal(hit.object, live);
  assert.equal(hit.slot, 2);
  assert.equal(hit.pose, study.burnVisuals.settling.logs[2]);
});

test('visible wood with no live physics body is not a valid poke target', () => {
  const spent = box(), study = fixture([spent], [false]);
  const hit = pickPokeTarget(study, forwardRay());
  assert.equal(hit.object, spent);
  assert.equal(hit.slot, null);
  assert.equal(hit.pose, undefined);
});

test('empty space and studies without settling return no poke target', () => {
  assert.equal(pickPokeTarget(null, forwardRay()), null);
  assert.equal(pickPokeTarget({}, forwardRay()), null);
  assert.equal(pickPokeTarget({ burnVisuals: {} }, forwardRay()), null);
  assert.equal(pickPokeTarget(fixture([]), forwardRay()), null);
});

function pokerFixture() {
  const cycle = { time: 0, logs: [{ id: 1, slot: 0, fuelType: 'log', wood: 1, char: 0,
    scale: 1, angle: 0, offset: 0, phase: 'fresh', addedAt: -1, temperature: 0 }] };
  const settling = createLogSettling([[[-1, .3, 0], [1, .3, 0], .2]], 42);
  updateLogSettling(settling, cycle, 0);
  const pose = settling.logs[0], poker = Object.create(FirePoker.prototype);
  const viewer = { current: { cycle, animationTime: 0, burnVisuals: { settling } }, paused: false, depthDirty: false };
  const announcements = [];
  Object.assign(poker, { viewer, equipped: true, inside: true, lastPoke: -Infinity, strokeTime: -Infinity,
    pokeCount: 0, panel: { dataset: {} }, raycaster: forwardRay(),
    aim: () => ({ pose, point: pose.position.clone().add(new THREE.Vector3(.5, .1, .2)) }),
    announce: message => announcements.push(message) });
  return { poker, viewer, pose, announcements };
}

test('a held poker repeats after 0.18 animation seconds and not when only the burn clock advances', () => {
  const { poker, viewer, pose } = pokerFixture();
  assert.equal(poker.poke(), true);
  const initialVelocity = pose.linearVelocity.clone(), initialSpin = pose.angularVelocity.clone();
  viewer.depthDirty = false;
  viewer.current.cycle.time = 3600;
  assert.equal(poker.poke(), false, 'accelerated combustion cannot immediately trigger another impulse');
  viewer.current.animationTime = .179;
  assert.equal(poker.poke(), false, 'mouse events within the repeat interval do not add force');
  assert.deepEqual(pose.linearVelocity.toArray(), initialVelocity.toArray());
  assert.deepEqual(pose.angularVelocity.toArray(), initialSpin.toArray());
  assert.equal(viewer.depthDirty, false);
  assert.equal(poker.pokeCount, 1);
  viewer.current.animationTime = .18;
  assert.equal(poker.poke(), true, 'the next stroke is accepted at the real-time interval');
  assert.equal(poker.poke(), false, 'two events in the same animation frame share one stroke');
  assert.equal(poker.pokeCount, 2);
  assert.equal(poker.panel.dataset.pokes, 2);
  assert.equal(poker.strokeTime, .18);
  assert.ok(pose.linearVelocity.distanceTo(initialVelocity) > .01, 'the repeat actually pushes the physics body');
});

test('continuous mouse events produce the same bounded poker cadence at normal and accelerated burn speeds', () => {
  const accepted = [];
  for (const burnSpeed of [1, 1200]) {
    const { poker, viewer } = pokerFixture(), strokes = [];
    for (let frame = 0; frame <= 240; frame++) {
      viewer.current.animationTime = frame / 120;
      viewer.current.cycle.time = viewer.current.animationTime * burnSpeed;
      if (poker.poke()) strokes.push(viewer.current.animationTime);
    }
    assert.ok(strokes.length >= 10 && strokes.length <= 12, `${burnSpeed}x burn has bounded repeated strokes`);
    for (let i = 1; i < strokes.length; i++) assert.ok(strokes[i] - strokes[i - 1] >= .18);
    accepted.push(strokes);
  }
  assert.deepEqual(accepted[0], accepted[1], 'burn speed does not increase applied force per real second');
});

test('paused, unequipped, and off-canvas pokes leave physics and tool state unchanged', () => {
  for (const guard of ['paused', 'unequipped', 'outside']) {
    const { poker, viewer, pose, announcements } = pokerFixture();
    assert.equal(poker.poke(), true);
    viewer.current.animationTime = 10;
    viewer.depthDirty = false;
    if (guard === 'paused') viewer.paused = true;
    if (guard === 'unequipped') poker.equipped = false;
    if (guard === 'outside') poker.inside = false;
    let aims = 0;
    poker.aim = () => { aims++; return { pose, point: pose.position.clone() }; };
    const snapshot = () => ({ velocity: pose.linearVelocity.toArray(), spin: pose.angularVelocity.toArray(),
      lastPoke: poker.lastPoke, strokeTime: poker.strokeTime, count: poker.pokeCount,
      displayedCount: poker.panel.dataset.pokes, depthDirty: viewer.depthDirty, announcements: [...announcements] });
    const before = snapshot();
    assert.equal(poker.poke(), false, guard);
    assert.equal(poker.poke(), false, `${guard}: repeated event`);
    assert.deepEqual(snapshot(), before, `${guard}: neither physical force nor UI feedback changes`);
    assert.equal(aims, 0, `${guard}: no unnecessary raycast`);
  }
});
