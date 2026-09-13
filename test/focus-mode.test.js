import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountFocusMode, GEAR_IDLE_MS, GEAR_ENTRY_MS } from '../src/focus-mode.js';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');

function classList(store) {
  return {
    add: name => store.add(name),
    remove: name => store.delete(name),
    toggle: (name, on) => { if (on) store.add(name); else store.delete(name); },
    contains: name => store.has(name),
  };
}

function withPage(run) {
  const classes = new Set();
  const listeners = { document: [], window: [], html: [], button: [], restore: [] };
  const button = {
    addEventListener: (type, fn) => listeners.button.push({ type, fn }),
    setAttribute() {},
    focus() {},
  };
  const restore = { addEventListener: (type, fn) => listeners.restore.push({ type, fn }), hidden: true };
  const addFuel = { addEventListener() {} };
  const controls = { hidden: true };
  const canvas = { focus() {} };
  const document = {
    body: { classList: classList(classes) },
    documentElement: { addEventListener: (type, fn, opts) => listeners.html.push({ type, fn, opts }) },
    querySelector: sel => ({ '#focus-mode': button, '#restore-menus': restore, '#add-fuel-focus': addFuel, '#focus-controls': controls }[sel] ?? null),
    addEventListener: (type, fn, opts) => listeners.document.push({ type, fn, opts }),
  };
  const windowObj = {
    scrollY: 0,
    scrollTo() {},
    addEventListener: (type, fn, opts) => listeners.window.push({ type, fn, opts }),
  };
  const prev = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document;
  globalThis.window = windowObj;
  try {
    return run({ classes, listeners, controls, canvas });
  } finally {
    globalThis.document = prev.document;
    globalThis.window = prev.window;
  }
}

test('focus chrome CSS rests at opacity 0 with pointer-events none', () => {
  assert.match(css, /body\.focus-mode \.focus-controls\{opacity:0;pointer-events:none\}/);
  assert.match(css, /body\.focus-mode \.scene-controls\{[^}]*opacity:0;pointer-events:none/);
  assert.match(css, /body\.focus-mode\.focus-pointer-active \.focus-controls,body\.focus-mode \.focus-controls:focus-within\{opacity:1;pointer-events:auto\}/);
  assert.match(css, /body\.focus-mode\.focus-pointer-active \.scene-controls,body\.focus-mode \.scene-controls:focus-within\{opacity:1;pointer-events:auto\}/);
  assert.doesNotMatch(css, /opacity:\.38/);
  assert.doesNotMatch(css, /body\.focus-mode \.scene-controls\{[^}]*opacity:\.5/);
});

test('focus chrome is revealed on entry, then rests hidden until activity', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withPage(({ classes, listeners, controls, canvas }) => {
    const viewer = { renderer: { domElement: canvas }, resize() {}, setVignette() {}, poker: { setEquipped() {} } };
    mountFocusMode(viewer, { initial: true });
    assert.equal(classes.has('focus-mode'), true);
    assert.equal(classes.has('focus-pointer-active'), true, 'shown on entry so newcomers see where the menus went');
    assert.equal(controls.hidden, false);
    t.mock.timers.tick(GEAR_ENTRY_MS);
    assert.equal(classes.has('focus-pointer-active'), false, 'idle after the entry hold');
    assert.equal(classes.has('focus-mode'), true);
    const move = listeners.document.find(listener => listener.type === 'pointermove');
    assert.ok(move, 'pointer activity is what brings chrome back');
    move.fn();
    assert.equal(classes.has('focus-pointer-active'), true);
    t.mock.timers.tick(GEAR_IDLE_MS);
    assert.equal(classes.has('focus-pointer-active'), false);
    const blur = listeners.window.find(listener => listener.type === 'blur');
    move.fn();
    assert.equal(classes.has('focus-pointer-active'), true);
    blur.fn();
    assert.equal(classes.has('focus-pointer-active'), false, 'leaving the tab rests chrome immediately');
  });
});
