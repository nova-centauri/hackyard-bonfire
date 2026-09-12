import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { random } from './textures.js';
import { groundHeight } from './ground.js';

const MINERALS = ['#92918b', '#787d80', '#a79581', '#827467', '#706a62', '#aaa397', '#777b70', '#8f8173'];

function stoneMaterial(detailed, mode) {
  const material = new THREE.MeshStandardMaterial({
    color: detailed ? '#ffffff' : mode === 1 ? '#748493' : '#a7a79b',
    roughness: .96, vertexColors: true, flatShading: !detailed,
  });
  if (!detailed) return material;
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vStonePosition, vStoneNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vStonePosition = (modelMatrix * vec4(transformed, 1.)).xyz;
      vStoneNormal = normalize(mat3(modelMatrix) * normal);
    `);
    shader.fragmentShader = `
      varying vec3 vStonePosition, vStoneNormal;
      float stoneHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float stoneNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(mix(stoneHash(i), stoneHash(i + vec3(1,0,0)), f.x),
                       mix(stoneHash(i + vec3(0,1,0)), stoneHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(stoneHash(i + vec3(0,0,1)), stoneHash(i + vec3(1,0,1)), f.x),
                       mix(stoneHash(i + vec3(0,1,1)), stoneHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 stoneP = vStonePosition;
      float mineral = stoneNoise(stoneP * 13. + stoneNoise(stoneP * 3.) * 2.);
      float grain = stoneNoise(stoneP * 49.);
      // Fade tiny mineral flecks before they can alias into noisy pixels.
      float grainVisibility = 1. - smoothstep(.012, .055, length(fwidth(stoneP)));
      float quartz = smoothstep(.63, .82, grain) * grainVisibility;
      diffuseColor.rgb *= .83 + mineral * .3;
      diffuseColor.rgb += vec3(.043, .04, .033) * quartz;
      diffuseColor.rgb *= 1. + (grain - .5) * .14 * grainVisibility;
      vec3 toFire = normalize(vec3(-stoneP.x, .18, -stoneP.z));
      float soot = pow(max(0., dot(normalize(vStoneNormal), toFire)), 1.3)
        * (1. - smoothstep(.16, .56, stoneP.y)) * (.24 + mineral * .16);
      diffuseColor.rgb *= 1. - soot;
    `);
  };
  material.customProgramCacheKey = () => 'weathered-stone-v1';
  return material;
}

// One draw call, but a unique shape, orientation and mineral color per stone.
// Welding vertices before computing normals keeps the worn surfaces smooth.
export function addStoneRing(parent, { seed = 42, mode = 0, hybrid = false } = {}) {
  const rand = random(seed + 1823), detailed = hybrid || (mode !== 1 && mode !== 2);
  const count = 23, specs = [], geometries = [], placements = [];
  for (let i = 0; i < count; i++) {
    const large = i % 7 === 2;
    const width = large ? .34 + rand() * .075 : .215 + rand() * .115;
    specs.push({ width, depth: .21 + rand() * .115, height: .14 + rand() * .135, gap: .025 + rand() * .11 });
  }
  const perimeter = specs.reduce((sum, s) => sum + s.width * 2 + s.gap, 0);
  let cursor = rand() * .25;
  for (let i = 0; i < count; i++) {
    const spec = specs[i], angularWidth = spec.width * 2 / perimeter * Math.PI * 2;
    const angle = cursor + angularWidth * .5;
    cursor += angularWidth + spec.gap / perimeter * Math.PI * 2;
    const radius = 2.08 + (rand() - .5) * .19 + Math.sin(angle * 3. + .6) * .065;
    const x = Math.cos(angle) * radius * 1.025, z = Math.sin(angle) * radius * .985;
    let geometry = new THREE.IcosahedronGeometry(1, detailed ? 5 : mode === 1 ? 0 : 1);
    geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
    geometry = mergeVertices(geometry);
    const p = geometry.attributes.position, phase = rand() * 10, colors = [];
    const color = detailed ? new THREE.Color(MINERALS[Math.floor(rand() * MINERALS.length)])
      : new THREE.Color().setScalar(.65 + rand() * .4);
    for (let j = 0; j < p.count; j++) {
      const px = p.getX(j), py = p.getY(j), pz = p.getZ(j);
      const bulge = 1. + Math.sin(px * 2.7 + py * 1.9 + phase) * .095
        + Math.cos(pz * 3.1 - py * 2.4 + phase * 1.7) * .072
        + Math.sin(px * 4.1 - pz * 2.2 + phase * .6) * .035;
      // Broad uneven lobes and a softly flattened base retain worn silhouettes.
      const bottom = py < -.5 ? -.5 + (py + .5) * .45 : py;
      p.setXYZ(j, px * bulge + py * py * .075 * Math.sin(phase), bottom * bulge, pz * bulge);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const rotation = new THREE.Euler((rand() - .5) * .4, -angle + Math.PI / 2 + (rand() - .5) * .65, (rand() - .5) * .27);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(spec.width, spec.height, spec.depth));
    geometry.applyMatrix4(matrix); geometry.computeBoundingBox();
    const y = (hybrid ? groundHeight(x, z) : -.055) - geometry.boundingBox.min.y - .035;
    geometry.translate(x, y, z); geometries.push(geometry);
    placements.push({ x, y, z, width: spec.width, height: spec.height, depth: spec.depth });
  }
  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  merged.computeBoundingSphere();
  const stones = new THREE.Mesh(merged, stoneMaterial(detailed, mode));
  stones.name = 'Weathered stone ring'; stones.castShadow = true; stones.receiveShadow = true;
  stones.userData.placements = placements;
  parent.add(stones);
  return stones;
}
