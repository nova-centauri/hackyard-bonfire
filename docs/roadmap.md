# Roadmap and work log

This file is the planning record for the project. Update it when direction
changes, when a pass of work lands, or when something is deferred.

## Direction

A bonfire in the browser that sets a good vibe: the flickering warm light and
the sound of wood cracking and popping, delivered to a desktop that is mostly
left open. Priorities, in order: rendering quality, performance across window
sizes and machines, richness and variation over long viewing, and only then
interaction (add a log, poke the fire). No new demands are placed on the
viewer: no accounts, no setup, no required settings.

## Status (September 2026 pass)

Done in this pass:

- Idle simulation cost cut from about 5.5 ms to about 1 ms per frame; the
  settled pile sleeps and wood sinks continuously as it burns instead of
  hovering and dropping (`docs/rendering-and-performance.md`).
- Level-of-detail tiers with a window-size cap and a frame-pacing governor
  (`src/quality.js`).
- Draw calls per frame roughly 630 → 190: GPU embers and trails, instanced
  steam, instanced twigs and glows.
- Wind with gusts, wood pops synchronized across sparks, light and sound,
  1/f firelight flicker with a moving light, heat-haze refraction, vignette.
- The fire is kept tended by default so it survives a long session; focus
  mode, sound and volume are remembered.
- Texture pipeline groundwork: manifest, loader, authoring brief
  (`docs/textures.md`); procedural bark generation no longer allocates nine
  million strings at startup.
- Authored textures for bark, end grain, exposed wood, soil and steam, with
  OpenGL normals; bark normal is the lighting gain.
- Patchy char forms first on lower, inward-facing wood; heat crosses thin
  boards more readily than thick logs. Raised char plates catch firelight,
  sawn faces vary along the wood, and end grain keeps its separate mapping.
- A wider warm light pool reveals the dirt, gravel and leaves beyond the
  stones, using their existing material passes. Coal light fades with the
  remaining hot mass.
- Moving-log contacts reuse solver storage and invariant effective masses:
  84.5% fewer vector clones and 11.3% less CPU time in the measured landing
  fixture, with unchanged trajectories (`docs/rendering-and-performance.md`).
  Surface exposure is also reused across burn steps with unchanged geometry.

- Authored bark and end-grain emissive masks steer the burn shader's char
  glow (`src/log-burning-material.js`): a per-slot uniform flag is raised when
  a mask loads, so the glow concentrates in the painted fissures; procedural
  masks leave the glow unchanged.
- The tended fire no longer goes out. Reported as "the fire dies at 10× and
  30×", but it died at every speed (70 burn-minutes at 1×, so nobody saw it
  in real time): the live wood positions gave the pile three quarters of the
  heat coupling the burn model was tuned for, a log that rolled to the edge
  still counted as fuel so tending stopped, and at 300× and above each fresh
  piece was dropped onto the previous one while it was still falling, stacking
  wood 20 m into the air. Coupling is now normalised to the mean designed
  slot, tending counts only wood that can catch (at most two pieces waiting),
  a falling piece keeps its last resting pose for the burn, and arrivals are
  dropped onto the settled pile. A viewer-loop test (`test/tended-fire.test.js`)
  runs 75 burn-minutes at 1200× with real settling and poses.
