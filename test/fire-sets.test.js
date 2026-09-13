import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FIRE_SCENES, getFireScene } from '../src/fire-scenes.js';
import { addFireSet } from '../src/fire-sets.js';

const indoor = () => FIRE_SCENES.filter(scene => scene.mouth);

function build(id) {
  const root = new THREE.Group(), scene = getFireScene(id);
  return { scene, ...addFireSet(root, scene) };
}

function named(group, name) {
  const found = [];
  group.traverse(object => { if (object.name === name) found.push(object); });
  return found;
}

function sizeOf(object) {
  const box = new THREE.Box3().setFromObject(object);
  return box.getSize(new THREE.Vector3());
}

test('the wood stove firebox is furniture-sized, not a walk-in iron room', () => {
  const stove = getFireScene('stove'), home = getFireScene('home');
  assert.ok(stove.mouth.width < 1, 'firebox is under a metre wide');
  assert.ok(stove.mouth.height < 1, 'firebox is under a metre tall');
  assert.ok(stove.mouth.depth < .85);
  assert.ok(stove.mouth.width < home.mouth.width * .4, 'stove opening is much smaller than the cottage fireplace');
  assert.ok(stove.maxLength < 0.7);
  assert.ok(stove.flameScale < home.flameScale);
});

for (const scene of indoor()) {
  test(`${scene.id}: the set is a furnished room, not a floating mouth`, () => {
    const { group } = build(scene.id);
    for (const name of ['hearth-room', 'hearth-floor', 'hearth-rug', 'hearth-mantel', 'hearth-woodpile', 'hearth-masonry']) {
      assert.equal(named(group, name).length, 1, `${scene.id} is missing ${name}`);
    }
    const rug = sizeOf(named(group, 'hearth-rug')[0]);
    assert.ok(rug.x > 3 && rug.z > 2, 'the rug has to read from the default camera');
    const wood = named(group, 'hearth-woodpile')[0];
    let pieces = 0;
    wood.traverse(object => { if (object.isInstancedMesh) pieces += object.count; });
    assert.ok(pieces >= 20, 'cordwood is a real stack, not a couple of props');
  });
}

test('home and grand hearths keep a tool stand; the stove does not clutter its alcove with one', () => {
  assert.equal(named(build('home').group, 'hearth-tools').length, 1);
  assert.equal(named(build('grand').group, 'hearth-tools').length, 1);
  assert.equal(named(build('stove').group, 'hearth-tools').length, 0);
});

test('the stove sits as a compact body inside a wider cream alcove', () => {
  const { group } = build('stove');
  const body = named(group, 'stove-body')[0], alcove = named(group, 'stove-alcove')[0];
  assert.ok(body && alcove);
  const bodySize = sizeOf(body), alcoveSize = sizeOf(alcove);
  assert.ok(bodySize.x < 1.2 && bodySize.y < 1.2 && bodySize.z < 1.1, 'iron body stays furniture-scale');
  assert.ok(alcoveSize.x > bodySize.x * 1.8, 'the alcove is a room feature around the stove');
  assert.equal(named(group, 'stove-pipe').length, 1);
});

test('mouth colliders still match the legal opening after the dressing pass', () => {
  for (const scene of indoor()) {
    const { colliders } = build(scene.id);
    assert.equal(colliders.length, 5);
    for (const collider of colliders) {
      assert.ok(collider.id.startsWith(`${scene.id}-mouth-`));
    }
  }
});
