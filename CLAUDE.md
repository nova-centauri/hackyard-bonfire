# Bonfire — project guide

A Three.js bonfire meant to be left open in a browser: flickering warm
light, crackling sound, logs that burn, settle and get replaced. Product
direction and the plan live in `docs/roadmap.md`; keep it current.

## Commands

- `npm install` once; Node 22.
- `npm run dev` — Vite on http://127.0.0.1:5186/ (root opens study 08).
- `npm test` — `node --test`, pure-logic tests, about ten seconds. No browser.
- `npm run build` / `npm run preview` — production bundle in `dist/`.
- Headless render check: Playwright's Chromium with `--use-angle=swiftshader`
  can load the preview, wait for `.stage[data-ready="true"]`, and read the
  `data-*` attributes (tier, draw calls, shader errors). It is far too slow
  for frame-time numbers.

## Where things are

- `src/main.js` — page shell, study navigation, sound controls, preferences.
- `src/scene.js` — `BonfireViewer`: renderer, composer, quality application,
  frame loop, scene construction (`buildScene`).
- `src/quality.js` — LoD tiers, size cap, frame-pacing governor (pure).
- `src/lifecycle.js` — burn clock: fuel, heat, moisture, feed queue, tending.
- `src/fuel-types.js` — kinds (log, kindling, plank, stump, pallet, cardboard,
  newspaper), sizes, heat/moisture/char, the uniform random pick.
- `src/log-combustion.js` — per-log surface cells (heat, wood, char, flame).
- `src/log-settling.js` — rigid-body settling, sleeping, ground/stone
  contacts, rolling resistance, char fragments.
- `src/burn-visuals.js` — maps simulation state to meshes, uniforms, atlas,
  impact events, pops; drives twig settling and instance sync.
- `src/motion.js` — per-frame gas/particle/light state: wind, flicker,
  ember and steam uniforms, flame centroid.
- `src/hybrid-fire.js`, `src/volume.js` — ray-marched fire and smoke.
- `src/embers.js`, `src/steam.js`, `src/twig-render.js` — GPU/instanced
  layers replacing per-object draws.
- `src/weather.js`, `src/pops.js` — wind/gusts, pop scheduling and the
  seeded restlessness envelope (`fireActivity`) that the audio follows (pure).
- `src/fire-poker.js`, `src/poker-stick.js` — the poking stick: interaction,
  and its swept branch geometry (pure, tested).
- `src/fire-audio.js` — bundled recording bed plus procedural cracks, sluffs
  and pops; every sound uses real audio time.
- `src/textures.js`, `src/texture-manifest.js`, `src/texture-loader.js` —
  procedural textures and the authored-texture override path
  (`docs/textures.md`).
- `docs/fire-physics.md` — model notes; `docs/rendering-and-performance.md`
  — frame, tiers, governor, idle cost, measuring.

## Conventions that matter

- Two clocks: the burn clock (fixed 0.5 s steps, accelerated by the speed
  control) and the animation clock (real seconds). Never couple animation
  state (wind, flicker, poses) back into burn integration; the accelerated-
  time equivalence test guards this. The one sanctioned crossing is the
  settled wood positions (`cycle.setLogPoses`), which shape where heat
  reaches; a piece still falling keeps its last resting pose there. Anything
  that changes the burn must also pass `test/tended-fire.test.js`, which runs
  the viewer loop with real settling, since the standalone lifecycle tests
  never see poses.
- Everything is seeded and deterministic; tests rely on it.
- Sleeping bodies are static: wake them explicitly (see `wake()` callers)
  before applying impulses.
- Depth and shadow passes are expensive; `updateBurnVisuals` returns whether
  something opaque visibly moved, and only that invalidates them.
- Quality settings are uniforms and cadences, not shader defines, so tier
  changes never recompile.
- New user-facing controls need a reason; the viewer mostly watches.
- Tests: add or adjust a test with every behaviour change; keep them in
  `test/` as `node:test` files importing from `src/` directly.
