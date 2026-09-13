# Textures: how to author and drop in the real ones

Status: every slot in this brief now has an authored file under `public/textures/`,
listed in `src/texture-manifest.js`. Procedural textures still generate at startup
and remain the fallback if a file is missing. The loader (`src/texture-loader.js`)
swaps each file into every material that used the procedural version once it has
decoded. Sources and the OpenGL normal bake live in `planning/`.

## The rules that apply to every texture

- **Power-of-two square images**: 512, 1024 or 2048 pixels on a side. 2048 is
  the ceiling; the pixel-budget on lower quality tiers cannot compensate for
  oversized textures, and mobile GPUs still pay for them in memory.
- **Formats**: PNG for anything with hard edges or exact channel values
  (normal, height, emissive masks). WebP (lossy, quality 85–92) is fine for
  albedo. No JPEG for normal or height data. Keep the whole set under about
  20 MB on disk and about 60 MB decoded on the GPU.
- **Colour spaces**: albedo and emissive files are sRGB (ordinary image
  editor output). Height, roughness and normal maps are linear data; export
  them without a colour profile and do not gamma-adjust them.
- **Normal maps are OpenGL convention** (green = +Y up, as three.js expects).
  If a tool offers DirectX/OpenGL, choose OpenGL, otherwise invert green.
- **Tiling is per slot** (below). Where a texture must tile, test it by
  offsetting it by half its size in both axes and checking for seams.
- **No baked lighting on fuel or outdoor surface tiles.** The fire moves; any painted
  highlight or shadow will look wrong half the time. Albedo should be flat,
  diffuse colour only. Ambient-occlusion style darkening inside deep bark
  cracks is acceptable because it reads as cavity, not light. The Home room
  intentionally uses baked dim corners, architectural occlusion and wall
  detail; its specific exception and placement maps are documented in
  `planning/hearth-texture-pass.md`. Keep moving orange firelight out of these
  bakes. The firebox soot is permanent surface discoloration.
- **Real-world scale**: a log in the scene is about 0.5 m in diameter and
  2.9 m long; the stone ring is about 4.2 m across; the soil texture repeats
  every 2.75 m. Detail frequency should match those sizes at 2048 px.
- **Naming**: `public/textures/<slot>-<role>.<ext>`, for example
  `bark-albedo.webp`, `bark-normal.png`, `bark-emissive.png`. Paths in the
  manifest are relative to the site root (`textures/bark-albedo.webp`).

## Slots

### `bark` — the side of every log, small log, stump and kindling

| Role | Size | Channels | Notes |
| --- | --- | --- | --- |
| `map` (albedo) | 2048² | sRGB RGB | Dark, dry bark: the procedural base is roughly `#221a12` with plate highlights to `#5a4a38`. Fresh wood colour is mixed toward charcoal by the burn shader, so paint **unburnt** bark only. |
| `normal` or `bump` | 2048² | linear | Normal preferred. Deep fissures between plates, shallow plate faces. |
| `emissive` | 1024² | sRGB, red channel used | A **mask of where char cracks glow**, not a colour: white in the fissures that should shine when hot, black on plate faces. The plain material studies multiply it by local heat and tint it. In the living studies (07, 08) the burn shader's char glow is multiplied by this mask once an authored one has loaded (a per-slot uniform flag, no recompile): plate faces dim, painted fissures brighten. Without an authored mask the glow stays procedural. |

UV layout: `u` runs once around the circumference (0 at the seam, 1 back at
the seam), `v` runs along the length (0 = one cut end, 1 = the other). The
image therefore **must tile horizontally** (left edge continues into right
edge) and must not tile vertically, but avoid strong features at the top and
bottom rows, which land against the cut faces. The texture is not repeated: a
2.9 m log gets the whole image once around a 1.6 m circumference, so the
texel density is roughly 0.8 mm per texel at 2048².

Two things the shader still adds on top of any bark map, and which you should
not paint: the charring front (plates, fissures, ember glow, ash dust) and the
small scraped patches and peeled strips, which use the `exposedWood` slot.

### `endGrain` — both cut faces of every round piece

| Role | Size | Channels | Notes |
| --- | --- | --- | --- |
| `map` | 1024² | sRGB | Concentric rings, pith slightly off centre, radial checks. Pale sapwood is fine; it darkens with burn state in the shader. |
| `normal` or `bump` | 1024² | linear | Ring ridges and checks; subtle. |
| `emissive` | 512² | sRGB, red used | Mask of radial checks that glow when the end is hot. Steers the end-cap char glow the same way the bark mask does. |

