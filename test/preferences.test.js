import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPreferences, savePreferences, sanitizePreferences } from '../src/preferences.js';

const memory = () => { const map = new Map(); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map }; };

test('preferences open in focus mode by default, round-trip through storage, and survive a broken store', () => {
  assert.deepEqual(loadPreferences(undefined), { focus: true, sound: false, volume: .3 });
  assert.deepEqual(sanitizePreferences({ focus: 'yes', sound: 1, volume: 7 }), { focus: true, sound: false, volume: 1 });
  assert.deepEqual(sanitizePreferences({ volume: -2 }), { focus: true, sound: false, volume: 0 });
  assert.deepEqual(sanitizePreferences({ volume: 'loud' }).volume, .3);
  assert.equal(sanitizePreferences({ focus: false }).focus, false, 'only an explicit exit brings the menus back next time');
  const storage = memory();
  assert.deepEqual(savePreferences({ focus: false, volume: .55 }, storage), { focus: false, sound: false, volume: .55 });
  assert.deepEqual(savePreferences({ sound: true }, storage), { focus: false, sound: true, volume: .55 });
  assert.deepEqual(loadPreferences(storage), { focus: false, sound: true, volume: .55 });
  assert.deepEqual(savePreferences({ focus: true }, storage), { focus: true, sound: true, volume: .55 });
  storage.setItem('bonfire.preferences.v2', '{not json');
  assert.deepEqual(loadPreferences(storage), { focus: true, sound: false, volume: .3 });
  // A v1 store always carried focus:false; only its sound and volume carry over.
  const upgraded = memory();
  upgraded.setItem('bonfire.preferences.v1', JSON.stringify({ focus: false, sound: true, volume: .8 }));
  assert.deepEqual(loadPreferences(upgraded), { focus: true, sound: true, volume: .8 });
  assert.deepEqual(savePreferences({ focus: false }, upgraded), { focus: false, sound: true, volume: .8 });
  assert.ok(upgraded.map.has('bonfire.preferences.v2'));
  assert.deepEqual(loadPreferences(upgraded), { focus: false, sound: true, volume: .8 }, 'once written, v2 is the record');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadPreferences(broken), { focus: true, sound: false, volume: .3 });
  assert.deepEqual(savePreferences({ sound: true }, broken), { focus: true, sound: true, volume: .3 });
});
