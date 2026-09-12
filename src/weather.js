import * as THREE from 'three';

// Slow, seeded variation on the animation clock: a wind that drifts and gusts,
// and a 1/f-style flicker signal for firelight. Everything is a pure function
// of time so it never snaps between frames, is identical at any frame rate,
// and needs no state beyond the seed. Nothing here touches the burn clock, so
// accelerated playback still integrates the same fuel and heat.
const hash1 = (n, seed) => { const value = Math.sin(n * 127.1 + seed * .137 + 1.7) * 43758.5453; return value - Math.floor(value); };

export function smoothNoise(x, seed = 0) {
  const cell = Math.floor(x), f = x - cell, blend = f * f * (3 - 2 * f);
  return hash1(cell, seed) * (1 - blend) + hash1(cell + 1, seed) * blend;
}

// Layered noise with falling amplitude per octave: the slow breathing of a
// fire with faster shivers on top. Returns roughly 0..1 with a mean near .5.
export function flicker(time, seed = 0) {
  return .55 * smoothNoise(time * 1.9, seed) + .3 * smoothNoise(time * 4.7, seed + 11) + .15 * smoothNoise(time * 12.3, seed + 29);
}

export function createWeather(seed = 22) {
  const state = { seed, wind: new THREE.Vector3(), angle: 0, speed: 0, gust: 0, time: 0 };
  state.update = time => {
    state.time = time;
    // Direction wanders over a minute or two; a faster tremor keeps it alive.
    state.angle = seed * .7 + (smoothNoise(time * .011, seed + 3) - .5) * Math.PI * 1.4 + (smoothNoise(time * .07, seed + 4) - .5) * .5;
    const base = .10 + .22 * smoothNoise(time * .05, seed + 5);
    // Gusts are the rare high end of a smooth field, so they arrive and leave
    // gradually and most of the time the air is nearly still.
    const field = smoothNoise(time * .19, seed + 7) * .6 + smoothNoise(time * .47, seed + 13) * .4;
    state.gust = Math.pow(Math.max(0, (field - .58) / .42), 1.5);
    state.speed = base + state.gust * .95;
    state.wind.set(Math.cos(state.angle) * state.speed, 0, Math.sin(state.angle) * state.speed);
    return state;
  };
  return state.update(0);
}
