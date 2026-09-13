# Home Fireplace — optional authored texture pass

The room already works with small deterministic texture bakes. This pass can
replace them with richer materials without adding meshes, lights or shader
layers. Only Outdoor pit and Home fireplace remain; Outdoor pit is the default.
The stones already have baked dirt, ash and inward scorching and need no images.

## Art direction

A quiet, well-used brick fireplace in a very dim room at night. Sooty warm
terracotta, charcoal slate, smoke-brown plaster and aged wood. Keep the fire
the brightest feature. Surround and room should emerge softly from the dark,
with large areas of low contrast. Avoid orange painted glow, glossy surfaces,
bright mortar, crisp repeated flecks or uniformly red bricks.

Bake permanent dark corners, architectural shadows, subtle wall repairs and
low wall panel detail into the wall color. This is an intentional exception to
the outdoor/fuel texture rule against baked lighting. Actual moving firelight
and its shadows remain dynamic. Do not paint flames, furniture, the fireplace
itself, perspective, a window or another light source into any map.

## Deliverables

Paths are relative to `public/`. Exact machine-readable requirements and the
future runtime manifest entries are in `hearth-texture-manifest.json`.

| Slot | Required image | Optional normal | Mapping and content |
| --- | --- | --- | --- |
| `hearthWall` | `textures/hearth-wall-albedo.webp`, 1024×1024 RGB sRGB | None needed | One complete 14 m wide × 8 m high wall elevation. Warm grey-brown plaster; quiet repairs, grain, dim corners, faint dado/panels at the foot. Clamped, **not a repeating tile**. |
| `hearthBrick` | `textures/hearth-brick-albedo.webp`, 512×512 RGB sRGB | `textures/hearth-brick-normal.png`, 512×512 | One rough brick face, roughly 0.41×0.18 m. Fine pores, clay mottling, gentle edge wear. **Do not paint a brick grid or mortar**: real geometry supplies courses and joints. Low-contrast seamless texture; per-brick vertex colors add variation. |
| `hearthFirebox` | `textures/hearth-firebox-albedo.webp`, 1024×512 RGB sRGB | `textures/hearth-firebox-normal.png`, 1024×512 | One continuous 2.65×1.78 m back-wall coloration. Heavily blackened upper centre and upper corners, irregular soot plume above the logs, charcoal/brown edge bricks and a little pale ash at the foot. **No brick grid or joints**: brick relief is geometry. Clamped. |
| `hearthStone` | `textures/hearth-stone-albedo.webp`, 512×512 RGB sRGB | `textures/hearth-stone-normal.png`, 512×512 | Dark, matte, slightly worn slate. Gentle strata and occasional mineral flecks. Seamless, low contrast. One image spans each slab face, including the broad landing. |

Suggested diffuse color ranges in ordinary sRGB image bytes: wall corners
around `#171410`, wall near the hearth around `#453a30`; brick faces around
`#80604b`; soot around `#100f0d` to `#302720`; slate around `#393731`.
These are starting points, not required flat fills. Check under scene lighting.

## Placement and orientation

All delivered images use ordinary **top-down image orientation**. The loader
inherits `flipY=true`. Image top = wall/brick top, image bottom = floor/brick
bottom. Author flat elevations and face textures; no perspective distortion.
Images can stretch to the physical aspect ratios above.

- Wall: U 0→1 covers world X −7→7. V 0→1 covers world Y −0.7→7.3.
  The firebox floor is Y 0, room floor Y −0.71, and mantel top Y 2.56.
  In the top-down image, floor is near 100% image height, mantel top near
  59%, and the opening occupies roughly X 40.5–59.5%, Y 69–91%.
  The fireplace mesh hides that central lower patch. Bake a subtle shadow
  just above the mantel and dim the outer wall; do not draw the mantel.
- Firebox: U 0→1 covers X −1.325→1.325, V 0→1 covers Y 0→1.78.
  Each inner side wall samples the outer 19% of this same image, so keep
  the edge bands useful as sooty brick coloration. The soot pattern must
  cross many bricks without repeating once per brick.
- Brick and stone: UV 0→1 on each box face. Keep features suitable for
  differently sized cut bricks and slab faces; avoid text or directional motifs.

## Formats and performance

- Albedo: WebP quality 85–90, RGB sRGB, no alpha. Target **under 1 MB for all
  four albedos**, and under 2 MB total including optional normals.
- Normal: PNG, RGB linear data, OpenGL tangent convention (+Y green).
  Generate a coherent height source first, then bake normals from it. Do not
  use a generated purple illustration as a normal map. No gamma correction.
- Normal detail is fine surface relief only. Never turn the soot plume,
  wall lighting, or a painted shadow into height/normal relief.
- All dimensions above are powers of two; rectangular firebox images are
  intentional. No 2K/4K upscales. With mipmaps the four albedos use about
  10.7 MiB of RGBA GPU storage; the three optional normals add about 5.3 MiB.
- No emissive, opacity, displacement, metalness or roughness images are
  required. Roughness stays in the material. Do not add extra decal layers.

## Integration and review

1. Place finished images at the exact paths above. Keep full-resolution
   generation sources outside `public/` so they do not ship with the site.
2. Copy only delivered entries from the JSON's `runtimeManifest` into
   `src/texture-manifest.js`. Omit optional normals that were not made.
   Missing assets are deliberately absent from the active manifest today.
3. Open the local viewer, choose Home fireplace and check Whole fire,
   Logs & flame and Ember bed at both low and ultra quality, including a
   narrow viewport. Check that the room stays dark, the soot points upward,
   and the actual brick joints remain clear without shimmer.
4. Switch Home → Outdoor pit → Home and confirm a fresh fire, correct
   textures, and no growing GPU texture count for equivalent fuel states.
   The loader applies all four slots only to Home materials.
5. Run `npm test` and `npm run build`. Normal/albedo delivery order is covered
   by loader tests; normal files should replace bump mapping, not stack with it.

The fallback uses just four small texture uploads per constructed Home scene
(about 2 MiB before mipmaps). None of the plaster, slate or soot textures is
regenerated per frame.
