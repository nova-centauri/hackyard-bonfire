import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addFireSet } from '../src/fire-sets.js';
import { getFireScene } from '../src/fire-scenes.js';

function dispose(set) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  set.group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
}

function pixel(texture, u, v) {
  const { data, width, height } = texture.image;
  const index = (Math.round(v * (height - 1)) * width + Math.round(u * (width - 1))) * 4;
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

test('home furnishings stay batched and the raised hearth keeps the combustion plane clear', () => {
  const scene = getFireScene('home'), set = addFireSet(new THREE.Group(), scene);
  try {
    const meshes = []; set.group.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.ok(meshes.length <= 9, 'static room remains at most nine colour-pass draws');
    assert.equal(set.group.getObjectByName('Dark plaster room').castShadow, false);
    assert.equal(set.group.getObjectByName('Room floor').castShadow, false);
    assert.ok(set.group.getObjectByName('Room floor').position.y < -.65);
    assert.ok(set.surface.position.y >= 0 && set.surface.position.y < .01);
    assert.equal(set.colliders.length, 5);

    // Every firebox brick lies outside the legal loading space, so actual
    // relief cannot silently reduce the collider's room for moving fuel.
    const positions = set.group.getObjectByName('Scorched firebox brick').geometry.attributes.position;
    const { width, depth } = scene.mouth;
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.abs(positions.getX(i)) >= width / 2 || positions.getZ(i) <= -depth / 2,
        'brick relief must stay behind the loading boundary');
    }
    assert.ok(positions.count > 240, 'the back and reveals contain individual brick courses');
    // Look out from inside the opening: real side bricks must be the first
    // visible surface, with their mortar backing recessed behind them.
    set.group.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, scene.mouth.height * .35, 0), new THREE.Vector3(side, 0, 0));
      const hits = ray.intersectObjects([
        set.group.getObjectByName('Scorched firebox brick'),
        set.group.getObjectByName('Recessed masonry mortar'),
      ]);
      assert.equal(hits[0]?.object.name, 'Scorched firebox brick', 'side brick faces must not be occluded by flat backing');
      const backing = hits.find(hit => hit.object.name === 'Recessed masonry mortar');
      assert.ok(backing && backing.distance - hits[0].distance > .08, 'mortar stays visibly recessed behind the reveal');
    }

    const plinth = set.group.getObjectByName('Raised hearth and lower landing').geometry.attributes.position;
    let hasLanding = false, hasFireboxBase = false;
    for (let i = 0; i < plinth.count; i++) {
      hasLanding ||= Math.abs(plinth.getY(i) + .31) < .001;
      hasFireboxBase ||= Math.abs(plinth.getY(i)) < .001;
    }
    assert.ok(hasLanding && hasFireboxBase, 'landing remains visibly below the firebox');
    // A horizontal ray through every height of the central base must meet
    // solid stone, catching gaps under the landing or above its cap.
    const base = set.group.getObjectByName('Raised hearth and lower landing');
    const floorY = set.group.getObjectByName('Room floor').position.y;
    base.geometry.computeBoundingBox();
    assert.ok(Math.abs(base.geometry.boundingBox.min.y - floorY) < .00001, 'landing seats on the room floor');
    for (let y = floorY + .006; y < 0; y += .012) {
      const ray = new THREE.Raycaster(new THREE.Vector3(10, y, 0), new THREE.Vector3(-1, 0, 0));
      assert.ok(ray.intersectObject(base).length, `raised hearth has a floating gap at y=${y}`);
    }

  } finally { dispose(set); }
});

test('room bakes carry dark corners and a continuous upper soot plume with authored texture handles', () => {
  const set = addFireSet(new THREE.Group(), getFireScene('home'));
  try {
    const { hearthWall, hearthFirebox } = set.textureRegistry;
    assert.equal(set.group.getObjectByName('Dark plaster room').material.isMeshBasicMaterial, true, 'baked wall lighting stays visible without extra room lights');
    assert.deepEqual(Object.keys(hearthWall), ['map'], 'the baked wall has no live lighting or bump slot');

    assert.ok(pixel(hearthWall.map, .03, .1) < pixel(hearthWall.map, .5, .65) * .65);
    assert.ok(pixel(hearthFirebox.map, .5, .12) < pixel(hearthFirebox.map, .5, .90) * .6);
    assert.ok(pixel(hearthFirebox.map, .5, .18) < pixel(hearthFirebox.map, .05, .18));
    const owned = new Set(Object.values(set.textureRegistry).map(handles => handles.map));
    assert.equal(owned.size, 4);
    for (const texture of owned) {
      assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
      assert.equal(texture.flipY, true, 'authored images use the same top-down image orientation');
      assert.equal(texture.generateMipmaps, true);
      assert.ok(texture.image.width <= 512 && texture.image.height <= 512);
    }
    set.group.traverse(object => {
      if (object.material?.map) assert.ok(owned.has(object.material.map), 'every room map is exposed to the authored loader');
    });
  } finally { dispose(set); }
});
