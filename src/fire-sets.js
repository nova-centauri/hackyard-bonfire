import * as THREE from 'three';
import { createStoneCollider } from './rocks.js';
import { random } from './textures.js';

const material = (color, metalness = 0, roughness = .92) => new THREE.MeshStandardMaterial({ color, metalness, roughness });

function box(parent, size, position, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function dataTexture(size, pixel) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, [r, g, b] = pixel(x / size, y / size);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function grainMap(seed = 3) {
  const rand = random(seed);
  return dataTexture(128, (u, v) => {
    const wave = .5 + .5 * Math.sin(v * 42 + Math.sin(u * 7) * 2.2);
    const shade = .38 + wave * .28 + rand() * .08;
    return [shade * 145, shade * 98, shade * 58];
  });
}

function tartanMap() {
  return dataTexture(128, (u, v) => {
    const x = (u * 3.2) % 1, y = (v * 3.2) % 1;
    let r = 36, g = 38, b = 48;
    const band = (a, lo, hi) => (a >= lo && a <= hi);
    if (band(x, 0, .08) || band(x, .46, .54) || band(y, 0, .08) || band(y, .46, .54)) { r = 210; g = 204; b = 192; }
    if (band(x, .2, .28) || band(y, .2, .28)) { r = 148; g = 32; b = 38; }
    if (band(x, .7, .74) || band(y, .7, .74)) { r = 184; g = 150; b = 64; }
    return [r, g, b];
  });
}

const BRICK_PALETTES = {
  home: ['#a35238', '#8b3d28', '#c26a44', '#6e3222', '#b45a3a', '#7a4530'],
  grand: ['#c4b296', '#9a8870', '#d2c2a6', '#8a7862', '#b8a888', '#ae9a7c'],
  cream: ['#e6dccb', '#d4c8b4', '#efe6d6', '#c8bca8', '#ddd2c0', '#bdb3a0'],
};

// Instanced running-bond (or ashlar) on +Z or ±X faces. One draw for a whole set.
class BrickBatch {
  constructor() { this.bricks = []; }
  wall({ width, height, cx, cy, cz, axis = 'z', sign = 1, color, brickWidth, rowHeight, seed, gap = .016, depth = .07, soot = 0, irregular = .22 }) {
    const rand = random(seed), rows = Math.max(1, Math.round(height / rowHeight)), stepY = height / rows;
    for (let row = 0; row < rows; row++) {
      const offset = (row % 2) * brickWidth / 2;
      let left = -width / 2 - offset;
      while (left < width / 2) {
        const span = brickWidth * (irregular ? .72 + rand() * irregular : 1);
        const a = Math.max(-width / 2, left), b = Math.min(width / 2, left + span);
        left += span;
        if (b - a < .03) continue;
        const x = (a + b) / 2, y = -height / 2 + (row + .5) * stepY;
        const towardFire = 1 - Math.min(1, Math.abs(x) / Math.max(.2, width / 2));
        const low = 1 - (y + height / 2) / height;
        const sootShade = soot ? Math.max(.52, 1 - soot * towardFire * (.35 + low * .65)) : 1;
        const palette = Array.isArray(color) ? color : [color];
        this.bricks.push({
          cx, cy, cz, axis, sign, x, y,
          w: b - a - gap, h: stepY - gap, d: depth * (.88 + rand() * .42),
          color: palette[Math.floor(rand() * palette.length)],
          shade: (.82 + rand() * .34) * sootShade,
        });
      }
    }
  }
  flush(parent) {
    if (!this.bricks.length) return null;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material('#ffffff'), this.bricks.length);
    mesh.name = 'hearth-masonry';
    const object = new THREE.Object3D(), tint = new THREE.Color();
    this.bricks.forEach((brick, index) => {
      if (brick.axis === 'z') {
        object.position.set(brick.cx + brick.x, brick.cy + brick.y, brick.cz + brick.sign * brick.d / 2);
        object.scale.set(brick.w, brick.h, brick.d);
      } else {
        object.position.set(brick.cx + brick.sign * brick.d / 2, brick.cy + brick.y, brick.cz + brick.x);
        object.scale.set(brick.d, brick.h, brick.w);
      }
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
      mesh.setColorAt(index, tint.set(brick.color).multiplyScalar(brick.shade));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
}

function addFloor(parent, { y, color, seed, width = 11, depth = 9.5, z = 2.4 }) {
  const rand = random(seed), plankW = .155, plankL = 2.35;
  const cols = Math.ceil(width / plankW), rows = Math.ceil(depth / plankL);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material('#ffffff'), cols * rows);
  mesh.name = 'hearth-floor';
  const object = new THREE.Object3D(), tint = new THREE.Color();
  let index = 0;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    object.position.set(-width / 2 + (col + .5) * plankW, y, z - depth / 2 + (row + .5) * plankL);
    object.scale.set(plankW - .007, .032, plankL - .012);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
    mesh.setColorAt(index, tint.set(color).multiplyScalar(.7 + rand() * .4));
    index++;
  }
  mesh.castShadow = false; mesh.receiveShadow = true; parent.add(mesh);
}

function addRug(parent, { width, depth, y, z, map }) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map, roughness: .96 }));
  mesh.name = 'hearth-rug';
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, y, z); mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function addWoodpile(parent, piles, seed) {
  const group = new THREE.Group(); group.name = 'hearth-woodpile'; parent.add(group);
  const pieces = [];
  piles.forEach((pile, pileIndex) => {
    const rand = random(seed + pileIndex * 17);
    const radius = pile.radius ?? .055, length = pile.length ?? .34;
    const along = pile.along ?? 'z';
    for (let row = 0; row < pile.rows; row++) {
      const count = pile.cols - (row % 2 && pile.cols > 1 ? 1 : 0);
      for (let col = 0; col < count; col++) {
        const jitter = (rand() - .5) * .012;
        const x = along === 'z'
          ? pile.x - ((count - 1) / 2) * radius * 2.05 + col * radius * 2.05 + jitter
          : pile.x;
        const z = along === 'x'
          ? pile.z - ((count - 1) / 2) * radius * 2.05 + col * radius * 2.05 + jitter
          : pile.z;
        pieces.push({
          x, y: pile.y + radius + row * radius * 1.92, z,
          radius: radius * (.88 + rand() * .22),
          length: length * (.9 + rand() * .18),
          along, end: !!pile.end,
          shade: pile.end ? .7 + rand() * .28 : .55 + rand() * .45,
        });
      }
    }
  });
  if (!pieces.length) return group;
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), material('#ffffff'), pieces.length);
  const object = new THREE.Object3D(), tint = new THREE.Color();
  pieces.forEach((piece, index) => {
    object.position.set(piece.x, piece.y, piece.z);
    if (piece.along === 'z') object.rotation.set(Math.PI / 2, 0, 0);
    else object.rotation.set(0, 0, Math.PI / 2);
    object.scale.set(piece.radius, piece.length, piece.radius);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
    mesh.setColorAt(index, tint.set(piece.end ? '#a07a48' : '#5a3c24').multiplyScalar(piece.shade));
  });
  mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  return group;
}

