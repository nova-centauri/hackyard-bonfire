import * as THREE from 'three';
import { flicker, smoothNoise } from './weather.js';

// Gas motion uses real seconds; the separate burn clock controls the fuel and heat.
// Embers and steam are computed on the GPU from time, so this only forwards
// the slow-changing state they depend on (fire power, heat, per-log steam),
// drives the wind, and moves and flickers the firelight.
const WARM = new THREE.Color('#ff9a43'), EMBER_LIGHT = new THREE.Color('#ff6a1e'), SOIL_WARM = new THREE.Color('#ffc58e');

export function createMotionState(layers, { embers, steam, twigInstances, lights, coalMaterial, barkMaterial, clearingLight }) {
  const uniforms = new Set();
  for (const group of Object.values(layers)) group.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material?.uniforms?.uTime) uniforms.add(material.uniforms.uTime);
  });
  return {
    uniforms: [...uniforms], embers, steam, twigInstances, clearingLight,
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

// The fire's mood on the animation clock: `lively` (0..1) rises and falls over
// tens of seconds, `dip` (0..1) is the brief, rare collapse of a flame sheet.
// Both are pure functions of time, so they are identical at any frame rate.
export function firelightMood(time) {
  const agitation = smoothNoise(time * .09, 61) * .6 + smoothNoise(time * .023, 67) * .4;
  const dip = Math.pow(Math.max(0, (smoothNoise(time * 1.1, 71) - .72) / .28), 2);
  return { lively: agitation * agitation, dip };
}

// Keep the key light in the flame volume: never inside a log, never as a
// lantern hovering a metre above the pit. Shadows then belong to the fire.
export function constrainFirelight(target, { firePower = 1, flameHeight = 1 } = {}) {
  const span = Math.hypot(target.x, target.z);
  const maxR = .38 + firePower * .14;
  if (span > maxR) { target.x *= maxR / span; target.z *= maxR / span; }
  const maxY = 1.02 + firePower * .22 + Math.min(.18, flameHeight * .05);
  target.y = THREE.MathUtils.clamp(target.y, .58, maxY);
  return target;
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
  // A trace of hot ash cannot light an empty clearing like a full coal bed.
  const coalLightPower = cycle ? coalHeat * THREE.MathUtils.smoothstep(cycle.coalMass || 0, 0, .14) : 1;
  const impact = study.burnVisuals?.impactPulse || 0;
  const weather = study.weather?.update(time), wind = weather?.wind, gust = weather?.gust || 0;
  for (const volume of study.volumes) {
    const u = volume.material.uniforms;
    if (u.uImpact) u.uImpact.value = impact;
    if (u.uWind && wind) u.uWind.value.set(wind.x, wind.z);
    if (u.uSmokeLight) u.uSmokeLight.value = Math.max(firePower, coalLightPower * .25);
  }
  if (motion.embers) {
    const u = motion.embers.uniforms;
    u.uPower.value = firePower; u.uCoalHeat.value = cycle?.coalMass > .005 ? coalHeat : 0; u.uImpact.value = impact;
    if (wind) u.uWind.value.copy(wind);
    motion.embers.visible = firePower > .002 || (cycle?.coalMass > .005 && coalHeat > .12);
  }
  if (motion.steam) {
    if (wind) motion.steam.uniforms.uWind.value.set(wind.x, wind.z);
    if (cycle) for (let i = 0; i < motion.steam.logs; i++) {
      const fuel = cycle.logs[i];
      motion.steam.setStrength(i, !fuel || fuel.phase === 'queued' || fuel.phase === 'ash' ? 0 : Math.min(1, fuel.moisture * 10) * fuel.temperature);
    }
  }
  updateFlameCentroid(study);
  // Firelight breathes with layered noise rather than a pair of sines, and it
  // is not stationary: a slow agitation envelope gives the fire calm spells
  // and lively ones, a flame sheet occasionally tears away and the light dips
  // for a moment, gusts deepen it all, and the main light follows the flames'
  // centre so the shadows on the stones lean with the fire.
  const { lively, dip } = firelightMood(time);
  let clearingFlicker = 1;
  motion.lights.forEach(({ light, intensity, home }, index) => {
    const noise = flicker(time * (index ? 1.35 : 1), index * 17);
    const amplitude = index === 0 ? .2 + lively * .18 + gust * .22 : .12 + lively * .07;
    const level = (1 + (noise - .5) * 2 * amplitude + impact * .28) * (1 - dip * (index === 0 ? .18 : .1));
    if (index === 0) clearingFlicker = Math.max(0, 1 + (level - 1) * .6);
    // Coals keep a warm pool when the gas dips, so the pit stays readable.
    const power = index === 0 ? Math.max(firePower, coalLightPower * .16) : coalLightPower;
    light.intensity = intensity * Math.max(0, level) * power;
    if (index === 0 && study.flameCentroid) {
      const target = motion.lightTarget.copy(study.flameCentroid);
      target.y += .18 + .32 * firePower + .05 * study.flameHeight;
      target.x += (smoothNoise(time * .7, 41) - .5) * (.08 + lively * .07) + (wind?.x || 0) * .16;
      target.z += (smoothNoise(time * .6, 43) - .5) * (.08 + lively * .07) + (wind?.z || 0) * .16;
      constrainFirelight(target, { firePower, flameHeight: study.flameHeight });
      if (dt === 0) light.position.copy(target); else light.position.lerp(target, 1 - Math.exp(-dt * 2.2));
      constrainFirelight(light.position, { firePower, flameHeight: study.flameHeight });
      light.color.copy(EMBER_LIGHT).lerp(WARM, Math.min(1, firePower * 1.6));
    } else if (index === 0) light.position.copy(home);
    else if (index === 1 && study.flameCentroid) {
      const mix = dt === 0 ? 1 : 1 - Math.exp(-dt * 1.8);
      light.position.x += (study.flameCentroid.x * .35 - light.position.x) * mix;
      light.position.z += (study.flameCentroid.z * .35 - light.position.z) * mix;
      light.position.y += (.14 + coalHeat * .1 - light.position.y) * mix;
    }
  });
  if (motion.clearingLight) {
    const u = motion.clearingLight;
    u.uClearingPower.value.set(firePower * clearingFlicker, coalLightPower * (1 + (flicker(time * .45, 9) - .5) * .12));
    u.uClearingColor.value.copy(EMBER_LIGHT).lerp(SOIL_WARM, Math.min(1, firePower * 1.6));
    const origin = motion.lights[0]?.light.position || study.flameCentroid;
    if (origin) u.uClearingOrigin.value.set(origin.x, origin.z);
  }
  motion.coalMaterial.emissiveIntensity = motion.coalEmission;
  if (motion.coalMaterial.userData.time) {
    motion.coalMaterial.userData.time.value = time;
    motion.coalMaterial.userData.heat.value = coalHeat;
    motion.coalMaterial.userData.impact.value = impact;
  }
  if (cycle) motion.coalMaterial.userData.bedAsh.value = Math.min(1, cycle.ashMass / (cycle.coalMass + cycle.ashMass + .001)) * (1 - coalHeat * .7);
  motion.barkMaterial.emissiveIntensity = motion.barkEmission * (1 + (flicker(time * .6, 5) - .5) * (.12 + lively * .08));
  if (cycle && motion.twigInstances?.glowMesh) motion.twigInstances.glowMesh.visible = cycle.time < 600 && firePower > .04;
}
