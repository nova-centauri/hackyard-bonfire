const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const MAX_VOICES = 10;
const RECORDING_URL = `${import.meta.env?.BASE_URL || '/'}audio/campfire-soft.mp3`;
const BED_CROSSFADE = 2;

// The quiet bed is a locally bundled CC0 campfire field recording; details and
// processing are in public/audio/ATTRIBUTION.md. Responsive wood/ash sounds and
// a download-failure fallback are synthesized. Every sound uses real audio time.
export class FireAudio {
  constructor({ contextFactory, random = Math.random, sampleLoader } = {}) {
    this.enabled = false;
    this.volume = .3;
    this.context = null;
    this.voices = new Set();
    this.random = random;
    this.sampleLoader = sampleLoader === undefined ? async (context, signal) => {
      const response = await fetch(RECORDING_URL, { signal });
      if (!response.ok) throw new Error('Campfire recording unavailable.');
      return context.decodeAudioData(await response.arrayBuffer());
    } : sampleLoader;
    this.recordingStatus = 'idle';
    this.recording = null;
    this.recordingVoices = new Set();
    this._releasingVoices = new Set();
    this._recordingLoad = null;
    this._nextBed = Infinity;
    this._lastBedOffset = -Infinity;
    this._nextBedModulation = 0;
    this._bedVariation = 1;
    this.contextFactory = contextFactory || (() => {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support fire audio.');
      return new AudioContext();
    });
    this._study = null;
    this._resetToken = null;
    this._lastImpact = 0;
    this._lastAnimation = 0;
    this._running = false;
    this._active = false;
    this._skipEvents = true;
    this._disposed = false;
    this._request = 0;
    this._nextCrackle = Infinity;
    this._lastCollapse = -Infinity;
    this._suspendTimer = null;
  }

  async setEnabled(enabled) {
    if (this._disposed) return;
    const request = ++this._request;
    this.enabled = !!enabled;
    this._skipEvents = true;
    if (!this.enabled) {
      this._silence();
      return;
    }
    try {
      if (!this.context) this._createContext();
      clearTimeout(this._suspendTimer);
      this._suspendTimer = null;
      // This method is called directly by the sound button's user gesture.
      await this.context.resume();
      if (request !== this._request || !this.enabled || this._disposed) return;
      this.update(this._study, this._running);
      this._loadRecording();
    } catch (error) {
      if (request === this._request) { this.enabled = false; this._silence(); }
      throw error;
    }
  }

  setVolume(volume) {
    this.volume = clamp(volume);
    if (this.context) this._target(this.master.gain, this._active ? this.volume * .7 : 0, .06);
  }

