import * as THREE from 'three';
import { createStoneCollider } from './rocks.js';
import { random } from './textures.js';

const material = (color, metalness = 0, roughness = .92) => new THREE.MeshStandardMaterial({ color, metalness, roughness });

function box(parent, size, position, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

// A few instanced draws provide real joints, depth and irregular brick color.
function masonry(parent, size, position, color, brickWidth, rowHeight, seed) {
  const mortar = box(parent, size, position, material('#51443b'));
  const [width, height, depth] = size, rand = random(seed), bricks = [];
  const rows = Math.max(1, Math.round(height / rowHeight)), stepY = height / rows;
  for (let row = 0; row < rows; row++) {
    for (let left = -width / 2 - (row % 2) * brickWidth / 2; left < width / 2; left += brickWidth) {
      const a = Math.max(-width / 2, left), b = Math.min(width / 2, left + brickWidth);
      if (b - a < .025) continue;
      bricks.push({ x: (a + b) / 2, y: -height / 2 + (row + .5) * stepY, width: b - a });
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material(color), bricks.length);
  const object = new THREE.Object3D(), shade = new THREE.Color(color);
  bricks.forEach((brick, index) => {
    object.position.set(position[0] + brick.x, position[1] + brick.y, position[2] + depth / 2 + .017);
    object.scale.set(brick.width - .018, stepY - .018, .055); object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix); mesh.setColorAt(index, shade.clone().multiplyScalar(.75 + rand() * .48));
  });
  // Instance colors already carry the brick pigment.
  mesh.material.color.set('#ffffff'); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  return mortar;
}

// The mouth is a loading boundary, including its open front. Convex boxes
// reuse the existing fixed-contact solver so poking and settling cannot turn
// a hearth into a pile outside the opening. No combustion rules live here.
export function mouthColliders(scene) {
  const { width: w, height: h, depth: d } = scene.mouth, t = .18;
  const specs = [
    [[t, h + t, d + 2 * t], [-(w + t) / 2, h / 2, 0]],
    [[t, h + t, d + 2 * t], [(w + t) / 2, h / 2, 0]],
    [[w, h + t, t], [0, h / 2, -(d + t) / 2]],
    [[w, h + t, t], [0, h / 2, (d + t) / 2]],
    [[w, t, d], [0, h + t / 2, 0]],
  ];
  return specs.map(([size, position], index) => {
    const geometry = new THREE.BoxGeometry(...size).translate(...position);
    const collider = createStoneCollider(geometry, `${scene.id}-mouth-${index}`);
    geometry.dispose(); return collider;
  });
}

export function addFireSet(parent, scene) {
  const group = new THREE.Group(); group.name = scene.label; parent.add(group);
  const { width: w, height: h, depth: d } = scene.mouth;
  const iron = material('#24262a', .65, .55), firebrick = material('#393029');
  const stone = material(scene.id === 'grand' ? '#a29178' : '#5c5750');
  const stove = scene.id === 'stove';
  const floor = box(group, [20, .18, 16], [0, stove ? -.67 : -.37, 3], material('#302a24'));
  floor.castShadow = false;
  box(group, [w + 1.8, .26, d + 1.35], [0, stove ? -.43 : -.13, .26], stone);
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material('#302b26'));
  surface.rotation.x = -Math.PI / 2; surface.position.y = .002; surface.receiveShadow = true; group.add(surface);
  if (scene.id === 'stove') {
    // A compact iron body with a stovepipe and an open, hinged door.
    const shell = .16;
    box(group, [shell, h + .2, d + .25], [-(w + shell) / 2, h / 2, 0], iron);
    box(group, [shell, h + .2, d + .25], [(w + shell) / 2, h / 2, 0], iron);
    box(group, [w, h, .15], [0, h / 2, -d / 2 - .075], firebrick);
    box(group, [w + .48, .16, d + .5], [0, h + .08, 0], iron);
    box(group, [w + .3, .17, .2], [0, .085, d / 2 + .08], iron);
    box(group, [w + .3, .12, d + .25], [0, -.06, 0], iron);
    for (const x of [-.58, .58]) for (const z of [-.4, .4]) box(group, [.14, .24, .14], [x, -.18, z], iron);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 3.2, 24), iron);
    pipe.position.set(0, h + 1.75, -.17); pipe.castShadow = true; group.add(pipe);
    for (const y of [h + .25, h + 1.4]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .065, 24), iron);
      collar.position.set(0, y, -.17); group.add(collar);
    }
    const door = new THREE.Group(); door.position.set(-w / 2 - .08, 0, d / 2 + .12); door.rotation.y = -1.9; group.add(door);
    for (const y of [.1, h - .06]) box(door, [w + .1, .12, .10], [w / 2, y, 0], iron);
    for (const x of [0, w]) box(door, [.12, h - .04, .10], [x, h / 2, 0], iron);
    box(door, [.1, .32, .13], [w - .15, h / 2, .13], material('#857967', .7));
    box(group, [8, 6, .2], [0, 2.65, -1.5], material('#47403a'));
  } else {
    const grand = scene.id === 'grand', surround = grand ? .7 : .5;
    box(group, [14, 8, .22], [0, 3.6, -d / 2 - .55], material(grand ? '#403a32' : '#726355'));
    box(group, [w, h, .2], [0, h / 2, -d / 2 - .1], firebrick);
    for (const side of [-1, 1]) {
      masonry(group, [surround, h, d + .25], [side * (w + surround) / 2, h / 2, 0],
        grand ? '#9c8971' : '#8e4e37', grand ? .62 : .40, grand ? .38 : .19, side + 41);
      // Soot-dark reveals keep the opening distinct from the surround.
      box(group, [.025, h, d], [side * (w / 2 + .012), h / 2, 0], firebrick);
    }
    masonry(group, [w + surround * 2, grand ? .85 : .7, d + .25], [0, h + (grand ? .425 : .35), 0],
      grand ? '#9c8971' : '#8e4e37', grand ? .7 : .40, grand ? .28 : .19, 14);
    const mantel = grand ? stone : material('#593722');
    box(group, [w + surround * 2 + .45, .18, d + .7], [0, h + (grand ? .96 : .8), .04], mantel);
    if (grand) {
      for (const side of [-1, 1]) {
        const x = side * (w / 2 + surround / 2);
        box(group, [.54, h - .36, .14], [x, h / 2, d / 2 + .22], stone);
        for (const y of [.15, h - .12]) box(group, [.73, .22, .3], [x, y, d / 2 + .2], stone);
        for (const dx of [-.14, 0, .14]) box(group, [.035, h - .7, .035], [x + dx, h / 2, d / 2 + .31], material('#6c5e4e'));
      }
      box(group, [w + 1.95, .11, d + .9], [0, h + 1.11, .04], stone);
    }
    // A modest iron retainer marks the front of the legal pile.
    box(group, [w, .065, .08], [0, .25, d / 2], iron);
    for (let x = -w / 2 + .15; x < w / 2; x += .3) box(group, [.04, .30, .06], [x, .15, d / 2], iron);
  }
  return { group, surface, colliders: mouthColliders(scene) };
}

