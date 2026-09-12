import * as THREE from 'three';

// The settling module and its tests reason about one mesh per twig segment and
// one small mesh per glow. Rendering them that way cost about a hundred draw
// calls (and as many again in every shadow and depth pass). The logical meshes
// stay in the graph, hidden, and are mirrored into two instanced draws that
// follow them whenever the settling reports a change.
const scale = new THREE.Matrix4();

export function createTwigInstances(twigs, layers) {
  const branches = twigs.children.filter(child => child.isMesh && !child.isInstancedMesh);
  const glows = layers.sparks.children.filter(child => child.userData.twigGlowOrigin && !child.isInstancedMesh);
  const unit = new THREE.CylinderGeometry(.55, 1, 1, 7, 3);
  const mesh = new THREE.InstancedMesh(unit, branches[0]?.material || new THREE.MeshStandardMaterial(), Math.max(1, branches.length));
  mesh.count = branches.length; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'Twig segments';
  twigs.add(mesh);
  let glowMesh = null;
  if (glows.length) {
    glowMesh = new THREE.InstancedMesh(glows[0].geometry, glows[0].material, glows.length);
    glowMesh.frustumCulled = false; glowMesh.name = 'Twig glows'; layers.sparks.add(glowMesh);
  }
  for (const proxy of [...branches, ...glows]) proxy.visible = false;
  const state = { mesh, glowMesh, branches, glows,
    sync() {
      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i], { radiusBottom, height } = branch.geometry.parameters;
        branch.updateMatrix();
        mesh.setMatrixAt(i, scale.makeScale(radiusBottom, height, radiusBottom).premultiply(branch.matrix));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (glowMesh) {
        for (let i = 0; i < glows.length; i++) { glows[i].updateMatrix(); glowMesh.setMatrixAt(i, glows[i].matrix); }
        glowMesh.instanceMatrix.needsUpdate = true;
      }
    } };
  state.sync();
  return state;
}
