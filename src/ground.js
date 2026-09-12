import * as THREE from 'three';
import { random } from './textures.js';

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
  const dark = new THREE.Color('#363329'), earth = new THREE.Color('#92806a'), outside = new THREE.Color('#3d4234');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
    const noise = Math.sin(x * 2.3 + Math.cos(z * 1.7)) * Math.sin(z * 2.6) * .012;
    p.setY(i, -.075 + noise * Math.min(1, d / 2) - THREE.MathUtils.smoothstep(d, 6.7, 9) * .08);
    const color = dark.clone().lerp(earth, THREE.MathUtils.smoothstep(d, 1.5, 3.5));
    color.lerp(outside, THREE.MathUtils.smoothstep(d + Math.sin(x + z) * .5, 5.5, 10));
    color.multiplyScalar(.92 + rand() * .16); colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const soil = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: .055, vertexColors: true, roughness: 1 }));
  soil.receiveShadow = true; parent.add(soil);
  const gravel = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#7b6d55', roughness: 1, flatShading: true }), 1000);
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), new THREE.MeshStandardMaterial({ color: '#756247', roughness: 1, flatShading: true }), 120);
  const obj = new THREE.Object3D();
  for (let i = 0; i < 1000; i++) {
    const angle = rand() * Math.PI * 2, radius = 2.4 + Math.sqrt(rand()) * 5.7, size = .008 + rand() ** 3 * .083;
    obj.position.set(Math.cos(angle) * radius, -.063, Math.sin(angle) * radius);
    obj.rotation.set(rand(), rand() * 6, rand()); obj.scale.set(size * 1.3, size * .48, size); obj.updateMatrix();
    gravel.setMatrixAt(i, obj.matrix); gravel.setColorAt(i, new THREE.Color().setScalar(.6 + rand() * .7));
    if (i < 120) {
      obj.position.y = -.055; obj.scale.set(.02 + rand() * .04, .006, .05 + rand() * .09); obj.updateMatrix();
      leaves.setMatrixAt(i, obj.matrix); leaves.setColorAt(i, new THREE.Color().setHSL(.08 + rand() * .07, .13 + rand() * .2, .2 + rand() * .2));
    }
  }
  gravel.receiveShadow = leaves.receiveShadow = true; parent.add(gravel, leaves);
}
