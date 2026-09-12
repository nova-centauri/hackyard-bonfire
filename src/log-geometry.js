import * as THREE from 'three';
import { random } from './textures.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const wrappedAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// One profile drives trunk, caps, exposed wood and peeling bark. In particular,
// cap rims never acquire a different displacement from the side of the log.
export function createLogProfile({ radius, length, seed = 1, faceted = false, fuelType = 'log' }) {
  const rand = random(seed);
  const profile = {
    radius, length, faceted, fuelType, phase: rand() * TAU, bend: (rand() - .5) * .52,
    bendZ: (rand() - .5) * .46, oval: .065 + rand() * .055, twist: (rand() - .5) * .6,
    taper: .77 + rand() * .17, cutX: (rand() - .5) * .14, cutZ: (rand() - .5) * .14,
    knots: Array.from({ length: 2 }, () => ({ t: .18 + rand() * .66, angle: rand() * TAU, size: .10 + rand() * .06 })),
    patches: Array.from({ length: faceted ? 2 : 3 }, (_, i) => ({
      t: .20 + i * .23 + (rand() - .5) * .12, angle: rand() * TAU,
      height: .09 + rand() * .065, width: .24 + rand() * .20, phase: rand() * TAU,
      curl: .025 + rand() * .025,
    })),
  };
  // Ridges, a drying check and a sawn wobble are extra draws from the same
  // seed, so existing knot and patch placement stays put.
  profile.ridges = 6 + (rand() * 3 | 0);
  profile.ridge = .026 + rand() * .018;
  profile.cutWobble = .01 + rand() * .014;
  profile.check = .035 + rand() * .025;
  profile.checkAngle = rand() * TAU;
  if (fuelType === 'kindling') {
    profile.patches = profile.patches.slice(0, 1);
    for (const patch of profile.patches) { patch.width *= .65; patch.height *= .8; patch.curl *= .28; }
    profile.knots = profile.knots.slice(0, 1);
    profile.oval *= .7;
    profile.ridge *= .45; profile.check *= .4; profile.cutWobble *= .5;
  } else if (fuelType === 'small-log') {
    for (const patch of profile.patches) patch.curl *= .65;
    profile.ridge *= .8;
  } else if (fuelType === 'stump') {
    profile.bend *= .2; profile.bendZ *= .2; profile.twist *= .25;
    profile.taper = .88 + rand() * .06;
    profile.rootFlare = { strength: .22 + rand() * .06, lobes: 5, phase: rand() * TAU };
    profile.check *= .25; profile.cutWobble *= .4; profile.ridge *= 1.12;
  }
  if (faceted) { profile.ridge *= .35; profile.check *= .5; }
  return profile;
}

export function sampleLogSurface(profile, angle, t, offset = 0, target = new THREE.Vector3()) {
  const { radius, length, phase } = profile;
  const arch = Math.sin(t * Math.PI), bend = arch * (1 + .25 * Math.sin(t * TAU + phase));
  const cx = radius * profile.bend * bend, cz = radius * profile.bendZ * bend;
  let shape = 1 + profile.oval * Math.cos(2 * angle + phase + t * profile.twist)
    + .038 * Math.sin(3 * angle + phase + t * 1.7)
    + .019 * Math.sin(7 * angle - t * 5 + phase)
    + .022 * Math.sin(t * 11 + phase);
  // Longitudinal bark plates, calmer at the caps so the cut faces stay readable.
  if (profile.ridges) {
    const endCalm = 1 - .4 * (t * 2 - 1) ** 2;
    shape += profile.ridge * Math.sin(angle * profile.ridges + phase + t * 1.35) * endCalm;
  }
  for (const knot of profile.knots) {
    const across = wrappedAngle(angle - knot.angle) / .38, along = (t - knot.t) / .075;
    shape += knot.size * Math.exp(-across * across - along * along);
  }
  // Missing bark is a shallow dent in solid wood, never a discarded face.
  for (const patch of profile.patches) {
    const across = wrappedAngle(angle - patch.angle) / patch.width, along = (t - patch.t) / patch.height;
    shape -= .033 * Math.exp(-(across * across + along * along) * 2.3);
  }
  // A drying check pinches the cut face along one diameter, like split firewood.
  if (profile.check) {
    const end = Math.pow(Math.abs(t * 2 - 1), 8);
    shape -= profile.check * end * Math.pow(Math.abs(Math.cos(angle - profile.checkAngle)), 5);
  }
  // Stump roots widen toward the base, with distinct buttresses around its rim.
  // Sampling this here keeps bark patches and both cap rims on the same shape.
  const roots = profile.rootFlare;
  const flare = roots ? (1 - t) ** 3 * (.13 + roots.strength * ((1 + Math.cos(angle * roots.lobes + roots.phase)) * .5) ** 3) : 0;
  const r = radius * (1 + (profile.taper - 1) * t) * (clamp(shape, .78, 1.18) + flare);
  const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  const cutWeight = Math.pow(Math.abs(t * 2 - 1), 6);
  const saw = (profile.cutWobble || 0) * Math.sin(angle * 3 + phase) * cutWeight * radius;
  const y = (t - .5) * length + (x * profile.cutX + z * profile.cutZ) * cutWeight + saw;
  return target.set(cx + x + Math.cos(angle) * offset, y, cz + z + Math.sin(angle) * offset);
}

