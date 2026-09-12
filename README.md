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

Drag to orbit. Scroll or pinch to zoom. The focused canvas also supports arrow keys, `+`, `-`, and `0` to reset.

Click **Focus mode** in the top bar to fill the window with just the fire. All menus, HUD and navigation disappear, and the poking stick is put away. Move the pointer over the window (or tap on a touchscreen) to reveal a single corner gear; it fades after a short idle period. Click the gear or press **Esc** to restore the interface. **Tab** reaches the gear for keyboard users. The current camera, burn, sound and layer settings continue through focus mode.

Use **Sound off** and the **Volume** slider in the top bar to enable and adjust a quiet campfire soundscape. Sound starts off at a gentle 30% volume setting. A locally bundled CC0 stereo campfire field recording supplies the natural bed, with softened peaks and overlapping, varying passages to avoid an obvious loop. Sparse small cracks sit over it. Rolling and falling wood triggers a separate muffled wood-and-ash scrape/thud. A quiet procedural fallback remains available if the recording cannot load. Sound pauses with playback, when the tab is hidden, or when the fire is cold. Burn speed does not change audio pitch or cadence. See the [recording credit and processing notes](public/audio/ATTRIBUTION.md).

Use **Pause motion** to freeze every moving detail in 07 and 08, then **Play motion** to resume from that instant. Pausing still allows camera movement and layer controls. The original five studies render only when the view changes.

Click **Equip poking stick** beside the fire to tend the wood. Aim at an exposed log: a small ring marks the contact point. **Click to nudge, or hold the left mouse button to keep pushing** away from you and down into the pile. Poking near an end can turn or tip a log. While equipped, **right-drag to orbit** and **scroll to zoom**; click **Put stick away** or press **Esc** to return to normal dragging. Poking pauses with the fire and keeps the same pace at every burn speed. Rocks block both the wood and pokes aimed through them.

## Burn timeline

- **Randomize** resets the current study with new fuel categories, ages, moisture, wood density, placement, starting coal heat and feed timing. It clears the previous cycle's ash and event history, and retains the chosen speed and pause state.
- Choose **Fuel** and click **Add fuel** to place a log, small log, kindling, 2×4 or large stump on the bed. **Next waiting piece** uses the finite queue first, then selects a fresh piece when a spent position is available. **Feed waiting fuel** automatically adds the queue one piece at a time, then stops so the fire can burn out. It never replenishes the queue indefinitely. Fresh fuel favors logs, small logs and kindling, with an occasional 2×4 or large stump.
- Fuel categories change both shape and burn behavior. Kindling catches and burns quickly, small logs burn down sooner than full logs, 2×4s have flat sawn faces, and large stumps retain fuel longer. Each piece still responds to moisture and core heat; a fast-burning category alone cannot ignite a cold bed.
- The **burn speed** control offers **1×, 10×, 30×, 60×, 300× and 1200×**. It accelerates the fuel / heat clock; flame flicker, smoke motion and drifting sparks keep their natural cadence. At 1200×, one real second advances twenty simulation minutes. Pause freezes both clocks.
- Each fuel piece has its own starting and current moisture, shown on its timeline card. Already burning wood retains a little residual moisture. Drying spends wood and core heat; wetter pieces take longer to ignite and consume fuel more slowly.
- **Core heat** shows retained heat as a 0–100% game value, with Cold, Fading, Warming, Healthy and Very hot states. Its heat effect on burn rate rises from 0.65× to 1.75×; a very hot core consumes burning wood faster even when the flame is already at full intensity. Burn speed remains a separate simulation-clock control.
- Each fuel piece dries, catches from neighboring flames or retained coal heat, chars, sheds hot fragments, glows and leaves ash. Wet wood takes longer to catch. Flame height, wood dimensions, surface color, steam, light, smoke and sparks respond to its fuel and heat. Low heat suppresses combustion; fuel added to a cold bed stays unlit.
- Logs rest on the soil and the actual changing surfaces of older logs. As supports thin or burn away, the stack tips, drops and can roll outward or downhill under gravity. Fixed stones stop rolling wood and char fragments, while the gaps and tops of the individual stones remain physical spaces. Contacts exchange linear and angular momentum regardless of arrival order; friction and sleeping keep settled fuel quiet. Weakened char gives way at a damaged section, leaving a notch and releasing solid chunks that collide with the pile and ground; hot impacts scatter a burst of embers, briefly brighten the bed and trigger a soft settling sound when sound is on. These movements use real time even during accelerated burning. Small forked twigs tip inward and land on the gray soil as their support disappears, keeping their attached glow with them.
- The timeline identifies each piece's category and displays its current phase, remaining wood and char, moisture and time on the bed, alongside core heat and recent ignition / shedding / ash events. Ash persists when a position receives another piece. The timing of low flames, embers and cooling depends on fuel category, moisture, density, the heat of the core and the feed schedule.

