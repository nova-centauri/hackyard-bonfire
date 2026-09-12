import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { random } from './textures.js';
import { createBarkDetails } from './log-geometry.js';
import { createFuelMesh, sampleFuelSurface } from './fuel-geometry.js';
import { getFuelType, isBoard } from './fuel-types.js';
import { burningMaterial } from './log-burning-material.js';

const up = new THREE.Vector3(0, 1, 0);

function paperMaterial(fuelType) {
  const newspaper = fuelType === 'newspaper';
  return new THREE.MeshStandardMaterial({
    color: newspaper ? '#e4dcc8' : '#c49658',
    roughness: newspaper ? .9 : .94,
    metalness: 0,
    flatShading: true,
  });
}

// Build a complete piece once per arrival. Bark, chips and grain remain attached
// to it through settling, and a reused position can receive a different shape.
export function createSceneFuelMesh({ definition, fuelType = 'log', seed, mode, hybrid, rand = random(seed) }, { barkMat, endMat, exposedMat }) {
  const type = getFuelType(fuelType), a = new THREE.Vector3(...definition[0]), b = new THREE.Vector3(...definition[1]);
  const direction = b.clone().sub(a), length = direction.length() * type.lengthScale, radius = definition[2] * type.radiusScale;
  const burnUniforms = { uWood: { value: 1 }, uChar: { value: 0 }, uHeat: { value: 0 },
    uBurnMap: { value: null }, uBurnSlot: { value: 0 }, uBurnLength: { value: length }, uBurnTime: { value: 0 }, uLocalizedBurn: { value: 0 } };
  const paper = type.finish === 'paper';
  const sheet = paper ? paperMaterial(fuelType) : null;
  const exposedMaterial = hybrid ? burningMaterial(exposedMat, burnUniforms, true) : exposedMat;
  const sideMaterial = paper ? (hybrid ? burningMaterial(sheet, burnUniforms, true) : sheet)
    : isBoard(fuelType) ? exposedMaterial
    : hybrid ? burningMaterial(barkMat, burnUniforms) : barkMat;
  const endMaterial = paper ? sideMaterial : hybrid ? burningMaterial(endMat, burnUniforms, true) : endMat;
  if (hybrid && sheet) sheet.dispose();
  const log = createFuelMesh({ radius, length, fuelType, seed, faceted: mode === 1 }, sideMaterial, endMaterial);
  log.position.copy(a).lerp(b, .5); log.quaternion.setFromUnitVectors(up, direction.normalize());
  log.castShadow = true; log.receiveShadow = true;
  const profile = log.geometry.userData.profile;
  const addDetail = (geometry, material) => {
    const detail = new THREE.Mesh(geometry, material); detail.castShadow = true; detail.receiveShadow = true; log.add(detail); return detail;
  };
  if (!isBoard(fuelType)) {
    const details = createBarkDetails(profile);
    addDetail(details.exposed, exposedMaterial); addDetail(details.peeling, [sideMaterial, exposedMaterial]);
  }
  if (mode === 2 && !hybrid) {
    log.add(new THREE.LineSegments(new THREE.EdgesGeometry(log.geometry, 27), new THREE.LineBasicMaterial({ color: '#342e29', transparent: true, opacity: .85 })));
    for (let j = 0; j < 17; j++) {
      const points = Array.from({ length: 27 }, (_, k) => {
        const t = k / 26; return sampleFuelSurface(profile, j / 17 * Math.PI * 2 + Math.sin(t * 14 + j) * .007, t, .004);
      });
      log.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#342e25', transparent: true, opacity: .58 })));
    }
  }
  const chips = [], chipCount = paper ? 0 : fuelType === 'pallet' ? 8 : fuelType === 'kindling' ? 9 : mode === 1 ? 10 : 45;
  let charChips;
  if (chipCount) {
    for (let k = 0; k < chipCount; k++) {
      const theta = rand() * Math.PI * 2, t = .015 + rand() * .97;
      const chip = new THREE.DodecahedronGeometry(1, 0), obj = new THREE.Object3D();
      obj.position.copy(sampleFuelSurface(profile, theta, t));
      obj.scale.set(.022 + rand() * .025, .025 + rand() * .07, .012 + rand() * .014).multiplyScalar(Math.min(1, type.radiusScale * 1.4));
      obj.rotation.set(0, -theta, rand() * .4); obj.updateMatrix(); chip.applyMatrix4(obj.matrix); chips.push(chip);
    }
    const chipMaterial = new THREE.MeshStandardMaterial({ color: hybrid ? '#534d42' : mode === 2 ? '#746d5f' : mode === 4 ? '#a29b88' : '#39362f', roughness: 1, flatShading: true });
    charChips = addDetail(mergeGeometries(chips), hybrid ? burningMaterial(chipMaterial, burnUniforms) : chipMaterial);
    if (hybrid) chipMaterial.dispose();
    chips.forEach(geometry => geometry.dispose());
  } else {
    charChips = new THREE.Mesh(); charChips.visible = false; log.add(charChips);
  }
  log.updateMatrixWorld();
  Object.assign(log.userData, { length, radius, fuelType, burnUniforms, charChips, baseInverse: log.matrixWorld.clone().invert() });
  return log;
}

export function disposeFuelMesh(log) {
  const materials = new Set();
  log.traverse(part => {
    part.geometry?.dispose();
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) if (material) materials.add(material);
  });
  // Textures are shared with the rest of the scene, so only release materials.
  materials.forEach(material => material.dispose()); log.removeFromParent();
}
