import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createHearthTextures } from './hearth-textures.js';
import { createStoneCollider } from './rocks.js';
import { random } from './textures.js';

const material = (color, metalness = 0, roughness = .96) => new THREE.MeshStandardMaterial({ color, metalness, roughness });

// Room furnishings are static. Merge each material's boxes into one draw,
// including the brick courses, instead of making a draw per rail or pillar.
function batch(parent, name, mat, castShadow = true) {
  const parts = [];
  return {
    box(size, position, { color, rotateY = 0, uv } = {}) {
      const geometry = new THREE.BoxGeometry(...size);
      geometry.rotateY(rotateY); geometry.translate(...position);
      if (color) {
        const values = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
        geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
      }
      if (uv) {
        const points = geometry.attributes.position, coords = geometry.attributes.uv;
        for (let i = 0; i < points.count; i++) {
          const [u, v] = uv(points.getX(i), points.getY(i), points.getZ(i)); coords.setXY(i, u, v);
        }
      }
      parts.push(geometry);
    },
    finish() {
      const geometry = mergeGeometries(parts, false);
      parts.forEach(part => part.dispose());
      const mesh = new THREE.Mesh(geometry, mat); mesh.name = name;
      mesh.castShadow = castShadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
    },
  };
}

// Fit staggered courses exactly between the opening boundaries. Small gaps
// expose a recessed mortar backing and still read as brick in dim firelight.
function brickCourses(target, width, height, center, { brickWidth = .41, rowHeight = .18, depth = .075, seed = 14, rotateY = 0, pigment = '#ffffff', uv } = {}) {
  const rand = random(seed), rows = Math.max(1, Math.round(height / rowHeight)), step = height / rows;
  const [cx, cy, cz] = center, cos = Math.cos(rotateY), sin = Math.sin(rotateY), tint = new THREE.Color(pigment);
  for (let row = 0; row < rows; row++) {
    for (let left = -width / 2 - (row % 2) * brickWidth / 2; left < width / 2; left += brickWidth) {
      const a = Math.max(-width / 2, left), b = Math.min(width / 2, left + brickWidth);
      if (b - a < .025) continue;
      const x = (a + b) / 2;
      target.box([b - a - .014, step - .012, depth + rand() * .012], [cx + x * cos, cy - height / 2 + (row + .5) * step, cz - x * sin],
        { rotateY, color: tint.clone().multiplyScalar(.76 + rand() * .30), uv });
    }
  }
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
  const { width: w, height: h, depth: d } = scene.mouth, surround = .49;
  const textures = createHearthTextures();
  const stoneMat = material('#b0aaa1'); stoneMat.map = stoneMat.bumpMap = textures.stone; stoneMat.bumpScale = .017;
  const brickMat = material('#ffffff'); brickMat.vertexColors = true;
  brickMat.map = brickMat.bumpMap = textures.brick; brickMat.bumpScale = .010;
  const firebrickMat = material('#ffffff'); firebrickMat.vertexColors = true;
  firebrickMat.map = firebrickMat.bumpMap = textures.firebox; firebrickMat.bumpScale = .006;
  // The room map already contains its subdued illumination and wall detail.
  // Keep that bake legible without adding room lights or lighting this wall twice.
  const wallMat = new THREE.MeshBasicMaterial({ color: '#aaa098', map: textures.wall });
  const room = batch(group, 'Dark plaster room', wallMat, false);
  const stone = batch(group, 'Raised hearth and lower landing', stoneMat);
  const mortar = batch(group, 'Recessed masonry mortar', material('#24201a'));
  const brick = batch(group, 'Terracotta brick surround', brickMat);
  const firebrick = batch(group, 'Scorched firebox brick', firebrickMat);
  const timber = batch(group, 'Aged timber mantel and skirting', material('#25180f'));
  const iron = batch(group, 'Blackened iron fire guard', material('#111315', .65, .67));

  const roomWallZ = -d / 2 - .40;
  room.box([14, 8, .20], [0, 3.3, roomWallZ], { uv: (x, y) => [x / 14 + .5, (y + .7) / 8] });
  room.finish();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), material('#171410'));
  floor.name = 'Room floor'; floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -.71, 3); floor.receiveShadow = true; group.add(floor);

  // The fire retains its established y=0 ground plane. Lowering the landing
  // exposes a substantial raised plinth without offsetting fuel or particles.
  stone.box([w + 2.05, .39, d + 1.48], [0, -.515, .38]); // landing from floor -.71 to -.32
  stone.box([w + 1.20, .31, d + .56], [0, -.155, .10]); // seated on cap -.31; firebox top 0
  stone.box([w + 2.14, .075, d + 1.57], [0, -.3475, .38]); // thin overhanging edge
  stone.finish();
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material('#211e19'));
  surface.name = 'Firebox floor'; surface.rotation.x = -Math.PI / 2;
  surface.position.y = .004; surface.receiveShadow = true; group.add(surface);

  const front = d / 2 + .15, fullWidth = w + surround * 2;
  for (const side of [-1, 1]) {
    // Recess the backing beyond the reveal faces; an inner face on the
    // legal mouth plane would hide the side bricks behind a flat wall.
    mortar.box([surround - .095, h + .28, d + .38], [side * ((w + surround) / 2 + .0475), (h - .28) / 2, .02]);
    brickCourses(brick, surround, h + .28, [side * (w + surround) / 2, (h - .28) / 2, front + .055], { seed: side + 41 });
  }
  // Three stout courses above the shorter opening give the surround weight.
  const lintelHeight = .59;
  mortar.box([fullWidth, lintelHeight, d + .38], [0, h + lintelHeight / 2, .02]);
  brickCourses(brick, fullWidth, lintelHeight, [0, h + lintelHeight / 2, front + .055], { seed: 14, rowHeight: .19 });

  // Brick faces sit outside all three legal mouth planes, leaving the exact
  // existing collider and fuel space clear. UVs span the whole soot pattern.
  const fireboxUV = (x, y) => [THREE.MathUtils.clamp(x / w + .5, 0, 1), THREE.MathUtils.clamp(y / h, 0, 1)];
  mortar.box([w, h, .19], [0, h / 2, -d / 2 - .13]);
  brickCourses(firebrick, w, h, [0, h / 2, -d / 2 - .045], { seed: 18, rowHeight: .178, brickWidth: .405, uv: fireboxUV });
  for (const side of [-1, 1]) {
    brickCourses(firebrick, d, h, [side * (w / 2 + .046), h / 2, 0], {
      seed: side + 29, rowHeight: .178, brickWidth: .405, rotateY: side * Math.PI / 2,
      uv: (_x, y, z) => [.5 + side * (.31 + .19 * (z / d + .5)), THREE.MathUtils.clamp(y / h, 0, 1)],
    });
  }
  // Soot-black lintel underside masks the top of the box without another draw.
  mortar.box([w, .045, d], [0, h + .023, 0]);
  mortar.finish(); brick.finish(); firebrick.finish();

  const mantelTop = h + lintelHeight + .19;
  timber.box([fullWidth + .36, .19, d + .74], [0, mantelTop - .095, .06]);
  timber.box([fullWidth + .22, .055, d + .59], [0, mantelTop - .215, .035]);
  // Two restrained corbels and the room skirting share the timber draw.
  for (const side of [-1, 1]) timber.box([.16, .20, .19], [side * (w / 2 + .28), mantelTop - .32, front + .03]);
  timber.box([14, .12, .085], [0, -.63, roomWallZ + .14]);
  timber.finish();

  iron.box([w - .12, .052, .055], [0, .21, d / 2 - .035]);
  for (let x = -w / 2 + .19; x < w / 2 - .08; x += .31) iron.box([.032, .24, .045], [x, .12, d / 2 - .035]);
  iron.finish();
  return {
    group, surface, colliders: mouthColliders(scene),
    textureRegistry: {
      hearthWall: { map: textures.wall },
      hearthBrick: { map: textures.brick, bump: textures.brick },
      hearthFirebox: { map: textures.firebox, bump: textures.firebox },
      hearthStone: { map: textures.stone, bump: textures.stone },
    },
  };
}

// GPU particles use world-space centres. Clip their generated positions too,
// so sparks and steam cannot drift through the brick surround or into the room.
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