This is an art-directed fuel and heat model with normalized heat, not a calibrated thermodynamic model. Slow rates are collected in `src/lifecycle.js`, with category dimensions and thermal multipliers in `src/fuel-types.js`, for tuning. Integration uses fixed half-second steps so accelerated playback follows the same burn as real-time playback.

Each log carries 40 surface regions with their own heat, moisture, wood and char. The side facing the fire and the central sections burn first; exposed ends can remain dark, and a piece that rolls away cools with its existing burn pattern intact. Incandescent charcoal plates have irregular sizes, warped grain and varied crack widths; larger heat patches connect their colors without a regular tiled pattern. They remain visible through a clearer core as mature fuel produces less luminous gas. Fresh wood restores stronger flames after it heats and dries.

Flame detail rises through three-dimensional eddies and narrowing, round tongues. Independent smooth source variation replaces synchronized swaying, and volume bounds follow burning logs outside the pile. Gas and rigid-body motion use real seconds, independently of accelerated fuel consumption. See [fire behavior and physics notes](docs/fire-physics.md) for references, implementation details and limits.

Animation runs on a single time-based loop targeting 30 fps. Log contacts and falling embers update each frame. The bed uses 76 chipped, angular coals concentrated in the center, with independent retained heat and a subtle surface shimmer; isolated coals cool faster. Accumulating gray ash shades the existing ground, and nearby hot coals warm it through a small heat texture refreshed at most five times per second. This replaces 750 separate ash instances without adding draw calls. Stable geometry retains its instance buffers and depth texture; depth changes use a simple depth-only material, and shadows update at most five times per second. Hidden tabs suspend both clocks and resume without a time jump. Animated scenes cap pixel density at 1.5 and the main render at 1.5 million pixels, retaining four-sample offscreen antialiasing for smooth rock/log edges. The browser chooses its graphics power preference, and the canvas does not retain an extra drawing buffer. Original studies and paused scenes render only when needed.

Animated fire uses 88 ray samples inside bounds fitted to active fuel, with three noise octaves and contact noise evaluated only beside burning wood. Animated smoke uses 40 samples (previously 52) and skips empty or extinguished regions. Turning off Fire glow skips the bloom passes completely. These bounds reduce rendering work without increasing the frame rate or adding downloaded textures.

```sh
npm test
```

Tests cover deterministic reset, accelerated-time equivalence, finite whole-log feeding, ignition and burn-out, support-aware settling and impact behavior, twig attachment, moisture-dependent ignition and consumption, core-heat acceleration, closed log-end geometry, unchanged-buffer reuse, depth invalidation when fuel moves, and audio playback state.

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

WebGL 2 is required. All geometry, textures and shaders are generated locally. The campfire recording is bundled with the app and loads only after sound is enabled; playback makes no third-party asset requests. The volume shader clips against a depth texture of the opaque scene so the logs correctly occlude the flame and smoke.

`src/styles.js` contains the art directions. `src/scene.js` builds the scene and manages playback. `src/lifecycle.js` owns fuel, heat transfer and the finite feed queue; `src/burn-visuals.js` maps that state to individual logs, flames, falling char and ash; `src/burn-panel.js` presents the timeline and controls. `src/log-geometry.js` builds sealed uneven log profiles, knotted bark, exposed wood and closed peeling strips. Both cut faces use the end-grain material; caps share the deformed trunk rim. `src/log-settling.js` resolves changing log contacts, angular motion, gravity and char fragments. `src/log-combustion.js` tracks local surface fuel and heat; `src/log-burning-material.js` renders incandescent plates, and `src/log-damage.js` keeps damaged mesh surfaces and fragment rendering aligned with the physics. `src/ground.js` builds the shallow dirt bowl and fades its firelit surface into black; `src/rocks.js` generates individually shaped smooth stones with mineral variation and soot. `src/coal-bed.js` builds clustered charcoal pieces and tracks their local heat; `src/coals.js` shades incandescent faces and cooling crust. `src/ash-bed.js` grows persistent ground ash and local ember halos. `src/fire-audio.js` mixes the bundled campfire recording with quiet procedural cracks and wood/ash settling sounds. `src/focus-mode.js` manages the immersive fire view and the returning corner gear. `src/motion.js` advances gas, particles, steam and lighting. `src/volume.js`, `src/hybrid-fire.js` and `src/stylized.js` define the flame and smoke treatments. Textures and geometry are procedural and seeded. The animated scenes use warm, distance-limited firelight, a black background, temperature-colored flame interiors, subtle blue combustion roots, and smoke that disappears beyond the light.

## Cold-start minigame

The next gameplay phase is described in [the cold-start plan](docs/cold-start-minigame.md): build an empty pit with tinder/kindling and selected logs, use an optional finite starter, ignite with a lighter/match/flint, and tend the fragile fire with kindling and short blowing actions. The plan defines state transitions, finite supplies, airflow, recovery, and a first playable milestone. Those controls are planned; current studies still start with an established fire.
