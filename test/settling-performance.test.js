import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';

test('falling and rolling contacts reuse solver storage without changing their trajectory', t => {
  const definitions = [
    [[-1, .2, 0], [1, .2, 0], .2],
    [[-1, .6, .22], [1, .6, .22], .2],
    [[0, .9, -1], [0, .9, 1], .2],
  ];
  const cycle = { logs: definitions.map((_, slot) => ({ slot, id: slot + 1, wood: 1, char: 0,
    scale: 1, angle: 0, offset: 0, phase: 'burning', addedAt: slot === 2 ? 0 : -1, temperature: .03 })) };
  const state = createLogSettling(definitions, 42), slope = (x, z) => -.2 + z * .05;
  let vectors = 0, quaternions = 0;
  const vectorClone = THREE.Vector3.prototype.clone, quaternionClone = THREE.Quaternion.prototype.clone;
  t.mock.method(THREE.Vector3.prototype, 'clone', function() { vectors++; return vectorClone.call(this); });
  t.mock.method(THREE.Quaternion.prototype, 'clone', function() { quaternions++; return quaternionClone.call(this); });
  updateLogSettling(state, cycle, 0, slope);
  let impacts = 0;
  for (let frame = 1; frame <= 120; frame++) {
    updateLogSettling(state, cycle, frame / 60, slope);
    impacts += state.impacts.length;
  }
  assert.ok(impacts > 0, 'the fixture includes a landing as well as rolling contacts');
  // Captured before reusing scratch storage. Compare the actual pose rather
  // than timing execution, which varies with parallel tests and host load.
  const expected = [
    [-.000016555741562411453, -.001109808866217969, -.01223612541179948, -.009537182302485729, -.009546080114076934, -.7070259961028565, .7070588061419987],
    [-.00006216811553253851, .034408332266709266, .6949635148773767, .6983321280644923, .698362283718699, -.11094709752536935, .11096441385785426],
    [.000129813672287561, .4243738047184004, .49822348265730404, .6889100805579669, -.0006520700805405945, .00015690291020410523, .7248465017448193],
  ];
  state.logs.forEach((pose, slot) => {
    const actual = [...pose.position.toArray(), ...pose.quaternion.toArray()];
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[slot][index]) < 1e-10,
      `log ${slot} pose component ${index} preserves the original contact response`));
  });
  // Formerly 546,876 vector clones and 160,964 quaternion clones for this
  // two-second landing. Keep headroom for contact changes without accepting
  // a return to allocating temporaries inside all twelve solver iterations.
  assert.ok(vectors < 110000, `${vectors} vector clones stay below the allocation budget`);
  assert.equal(quaternions, 0, 'inverse inertia reuses its temporary rotation');
});
