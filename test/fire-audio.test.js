import test from 'node:test';
import assert from 'node:assert/strict';
import { FireAudio } from '../src/fire-audio.js';

class FakeParam {
  constructor() { this.value = 0; this.targets = []; this.events = []; }
  cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); }
  cancelAndHoldAtTime(time) { this.events.push({ type: 'hold', time }); }
  setTargetAtTime(value, time, constant) { this.value = value; this.targets.push(value); this.events.push({ type: 'target', value, time, constant }); }
  setValueAtTime(value, time) { this.value = value; this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push({ type: 'linear', value, time }); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push({ type: 'exponential', value, time }); }
}
class FakeNode {
  constructor() {
    for (const name of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new FakeParam();
    this.stops = 0; this.disconnected = false; this.connections = []; this.starts = []; this.stopTimes = [];
  }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.disconnected = true; }
  start(...args) { this.starts.push(args); }
  stop(time) { this.stops++; this.stopTimes.push(time); }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.sampleRate = 1000; this.state = 'suspended'; this.destination = new FakeNode(); this.sources = []; }
  createGain() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createOscillator() { throw new Error('Wood sounds should not use a pitched oscillator.'); }
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
  const audio = new FireAudio({ contextFactory: () => context, random: () => .5, sampleLoader: null });
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

test('recording loads only after enable, fades overlapping passages, and preserves the audio clock', async () => {
  const context = new FakeContext(), study = makeStudy(), recording = context.createBuffer(2, 39560, 1000);
  let loads = 0;
  const audio = new FireAudio({ contextFactory: () => context, random: () => .5, sampleLoader: async () => { loads++; return recording; } });
  try {
    audio.update(study, true);
    assert.equal(loads, 0);
    await audio.setEnabled(true); await audio._recordingLoad;
    assert.equal(loads, 1); assert.equal(audio.recordingStatus, 'ready');
    assert.equal(audio.body.gain.value, 0); assert.equal(audio.hiss.gain.value, 0);
    const first = context.sources.find(source => source.buffer === recording);
    assert.ok(first); assert.equal(first.loop, undefined, 'long passages crossfade rather than hard-loop');
    const [start, offset, duration] = first.starts[0];
    const envelope = first.connections[0].gain.events;
    assert.ok(envelope[0].value < .001); assert.ok(envelope.at(-1).value < .001);
    assert.equal(envelope[1].type, 'exponential');
    assert.ok(Math.abs(envelope[1].time - start - 4.5) < 1e-8, 'recording fades in over several seconds');
    assert.ok(duration >= 12 && duration <= 19);
    study.cycle.time = 50000; study.animationTime += .033; audio.update(study, true);
    assert.equal(audio.recordingVoices.size, 1, 'burn acceleration does not schedule extra passages');
    context.currentTime = audio._nextBed - .1; audio.update(study, true);
    const second = context.sources.filter(source => source.buffer === recording)[1];
    assert.equal(second.starts[0][0], start + duration - 4.5);
    assert.notEqual(second.starts[0][1], offset, 'adjacent passages avoid repeating the same source offset');
    assert.equal(audio.recordingVoices.size, 2);
    first.onended(); assert.equal(audio.recordingVoices.size, 1); assert.equal(first.disconnected, true);
    await audio.setEnabled(false); assert.equal(audio.recordingVoices.size, 0);
    assert.equal(second.disconnected, false, 'recording remains connected for its short release');
    second.onended(); assert.equal(second.disconnected, true);
    await audio.setEnabled(true); await audio._recordingLoad;
    assert.equal(loads, 1, 'reenabling reuses the decoded recording');
  } finally { audio.dispose(); }
  assert.ok(context.sources.every(source => source.disconnected));
});

