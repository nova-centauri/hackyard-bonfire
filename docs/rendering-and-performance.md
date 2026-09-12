# Rendering and performance

The fire is meant to be left open for hours on whatever machine the viewer
has, in whatever window size they choose. Cost therefore has to scale with
two things the viewer controls without knowing it: how many pixels the fire
covers and how fast the machine is. This document describes the frame, the
level-of-detail system that scales it, the idle-cost work on the simulation,
and how to measure all of it.

## The frame

1. **Simulation** (main thread, only while playing): the burn clock advances
   in fixed half-second steps (`src/lifecycle.js`); rigid-body settling runs
   at 120 Hz real time (`src/log-settling.js`); pops, weather, twig collapse
   and the burn atlas update (`src/burn-visuals.js`, `src/motion.js`).
2. **Depth pre-pass**: the opaque scene is rendered with a depth-only
   material into a depth texture that the volumetric shaders clip against.
   It is re-rendered only when the camera moves or something opaque moves by
   more than a fraction of a pixel (sub-millimetre burn shrinkage does not
   count), so a settled fire skips it.
3. **Shadow map** (point light, 6 faces): refreshed at a cadence set by the
   quality tier (every frame on Ultra, 100 ms on High, never after the first
   on Minimal) and whenever wood moves.
4. **Colour pass** into a half-float MSAA target: soil, stones, coals, wood,
   instanced twigs, then the transparent layers in render order: steam
   billboards, the ray-marched fire volume, contact flames, embers, smoke.
5. **Bloom** (UnrealBloomPass, at a fraction of the frame on lower tiers),
   **OutputPass** (ACES tone mapping, sRGB), and the **finish pass**: heat
   haze refraction above the flames, vignette, film grain.

Draw calls per frame in the animated studies are about 190 including the
shadow and depth passes (down from about 630): embers are two draws, steam
one, twig segments one, twig glows one.

## Wood surfaces and surrounding light

The burn atlas carries uneven heat and char in coordinates attached to each
piece. Direct exposure favors the lower, inward-facing surface; heat reaches
the opposite face more readily through thin boards. A cool upper crust does
not hide the plume: its strength samples the whole emitting axial band.
This is a visual combustion approximation, not calibrated thermochemistry.

Procedural char plates have a stable seed per piece and a ragged advancing
front. Bark and sawn faces vary along the wood; end grain uses planar
coordinates. Small derivative-based normal relief layers over the authored
wood normals, letting spent charcoal catch moving light without new geometry.

Soil, gravel and leaves share a wider diffuse firelight pool in their
existing material shaders. Surface color and bumped normals keep the dirt's
texture visible; the added light requires no extra draw, light source or
render pass. The existing point light also reaches farther. Flame intensity
and flicker drive the broad pool, while the smaller coal pool fades with
both heat and remaining coal mass.

Log-end moisture uses fifteen staggered, overlapping wisps per log in the
same instanced draw. A soft density field supplies the shape; the puff
texture adds subtle variation without opaque white islands. The wisps share
the fire's wind and disappear as the wood dries. The main smoke volume
catches light closer to the flame tips, then fades to dim gray scattering
higher up. Its light follows flames and remaining hot coals independently
of the smoke amount, with unchanged ray-march sample budgets.

## Level of detail

`src/quality.js` defines five tiers. Everything in a tier is a runtime value
(uniforms, target sizes, cadences), so switching tiers never recompiles a
shader; only a change of MSAA sample count rebuilds the composer target.

| Tier | Pixel ratio cap / budget | Fire steps | Smoke steps | Octaves | MSAA | Bloom | Shadow map / refresh | Embers | Heat haze |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ultra | 2.0 / 3.2 MP | 112 | 48 | 3 | 4× | full | 1024² / every frame | 100% | yes |
| High | 1.5 / 1.5 MP | 88 | 40 | 3 | 4× | full | 512² / 100 ms | 100% | yes |
| Medium | 1.25 / 1.0 MP | 64 | 28 | 3 | 2× | ¾ res | 512² / 250 ms | 85% | yes |
| Low | 1.0 / 0.6 MP | 44 | 20 | 2 | off | ½ res | 256² / 500 ms | 70% | yes |
| Minimal | 0.75 / 0.3 MP | 28 | 12 | 2 | off | off | 256² / static | 50% | no |

Minimal also drops the surface-combustion sheath and runs at 24 fps instead
of 30.

**Size cap.** The canvas size in CSS pixels caps the tier: 900k px² and up
can reach Ultra, 400k High, 150k Medium, 60k Low, below that Minimal. A
1280×800 focus-mode window starts on High; a 400×300 window runs Low and
costs roughly a twentieth of the old fixed configuration per frame. The
drawing buffer is additionally bounded by the tier's pixel budget, so a 4K
retina window on Ultra renders 3.2 megapixels, not 33.

**Governor.** `QualityGovernor` watches the interval between drawn frames
and the main-thread time per frame. It steps one tier down when the 75th
percentile interval exceeds the 33 ms target by 25% for a sampling window
(about 3 s), after a 3 s settle that ignores shader-compile spikes. It steps
up only after a delay (8 s initially) when pacing is steady and the main
thread is idle, never above the size cap; if an upgrade is followed by drops
within 30 s it reverts and doubles the delay, up to two minutes. Resizes,
scene switches and tier changes reset its window. Hidden tabs feed it
nothing.