- Long-session variety, first pass: a seeded restlessness envelope gives the
  pops (and the audio's crackle) lively spells and lulls; loud pops with
  ember showers every few minutes; firelight with calm and lively spells and
  brief dips. The page opens in focus mode with a gear that is always
  visible; the poking stick is a modelled branch and pushes harder.

## This pass (watchable fire)

Geometry, settling and lighting for the observer fire: logs read as wood
(bark ridges, sawn checked ends), they sit on the soil and on each other
instead of hovering or sinking, and their lower surfaces become uneven,
glowing char. Thin boards can heat through to their upper faces. Firelight
stays near the flames while a broader diffuse pool reveals the surrounding
soil. This remains an ambient campfire, with no new controls or activities.

## Next

1. **Volumetric resolution**: render fire and smoke at half resolution with a
   depth-aware upsample on Medium and below. Largest remaining GPU lever.
2. **Long-session variety**: the restlessness envelope and loud pops are in;
   still to come are the larger events (a log splitting along its length, a
   stack collapse with a spark shower) on a slow schedule and a very slow
   drift of the ambient colour temperature with the fire's age.
3. **Ash and coal continuity**: coals should be replenished from shed char in
   place over hours (mass exists in the model; the bed geometry only shrinks).
4. **Audio**: a second field recording for variety, and a low-level breath of
   wind tied to gusts.
5. **Cold-start minigame** remains planned (`docs/cold-start-minigame.md`);
   it is interaction work and comes after the ambient experience is finished.
6. **Texture payload**: the authored set is about 19 MB, most of it the two
   PNG normals. The soil normal is viewed from a distance and could drop to
   1024² without visible loss; bark should stay 2048².

## Deferred or rejected

- Reducing the target frame rate below 30 fps on small windows: the flicker
  cadence is the product; the tiers cut per-pixel work instead.
- Screen wake-lock: would keep a laptop screen on indefinitely; left to the
  operating system.
- Replacing the procedural stones with textured ones: needs UVs or triplanar
  mapping; wood textures are in, so this is the remaining material gap.

## Work log

- 2026-09-12 — Physics sleep and continuous settling; exact ring ground
  contact; rolling resistance in the solver; coarser depth invalidation.
- 2026-09-12 — Quality tiers and governor; dynamic ray-march steps.
- 2026-09-12 — GPU embers, instanced steam and twigs.
- 2026-09-12 — Wind, pops, noise flicker, moving light, heat haze, vignette.
- 2026-09-12 — Tending by default; remembered preferences.
- 2026-09-12 — Texture manifest and loader; texture brief; docs refresh.
- 2026-09-12 — Authored PBR set (bark, end grain, exposed wood, soil, steam
  puff). Albedo from Grok Imagine; OpenGL normals baked from height. Bark
  normal is the intended lighting gain.
- 2026-09-12 — Texture branch reviewed against the loader and rendered
  headlessly (all slots applied, no shader errors); merged to main.
- 2026-09-12 — Authored emissive masks wired into the burn shader's char
  glow behind a per-slot flag; verified headlessly (no shader errors, flag
  reaches the compiled programs).
- 2026-09-12 — Fixed the tended fire going out at every burn speed: heat
  coupling recalibrated to the settled pile, tending counts only wood that
  can catch, falling wood keeps its last resting pose for the burn, and new
  pieces are dropped onto the settled pile rather than onto one still in the
  air. Measured headlessly with the viewer loop: never cold over four
  burn-hours at 10×, 30×, 60×, 300× and 1200× (flames present 95–97% of the
  time, bed heat never below 0.6, at most five pieces on the bed) and over
  two burn-hours at 1× (flames 90% of the time). Before the fix the same
  loop went cold at 70 burn-minutes at 1× and 81 at 30×.
- 2026-09-12 — Fixed the twig nest tipping onto its side: the instanced
  twig draw sits in the twig group and the settling scan mistook it for a
  29th twig, rotating and lifting the whole nest within two seconds of every
  fire. Settling now ignores instanced meshes; regression test mirrors the
  scene's build order.
- 2026-09-12 — Restlessness: `fireActivity` in `src/pops.js` scales the pop
  rate (mean 1, cap 2.8, zero about a fifth of the time; thinned scheduling
  so lulls leave no stale pop). Loud pops (about one in twenty, forty seconds
  apart) throw 70–160 embers and get a crack, deep knock and sizzle of their
  own. The audio follows the same envelope: a low-pass on the recording bed
  closes to 1.3 kHz in a lull to muffle its clicks, close cracks stop in a
  lull and bunch in a lively spell. Firelight amplitude .22 plus a slow
  lively envelope and rare dips (was a steady .16). Poking stick rebuilt as
  a swept branch (`src/poker-stick.js`), push strength .6 → .9. Preferences
  moved to a v2 key so focus mode is the default for everyone; the gear
  rests at 38 % opacity, stays clickable, and no longer hides when the
  pointer crosses the window edge.
- 2026-09-12 — Newspaper is a crumpled wad that burns straight to ash
  (no charred/glowing path). Named woods — hickory, maple, oak, spruce,
  birch, white birch, pine, cedar, walnut — have their own bark, grain
  and burn pace. Pallet slats and cardboard stay. Random-feed includes
  every kind; auto-feed stays generic wood.
- 2026-09-12 — Scrap fuel on the existing feed queue: pallet slats, cardboard
  and newspapers, each with its own size, look, moisture, heat, flame, char
  and mass. Auto-feed stays mostly wood; a plus beside the focus-mode gear
  drops a uniform random kind. **Keep the fire fed** is now a remembered
  preference (manual tending lets the fire go out). Burn speed gains 0.5×,
  0.75×, 2× and 5× alongside the existing steps.
- 2026-09-12 — Watchable fire: bark ridges, sawn/checked ends; ground
  contacts rest on the soil instead of a 12 mm skin; round-wood contacts
  use the rendered profile so logs no longer sink into a 16-gon hull;
  firelight stays in the pit, coals keep a warm pool during dips, night
  fill is warmer and less blue.
- 2026-09-12 — Footer GitHub link and a collapsed recent-commit log; prompt
  slots backfill from `public/github-log.json` (none invented).
- 2026-09-12 — Surface and light review: lower/inward heat exposure, uneven
  carbonization and thickness-dependent heat transfer; separate sawn-face
  and end-grain char mapping with subtle normal relief. Gas from the lower
  face still feeds the flame above. Wider textured dirt illumination uses
  existing draws and lights. Contact-solver scratch reuse and invariant
  caching preserve trajectories while reducing allocations and fixture CPU
  cost; exposure caching avoids rebuilding unchanged surface geometry.
- 2026-09-12 — Ember trails start at the current particle's birth instead of
  connecting to its previous lifetime. A browser test executes the actual
  vertex shader at birth and recycling boundaries, including the old formula
  as a failing comparison (`test/browser/ember-trails.html`).
