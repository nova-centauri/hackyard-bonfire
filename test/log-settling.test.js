import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { createBurnVisuals, updateBurnVisuals } from '../src/burn-visuals.js';
import { BurnCycle } from '../src/lifecycle.js';

const definitions = [
  [[-1, .2, 0], [1, .2, 0], .2],
  [[0, .6, -1], [0, .6, 1], .2],
];
const log = slot => ({ slot, id: slot + 1, wood: 1, char: 0, scale: 1, angle: 0, offset: 0, phase: 'burning', addedAt: -1, temperature: .9 });
const floor = () => -.2;

test('crossed logs rest on real lower fuel and sink to the bowl when support burns away', () => {
  const cycle = { logs: [log(0), log(1)] }, state = createLogSettling(definitions, 42);
  updateLogSettling(state, cycle, 0, floor);
  assert.ok(state.logs[1].supports.includes(0));
  assert.ok(Math.abs(state.logs[1].y - state.logs[0].y - .4) < 1e-6);
  const previousHeight = state.logs[1].y;
  cycle.logs[0].wood = 0; cycle.logs[0].phase = 'ash';
  updateLogSettling(state, cycle, 1 / 60, floor);
  assert.ok(state.logs[1].y < previousHeight);
  assert.ok(state.logs[1].y > .35, 'unsupported log begins a visible fall, not a teleport');
  const impacts = [];
  for (let frame = 2; frame <= 60; frame++) {
    updateLogSettling(state, cycle, frame / 60, floor); impacts.push(...state.impacts);
  }
  assert.ok(Math.abs(state.logs[1].y - .012) < 1e-6);
  assert.equal(impacts.length, 1);
  assert.ok(impacts[0].strength > .5);
  assert.ok(Math.abs(impacts[0].position.x) < .01 && Math.abs(impacts[0].position.z) < .01);
});

test('new logs fall in real seconds regardless of burn speed and replacement fuel rests above older logs', () => {
  const run = speed => {
    const cycle = { logs: [log(0), { ...log(1), phase: 'queued', addedAt: null }], burnSpeed: speed };
    const state = createLogSettling(definitions, 42); updateLogSettling(state, cycle, 0, floor);
    cycle.logs[1].phase = 'fresh'; cycle.logs[1].addedAt = 120;
    updateLogSettling(state, cycle, .01, floor);
    const start = state.logs[1].y, trajectory = [];
    for (let frame = 1; frame <= 60; frame++) {
      cycle.time = frame / 60 * speed;
      updateLogSettling(state, cycle, .01 + frame / 60, floor); trajectory.push(state.logs[1].y);
    }
    assert.ok(start - state.logs[1].y > .8);
    assert.ok(state.logs[1].supports.includes(0));
    // Reusing the original bottom slot adds wood onto the current top surface.
    cycle.logs[0] = { ...log(0), id: 12, phase: 'fresh', addedAt: 180 };
    for (let frame = 61; frame <= 160; frame++) updateLogSettling(state, cycle, frame / 60, floor);
    assert.ok(state.logs[0].y > state.logs[1].y + .35);
    assert.ok(state.logs[0].supports.includes(1));
    return trajectory;
  };
  assert.deepEqual(run(1), run(1200));
});

test('hot weakened shells release periodically while cold intact logs remain stable', () => {
  const hot = { logs: [{ ...log(0), wood: .55, char: .14 }, { ...log(1), wood: .48, char: .12 }] };
  const state = createLogSettling(definitions, 42), impacts = [];
  updateLogSettling(state, hot, 0, floor);
  const initialHeight = state.logs[1].y;
  for (let frame = 1; frame <= 1800; frame++) {
    updateLogSettling(state, hot, frame / 60, floor); impacts.push(...state.impacts);
  }
  assert.ok(state.logs.some(pose => pose.releases > 0));
  assert.ok(state.logs[1].y < initialHeight - .03);
  assert.ok(impacts.length > 0, 'a crushed support should create a landing');
  const cold = { logs: [{ ...log(0), temperature: .03 }, { ...log(1), temperature: .03 }] };
  const coldState = createLogSettling(definitions, 42); updateLogSettling(coldState, cold, 0, floor);
  for (let frame = 1; frame <= 1800; frame++) updateLogSettling(coldState, cold, frame / 60, floor);
  assert.ok(coldState.logs.every(pose => pose.releases === 0));
});

