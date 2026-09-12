import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { constrainFirelight, createMotionState, firelightMood, updateFlameCentroid, updateStudyMotion } from '../src/motion.js';
import { createHybridFire } from '../src/hybrid-fire.js';
import { createVolume } from '../src/volume.js';
import { createEmbers } from '../src/embers.js';
import { createSteam } from '../src/steam.js';
import { createWeather } from '../src/weather.js';
import { createClearingLight } from '../src/ground.js';

function motionStudy() {
  const layers = { flames: new THREE.Group(), smoke: new THREE.Group(), sparks: new THREE.Group(), steam: new THREE.Group() };
  const fire = createHybridFire({ fireVariant: 2, seed: 22 }, null, Array.from({ length: 7 }, (_, i) => [[-1, .2 + i * .1, 0], [1, .2 + i * .1, 0], .2]));
  layers.flames.add(fire);
  const smoke = createVolume('smoke', { animated: true, mode: 5, seed: 22, flameScale: 1, smoke: '#77817e' }, null);
  layers.smoke.add(smoke);
  const embers = createEmbers({ seed: 22, sources: fire.material.uniforms.uSources.value, fuel: fire.material.uniforms.uFuel.value });
  layers.sparks.add(embers);
  const steam = createSteam({ logs: 7, map: new THREE.DataTexture(new Uint8Array(4), 1, 1) }); layers.steam.add(steam);
  const light = new THREE.PointLight('#ff9a43', 24, 7, 2), core = new THREE.PointLight('#ff420a', 4.5, 3.5, 2);
  light.position.set(0, .9, 0);
  const coalMaterial = new THREE.MeshStandardMaterial({ emissiveIntensity: 1.65 }), barkMaterial = new THREE.MeshStandardMaterial({ emissiveIntensity: .9 });
  Object.assign(coalMaterial.userData, { bedAsh: { value: 0 }, time: { value: 0 }, heat: { value: 1 }, impact: { value: 0 } });
  const cycle = { flame: 2.6, coalHeat: .7, coalMass: .4, ashMass: .1, time: 30, logs: Array.from({ length: 7 }, (_, i) => ({ phase: i < 3 ? 'burning' : 'queued', moisture: i === 1 ? .2 : .02, temperature: .8 })) };
  const study = { animationTime: 0, volumes: [fire, smoke], layers, cycle, flameCentroid: new THREE.Vector3(), flameHeight: 0, weather: createWeather(22) };
  const clearingLight = createClearingLight();
  study.motion = createMotionState(layers, { embers, steam, lights: [light, core], coalMaterial, barkMaterial, clearingLight });
  return { study, fire, smoke, embers, steam, light, core, clearingLight };
}

test('wind reaches the fire, smoke, steam and embers, and the firelight follows the flames', () => {
  const { study, fire, smoke, embers, steam, light } = motionStudy();
  study.weather.update = () => { study.weather.gust = 1; study.weather.wind.set(1.1, 0, .3); return study.weather; };
  study.animationTime = 4; updateStudyMotion(study);
  assert.deepEqual(fire.material.uniforms.uWind.value.toArray(), [1.1, .3]);
  assert.deepEqual(smoke.material.uniforms.uWind.value.toArray(), [1.1, .3]);
  assert.deepEqual(embers.uniforms.uWind.value.toArray(), [1.1, 0, .3]);
  assert.deepEqual(steam.uniforms.uWind.value.toArray(), [1.1, .3]);
  assert.equal(embers.uniforms.uTime.value, 4); assert.equal(steam.uniforms.uTime.value, 4);
  assert.ok(Math.abs(embers.uniforms.uPower.value - Math.min(1, 2.6 / 3.2)) < 1e-9);
  // Sources sit on y = .3..; the light rides above their fuel-weighted centre and leans into the wind.
  const centroidWeight = updateFlameCentroid(study);
  assert.ok(centroidWeight > 0 && study.flameHeight > 1);
  assert.ok(light.position.y > study.flameCentroid.y + .15, 'the light hangs above the flame roots');
  assert.ok(light.position.x > study.flameCentroid.x + .1, 'a gust from +x pushes the light downwind');
  assert.ok(light.intensity > 0);
  // Steam only leaves wood that is on the fire, scaled by its moisture.
  assert.equal(steam.uniforms.uStrength.value[3], 0);
  assert.ok(steam.uniforms.uStrength.value[1] > steam.uniforms.uStrength.value[0]);
  study.cycle.logs[0].moisture = 0;
  study.cycle.logs[1].temperature = 0;
  study.cycle.logs[2].phase = 'ash';
  updateStudyMotion(study);
  assert.deepEqual(Array.from(steam.uniforms.uStrength.value), Array(7).fill(0), 'dry, cold, exhausted and queued wood emits no steam');
});

