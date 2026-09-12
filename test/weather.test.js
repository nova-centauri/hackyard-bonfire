import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeather, flicker, smoothNoise } from '../src/weather.js';

test('wind is deterministic per seed, continuous in time, mostly calm, and gusts occasionally', () => {
  const a = createWeather(22), b = createWeather(22), c = createWeather(23);
  a.update(137.4); b.update(137.4); c.update(137.4);
  assert.deepEqual(a.wind.toArray(), b.wind.toArray());
  assert.notDeepEqual(a.wind.toArray(), c.wind.toArray());
  let previous = createWeather(22).update(0).wind.clone(), maxJump = 0, maxGust = 0, gusty = 0, samples = 0;
  const weather = createWeather(22);
  for (let time = 1 / 30; time <= 900; time += 1 / 30) {
    weather.update(time);
    maxJump = Math.max(maxJump, weather.wind.distanceTo(previous)); previous.copy(weather.wind);
    maxGust = Math.max(maxGust, weather.gust); if (weather.gust > .5) gusty++; samples++;
    assert.ok(weather.speed >= .08 && weather.speed <= 1.4, `wind speed ${weather.speed} stays in range`);
    assert.equal(weather.wind.y, 0);
  }
  assert.ok(maxJump < .04, `wind never jumps between frames (${maxJump})`);
  assert.ok(maxGust > .5, 'a strong gust happens within fifteen minutes');
  assert.ok(gusty / samples < .15, `strong gusts are rare (${(gusty / samples * 100).toFixed(1)}% of the time)`);
});

test('flicker noise is bounded, centred and smooth', () => {
  let sum = 0, count = 0, previous = flicker(0), maxJump = 0;
  for (let time = 1 / 60; time <= 600; time += 1 / 60) {
    const value = flicker(time);
    assert.ok(value >= 0 && value <= 1);
    sum += value; count++; maxJump = Math.max(maxJump, Math.abs(value - previous)); previous = value;
  }
  assert.ok(Math.abs(sum / count - .5) < .06, `mean ${sum / count}`);
  assert.ok(maxJump < .08, `no frame-to-frame jump larger than ${maxJump}`);
  assert.equal(smoothNoise(3.5, 1), smoothNoise(3.5, 1));
  assert.notEqual(flicker(10, 0), flicker(10, 17), 'different seeds give independent lights');
});