function addTools(parent, { x, y, z, brass = false }) {
  const group = new THREE.Group(); group.name = 'hearth-tools';
  const metal = material(brass ? '#8d6b38' : '#2c2e32', brass ? .72 : .62, brass ? .38 : .5);
  box(group, [.045, .78, .045], [x, y + .4, z], metal);
  box(group, [.24, .03, .24], [x, y + .02, z], metal);
  box(group, [.3, .025, .07], [x, y + .76, z], metal);
  [[-.08, .64], [0, .6], [.08, .56]].forEach(([dx, len]) => {
    box(group, [.016, len, .016], [x + dx, y + .4, z + .045], metal);
    box(group, [dx ? .04 : .07, .03, .03], [x + dx, y + .08 + len * .02, z + .06], metal);
  });
  parent.add(group);
}

function addAndirons(parent, w, d, iron) {
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - .18);
    box(parent, [.045, .22, .045], [x, .12, d / 2 - .1], iron);
    box(parent, [.05, .05, .22], [x, .04, d / 2 - .16], iron);
    box(parent, [.07, .08, .05], [x, .05, d / 2 - .02], iron);
  }
}

function addRoom(parent, { floorY, wallColor, ceilingY, backZ, seed, floorColor, rug }) {
  const room = new THREE.Group(); room.name = 'hearth-room'; parent.add(room);
  addFloor(room, { y: floorY, color: floorColor, seed });
  const plaster = material(wallColor);
  box(room, [13, ceilingY - floorY, .16], [0, (ceilingY + floorY) / 2, backZ], plaster);
  for (const side of [-1, 1]) box(room, [.16, ceilingY - floorY, 10], [side * 5.6, (ceilingY + floorY) / 2, 2.2], plaster);
  box(room, [13, .12, 10], [0, ceilingY, 2.2], material('#2a241c')).castShadow = false;
  for (const side of [-1, 1]) box(room, [.08, .14, 10], [side * 5.5, floorY + .1, 2.2], material('#4a3a2c'));
  addRug(room, rug);
  return room;
}

