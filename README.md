# Bonfire

A bonfire in your browser. Open it, leave it open. The point is the thing a
real fire gives you: warm light that never flickers the same way twice, wood
that cracks and pops, logs that burn down, settle and get replaced. Everything
is generated locally in WebGL 2 with no accounts, no setup and no assets
fetched beyond the page and one bundled recording.

The root URL opens study 08, *Wild draft*, edge to edge in focus mode with
the menus gone. The gear in the top-right corner rests faintly, brightens
when you move, and brings the menus back; so does **Esc**. A matching plus
beside it drops a random piece of fuel (log, kindling, pallet slat,
cardboard, crumpled newspaper, named woods, and the rest). Leave focus mode and the page remembers
that; **Focus mode** in the header returns to it. Turn on **Sound** once and
it comes back on the next visit with your first click.

The **Scene** picker stays at the top left, including in focus mode. Choose
the original outdoor pit, a cottage brick fireplace, a grand stone hall
fireplace, or a compact wood stove in a cream-brick alcove. The indoor
places are furnished rooms — stacked cordwood, a tartan rug, mantel and
tools — and switching always starts a new fire, including when
returning to a scene: fuel, queue, coals, ash and the settled pile are discarded.
Pause, burn speed, sound and automatic tending keep their current settings.

| Scene | Maximum pieces | Fuel that fits |
| --- | ---: | --- |
| Outdoor pit | 7 | All existing fuel types and sizes |
| Home fireplace | 5 | Shorter cuts; no stumps |
| Grand fireplace | 6 | Larger cuts; no stumps |
| Wood stove | 3 | Small logs and kindling only |

Indoor cuts are limited in length and thickness, with a low initial stack.
The same limits apply to the queue, manual additions, random fuel and automatic
tending. A full mouth accepts more fuel once a piece becomes ash. Fixed mouth
contacts contain settling wood, and flames, smoke, steam and sparks stay in
the opening. The original still-study gallery keeps its outdoor compositions;
choosing another place there returns to the animated fire.

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
  only when the wood that can still catch runs low (a log that rolled to the
  edge of the pit does not count), never onto a roaring fire, never onto a bed
  too cold to light it and never with two pieces already waiting to catch, so
  a modest fire lasts as long as the page is open at any burn speed. Untick
  it for manual tending: nothing is added unless you feed it, and the fire
  can burn down to cold ash. That choice is remembered with sound and focus.
- **Wood pops.** Wet, flaming wood pops most (a fresh log spits for a while
  after it catches). Each pop throws a tight burst of sparks from the actual
  log surface, spikes the firelight and cracks in the audio, all from one
  event. The fire is not evenly restless: a slow, seeded mood gives it spells
  of quick pops and stretches of twenty seconds to a minute or two with none,
  and every few minutes a pocket goes off loud, with a shower of embers thrown
  high into the air.
- **Wind.** A seeded wind drifts and occasionally gusts: flames lean, shorten
  and tear downwind, the smoke bends, embers are carried, the light flickers
  more deeply and the fire crackles a little faster.
- **The light breathes.** Firelight flicker is layered noise rather than
  sines, with calm spells and lively ones over tens of seconds and the
  occasional dip as a flame sheet tears away; the main light follows the
  centre of the flames so the shadows on the stones lean with the fire, and
  it reddens as flames die to embers.
- **The clearing catches the glow.** Warm light reaches beyond the stones,
  revealing dirt, gravel and leaves, then contracts as the fire fades. Logs
  char unevenly on the lower, fire-facing sides; thin boards can glow through
  to the top while thick wood keeps a cooler crown.
- **Heat haze and vignette.** Hot air above the flames refracts what is
  behind it; a soft vignette deepens in focus mode.
- **Logs settle.** As wood thins it sinks onto its support continuously.
  Supports burn through and stacks tip and roll; char shells crack and shed
  glowing chunks; the fixed stones stop what rolls. Big logs roll down the
  bowl, char crumbs stay where they land.

Sound: a locally bundled CC0 campfire recording (see
[public/audio/ATTRIBUTION.md](public/audio/ATTRIBUTION.md)) with overlapping
passages so it never loops audibly, plus procedural small cracks, the sharp
crack of a pop, the gunshot and ember sizzle of a loud one, and the muffled
sluff of settling wood. The crackle follows the fire's mood: in a lull the
recording's own clicks are muffled and the close cracks stop; in a lively
spell they bunch into twos and threes. Sound pauses with the fire, in hidden
tabs and when the bed is cold.

## Interaction (optional)

Drag to orbit, scroll to zoom; arrow keys, `+`, `-` and `0` on the focused
canvas. **Look closer** presets frame the logs or the ember bed.

**Add fuel** places a log, small log, kindling, 2×4, stump, pallet slat,
cardboard, crumpled newspaper, or a named wood. In focus mode the plus next to the gear drops a
random kind. **Randomize** starts a new seeded fire. **Burn speed** (0.5×
to 1200×, including 0.75×, 2× and 5×) accelerates only the fuel and heat
clock; flames, smoke, embers, settling and sound keep real time. **Equip
poking stick** to nudge or push wood: click to nudge, hold to push,
right-drag to orbit, **Esc** to put it away. The stick is a crooked,
knotted branch with a charred end whose tip glows brighter after a stroke.

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
  preferences (`src/preferences.js`). Quiet fire counts (`src/fire-stats.js`)
  sit in a collapsed footer log: this browser on the preferences record,
  everyone via `src/global-stats.js` (host `/api/stats` if it returns JSON,
  otherwise Abacus). Footer GitHub link and commit log
  (`src/github-log.js`); prompts backfill in `public/github-log.json`.
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
  `src/fire-poker.js` the stick and `src/poker-stick.js` its geometry;
  `src/focus-mode.js` focus mode.

Tests live in `test/` as `node:test` files and cover the burn model, surface
combustion, settling (including idle cost and sleeping), rocks, twigs, geometry,
the quality governor, wind and pops, GPU layers, audio, preferences, fire
stats (local and global), the texture loader and the GitHub commit log.

## Deploy

`main` → [bonfire.observer](https://bonfire.observer) on VPS-01 via webhook-pull.

CI (`.github/workflows/ci.yml`) tests every push/PR. On a green push to `main`
it POSTs an HMAC-signed, push-shaped payload (`after` = commit SHA) to
`DEPLOY_WEBHOOK_URL`; VPS-01's `deploy.sh` then pulls that SHA itself. Nothing
is rsync'd or SSH'd from CI. If `DEPLOY_WEBHOOK_URL` / `DEPLOY_WEBHOOK_SECRET`
are not set, the notify step warns and exits 0.

Build from the committed lockfile with Node 22 (`npm ci && npm run build`) and
serve `dist/` with a fallback to `index.html` for `/study/...` routes. The app
runs entirely in the browser and needs no runtime environment variables. Global
“fires served” uses Abacus until same-origin `/api/stats` returns JSON; the
page still works if that counter is down (Everyone shows a dash). WebGL 2 is
required.
