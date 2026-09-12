const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const MAX_VOICES = 10;

// All sound is synthesized locally. The sound clock is AudioContext time, so
// speeding up the burn never speeds up the ambience or pitches up the wood.
export class FireAudio {
  constructor({ contextFactory, random = Math.random } = {}) {
    this.enabled = false;
    this.volume = .3;
    this.context = null;
    this.voices = new Set();
    this.random = random;
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
      this._nextCrackle = this.context.currentTime + .25 + this.random();
      if (this.context.state !== 'running') this.context.resume().catch(() => this._silence());
      this._target(this.master.gain, this.volume * .7, .18);
    }
    this._target(this.body.gain, .065 + flame * .085 + heat * .012, .45);
    this._target(this.hiss.gain, .003 + flame * .016, .45);
    this._target(this.bodyFilter.frequency, 380 + flame * 540, .6);
    const now = this.context.currentTime;
    // One group of tumbling logs makes one clustered woody pop, avoiding a
    // barrage if several contacts happen within the same animation frame.
    if (newImpacts.length && now - this._lastCollapse > .085) {
      const strongest = newImpacts.reduce((best, event) => event.strength > best.strength ? event : best);
      this._playCrackle(clamp(strongest.strength + (newImpacts.length - 1) * .08), true, strongest.position?.x || 0);
      this._lastCollapse = now;
    }
    if (now >= this._nextCrackle) {
      this._playCrackle(.05 + this.random() * (.12 + flame * .23), false, (this.random() - .5) * 3);
      this._nextCrackle = now + (.18 + this.random() * 1.8) / (.35 + flame * 1.2 + heat * .15);
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
    const brownNoise = this._noiseBuffer(5, true);
    this.bodyFilter = context.createBiquadFilter();
    this.bodyFilter.type = 'lowpass';
    this.bodyFilter.frequency.value = 650;
    const lowCut = context.createBiquadFilter();
    lowCut.type = 'highpass'; lowCut.frequency.value = 70;
    this.body = context.createGain(); this.body.gain.value = 0;
    this.bodySource = context.createBufferSource();
    this.bodySource.buffer = brownNoise; this.bodySource.loop = true;
    this.bodySource.connect(lowCut).connect(this.bodyFilter).connect(this.body).connect(this.master);
    this.hissFilter = context.createBiquadFilter();
    this.hissFilter.type = 'bandpass'; this.hissFilter.frequency.value = 1700; this.hissFilter.Q.value = .45;
    this.hiss = context.createGain(); this.hiss.gain.value = 0;
    this.hissSource = context.createBufferSource();
    this.hissSource.buffer = this.whiteNoise; this.hissSource.loop = true;
    this.hissSource.connect(this.hissFilter).connect(this.hiss).connect(this.master);
    this._bedNodes = [this.bodySource, this.hissSource, lowCut, this.bodyFilter, this.body, this.hissFilter, this.hiss];
    this.bodySource.start(); this.hissSource.start(0, .71);
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
    if (this.voices.size >= MAX_VOICES) {
      if (!collapse) return;
      this.voices.values().next().value.stop();
    }
    const context = this.context, now = context.currentTime;
    const duration = collapse ? .32 + strength * .28 : .035 + strength * .13;
    const nodes = [], sources = [];
    const gain = context.createGain(); nodes.push(gain);
    const pan = context.createStereoPanner(); nodes.push(pan);
    pan.pan.value = clamp(x * .17, -.65, .65);
    gain.connect(pan).connect(this.master);
    const amplitude = collapse ? .10 + strength * .22 : .026 + strength * .085;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(amplitude, now + .003);
    gain.gain.exponentialRampToValueAtTime(amplitude * .24, now + .019);
    if (collapse) {
      gain.gain.exponentialRampToValueAtTime(.004, now + .07);
      gain.gain.linearRampToValueAtTime(amplitude * .40, now + .085);
    }
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    const filter = context.createBiquadFilter(); nodes.push(filter);
    filter.type = 'bandpass'; filter.Q.value = collapse ? .65 : 1.1;
    filter.frequency.setValueAtTime(collapse ? 1200 + strength * 650 : 1700 + this.random() * 2200, now);
    filter.frequency.exponentialRampToValueAtTime(collapse ? 430 : 1100, now + duration);
    const noise = context.createBufferSource(); sources.push(noise);
    noise.buffer = this.whiteNoise; noise.connect(filter).connect(gain);
    if (collapse) {
      const thud = context.createOscillator(), envelope = context.createGain();
      sources.push(thud); nodes.push(envelope);
      thud.type = 'sine'; thud.frequency.setValueAtTime(155 - strength * 35, now);
      thud.frequency.exponentialRampToValueAtTime(52, now + .17);
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.linearRampToValueAtTime(.035 + strength * .075, now + .007);
      envelope.gain.exponentialRampToValueAtTime(.0001, now + .24);
      thud.connect(envelope).connect(pan); thud.start(now); thud.stop(now + .26);
    }
    let stopped = false;
    const voice = { stop: () => {
      if (stopped) return;
      stopped = true;
      for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
      for (const node of nodes) node.disconnect();
      this.voices.delete(voice);
    } };
    this.voices.add(voice);
    noise.onended = voice.stop;
    noise.start(now, this.random() * (this.whiteNoise.duration - duration));
    noise.stop(now + duration + .015);
  }

  _silence() {
    this._active = false;
    this._skipEvents = true;
    this._nextCrackle = Infinity;
    for (const voice of this.voices) voice.stop();
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
    this._silence();
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
