import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clearingFalloff, createClearingLight } from '../src/ground.js';
import { createAshBed } from '../src/ash-bed.js';

const compile = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
};

test('soil, gravel and leaves share diffuse firelight uniforms without program changes', () => {
  const light = createClearingLight();
  const materials = Array.from({ length: 3 }, () => clearingFalloff(new THREE.MeshStandardMaterial(), light));
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(), materials[0]);
  createAshBed(surface);
  const shaders = materials.map(compile), versions = materials.map(material => material.version);
  for (const shader of shaders) {
    assert.equal(shader.uniforms.uClearingPower, light.uClearingPower);
    assert.equal(shader.uniforms.uClearingOrigin, light.uClearingOrigin);
    assert.ok(shader.fragmentShader.includes('reflectedLight.indirectDiffuse += diffuseColor.rgb'), 'spill reflects the textured surface color');
    assert.ok(shader.fragmentShader.includes('dot(normal,'), 'bumped surface relief modulates the reflected light');
    assert.ok(shader.vertexShader.includes('instanceMatrix * clearingPosition'), 'small surface details use their own world positions');
  }
  assert.equal(shaders[0].uniforms.uAshHeat, surface.userData.ashState.uniforms.uAshHeat, 'ash and firelight coexist on the same draw');
  light.uClearingPower.value.set(0, 0);
  light.uClearingOrigin.value.set(.3, -.1);
  for (const shader of shaders) {
    assert.deepEqual(shader.uniforms.uClearingPower.value.toArray(), [0, 0]);
    assert.deepEqual(shader.uniforms.uClearingOrigin.value.toArray(), [.3, -.1]);
  }
  assert.deepEqual(materials.map(material => material.version), versions, 'cooling only changes shared uniforms');
  const unlit = clearingFalloff(new THREE.MeshStandardMaterial());
  assert.equal(compile(unlit).uniforms.uClearingPower, undefined);
  assert.notEqual(unlit.customProgramCacheKey(), materials[1].customProgramCacheKey(), 'plain and firelit clearing shaders cannot collide');
});
