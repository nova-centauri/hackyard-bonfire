import * as THREE from 'three';
import { random } from './textures.js';

// The soil mesh and settling simulation share this gently excavated hollow.
export function groundHeight(x, z) {
  const radius = Math.hypot(x, z);
  const basin = 1 - THREE.MathUtils.smoothstep(radius, .35, 2.05);
  const rim = Math.exp(-(((radius - 2.18) / .42) ** 2)) * .032;
  const grain = Math.sin(x * 2.3 + Math.cos(z * 1.7)) * Math.sin(z * 2.6) * .009
    + Math.sin(x * 5.2 - z * 3.8) * .002;
  return -.075 - basin * .165 + rim
    + grain * (.22 + .78 * THREE.MathUtils.smoothstep(radius, .4, 2.5))
    - THREE.MathUtils.smoothstep(radius, 7.7, 10) * .045;
}

// Seat rotated, uneven pieces using their actual lowest surface over the bowl,
// rather than a random center height that can leave small coals hovering.
export function seatOnGround(object, geometry, height = groundHeight, embed = .004) {
  object.position.y = 0; object.updateMatrix();
  const positions = geometry.attributes.position, vertex = new THREE.Vector3();
  let seatedY = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrix);
    seatedY = Math.max(seatedY, height(vertex.x, vertex.z) - vertex.y);
  }
  object.position.y = seatedY - embed; object.updateMatrix();
  return object;
}

// The shared world-space fade keeps ambient illumination off distant soil,
// gravel and leaves so that the fire's small pool of light has no visible edge.
export function clearingFalloff(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vClearingPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 clearingPosition = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        clearingPosition = instanceMatrix * clearingPosition;
      #endif
      vClearingPosition = (modelMatrix * clearingPosition).xyz;
    `);
    shader.fragmentShader = 'varying vec3 vClearingPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float firePool = 1. - smoothstep(2.9, 7.6, length(vClearingPosition.xz));
      outgoingLight *= firePool * firePool;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'clearing-fire-falloff-v1';
  return material;
}

export function addDirtClearing(parent, seed) {
  const rand = random(seed + 470), canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4;
    const grain = 98 + rand() * 56 + Math.sin(x * .045) * Math.cos(y * .063) * 16;
    pixels.data[i] = grain; pixels.data[i + 1] = grain * .83; pixels.data[i + 2] = grain * .61; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = rand() > .5 ? '#e1c99e35' : '#241d1655';
    ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 3, 1 + rand() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(8, 8); texture.anisotropy = 8;
  const geometry = new THREE.PlaneGeometry(22, 22, 110, 110); geometry.rotateX(-Math.PI / 2);
  const p = geometry.attributes.position, colors = [];
  const dark = new THREE.Color('#35312a'), earth = new THREE.Color('#91816c'), outside = new THREE.Color('#4a473c');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
    p.setY(i, groundHeight(x, z));
    const color = dark.clone().lerp(earth, THREE.MathUtils.smoothstep(d, 1.15, 2.75));
    color.lerp(outside, THREE.MathUtils.smoothstep(d + Math.sin(x + z) * .5, 4.3, 8));
    color.multiplyScalar(.97 + rand() * .06); colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const soil = new THREE.Mesh(geometry, clearingFalloff(new THREE.MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: .018, vertexColors: true, roughness: 1 })));
  soil.name = 'Hollowed earth'; soil.receiveShadow = true; parent.add(soil);
  const gravel = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), clearingFalloff(new THREE.MeshStandardMaterial({ color: '#7b6d55', roughness: 1 })), 1000);
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), clearingFalloff(new THREE.MeshStandardMaterial({ color: '#756247', roughness: 1, flatShading: true })), 120);
  const obj = new THREE.Object3D();
  for (let i = 0; i < 1000; i++) {
    const angle = rand() * Math.PI * 2, radius = 2.4 + Math.sqrt(rand()) * 5.7, size = .008 + rand() ** 3 * .083;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    obj.position.set(x, groundHeight(x, z) + size * .18, z);
    obj.rotation.set(rand(), rand() * 6, rand()); obj.scale.set(size * 1.3, size * .48, size); obj.updateMatrix();
    gravel.setMatrixAt(i, obj.matrix); gravel.setColorAt(i, new THREE.Color().setScalar(.6 + rand() * .7));
    if (i < 120) {
      obj.position.y = groundHeight(x, z) + .006; obj.scale.set(.02 + rand() * .04, .006, .05 + rand() * .09); obj.updateMatrix();
      leaves.setMatrixAt(i, obj.matrix); leaves.setColorAt(i, new THREE.Color().setHSL(.08 + rand() * .07, .13 + rand() * .2, .2 + rand() * .2));
    }
  }
  gravel.receiveShadow = leaves.receiveShadow = true; parent.add(gravel, leaves);
  return soil;
}
