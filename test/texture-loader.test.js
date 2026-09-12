import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectMaterials, configureAuthoredTexture, loadAuthoredTextures, swapTexture } from '../src/texture-loader.js';
import { TEXTURE_MANIFEST } from '../src/texture-manifest.js';

function pngSize(path) {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('the authored manifest lists shipped texture files', () => {
  assert.ok(Object.isFrozen(TEXTURE_MANIFEST));
  const expected = {
    bark: { map: 2048, normal: 2048, emissive: 1024 },
    endGrain: { map: 1024, normal: 1024, emissive: 512 },
    exposedWood: { map: 1024, normal: 1024 },
    soil: { map: 2048, normal: 2048 },
    smokePuff: { map: 512 },
  };
  assert.deepEqual(Object.keys(TEXTURE_MANIFEST).sort(), Object.keys(expected).sort());
  for (const [slot, roles] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(TEXTURE_MANIFEST[slot]).sort(), Object.keys(roles).sort());
    for (const [role, size] of Object.entries(roles)) {
      const url = TEXTURE_MANIFEST[slot][role];
      const path = join('public', url);
      assert.ok(existsSync(path), `${path} is missing`);
      assert.ok(statSync(path).size > 1024, `${path} is too small`);
      if (url.endsWith('.png')) {
        const { width, height } = pngSize(path);
        assert.equal(width, size, `${path} width`);
        assert.equal(height, size, `${path} height`);
      }
    }
  }
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

test('a normal map still applies when the albedo decodes first', async () => {
  const bark = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark });
  const pending = [];
  const loaded = {};
  const loader = { load(url, onLoad) { pending.push(() => onLoad(loaded[url] = new THREE.Texture())); } };
  const promise = loadAuthoredTextures(
    { bark: { map: 'textures/bark.png', normal: 'textures/bark-normal.png' } },
    { bark: { map: bark, bump: bark } },
    () => [material],
    { base: '/', loader },
  );
  assert.equal(pending.length, 2);
  pending[0]();
  pending[1]();
  const report = await promise;
  assert.deepEqual(report, { bark: { map: 'applied', normal: 'applied' } });
  assert.strictEqual(material.map, loaded['/textures/bark.png']);
  assert.strictEqual(material.normalMap, loaded['/textures/bark-normal.png']);
  assert.equal(material.bumpMap, null);
});

test('authored maps replace a shader uniform that held the procedural texture', async () => {
  const puff = new THREE.Texture();
  const material = new THREE.ShaderMaterial({ uniforms: { uMap: { value: puff } } });
  const loader = { load(_url, onLoad) { onLoad(new THREE.Texture()); } };
  const report = await loadAuthoredTextures(
    { smokePuff: { map: 'textures/smoke-puff.png' } },
    { smokePuff: { map: puff } },
    () => [material],
    { base: '/', loader },
  );
  assert.deepEqual(report, { smokePuff: { map: 'applied' } });
  assert.notEqual(material.uniforms.uMap.value, puff);
});
