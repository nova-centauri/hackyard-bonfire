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

## Next

1. **Volumetric resolution**: render fire and smoke at half resolution with a
   depth-aware upsample on Medium and below. Largest remaining GPU lever.
2. **Long-session variety**: occasional larger events (a log splitting along
   its length, a stack collapse with a spark shower) on a slow schedule; a
   very slow drift of the ambient colour temperature with the fire's age.
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
  burn-hours at 30×, 60×, 300× and 1200× (flames present about 96% of the
  time, at most five pieces on the bed); 10× hot through its first two hours
  and 1× through its first hour when this was written. Before the fix the
  same loop went cold at 70 burn-minutes at 1× and 81 at 30×.
- 2026-09-12 — Fixed the twig nest tipping onto its side: the instanced
  twig draw sits in the twig group and the settling scan mistook it for a
  29th twig, rotating and lifting the whole nest within two seconds of every
  fire. Settling now ignores instanced meshes; regression test mirrors the
  scene's build order.
