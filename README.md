# Bonfire

A bonfire in your browser. Open it, leave it open. The point is the thing a
real fire gives you: warm light that never flickers the same way twice, wood
that cracks and pops, logs that burn down, settle and get replaced. Everything
is generated locally in WebGL 2 with no accounts, no setup and no assets
fetched beyond the page and one bundled recording.

The root URL opens study 08, *Wild draft*. Click **Focus mode** (or come back
after leaving in it) for an edge-to-edge fire with the menus gone; move the
mouse for the corner gear, press **Esc** to bring them back. Turn on
**Sound** once and it comes back on the next visit with your first click.

## Run

```sh
npm install
npm run dev        # http://127.0.0.1:5186/
npm test           # node --test, about ten seconds, no browser needed
npm run build      # dist/
```

Node 22. Deployment is unchanged: `main` → [bonfire.observer](https://bonfire.observer)
on VPS-01 via the webhook-pull described under [Deploy](#deploy).

## What it does while you watch

- **The fire tends itself.** Waiting pieces are added one at a time. After
  that, with **Keep the fire fed** on (the default), a fresh piece is added
  only when the wood runs low, never onto a roaring fire and never onto a bed
  too cold to light it, so a modest fire lasts as long as the page is open.
  Untick it to let the fire burn all the way down to cold ash.
- **Wood pops.** Wet, flaming wood pops most (a fresh log spits for a while
  after it catches). Each pop throws a tight burst of sparks from the actual
  log surface, spikes the firelight and cracks in the audio, all from one
  event.
- **Wind.** A seeded wind drifts and occasionally gusts: flames lean, shorten
  and tear downwind, the smoke bends, embers are carried, the light flickers
  more deeply and the fire crackles a little faster.
- **The light breathes.** Firelight flicker is layered noise rather than
  sines, the main light follows the centre of the flames so the shadows on
  the stones lean with the fire, and it reddens as flames die to embers.
- **Heat haze and vignette.** Hot air above the flames refracts what is
  behind it; a soft vignette deepens in focus mode.
- **Logs settle.** As wood thins it sinks onto its support continuously.
  Supports burn through and stacks tip and roll; char shells crack and shed
  glowing chunks; the fixed stones stop what rolls. Big logs roll down the
  bowl, char crumbs stay where they land.

Sound: a locally bundled CC0 campfire recording (see
[public/audio/ATTRIBUTION.md](public/audio/ATTRIBUTION.md)) with overlapping
passages so it never loops audibly, plus procedural small cracks, the sharp
crack of a pop and the muffled sluff of settling wood. Sound pauses with the
fire, in hidden tabs and when the bed is cold.

## Interaction (optional)

Drag to orbit, scroll to zoom; arrow keys, `+`, `-` and `0` on the focused
canvas. **Look closer** presets frame the logs or the ember bed.

**Add fuel** places a log, small log, kindling, 2×4 or stump. **Randomize**
starts a new seeded fire. **Burn speed** (1× to 1200×) accelerates only the
fuel and heat clock; flames, smoke, embers, settling and sound keep real
time. **Equip poking stick** to nudge or push wood: click to nudge, hold to
push, right-drag to orbit, **Esc** to put it away.

The panel under the fire shows the burn clock, core heat, each piece's phase,
fuel and moisture, and recent events. It is for the curious; the fire needs
none of it.

## Studies

| Study | Direct link | Technique |
| --- | --- | --- |
| After dark | /study/cinematic | Depth-clipped, ray-marched fire and smoke; rough charred wood |
| Wild geometry | /study/faceted | Colored polygonal flames and geometric smoke |
| Field notes | /study/ink | Translucent toon surfaces, contours, hatching and paper grain |
| Liquid light | /study/glass | Twisted physical-material ribbons, bright edges, reflections |
| The last heat | /study/embers | Lower flames, collapsed logs, pale ash, exposed charcoal |
| 07 — Living contours | /study/living-contours | Luminous folds, individual fuel lifecycles, accumulated ash |
| 08 — Wild draft | /study/wild-draft | Wind-curled flames, heat-driven ignition, complete burn-out |

07 and 08 are the living fires: complete burn cycles, settling, sound, wind
and pops. The first five are still studies that render only when the view
changes.

## Performance and level of detail

Rendering cost scales with the window and the machine. Five quality tiers
(Minimal to Ultra) set the drawing-buffer size, ray-march sample counts,
noise octaves, MSAA, bloom resolution, shadow map size and refresh cadence,
ember density and heat haze. The window size caps the tier (a small window
runs Low at roughly a twentieth of the old per-frame cost; a 1080p window may
reach Ultra) and a governor steps the tier down after sustained dropped frames
and back up only with clear headroom. Tier changes never recompile a shader.
Append `?quality=low` (any tier name) to pin one.

The settled simulation costs about 1 ms per frame: sleeping wood gets no
contact tests and wakes briefly every few seconds to sink as it thins. A
frame is about 190 draw calls including shadow and depth passes; embers,
trails, steam, twig segments and twig glows are one draw each.

Details, the tier table and how to measure are in
[docs/rendering-and-performance.md](docs/rendering-and-performance.md).

## Textures

Wood, soil and steam sprites are authored files under `public/textures/`,
listed in `src/texture-manifest.js`. Procedural textures still generate at
startup and remain the fallback if a file is missing. The authoring brief
(slots, sizes, colour spaces, tiling rules, channel meanings, workflow) is
[docs/textures.md](docs/textures.md).

## Simulation notes

An art-directed fuel and heat model with normalized heat, integrated in fixed
half-second steps so accelerated playback follows the same burn as real time.
Each log carries 40 surface cells with their own heat, moisture, wood and
char; the side facing the fire chars first and a rolled-away piece cools with
its burn pattern intact. Logs are rigid bodies with exact round ground
contact, friction, rolling resistance and sleeping. See
[docs/fire-physics.md](docs/fire-physics.md) for references, the model and
its limits, and [docs/roadmap.md](docs/roadmap.md) for direction, status and
the work log.

## Code map

- `src/main.js` page shell, navigation, sound controls, remembered
  preferences (`src/preferences.js`).
- `src/scene.js` the viewer: renderer, composer, quality application, frame
  loop, scene construction. `src/quality.js` tiers and governor.
- `src/lifecycle.js` burn clock and tending; `src/log-combustion.js` surface
  cells; `src/log-settling.js` rigid bodies; `src/burn-visuals.js` state to
  meshes, atlas, impacts and pops (`src/pops.js`); `src/motion.js` wind
  (`src/weather.js`), flicker, light, ember and steam state.
- `src/hybrid-fire.js`, `src/volume.js` ray-marched fire and smoke;
  `src/embers.js`, `src/steam.js`, `src/twig-render.js` GPU and instanced
  layers; `src/stylized.js` the still studies' flames.
- `src/log-geometry.js`, `src/fuel-geometry.js`, `src/fuel-mesh.js` wood;
  `src/log-burning-material.js` char plates; `src/log-damage.js` notches and
  fragments; `src/twig-settling.js` collapsing twigs.
- `src/ground.js`, `src/rocks.js`, `src/coal-bed.js`, `src/coals.js`,
  `src/ash-bed.js` the clearing; `src/textures.js`, `src/texture-loader.js`,
  `src/texture-manifest.js` textures; `src/fire-audio.js` sound;
  `src/fire-poker.js` the stick; `src/focus-mode.js` focus mode.

Tests live in `test/` as `node:test` files and cover the burn model, surface
combustion, settling (including idle cost and sleeping), rocks, twigs, geometry,
the quality governor, wind and pops, GPU layers, audio, preferences and the
texture loader.

## Deploy

`main` → [bonfire.observer](https://bonfire.observer) on VPS-01 via webhook-pull.

CI (`.github/workflows/ci.yml`) tests every push/PR. On a green push to `main`
it POSTs an HMAC-signed, push-shaped payload (`after` = commit SHA) to
`DEPLOY_WEBHOOK_URL`; VPS-01's `deploy.sh` then pulls that SHA itself. Nothing
is rsync'd or SSH'd from CI. If `DEPLOY_WEBHOOK_URL` / `DEPLOY_WEBHOOK_SECRET`
are not set, the notify step warns and exits 0.

Build from the committed lockfile with Node 22 (`npm ci && npm run build`) and
serve `dist/` with a fallback to `index.html` for `/study/...` routes. The app
runs entirely in the browser and needs no runtime environment variables or
backend service. WebGL 2 is required.
