import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { createBurnVisuals, updateBurnVisuals } from '../src/burn-visuals.js';
import { BurnCycle } from '../src/lifecycle.js';
import { createAshBed } from '../src/ash-bed.js';
import { createTwigSettling } from '../src/twig-settling.js';

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
  assert.ok(Math.abs(state.logs[1].y - .011) < .002, 'the visible cylinder rests within the contact skin of the ground');
  assert.equal(impacts.length, 1);
  assert.ok(impacts[0].strength > .5);
  assert.ok(Math.abs(impacts[0].position.x) < .01 && Math.abs(impacts[0].position.z) <= 1.01, 'impact lies on the contacting log, including an end-first landing');
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
  // This rendering fixture deliberately drives bulk uniforms by hand. Local
  // combustion has its own surface/pose integration tests.
  cycle.logs.forEach(fuel => { delete fuel.surface; });
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
    motion: { steam: [] }, twigs: new THREE.Group(), ashBed: createAshBed(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial())),
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

test('twig flame shells and attached sparks follow their rigid fuel as it falls into the pit', () => {
  const study = visualStudy(), flame = new THREE.Object3D(), spark = new THREE.Object3D();
  flame.userData.twigFlame = true;
  const a = new THREE.Vector3(.3, .4, -.2), b = new THREE.Vector3(.3, .9, -.2);
  const addBranch = (start, end) => {
    const direction = end.clone().sub(start);
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(.016, .02, direction.length(), 7), new THREE.MeshStandardMaterial());
    twig.position.copy(start).lerp(end, .5); twig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    study.twigs.add(twig); return twig;
  };
  const main = addBranch(a, b); addBranch(a.clone().lerp(b, .58), b.clone().add(new THREE.Vector3(.15, .1, -.1)));
  // The scene places the two flame-jacket pairs last.
  addBranch(a.clone().addScalar(1), b.clone().addScalar(1));
  addBranch(a.clone().addScalar(1).lerp(b.clone().addScalar(1), .58), b.clone().add(new THREE.Vector3(1.15, 1.1, .9)));
  spark.userData.twigGlowOrigin = a.clone().lerp(b, .6);
  study.twigs.position.y = -.16; spark.position.copy(spark.userData.twigGlowOrigin).add(study.twigs.position);
  flame.position.copy(spark.position);
  study.layers.flames.add(flame); study.layers.sparks.add(spark);
  study.burnVisuals.twigSettling = createTwigSettling(study.twigs, study.layers);
  updateBurnVisuals(study, true);
  study.cycle.time = 300; study.animationTime = 1; updateBurnVisuals(study);
  study.animationTime = 2.5; updateBurnVisuals(study);
  const start = new THREE.Vector3(0, -.25, 0).applyMatrix4(main.matrixWorld), end = new THREE.Vector3(0, .25, 0).applyMatrix4(main.matrixWorld);
  const attached = start.clone().lerp(end, .6);
  assert.ok(Math.abs(start.y - end.y) < 1e-6, 'the twig rotates flat into the pit');
  assert.ok(end.y < floor() + .04, 'the tip lands against the dirt');
  assert.ok(flame.position.distanceTo(attached) < 1e-6); assert.ok(spark.position.distanceTo(attached) < 1e-6);
  assert.deepEqual(study.twigs.scale.toArray(), [1, 1, 1]);
});

test('stable fuel reuses depth and instance buffers while heat and flame uniforms keep updating', () => {
  const study = visualStudy();
  assert.equal(updateBurnVisuals(study, true), true);
  const view = study.burnVisuals;
  const buffers = [study.ashBed.geometry.attributes.position, study.coals.instanceMatrix, view.flakes.instanceMatrix,
    view.impactEmbers.geometry.attributes.position, view.impactEmbers.geometry.attributes.aSize];
  const versions = buffers.map(buffer => buffer.version);
  for (let frame = 1; frame <= 15; frame++) {
    study.animationTime = frame / 30;
    study.cycle.logs[0].temperature = .3 + frame * .02;
    study.cycle.logs[0].flame = .4 + frame * .01;
    study.cycle.updateSummary();
    assert.equal(updateBurnVisuals(study), false, 'changing shader heat does not change scene depth');
  }
  assert.deepEqual(buffers.map(buffer => buffer.version), versions);
  assert.equal(study.logMeshes[0].userData.burnUniforms.uHeat.value, .6);
  assert.ok(Math.abs(study.volumes[0].material.uniforms.uFuel.value[0] - .55) < 1e-6);
  assert.equal(view.flakes.visible, false);
  assert.equal(view.impactEmbers.visible, false);
});