test('a failed recording load keeps a quiet functional fallback without retrying every frame', async () => {
  const context = new FakeContext(), study = makeStudy();
  let loads = 0;
  const audio = new FireAudio({ contextFactory: () => context, sampleLoader: async () => { loads++; throw new Error('offline'); } });
  try {
    audio.update(study, true); await audio.setEnabled(true); await audio._recordingLoad;
    for (let i = 0; i < 30; i++) audio.update(study, true);
    assert.equal(audio.enabled, true); assert.equal(audio._active, true);
    assert.equal(audio.recordingStatus, 'fallback'); assert.equal(loads, 1);
    assert.equal(audio.recordingVoices.size, 0);
    assert.ok(audio.body.gain.value > 0 && audio.body.gain.value < .055);
    assert.ok(audio.hiss.gain.value > 0 && audio.hiss.gain.value < .004);
    audio._playCrackle(.2, false, 0); assert.equal(audio.voices.size, 1);
  } finally { audio.dispose(); }
});

test('mute and dispose during decoding cannot start a late recording', async () => {
  for (const dispose of [false, true]) {
    const context = new FakeContext(), study = makeStudy();
    let resolve, signal;
    const audio = new FireAudio({ contextFactory: () => context, sampleLoader: (_context, abortSignal) => {
      signal = abortSignal; return new Promise(done => { resolve = done; });
    } });
    try {
      audio.update(study, true); await audio.setEnabled(true);
      if (dispose) audio.dispose(); else await audio.setEnabled(false);
      resolve(context.createBuffer(2, 39000, 1000)); await audio._recordingLoad;
      assert.equal(audio._active, false); assert.equal(audio.recordingVoices.size, 0);
      assert.equal(context.sources.length, 2, 'only the original fallback sources exist');
      if (dispose) assert.equal(signal.aborted, true);
      else {
        assert.equal(audio.recordingStatus, 'ready');
        await audio.setEnabled(true); assert.equal(audio.recordingVoices.size, 1);
      }
    } finally { audio.dispose(); }
  }
});

test('sluffs are soft, longer, low-passed wood scrapes, distinct from small dry cracks', async () => {
  const { audio, context } = await enabledFire();
  try {
    audio._playCrackle(1, true, 10);
    const scrape = context.sources[2], thud = context.sources[3];
    const band = scrape.connections[0], softness = band.connections[0], envelope = softness.connections[0].gain.events;
    assert.equal(softness.type, 'lowpass'); assert.equal(softness.frequency.value, 1200);
    assert.ok(envelope.find(event => event.type === 'linear').time >= .03, 'sluff has a rounded onset');
    assert.ok(Math.max(...envelope.map(event => event.value || 0)) <= .23);
    assert.ok(scrape.stopTimes[0] >= .5);
    assert.equal(thud.buffer, audio.brownNoise, 'muffled weight comes from filtered noise rather than a bass-drop oscillator');
    audio._playCrackle(.2, false, 0);
    const crack = context.sources[4], crackSoftness = crack.connections[0].connections[0];
    assert.equal(crackSoftness.frequency.value, 4300);
    assert.ok(crack.stopTimes[0] < .1, 'crack is a brief transient');
    assert.ok(Math.max(...crackSoftness.connections[0].gain.events.map(event => event.value || 0)) < .03);
    audio.setVolume(0); const count = context.sources.length;
    audio._playCrackle(1, true, 0); assert.equal(context.sources.length, count);
  } finally { audio.dispose(); }
});

test('rolling contacts are grouped over real time, with no catch-up burst after a long frame', async () => {
  const { audio, context, study } = await enabledFire();
  const played = []; audio._playCrackle = (...args) => played.push(args);
  try {
    impact(study, 1); audio.update(study, true);
    context.currentTime = .1; impact(study, 2); audio.update(study, true);
    context.currentTime = .25; impact(study, 3); audio.update(study, true);
    assert.equal(played.length, 1, 'a continuing roll produces one settling texture');
    context.currentTime = .4; impact(study, 4); audio.update(study, true);
    assert.equal(played.length, 2);
    audio._nextCrackle = .8; context.currentTime = 100; audio.update(study, true);
    assert.equal(played.length, 3); assert.ok(audio._nextCrackle > 100);
  } finally { audio.dispose(); }
});

