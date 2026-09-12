// Authored texture overrides.
//
// Everything renders from procedural textures generated at startup, so this
// list is EMPTY by default and no file is fetched. To use authored textures,
// put the files under public/textures/ and list them here; the loader swaps
// them into every material that uses the procedural version, and anything not
// listed keeps its procedural fallback. Sizes, colour spaces, tiling rules and
// channel meanings for each slot are specified in docs/textures.md.
//
// Slots and the keys each accepts (all optional):
//   bark:        map, normal | bump, emissive     wraps a log's circumference (u) once; v runs along the length
//   endGrain:    map, normal | bump, emissive     planar disc on both cut faces
//   exposedWood: map, normal | bump               scraped patches and peeled-strip undersides; tiles along v
//   soil:        map, normal | bump               the clearing floor; tiles 8x over 22 m, must be seamless
//   smokePuff:   map                              greyscale alpha sprite for log-end steam
//
// Example:
//   bark: { map: 'textures/bark-albedo.png', normal: 'textures/bark-normal.png', emissive: 'textures/bark-emissive.png' },
export const TEXTURE_MANIFEST = Object.freeze({});
