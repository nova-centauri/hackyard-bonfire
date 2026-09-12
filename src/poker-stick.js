import * as THREE from 'three';
import { random } from './textures.js';
import { smoothNoise } from './weather.js';

// The poking stick's natural length. The geometry runs along +y from the hand
// at -STICK_LENGTH / 2 to the tip at +STICK_LENGTH / 2; the poker scales it in
// y to reach whatever it is aimed at, so at a typical reach it is undistorted.
export const STICK_LENGTH = 3;

const BARK = new THREE.Color('#7a6242'), WORN = new THREE.Color('#ab9068'), KNOT = new THREE.Color('#5a4230');
const CHAR = new THREE.Color('#17130f'), RIDGE_LIGHT = new THREE.Color('#9a8460'), RIDGE_DARK = new THREE.Color('#4b3b28');
const smoothstep = (edge0, edge1, x) => { const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };

// Sweeps a closed ring of `radial` vertices along `spine(t)` for t in 0..1,
// with `radius(t, angle)` and `colour(t, angle, ridge)`, capped at both ends.
// Rings share their seam vertex so the computed normals wrap without a crease.
function sweep(out, { rings, radial, spine, radius, colour, ridge = () => 0 }) {
  const base = out.positions.length / 3;
  const centre = new THREE.Vector3(), ahead = new THREE.Vector3(), tangent = new THREE.Vector3();
  const normal = new THREE.Vector3(1, 0, 0), binormal = new THREE.Vector3(), point = new THREE.Vector3(), tint = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    spine(t, centre); spine(Math.min(1, t + 1e-3), ahead);
    tangent.subVectors(ahead, centre);
    if (tangent.lengthSq() < 1e-12) spine(Math.max(0, t - 1e-3), ahead), tangent.subVectors(centre, ahead);
    tangent.normalize();
    // Parallel transport keeps the ring frame from twisting between rings.
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
    normal.normalize(); binormal.crossVectors(tangent, normal);
    for (let j = 0; j < radial; j++) {
      const angle = j / radial * Math.PI * 2, r = ridge(t, angle);
      point.copy(centre).addScaledVector(normal, Math.cos(angle) * radius(t, angle, r)).addScaledVector(binormal, Math.sin(angle) * radius(t, angle, r));
      out.positions.push(point.x, point.y, point.z);
      colour(t, angle, r, tint); out.colours.push(tint.r, tint.g, tint.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * radial + j, b = base + i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
    out.indices.push(a, c, b, b, c, d);
  }
  for (const [ring, flip] of [[0, false], [rings, true]]) {
    spine(ring / rings, centre);
    const centreIndex = out.positions.length / 3;
    out.positions.push(centre.x, centre.y, centre.z);
    colour(ring / rings, 0, 0, tint); out.colours.push(tint.r, tint.g, tint.b);
    for (let j = 0; j < radial; j++) {
      const a = base + ring * radial + j, b = base + ring * radial + (j + 1) % radial;
      if (flip) out.indices.push(centreIndex, a, b); else out.indices.push(centreIndex, b, a);
    }
  }
}

// A found branch rather than a lathe-turned dowel: bent along a wandering
// spine, thick at the hand and tapering to a charred point, with knots, two
// snapped-off side stubs and ridged bark, all as vertex colours so it needs no
// texture. The bend is zero at the tip so the point still lands where the
// poker aims. The glowing tip is a separate mesh in the poker.
export function createStickGeometry({ seed = 7, radial = 10, rings = 64, length = STICK_LENGTH } = {}) {
  const rand = random(seed * 7919 + 3);
  const phase = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const bendX = .035 + rand() * .025, bendZ = .025 + rand() * .025;
  const knots = [.3 + rand() * .08, .58 + rand() * .08];
  const out = { positions: [], colours: [], indices: [] };
  const spine = (t, target) => {
    // Crooked through the middle, straight at the point.
    const fade = (1 - t) * (.35 + .65 * Math.sin(Math.PI * t));
    return target.set((Math.sin(t * Math.PI + phase[0]) * .6 + Math.sin(t * 6.1 + phase[1]) * .35) * bendX * length * fade,
      (t - .5) * length,
      (Math.sin(t * Math.PI * 1.3 + phase[2]) * .6 + Math.sin(t * 5.3 + phase[3]) * .35) * bendZ * length * fade);
  };
  const ridge = (t, angle) => Math.cos(angle * 6 + Math.sin(t * 13 + phase[0]) * 2) * .5 + Math.cos(angle * 11 + t * 25 + phase[1]) * .3;
  const knotBump = t => knots.reduce((sum, knot) => sum + Math.exp(-(((t - knot) / .03) ** 2)), 0);
  const char = t => smoothstep(.8, .94, t);
  const radius = (t, angle, r) => {
    let value = THREE.MathUtils.lerp(.03, .0115, Math.pow(t, .85));
    value *= 1 + .08 * Math.cos(2 * angle + t * 3 + phase[2]) + .045 * r + .3 * knotBump(t);
    value *= 1 + .06 * (smoothNoise(t * 11 + seed, 3) - .5);
    return value * (1 - .25 * char(t));
  };
  const colour = (t, angle, r, target) => {
    target.copy(BARK).multiplyScalar(.78 + .22 * smoothNoise(t * 9 + seed, 5));
    target.lerp(r > 0 ? RIDGE_LIGHT : RIDGE_DARK, Math.abs(r) * .35);
    target.lerp(WORN, smoothstep(.22, 0, t) * .8);
    target.lerp(KNOT, Math.min(1, knotBump(t) * .9));
    target.lerp(CHAR, char(t));
  };
  sweep(out, { rings, radial, spine, radius, colour, ridge });
  // Side stubs at the knots, angled toward the tip like the branches they were.
  const spinePoint = new THREE.Vector3(), stubEnd = new THREE.Vector3();
  knots.forEach((knot, index) => {
    const stubLength = (.06 + rand() * .05) * length / STICK_LENGTH, tilt = 1.1 + rand() * .3, around = rand() * Math.PI * 2;
    spine(knot, spinePoint);
    const direction = new THREE.Vector3(Math.cos(around) * Math.sin(tilt), Math.cos(tilt), Math.sin(around) * Math.sin(tilt)).normalize();
    stubEnd.copy(spinePoint).addScaledVector(direction, stubLength);
    const stubRadius = radius(knot, around, 0) * .5;
    sweep(out, { rings: 3, radial: 6,
      spine: (t, target) => target.copy(spinePoint).lerp(stubEnd, t),
      radius: t => stubRadius * (1 - .55 * t),
      colour: (t, angle, r, target) => target.copy(KNOT).lerp(BARK, .4).multiplyScalar(.9 + index * .1).lerp(CHAR, t * .35) });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(out.colours, 3));
  geometry.setIndex(out.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