export function createLogGeometry(options) {
  const profile = createLogProfile(options), sides = profile.faceted ? 8 : 36, rows = profile.faceted ? 8 : 32;
  const geometry = new THREE.CylinderGeometry(1, 1, profile.length, sides, rows, false);
  const positions = geometry.attributes.position, point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), t = clamp(positions.getY(i) / profile.length + .5, 0, 1);
    if (Math.hypot(x, z) < .001) point.set(0, (t - .5) * profile.length, 0);
    else sampleLogSurface(profile, Math.atan2(z, x), t, 0, point);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  // CylinderGeometry allocates 0=bark, 1=top, 2=bottom. Our two-material
  // meshes deliberately share the end material; leaving group 2 loses a cap.
  for (const group of geometry.groups) if (group.materialIndex === 2) group.materialIndex = 1;
  geometry.groups[1].count += geometry.groups[2].count;
  geometry.groups.pop();
  geometry.computeVertexNormals();
  if (!profile.faceted) {
    // The UV seam duplicates vertices; smooth that seam without smoothing the
    // separate cut-face normals into the bark at either rim.
    const normals = geometry.attributes.normal;
    for (let row = 0; row <= rows; row++) {
      const first = row * (sides + 1), last = first + sides;
      point.fromBufferAttribute(normals, first).add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
      normals.setXYZ(first, point.x, point.y, point.z); normals.setXYZ(last, point.x, point.y, point.z);
    }
  }
  geometry.userData.profile = profile;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

// Use the same material array in the scene and front-face cap regression tests.
export function createLogMesh(options, barkMaterial, endMaterial) {
  return new THREE.Mesh(createLogGeometry(options), [barkMaterial, endMaterial]);
}

function makeGeometry(positions, uvs, indices, groups = []) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeVertexNormals();
  return geometry;
}

export function createBarkDetails(profile) {
  const positions = [], uvs = [], indices = [], peelPositions = [], peelUvs = [], peelIndices = [], groups = [];
  const rows = profile.faceted ? 8 : 16, columns = profile.faceted ? 4 : 8;
  const point = new THREE.Vector3();
  for (const patch of profile.patches) {
    const start = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      const v = row / rows, t = patch.t + (v * 2 - 1) * patch.height;
      // Jagged, asymmetrical edges make each scraped area read as torn bark.
      const width = patch.width * (.12 + .88 * Math.pow(Math.sin(v * Math.PI), .64))
        * (1 + .10 * Math.sin(v * 31 + patch.phase) + .08 * Math.cos(v * 53));
      for (let column = 0; column <= columns; column++) {
        const u = column / columns, angle = patch.angle + (u * 2 - 1) * width;
        sampleLogSurface(profile, angle, t, .0025, point);
        positions.push(point.x, point.y, point.z); uvs.push(u, t * 2.4);
        if (row < rows && column < columns) {
          const a = start + row * (columns + 1) + column, b = a + 1, c = a + columns + 1, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    // A thick, curled strip grows from one ragged edge. The underside is pale
    // wood; all edges are closed, so orbiting never reveals an invisible face.
    const stripRows = profile.faceted ? 5 : 9, stripColumns = 3, stripStart = peelPositions.length / 3;
    const sideCount = (stripRows + 1) * (stripColumns + 1);
    for (let side = 0; side < 2; side++) for (let row = 0; row <= stripRows; row++) {
      const v = row / stripRows, t = patch.t - patch.height * .72 + v * patch.height * 1.12;
      const width = .06 + .025 * Math.sin(v * 9 + patch.phase);
      for (let column = 0; column <= stripColumns; column++) {
        const u = column / stripColumns, lift = .004 + patch.curl * Math.sin(v * Math.PI * .62) ** 2;
        const angle = patch.angle + patch.width * .77 + u * width + v * v * .12;
        sampleLogSurface(profile, angle, t, lift + side * .006, point);
        peelPositions.push(point.x, point.y, point.z); peelUvs.push(u, v);
      }
    }
    for (let side = 0; side < 2; side++) {
      const groupStart = peelIndices.length;
      for (let row = 0; row < stripRows; row++) for (let column = 0; column < stripColumns; column++) {
        const a = stripStart + side * sideCount + row * (stripColumns + 1) + column, b = a + 1, c = a + stripColumns + 1, d = c + 1;
        if (side) peelIndices.push(a, c, b, b, c, d); else peelIndices.push(a, b, c, b, d, c);
      }
      groups.push({ start: groupStart, count: peelIndices.length - groupStart, materialIndex: side ? 0 : 1 });
    }
    const edgeStart = peelIndices.length, edges = [];
    for (let row = 0; row < stripRows; row++) {
      edges.push([row * (stripColumns + 1), (row + 1) * (stripColumns + 1)]);
      edges.push([(row + 1) * (stripColumns + 1) + stripColumns, row * (stripColumns + 1) + stripColumns]);
    }
    for (let column = 0; column < stripColumns; column++) {
      edges.push([column + 1, column]);
      edges.push([stripRows * (stripColumns + 1) + column, stripRows * (stripColumns + 1) + column + 1]);
    }
    for (const [i, j] of edges) {
      const a = stripStart + i, b = stripStart + j, c = a + sideCount, d = b + sideCount;
      peelIndices.push(a, b, c, b, d, c);
    }
    groups.push({ start: edgeStart, count: peelIndices.length - edgeStart, materialIndex: 0 });
  }
  // Batch all strips by surface material rather than issuing a draw per strip.
  const batched = [], materialGroups = [];
  for (const materialIndex of [0, 1]) {
    const start = batched.length;
    for (const group of groups) if (group.materialIndex === materialIndex) batched.push(...peelIndices.slice(group.start, group.start + group.count));
    materialGroups.push({ start, count: batched.length - start, materialIndex });
  }
  return { exposed: makeGeometry(positions, uvs, indices), peeling: makeGeometry(peelPositions, peelUvs, batched, materialGroups) };
}
