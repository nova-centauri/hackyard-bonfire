# Texture pass — progress

Senior Art Director notes. Spec: `docs/textures.md`. Hero asset: **bark normal**.

## Pipeline

1. Grok Imagine generated albedo + height + mask sources (1:1, photoreal, unlit).
2. Height is wrap-aware Sobel-baked to **OpenGL** tangent-space normals (green = +Y).
3. Sources are resized to the spec’s power-of-two sizes, albedo → WebP, data maps → PNG.
4. Files land in `public/textures/` and are listed in `src/texture-manifest.js`.

AI cannot emit valid tangent-space normals directly; a purple “normal-looking” image is not a normal map. Height → bake is the mapping pass.

## Shipped (2026-09-12)

| File | Size | Role |
| --- | --- | --- |
| `bark-albedo.webp` | 2048² | Dark dry plates, tiles in U |
| `bark-normal.png` | 2048² | OpenGL, deep fissures (hero) |
| `bark-emissive.png` | 1024² | White in cracks, mid-log falloff |
| `end-albedo.webp` | 1024² | Rings, pith, radial checks |
| `end-normal.png` | 1024² | Subtle ring ridges |
| `end-emissive.png` | 512² | Radial checks only |
| `exposed-albedo.webp` | 1024² | Pale sapwood, tiles in V |
| `exposed-normal.png` | 1024² | Fine grain |
| `soil-albedo.webp` | 2048² | Neutral grit, seamless |
| `soil-normal.png` | 2048² | Grit, no large forms |
| `smoke-puff.png` | 512² RGBA | Wispy steam sprite |

On-disk total **18.8 MB** (budget ~20 MB). Rebake with `python3 planning/bake-textures.py`.

## Sources kept

`planning/sources/` — chosen Imagine stills. Height and emissive for bark were generated against the albedo so plates line up. End-grain glow is derived from height (dark radial checks), not the ring-lit Imagine mask.