function addMantelGoods(parent, scene, y, z, mats) {
  const goods = new THREE.Group(); goods.name = 'hearth-mantel-goods'; parent.add(goods);
  const brass = material('#8a6a36', .7, .35);
  if (scene.id === 'stove') {
    for (const x of [-.62, .62]) {
      box(goods, [.04, .2, .04], [x, y + .12, z], brass);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .038, .06, 10), brass);
      cup.position.set(x, y + .24, z); goods.add(cup);
    }
    return;
  }
  const span = scene.mouth.width * (scene.id === 'grand' ? .3 : .24);
  for (const x of [-span, span]) {
    box(goods, [.045, scene.id === 'grand' ? .26 : .2, .045], [x, y + .14, z], brass);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(.05, .04, .065, 10), brass);
    cup.position.set(x, y + (scene.id === 'grand' ? .3 : .24), z); goods.add(cup);
  }
  box(goods, [.16, .2, .06], [0, y + .12, z], material('#2b241c'));
  box(goods, [.018, .018, .02], [0, y + .12, z + .04], brass);
  if (scene.id === 'grand') {
    box(goods, [.42, .08, .12], [0, y + .28, z], mats.stone);
    for (const x of [-.9, .9]) box(goods, [.12, .16, .1], [x, y + .1, z], mats.stone);
  }
}

