import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMotionState, firelightMood, updateFlameCentroid, updateStudyMotion } from '../src/motion.js';
import { createHybridFire } from '../src/hybrid-fire.js';
import { createEmbers } from '../src/embers.js';
import { createSteam } from '../src/steam.js';
import { createWeather } from '../src/weather.js';

function motionStudy() {
  const layers = { flames: new THREE.Group(), smoke: new THREE.Group(), sparks: new THREE.Group(), steam: new THREE.Group() };
  const fire = createHybridFire({ fireVariant: 2, seed: 22 }, null, Array.from({ length: 7 }, (_, i) => [[-1, .2 + i * .1, 0], [1, .2 + i * .1, 0], .2]));
  layers.flames.add(fire);
  const embers = createEmbers({ seed: 22, sources: fire.material.uniforms.uSources.value, fuel: fire.material.uniforms.uFuel.value });
  layers.sparks.add(embers);
  const steam = createSteam({ logs: 7, map: new THREE.DataTexture(new Uint8Array(4), 1, 1) }); layers.steam.add(steam);
  const light = new THREE.PointLight('#ff9a43', 24, 7, 2), core = new THREE.PointLight('#ff420a', 4.5, 3.5, 2);
  light.position.set(0, .9, 0);
  const coalMaterial = new THREE.MeshStandardMaterial({ emissiveIntensity: 1.65 }), barkMaterial = new THREE.MeshStandardMaterial({ emissiveIntensity: .9 });
  Object.assign(coalMaterial.userData, { bedAsh: { value: 0 }, time: { value: 0 }, heat: { value: 1 }, impact: { value: 0 } });
  const cycle = { flame: 2.6, coalHeat: .7, coalMass: .4, ashMass: .1, time: 30, logs: Array.from({ length: 7 }, (_, i) => ({ phase: i < 3 ? 'burning' : 'queued', moisture: i === 1 ? .2 : .02, temperature: .8 })) };
  const study = { animationTime: 0, volumes: [fire], layers, cycle, flameCentroid: new THREE.Vector3(), flameHeight: 0, weather: createWeather(22) };
  study.motion = createMotionState(layers, { embers, steam, lights: [light, core], coalMaterial, barkMaterial });
  return { study, fire, embers, steam, light, core };
}

test('wind reaches the fire, smoke and embers, and the firelight follows the flames', () => {
  const { study, fire, embers, steam, light } = motionStudy();
  study.weather.update = () => { study.weather.gust = 1; study.weather.wind.set(1.1, 0, .3); return study.weather; };
  study.animationTime = 4; updateStudyMotion(study);
  assert.deepEqual(fire.material.uniforms.uWind.value.toArray(), [1.1, .3]);
  assert.deepEqual(embers.uniforms.uWind.value.toArray(), [1.1, 0, .3]);
  assert.equal(embers.uniforms.uTime.value, 4); assert.equal(steam.uniforms.uTime.value, 4);
  assert.ok(Math.abs(embers.uniforms.uPower.value - Math.min(1, 2.6 / 3.2)) < 1e-9);
  // Sources sit on y = .3..; the light rides above their fuel-weighted centre and leans into the wind.
  const centroidWeight = updateFlameCentroid(study);
  assert.ok(centroidWeight > 0 && study.flameHeight > 1);
  assert.ok(light.position.y > study.flameCentroid.y + .3, 'the light hangs above the flame roots');
  assert.ok(light.position.x > study.flameCentroid.x + .1, 'a gust from +x pushes the light downwind');
  assert.ok(light.intensity > 0);
  // Steam only leaves wood that is on the fire, scaled by its moisture.
  assert.equal(steam.uniforms.uStrength.value[3], 0);
  assert.ok(steam.uniforms.uStrength.value[1] > steam.uniforms.uStrength.value[0]);
});

test('firelight flicker is noise-driven, gusts widen it, and a dying fire dims and reddens the light', () => {
  const { study, light } = motionStudy();
  const base = light.intensity, samples = [];
  for (let frame = 1; frame <= 600; frame++) { study.animationTime = frame / 30; updateStudyMotion(study); samples.push(light.intensity); }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length, span = Math.max(...samples) - Math.min(...samples);
  assert.ok(Math.abs(mean - base * Math.min(1, 2.6 / 3.2)) < base * .08, 'the flicker is centred on the fire power');
  assert.ok(span > base * .35 && span < base * .85, `flicker span ${span / base} is lively but not strobing`);
  for (let i = 1; i < samples.length; i++) assert.ok(Math.abs(samples[i] - samples[i - 1]) < base * .14, 'no frame-to-frame jump');
  const calm = { ...study, weather: createWeather(1) }; calm.weather.update = () => { calm.weather.gust = 0; return calm.weather; };
  const windy = { ...study, weather: createWeather(1) }; windy.weather.update = () => { windy.weather.gust = 1; return windy.weather; };
  const spans = [calm, windy].map(variant => {
    const values = [];
    for (let frame = 1; frame <= 300; frame++) { variant.animationTime = 100 + frame / 30; updateStudyMotion(variant); values.push(light.intensity); }
    return Math.max(...values) - Math.min(...values);
  });
  assert.ok(spans[1] > spans[0] * 1.5, 'a gust deepens the flicker');
  const warm = light.color.clone();
  study.cycle.flame = .2; study.animationTime = 300; updateStudyMotion(study);
  assert.ok(light.intensity < base * .12, 'little flame, little light');
  assert.ok(light.color.g < warm.g, 'ember light is redder than flame light');
});

test('the firelight has calm spells, lively spells and brief dips rather than one steady shimmer', () => {
  const { study, light } = motionStudy();
  study.weather.update = () => { study.weather.gust = 0; return study.weather; };
  const samples = [];
  for (let frame = 1; frame <= 30 * 1200; frame++) { study.animationTime = frame / 30; updateStudyMotion(study); samples.push(light.intensity); }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const deviation = window => { const m = window.reduce((a, b) => a + b, 0) / window.length; return Math.sqrt(window.reduce((a, b) => a + (b - m) ** 2, 0) / window.length); };
  const windows = []; for (let start = 0; start + 300 <= samples.length; start += 300) windows.push(deviation(samples.slice(start, start + 300)));
  assert.ok(Math.max(...windows) > Math.min(...windows) * 1.8, 'ten-second stretches differ in how much the light moves');
  const dips = samples.filter(value => value < mean * .75).length / samples.length;
  assert.ok(dips > .002 && dips < .04, `occasional deep dips (${(dips * 100).toFixed(2)}% of frames)`);
  assert.ok(samples.every(value => value > 0), 'the light never goes out');
  for (const t of [0, 12.5, 400]) {
    const mood = firelightMood(t);
    assert.ok(mood.lively >= 0 && mood.lively <= 1 && mood.dip >= 0 && mood.dip <= 1);
    assert.deepEqual(firelightMood(t), mood, 'the mood is a pure function of time');
  }
});
