import * as THREE from 'three';
import { getFuelType } from './fuel-types.js';

const SIZE = 64, EXTENT = 2.4;

// Ash coats the existing soil: no extra geometry, transparent layers, or moving
// instance matrices. Its heat field is small and only refreshed at five Hz.
export function createAshBed(surface) {
  const heatMap = new THREE.DataTexture(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE);
  heatMap.minFilter = heatMap.magFilter = THREE.LinearFilter;
  heatMap.generateMipmaps = false;
  const state = { amount: 0, resetToken: null, lastTime: -Infinity, lastBurnTime: -Infinity,
    field: new Float32Array(SIZE * SIZE), heatMap,
    uniforms: { uAshAmount: { value: 0 }, uAshTime: { value: 0 }, uAshHeat: { value: heatMap } } };
  surface.userData.ashState = state;
  const material = surface.material, previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, state.uniforms);
    shader.vertexShader = 'varying vec3 vAshWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vAshWorld = (modelMatrix * vec4(transformed, 1.)).xyz;
    `);
    shader.fragmentShader = `varying vec3 vAshWorld;
      uniform float uAshAmount,uAshTime;
      uniform sampler2D uAshHeat;
      float ashHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float ashNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(ashHash(i),ashHash(i+vec2(1.,0.)),f.x),mix(ashHash(i+vec2(0.,1.)),ashHash(i+vec2(1.,1.)),f.x),f.y);}
    ` + shader.fragmentShader;
    // Replace the soil's color after its texture and vertex colors are applied.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 ashXZ=vAshWorld.xz;
      float ashCoarse=ashNoise(ashXZ*4.8),ashFine=ashNoise(ashXZ*73.);
      float ashRadius=mix(.46,1.92,sqrt(clamp(uAshAmount,0.,1.)));
      float ashEdge=length(ashXZ*vec2(1.,1.07))+(ashCoarse-.5)*.26;
      float ashCover=(1.-smoothstep(ashRadius-.3,ashRadius+.12,ashEdge))*smoothstep(0.,.12,uAshAmount);
      ashCover*=mix(.66,1.,smoothstep(.04,.5,uAshAmount));
      vec3 ashGray=mix(vec3(.20,.19,.175),vec3(.44,.425,.40),ashCoarse*.52+ashFine*.48);
      diffuseColor.rgb=mix(diffuseColor.rgb,ashGray,ashCover);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 ashUV=ashXZ/${EXTENT * 2}+vec2(.5);
      float ashInside=step(0.,ashUV.x)*step(ashUV.x,1.)*step(0.,ashUV.y)*step(ashUV.y,1.);
      float ashHeat=texture2D(uAshHeat,clamp(ashUV,vec2(0.),vec2(1.))).r*ashInside;
      float ashShimmer=1.+.025*sin(uAshTime*.83+ashXZ.x*8.1+ashXZ.y*5.7)+.015*sin(uAshTime*1.31-ashXZ.y*11.);
      vec3 ashGlow=mix(vec3(.58,.019,.001),vec3(1.2,.19,.008),ashHeat);
      totalEmissiveRadiance+=ashGlow*pow(ashHeat,1.5)*ashCover*(.28+ashFine*.12)*ashShimmer;
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}:ground-ash-1`;
  material.needsUpdate = true;
  return surface;
}

export function ashAmount(cycle) {
  // Log ash remains when a slot is replenished, and coal residue accumulates in
  // ashMass. Both contribute to the persistent ground cover.
  const logAsh = (cycle.logs || []).reduce((sum, log) => sum + (log.ash || 0) * getFuelType(log.fuelType).mass, 0);
  const deposits = (cycle.ashDeposits || []).reduce((sum, value) => sum + value, 0);
  return Math.min(1, 1 - Math.exp(-((cycle.ashMass || 0) + logAsh + deposits * .065) * 1.6));
}

export function rasterizeCoalHeat(state, pieces, scale = 1) {
  const field = state.field, data = state.heatMap.image.data;
  field.fill(0);
  const texels = SIZE / (EXTENT * 2);
  for (const coal of pieces) {
    const heat = THREE.MathUtils.smoothstep(coal.heat, .10, .85);
    if (heat < .001) continue;
    const radius = .05 + coal.radius * scale * 1.15;
    const cx = (coal.x + EXTENT) * texels - .5, cy = (coal.z + EXTENT) * texels - .5;
    const reach = radius * 2.4 * texels, sigma = radius * texels;
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(SIZE - 1, Math.ceil(cy + reach)); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(SIZE - 1, Math.ceil(cx + reach)); x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (sigma * sigma);
        const value = heat * Math.exp(-d2 * 1.35), index = y * SIZE + x;
        // Neighbors combine without turning the whole center into a bright disk.
        field[index] = 1 - (1 - field[index]) * (1 - value);
      }
    }
  }
  for (let i = 0; i < field.length; i++) {
    data[i * 4] = Math.round(field[i] * 255); data[i * 4 + 3] = 255;
  }
  state.heatMap.needsUpdate = true;
}

export function updateAshBed(surface, cycle, coals, time, force = false) {
  const state = surface?.userData.ashState;
  if (!state) return;
  const token = `${cycle.seed}:${cycle.resetSerial}`;
  if (state.resetToken !== token) {
    state.resetToken = token; state.amount = 0; state.lastTime = -Infinity; state.lastBurnTime = -Infinity;
    force = true;
  }
  state.amount = Math.max(state.amount, ashAmount(cycle));
  state.uniforms.uAshAmount.value = state.amount;
  state.uniforms.uAshTime.value = time;
  if (!force && (cycle.time === state.lastBurnTime || time - state.lastTime < .2)) return;
  const scale = .28 + .72 * Math.sqrt(Math.min(1, cycle.coalMass / .5));
  rasterizeCoalHeat(state, coals?.userData.coalState?.pieces || [], scale);
  state.lastTime = time; state.lastBurnTime = cycle.time;
}