**Overrides and inspection.** `?quality=low` (any tier name) pins a tier.
The stage element exposes `data-quality-tier`, `data-quality-reason`,
`data-fire-steps`, `data-render-size`, `data-draw-calls` and
`data-depth-passes`; the console logs each tier change.

## Idle cost of the simulation

The settling solver used to cost about 5.5 ms per frame on one core while
nothing visibly moved, because every half-second burn step shrank the logs
by more than the 20 µm wake threshold and reset the sleep timer just before
it fired. The pile now sleeps:

- A sleeping piece accumulates radius shrink and wakes only after about
  2.5 mm (length shrink opens no gap), sinks the gap through a speculative
  contact, and sleeps again after 0.2 s.
- Sleeping bodies get no contact tests and act as static in the solver; they
  wake on a hard approach (faster than a shrink settle), real penetration, or
  a support that starts moving.
- Round wood touches the ground along the true lowest line of each
  cross-section ring, sampled from the log profile, rather than a 16-sided
  prism, and rolling resistance is solved as a bounded angular impulse beside
  friction. The contact skin is only for detection; wood rests on the soil.
  Big logs still roll downhill; char crumbs stay where they land.

Settled cost is now about 1 ms per frame with the pile asleep 80–90% of the
time. The regression test in `test/settling-rest.test.js` bounds terrain
samples per frame and the awake fraction.

## Cost while wood moves

The twelve contact-solver iterations reuse temporary vectors and
quaternions. Normal effective mass is computed once per constraint, after
all contact-triggered wakes, because the poses and lever arms remain fixed
during the velocity solve. Friction and rolling resistance still respond to
the changing velocities on every iteration.

In a deterministic fixture with three falling/rolling logs over 120 frames,
vector clones fell from 546,876 to 84,799 (84.5% fewer) and quaternion clones
from 160,964 to zero. Across 30 alternating warmed runs, median total CPU
time fell from 18.77 ms to 16.65 ms (11.3%). Positions, rotations and velocities
were unchanged. These are CPU fixture measurements, not browser frame-rate
gains; `test/settling-performance.test.js` checks the allocation budget and
compares isolated and interleaved simulations within the same runtime.
It avoids a platform-specific golden trajectory and timing assertions.

The combustion model also caches geometric exposure while a pose and fuel
shape remain unchanged. Accelerated burn steps reuse the surface positions,
thicknesses and exposure instead of rebuilding them; heat and fuel still
advance on every fixed step. No timing gain is claimed for this cache.

## Measuring

- `npm test` runs the pure-logic suite in about ten seconds; the settling
  cost test fails if the pile stops sleeping.
- The physics micro-benchmark used during this work lives in the session
  scratch notes rather than the repo; the shape is: build a `BurnCycle`, a
  `createLogSettling` state with the scene definitions and `groundHeight`,
  step both at 30 fps for 60 simulated seconds, and time it.
- Headless Chromium with SwiftShader (`--use-angle=swiftshader`) renders the
  real shaders at a fraction of a frame per second: useful for shader-compile
  errors, draw-call counts, tier selection and screenshots, useless for
  frame-time numbers. Read the stage `data-*` attributes after
  `data-ready="true"`.
- With the dev server running, open `/test/browser/ember-trails.html` for the
  GPU trail regression. WebGL2 transform feedback runs the actual trail
  vertex shader at seven birth/recycling times and checks that a new ember
  cannot connect to its previous life. The old formula is a negative
  control. Completion sets the document's `data-ready="true"` and
  `data-passed="true"`; `#report` contains the numeric results.
- `/test/browser/smoke.html` renders the real smoke and steam shaders into
  small offscreen targets, checking extinction, lighting, wind, and similar
  smoke brightness across sample budgets. It uses the same completion fields.
- On real hardware, `renderer.info.render.calls` is exposed as
  `data-draw-calls`, and the governor's decisions are logged. A frame that
  cannot fit in 33 ms on a 60 Hz display shows as 50 ms intervals and will be
  stepped down within a few seconds.

## Known costs and next steps

- The point-light shadow renders six faces of every caster; on Ultra that is
  every frame. The instanced twigs cut its draw count by two thirds.
- The instanced twig draw is a child of the twig group so it inherits the
  group's visibility and local space. Anything that scans that group for
  twigs (`createTwigSettling`) must skip instanced meshes; treating the draw
  as a twig once rotated the entire nest onto its side.
- The ray-marched fire is still the dominant GPU cost at any tier; the next
  lever, if needed, is rendering the volumetrics at half resolution with an
  upsample, which would need a separate pass rather than the current single
  colour pass.
- Awake physics now reuses solver storage and invariant normal effective
  masses, but contact detection still runs several times per substep during
  landings, pokes and collapses. It remains a useful profiling target if
  interaction stutters on a slow machine.
- The depth pre-pass and shadow map still re-render on about a third of
  settled frames (measured 35% over 70 s of a seeded fire at 1×): the brief
  shrink-settle wakes of logs (about half) and char fragments (the rest) move
  geometry by more than the 0.4 mm threshold. Shortening the re-settle timer
  did not change it, because it is real motion. The levers are a larger
  shrink-wake gap (fewer, bigger settles) and letting fragments sink without
  waking their neighbours; both trade a little physical fidelity for fewer
  passes and were left as they are.
