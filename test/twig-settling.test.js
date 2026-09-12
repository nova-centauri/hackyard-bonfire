import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTwigSettling, updateTwigSettling } from '../src/twig-settling.js';

const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

function twigStudy() {
  const scene = new THREE.Scene(), twigs = new THREE.Group();
  const layers = { flames: new THREE.Group(), sparks: new THREE.Group() };
  scene.add(twigs, layers.flames, layers.sparks); twigs.position.y = -.16;
  const addBranch = (a, b, radius) => {
    const direction = b.clone().sub(a);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(radius * .55, radius, direction.length(), 7, 3), new THREE.MeshStandardMaterial());
    branch.position.copy(a).lerp(b, .5); branch.quaternion.setFromUnitVectors(vector(0, 1, 0), direction.normalize());
    twigs.add(branch); return branch;
  };
  const a = vector(.9, .42, .7), b = vector(.8, 1.1, .5);
  const main = addBranch(a, b, .03), fork = addBranch(a.clone().lerp(b, .58), b.clone().add(vector(.2, .12, -.18)), .015);
  // The last two pairs own the flame jackets, just as in the scene builder.
  addBranch(vector(-.9, .3, .2), vector(-.6, .8, .3), .025);
  addBranch(vector(-.726, .59, .258), vector(-.5, .85, .4), .013);
  const origin = a.clone().lerp(b, .6);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.01), new THREE.MeshBasicMaterial());
  glow.userData.twigGlowOrigin = origin.clone(); glow.position.copy(origin).add(twigs.position); glow.scale.y = 2.2;
  layers.sparks.add(glow);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.04).translate(...origin.toArray()), new THREE.MeshBasicMaterial());
  flame.userData.twigFlame = true; flame.position.copy(twigs.position); layers.flames.add(flame);
  scene.updateMatrixWorld(true);
  const state = createTwigSettling(twigs, layers), cycle = { seed: 42, resetSerial: 0, time: 0 };
  return { state, cycle, twigs, main, fork, glow, flame, origin };
}

function ends(mesh) {
  const half = mesh.geometry.parameters.height / 2;
  return [vector(0, -half, 0).applyMatrix4(mesh.matrixWorld), vector(0, half, 0).applyMatrix4(mesh.matrixWorld)];
}

test('burned twig pairs rotate and fall flat onto uneven dirt without leaving suspended tips', () => {
  const { state, cycle, twigs, main, fork } = twigStudy();
  const ground = (x, z) => .025 * Math.sin(x * 3) + .018 * Math.cos(z * 5);
  updateTwigSettling(state, cycle, 0, [], ground);
  const initialLength = ends(main)[0].distanceTo(ends(main)[1]);
  assert.ok(ends(main)[1].y > .9);
  cycle.time = 120; updateTwigSettling(state, cycle, 1, [], ground); updateTwigSettling(state, cycle, 2.5, [], ground);
  const [a, b] = ends(main), [forkA, forkB] = ends(fork);
  near(a.y, b.y); near(forkA.y, forkB.y);
  near(a.distanceTo(b), initialLength * (.12 + .88 * Math.sqrt(.8)));
  assert.ok(forkA.distanceTo(a.clone().lerp(b, .58)) < 1e-6, 'the fork remains attached while the twig falls');
  assert.deepEqual(twigs.scale.toArray(), [1, 1, 1], 'the group is never vertically squashed');
  for (const mesh of twigs.children) {
    const positions = mesh.geometry.attributes.position;
    let clearance = Infinity;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      const gap = p.y - ground(p.x, p.z); clearance = Math.min(clearance, gap);
      assert.ok(gap >= .003 - 1e-6, 'every vertex stays above the dirt');
      assert.ok(gap < .12, 'tips settle into the fire bed');
    }
    assert.ok(clearance < .014, 'each branch rests close to the dirt');
  }
});

test('a disappeared, weakened or moved log support releases its twig before the timed burn collapse', () => {
  for (const change of [pose => { pose.live = false; }, pose => { pose.radius *= .5; }, pose => { pose.a.x += 2; pose.b.x += 2; }]) {
    const { state, cycle, main } = twigStudy();
    const support = { id: 1, live: true, a: vector(.6, .43, .6), b: vector(1.2, .43, .6), radius: .22 };
    updateTwigSettling(state, cycle, 0, [support]);
    assert.equal(state.pieces[0].support.id, 1); assert.equal(state.pieces[0].fallAt, null);
    change(support); updateTwigSettling(state, cycle, 1, [support]); updateTwigSettling(state, cycle, 2.5, [support]);
    near(ends(main)[0].y, ends(main)[1].y); assert.ok(ends(main)[1].y < .04);
    assert.equal(cycle.time, 0, 'support loss alone triggers falling');
  }
});

test('glows and flame jackets stay attached to the same falling twig', () => {
  const { state, cycle, main, glow, flame, origin } = twigStudy();
  updateTwigSettling(state, cycle, 0);
  cycle.time = 120; updateTwigSettling(state, cycle, 1); updateTwigSettling(state, cycle, 1.4);
  const [a, b] = ends(main), expected = a.clone().lerp(b, .6);
  assert.ok(glow.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-6);
  assert.ok(origin.clone().applyMatrix4(flame.matrixWorld).distanceTo(expected) < 1e-6);
});

test('paused updates keep the twig pose fixed and resetting the same seed restores its complete shape', () => {
  const { state, cycle, twigs, glow, flame } = twigStudy();
  const objects = [...twigs.children, glow, flame];
  const snapshot = () => objects.map(object => object.matrixWorld.toArray());
  updateTwigSettling(state, cycle, 0); const original = snapshot();
  cycle.time = 420; updateTwigSettling(state, cycle, 1); updateTwigSettling(state, cycle, 2.5); const fallen = snapshot();
  assert.notDeepEqual(fallen, original);
  for (let i = 0; i < 5; i++) assert.equal(updateTwigSettling(state, cycle, 2.5), false);
  assert.deepEqual(snapshot(), fallen);
  cycle.time = 600; updateTwigSettling(state, cycle, 3); assert.equal(twigs.visible, false);
  cycle.time = 0; cycle.resetSerial++; updateTwigSettling(state, cycle, 0);
  assert.equal(twigs.visible, true);
  snapshot().forEach((values, i) => values.forEach((value, j) => near(value, original[i][j])));
  assert.ok(state.pieces.every(piece => piece.fallAt === 0));
});

test('unsupported twigs begin falling immediately even before any fuel has burned', () => {
  const { state, cycle, main } = twigStudy();
  updateTwigSettling(state, cycle, 0);
  const start = ends(main)[1].y;
  updateTwigSettling(state, cycle, .1);
  assert.ok(ends(main)[1].y < start, 'the next frame begins a visible fall');
  updateTwigSettling(state, cycle, 1);
  assert.ok(ends(main)[1].y < .04); assert.equal(cycle.time, 0);
});