  update(study, running) {
    if (this._disposed) return;
    const visuals = study?.burnVisuals;
    const events = visuals?.impactEvents || [];
    const lastImpact = events.reduce((max, event) => Math.max(max, event.id), 0);
    const animationTime = study?.animationTime || 0;
    const resetToken = visuals?.resetToken ?? study?.cycle?.seed;
    const changed = study !== this._study || resetToken !== this._resetToken || animationTime < this._lastAnimation;
    const cycle = study?.cycle;
    const flame = clamp(cycle ? cycle.flame / 3.5 : .75);
    const heat = clamp(cycle ? cycle.coalHeat : .7);
    const hot = !cycle || cycle.phase !== 'Cold fire bed' && (flame > .0001 || heat > .015);
    const active = !!(this.enabled && running && study?.config?.animated && hot && !globalThis.document?.hidden);
    const resuming = active && !this._active;
    const skipEvents = changed || this._skipEvents || !active || resuming;
    const newImpacts = skipEvents ? [] : events.filter(event => event.id > this._lastImpact && animationTime - event.time < .45);
    this._study = study;
    this._running = !!running;
    this._resetToken = resetToken;
    this._lastAnimation = animationTime;
    this._lastImpact = lastImpact;
    this._skipEvents = false;
    if (!active || !this.context) {
      if (this._active || this.context?.state === 'running' && !this._suspendTimer) this._silence();
      return;
    }
    if (resuming) {
      clearTimeout(this._suspendTimer);
      this._suspendTimer = null;
      this._active = true;
      this._nextCrackle = this.context.currentTime + .8 + this.random() * 2;
      this._nextBed = this.context.currentTime + .03;
      if (this.context.state !== 'running') this.context.resume().catch(() => this._silence());
      this._target(this.master.gain, this.volume * .7, .18);
    }
    const now = this.context.currentTime;
    if (now >= this._nextBedModulation) {
      this._bedVariation = .87 + this.random() * .22;
      this._nextBedModulation = now + 2 + this.random() * 3;
    }
    // Real crackles supply the detail. The synthetic fallback stays soft and
    // loses its noise bed completely as the recording fades in.
    const fallback = this.recording ? 0 : 1;
    this._target(this.body.gain, fallback * (.018 + flame * .025 + heat * .008) * this._bedVariation, .8);
    this._target(this.hiss.gain, fallback * (.0007 + flame * .0025), .8);
    this._target(this.bodyFilter.frequency, 330 + flame * 310, .8);
    this._target(this.recordedBed.gain, (1.35 + flame * .8 + heat * .15) * this._bedVariation, 1.2);
    if (this.recording && now + .15 >= this._nextBed) this._scheduleRecording(now);
    // Contacts in one tumble share a soft sluff. A real-time refractory period
    // keeps rolling/repeated contacts from sounding like a machine gun.
    if (newImpacts.length && now - this._lastCollapse > .32) {
      const strongest = newImpacts.reduce((best, event) => event.strength > best.strength ? event : best);
      this._playCrackle(clamp(strongest.strength + (newImpacts.length - 1) * .08), true, strongest.position?.x || 0);
      this._lastCollapse = now;
    }
    if (now >= this._nextCrackle) {
      // Most pops already belong to the field recording. Add only rare, small
      // close cracks; lower heat leaves longer quiet spaces.
      this._playCrackle(.035 + this.random() ** 2 * (.08 + flame * .17), false, (this.random() - .5) * 3);
      this._nextCrackle = now + (this.recording ? 3.2 + this.random() * 7 : .65 + this.random() * 3.8) / (.45 + flame * .7 + heat * .1);
    }
  }

  _createContext() {
    const context = this.context = this.contextFactory();
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -18;
    this.limiter.knee.value = 18;
    this.limiter.ratio.value = 4;
    this.limiter.attack.value = .004;
    this.limiter.release.value = .18;
    this.master.connect(this.limiter).connect(context.destination);
    this.whiteNoise = this._noiseBuffer(3, false);
    this.brownNoise = this._noiseBuffer(5, true);
    this.recordedBed = context.createGain(); this.recordedBed.gain.value = 0;
    this.recordedBed.connect(this.master);
    this.bodyFilter = context.createBiquadFilter();
    this.bodyFilter.type = 'lowpass';
    this.bodyFilter.frequency.value = 650;
    const lowCut = context.createBiquadFilter();
    lowCut.type = 'highpass'; lowCut.frequency.value = 125;
    this.body = context.createGain(); this.body.gain.value = 0;
    this.bodySource = context.createBufferSource();
    this.bodySource.buffer = this.brownNoise; this.bodySource.loop = true;
    this.bodySource.connect(lowCut).connect(this.bodyFilter).connect(this.body).connect(this.master);
    this.hissFilter = context.createBiquadFilter();
    this.hissFilter.type = 'bandpass'; this.hissFilter.frequency.value = 1700; this.hissFilter.Q.value = .45;
    this.hiss = context.createGain(); this.hiss.gain.value = 0;
    this.hissSource = context.createBufferSource();
    this.hissSource.buffer = this.whiteNoise; this.hissSource.loop = true;
    this.hissSource.connect(this.hissFilter).connect(this.hiss).connect(this.master);
    this._bedNodes = [this.bodySource, this.hissSource, lowCut, this.bodyFilter, this.body, this.hissFilter, this.hiss, this.recordedBed];
    this.bodySource.start(); this.hissSource.start(0, .71);
  }

