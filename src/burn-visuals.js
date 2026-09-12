import * as THREE from 'three';
import { random } from './textures.js';
import { createLogSettling, updateLogSettling } from './log-settling.js';
import { getFuelType } from './fuel-types.js';
import { sampleLogSurface as sampleBurnSurface } from './log-combustion.js';
import { applyLogFracture, createCharFragments } from './log-damage.js';
import { updateCoalBed } from './coal-bed.js';
import { updateAshBed } from './ash-bed.js';

const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), center = new THREE.Vector3();
const endA = new THREE.Vector3(), endB = new THREE.Vector3(), root = new THREE.Vector3();
const obj = new THREE.Object3D(), color = new THREE.Color();
const clamp = THREE.MathUtils.clamp;

export { burningMaterial } from './log-burning-material.js';

export function createBurnVisuals(study) {
  const rand = random(4408), particles = [];
  const burnMap = new THREE.DataTexture(new Float32Array(8 * 35 * 4), 8, 35, THREE.RGBAFormat, THREE.FloatType);
  burnMap.minFilter = burnMap.magFilter = THREE.LinearFilter; burnMap.wrapS = THREE.RepeatWrapping;
  burnMap.generateMipmaps = false;
  const flakes = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#555048', emissive: '#ff4008', emissiveIntensity: .9, roughness: 1, flatShading: true }), 80);
  flakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); flakes.frustumCulled = false;
  for (let i = 0; i < 80; i++) { obj.scale.setScalar(0); obj.updateMatrix(); flakes.setMatrixAt(i, obj.matrix); flakes.setColorAt(i, new THREE.Color('#777269')); }
  study.opaque.add(flakes);
  const fragments = createCharFragments(); study.opaque.add(fragments);
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(320 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  emberGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(320 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  emberGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(320), 1).setUsage(THREE.DynamicDrawUsage));
  const emberMaterial = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute float aSize;varying vec3 vColor;
      void main(){vColor=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*680./max(.2,-p.z),0.,18.);}`,
    fragmentShader: `varying vec3 vColor;
      void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;float glow=exp(-r*r*5.);float core=1.-smoothstep(.05,.48,r);gl_FragColor=vec4(vColor*(glow*.55+core),glow);}`,
  });
  const impactEmbers = new THREE.Points(emberGeometry, emberMaterial); impactEmbers.frustumCulled = false;
  impactEmbers.visible = false; flakes.visible = false;
  study.layers.sparks.add(impactEmbers);
  return { flakes, fragments, fragmentTransforms: [], particles, impactEmbers, burnMap, embers: [], emberCursor: 0,
    coalMatrices: study.coals.instanceMatrix.array.slice(), cursor: 0, lastShed: Array(7).fill(0), seed: null, rand,
    settling: null, impactEvents: [], impactSerial: 0, resetToken: null, impactPulse: 0,
    logTransforms: [], coalScale: null };
}

function emitImpact(view, impact, time, cycle) {
  const event = { id: ++view.impactSerial, time, strength: impact.strength, position: impact.position.clone() };
  view.impactEvents.push(event);
  if (view.impactEvents.length > 16) view.impactEvents.shift();
  // Cold wood still lands, but only a hot bed throws incandescent embers.
  const { x, y, z } = impact.position;
  const bedExposure = Math.exp(-(x * x + z * z) / 1.65) * Math.exp(-Math.max(0, y - .3));
  const heat = Math.max(impact.heat ?? 0, cycle.coalHeat * bedExposure);
  if (heat < .12) return;
  const count = Math.round((22 + impact.strength * 82) * Math.min(1, heat * 1.5));
  for (let i = 0; i < count; i++) {
    const angle = view.rand() * Math.PI * 2, spread = view.rand() * .28;
    const index = view.emberCursor++ % 320;
    view.embers = view.embers.filter(ember => ember.index !== index);
    view.embers.push({ index, start: time, life: 1.3 + view.rand() * 2.1, size: .023 + view.rand() * .042,
      origin: impact.position.clone().add(new THREE.Vector3(Math.cos(angle) * spread, .04 + view.rand() * .08, Math.sin(angle) * spread)),
      velocity: new THREE.Vector3(Math.cos(angle) * (.3 + view.rand() * 1.25), .8 + view.rand() * (1.2 + impact.strength * 2.2), Math.sin(angle) * (.3 + view.rand() * 1.25)),
      heat: .65 + view.rand() * .35 });
  }
}

function updateImpactEmbers(view, time) {
  view.impactPulse = view.impactEvents.reduce((pulse, impact) => Math.max(pulse, impact.strength * Math.exp(-(time - impact.time) * 4.8)), 0);
  // Once a burst is gone, retain its empty GPU buffers until the next impact.
  if (!view.embers.length && !view.impactEmbers.visible) return;
  const geometry = view.impactEmbers.geometry, positions = geometry.attributes.position, colors = geometry.attributes.color, sizes = geometry.attributes.aSize;
  sizes.array.fill(0); colors.array.fill(0);
  view.embers = view.embers.filter(ember => time - ember.start < ember.life);
  for (const ember of view.embers) {
    const age = time - ember.start, progress = age / ember.life, drag = (1 - Math.exp(-age * .65)) / .65;
    positions.setXYZ(ember.index, ember.origin.x + ember.velocity.x * drag + Math.sin(age * 8 + ember.index) * age * .035,
      ember.origin.y + ember.velocity.y * drag - age * age * .19,
      ember.origin.z + ember.velocity.z * drag + Math.cos(age * 6 + ember.index) * age * .025);
    const fade = Math.min(1, age * 25 + .18) * Math.pow(1 - progress, 1.25);
    sizes.setX(ember.index, ember.size * (.55 + .45 * fade));
    colors.setXYZ(ember.index, (3.2 + ember.heat * 2) * fade, (.45 + ember.heat * .8) * fade * (1 - progress * .8), .045 * fade * (1 - progress));
  }
  positions.needsUpdate = true; colors.needsUpdate = true; sizes.needsUpdate = true;
  view.impactEmbers.visible = view.embers.length > 0;
}

function changedValues(previous, values) {
  // The physics keeps full precision; avoid matrix churn from sub-micron drift.
  return !previous || values.some((value, i) => Math.abs(value - previous[i]) > 1e-6);
}

export function updateBurnVisuals(study, force = false) {
  const cycle = study.cycle, view = study.burnVisuals, t = study.animationTime;
  if (!cycle || !view) return false;
  const groundHeight = study.groundHeight || (() => 0);
  let opaqueChanged = (study.syncFuelMeshes?.() ?? false) || force;
  const resetToken = `${cycle.seed}:${cycle.resetSerial}`;
  if (view.resetToken !== resetToken) {
    view.resetToken = resetToken; view.seed = cycle.seed; view.particles.length = 0; view.embers.length = 0;
    view.impactEvents.length = 0; view.impactPulse = 0; view.lastShed = cycle.logs.map(log => log.shed);
    view.settling = createLogSettling(study.logDefs, cycle.seed);
    view.logTransforms.length = 0; view.coalScale = null;
    view.fragmentTransforms.length = 0;
    opaqueChanged = true;
  }
  const fire = study.volumes.find(volume => volume.material.uniforms.uSources);
  const fu = fire.material.uniforms;
  const visibleFlame = cycle.visibleFlame ?? cycle.flame;
  fu.uIntensity.value = clamp(visibleFlame / 3.8, 0, 1);
  if (fu.uCoreHeat) fu.uCoreHeat.value = cycle.coreHeat;
  if (fu.uFreshFuel) fu.uFreshFuel.value = clamp(cycle.logs.reduce((sum, log) => sum + (log.visibleFlame ?? log.flame) * clamp((log.wood - .2) / .8, 0, 1), 0) / Math.max(.1, visibleFlame), 0, 1);
  if (fu.uBurnMap) fu.uBurnMap.value = view.burnMap;
  if (fu.uLocalizedBurn) fu.uLocalizedBurn.value = cycle.logs.some(log => log.surface) ? 1 : 0;
  for (const volume of study.volumes) if (volume.material.uniforms.uSmokeAmount) volume.material.uniforms.uSmokeAmount.value = cycle.smoke;
  study.layers.flames.children.forEach(mesh => {
    const slot = mesh.userData.logSlot;
    // Volumetric contact flames replace the thin surface ribbon cards in living studies.
    if (slot !== undefined) mesh.visible = false;
    if (mesh.userData.twigFlame) mesh.visible = cycle.time < 420 && cycle.flame > .15;
    if (mesh.material?.uniforms?.uLife) mesh.material.uniforms.uLife.value = slot !== undefined ? cycle.logs[slot].flame : Math.min(1, cycle.flame);
  });
  view.settling.profiles = study.logMeshes.map(mesh => mesh.geometry?.userData.profile);
  updateLogSettling(view.settling, cycle, t, groundHeight);
  for (const impact of view.settling.impacts) emitImpact(view, impact, t, cycle);
  cycle.setLogPoses?.(view.settling.logs);
  for (let i = 0; i < cycle.logs.length; i++) {
    const log = cycle.logs[i], mesh = study.logMeshes[i], def = study.logDefs[i], pose = view.settling.logs[i];
    if (mesh.userData.fuelId !== log.id) { mesh.userData.fuelId = log.id; view.lastShed[i] = log.shed; }
    const type = getFuelType(log.fuelType);
    const live = pose.live, mass = log.wood + log.char * 1.4, radiusScale = pose.radius / (mesh.userData.radius ?? def[2]);
    if (applyLogFracture(mesh, pose.fracture)) opaqueChanged = true;
    if (mesh.visible !== live) opaqueChanged = true;
    mesh.visible = live;
    const transform = [pose.a.x, pose.a.y, pose.a.z, pose.b.x, pose.b.y, pose.b.z, radiusScale, pose.length, ...(pose.quaternion?.toArray() ?? [])];
    const logMoved = opaqueChanged || changedValues(view.logTransforms[i], transform);
    if (logMoved) {
      view.logTransforms[i] = transform;
      axis.subVectors(pose.b, pose.a).normalize(); center.copy(pose.a).lerp(pose.b, .5);
      mesh.position.copy(center);
      if (pose.quaternion) mesh.quaternion.copy(pose.quaternion); else mesh.quaternion.setFromUnitVectors(up, axis);
      mesh.scale.set(radiusScale, pose.length / mesh.userData.length, radiusScale);
      mesh.updateMatrixWorld();
      if (live) opaqueChanged = true;
    }
    const u = mesh.userData.burnUniforms;
    u.uWood.value = log.wood; u.uChar.value = log.char; u.uHeat.value = log.phase === 'queued' ? 0 : log.temperature;
    if (u.uBurnMap) {
      u.uBurnMap.value = view.burnMap; u.uBurnSlot.value = i; u.uBurnTime.value = t;
      u.uLocalizedBurn.value = log.surface ? 1 : 0;
    }
    if (log.surface) for (let k = 0; k < 40; k++) {
      const patch = log.surface.patches[k], offset = (i * 40 + k) * 4, data = view.burnMap.image.data;
      data[offset] = live ? patch.temperature : 0; data[offset + 1] = patch.wood; data[offset + 2] = patch.char; data[offset + 3] = live ? patch.flame : 0;
    }
    if (fu.uLogBasisX) fu.uLogBasisX.value[i].set(1, 0, 0).applyQuaternion(mesh.quaternion);
    if (fu.uLogBasisZ) fu.uLogBasisZ.value[i].set(0, 0, 1).applyQuaternion(mesh.quaternion);
    const chipsVisible = log.wood < .84;
    if (live && mesh.userData.charChips.visible !== chipsVisible) opaqueChanged = true;
    mesh.userData.charChips.visible = chipsVisible;
    // Derive every gas root from the transformed, shortened cylinder itself.
    const a = endA.set(0, -mesh.userData.length * .5, 0).applyMatrix4(mesh.matrixWorld);
    const b = endB.set(0, mesh.userData.length * .5, 0).applyMatrix4(mesh.matrixWorld);
    for (const ribbon of study.layers.flames.children) if (logMoved && ribbon.userData.logSlot === i) {
      ribbon.matrixAutoUpdate = false;
      ribbon.matrix.copy(mesh.matrixWorld).scale(new THREE.Vector3(type.radiusScale, type.lengthScale, type.radiusScale)).multiply(mesh.userData.baseInverse);
      ribbon.matrixWorldNeedsUpdate = true;
    }
    fu.uLogA.value[i].set(a.x, a.y, a.z, pose.radius);
    fu.uLogB.value[i].set(b.x, b.y, b.z, pose.radius * .88);
    fu.uLogHeat.value[i] = live ? (log.visibleFlame ?? log.flame) : 0;
    for (let j = i; j < 12; j += 7) {
      const original = study.flameSources[j], along = j < 7 ? .50 : .28;
      root.copy(a).lerp(b, along);
      const surfaceUp = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion.clone().invert());
      const angle = Math.atan2(surfaceUp.z, surfaceUp.x);
      const patch = log.surface ? sampleBurnSurface(log, along, angle) : null;
      const strength = live ? (patch?.flame ?? log.visibleFlame ?? log.flame) * Math.min(1, type.heatOutput) : 0;
      const height = original.w * (.14 + .86 * Math.sqrt(strength)) * (.5 + .5 * Math.sqrt(Math.min(1, mass))) * Math.sqrt(type.heatOutput);
      const rootY = root.y + pose.radius * .45;
      fu.uSources.value[j].set(root.x, rootY, root.z, Math.min(height, 4.45 - rootY)); fu.uFuel.value[j] = strength;
    }
    for (const sprite of study.motion.steam) if (sprite.userData.steam.log === i) sprite.userData.steam.origin.copy(a);
    if (log.shed - view.lastShed[i] > .001 && live) {
      view.lastShed[i] = log.shed;
      for (let k = 0; k < 2; k++) {
        const p = { index: view.cursor++ % 80, start: t, origin: a.clone().lerp(b, view.rand()), drift: (view.rand() - .5) * .7, size: .025 + view.rand() * .035 };
        p.origin.y += pose.radius; view.particles = view.particles.filter(old => old.index !== p.index); view.particles.push(p);
      }
    }
  }
  view.burnMap.needsUpdate = true;
  const fragments = view.settling.fragments || [];
  if (view.fragments.count !== fragments.length) opaqueChanged = true;
  view.fragments.count = fragments.length;
  let fragmentsChanged = false;
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i], transform = [...fragment.position.toArray(), ...fragment.quaternion.toArray(), fragment.radius, fragment.length];
    if (changedValues(view.fragmentTransforms[i], transform)) {
      view.fragmentTransforms[i] = transform; fragmentsChanged = true;
      obj.position.copy(fragment.position); obj.quaternion.copy(fragment.quaternion); obj.scale.set(fragment.radius, fragment.length, fragment.radius);
      obj.updateMatrix(); view.fragments.setMatrixAt(i, obj.matrix);
    }
    view.fragments.geometry.attributes.instanceHeat.setX(i, fragment.heat);
  }
  if (fragmentsChanged) { view.fragments.instanceMatrix.needsUpdate = true; opaqueChanged = true; }
  if (fragments.length) view.fragments.geometry.attributes.instanceHeat.needsUpdate = true;
  const coalScale = .28 + .72 * Math.sqrt(Math.min(1, cycle.coalMass / .5));
  const coalsChanged = force || view.coalScale !== coalScale;
  for (let i = 0; coalsChanged && i < study.coals.count; i++) {
    const offset = i * 16;
    for (let j = 0; j < 16; j++) study.coals.instanceMatrix.array[offset + j] = view.coalMatrices[offset + j] * (j < 12 ? coalScale : 1);
    const ground = groundHeight(view.coalMatrices[offset + 12], view.coalMatrices[offset + 14]);
    study.coals.instanceMatrix.array[offset + 13] = ground + (view.coalMatrices[offset + 13] - ground) * coalScale;
  }
  if (coalsChanged) { view.coalScale = coalScale; study.coals.instanceMatrix.needsUpdate = true; opaqueChanged = true; }
  const flakesChanged = view.particles.length > 0 || view.flakes.visible;
  if (flakesChanged) for (let i = 0; i < 80; i++) { obj.scale.setScalar(0); obj.updateMatrix(); view.flakes.setMatrixAt(i, obj.matrix); }
  for (const p of view.particles) {
    const age = t - p.start;
    obj.position.set(p.origin.x + p.drift * Math.min(age, .8), p.origin.y - age * age * 1.8, p.origin.z + Math.sin(p.index) * Math.min(age, .8) * .22);
    obj.position.y = Math.max(groundHeight(obj.position.x, obj.position.z) + .016, obj.position.y);
    obj.rotation.set(age * 2, age * 4 + p.index, age); obj.scale.set(p.size, p.size * .4, p.size * 1.5).multiplyScalar(Math.max(0, 1 - Math.max(0, age - 1.6) / 1.2));
    obj.updateMatrix(); view.flakes.setMatrixAt(p.index, obj.matrix);
    color.set('#d0b8a0').multiplyScalar(Math.max(.18, 2.4 - age * 1.6)); view.flakes.setColorAt(p.index, color);
  }
  view.particles = view.particles.filter(p => t - p.start < 2.8);
  if (flakesChanged) { view.flakes.instanceMatrix.needsUpdate = true; view.flakes.instanceColor.needsUpdate = true; opaqueChanged = true; }
  view.flakes.visible = view.particles.length > 0;
  updateImpactEmbers(view, t);
  const twigScale = Math.max(0, 1 - cycle.time / 600), twigsVisible = twigScale > .015;
  if (study.twigs.visible !== twigsVisible || (twigsVisible && study.twigs.scale.y !== twigScale)) opaqueChanged = true;
  study.twigs.scale.y = twigScale; study.twigs.visible = twigsVisible;
  for (const flame of study.layers.flames.children) if (flame.userData.twigFlame) {
    flame.position.copy(study.twigs.position); flame.scale.copy(study.twigs.scale);
  }
  for (const spark of study.layers.sparks.children) if (spark.userData.twigGlowOrigin) {
    spark.position.copy(spark.userData.twigGlowOrigin).multiply(study.twigs.scale).add(study.twigs.position);
    spark.scale.y = 2.2 * twigScale;
  }
  updateCoalBed(study.coals, cycle, force);
  updateAshBed(study.ashBed, cycle, study.coals, t, force);
  return opaqueChanged;
}