test('smoke illumination follows flame power, remaining coals and extinction', () => {
  const { study, smoke } = motionStudy(), light = smoke.material.uniforms.uSmokeLight;
  updateStudyMotion(study);
  assert.ok(Math.abs(light.value - study.cycle.flame / 3.2) < 1e-9, 'flames illuminate the main plume');
  study.cycle.flame = 0;
  updateStudyMotion(study);
  assert.equal(light.value, study.cycle.coalHeat * .25, 'hot coals retain a weaker glow');
  study.cycle.coalMass = 0;
  updateStudyMotion(study);
  assert.equal(light.value, 0, 'an empty coal bed cannot light smoke');
  study.cycle.coalMass = .4; study.cycle.coalHeat = 0;
  updateStudyMotion(study);
  assert.equal(light.value, 0, 'cold coals cannot light smoke');
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
  assert.ok(light.intensity < base * .2, 'little flame, little light; coals still warm the pit');
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
  const dips = samples.filter(value => value < mean * .82).length / samples.length;
  assert.ok(dips > .002 && dips < .06, `occasional dips (${(dips * 100).toFixed(2)}% of frames)`);
  assert.ok(samples.every(value => value > 0), 'the light never goes out');
  for (const t of [0, 12.5, 400]) {
    const mood = firelightMood(t);
    assert.ok(mood.lively >= 0 && mood.lively <= 1 && mood.dip >= 0 && mood.dip <= 1);
    assert.deepEqual(firelightMood(t), mood, 'the mood is a pure function of time');
  }
});

test('firelight stays in the flame volume and never inside a log', () => {
  const target = new THREE.Vector3(1.4, .15, .9);
  constrainFirelight(target, { firePower: .8, flameHeight: 2 });
  assert.ok(Math.hypot(target.x, target.z) < .55);
  assert.ok(target.y > .57 && target.y < 1.4);
  const { study, light, core } = motionStudy();
  study.flameCentroid.set(1.2, .2, .8);
  study.flameHeight = 2.2;
  study.animationTime = 1;
  updateStudyMotion(study);
  assert.ok(Math.hypot(light.position.x, light.position.z) < .55, 'the key light stays over the pit');
  assert.ok(light.position.y > .57 && light.position.y < 1.45);
  assert.ok(Math.hypot(core.position.x, core.position.z) < .5);
  assert.ok(core.position.y < .4, 'the coal light stays in the bed');
});

test('surrounding soil follows the flame flicker and falls back to red coal light', () => {
  const { study, light, clearingLight: u } = motionStudy();
  study.animationTime = 10; updateStudyMotion(study);
  assert.ok(u.uClearingPower.value.x > .6 && u.uClearingPower.value.y > .6);
  assert.deepEqual(u.uClearingOrigin.value.toArray(), [light.position.x, light.position.z]);
  const first = u.uClearingPower.value.x, warm = u.uClearingColor.value.clone();
  const previousCycle = JSON.stringify(study.cycle);
  study.animationTime = 10.5; updateStudyMotion(study);
  assert.notEqual(u.uClearingPower.value.x, first, 'the whole clearing breathes with the fire');
  assert.equal(JSON.stringify(study.cycle), previousCycle, 'light never feeds animation time into combustion');
  study.cycle.flame = 0; updateStudyMotion(study);
  assert.equal(u.uClearingPower.value.x, 0, 'the broad flame spill ends with the flame');
  assert.ok(u.uClearingPower.value.y > .6, 'a hot bed keeps the narrow coal pool');
  assert.ok(u.uClearingColor.value.g < warm.g, 'coal light is redder');
});

test('an exhausted or cold coal bed cannot leave a lit clearing', () => {
  const { study, light, core, clearingLight: u } = motionStudy();
  study.cycle.flame = 0; study.animationTime = 20; updateStudyMotion(study);
  const fullBed = u.uClearingPower.value.y;
  study.cycle.coalMass = .014; updateStudyMotion(study);
  assert.ok(u.uClearingPower.value.y > 0 && u.uClearingPower.value.y < fullBed * .04, 'a few hot fragments contribute little light');
  study.cycle.coalMass = 0; study.cycle.coalHeat = .95; updateStudyMotion(study);
  assert.deepEqual(u.uClearingPower.value.toArray(), [0, 0]);
  assert.equal(light.intensity, 0); assert.equal(core.intensity, 0);
  study.cycle.coalMass = .4; study.cycle.coalHeat = 0; updateStudyMotion(study);
  assert.deepEqual(u.uClearingPower.value.toArray(), [0, 0]);
  assert.equal(light.intensity, 0); assert.equal(core.intensity, 0);
  study.cycle.flame = 2.6; updateStudyMotion(study);
  assert.ok(u.uClearingPower.value.x > .6 && light.intensity > 0, 'fresh flame can light the clearing before coals have formed');
  assert.equal(u.uClearingPower.value.y, 0);
});
