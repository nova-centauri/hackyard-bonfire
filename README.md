# Bonfire — studies in fire

Seven interactive Three.js scenes for comparing bonfire rendering styles. Every study has a direct URL and supports orbiting, zooming, close-up camera presets, and separate flame, smoke, steam, spark, and bloom controls. The original five are still studies. Studies 07 and 08 combine Ink & Wash materials, a Cinematic atmosphere, an earthen clearing, and a complete interactive burn cycle. Both use 08's natural motion cadence.

## Run

```sh
npm install
npm run dev
```

The dev server uses **http://127.0.0.1:5186/**.

| Study | Direct link | Technique |
| --- | --- | --- |
| After dark | http://127.0.0.1:5186/study/cinematic | Depth-clipped, ray-marched fire and smoke; rough charred wood |
| Wild geometry | http://127.0.0.1:5186/study/faceted | Colored polygonal flames and geometric smoke |
| Field notes | http://127.0.0.1:5186/study/ink | Translucent toon surfaces, line contours, hatching and paper grain |
| Liquid light | http://127.0.0.1:5186/study/glass | Twisted physical-material ribbons, bright edges and reflective surfaces |
| The last heat | http://127.0.0.1:5186/study/embers | Lower flames, collapsed logs, pale ash and exposed incandescent charcoal |
| 07 — Living contours | http://127.0.0.1:5186/study/living-contours | Luminous folds, individual fuel lifecycles and accumulated ash |
| 08 — Wild draft | http://127.0.0.1:5186/study/wild-draft | Wind-curled flames, heat-driven ignition and complete burn-out |

The root URL opens Wild draft (08). Study 06 has been removed; its former link also opens 08. Studies 07 and 08 keep their original numbers and share the same default fuel seed, materials, camera and atmosphere. The fire retains the tapered Ink & Wash profiles with a different density treatment for each study. Every flame source belongs to a log and follows that log as it settles, shrinks and burns away. Surface combustion hugs the changing log radius. The original five configurations remain available at their existing URLs.

Drag to orbit. Scroll or pinch to zoom. The focused canvas also supports arrow keys, `+`, `-`, and `0` to reset. Open **Scene layers** and click **Sound off** to enable fire audio and adjust its volume. Audio starts off; enabling it adds locally synthesized low fire rumble, irregular crackles, and a woody pop timed to log impacts and ember bursts. Sound pauses with playback, when the tab is hidden, or when the fire is cold. Burn speed does not change audio pitch or cadence.

Use **Pause motion** to freeze every moving detail in 07 and 08, then **Play motion** to resume from that instant. Pausing still allows camera movement and layer controls. The original five studies render only when the view changes.

## Burn timeline

- **Randomize** resets the current study with new fuel ages, moisture, wood density, log placement, starting coal heat and feed timing. It clears the previous cycle's ash and event history, and retains the chosen speed and pause state.
- **Add one log** places a whole, unburned log on the bed. **Feed waiting logs** automatically adds the finite queue one at a time, then stops so the fire can burn out. It never replenishes the queue indefinitely. A used position can be fed manually after its previous log becomes ash.
- The **burn speed** control offers **1×, 10×, 30×, 60×, 300× and 1200×**. It accelerates the fuel / heat clock; flame flicker, smoke motion and drifting sparks keep their natural cadence. At 1200×, one real second advances twenty simulation minutes. Pause freezes both clocks.
- Each log dries, catches from neighboring flames or retained coal heat, chars, sheds hot fragments, glows and leaves ash. Wet wood takes longer to catch. Flame height, log radius, surface color, steam, light, smoke and sparks respond to its fuel and heat. Low heat suppresses combustion; a log added to a cold bed stays unlit.
- Logs rest on the soil and the actual changing surfaces of older logs. As supports thin or burn away, the stack tips, drops and rolls inward under gravity. Weakened char occasionally gives way; hot impacts scatter a burst of embers, briefly brighten the bed and trigger a woody pop when sound is on. These movements use real time even during accelerated burning.
- The timeline displays each log's current phase, remaining wood and char, arrival time, coal heat, and recent ignition / shedding / ash events. Ash persists when a position receives another log. The default batch typically reaches low flames after about 25 simulation minutes, followed by a longer ember and cooling phase; seeded variations differ.

This is an art-directed fuel and heat model with normalized heat, not a calibrated thermodynamic model. Slow rates are collected in `src/lifecycle.js` for tuning. Integration uses fixed half-second steps so accelerated playback follows the same burn as real-time playback.

Animation runs on a single time-based loop targeting 30 fps. Log contacts and falling embers update each frame; accumulated ash updates at 15 Hz. Depth is rebuilt as geometry moves, and shadows update at most five times per second. Hidden tabs suspend both clocks and resume without a time jump. Animated scenes cap pixel density at 1.5 and use a multisampled offscreen target to smooth geometry through the bloom pipeline. Original studies and paused scenes render only when needed.

```sh
npm test
```

Tests cover deterministic reset, accelerated-time equivalence, finite whole-log feeding, ignition and burn-out, support-aware settling and impact behavior, twig attachment, and audio playback state.

## Build

```sh
npm run build
npm run preview
```

## Deploy

`main` → [bonfire.observer](https://bonfire.observer) on VPS-01 via webhook-pull.

CI (`.github/workflows/ci.yml`) tests every push/PR. On a green push to `main`
it POSTs an HMAC-signed, push-shaped payload (`after` = commit SHA) to
`DEPLOY_WEBHOOK_URL`; VPS-01's `deploy.sh` then pulls that SHA itself. Nothing
is rsync'd or SSH'd from CI. If `DEPLOY_WEBHOOK_URL` / `DEPLOY_WEBHOOK_SECRET`
are not set, the notify step warns and exits 0.

Use Node.js 22 (22.12 or newer), matching the existing CI configuration. Build
the app from the committed lockfile:

```sh
npm ci
npm run build
```

Serve the generated `dist/` directory as the web root. Configure the web server
to fall back to `index.html` for application routes such as `/study/wild-draft`,
so direct links and refreshes work. The app runs entirely in the browser and
requires no runtime environment variables or backend service.

## Rendering

WebGL 2 is required. All geometry, textures and shaders are generated locally; there are no external asset requests. The volume shader clips against a depth texture of the opaque scene so the logs correctly occlude the flame and smoke.

`src/styles.js` contains the art directions. `src/scene.js` builds the scene and manages playback. `src/lifecycle.js` owns fuel, heat transfer and the finite feed queue; `src/burn-visuals.js` maps that state to individual logs, flames, falling char and ash; `src/burn-panel.js` presents the timeline and controls. `src/log-settling.js` resolves changing log contacts and gravity. `src/ground.js` builds the shallow dirt bowl and fades its firelit surface into black; `src/rocks.js` generates individually shaped smooth stones with mineral variation and soot. `src/coals.js` shades incandescent seams and cooling charcoal. `src/fire-audio.js` synthesizes ambience and impact sounds without audio downloads. `src/motion.js` advances gas, particles, steam and lighting. `src/volume.js`, `src/hybrid-fire.js` and `src/stylized.js` define the flame and smoke treatments. Textures and geometry are procedural and seeded. The animated scenes use warm, distance-limited firelight, a black background, temperature-colored flame interiors, subtle blue combustion roots, and smoke that disappears beyond the light.
