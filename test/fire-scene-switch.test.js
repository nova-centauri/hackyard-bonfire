import test from 'node:test';
import assert from 'node:assert/strict';
import { BonfireViewer } from '../src/scene.js';
import { FIRE_SCENES, createSceneCycle } from '../src/fire-scenes.js';

test('every scene transition discards every cached study before starting a fresh fire, even while paused', () => {
  for (const from of FIRE_SCENES) for (const to of FIRE_SCENES) {
    if (from === to) continue;
    const oldFire = createSceneCycle(from.id, 45), otherStyleFire = createSceneCycle(from.id, 76);
    oldFire.advance(1200); oldFire.coalMass = 123; oldFire.fragmentChar = 456;
    const oldStudy = { cycle: oldFire }, otherStudy = { cycle: otherStyleFire }, disposed = [];
    const viewer = {
      sceneId: from.id, fireSeed: 45, config: { id: 'wild-draft' },
      current: oldStudy, scenes: new Map([['wild-draft', oldStudy], ['living-contours', otherStudy]]),
      paused: true, speed: 30, autoFeed: false,
      disposeStudy(study) { disposed.push(study); },
      load(config) {
        assert.equal(this.current, null, 'no old current scene survives into construction');
        assert.equal(this.scenes.size, 0, 'no cached rendering style can resurrect the previous pile');
        const cycle = createSceneCycle(this.sceneId, this.fireSeed);
        cycle.setAutoFeed(this.autoFeed);
        this.current = { cycle }; this.scenes.set(config.id, this.current);
      },
    };
    assert.equal(BonfireViewer.prototype.setScene.call(viewer, to.id), true);
    assert.deepEqual(disposed, [oldStudy, otherStudy]);
    const fresh = viewer.current.cycle;
    assert.notEqual(fresh, oldFire); assert.notEqual(fresh.logs, oldFire.logs);
    assert.equal(fresh.time, 0); assert.equal(fresh.remainder, 0);
    assert.equal(fresh.fragmentChar, 0); assert.equal(fresh.fragmentHeat, 0);
    assert.ok(fresh.coalMass < 1); assert.ok(fresh.ashMass < 1);
    assert.ok(fresh.ashDeposits.every(value => value === 0));
    assert.equal(fresh.logPoses.length, 0); assert.equal(fresh.logs.length, to.maxPieces);
    assert.equal(viewer.paused, true); assert.equal(viewer.speed, 30); assert.equal(fresh.autoFeed, false);
  }
});

test('selecting the current scene or an unknown scene does not discard the current fire', () => {
  const viewer = { sceneId: 'pit' };
  assert.equal(BonfireViewer.prototype.setScene.call(viewer, 'pit'), false);
  assert.equal(BonfireViewer.prototype.setScene.call(viewer, 'unknown'), false);
});
