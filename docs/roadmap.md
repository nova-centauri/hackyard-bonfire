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

Known gap after this pass: the authored bark and end-grain **emissive masks**
load and report `applied`, but the living studies' burn shader
(`src/log-burning-material.js`) overwrites the emissive term with its own
procedural crack glow, so the masks change nothing on screen there. A small
gated change (a per-slot flag raised when an authored mask loads, multiplying
the plate glow by the sampled mask) was drafted and held back for review; it
is item 6 below.

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
6. **Authored emissive masks in the burn shader**: read the emissive texel in
   the plate-glow term when an authored mask is present, so the painted
   fissures are where the char shines. Uniform-gated, no recompile.
7. **Texture payload**: the authored set is about 19 MB, most of it the two
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
