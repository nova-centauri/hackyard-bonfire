import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';

const slope = (x, z) => -.2 + z * .05;
function fixture(offset = 0) {
  const definitions = [
    [[-1, .2, 0], [1, .2, 0], .2],
    [[-1, .6, .22], [1, .6, .22], .2],
    [[0, .9, -1], [0, .9, 1], .2],
  ];
  for (const [a, b] of definitions) { a[0] += offset; b[0] += offset; }
  const cycle = { logs: definitions.map((_, slot) => ({ slot, id: slot + 1, wood: 1, char: 0,
    scale: 1, angle: 0, offset: 0, phase: 'burning', addedAt: slot === 2 ? 0 : -1, temperature: .03 })) };
  const state = createLogSettling(definitions, 42);
  updateLogSettling(state, cycle, 0, slope);
  return { state, cycle };
}
const advance = ({ state, cycle }, frame) => updateLogSettling(state, cycle, frame / 60, slope);
const snapshot = ({ state }) => state.logs.map(pose => [
  ...pose.position.toArray(), ...pose.quaternion.toArray(),
  ...pose.linearVelocity.toArray(), ...pose.angularVelocity.toArray(),
]);

test('falling and rolling contacts reuse storage without sharing state between simulations', t => {
  let vectors = 0, quaternions = 0;
  const vectorClone = THREE.Vector3.prototype.clone, quaternionClone = THREE.Quaternion.prototype.clone;
  t.mock.method(THREE.Vector3.prototype, 'clone', function() { vectors++; return vectorClone.call(this); });
  t.mock.method(THREE.Quaternion.prototype, 'clone', function() { quaternions++; return quaternionClone.call(this); });
  const isolated = fixture();
  let impacts = 0;
  const trajectory = [];
  for (let frame = 1; frame <= 120; frame++) {
    advance(isolated, frame); impacts += isolated.state.impacts.length;
    trajectory.push(snapshot(isolated));
  }
  assert.ok(impacts > 0, 'the fixture includes a landing as well as rolling contacts');
  assert.ok(trajectory.flat(2).every(Number.isFinite), 'poses and velocities stay finite');
  // Formerly 546,876 vector clones and 160,964 quaternion clones for this
  // two-second landing. Leave headroom for platform-dependent contact paths.
  assert.ok(vectors < 110000, `${vectors} vector clones stay below the allocation budget`);
  assert.equal(quaternions, 0, 'inverse inertia reuses its temporary rotation');
  t.mock.restoreAll();

  // Floating-point contact trajectories vary between platforms: a golden pose
  // recorded on macOS is not a portable Linux oracle. Compare within this
  // runtime instead. Interleaving a second independent pile also detects any
  // solver scratch vector accidentally retained in persistent body state.
  const interleaved = fixture(), other = fixture(3);
  for (let frame = 1; frame <= 120; frame++) {
    advance(other, frame); advance(interleaved, frame);
    assert.deepEqual(snapshot(interleaved), trajectory[frame - 1], `independent contact state at frame ${frame}`);
  }
});
