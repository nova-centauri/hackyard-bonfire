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

// Appearance and raised masonry checks live in hearth-set.test.js.
test('mouth colliders still match the legal opening after the dressing pass', () => {
  for (const scene of indoor()) {
    const { colliders } = build(scene.id);
    assert.equal(colliders.length, 5);
    for (const collider of colliders) {
      assert.ok(collider.id.startsWith(`${scene.id}-mouth-`));
    }
  }
});
