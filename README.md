# Bonfire — studies in fire

Seven interactive Three.js scenes for comparing bonfire rendering styles. Every study has a direct URL and supports orbiting, zooming, close-up camera presets, and separate flame, smoke, steam, spark, and bloom controls. The collection switch separates the original five still studies from animated studies 07 and 08, which combine Ink & Wash materials with a Cinematic atmosphere.

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
| 07 — Living contours | http://127.0.0.1:5186/study/living-contours | Gently unfolding luminous flame, rising smoke, sparks and steam |
| 08 — Wild draft | http://127.0.0.1:5186/study/wild-draft | Faster wind-curled flames, turbulent breakup and drifting embers |

The root URL opens Living contours. Study 06 has been removed; its former link also opens Living contours. Studies 07 and 08 keep their original numbers and share the same seeded fuel bed, materials, camera and atmosphere. Their animated volume fields follow the original Ink & Wash centerlines and tapered profiles, with different density and temperature models. A thin layer of moving combustion follows the logs' surfaces. The original five scene configurations remain available at their existing URLs.

Drag to orbit. Scroll or pinch to zoom. The focused canvas also supports arrow keys, `+`, `-`, and `0` to reset. Use **Pause motion** to freeze every moving detail in 07 and 08, then **Play motion** to resume from that instant. Pausing still allows camera movement and layer controls. The original five studies render only when the view changes.

Animation runs on a single time-based loop targeting 30 fps. Flames and smoke flow upward through their shaders; sparks and steam recycle with soft fades; flame sheaths and lighting flicker gently. Depth and shadows of the stationary fuel bed are reused across animation frames. Hidden tabs suspend rendering and resume without a time jump. Animated scenes cap pixel density at 1.25 to keep the detailed volumes responsive.

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

`src/styles.js` contains the art directions. `src/scene.js` builds the scene and manages playback, and `src/motion.js` advances particles, steam, fire uniforms and lighting. `src/volume.js` defines the original volumetric shaders, `src/hybrid-fire.js` defines the two animated flame treatments, and `src/stylized.js` defines the sculpted flames and flame-wrapped twigs. Bark and end-grain textures are procedural and seeded.
