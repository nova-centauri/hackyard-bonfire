import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import { BonfireViewer } from '../src/scene.js';

test('discarding a study releases its instance matrix and color buffers', () => {
  const scene = new THREE.Scene();
  const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 10);
  instances.setColorAt(0, new THREE.Color('#ffffff'));
  scene.add(instances);

  // Exercise Three's actual instance-buffer ownership without a WebGL context.
  const buffers = new Set();
  const objects = WebGLObjects({ ARRAY_BUFFER: 34962 }, {
    get: (_object, geometry) => geometry,
    update() {},
  }, {
    update: attribute => buffers.add(attribute),
    remove: attribute => buffers.delete(attribute),
  }, { render: { frame: 1 } });
  objects.update(instances);
  assert.equal(buffers.size, 2, 'both per-instance attributes have been uploaded');

  const study = { scene, fuelMaterials: {}, textureRegistry: {}, proceduralTextures: new Set() };
  BonfireViewer.prototype.disposeStudy.call({ depthTarget: { depthTexture: null } }, study);
  assert.equal(buffers.size, 0, 'no instance buffers survive a discarded scene');
});