UV layout: planar over the disc, `(0.5, 0.5)` at the centre, the rim touching
the edges of the image. Nothing outside the inscribed circle is visible.
Clamped, never tiled. Both ends of a log use the same image; the rim is
deformed with the trunk profile, so keep the last 3% of radius featureless.

### `exposedWood` — scraped bark patches, peeled-strip undersides, 2×4 sides

| Role | Size | Channels | Notes |
| --- | --- | --- | --- |
| `map` | 1024² | sRGB | Pale inner bark / sapwood with fine longitudinal grain. |
| `normal` or `bump` | 1024² | linear | Fine grain only. |

UV layout: `u` across the patch (0..1, clamped), `v` along the grain and
**repeats about 2.4 times** along a log, so the image **must tile vertically**.
Planks map their long faces to this texture with `v` along the board.

### `soil` — the clearing floor

| Role | Size | Channels | Notes |
| --- | --- | --- | --- |
| `map` | 2048² | sRGB | Neutral grey-brown grit; keep it fairly desaturated and mid-dark. The vertex colours supply the ash-grey hollow, the earth ring and the dark far ground, and the ash shader paints the grey ash cover, so the texture is texture, not colour design. |
| `normal` or `bump` | 2048² | linear | Grit and small stones; no large forms (the mesh already has the bowl). |

Tiles 8×8 over a 22 m plane (one repeat every 2.75 m), so the image **must be
seamless in both axes** with no visible period. Viewed from above at an angle,
so anisotropic filtering is enabled; avoid high-contrast speckle finer than
about 3 px at 2048², which shimmers.

### `smokePuff` — the log-end steam sprite

| Role | Size | Channels | Notes |
| --- | --- | --- | --- |
| `map` | 256² or 512² | RGBA, alpha used | A single soft, irregular puff, fully transparent at the edges, white RGB. |

Drawn as rotating instanced billboards with additive-free alpha blending;
tint and opacity come from the shader.

## Slots that stay procedural on purpose

- **Stones**: broad mineral variation, dirt, ash and inward soot are baked
  into vertex colors once; one fragment noise sample supplies fine grain.
  A stone albedo would need
  per-stone UVs that do not exist. If authored stones are wanted later, the
  path is a triplanar map in `src/rocks.js`.
- **Coals, char plates, ash**: all shader-driven from thermal state; texture
  could not follow the heat.
- **Flames, smoke, embers**: volumetric and particle shaders; no textures.

## Workflow

The optional Home texture slots (`hearthWall`, `hearthBrick`,
`hearthFirebox`, `hearthStone`) are wired into the same loader but intentionally
absent from the shipped-file manifest until authored files exist. Their small
procedural bakes provide the complete room in the meantime. Follow
`planning/hearth-texture-pass.md` for dimensions, orientation and appearance.

1. Put files under `public/textures/`.
2. List them in `src/texture-manifest.js`:
   ```js
   export const TEXTURE_MANIFEST = Object.freeze({
     bark: { map: 'textures/bark-albedo.webp', normal: 'textures/bark-normal.png', emissive: 'textures/bark-emissive.png' },
     endGrain: { map: 'textures/end-albedo.webp', normal: 'textures/end-normal.png' },
     exposedWood: { map: 'textures/exposed-albedo.webp' },
     soil: { map: 'textures/soil-albedo.webp', normal: 'textures/soil-normal.png' },
   });
   ```
   Any slot or role left out keeps its procedural texture; a file that fails
   to load logs a warning and also falls back.
3. `npm run dev`, open `/study/wild-draft?quality=ultra`, and use the
   **Logs & flame** and **Ember bed** views. The console prints a per-slot
   report (`applied`, `failed`, `unused`).
4. Check a fresh log (Add fuel → Log) for the unburnt albedo, a charring log
   for the emissive mask, and a burned-down one for the exposed wood.
5. `npm run build` and confirm the total asset size stays inside the budget.

## Implementation notes for later

- The loader swaps textures by reference across every material in the scene,
  including the per-log clones created by the burn shader, so a swap is
  complete; materials recompile once when a normal map replaces a bump map.
- An authored albedo also takes over any bump slot that shared the procedural
  albedo (the procedural textures double as their own bump maps); an authored
  bump or normal then replaces that.
- Compressed GPU formats (KTX2/Basis) are not wired up. If download size
  becomes a problem, `THREE.KTX2Loader` can be substituted for the
  `TextureLoader` in `loadAuthoredTextures`; the swap logic is unchanged.