function visualStudy() {
  const cycle = new BurnCycle(42);
  cycle.logs.forEach((fuel, i) => Object.assign(fuel, log(i), { phase: i < 2 ? 'burning' : 'queued', flame: i < 2 ? .8 : 0, shed: 0 }));
  cycle.updateSummary();
  const defs = Array.from({ length: 7 }, (_, i) => definitions[i % 2]);
  const logMeshes = defs.map(def => {
    const a = new THREE.Vector3(...def[0]), b = new THREE.Vector3(...def[1]), mesh = new THREE.Object3D();
    mesh.position.copy(a).lerp(b, .5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); mesh.updateMatrixWorld();
    mesh.userData = { length: a.distanceTo(b), baseInverse: mesh.matrixWorld.clone().invert(), charChips: new THREE.Object3D(), burnUniforms: { uWood: {}, uChar: {}, uHeat: {} } };
    return mesh;
  });
  const uniform = value => ({ value });
  const fire = new THREE.Object3D(); fire.material = { uniforms: {
    uIntensity: uniform(1), uSources: uniform(Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, 1))),
    uFuel: uniform(new Float32Array(12)), uLogA: uniform(Array.from({ length: 7 }, () => new THREE.Vector4())),
    uLogB: uniform(Array.from({ length: 7 }, () => new THREE.Vector4())), uLogHeat: uniform(new Float32Array(7)),
  } };
  const coals = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 1);
  coals.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -.1, 0));
  const study = { cycle, animationTime: 0, logDefs: defs, logMeshes, volumes: [fire], groundHeight: floor,
    layers: { flames: new THREE.Group(), sparks: new THREE.Group() }, opaque: new THREE.Group(), coals,
    motion: { steam: [] }, twigs: new THREE.Group(), ashBed: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
    flameSources: fire.material.uniforms.uSources.value.map(source => source.clone()) };
  study.burnVisuals = createBurnVisuals(study);
  return study;
}

test('landing emits hot embers; reset clears events even with the same seed; source endpoints follow the shortened mesh', () => {
  const study = visualStudy(); updateBurnVisuals(study, true);
  const initialToken = study.burnVisuals.resetToken;
  study.cycle.logs[0].phase = 'ash'; study.cycle.logs[0].wood = 0;
  for (let frame = 1; frame <= 30; frame++) { study.animationTime = frame / 60; updateBurnVisuals(study); }
  assert.equal(study.burnVisuals.impactEvents.length, 1);
  assert.ok(study.burnVisuals.embers.length > 20);
  assert.ok(study.burnVisuals.impactPulse > 0);
  study.cycle.logs[1].wood = .35;
  study.animationTime += 1 / 60; updateBurnVisuals(study);
  const mesh = study.logMeshes[1], actualEnd = new THREE.Vector3(0, mesh.userData.length / 2, 0).applyMatrix4(mesh.matrixWorld);
  const shaderEnd = study.volumes[0].material.uniforms.uLogB.value[1];
  assert.ok(actualEnd.distanceTo(new THREE.Vector3(shaderEnd.x, shaderEnd.y, shaderEnd.z)) < 1e-8);
  study.cycle.reset(42); study.animationTime = 0; updateBurnVisuals(study, true);
  assert.notEqual(study.burnVisuals.resetToken, initialToken);
  assert.equal(study.burnVisuals.impactEvents.length, 0); assert.equal(study.burnVisuals.embers.length, 0); assert.equal(study.burnVisuals.impactPulse, 0);
});

test('twig flame shells and attached sparks follow their shrinking fuel into the pit', () => {
  const study = visualStudy(), flame = new THREE.Object3D(), spark = new THREE.Object3D();
  flame.userData.twigFlame = true;
  spark.userData.twigGlowOrigin = new THREE.Vector3(.3, .7, -.2);
  study.layers.flames.add(flame); study.layers.sparks.add(spark); study.twigs.position.y = -.16;
  study.cycle.time = 300; updateBurnVisuals(study, true);
  assert.equal(flame.scale.y, .5); assert.equal(flame.position.y, -.16);
  assert.ok(Math.abs(spark.position.y - .19) < 1e-8);
  assert.equal(spark.position.x, .3); assert.equal(spark.position.z, -.2);
});