test('silencing releases recording and sluff envelopes before cleanup, even through rapid resume', async () => {
  const context = new FakeContext(), study = makeStudy(), recording = context.createBuffer(2, 39000, 1000);
  const audio = new FireAudio({ contextFactory: () => context, sampleLoader: async () => recording });
  try {
    audio.update(study, true); await audio.setEnabled(true); await audio._recordingLoad;
    context.currentTime = 4;
    audio._playCrackle(.8, true, 0);
    const oldRecording = context.sources.find(source => source.buffer === recording);
    const scrape = context.sources.at(-2);
    const oldEnvelope = oldRecording.connections[0].gain;
    const scrapeEnvelope = scrape.connections[0].connections[0].connections[0].gain;
    await audio.setEnabled(false);
    assert.deepEqual(oldEnvelope.events.at(-2), { type: 'hold', time: 4 });
    assert.deepEqual(oldEnvelope.events.at(-1), { type: 'linear', value: 0, time: 5.05 }, 'the whoosh bed releases over a second');
    assert.deepEqual(scrapeEnvelope.events.at(-2), { type: 'hold', time: 4 });
    assert.deepEqual(scrapeEnvelope.events.at(-1), { type: 'linear', value: 0, time: 4.045 }, 'a sluff still dies quickly');
    assert.equal(oldRecording.disconnected, false); assert.equal(scrape.disconnected, false);
    assert.ok(oldRecording.stopTimes.at(-1) > context.currentTime);
    assert.equal(audio.voices.size, 0); assert.equal(audio.recordingVoices.size, 0);
    const releasedEvents = oldEnvelope.events.length;
    await audio.setEnabled(true);
    assert.equal(audio.recordingVoices.size, 1);
    assert.equal(oldEnvelope.events.length, releasedEvents, 'resume cannot cancel an old voice release');
    oldRecording.onended(); scrape.onended();
    assert.equal(oldRecording.disconnected, true); assert.equal(scrape.disconnected, true);
    assert.equal(audio.recordingVoices.size, 1, 'old cleanup does not remove new playback');
  } finally { audio.dispose(); }
  assert.equal(audio._releasingVoices.size, 0);
  assert.ok(context.sources.every(source => source.disconnected));
});

test('pop events play a short bright crack with a knock, grouped separately from landings', async () => {
  const { audio, context, study } = await enabledFire();
  try {
    audio._playCrackle(.6, 'pop', 2);
    const crack = context.sources[2], knock = context.sources[3];
    const band = crack.connections[0], softness = band.connections[0], envelope = softness.connections[0].gain.events;
    assert.equal(band.type, 'bandpass'); assert.ok(band.frequency.events[0].value >= 1900, 'a pop is brighter than a settling sluff');
    assert.equal(softness.frequency.value, 5600);
    assert.ok(envelope.find(event => event.type === 'linear').time <= .002, 'a pop has an instant onset');
    assert.ok(crack.stopTimes[0] < .12, 'a pop is over quickly');
    assert.equal(knock.buffer, audio.brownNoise); assert.ok(knock.stopTimes[0] < .1, 'the knock under a pop is brief');
    const played = []; audio._playCrackle = (...args) => played.push(args);
    study.burnVisuals.impactEvents.push({ id: 1, strength: .3, time: study.animationTime, position: { x: 0 }, kind: 'pop' });
    study.burnVisuals.impactEvents.push({ id: 2, strength: .6, time: study.animationTime, position: { x: 1 } });
    context.currentTime = 1; audio.update(study, true);
    assert.deepEqual(played.map(args => args[1]), [true, 'pop'], 'a landing and a pop in the same frame each get their own sound');
    study.burnVisuals.impactEvents.push({ id: 3, strength: .3, time: study.animationTime, position: { x: 0 }, kind: 'pop' });
    context.currentTime = 1.05; audio.update(study, true);
    assert.equal(played.length, 2, 'pops have a short refractory period');
  } finally { audio.dispose(); }
});

