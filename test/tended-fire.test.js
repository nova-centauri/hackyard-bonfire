import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BurnCycle } from '../src/lifecycle.js';
import { createLogSettling, updateLogSettling } from '../src/log-settling.js';
import { createSceneFuelMesh, disposeFuelMesh } from '../src/fuel-mesh.js';
import { groundHeight } from '../src/ground.js';
import { addStoneRing } from '../src/rocks.js';

// The viewer feeds the settled wood positions back into the burn clock every
// frame (BonfireViewer.tick -> updateBurnVisuals -> cycle.setLogPoses). The
// standalone lifecycle tests never see those poses, so this mirrors the loop:
// the burn clock advances by frame time times speed, settling runs in real
// time, and the poses it produces shape where the fire's heat reaches.
const logDefs = [
  [[-1.45, .27, .8], [1.3, .43, -.6], .25], [[1.28, .31, 1.08], [-1.22, .42, -.72], .28], [[-.85, .32, 1.4], [.62, .66, -1.15], .23],
  [[-1.22, .43, -.96], [.1, 1.37, .1], .25], [[1.3, .45, -.8], [-.22, 1.4, .3], .24], [[-1.16, .56, .5], [.92, 1.03, -.17], .23], [[.85, .52, .95], [-.22, 1.62, -.12], .22],
];
const materials = { barkMat: new THREE.MeshStandardMaterial(), endMat: new THREE.MeshStandardMaterial(), exposedMat: new THREE.MeshStandardMaterial() };

function runViewerLoop({ speed, fps = 60, burnSeconds, seed = 8108 }) {
  const cycle = new BurnCycle(seed);
  const stones = addStoneRing(new THREE.Group(), { seed: 22, mode: 2, hybrid: true });
  const meshes = [], keys = [];
  const sync = () => {
    for (const fuel of cycle.logs) {
      const key = `${fuel.id}:${fuel.fuelType}`;
      if (keys[fuel.slot] === key) continue;
      if (meshes[fuel.slot]) disposeFuelMesh(meshes[fuel.slot]);
      meshes[fuel.slot] = createSceneFuelMesh({ definition: logDefs[fuel.slot], fuelType: fuel.fuelType, seed: cycle.seed + fuel.id * 7919, mode: 2, hybrid: true }, materials);
      keys[fuel.slot] = key;
    }
  };
  sync();
  const settling = createLogSettling(logDefs, cycle.seed, meshes.map(m => m.geometry.userData.profile), stones.userData.colliders);
  const stats = { frames: 0, flameFrames: 0, minHeat: 1, maxHeight: -Infinity, maxWaiting: 0, maxPieces: 0, cold: false, added: 0 };
  const frame = () => {
    sync(); settling.profiles = meshes.map(m => m.geometry.userData.profile);
    updateLogSettling(settling, cycle, stats.frames / fps, groundHeight);
    cycle.setLogPoses(settling.logs);
  };
  frame();
  const serial = cycle.serial;
  while (cycle.time < burnSeconds) {
    cycle.advance(speed / fps); stats.frames++; frame();
    stats.minHeat = Math.min(stats.minHeat, cycle.coalHeat);
    if (cycle.flame > .08) stats.flameFrames++;
    if (cycle.phase === 'Cold fire bed') stats.cold = true;
    stats.maxWaiting = Math.max(stats.maxWaiting, cycle.waitingPieces);
    stats.maxPieces = Math.max(stats.maxPieces, cycle.logs.filter(l => l.phase !== 'queued' && l.phase !== 'ash').length);
    for (const pose of settling.logs) if (pose.live) stats.maxHeight = Math.max(stats.maxHeight, pose.position.y);
  }
  stats.added = cycle.serial - serial; stats.flameDuty = stats.flameFrames / stats.frames;
  meshes.forEach(disposeFuelMesh);
  return { cycle, settling, stats };
}

test('the tended fire keeps burning in the viewer loop at 1200×: wood that lands badly does not starve it and arrivals never stack into the sky', () => {
  const { stats } = runViewerLoop({ speed: 1200, burnSeconds: 75 * 60 });
  assert.equal(stats.cold, false, 'the fire never goes out');
  assert.ok(stats.minHeat > .4, `the bed stays hot enough to light fresh wood (min ${stats.minHeat.toFixed(2)})`);
  assert.ok(stats.flameDuty > .8, `flames are present most of the time (${(stats.flameDuty * 100).toFixed(0)}%)`);
  assert.ok(stats.maxHeight < 3, `every piece is dropped onto the settled pile (highest ${stats.maxHeight.toFixed(2)} m)`);
  assert.ok(stats.maxWaiting <= 2 && stats.maxPieces <= 5, `the bed is never piled high (${stats.maxPieces} pieces, ${stats.maxWaiting} waiting)`);
  assert.ok(stats.added >= 12, `a modest fire keeps eating wood (${stats.added} pieces in 75 minutes)`);
});
