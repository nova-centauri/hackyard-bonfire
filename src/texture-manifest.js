// Authored texture overrides.
//
// Procedural textures still generate at startup and remain the fallback if a
// file is missing. Files listed here are loaded from public/ and swapped into
// every material that used the procedural version. Sizes, colour spaces,
// tiling rules and channel meanings for each slot are specified in
// docs/textures.md. The bake from Grok Imagine sources is planning/bake-textures.py.
//
// Slots and the keys each accepts (all optional):
//   bark:        map, normal | bump, emissive     wraps a log's circumference (u) once; v runs along the length
//   endGrain:    map, normal | bump, emissive     planar disc on both cut faces
//   exposedWood: map, normal | bump               scraped patches and peeled-strip undersides; tiles along v
//   soil:        map, normal | bump               the clearing floor; tiles 8x over 22 m, must be seamless
//   smokePuff:   map                              greyscale alpha sprite for log-end steam
export const TEXTURE_MANIFEST = Object.freeze({
  bark: {
    map: 'textures/bark-albedo.webp',
    normal: 'textures/bark-normal.png',
    emissive: 'textures/bark-emissive.png',
  },
  endGrain: {
    map: 'textures/end-albedo.webp',
    normal: 'textures/end-normal.png',
    emissive: 'textures/end-emissive.png',
  },
  exposedWood: {
    map: 'textures/exposed-albedo.webp',
    normal: 'textures/exposed-normal.png',
  },
  soil: {
    map: 'textures/soil-albedo.webp',
    normal: 'textures/soil-normal.png',
  },
  smokePuff: {
    map: 'textures/smoke-puff.png',
  },
});
