import * as THREE from 'three';
import { random } from './textures.js';

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const smooth = (a, b, value) => THREE.MathUtils.smoothstep(value, a, b);

// Small, deterministic bakes are uploaded once with the room. Baked shadows
// live in albedo; no extra lights, transparent soot decals or frame-time work.
function bake(name, width, height, paint) {
  const pixels = new Uint8Array(width * height * 4), rand = random(1873);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4, rgb = paint(x / (width - 1), y / (height - 1), rand);
    pixels[index] = clamp(rgb[0]); pixels[index + 1] = clamp(rgb[1]); pixels[index + 2] = clamp(rgb[2]); pixels[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.name = name; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.flipY = true; texture.needsUpdate = true;
  return texture;
}

export function createHearthTextures() {
  // One 14 × 8 m wall: plaster grain, faint old plaster repairs, a low timber
  // dado and dim corners are part of the map, not additional surface geometry.
  const wall = bake('hearth-wall', 512, 512, (u, v, rand) => {
    const x = (u - .5) * 14, y = (1 - v) * 8 - .7;
    const mottling = Math.sin(x * 3.7 + Math.sin(y * 2.5)) * Math.cos(y * 5.4 - x) * 2.4
      + Math.sin(x * 18.6 + y * 8.3) * .8 + (rand() - .5) * 3.4;
    const pool = Math.exp(-(x * x / 13 + (y - 1.65) ** 2 / 7));
    const edge = .53 + .47 * (1 - smooth(2.0, 6.7, Math.abs(x)));
    let shade = (36 + pool * 30 + mottling) * edge;
    if (y < .48) {
      const panel = Math.abs(Math.sin((x + .31) * Math.PI / .88));
      const seam = 1 - smooth(.015, .060, panel);
      const rail = 1 - smooth(.018, .055, Math.abs(y - .42));
      shade = (22 + pool * 13 + mottling * .6) * (1 - seam * .45) + rail * 5;
    }
    // A very soft shadow above the timber shelf suggests depth even when the
    // moving firelight has faded. It never contains a painted flame or glow.
    const mantelShadow = Math.exp(-(x * x / 4.6 + (y - 2.58) ** 2 / .045));
    shade *= 1 - mantelShadow * .34;
    return [shade * 1.03, shade * .91, shade * .79];
  });
  const brick = bake('hearth-brick', 256, 256, (u, v, rand) => {
    const grit = (rand() - .5) * 23 + Math.sin(u * 47 + Math.cos(v * 22)) * 5
      + Math.sin(u * 121 - v * 74) * 2;
    const edge = Math.min(u, 1 - u, v * .5, (1 - v) * .5);
    const worn = .80 + .20 * smooth(0, .04, edge);
    const chip = rand() > .993 ? .72 : 1;
    const shade = (129 + grit) * worn * chip;
    return [shade, shade * .77, shade * .60];
  });
  // Full firebox UVs make the soot plume continuous across actual brick
  // courses. The upper centre is heavily blackened; ash remains at the foot.
  const firebox = bake('hearth-firebox', 512, 256, (u, v, rand) => {
    const x = (u - .5) * 2, y = 1 - v;
    const noise = Math.sin(u * 47 + v * 19) * Math.cos(v * 29 - u * 17) * .13
      + Math.sin(u * 117 + v * 87) * .035;
    const plume = Math.exp(-(((x + Math.sin(y * 8) * .07) / (.37 + y * .48)) ** 2));
    const soot = Math.min(.91, .18 + plume * (.31 + y * .38) + y * .19 + noise);
    const ash = (1 - smooth(0, .20, y)) * (8 + Math.sin(u * 83) * 2);
    const grain = (rand() - .5) * 9;
    const shade = 115 * (1 - soot) + grain + ash;
    return [shade, shade * (.77 + soot * .14), shade * (.58 + soot * .28)];
  });
  const stone = bake('hearth-stone', 256, 256, (u, v, rand) => {
    const strata = Math.sin(u * 34 + Math.sin(v * 10) * 3) * Math.sin(v * 29 - u * 4);
    const fleck = (rand() - .5) * 12;
    const shade = 57 + strata * 7 + Math.sin(u * 97 + v * 31) * 2 + fleck;
    return [shade * 1.04, shade, shade * .92];
  });
  brick.wrapS = brick.wrapT = stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
  return { wall, brick, firebox, stone };
}
