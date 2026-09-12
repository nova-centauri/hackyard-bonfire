import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectMaterials, configureAuthoredTexture, loadAuthoredTextures, swapTexture } from '../src/texture-loader.js';
import { TEXTURE_MANIFEST } from '../src/texture-manifest.js';

test('the default manifest is empty so nothing is fetched', () => {
  assert.deepEqual(TEXTURE_MANIFEST, {});
  assert.ok(Object.isFrozen(TEXTURE_MANIFEST));
});

test('authored textures replace the procedural handle in every material that used it', async () => {
  const bark = new THREE.Texture(), emission = new THREE.Texture(), soil = new THREE.Texture();
  const a = new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, emissiveMap: emission });
  const b = a.clone(), c = new THREE.MeshStandardMaterial({ map: soil, bumpMap: soil });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), [a, b]), new THREE.Mesh(new THREE.BoxGeometry(), c));
  const materials = collectMaterials([scene]);
  assert.equal(materials.length, 3);
  const loaded = {};
  const loader = { load(url, onLoad, _progress, onError) { url.includes('missing') ? onError(new Error('404')) : onLoad(loaded[url] = new THREE.Texture()); } };
  const registry = { bark: { map: bark, bump: bark, emissive: emission }, soil: { map: soil, bump: soil } };
  const report = await loadAuthoredTextures({
    bark: { map: 'textures/bark.png', normal: 'textures/bark-normal.png', emissive: 'textures/missing.png' },
    soil: { map: '/textures/soil.png' }, stones: { map: 'textures/ignored.png' },
  }, registry, () => materials, { base: '/', loader });
  assert.deepEqual(report, { bark: { map: 'applied', normal: 'applied', emissive: 'failed' }, soil: { map: 'applied' } });
  const barkMap = loaded['/textures/bark.png'], barkNormal = loaded['/textures/bark-normal.png'];
  for (const material of [a, b]) {
    assert.strictEqual(material.map, barkMap);
    assert.strictEqual(material.normalMap, barkNormal); assert.equal(material.bumpMap, null, 'a normal map supersedes the bump map');
    assert.strictEqual(material.emissiveMap, emission, 'a failed file keeps its procedural texture');
  }
  // The soil's procedural texture was also its bump map; with only an albedo
  // authored, the bump follows it rather than mixing two different patterns.
  assert.strictEqual(c.map, loaded['/textures/soil.png']); assert.strictEqual(c.bumpMap, loaded['/textures/soil.png']);
  assert.equal(barkMap.colorSpace, THREE.SRGBColorSpace); assert.equal(barkNormal.colorSpace, THREE.NoColorSpace);
  assert.equal(barkMap.wrapS, bark.wrapS, 'an authored texture inherits the wrap mode of the procedural one it replaces');
  assert.equal(swapTexture(materials, new THREE.Texture(), new THREE.Texture()), 0);
  const configured = configureAuthoredTexture(new THREE.Texture(), 'map', { wrapT: THREE.ClampToEdgeWrapping, anisotropy: 2 });
  assert.equal(configured.wrapT, THREE.ClampToEdgeWrapping); assert.equal(configured.anisotropy, 8);
});
