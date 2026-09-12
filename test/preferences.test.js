import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPreferences, savePreferences, sanitizePreferences } from '../src/preferences.js';

const memory = () => { const map = new Map(); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map }; };

test('preferences default safely, round-trip through storage, and survive a broken store', () => {
  assert.deepEqual(loadPreferences(undefined), { focus: false, sound: false, volume: .3 });
  assert.deepEqual(sanitizePreferences({ focus: 'yes', sound: 1, volume: 7 }), { focus: false, sound: false, volume: 1 });
  assert.deepEqual(sanitizePreferences({ volume: -2 }), { focus: false, sound: false, volume: 0 });
  assert.deepEqual(sanitizePreferences({ volume: 'loud' }).volume, .3);
  const storage = memory();
  assert.deepEqual(savePreferences({ focus: true, volume: .55 }, storage), { focus: true, sound: false, volume: .55 });
  assert.deepEqual(savePreferences({ sound: true }, storage), { focus: true, sound: true, volume: .55 });
  assert.deepEqual(loadPreferences(storage), { focus: true, sound: true, volume: .55 });
  storage.setItem('bonfire.preferences.v1', '{not json');
  assert.deepEqual(loadPreferences(storage), { focus: false, sound: false, volume: .3 });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadPreferences(broken), { focus: false, sound: false, volume: .3 });
  assert.deepEqual(savePreferences({ sound: true }, broken), { focus: false, sound: true, volume: .3 });
});
