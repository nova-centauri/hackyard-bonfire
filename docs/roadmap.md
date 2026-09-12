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

- Authored bark and end-grain emissive masks steer the burn shader's char
  glow (`src/log-burning-material.js`): a per-slot uniform flag is raised when
  a mask loads, so the glow concentrates in the painted fissures; procedural
  masks leave the glow unchanged.
- Long-session variety, first pass: a seeded restlessness envelope gives the
  pops (and the audio's crackle) lively spells and lulls; loud pops with
  ember showers every few minutes; firelight with calm and lively spells and
  brief dips. The page opens in focus mode with a gear that is always
  visible; the poking stick is a modelled branch and pushes harder.

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
