import * as THREE from 'three';

// Use the same lost shell profile as the collision solver. Applying it to the
// sealed geometry keeps cap seams, bark chips, shadows and depth in agreement.
export function applyLogFracture(mesh, fracture) {
  if (!fracture) return false;
  const key = `${fracture.t}:${fracture.angle}:${fracture.severity}`;
  if (mesh.userData.fractureKey === key) return false;
  mesh.userData.fractureKey = key;
  mesh.traverse(part => {
    const geometry = part.geometry, position = geometry?.attributes.position;
    if (!position) return;
    const original = geometry.userData.intactPositions ??= position.array.slice();
    for (let i = 0; i < position.count; i++) {
      const x = original[i * 3], y = original[i * 3 + 1], z = original[i * 3 + 2];
      const along = y / mesh.userData.length + .5, angle = Math.atan2(z, x);
      const notch = fracture.severity * Math.exp(-(((along - fracture.t) / .12) ** 2)) * Math.max(0, Math.cos(angle - fracture.angle)) ** 4;
      position.setXYZ(i, x * (1 - notch), y, z * (1 - notch));
    }
    position.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  });
  return true;
}

export function createCharFragments() {
  const geometry = new THREE.CylinderGeometry(.85, 1, 1, 9, 3);
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(12), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceHeat', heat);
  const material = new THREE.MeshStandardMaterial({ color: '#211813', roughness: 1 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float instanceHeat;varying float vFragmentHeat;varying vec3 vFragmentPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFragmentHeat=instanceHeat;vFragmentPosition=position;');
    shader.fragmentShader = 'varying float vFragmentHeat;varying vec3 vFragmentPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float angle=atan(vFragmentPosition.z,vFragmentPosition.x);
      float fissure=abs(sin(angle*6.+sin(vFragmentPosition.y*19.)*.4))*abs(sin(vFragmentPosition.y*15.+sin(angle*3.)*.8));
      float face=smoothstep(.04,.19,fissure);
      float heat=smoothstep(.2,.9,vFragmentHeat);
      totalEmissiveRadiance=mix(vec3(.65,.008,0.),vec3(2.7,.31,.008),heat)*heat*face;
    `);
  };
  material.customProgramCacheKey = () => 'fractured-char-1';
  const mesh = new THREE.InstancedMesh(geometry, material, 12);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}
