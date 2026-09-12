import * as THREE from 'three';
import { flicker, smoothNoise } from './weather.js';

// Gas motion uses real seconds; the separate burn clock controls the fuel and heat.
// Embers and steam are computed on the GPU from time, so this only forwards
// the slow-changing state they depend on (fire power, heat, per-log steam),
// drives the wind, and moves and flickers the firelight.
const WARM = new THREE.Color('#ff9a43'), EMBER_LIGHT = new THREE.Color('#ff6a1e');

export function createMotionState(layers, { embers, steam, twigInstances, lights, coalMaterial, barkMaterial }) {
  const uniforms = new Set();
  for (const group of Object.values(layers)) group.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material?.uniforms?.uTime) uniforms.add(material.uniforms.uTime);
  });
  return {
    uniforms: [...uniforms], embers, steam, twigInstances,
    lights: lights.map(light => ({ light, intensity: light.intensity, home: light.position.clone() })),
    coalMaterial, coalEmission: coalMaterial.emissiveIntensity,
    barkMaterial, barkEmission: barkMaterial.emissiveIntensity,
    lastTime: null, lightTarget: new THREE.Vector3(),
  };
}

// Weighted centre of the burning flame roots and their mean height, written
// into study.flameCentroid / study.flameHeight for the light and heat haze.
export function updateFlameCentroid(study) {
  const centroid = study.flameCentroid;
  if (!centroid) return 0;
  const fire = study.volumes.find(volume => volume.material.uniforms.uSources);
  if (!fire) { centroid.set(0, .6, 0); study.flameHeight = 2.4; return 1; }
  const sources = fire.material.uniforms.uSources.value, fuel = fire.material.uniforms.uFuel.value;
  let weight = 0, height = 0; centroid.set(0, 0, 0);
  for (let i = 0; i < sources.length; i++) {
    const w = Math.max(0, fuel[i]) * Math.max(0, sources[i].w);
    if (w <= 0) continue;
    weight += w; height += sources[i].w * w;
    centroid.x += sources[i].x * w; centroid.y += sources[i].y * w; centroid.z += sources[i].z * w;
  }
  if (weight < 1e-4) { centroid.set(0, .45, 0); study.flameHeight = 1; return 0; }
  centroid.divideScalar(weight); study.flameHeight = height / weight;
  return weight;
}

export function updateStudyMotion(study) {
  const motion = study.motion;
  if (!motion) return;
  const time = study.animationTime;
  const dt = motion.lastTime === null ? 0 : Math.max(0, Math.min(.2, time - motion.lastTime));
  motion.lastTime = time;
  for (const uniform of motion.uniforms) uniform.value = time;
  const cycle = study.cycle;
  const firePower = cycle ? Math.min(1, cycle.flame / 3.2) : 1;
  const coalHeat = cycle ? cycle.coalHeat : 1;
  const impact = study.burnVisuals?.impactPulse || 0;
  const weather = study.weather?.update(time), wind = weather?.wind, gust = weather?.gust || 0;
  for (const volume of study.volumes) {
    const u = volume.material.uniforms;
    if (u.uImpact) u.uImpact.value = impact;
    if (u.uWind && wind) u.uWind.value.set(wind.x, wind.z);
  }
  if (motion.embers) {
    const u = motion.embers.uniforms;
    u.uPower.value = firePower; u.uCoalHeat.value = cycle?.coalMass > .005 ? coalHeat : 0; u.uImpact.value = impact;
    if (wind) u.uWind.value.copy(wind);
    motion.embers.visible = firePower > .002 || (cycle?.coalMass > .005 && coalHeat > .12);
  }
  if (motion.steam && cycle) for (let i = 0; i < motion.steam.logs; i++) {
    const fuel = cycle.logs[i];
    motion.steam.setStrength(i, !fuel || fuel.phase === 'queued' || fuel.phase === 'ash' ? 0 : Math.min(1, fuel.moisture * 10) * fuel.temperature);
  }
  updateFlameCentroid(study);
  // Firelight breathes with layered noise rather than a pair of sines, gusts
  // deepen the flicker, and the main light follows the flames' centre so the
  // shadows on the stones lean with the fire.
  motion.lights.forEach(({ light, intensity, home }, index) => {
    const noise = flicker(time * (index ? 1.35 : 1), index * 17);
    const amplitude = index === 0 ? .16 + gust * .26 : .08;
    const level = 1 + (noise - .5) * 2 * amplitude + impact * .32;
    light.intensity = intensity * Math.max(0, level) * (index === 0 ? firePower : coalHeat);
    if (index === 0 && study.flameCentroid) {
      const target = motion.lightTarget.copy(study.flameCentroid);
      target.y += .3 + .45 * firePower + .12 * study.flameHeight;
      target.x += (smoothNoise(time * .7, 41) - .5) * .12 + (wind?.x || 0) * .18;
      target.z += (smoothNoise(time * .6, 43) - .5) * .12 + (wind?.z || 0) * .18;
      if (dt === 0) light.position.copy(target); else light.position.lerp(target, 1 - Math.exp(-dt * 2.5));
      light.color.copy(EMBER_LIGHT).lerp(WARM, Math.min(1, firePower * 1.6));
    } else if (index === 0) light.position.copy(home);
  });
  motion.coalMaterial.emissiveIntensity = motion.coalEmission;
  if (motion.coalMaterial.userData.time) {
    motion.coalMaterial.userData.time.value = time;
    motion.coalMaterial.userData.heat.value = coalHeat;
    motion.coalMaterial.userData.impact.value = impact;
  }
  if (cycle) motion.coalMaterial.userData.bedAsh.value = Math.min(1, cycle.ashMass / (cycle.coalMass + cycle.ashMass + .001)) * (1 - coalHeat * .7);
  motion.barkMaterial.emissiveIntensity = motion.barkEmission * (1 + (flicker(time * .6, 5) - .5) * .09);
  if (cycle && motion.twigInstances?.glowMesh) motion.twigInstances.glowMesh.visible = cycle.time < 600 && firePower > .04;
}