  _loadRecording() {
    if (this._recordingLoad || !this.sampleLoader || this._disposed) return this._recordingLoad;
    this.recordingStatus = 'loading';
    this._sampleAbort = new AbortController();
    this._recordingLoad = Promise.resolve().then(() => this.sampleLoader(this.context, this._sampleAbort.signal)).then(buffer => {
      if (this._disposed) return;
      if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration < 6) throw new Error('Campfire recording is too short.');
      this.recording = buffer;
      this.recordingStatus = 'ready';
      this._nextBed = this.context.currentTime + .03;
      this.update(this._study, this._running);
    }).catch(() => {
      if (!this._disposed) this.recordingStatus = 'fallback';
    });
    return this._recordingLoad;
  }

  _scheduleRecording(now) {
    // Long unpitched passages preserve natural texture and stereo space. Start
    // elsewhere each time and overlap their fades, without a repeating seam.
    if (this.recordingVoices.size >= 3) return;
    const duration = Math.min(this.recording.duration - .1, 12 + this.random() * 7);
    const available = Math.max(0, this.recording.duration - duration - .05);
    let offset = this.random() * available;
    if (available > 6 && Math.abs(offset - this._lastBedOffset) < 4) offset = (offset + available * .53) % available;
    this._lastBedOffset = offset;
    const start = Math.max(now + .01, this._nextBed);
    const source = this.context.createBufferSource(), envelope = this.context.createGain();
    source.buffer = this.recording;
    source.connect(envelope).connect(this.recordedBed);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(1, start + BED_CROSSFADE);
    envelope.gain.setValueAtTime(1, start + duration - BED_CROSSFADE);
    envelope.gain.linearRampToValueAtTime(0, start + duration);
    this._registerVoice(this.recordingVoices, [source], [envelope], [envelope.gain], source);
    source.start(start, offset, duration);
    source.stop(start + duration + .01);
    this._nextBed = start + duration - BED_CROSSFADE;
  }

  _noiseBuffer(seconds, brown) {
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * seconds), this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const noise = this.random() * 2 - 1;
      previous = previous * .985 + noise * .025;
      data[i] = brown ? previous * 4 : noise;
    }
    // Bring the tail smoothly back to its first sample at the loop seam.
    const seam = Math.min(512, Math.floor(data.length / 8));
    for (let i = 0; i < seam; i++) {
      const mix = i / (seam - 1);
      data[data.length - seam + i] = data[data.length - seam + i] * (1 - mix) + data[0] * mix;
    }
    return buffer;
  }

  _target(parameter, value, timeConstant) {
    const now = this.context.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, timeConstant);
  }

  _playCrackle(strength, collapse, x) {
    if (!this._active || this.volume === 0) return;
    strength = clamp(strength);
    if (this.voices.size >= MAX_VOICES) {
      if (!collapse) return;
      this.voices.values().next().value.stop();
    }
    const context = this.context, now = context.currentTime;
    const duration = collapse ? .48 + strength * .42 + this.random() * .18 : .028 + strength * .095;
    const nodes = [], sources = [], envelopes = [];
    const gain = context.createGain(); nodes.push(gain);
    envelopes.push(gain.gain);
    const pan = context.createStereoPanner(); nodes.push(pan);
    pan.pan.value = clamp(x * .12, -.42, .42);
    gain.connect(pan).connect(this.master);
    const amplitude = collapse ? .09 + strength * .14 : .016 + strength * .055;
    gain.gain.setValueAtTime(.0001, now);
    if (collapse) {
      // A broad, uneven scrape sinking into ash: slower than a crack, softened
      // above 1.2 kHz, with no pitched bass drop or sharp second impact.
      gain.gain.linearRampToValueAtTime(amplitude * .65, now + .035);
      gain.gain.linearRampToValueAtTime(amplitude, now + .10);
      gain.gain.exponentialRampToValueAtTime(amplitude * .33, now + duration * .31);
      gain.gain.linearRampToValueAtTime(amplitude * (.43 + this.random() * .17), now + duration * .48);
      gain.gain.exponentialRampToValueAtTime(amplitude * .16, now + duration * .69);
    } else {
      gain.gain.linearRampToValueAtTime(amplitude, now + .0018);
      gain.gain.exponentialRampToValueAtTime(amplitude * .20, now + .012);
    }
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    const filter = context.createBiquadFilter(); nodes.push(filter);
    filter.type = 'bandpass'; filter.Q.value = collapse ? .48 : .8;
    filter.frequency.setValueAtTime(collapse ? 440 + this.random() * 230 : 1400 + this.random() * 1600, now);
    filter.frequency.exponentialRampToValueAtTime(collapse ? 240 : 1050, now + duration);
    const softness = context.createBiquadFilter(); nodes.push(softness);
    softness.type = 'lowpass'; softness.frequency.value = collapse ? 1200 : 4300;
    softness.Q.value = .5;
    const noise = context.createBufferSource(); sources.push(noise);
    noise.buffer = this.whiteNoise; noise.connect(filter).connect(softness).connect(gain);
    if (collapse) {
      // A short, damped wood-body resonance, made from noise rather than an
      // oscillator, gives the soft weight of a log landing on burnt material.
      const thud = context.createBufferSource(), envelope = context.createGain();
      const body = context.createBiquadFilter();
      sources.push(thud); nodes.push(envelope, body);
      envelopes.push(envelope.gain);
      thud.buffer = this.brownNoise;
      body.type = 'bandpass'; body.frequency.value = 180 + this.random() * 75; body.Q.value = .65;
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.linearRampToValueAtTime(.045 + strength * .085, now + .022);
      envelope.gain.exponentialRampToValueAtTime(.0001, now + .27);
      thud.connect(body).connect(envelope).connect(pan);
      thud.start(now, this.random() * (this.brownNoise.duration - .3)); thud.stop(now + .29);
    }
    this._registerVoice(this.voices, sources, nodes, envelopes, noise);
    noise.start(now, this.random() * (this.whiteNoise.duration - duration));
    noise.stop(now + duration + .015);
  }

  _registerVoice(collection, sources, nodes, envelopes, endingSource) {
    let released = false, cleaned = false, releaseTimer;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(releaseTimer);
      for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
      for (const node of nodes) node.disconnect();
      collection.delete(voice); this._releasingVoices.delete(voice);
    };
    const voice = { cleanup, stop: (release = .045) => {
      if (cleaned) return;
      if (!release || this.context.state !== 'running') { cleanup(); return; }
      if (released) return;
      released = true;
      collection.delete(voice);
      const now = this.context.currentTime;
      // Cancel future passage fades and transient peaks while retaining the
      // current value. Each old voice fades independently through rapid
      // pause/unpause or mute/unmute, even when master volume rises again.
      for (const parameter of envelopes) {
        if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
        else { const value = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(value, now); }
        parameter.linearRampToValueAtTime(0, now + release);
      }
      for (const source of sources) { try { source.stop(now + release + .01); } catch {} }
      this._releasingVoices.add(voice);
      // onended is the normal cleanup path. The bounded timer also cleans up
      // if a browser suspends its audio clock before delivering that callback.
      releaseTimer = setTimeout(cleanup, (release + .03) * 1000);
      if (this._releasingVoices.size > MAX_VOICES + 3) this._releasingVoices.values().next().value.cleanup();
    } };
    endingSource.onended = cleanup;
    collection.add(voice);
    return voice;
  }

  _silence() {
    this._active = false;
    this._skipEvents = true;
    this._nextCrackle = Infinity;
    this._nextBed = Infinity;
    for (const voice of this.voices) voice.stop(this._disposed ? 0 : .045);
    for (const voice of this.recordingVoices) voice.stop(this._disposed ? 0 : .045);
    if (!this.context || this.context.state === 'closed') return;
    this._target(this.master.gain, 0, .025);
    clearTimeout(this._suspendTimer);
    this._suspendTimer = setTimeout(() => {
      this._suspendTimer = null;
      if (!this._active && this.context?.state === 'running') this.context.suspend().catch(() => {});
    }, 130);
  }

  dispose() {
    this.enabled = false;
    this._disposed = true;
    this._request++;
    this._sampleAbort?.abort();
    this._silence();
    for (const voice of this._releasingVoices) voice.cleanup();
    clearTimeout(this._suspendTimer);
    for (const source of [this.bodySource, this.hissSource]) {
      try { source?.stop(); } catch {}
    }
    for (const node of this._bedNodes || []) node.disconnect();
    this.master?.disconnect(); this.limiter?.disconnect();
    this.context?.close().catch(() => {});
    this._study = null;
  }
}