function addFireplace(group, scene, mats) {
  const { width: w, height: h, depth: d } = scene.mouth;
  const grand = scene.id === 'grand', surround = grand ? .78 : .52;
  const bricks = new BrickBatch();
  const brickColor = grand ? BRICK_PALETTES.grand : BRICK_PALETTES.home;
  const brickW = grand ? .7 : .38, brickH = grand ? .36 : .175, soot = grand ? .22 : .38;
  box(group, [w, h, .18], [0, h / 2, -d / 2 - .09], mats.firebrick);
  box(group, [w, .04, d], [0, .003, 0], mats.soot);
  for (const side of [-1, 1]) {
    const x = side * (w + surround) / 2;
    box(group, [surround, h, d + .28], [x, h / 2, .02], mats.mortar);
    bricks.wall({ width: surround, height: h, cx: x, cy: h / 2, cz: d / 2 + .16, axis: 'z', sign: 1, color: brickColor, brickWidth: brickW, rowHeight: brickH, seed: 40 + side, soot });
    bricks.wall({ width: d + .2, height: h, cx: side * (w / 2 + .012), cy: h / 2, cz: 0, axis: 'x', sign: -side, color: '#4a3228', brickWidth: .36, rowHeight: .16, seed: 70 + side, soot: .7, depth: .03 });
    bricks.wall({ width: d + .1, height: h, cx: x + side * surround / 2, cy: h / 2, cz: 0, axis: 'x', sign: side, color: brickColor, brickWidth: brickW, rowHeight: brickH, seed: 90 + side });
    box(group, [.03, h, d], [side * (w / 2 + .015), h / 2, 0], mats.soot);
  }
  const breast = grand ? .92 : .74;
  box(group, [w + surround * 2, breast, d + .28], [0, h + breast / 2, .02], mats.mortar);
  bricks.wall({ width: w + surround * 2, height: breast, cx: 0, cy: h + breast / 2, cz: d / 2 + .16, axis: 'z', sign: 1, color: brickColor, brickWidth: grand ? .78 : .4, rowHeight: grand ? .3 : .18, seed: 14, soot: .22 });
  const hearthFrontW = w + surround * 2 + 1.1, hearthFrontY = -.1;
  bricks.wall({ width: hearthFrontW, height: .22, cx: 0, cy: hearthFrontY - .11, cz: d / 2 + .95, axis: 'z', sign: 1, color: brickColor, brickWidth: brickW, rowHeight: .11, seed: 3, irregular: .18 });
  bricks.flush(group);

  const mantel = new THREE.Group(); mantel.name = 'hearth-mantel'; group.add(mantel);
  if (grand) {
    box(mantel, [w + surround * 2 + .55, .16, d + .85], [0, h + breast + .12, .08], mats.stone);
    box(mantel, [w + surround * 2 + .75, .1, d + 1.05], [0, h + breast + .26, .1], mats.stone);
    for (const side of [-1, 1]) {
      const x = side * (w / 2 + surround / 2);
      box(mantel, [.62, h - .4, .16], [x, h / 2, d / 2 + .28], mats.stone);
      box(mantel, [.78, .18, .34], [x, .16, d / 2 + .26], mats.stone);
      box(mantel, [.8, .2, .36], [x, h - .08, d / 2 + .26], mats.stone);
      for (const dx of [-.16, 0, .16]) box(mantel, [.04, h - .72, .04], [x + dx, h / 2, d / 2 + .38], mats.flute);
    }
  } else {
    const wood = new THREE.MeshStandardMaterial({ map: mats.grain, roughness: .82, color: '#7a4a28' });
    box(mantel, [w + surround * 2 + .7, .24, d + .86], [0, h + breast + .14, .1], wood);
    for (const side of [-1, 1]) {
      const x = side * (w / 2 + surround * .28);
      box(mantel, [.24, .34, .28], [x, h + breast - .1, d / 2 + .22], wood);
    }
  }
  addMantelGoods(group, scene, grand ? h + breast + .32 : h + breast + .22, d / 2 + .12, mats);

  box(group, [w * .92, .05, .07], [0, .22, d / 2 + .01], mats.iron);
  for (let x = -w / 2 + .2; x < w / 2; x += grand ? .42 : .32) box(group, [.035, .28, .055], [x, .15, d / 2 + .01], mats.iron);
  addAndirons(group, w, d, mats.iron);
}

