import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_SCENES, getFireScene } from '../src/fire-scenes.js';
import { studies } from '../src/styles.js';
import {
  PIT_FULL, MAX_POLAR_ANGLE, INDOOR_AZIMUTH, roomEnvelope, orbitLimits, polarLimits,
  sphericalFrom, applySpherical, fitLook, lookInsideRoom,
} from '../src/camera-rig.js';

const vec = (x, y, z) => ({ x, y, z });
const fromArray = ([x, y, z]) => vec(x, y, z);
const oldPit = { camera: [6.7, 4.3, 8.2], target: [0, 1.95, 0] };

test('living pit studies share a modest higher default with the flame more centered', () => {
  const offset = sphericalFrom(fromArray(PIT_FULL.camera), fromArray(PIT_FULL.target));
  const previous = sphericalFrom(fromArray(oldPit.camera), fromArray(oldPit.target));
  assert.ok(PIT_FULL.target[1] > oldPit.target[1], 'look is raised toward the flame');
  assert.ok(PIT_FULL.target[1] - oldPit.target[1] < .35, 'look raise stays a small pan');
  assert.ok(PIT_FULL.camera[1] > oldPit.camera[1], 'camera sits a bit higher');
  assert.ok(PIT_FULL.camera[1] - oldPit.camera[1] < 1.4, 'orbit up is a small drag, not a new angle');
  assert.ok(previous.phi - offset.phi > .05 && previous.phi - offset.phi < .14, 'more downward by a few degrees');
  assert.ok(Math.abs(offset.theta - previous.theta) < .03, 'azimuth is unchanged');
  assert.ok(Math.abs(offset.radius - previous.radius) < .2);
  for (const study of studies.filter(study => study.mode === 5)) {
    assert.deepEqual(study.camera, [...PIT_FULL.camera]);
    assert.deepEqual(study.target, [...PIT_FULL.target]);
  }
});

test('home default framing still fits the clamps, including a portrait dolly-out', () => {
  const home = getFireScene('home'), limits = orbitLimits(home);
  const target = fromArray(home.target), position = fromArray(home.camera);
  const before = { ...position }, look = sphericalFrom(position, target);
  fitLook(position, target, limits);
  assert.deepEqual(position, before, 'Astra’s home camera is not moved');
  assert.equal(target.y, home.target[1]);
  assert.ok(look.phi > polarLimits(look.radius, limits, target.y).minPolarAngle);
  assert.ok(look.phi < limits.maxPolarAngle);
  assert.ok(Math.abs(look.theta) < INDOOR_AZIMUTH);
  assert.ok(lookInsideRoom(position, limits));

  const portrait = fromArray(home.camera);
  portrait.z = 15.4;
  const portraitTarget = fromArray(home.target);
  const unclampedZ = portrait.z;
  fitLook(portrait, portraitTarget, limits);
  assert.ok(Math.abs(portrait.z - unclampedZ) < .05, 'portrait distance is not pulled in');
  assert.ok(lookInsideRoom(portrait, limits));
});

test('indoor orbit cannot pass the ceiling or the floor at any allowed radius', () => {
  const home = getFireScene('home'), limits = orbitLimits(home);
  assert.equal(roomEnvelope(home).floorY, -.71);
  const target = fromArray(home.target);
  for (const radius of [limits.minDistance, 7.9, 12, 16]) {
    const polar = polarLimits(radius, limits, target.y);
    for (const phi of [polar.minPolarAngle, (polar.minPolarAngle + polar.maxPolarAngle) / 2, polar.maxPolarAngle]) {
      for (const theta of [-INDOOR_AZIMUTH, 0, INDOOR_AZIMUTH]) {
        const position = applySpherical(vec(0, 0, 0), target, { radius, phi, theta });
        fitLook(position, { ...target }, limits);
        assert.ok(lookInsideRoom(position, limits), `y=${position.y} at r=${radius} phi=${phi}`);
        assert.ok(position.y > roomEnvelope(home).floorY + .5, 'stays above the room floor');
      }
    }
  }
});

test('a look that would go over the mantel is pulled back under the ceiling', () => {
  const home = getFireScene('home'), limits = orbitLimits(home);
  const overhead = fitLook(vec(0, 8, 7.8), fromArray(home.target), limits);
  assert.ok(overhead.y <= limits.maxY + 1e-6);
  assert.ok(overhead.y < 4, 'cannot climb out of the room');
});

test('outdoor ground clamp keeps a panned look above the dirt', () => {
  const limits = orbitLimits(getFireScene('pit'));
  assert.equal(limits.maxPolarAngle, MAX_POLAR_ANGLE);
  assert.equal(limits.minPolarAngle, 0);
  assert.equal(limits.enablePan, true);
  const target = vec(0, -2, 0), position = vec(6.5, -1, 8);
  fitLook(position, target, limits);
  assert.ok(target.y >= limits.targetMinY);
  assert.ok(position.y >= limits.minY - 1e-6);
  const defaultLook = sphericalFrom(fromArray(PIT_FULL.camera), fromArray(PIT_FULL.target));
  const polar = polarLimits(defaultLook.radius, limits, PIT_FULL.target[1]);
  assert.ok(defaultLook.phi > polar.minPolarAngle && defaultLook.phi < polar.maxPolarAngle);
});

test('only pit and home exist; indoor limits do not rewrite scene catalogs', () => {
  assert.deepEqual(FIRE_SCENES.map(scene => scene.id), ['pit', 'home']);
  const home = getFireScene('home');
  assert.deepEqual(home.camera, [1.0, 1.65, 7.8]);
  assert.deepEqual(home.target, [0, .95, 0]);
});