// GPU particles use world-space centres. Clip their generated positions too,
// so sparks and steam cannot drift through the stove casing or into the room.
export function containParticles(layers, mouth) {
  const { width, height, depth } = mouth, seen = new Set();
  for (const layer of [layers.sparks, layers.steam]) layer.traverse(object => {
    const mat = object.material;
    if (!mat?.isShaderMaterial || seen.has(mat)) return;
    seen.add(mat);
    const position = mat.vertexShader.includes('vec3 p=') ? 'p' : 'position';
    mat.vertexShader = 'varying vec3 vMouthPosition;\n' + mat.vertexShader.replace(/}\s*$/, `vMouthPosition=${position};}`);
    mat.fragmentShader = 'varying vec3 vMouthPosition;uniform vec3 uMouthLo,uMouthHi;\n' + mat.fragmentShader.replace(/void main\(\)\s*{/, 'void main(){if(any(lessThan(vMouthPosition,uMouthLo))||any(greaterThan(vMouthPosition,uMouthHi)))discard;');
    mat.uniforms.uMouthLo = { value: new THREE.Vector3(-width / 2, 0, -depth / 2) };
    mat.uniforms.uMouthHi = { value: new THREE.Vector3(width / 2, height, depth / 2) };
    mat.needsUpdate = true;
  });
}