function addStove(group, scene, mats) {
  const { width: w, height: h, depth: d } = scene.mouth;
  const stove = new THREE.Group(); stove.name = 'wood-stove'; group.add(stove);
  const body = new THREE.Group(); body.name = 'stove-body'; stove.add(body);
  const iron = mats.iron, shell = .05;
  box(body, [shell, h + .12, d + .18], [-(w + shell) / 2, h / 2 + .01, .02], iron);
  box(body, [shell, h + .12, d + .18], [(w + shell) / 2, h / 2 + .01, .02], iron);
  box(body, [w + shell * 2, h + .12, .06], [0, h / 2 + .01, -d / 2 - .03], iron);
  box(group, [w, h, .1], [0, h / 2, -d / 2 - .04], mats.firebrick);
  box(body, [w + .2, .04, d + .24], [0, h + .08, .02], iron);
  box(body, [w + .16, .045, d + .2], [0, -.02, .02], iron);
  box(body, [w * .7, .07, .045], [0, .055, d / 2 + .08], iron);
  box(body, [w * .38, .014, .028], [0, .055, d / 2 + .11], mats.steel);
  for (const x of [-w / 2 + .07, w / 2 - .07]) for (const z of [-d / 2 + .1, d / 2 - .06]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.018, .028, .24, 8), iron);
    leg.position.set(x, -.14, z); leg.castShadow = true; body.add(leg);
  }
  for (const x of [-w / 2 + .02, w / 2 - .02]) box(body, [.045, h, .04], [x, h / 2, d / 2 + .02], iron);
  box(body, [w, .045, .04], [0, h - .01, d / 2 + .02], iron);
  box(body, [w, .045, .04], [0, .04, d / 2 + .02], iron);

  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.068, .068, 1.55, 18), iron);
  pipe.name = 'stove-pipe'; pipe.position.set(0, h + .88, -.06); pipe.castShadow = true; stove.add(pipe);
  for (const y of [h + .16, h + 1.05]) {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(.082, .082, .05, 18), iron);
    collar.position.set(0, y, -.06); stove.add(collar);
  }

  const door = new THREE.Group(); door.position.set(-w / 2 - .02, 0, d / 2 + .04); door.rotation.y = -1.35; stove.add(door);
  box(door, [w + .02, .055, .04], [w / 2, .06, 0], iron);
  box(door, [w + .02, .055, .04], [w / 2, h - .04, 0], iron);
  box(door, [.05, h - .06, .04], [.02, h / 2, 0], iron);
  box(door, [.05, h - .06, .04], [w - .02, h / 2, 0], iron);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * .82, h * .7),
    new THREE.MeshStandardMaterial({ color: '#2a1810', metalness: .45, roughness: .08, transparent: true, opacity: .28, emissive: '#5a220c', emissiveIntensity: .18 }));
  glass.position.set(w / 2, h / 2, .008); door.add(glass);
  box(door, [.035, .2, .055], [w - .06, h / 2, .05], mats.steel);
}