test('shrinking coal and falling wood invalidate depth, while growing ash only changes ground shading', () => {
  const study = visualStudy(); updateBurnVisuals(study, true);
  study.cycle.coalMass = .1;
  assert.equal(updateBurnVisuals(study), true);
  const coalVersion = study.coals.instanceMatrix.version;
  assert.equal(updateBurnVisuals(study), false);
  assert.equal(study.coals.instanceMatrix.version, coalVersion);
  const ashState = study.ashBed.userData.ashState, initialAsh = ashState.amount;
  const groundVersion = study.ashBed.geometry.attributes.position.version;
  study.animationTime = .1; study.cycle.ashDeposits[0] = .5;
  assert.equal(updateBurnVisuals(study), false, 'new ash cover does not change scene depth');
  assert.ok(ashState.amount > initialAsh, 'persistent ash still visibly accumulates');
  study.animationTime = .2;
  assert.equal(updateBurnVisuals(study), false);
  assert.equal(study.ashBed.geometry.attributes.position.version, groundVersion);
  study.cycle.logs[0].phase = 'ash'; study.cycle.logs[0].wood = 0;
  study.animationTime += 1 / 30;
  assert.equal(updateBurnVisuals(study), true, 'removing a support changes depth immediately');
  const previousY = study.logMeshes[1].position.y;
  study.animationTime += 1 / 30;
  assert.equal(updateBurnVisuals(study), true, 'falling wood keeps depth current on every frame');
  assert.ok(study.logMeshes[1].position.y < previousY);
});

function simulate(state, cycle, seconds, height = floor, hz = 60, start = 0) {
  const events = [];
  for (let frame = 1; frame <= Math.round(seconds * hz); frame++) {
    updateLogSettling(state, cycle, start + frame / hz, height);
    events.push(...state.impacts);
  }
  return events;
}

function assertGroundClear(pose, height = floor) {
  for (const point of pose.worldPoints) assert.ok(point.y >= height(point.x, point.z) - .002,
    `${pose.fuelType} surface penetrates the soil at ${point.toArray()}`);
}

test('an older falling log can land on newer fuel after its former support disappears', () => {
  const cycle = { logs: [log(0), { ...log(1), addedAt: 20 }] }, state = createLogSettling(definitions, 7);
  updateLogSettling(state, cycle, 0, floor);
  Object.assign(state.logs[0], { y: 1.3, sleeping: false, inFlight: true, fallFrom: 1.3 });
  Object.assign(state.logs[1], { y: .006, sleeping: false, inFlight: false });
  simulate(state, cycle, 2);
  assert.ok(state.logs[0].supports.includes(1), 'contacts are symmetric rather than locked to arrival order');
  assert.ok(state.logs[0].y > state.logs[1].y + .38);
  state.logs.forEach(pose => assertGroundClear(pose));
});

test('off-center support creates a gravitational tipping torque and preserves the actual rolled orientation', () => {
  const defs = [[[ -.7, .2, -.7], [-.7, .2, .7], .2], definitions[0]];
  const cycle = { logs: [log(0), log(1)] }, state = createLogSettling(defs, 17);
  updateLogSettling(state, cycle, 0, floor);
  // Release a level log over the off-center support, rather than testing the
  // equilibrium orientation chosen for a prepared initial pile.
  state.logs[1].quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  state.logs[1].y = .412; state.logs[1].sleeping = false;
  const initialY = state.logs[1].y;
  simulate(state, cycle, 4);
  const upper = state.logs[1];
  assert.ok(upper.pitch < -.12, 'the unsupported end must tip down under gravity');
  assert.ok(upper.y < initialY - .1);
  assert.ok(Math.abs(upper.quaternion.length() - 1) < 1e-8);
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(upper.quaternion).distanceTo(upper.b.clone().sub(upper.a).normalize()) < 1e-8);
  state.logs.forEach(pose => assertGroundClear(pose));
});