test('a lull muffles the recorded crackle and leaves out the close cracks; a lively spell bunches them', async () => {
  const { audio, context, study } = await enabledFire();
  const played = []; audio._playCrackle = (...args) => played.push(args);
  try {
    study.burnVisuals.fireActivity = 1; audio.update(study, true);
    assert.equal(audio.bedTone.type, 'lowpass');
    assert.ok(audio.bedTone.frequency.value >= 4900, 'a restless fire leaves the bed open');
    const openGain = audio.recordedBed.gain.value;
    audio._nextCrackle = 1; context.currentTime = 1.1; audio.update(study, true);
    assert.equal(played.length, 1); assert.equal(played[0][1], false);
    const livelyInterval = audio._nextCrackle - context.currentTime;
    study.burnVisuals.fireActivity = 0; audio.update(study, true);
    assert.ok(audio.bedTone.frequency.value <= 2900 && audio.bedTone.frequency.value >= 2700, 'a lull darkens a little without closing down to a roar');
    assert.ok(audio.recordedBed.gain.value < openGain * .65, 'the bed ducks in a lull instead of leaving a whoosh');
    audio._nextCrackle = 2; context.currentTime = 2.1; audio.update(study, true);
    assert.equal(played.length, 1, 'no close cracks in a lull');
    assert.ok(audio._nextCrackle > 2.1 && audio._nextCrackle <= 3.2, 'the lull is re-checked soon rather than scheduling a crack');
    study.burnVisuals.fireActivity = .12; audio._nextCrackle = 3; context.currentTime = 3.1; audio.update(study, true);
    assert.equal(played.length, 2);
    assert.ok(audio._nextCrackle - context.currentTime > livelyInterval * 4, 'a quiet spell spaces the cracks far apart');
    study.burnVisuals.fireActivity = 2.5; audio._nextCrackle = 4; context.currentTime = 4.1; audio.update(study, true);
    assert.equal(played.length, 3);
    assert.ok(audio._nextCrackle - context.currentTime < livelyInterval, 'a lively spell brings the next crack sooner');
    audio.random = () => .2; audio._nextCrackle = 5; context.currentTime = 5.1; audio.update(study, true);
    assert.ok(audio._nextCrackle - context.currentTime < .25, 'lively cracks sometimes come in quick twos');
    delete study.burnVisuals.fireActivity; audio.update(study, true);
    assert.ok(audio.bedTone.frequency.value >= 4900, 'no envelope means an open bed');
  } finally { audio.dispose(); }
});