function addStoveAlcove(group, scene, mats) {
  const { depth: d } = scene.mouth;
  const alcoveW = 2.4, alcoveH = 2.14, breastW = 3.55, breastD = .7;
  const backZ = -d / 2 - .4, frontZ = backZ + breastD;
  const alcove = new THREE.Group(); alcove.name = 'stove-alcove'; group.add(alcove);
  const bricks = new BrickBatch();
  box(alcove, [alcoveW, alcoveH, .14], [0, alcoveH / 2, backZ], mats.mortar);
  bricks.wall({ width: alcoveW, height: alcoveH, cx: 0, cy: alcoveH / 2, cz: backZ + .07, axis: 'z', sign: 1, color: BRICK_PALETTES.cream, brickWidth: .36, rowHeight: .165, seed: 21, irregular: .1, soot: .08 });
  for (const side of [-1, 1]) {
    box(alcove, [.12, alcoveH, breastD], [side * alcoveW / 2, alcoveH / 2, backZ + breastD / 2], mats.mortar);
    bricks.wall({ width: breastD, height: alcoveH, cx: side * alcoveW / 2, cy: alcoveH / 2, cz: backZ + breastD / 2, axis: 'x', sign: -side, color: BRICK_PALETTES.cream, brickWidth: .34, rowHeight: .165, seed: 30 + side, irregular: .1 });
    const jambW = (breastW - alcoveW) / 2;
    box(alcove, [jambW, alcoveH, .16], [side * (alcoveW + jambW) / 2, alcoveH / 2, frontZ], mats.mortar);
    bricks.wall({ width: jambW, height: alcoveH, cx: side * (alcoveW + jambW) / 2, cy: alcoveH / 2, cz: frontZ + .08, axis: 'z', sign: 1, color: BRICK_PALETTES.cream, brickWidth: .36, rowHeight: .165, seed: 50 + side, irregular: .1 });
  }
  box(alcove, [breastW, .55, .16], [0, alcoveH + .275, frontZ], mats.mortar);
  bricks.wall({ width: breastW, height: .55, cx: 0, cy: alcoveH + .275, cz: frontZ + .08, axis: 'z', sign: 1, color: BRICK_PALETTES.cream, brickWidth: .38, rowHeight: .17, seed: 8, irregular: .1 });
  bricks.flush(alcove);
  const mantel = new THREE.Group(); mantel.name = 'hearth-mantel'; group.add(mantel);
  box(mantel, [breastW + .22, .13, .4], [0, alcoveH + .62, frontZ + .08], mats.charcoal);
  addMantelGoods(group, scene, alcoveH + .7, frontZ + .14, mats);
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
  const stove = scene.id === 'stove', grand = scene.id === 'grand';
  const mats = {
    iron: material('#1f2126', .68, .48),
    steel: material('#7a7060', .72, .38),
    firebrick: material('#3d2c24'),
    soot: material('#2a201c'),
    mortar: material(stove ? '#7a7268' : grand ? '#6a5c4c' : '#b7a898'),
    stone: material('#a3927a'),
    flute: material('#6c5e4e'),
    charcoal: material('#1c1d20', .15, .7),
    grain: grainMap(scene.id === 'home' ? 11 : 19),
  };
  const floorY = stove ? -.8 : grand ? -.52 : -.48;
  const hearthY = stove ? -.26 : -.1;
  addRoom(group, {
    floorY, wallColor: stove ? '#d4c6b0' : grand ? '#6e5c48' : '#d2c2a8',
    ceilingY: stove ? 3.15 : grand ? 4.6 : 3.85, backZ: stove ? -d / 2 - .55 : -d / 2 - .7,
    seed: stove ? 4 : grand ? 6 : 5, floorColor: stove ? '#6b4e32' : grand ? '#4a3828' : '#5c4028',
    rug: { width: stove ? 3.4 : grand ? 5.6 : 4.2, depth: stove ? 2.15 : grand ? 3.1 : 2.5, y: floorY + .02, z: stove ? 2.35 : 3.1, map: tartanMap() },
  });

  const hearth = box(group, stove ? [2.62, .075, 2.05] : [w + 2.15, .22, d + 1.55],
    stove ? [0, hearthY - .038, .38] : [0, hearthY - .11, .32], stove ? material('#6d7278', .08, .55) : grand ? mats.stone : material('#8d6a52'));
  hearth.name = 'hearth-slab';
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material('#2c2620'));
  surface.rotation.x = -Math.PI / 2; surface.position.y = .002; surface.receiveShadow = true; group.add(surface);

  if (stove) {
    addStoveAlcove(group, scene, mats);
    addStove(group, scene, mats);
    addWoodpile(group, [
      { x: 0, y: floorY + .01, z: .78, rows: 5, cols: 11, radius: .062, length: .46, along: 'z', end: true },
      { x: -.88, y: hearthY, z: .38, rows: 5, cols: 3, radius: .058, length: .36, along: 'x' },
      { x: .88, y: hearthY, z: .38, rows: 5, cols: 3, radius: .058, length: .36, along: 'x' },
    ], 81);
  } else {
    addFireplace(group, scene, mats);
    const stackX = w / 2 + (grand ? .82 : .62);
    addWoodpile(group, [
      { x: -stackX, y: hearthY + .02, z: d / 2 * .35, rows: grand ? 6 : 5, cols: grand ? 5 : 4, radius: grand ? .078 : .068, length: grand ? .52 : .42, along: 'x' },
      { x: stackX, y: hearthY + .02, z: d / 2 * .35, rows: grand ? 6 : 5, cols: grand ? 5 : 4, radius: grand ? .078 : .068, length: grand ? .52 : .42, along: 'x' },
    ], grand ? 27 : 19);
    addTools(group, { x: stackX + (grand ? .62 : .5), y: hearthY + .02, z: d / 2 + .28, brass: grand });
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
