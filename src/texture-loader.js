import * as THREE from 'three';

// Loads the files named in a texture manifest and replaces the procedural
// textures in place, material by material. The procedural textures are the
// handles: the scene keeps rendering with them until each authored file has
// decoded, and a file that fails to load leaves its slot procedural.
export const SLOT_ROLES = Object.freeze({
  bark: { map: 'map', bump: 'bumpMap', normal: 'normalMap', emissive: 'emissiveMap' },
  endGrain: { map: 'map', bump: 'bumpMap', normal: 'normalMap', emissive: 'emissiveMap' },
  exposedWood: { map: 'map', bump: 'bumpMap', normal: 'normalMap' },
  soil: { map: 'map', bump: 'bumpMap', normal: 'normalMap' },
  hearthWall: { map: 'map', bump: 'bumpMap', normal: 'normalMap' },
  hearthBrick: { map: 'map', bump: 'bumpMap', normal: 'normalMap' },
  hearthFirebox: { map: 'map', bump: 'bumpMap', normal: 'normalMap' },
  hearthStone: { map: 'map', bump: 'bumpMap', normal: 'normalMap' },
  smokePuff: { map: 'map' },
});
// Which material slots each role may replace. The procedural textures double
// as their own bump maps, so an authored albedo carries a shared bump slot
// along with it; an authored bump or normal map then takes that slot over.
const ROLE_SLOTS = Object.freeze({ map: ['map', 'bumpMap'], bump: ['bumpMap'], normal: ['bumpMap', 'normalMap'], emissive: ['emissiveMap'] });
const COLOR_DATA = new Set(['map', 'emissive']);

export function configureAuthoredTexture(texture, role, template) {
  texture.colorSpace = COLOR_DATA.has(role) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = template?.wrapS ?? THREE.RepeatWrapping; texture.wrapT = template?.wrapT ?? THREE.RepeatWrapping;
  if (template?.repeat) texture.repeat.copy(template.repeat);
  texture.anisotropy = Math.max(template?.anisotropy ?? 8, 8);
  texture.flipY = template?.flipY ?? true;
  texture.needsUpdate = true;
  return texture;
}

// Replace every reference to `previous` in the given materials, within the
// slots the role owns. A normal map supersedes a bump map on the same material.
export function swapTexture(materials, previous, replacement, { role = 'map' } = {}) {
  const slots = ROLE_SLOTS[role] || ['map'];
  let touched = 0;
  for (const material of materials) {
    let changed = false;
    for (const slot of slots) {
      if (material[slot] !== previous) continue;
      if (slot === 'bumpMap' && role === 'normal') { material.bumpMap = null; material.normalMap = replacement; material.normalScale ??= new THREE.Vector2(1, 1); }
      else material[slot] = replacement;
      changed = true;
    }
    if (material.uniforms) for (const uniform of Object.values(material.uniforms)) {
      if (uniform?.value !== previous) continue;
      uniform.value = replacement; changed = true;
    }
    if (changed) { material.needsUpdate = true; touched++; }
  }
  return touched;
}

export function collectMaterials(roots) {
  const materials = new Set();
  for (const root of roots) root.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
  });
  return [...materials];
}

// registry: { slotName: { map: proceduralTexture, bump: proceduralTexture, emissive: proceduralTexture } }
// Returns a promise of { slot: { role: 'applied' | 'failed' } } once every listed file has settled.
export function loadAuthoredTextures(manifest, registry, materialsProvider, { base = '/', loader = new THREE.TextureLoader() } = {}) {
  const jobs = [], authored = new Set();
  // Original procedural textures stay owned by the study. A decoded bump that
  // a normal supersedes can be released immediately once no handle uses it.
  const releaseReplaced = (texture, materials) => {
    if (!authored.has(texture)) return;
    if (Object.values(registry).some(handles => Object.values(handles).includes(texture))) return;
    if (materials.some(material => Object.values(material).includes(texture) || Object.values(material.uniforms || {}).some(uniform => uniform?.value === texture))) return;
    texture.dispose(); authored.delete(texture);
  };
  for (const [slot, files] of Object.entries(manifest || {})) {
    const roles = SLOT_ROLES[slot], handles = registry[slot];
    if (!roles || !handles) continue;
    let normalApplied = false;
    for (const [role, url] of Object.entries(files || {})) {
      if (!(role in roles) || typeof url !== 'string') continue;
      if (!(role === 'normal' ? handles.bump : handles[role])) continue;
      jobs.push(new Promise(resolve => {
        loader.load(base + url.replace(/^\//, ''), texture => {
          // Resolve the handle at decode time. Albedo is listed first and often
          // finishes first; it carries the shared bump slot with it, so a
          // normal captured against the procedural texture at schedule time
          // would no longer find a material to swap.
          const previous = role === 'normal' ? handles.bump : handles[role];
          if (!previous || (role === 'bump' && normalApplied)) {
            texture.dispose();
            return resolve({ slot, role, status: 'unused' });
          }
          configureAuthoredTexture(texture, role, previous);
          authored.add(texture);
          const materials = materialsProvider(), count = swapTexture(materials, previous, texture, { role });
          // Only albedo carries a shared procedural bump along with it. A bump
          // must never retarget the map handle, regardless of decode order.
          if (role === 'map' && handles.bump === previous) handles.bump = texture;
          if (role === 'normal') handles.bump = texture; else handles[role] = texture;
          if (role === 'normal') normalApplied = true;
          releaseReplaced(previous, materials);
          resolve({ slot, role, status: count ? 'applied' : 'unused', materials: count });
        }, undefined, () => resolve({ slot, role, status: 'failed' }));
      }));
    }
  }
  return Promise.all(jobs).then(results => {
    const report = {};
    for (const result of results) (report[result.slot] ??= {})[result.role] = result.status;
    return report;
  });
}