test('a loud pop is a louder, longer crack with a deep knock and an ember sizzle, routed from its own event', async () => {
  const { audio, context, study } = await enabledFire();
  try {
    audio._playCrackle(.6, 'pop', 0);
    const ordinaryPeak = Math.max(...context.sources[2].connections[0].connections[0].connections[0].gain.events.map(event => event.value || 0));
    const before = context.sources.length;
    audio._playCrackle(.5, 'loud', 1);
    assert.equal(context.sources.length - before, 3, 'crack, knock and sizzle');
    const [crack, knock, sizzle] = context.sources.slice(before);
    assert.equal(crack.buffer, audio.whiteNoise); assert.equal(knock.buffer, audio.brownNoise); assert.equal(sizzle.buffer, audio.whiteNoise);
    const crackEnvelope = crack.connections[0].connections[0].connections[0].gain.events;
    const loudPeak = Math.max(...crackEnvelope.map(event => event.value || 0));
    assert.ok(loudPeak > ordinaryPeak * 1.5, `a loud pop (${loudPeak}) is well above an ordinary one (${ordinaryPeak})`);
    assert.ok(crackEnvelope.find(event => event.type === 'linear').time <= .002, 'instant onset');
    assert.ok(crack.stopTimes[0] > .09 && crack.stopTimes[0] < .16, 'the crack is longer than a small pop and still short');
    const body = knock.connections[0];
    assert.equal(body.type, 'bandpass'); assert.ok(body.frequency.value < 240, 'the knock is deep');
    assert.ok(knock.stopTimes[0] >= .28, 'the knock rings on');
    assert.ok(sizzle.stopTimes[0] >= .5, 'the ember sizzle is the longest part');
    assert.equal(audio.voices.size, 2);
    sizzle.onended();
    assert.equal(audio.voices.size, 1, 'the voice ends with the sizzle');
    assert.ok([crack, knock, sizzle].every(source => source.disconnected));
    const played = []; audio._playCrackle = (...args) => played.push(args);
    study.burnVisuals.impactEvents.push({ id: 1, strength: 1.4, time: study.animationTime, position: { x: 0 }, kind: 'pop', loud: true });
    context.currentTime = 1; audio.update(study, true);
    assert.equal(played.length, 1); assert.equal(played[0][1], 'loud');
    assert.ok(Math.abs(played[0][0] - (1.4 - 1) / .6) < 1e-9, 'loudness follows how far the pop exceeds an ordinary one');
    audio.setVolume(0); const count = context.sources.length;
    audio._playCrackle = FireAudio.prototype._playCrackle;
    audio._playCrackle(1, 'loud', 0); assert.equal(context.sources.length, count, 'muted fires make no loud pops');
  } finally { audio.dispose(); }
});

test('the recorded whoosh is quieter, high-passed and slow; cracks, pops and sluffs still schedule', async () => {
  const { audio, context, study } = await enabledFire();
  const played = []; audio._playCrackle = (...args) => played.push(args);
  try {
    assert.equal(audio.bedAir.type, 'highpass');
    assert.ok(audio.bedAir.frequency.value >= 200 && audio.bedAir.frequency.value <= 280, 'the bed cuts rumble rather than roaring');
    assert.equal(audio.recordedBed.connections[0], audio.bedAir);
    study.burnVisuals.fireActivity = 1;
    audio.update(study, true);
    const calmGain = audio.recordedBed.gain.value;
    assert.ok(calmGain > .4 && calmGain < 1.05, `open bed ${calmGain} stays below a whoosh`);
    const gainTau = audio.recordedBed.gain.events.filter(event => event.type === 'target').at(-1);
    assert.ok(gainTau.constant >= 2, 'bed gain eases over seconds, not a swell');
    study.weather = { gust: 1 };
    audio.update(study, true);
    assert.equal(audio.recordedBed.gain.value, calmGain, 'gusts stir crackle rate, not bed whoosh');
    study.burnVisuals.fireActivity = 0; audio.update(study, true);
    assert.ok(audio.recordedBed.gain.value < calmGain * .65, 'a lull ducks the bed instead of leaving a roar');
    assert.ok(audio.bedTone.frequency.value >= 2700, 'a lull still passes the recording\'s clicks');
    study.burnVisuals.fireActivity = 1;
    audio._nextCrackle = 1; context.currentTime = 1.1; audio.update(study, true);
    assert.equal(played.length, 1); assert.equal(played[0][1], false, 'close cracks still schedule');
    study.burnVisuals.impactEvents.push({ id: 1, strength: .4, time: study.animationTime, position: { x: 0 }, kind: 'pop' });
    context.currentTime = 2; audio.update(study, true);
    assert.equal(played.at(-1)[1], 'pop', 'pops still schedule');
    study.burnVisuals.impactEvents.push({ id: 2, strength: .5, time: study.animationTime, position: { x: 1 } });
    context.currentTime = 3; audio.update(study, true);
    assert.equal(played.at(-1)[1], true, 'sluffs still schedule');
  } finally { audio.dispose(); }
});