test('an offset parallel log rolls outward off the pile instead of following an inward target', () => {
  const defs = [definitions[0], [[-1, .6, .22], [1, .6, .22], .2]];
  const cycle = { logs: [log(0), log(1)] }, state = createLogSettling(defs, 6);
  updateLogSettling(state, cycle, 0, floor);
  // Accumulate the turn frame by frame: a log that rolls a full revolution
  // would otherwise look unrotated to a shortest-angle comparison.
  let previous = state.logs[1].quaternion.clone(), rolled = 0;
  for (let frame = 1; frame <= 240; frame++) {
    updateLogSettling(state, cycle, frame / 60, floor);
    rolled += state.logs[1].quaternion.angleTo(previous); previous = state.logs[1].quaternion.clone();
  }
  const upper = state.logs[1];
  assert.ok(upper.z > .48, 'its center moves away from the pile center');
  assert.ok(Math.abs(upper.y - .011) < .015, 'it reaches the soil beside the supporting log');
  assert.ok(rolled > 1, 'rolling includes rotation about the wood axis');
  assert.deepEqual(upper.supports, []);
  state.logs.forEach(pose => assertGroundClear(pose));
});

test('terrain slope produces downhill rolling while a cold balanced pile stays perfectly asleep', () => {
  const slope = (x, z) => -.2 + z * .15;
  const cycle = { logs: [{ ...log(0), temperature: .03 }] }, state = createLogSettling([definitions[0]], 21);
  updateLogSettling(state, cycle, 0, slope);
  simulate(state, cycle, 4, slope);
  assert.ok(state.logs[0].z < -.6);
  assertGroundClear(state.logs[0], slope);
  const flat = createLogSettling(definitions, 21), cold = { logs: [0, 1].map(slot => ({ ...log(slot), temperature: .03 })) };
  updateLogSettling(flat, cold, 0, floor);
  const before = flat.logs.map(p => [...p.position.toArray(), ...p.quaternion.toArray()]);
  simulate(flat, cold, 4);
  assert.deepEqual(flat.logs.map(p => [...p.position.toArray(), ...p.quaternion.toArray()]), before);
  assert.ok(flat.logs.every(p => p.sleeping));
});

test('side collisions transfer momentum to both logs with no arrival-order stiffness', () => {
  const defs = [definitions[0], [[-1, .2, .45], [1, .2, .45], .2]];
  const cycle = { logs: [log(0), log(1)] }, state = createLogSettling(defs, 21);
  updateLogSettling(state, cycle, 0, floor);
  state.logs[0].linearVelocity.z = 2;
  simulate(state, cycle, 2);
  assert.ok(state.logs[1].z > .65, 'the struck body must move');
  assert.ok(state.logs[0].z > .1 && state.logs[0].z < state.logs[1].z - .38, 'both bodies remain separated');
  assert.ok(state.logs[0].linearVelocity.z < 1, 'contact and soil friction dissipate the incident energy');
});

test('fixed wall-clock substeps produce the same trajectories at 30 and 120 frames per second', () => {
  const run = hz => {
    const defs = [definitions[0], [[-1, .6, .22], [1, .6, .22], .2]];
    const cycle = { logs: [log(0), log(1)] }, state = createLogSettling(defs, 6);
    updateLogSettling(state, cycle, 0, floor); simulate(state, cycle, 3, floor, hz);
    return state.logs.map(p => [...p.position.toArray(), ...p.quaternion.toArray()]);
  };
  const a = run(30), b = run(120);
  a.forEach((values, index) => values.forEach((value, j) => assert.ok(Math.abs(value - b[index][j]) < 1e-8)));
});

test('fast thin kindling is caught by crossed wood without tunneling through it', () => {
  const cycle = { logs: [log(0), { ...log(1), fuelType: 'kindling', addedAt: 10 }] };
  const state = createLogSettling(definitions, 6);
  updateLogSettling(state, cycle, 0, floor);
  state.logs[1].linearVelocity.y = -25;
  const events = simulate(state, cycle, .8);
  assert.ok(state.logs[1].supports.includes(0));
  assert.ok(state.logs[1].y > state.logs[0].y + .2);
  assert.ok(events.some(event => event.slot === 1 && event.strength > .3));
  state.logs.forEach(pose => assertGroundClear(pose));
});

