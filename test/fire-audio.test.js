import test from 'node:test';
import assert from 'node:assert/strict';
import { FireAudio } from '../src/fire-audio.js';

class FakeParam {
  constructor() { this.value = 0; this.targets = []; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; this.targets.push(value); }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}
class FakeNode {
  constructor() {
    for (const name of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new FakeParam();
    this.stops = 0; this.disconnected = false;
  }
  connect(target) { return target; }
  disconnect() { this.disconnected = true; }
  start() {}
  stop() { this.stops++; }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.sampleRate = 1000; this.state = 'suspended'; this.destination = new FakeNode(); this.sources = []; }
  createGain() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createOscillator() { return this.createBufferSource(); }
  createBufferSource() { const source = new FakeNode(); this.sources.push(source); return source; }
  createBuffer(channels, length, rate) { const data = new Float32Array(length); return { duration: length / rate, getChannelData: () => data }; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}
const makeStudy = () => ({ config: { animated: true }, animationTime: 1, cycle: { seed: 8, flame: 2, coalHeat: .7 }, burnVisuals: { resetToken: '8:0', impactEvents: [] } });
const impact = (study, id, strength = .6, time = study.animationTime) => study.burnVisuals.impactEvents.push({ id, strength, time, position: { x: 1 } });
async function enabledFire() {
  const context = new FakeContext(), study = makeStudy();
  const audio = new FireAudio({ contextFactory: () => context, random: () => .5 });
  audio.update(study, true);
  await audio.setEnabled(true);
  audio._nextCrackle = Infinity;
  return { audio, context, study };
}

test('audio creates no context before explicit enable and clamps volume', () => {
  let created = 0;
  const audio = new FireAudio({ contextFactory: () => { created++; return new FakeContext(); } });
  audio.update(makeStudy(), true);
  assert.equal(audio.enabled, false); assert.equal(created, 0);
  audio.setVolume(5); assert.equal(audio.volume, 1);
  audio.setVolume(-2); assert.equal(audio.volume, 0);
  audio.dispose(); assert.equal(created, 0);
});

test('new impacts play once; switching, reset, pause, and mute never replay old impacts', async () => {
  const { audio, context, study } = await enabledFire();
  const played = [];
  audio._playCrackle = (...event) => { if (event[1]) played.push(event); };
  try {
    impact(study, 1); audio.update(study, true); audio.update(study, true);
    assert.equal(played.length, 1); assert.equal(played[0][1], true);
    audio.update(study, false);
    impact(study, 2); context.currentTime += 1; audio.update(study, true);
    assert.equal(played.length, 1, 'resume consumes queued contacts silently');
    impact(study, 3); audio.update(study, true); assert.equal(played.length, 2);
    await audio.setEnabled(false);
    impact(study, 4); context.currentTime += 1; await audio.setEnabled(true);
    assert.equal(played.length, 2, 'unmute consumes previous contacts');
    const nextStudy = makeStudy(); impact(nextStudy, 20);
    audio.update(nextStudy, true); assert.equal(played.length, 2);
    nextStudy.burnVisuals.resetToken = '8:1';
    impact(nextStudy, 21); audio.update(nextStudy, true); assert.equal(played.length, 2);
    impact(nextStudy, 22); audio.update(nextStudy, true); assert.equal(played.length, 3);
    context.currentTime += 1;
    impact(nextStudy, 23, .6, nextStudy.animationTime - 3);
    audio.update(nextStudy, true); assert.equal(played.length, 3, 'stale impacts are discarded');
  } finally { audio.dispose(); }
});

test('same-frame impacts form one sound and sound timing ignores accelerated burn time', async () => {
  const { audio, context, study } = await enabledFire();
  const played = []; audio._playCrackle = (...event) => played.push(event);
  try {
    impact(study, 1, .2); impact(study, 2, .8);
    audio.update(study, true);
    assert.equal(played.length, 1); assert.equal(played[0][0], .88);
    audio._nextCrackle = 1;
    study.cycle.time = 9000; study.animationTime += .033;
    audio.update(study, true);
    assert.equal(played.length, 1, 'burn-clock jumps do not generate ambient sounds');
    context.currentTime = 1.1;
    audio.update(study, true);
    assert.equal(played.length, 2); assert.equal(played[1][1], false);
  } finally { audio.dispose(); }
});

test('paused, static, hidden, and cold scenes silence the bed and transient voices', async () => {
  const { audio, study } = await enabledFire();
  const originalDocument = globalThis.document;
  try {
    for (const change of [
      () => ({ running: false }),
      () => { study.config.animated = false; return { running: true }; },
      () => { globalThis.document = { hidden: true }; return { running: true }; },
      () => { study.cycle.flame = 0; study.cycle.coalHeat = .01; return { running: true }; },
    ]) {
      study.config.animated = true; study.cycle.flame = 2; study.cycle.coalHeat = .7; globalThis.document = { hidden: false };
      audio.update(study, true); audio._playCrackle(.8, true, 0);
      assert.equal(audio.voices.size, 1);
      const { running } = change(); audio.update(study, running);
      assert.equal(audio._active, false); assert.equal(audio.voices.size, 0); assert.equal(audio.master.gain.value, 0);
    }
  } finally { globalThis.document = originalDocument; audio.dispose(); }
});

test('transient voices are bounded and audio disposal releases sources and context', async () => {
  const { audio, context } = await enabledFire();
  for (let i = 0; i < 25; i++) audio._playCrackle(.8, true, 0);
  assert.equal(audio.voices.size, 10);
  const bedSources = [audio.bodySource, audio.hissSource];
  audio.dispose();
  assert.equal(audio.voices.size, 0); assert.equal(context.state, 'closed');
  assert.ok(bedSources.every(source => source.stops > 0 && source.disconnected));
  assert.ok(context.sources.every(source => source.disconnected));
});