test('char fracture creates bounded physical fragments and debits their finite mass from the donor', () => {
  const cycle = { logs: [{ ...log(0), wood: .35, char: .22 }, { ...log(1), wood: .4, char: .18 }] };
  const state = createLogSettling(definitions, 42);
  updateLogSettling(state, cycle, 0, floor);
  const initialMass = cycle.logs.reduce((sum, fuel) => sum + fuel.wood + fuel.char * 1.4, 0);
  const events = simulate(state, cycle, 25);
  assert.ok(state.fragments.length > 0 && state.fragments.length <= 12);
  const mass = cycle.logs.reduce((sum, fuel) => sum + fuel.wood + fuel.char * 1.4, 0)
    + state.fragments.reduce((sum, fragment) => sum + fragment.mass, 0) + (state.fragmentAsh + state.fragmentCoal) * 1.4;
  assert.ok(Math.abs(mass - initialMass) < 1e-8, 'shell debris does not duplicate fuel mass');
  assert.ok(events.some(event => event.kind === 'crumble'));
  for (const fragment of state.fragments) {
    assert.ok(fragment.radius > 0 && fragment.length > 0);
    assert.ok(Math.abs(fragment.quaternion.length() - 1) < 1e-8);
    assertGroundClear(fragment);
  }
  assert.ok(state.logs.some(pose => pose.fracture?.severity > 0 && pose.fracture.severity <= .6));
});

test('fragment heat and finite char follow accelerated burn time and transfer completely to ash', () => {
  const cycle = { logs: [{ ...log(0), wood: .3, char: .24 }], time: 0, coalHeat: 0, ashMass: 0, coalMass: 0 };
  const state = createLogSettling([definitions[0]], 42);
  updateLogSettling(state, cycle, 0, floor);
  simulate(state, cycle, 20);
  assert.ok(state.fragments.length > 0);
  const remaining = state.fragments.reduce((sum, fragment) => sum + fragment.remainingChar, 0);
  const heat = state.fragments[0].heat;
  updateLogSettling(state, cycle, 20.1, floor);
  assert.equal(state.fragments[0].heat, heat, 'holding the burn clock does not thermally age moving debris');
  assert.equal(cycle.fragmentChar, remaining);
  // Fast playback ages combustion without accelerating gravity or allowing a
  // detached ember to outlive a completed fire by ninety real-world seconds.
  cycle.time = 1200;
  updateLogSettling(state, cycle, 20.2, floor);
  assert.equal(state.fragments.length, 0);
  assert.equal(cycle.fragmentChar, 0); assert.equal(cycle.fragmentHeat, 0);
  assert.ok(Math.abs(cycle.ashMass - remaining) < 1e-10, 'retired char becomes counted ash once');
  updateLogSettling(state, cycle, 20.2, floor);
  assert.ok(Math.abs(cycle.ashMass - remaining) < 1e-10, 'a paused redraw cannot duplicate residue');
});

test('settling and shell collisions dissipate energy without an explosive angular response', () => {
  const defs = [definitions[0], [[-1, .6, .22], [1, .6, .22], .2]];
  const cycle = { logs: [{ ...log(0), wood: .25, char: .25 }, { ...log(1), wood: .3, char: .2 }] };
  const state = createLogSettling(defs, 42);
  updateLogSettling(state, cycle, 0, floor);
  for (let frame = 1; frame <= 1500; frame++) {
    updateLogSettling(state, cycle, frame / 60, floor);
    for (const pose of [...state.logs, ...state.fragments]) {
      assert.ok(pose.position.toArray().every(Number.isFinite));
      assert.ok(pose.linearVelocity.length() < 8, 'a sub-meter fall must not create an unbounded launch');
      assert.ok(pose.angularVelocity.length() < 40, 'small shell contacts must not explode angular energy');
    }
  }
  assert.ok(state.fragments.length > 0);
});
