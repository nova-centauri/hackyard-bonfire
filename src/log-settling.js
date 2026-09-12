import * as THREE from 'three';
import { getFuelType } from './fuel-types.js';
import { PLANK_ASPECT_RATIO, sampleFuelSurface } from './fuel-geometry.js';
import { removeCharFromSurface } from './log-combustion.js';

const clamp = THREE.MathUtils.clamp;
const massOf = log => Math.max(0, log.wood + log.char * 1.4);
const active = log => log.phase !== 'queued' && log.phase !== 'ash';
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 5.8, STEP = 1 / 120, SKIN = .012, CONTACT_SLOP = .001;
const MAX_FRAGMENTS = 12;
// Burning wood shrinks continuously. Waking on every micron kept the whole pile
// solving forever; a sleeping piece now floats at most this far above its
// support before gravity is allowed to close the gap.
const SHRINK_WAKE = .0025, LENGTH_SHRINK_WEIGHT = .15, SHRINK_RESETTLE = .2;
// Any terrain callback is assumed to rise no faster than this per metre, so a
// point well above the height sampled at the body centre cannot touch soil.
const GROUND_SLOPE_BOUND = .4;
// A sleeping body only wakes when a touching body is really moving or really
// penetrating it; a still neighbour that merely rests against it is harmless.
const WAKE_SPEED_SQ = .03 * .03, WAKE_SPIN_SQ = .08 * .08, WAKE_DEPTH = CONTACT_SLOP + .003;
// A visitor arriving faster than a shrink-settle free fall wakes the sleeper
// before the solve, so a real collision exchanges its full momentum.
const WAKE_APPROACH = .25;
// Rough bark on soft soil resists rolling with a torque of up to the contact
// force times this lever (metres), solved alongside friction as a bounded
// angular impulse. Rolling without slipping sees no sliding friction, so
// without it a round log swings in the bowl like a pendulum for minutes. A big
// log still rolls downhill because its gravity torque dwarfs the lever; a
// char crumb a few centimetres across sits in the ash where it lands.
const ROLLING_RESISTANCE_LENGTH = .006;
const randomFor = seed => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

export function createLogSettling(definitions, seed = 1, profiles = [], rockColliders = []) {
  return { definitions, profiles, rockColliders, random: randomFor(seed), logs: [], fragments: [], nextFragment: 0,
    lastTime: null, lastBurnTime: null, fragmentAsh: 0, fragmentCoal: 0, accumulator: 0, physicsTime: 0,
    nextCollapse: 8 + (seed % 7), impacts: [] };
}

// The render mesh and contacts share a local +Y axis and the complete quaternion.
// Unlike a yaw/pitch reconstruction this preserves a plank's wide face as it rolls.
function syncPose(pose) {
  pose.position.set(pose.x, pose.y, pose.z);
  pose.axis.set(0, 1, 0).applyQuaternion(pose.quaternion);
  pose.sectionX.set(1, 0, 0).applyQuaternion(pose.quaternion);
  pose.sectionZ.set(0, 0, 1).applyQuaternion(pose.quaternion);
  pose.a.copy(pose.axis).multiplyScalar(-pose.length * .5).add(pose.position);
  pose.b.copy(pose.axis).multiplyScalar(pose.length * .5).add(pose.position);
  pose.yaw = Math.atan2(pose.axis.z, pose.axis.x);
  pose.pitch = Math.asin(clamp(pose.axis.y, -1, 1));
  pose.velocity = pose.linearVelocity.y;
  pose.pitchVelocity = pose.angularVelocity.dot(new THREE.Vector3(-Math.sin(pose.yaw), 0, Math.cos(pose.yaw)));
  pose.boundRadius = Math.hypot(pose.length * .55, pose.radius * pose.collisionScale);
  pose.collisionRadius = pose.radius * pose.collisionScale;
  for (let i = 0; i < pose.localPoints.length; i++) {
    const p = pose.localPoints[i];
    const fracture = pose.fracture;
    const notch = fracture ? 1 - fracture.severity * Math.exp(-(((p.y + .5 - fracture.t) / .12) ** 2))
      * Math.max(0, Math.cos(Math.atan2(p.z, p.x) - fracture.angle)) ** 4 : 1;
    pose.worldPoints[i].set(p.x * pose.radius * notch, p.y * pose.length, p.z * pose.radius * notch)
      .applyQuaternion(pose.quaternion).add(pose.position);
  }
}

function makeShape(pose, profile) {
  pose.localPoints = []; pose.profile = profile;
  const rows = pose.fuelType === 'stump' ? 10 : profile ? 8 : 4;
  const sides = pose.fuelType === 'plank' ? 4 : pose.fuelType === 'stump' ? 36 : 16;
  pose.shapeRows = rows; pose.shapeSides = sides;
  pose.collisionScale = 1;
  for (let row = 0; row <= rows; row++) for (let side = 0; side < sides; side++) {
    let p;
    if (pose.fuelType === 'plank') {
      const depth = 1 / Math.hypot(PLANK_ASPECT_RATIO, 1);
      p = new THREE.Vector3((side < 2 ? -1 : 1) * depth * PLANK_ASPECT_RATIO,
        row / rows - .5, (side % 2 ? -1 : 1) * depth);
    } else if (profile) {
      p = sampleFuelSurface(profile, side / sides * Math.PI * 2, row / rows);
      p.x /= profile.radius; p.y /= profile.length; p.z /= profile.radius;
    } else p = new THREE.Vector3(Math.cos(side / sides * Math.PI * 2), row / rows - .5, Math.sin(side / sides * Math.PI * 2));
    pose.collisionScale = Math.max(pose.collisionScale, Math.hypot(p.x, p.z));
    pose.localPoints.push(p);
  }
  pose.worldPoints = pose.localPoints.map(() => new THREE.Vector3());
}

function makePose(definition, log, time, groundHeight, profile) {
  const type = getFuelType(log.fuelType);
  const a = new THREE.Vector3(...definition[0]).applyAxisAngle(UP, log.angle || 0);
  const b = new THREE.Vector3(...definition[1]).applyAxisAngle(UP, log.angle || 0);
  const delta = b.clone().sub(a), center = a.clone().lerp(b, .5);
  const pose = { id: log.id, fuelType: log.fuelType || 'log', slot: log.slot,
    x: center.x + (log.offset || 0), y: center.y + groundHeight(center.x, center.z), z: center.z,
    baseX: center.x + (log.offset || 0), baseZ: center.z,
    baseLength: delta.length() * type.lengthScale, baseRadius: definition[2] * type.radiusScale,
    length: delta.length() * type.lengthScale, radius: definition[2] * type.radiusScale,
    quaternion: new THREE.Quaternion().setFromUnitVectors(UP, delta.normalize()),
    position: center, axis: new THREE.Vector3(), sectionX: new THREE.Vector3(), sectionZ: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(), inverseInertia: new THREE.Vector3(),
    a, b, live: active(log), born: time, initial: log.addedAt === null || log.addedAt < 0, initialized: false,
    mass: 1, inverseMass: 1, compression: 1, sleeping: false, quietTime: 0,
    maxFall: 0, fallFrom: 0, inFlight: false, supports: [], supportIds: [], lastImpact: -10, releases: 0,
    damage: 0, fracture: null, velocity: 0, pitchVelocity: 0 };
  makeShape(pose, profile); syncPose(pose); return pose;
}

function updateMass(pose, mass) {
  pose.mass = Math.max(.008, mass); pose.inverseMass = 1 / pose.mass;
  const side = pose.mass * (3 * pose.radius ** 2 + pose.length ** 2) / 12;
  pose.inverseInertia.set(1 / Math.max(.00003, side),
    1 / Math.max(.00003, pose.mass * pose.radius ** 2 * .5), 1 / Math.max(.00003, side));
  // Angular response is bounded for ash-size particles, without making intact
  // light kindling artificially as massive as a trunk.
  pose.inverseInertia.clampScalar(0, 3500);
}

function inverseInertia(pose, vector) {
  return vector.clone().applyQuaternion(pose.quaternion.clone().invert()).multiply(pose.inverseInertia).applyQuaternion(pose.quaternion);
}

function wake(pose) { pose.sleeping = false; pose.quietTime = 0; pose.shrinkSinceWake = 0; pose.shrinkWake = false; }

// Accumulate size changes while asleep and wake only once they add up to a
// visible gap. A thinner log floats above its support; a shorter one merely
// pulls its ends in, so length counts for little. A body woken this way only
// needs to sink that gap, so it may return to sleep quickly.
function resize(pose, radius, length) {
  const change = Math.abs(radius - pose.radius) + Math.abs(length - pose.length) * LENGTH_SHRINK_WEIGHT;
  if (pose.sleeping) {
    pose.shrinkSinceWake = (pose.shrinkSinceWake || 0) + change;
    if (pose.shrinkSinceWake > SHRINK_WAKE) { wake(pose); pose.shrinkWake = true; }
  }
  pose.length = length; pose.radius = radius;
}

const moving = pose => pose.linearVelocity.lengthSq() > WAKE_SPEED_SQ || pose.angularVelocity.lengthSq() > WAKE_SPIN_SQ;

// A support that starts moving must take its sleeping load with it, even when
// it moves away too gently for a contact impulse to register.
function wakeLoads(bodies) {
  for (const pose of bodies) if (!pose.sleeping && moving(pose))
    for (const other of bodies) if (other.sleeping && other.supportIds.includes(pose.id)) wake(other);
}

// A mouse poke applies a finite impulse at the hit point. Using the lever arm
// makes an end poke tip/roll the wood, while a center poke mostly translates it.
export function applyLogPoke(state, slotOrPose, worldPoint, worldDirection, strength = 1) {
  const pose = typeof slotOrPose === 'number' ? state.logs[slotOrPose] : slotOrPose;
  if (!pose?.live || ![...state.logs, ...state.fragments].includes(pose)
    || !Number.isFinite(strength) || strength <= 0
    || !worldPoint?.toArray().every(Number.isFinite) || !worldDirection?.toArray().every(Number.isFinite)
    || worldDirection.lengthSq() < 1e-10) return false;
  strength = clamp(strength, 0, 1);
  const arm = worldPoint.clone().sub(pose.position).clampLength(0, pose.boundRadius);
  const magnitude = Math.min(.7 * strength * Math.sqrt(pose.mass), 1.25 * pose.mass);
  const beforeAngular = pose.angularVelocity.clone();
  // Sleeping bodies ignore impulses, so wake the poked piece before pushing it.
  wake(pose);
  impulse(pose, arm, worldDirection.clone().normalize().multiplyScalar(magnitude));
  const angularChange = pose.angularVelocity.clone().sub(beforeAngular).clampLength(0, 3.2 * strength);
  pose.angularVelocity.copy(beforeAngular).add(angularChange).clampLength(0, 8);
  pose.linearVelocity.clampLength(0, 3);
  wake(pose);
  // Sleeping logs resting on this piece must participate in the same contact
  // solve when their support is pushed away, including higher stacked pieces.
  const moving = new Set([pose.id]);
  for (let pass = 0; pass < state.logs.length; pass++) for (const other of state.logs) {
    if (other.live && other.supportIds.some(id => moving.has(id))) { wake(other); moving.add(other.id); }
  }
  return true;
}

function closestSegments(a, b, c, d) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  const denominator = aa * cc - bb * bb;
  let t = denominator > 1e-10 ? clamp((bb * ee - cc * dd) / denominator, 0, 1) : .5;
  let s = cc > 1e-10 ? clamp((bb * t + ee) / cc, 0, 1) : 0;
  t = aa > 1e-10 ? clamp((bb * s - dd) / aa, 0, 1) : 0;
  s = cc > 1e-10 ? clamp((bb * t + ee) / cc, 0, 1) : 0;
  return { t, s, a: a.clone().addScaledVector(u, t), b: c.clone().addScaledVector(v, s) };
}

function interval(pose, axis) {
  let min = Infinity, max = -Infinity;
  for (const point of pose.worldPoints) { const d = point.dot(axis); min = Math.min(min, d); max = Math.max(max, d); }
  return { min, max };
}

// Finite convex cross sections: caps and side faces are tested separately, so
// short stumps/planks do not acquire invisible capsule ends. Axes include the
// closest rod separation, both end normals and oriented box edge cross products.
function bodyContact(a, b) {
  if (a.position.distanceToSquared(b.position) > (a.boundRadius + b.boundRadius + SKIN) ** 2) return null;
  const closest = closestSegments(a.a, a.b, b.a, b.b), delta = a.position.clone().sub(b.position);
  const axes = [closest.a.clone().sub(closest.b), a.axis, b.axis, a.axis.clone().cross(b.axis),
    a.sectionX, a.sectionZ, b.sectionX, b.sectionZ];
  const basisA = [a.axis, a.sectionX, a.sectionZ], basisB = [b.axis, b.sectionX, b.sectionZ];
  if (a.fuelType === 'plank' || b.fuelType === 'plank') {
    for (const x of basisA) for (const y of basisB) axes.push(x.clone().cross(y));
  }
  let depth = Infinity, normal = null;
  for (const candidate of axes) {
    if (candidate.lengthSq() < 1e-10) continue;
    const n = candidate.clone().normalize();
    if (delta.dot(n) < 0) n.negate();
    const ia = interval(a, n), ib = interval(b, n), overlap = ib.max - ia.min;
    if (overlap < -SKIN - 1e-8 || ia.max - ib.min < -SKIN - 1e-8) return null;
    if (overlap < depth) { depth = overlap; normal = n; }
  }
  if (!normal) return null;
  // Project the axis closest point onto the actual contacting support planes.
  // This keeps the lever arm at the crossing, not at an arbitrary cap vertex.
  const ia = interval(a, normal), ib = interval(b, normal);
  const point = closest.a.clone().lerp(closest.b, .5);
  point.addScaledVector(normal, (ia.min + ib.max) * .5 - point.dot(normal));
  const points = [point];
  // Parallel pieces have a contact line, not a balancing point at one end.
  if (Math.abs(a.axis.dot(b.axis)) > .96 && Math.abs(normal.dot(a.axis)) < .15) {
    const along = a.axis, axisA = interval(a, along), axisB = interval(b, along);
    const lo = Math.max(axisA.min, axisB.min), hi = Math.min(axisA.max, axisB.max);
    if (hi - lo > Math.min(a.radius, b.radius) * 1.4) {
      points[0] = point.clone().addScaledVector(along, lo + (hi - lo) * .15 - point.dot(along));
      points.push(point.clone().addScaledVector(along, hi - (hi - lo) * .15 - point.dot(along)));
    }
  }
  return { a, b, normal, depth, points };
}

// Sampled points at the top of the body cannot touch soil; one height sample
// at the centre plus a slope bound rejects them before any evaluation.
function aboveGround(pose, point, centreHeight) {
  return point.y > centreHeight + GROUND_SLOPE_BOUND * Math.hypot(point.x - pose.x, point.z - pose.z) + SKIN;
}

const ringCentre = new THREE.Vector3(), ringNormal = new THREE.Vector3(), ringDown = new THREE.Vector3(), ringPoint = new THREE.Vector3(), ringSample = new THREE.Vector3();
// Knots, ovals and stump root lobes can hang lower than the point straight
// beneath the axis, so each ring scans a fan of angles around it (6° steps
// over ±48°), ranks them against a planar estimate of the local ground, then
// refines the best angle parabolically so the contact glides continuously as
// lumpy wood rolls instead of jumping between discrete samples.
const RING_FAN_STEP = Math.PI / 30, RING_FAN_HALF = 8;

// Round wood touches the ground along the true lowest line of its cross
// sections, not at the nearest of sixteen sampled facets. A faceted prism is
// stable on shallow slopes and its contact arm points straight down, so the
// support impulse cancelled the friction torque and nothing ever rolled. One
// exact point per ring from the actual profile keeps stumps, notches and
// slopes honest and evaluates far fewer terrain samples.
function ringSurfacePoint(pose, t, angle, target) {
  const profile = pose.profile, fracture = pose.fracture;
  let px, py, pz;
  if (profile) {
    sampleFuelSurface(profile, angle, t, 0, ringSample);
    px = ringSample.x / profile.radius; py = ringSample.y / profile.length; pz = ringSample.z / profile.radius;
  } else { px = Math.cos(angle); py = t - .5; pz = Math.sin(angle); }
  const notch = fracture ? 1 - fracture.severity * Math.exp(-(((t - fracture.t) / .12) ** 2)) * Math.max(0, Math.cos(angle - fracture.angle)) ** 4 : 1;
  return target.copy(pose.position).addScaledVector(pose.sectionX, px * pose.radius * notch)
    .addScaledVector(pose.axis, py * pose.length).addScaledVector(pose.sectionZ, pz * pose.radius * notch);
}

function roundGroundCandidates(pose, height, centreHeight, candidates) {
  const e = .01, rows = pose.shapeRows;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    ringCentre.copy(pose.a).addScaledVector(pose.axis, t * pose.length);
    if (ringCentre.y - pose.collisionRadius > centreHeight + GROUND_SLOPE_BOUND * Math.hypot(ringCentre.x - pose.x, ringCentre.z - pose.z) + SKIN) continue;
    const h0 = height(ringCentre.x, ringCentre.z);
    const dx = (height(ringCentre.x + e, ringCentre.z) - height(ringCentre.x - e, ringCentre.z)) / (2 * e);
    const dz = (height(ringCentre.x, ringCentre.z + e) - height(ringCentre.x, ringCentre.z - e)) / (2 * e);
    ringNormal.set(-dx, 1, -dz).normalize();
    // The in-plane direction toward the soil is the ground normal with its
    // axial component removed and reversed.
    ringDown.copy(ringNormal).addScaledVector(pose.axis, -ringNormal.dot(pose.axis)).negate();
    if (ringDown.lengthSq() < 1e-8) continue;
    ringDown.normalize();
    const downAngle = Math.atan2(ringDown.dot(pose.sectionZ), ringDown.dot(pose.sectionX));
    // Planar estimate of how far below the local soil plane a surface point lies.
    const estimate = angle => { ringSurfacePoint(pose, t, angle, ringPoint); return h0 + dx * (ringPoint.x - ringCentre.x) + dz * (ringPoint.z - ringCentre.z) - ringPoint.y; };
    let bestAngle = downAngle, bestScore = -Infinity, previous = -Infinity, current = estimate(downAngle);
    const scores = pose.profile ? [] : null;
    if (scores) {
      for (let k = -RING_FAN_HALF; k <= RING_FAN_HALF; k++) {
        const score = k === 0 ? current : estimate(downAngle + k * RING_FAN_STEP);
        scores.push(score);
        if (score > bestScore) { bestScore = score; bestAngle = downAngle + k * RING_FAN_STEP; }
      }
      const index = Math.round((bestAngle - downAngle) / RING_FAN_STEP) + RING_FAN_HALF;
      if (index > 0 && index < scores.length - 1) {
        previous = scores[index - 1]; const next = scores[index + 1];
        const denominator = previous - 2 * bestScore + next;
        if (denominator < -1e-12) bestAngle += .5 * (previous - next) / denominator * RING_FAN_STEP;
      }
    }
    ringSurfacePoint(pose, t, bestAngle, ringPoint);
    if (aboveGround(pose, ringPoint, centreHeight)) continue;
    const penetration = height(ringPoint.x, ringPoint.z) + SKIN - ringPoint.y;
    if (penetration >= -SKIN) candidates.push({ point: ringPoint.clone(), depth: penetration });
  }
}

function groundContacts(pose, height) {
  const candidates = [];
  const centreHeight = height(pose.x, pose.z);
  if (pose.y - pose.boundRadius > centreHeight + GROUND_SLOPE_BOUND * pose.boundRadius + SKIN) return candidates;
  // Lumber rests on its edges and corners; an upended piece stands on its cap.
  if (pose.fuelType === 'plank' || Math.abs(pose.axis.y) > .9) {
    for (const point of pose.worldPoints) {
      if (aboveGround(pose, point, centreHeight)) continue;
      const penetration = height(point.x, point.z) + SKIN - point.y;
      if (penetration >= -SKIN) candidates.push({ point, depth: penetration });
    }
  } else roundGroundCandidates(pose, height, centreHeight, candidates);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.depth - a.depth);
  const chosen = [candidates[0]];
  // A small persistent manifold supports an entire face, while a true endpoint
  // contact remains off-center and therefore creates a gravitational torque.
  for (let i = 1; i < 4; i++) {
    let best = null, distance = .0004;
    for (const candidate of candidates) {
      if (candidate.depth < candidates[0].depth - .008) continue;
      const separation = Math.min(...chosen.map(c => c.point.distanceToSquared(candidate.point)));
      if (separation > distance) { best = candidate; distance = separation; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map(({ point, depth }) => {
    const e = .01, dx = (height(point.x + e, point.z) - height(point.x - e, point.z)) / (2 * e);
    const dz = (height(point.x, point.z + e) - height(point.x, point.z - e)) / (2 * e);
    return { a: pose, b: null, normal: new THREE.Vector3(-dx, 1, -dz).normalize(), depth, points: [point.clone()] };
  });
}

function stoneContact(pose, stone) {
  if (pose.position.distanceToSquared(stone.position) > (pose.boundRadius + stone.boundRadius + SKIN) ** 2) return null;
  const along = clamp(stone.position.clone().sub(pose.a).dot(pose.axis), 0, pose.length);
  const closest = pose.a.clone().addScaledVector(pose.axis, along);
  const axes = [...stone.axes, pose.axis, pose.sectionX, pose.sectionZ, closest.clone().sub(stone.position)];
  // Face normals plus edge cross products catch finite log ends and the narrow
  // gaps between stones, rather than treating the ring as an invisible wall.
  for (const edge of stone.edges) {
    axes.push(pose.axis.clone().cross(edge));
    if (pose.fuelType === 'plank') axes.push(pose.sectionX.clone().cross(edge), pose.sectionZ.clone().cross(edge));
  }
  const delta = pose.position.clone().sub(stone.position);
  let depth = Infinity, normal = null;
  for (const candidate of axes) {
    if (candidate.lengthSq() < 1e-10) continue;
    const n = candidate.clone().normalize();
    if (delta.dot(n) < 0) n.negate();
    const a = interval(pose, n), b = interval(stone, n), overlap = b.max - a.min;
    if (overlap < -SKIN || a.max - b.min < -SKIN) return null;
    if (overlap < depth) { depth = overlap; normal = n; }
  }
  if (!normal) return null;
  const a = interval(pose, normal), b = interval(stone, normal);
  const point = closest.addScaledVector(normal, (a.min + b.max) * .5 - closest.dot(normal));
  return { a: pose, b: null, stone, normal, depth, points: [point] };
}

// Sleeping bodies keep the supports they fell asleep with; only awake bodies,
// and pairs with at least one awake body, are tested. A settled pile costs
// nothing here until something wakes it.
function allContacts(bodies, height, stones = []) {
  const contacts = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body.sleeping) {
      contacts.push(...groundContacts(body, height));
      for (const stone of stones) {
        const contact = stoneContact(body, stone);
        if (contact) contacts.push(contact);
      }
    }
    for (let j = 0; j < i; j++) {
      const other = bodies[j];
      if (body.fragment && other.fragment) continue;
      if (body.sleeping && other.sleeping) continue;
      const contact = bodyContact(body, other);
      if (contact) contacts.push(contact);
    }
  }
  return contacts;
}

function pointVelocity(pose, arm) { return pose ? pose.angularVelocity.clone().cross(arm).add(pose.linearVelocity) : new THREE.Vector3(); }
// A sleeping body is static for the solver. Whether a touch is strong enough to
// wake it is decided after the solve, from the visitor's remaining motion.
function effectiveMass(pose, arm, n) {
  if (!pose || pose.sleeping) return 0;
  return pose.inverseMass + inverseInertia(pose, arm.clone().cross(n)).cross(arm).dot(n);
}
function impulse(pose, arm, impulseVector) {
  if (!pose || pose.sleeping) return;
  pose.linearVelocity.addScaledVector(impulseVector, pose.inverseMass);
  pose.angularVelocity.add(inverseInertia(pose, arm.clone().cross(impulseVector)));
}
function angularMass(pose, axis) { return !pose || pose.sleeping ? 0 : inverseInertia(pose, axis).dot(axis); }
function angularImpulse(pose, vector) { if (pose && !pose.sleeping) pose.angularVelocity.add(inverseInertia(pose, vector)); }

function prepareContacts(contacts, time, state, dt) {
  for (const contact of contacts) {
    const { a, b, normal, depth } = contact;
    if (a.sleeping && (!b || b.sleeping)) { contact.constraints = []; continue; }
    // Speculative contact: inside the detection skin a body may still approach
    // exactly fast enough to reach the surface this substep, so burning wood
    // sinks continuously as it thins instead of hovering and dropping in hops.
    const approach = depth < 0 ? depth / dt : 0;
    const sleeper = a.sleeping ? a : b?.sleeping ? b : null;
    contact.constraints = contact.points.map(point => {
      const ra = point.clone().sub(a.position), rb = b ? point.clone().sub(b.position) : new THREE.Vector3();
      const speed = pointVelocity(a, ra).sub(pointVelocity(b, rb)).dot(normal);
      if (sleeper && (speed < -WAKE_APPROACH || depth > WAKE_DEPTH)) wake(sleeper);
      // An impact belongs to the arriving/moving body; opposite support impulses
      // should not create duplicate spark/audio events on a quiet bottom log.
      const owner = b && b.inFlight && !a.inFlight ? b : a;
      if (speed < -.5 && owner.inFlight && time - owner.lastImpact > .45 && owner.maxFall > .012) {
        state.impacts.push({ slot: owner.slot, time, strength: clamp((-speed * .2 + owner.maxFall * .65) * Math.sqrt(owner.mass), .08, 1),
          position: point.clone(), heat: owner.heat, kind: 'impact' });
        owner.lastImpact = time;
      }
      return { point, ra, rb, normalImpulse: 0, tangentImpulse: new THREE.Vector3(), rollImpulse: new THREE.Vector3(), bounce: approach < 0 ? approach : speed < -1 ? -.025 * speed : 0 };
    });
  }
}

function solveVelocity(contacts) {
  for (let pass = 0; pass < 12; pass++) for (const contact of contacts) {
    const { a, b, normal } = contact;
    if (a.sleeping && (!b || b.sleeping)) continue;
    for (const c of contact.constraints) {
      let relative = pointVelocity(a, c.ra).sub(pointVelocity(b, c.rb));
      const mass = effectiveMass(a, c.ra, normal) + effectiveMass(b, c.rb, normal);
      const before = c.normalImpulse;
      c.normalImpulse = Math.max(0, before + (c.bounce - relative.dot(normal)) / mass);
      const normalDelta = c.normalImpulse - before;
      const force = normal.clone().multiplyScalar(normalDelta);
      impulse(a, c.ra, force); if (b) impulse(b, c.rb, force.negate());
      relative = pointVelocity(a, c.ra).sub(pointVelocity(b, c.rb));
      const tangent = relative.addScaledVector(normal, -relative.dot(normal));
      const speed = tangent.length();
      if (speed < 1e-8) continue;
      tangent.divideScalar(speed);
      const frictionMass = effectiveMass(a, c.ra, tangent) + effectiveMass(b, c.rb, tangent);
      const old = c.tangentImpulse.clone();
      c.tangentImpulse.addScaledVector(tangent, -speed / frictionMass);
      const friction = b ? .58 : .72, limit = friction * c.normalImpulse;
      if (c.tangentImpulse.length() > limit) c.tangentImpulse.setLength(limit);
      const frictionDelta = c.tangentImpulse.clone().sub(old);
      impulse(a, c.ra, frictionDelta); if (b) impulse(b, c.rb, frictionDelta.negate());
      // Rolling resistance: oppose the relative spin about the contact plane
      // with an angular impulse no larger than the normal impulse times the
      // resistance lever, accumulated and clamped exactly like friction.
      const spin = a.angularVelocity.clone(); if (b) spin.sub(b.angularVelocity);
      spin.addScaledVector(normal, -spin.dot(normal));
      const spinSpeed = spin.length();
      if (spinSpeed < 1e-9) continue;
      const axis = spin.divideScalar(spinSpeed), rollMass = angularMass(a, axis) + angularMass(b, axis);
      if (rollMass <= 0) continue;
      const previousRoll = c.rollImpulse.clone();
      c.rollImpulse.addScaledVector(axis, -spinSpeed / rollMass);
      const rollLimit = ROLLING_RESISTANCE_LENGTH * c.normalImpulse;
      if (c.rollImpulse.length() > rollLimit) c.rollImpulse.setLength(rollLimit);
      const rollDelta = c.rollImpulse.clone().sub(previousRoll);
      angularImpulse(a, rollDelta); if (b) angularImpulse(b, rollDelta.negate());
    }
  }
}

function correctPositions(bodies, groundHeight, stones) {
  // Split positional correction changes neither linear nor angular velocity.
  // Removing overlap therefore cannot kick energy into a resting stack.
  const touched = new Set();
  for (let pass = 0; pass < 6; pass++) {
    const contacts = allContacts(bodies, groundHeight, stones);
    touched.clear();
    for (const { a, b, normal, depth } of contacts) {
      if (depth <= CONTACT_SLOP) continue;
      if (a.sleeping && (!b || b.sleeping)) continue;
      const massA = a.sleeping ? 0 : a.inverseMass, massB = b && !b.sleeping ? b.inverseMass : 0;
      const total = massA + massB, correction = Math.min(.06, (depth - CONTACT_SLOP) * .8);
      if (total <= 0) continue;
      const scaleA = correction * massA / total;
      if (scaleA) { a.x += normal.x * scaleA; a.y += normal.y * scaleA; a.z += normal.z * scaleA; touched.add(a); }
      const scaleB = correction * massB / total;
      if (scaleB) { b.x -= normal.x * scaleB; b.y -= normal.y * scaleB; b.z -= normal.z * scaleB; touched.add(b); }
    }
    // Depths were sampled at the start of the pass, so one world-space sync per
    // moved body at the end of the pass gives identical results far cheaper.
    if (!touched.size) break;
    for (const body of touched) syncPose(body);
  }
}

function setSupports(bodies, contacts, dt) {
  // Wake a sleeper only when its visitor is still moving after the solve or is
  // really pressing into it; a piece that merely came to rest on it is inert.
  for (const { a, b, depth } of contacts) {
    const sleeper = a.sleeping && b && !b.sleeping ? a : b?.sleeping && !a.sleeping ? b : null;
    if (sleeper && (moving(sleeper === a ? b : a) || depth > WAKE_DEPTH)) wake(sleeper);
  }
  for (const pose of bodies) if (!pose.sleeping) { pose.supports = []; pose.supportIds = []; pose.contactCount = 0; }
  for (const { a, b, normal } of contacts) {
    if (normal.y > .25 && !a.sleeping) { a.contactCount++; if (b && !b.fragment) { a.supports.push(b.slot); a.supportIds.push(b.id); } }
    if (b && normal.y < -.25 && !b.sleeping) { b.contactCount++; if (!a.fragment) { b.supports.push(a.slot); b.supportIds.push(a.id); } }
  }
  for (const pose of bodies) {
    if (pose.sleeping) continue;
    pose.supports = [...new Set(pose.supports)];
    if (pose.contactCount) {
      pose.inFlight = false; pose.maxFall = 0;
      if (pose.linearVelocity.lengthSq() < .0004 && pose.angularVelocity.lengthSq() < .0025) pose.quietTime += dt;
      else pose.quietTime = 0;
      if (pose.quietTime > (pose.shrinkWake ? SHRINK_RESETTLE : .55)) { pose.sleeping = true; pose.shrinkWake = false; pose.linearVelocity.set(0, 0, 0); pose.angularVelocity.set(0, 0, 0); }
    } else { if (!pose.inFlight) pose.fallFrom = pose.y; pose.inFlight = true; pose.quietTime = 0; wake(pose); }
    syncPose(pose);
  }
}

function balancedAtRest(pose, contacts) {
  const points = [];
  for (const contact of contacts) {
    const normalY = contact.a === pose ? contact.normal.y : contact.b === pose ? -contact.normal.y : 0;
    if (normalY > .99995) points.push(...contact.points);
  }
  const center = new THREE.Vector3(pose.x, 0, pose.z);
  const flat = points.map(p => new THREE.Vector3(p.x, 0, p.z));
  if (flat.some(p => p.distanceToSquared(center) < .0001)) return true;
  for (let i = 0; i < flat.length; i++) for (let j = 0; j < i; j++) {
    const edge = flat[i].clone().sub(flat[j]);
    const t = clamp(center.clone().sub(flat[j]).dot(edge) / Math.max(1e-10, edge.lengthSq()), 0, 1);
    if (flat[j].clone().addScaledVector(edge, t).distanceToSquared(center) < .0001) return true;
    for (let k = 0; k < j; k++) {
      const signs = [[flat[i], flat[j]], [flat[j], flat[k]], [flat[k], flat[i]]].map(([a, b]) =>
        (b.x - a.x) * (center.z - a.z) - (b.z - a.z) * (center.x - a.x));
      if (signs.every(s => s > 1e-6) || signs.every(s => s < -1e-6)) return true;
    }
  }
  return false;
}

function sectionHeight(pose, t, top) {
  const row = clamp(t, 0, 1) * pose.shapeRows, a = Math.floor(row), b = Math.min(pose.shapeRows, a + 1);
  const sample = row => {
    let value = -Infinity;
    const axisY = pose.y + (row / pose.shapeRows - .5) * pose.axis.y * pose.length;
    for (let i = 0; i < pose.shapeSides; i++) {
      const y = pose.worldPoints[row * pose.shapeSides + i].y;
      value = Math.max(value, top ? y - axisY : axisY - y);
    }
    return value;
  };
  return THREE.MathUtils.lerp(sample(a), sample(b), row - a);
}

function placementContacts(pose, existing, height) {
  const contacts = [];
  for (let row = 0; row <= pose.shapeRows; row++) {
    const t = row / pose.shapeRows, axisY = pose.y + (t - .5) * pose.axis.y * pose.length;
    let minimum = -Infinity;
    for (let i = 0; i < pose.shapeSides; i++) {
      const p = pose.worldPoints[row * pose.shapeSides + i];
      minimum = Math.max(minimum, height(p.x, p.z) + SKIN + axisY - p.y);
    }
    contacts.push({ t, height: minimum });
  }
  const pa = pose.a.clone(); pa.y = 0; const pb = pose.b.clone(); pb.y = 0;
  for (const other of existing) {
    const oa = other.a.clone(); oa.y = 0; const ob = other.b.clone(); ob.y = 0;
    const cross = closestSegments(pa, pb, oa, ob);
    const distance = cross.a.distanceTo(cross.b);
    const normal = distance > 1e-8 ? cross.a.clone().sub(cross.b).divideScalar(distance) : new THREE.Vector3(-Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
    const widthOf = body => body.fuelType === 'plank' ? body.radius / Math.hypot(PLANK_ASPECT_RATIO, 1)
      * (Math.abs(body.sectionX.dot(normal)) * PLANK_ASPECT_RATIO + Math.abs(body.sectionZ.dot(normal))) : body.radius * body.collisionScale;
    const width = widthOf(pose) + widthOf(other);
    if (distance >= width) continue;
    const vertical = sectionHeight(pose, cross.t, false) + sectionHeight(other, cross.s, true);
    contacts.push({ t: cross.t, height: THREE.MathUtils.lerp(other.a.y, other.b.y, cross.s)
      + vertical * Math.sqrt(1 - distance ** 2 / width ** 2) });
  }
  return contacts;
}

function lowestPlacement(pose, contacts) {
  let best = { y: Infinity, difference: 0 };
  const limit = pose.length * .72;
  const evaluate = difference => {
    if (Math.abs(difference) > limit) return;
    let y = -Infinity;
    for (const contact of contacts) y = Math.max(y, contact.height - (contact.t - .5) * difference);
    if (y + Math.abs(difference) * .001 < best.y + Math.abs(best.difference) * .001) best = { y, difference };
  };
  evaluate(0); evaluate(-limit); evaluate(limit);
  for (let i = 0; i < contacts.length; i++) for (let j = 0; j < i; j++) {
    const span = contacts[i].t - contacts[j].t;
    if (Math.abs(span) > .02) evaluate((contacts[i].height - contacts[j].height) / span);
  }
  return { y: best.y, pitch: Math.asin(clamp(best.difference / pose.length, -.72, .72)) };
}

// Arrival order is only a placement convention. Once released, every pair is
// solved symmetrically; an older log can fall onto and be caught by a newer one.
// The prepared pile uses local crossing heights, not each lower log's tallest
// endpoint, so an angled branch does not levitate the entire layer above it.
function initializePose(pose, existing, height) {
  const yaw = pose.yaw;
  for (let iteration = 0; iteration < 4; iteration++) {
    syncPose(pose);
    const rest = lowestPlacement(pose, placementContacts(pose, existing, height));
    pose.y = rest.y;
    const axis = new THREE.Vector3(Math.cos(yaw) * Math.cos(rest.pitch), Math.sin(rest.pitch), Math.sin(yaw) * Math.cos(rest.pitch));
    pose.quaternion.setFromUnitVectors(UP, axis);
  }
  if (!pose.initial) pose.y += .92;
  pose.initialized = true; pose.fallFrom = pose.y; pose.inFlight = !pose.initial;
  syncPose(pose);
}

function releaseWeakSupport(state, cycle, dt, time) {
  for (const pose of state.logs) {
    if (!pose.live || pose.fragment || pose.releases >= 3 || pose.inFlight) continue;
    const fuel = cycle.logs[pose.slot];
    if (fuel.temperature < .42 || fuel.wood > .74 || fuel.char < .018) continue;
    let weakest = 0, weakness = 0;
    const patches = fuel.surface?.patches;
    for (let row = 0; row < 5; row++) {
      const local = patches?.slice(row * 8, (row + 1) * 8);
      const wood = local?.length ? local.reduce((sum, p) => sum + p.wood, 0) / local.length : fuel.wood;
      const heat = local?.length ? local.reduce((sum, p) => sum + p.temperature, 0) / local.length : fuel.temperature;
      const damage = Math.max(0, .78 - wood) * heat;
      if (damage > weakness) { weakness = damage; weakest = row; }
    }
    const load = state.logs.filter(p => p.live && p.supports.includes(pose.slot)).reduce((sum, p) => sum + p.mass, 0);
    pose.damage += dt * weakness * (.055 + Math.min(2, load / pose.mass) * .06);
    if (pose.damage < .19 + pose.releases * .045 || time < state.nextCollapse || state.fragments.length >= MAX_FRAGMENTS) continue;
    const t = pose.fracture?.t ?? (patches ? (weakest + .5) / 5 : .35 + state.random() * .3);
    const removed = removeCharFromSurface(fuel, Math.min(.027, fuel.char * .13), t);
    if (!(removed > 0)) continue;
    pose.damage = 0; pose.releases++; pose.compression *= .91; wake(pose);
    const angle = pose.fracture?.angle ?? state.random() * Math.PI * 2;
    const severity = clamp(pose.fracture ? pose.fracture.severity + .12 : weakness * 1.2, .15, .6);
    pose.fracture = { t, angle, severity };
    state.nextCollapse = time + 2.2 + state.random() * 2;
    const position = pose.a.clone().lerp(pose.b, t).addScaledVector(pose.sectionX, Math.cos(angle) * pose.radius)
      .addScaledVector(pose.sectionZ, Math.sin(angle) * pose.radius);
    const chunkRadius = Math.max(.025, pose.radius * .34), chunkLength = Math.min(pose.length * .12, chunkRadius * 2.3);
    const fragment = makePose([[0, 0, 0], [0, chunkLength, 0], chunkRadius],
      { id: `char-${++state.nextFragment}`, slot: pose.slot, wood: 0, char: removed, angle: 0, scale: 1, addedAt: time, phase: 'coaling', fuelType: 'log' }, time, () => 0);
    Object.assign(fragment, { fragment: true, x: position.x, y: position.y, z: position.z, radius: chunkRadius,
      length: chunkLength, born: time, heat: fuel.temperature, initial: false, initialized: true, inFlight: true, sourceId: pose.id,
      initialChar: removed * getFuelType(fuel.fuelType).mass, remainingChar: removed * getFuelType(fuel.fuelType).mass,
      thermalAge: 0, fragmentRadius: chunkRadius, fragmentLength: chunkLength });
    fragment.quaternion.copy(pose.quaternion); fragment.linearVelocity.copy(pose.linearVelocity);
    // The fragment inherits point velocity. A tiny separating impulse represents
    // shell stress; gravity and contacts choose its eventual destination.
    fragment.linearVelocity.add(pose.angularVelocity.clone().cross(position.clone().sub(pose.position)))
      .addScaledVector(position.clone().sub(pose.position).normalize(), .05);
    updateMass(fragment, removed * getFuelType(fuel.fuelType).mass * 1.4); syncPose(fragment);
    state.fragments.push(fragment);
    state.impacts.push({ slot: pose.slot, time, strength: .16 + severity * .18, position, heat: fuel.temperature, kind: 'crumble' });
  }
}

function ageFragments(state, cycle, elapsed) {
  const burnTime = Number.isFinite(cycle.time) ? cycle.time : null;
  const dt = burnTime === null ? elapsed : state.lastBurnTime === null ? 0 : Math.max(0, burnTime - state.lastBurnTime);
  state.lastBurnTime = burnTime;
  const retained = [];
  const deposit = (amount, coal = false) => {
    if (!(amount > 0)) return;
    state[coal ? 'fragmentCoal' : 'fragmentAsh'] += amount;
    const key = coal ? 'coalMass' : 'ashMass';
    if (Number.isFinite(cycle[key])) cycle[key] += amount;
  };
  for (const fragment of state.fragments) {
    fragment.thermalAge += dt;
    // Char particles use simulation seconds for heat/fuel, while their falling
    // and collisions continue in real seconds even at 1200x playback.
    const coupling = Math.exp(-(fragment.x ** 2 + fragment.z ** 2) / 1.8) * Math.exp(-Math.max(0, fragment.y) * 1.3);
    const target = Number.isFinite(cycle.coalHeat) ? cycle.coalHeat * coupling * .72 : 0;
    const oldHeat = fragment.heat;
    fragment.heat += (target - fragment.heat) * (1 - Math.exp(-dt / 150));
    const heat = (oldHeat + fragment.heat) * .5;
    const burned = heat > .07 ? Math.min(fragment.remainingChar, dt * .00020 * heat
      * Math.max(.16, fragment.remainingChar / fragment.initialChar)) : 0;
    fragment.remainingChar -= burned; deposit(burned);
    if (fragment.remainingChar < fragment.initialChar * .02 || fragment.thermalAge > 1800) {
      deposit(fragment.remainingChar, fragment.heat < .07); fragment.remainingChar = 0; fragment.live = false; continue;
    }
    const scale = Math.cbrt(fragment.remainingChar / fragment.initialChar);
    resize(fragment, fragment.fragmentRadius * scale, fragment.fragmentLength * scale);
    updateMass(fragment, fragment.remainingChar * 1.4); syncPose(fragment); retained.push(fragment);
  }
  state.fragments = retained;
  cycle.fragmentChar = retained.reduce((sum, fragment) => sum + fragment.remainingChar, 0);
  cycle.fragmentHeat = cycle.fragmentChar > 0 ? retained.reduce((sum, fragment) => sum + fragment.heat * fragment.remainingChar, 0) / cycle.fragmentChar : 0;
}

export function updateLogSettling(state, cycle, time, groundHeight = () => 0) {
  state.impacts = [];
  const hadFragments = state.fragments.length > 0;
  const elapsed = state.lastTime === null ? 0 : clamp(time - state.lastTime, 0, .12);
  state.lastTime = time;
  const arrivals = [];
  for (let i = 0; i < cycle.logs.length; i++) {
    const log = cycle.logs[i];
    if (!state.logs[i] || state.logs[i].id !== log.id || state.logs[i].fuelType !== (log.fuelType || 'log'))
      state.logs[i] = makePose(state.definitions[i], log, time, groundHeight, state.profiles[i]);
    const pose = state.logs[i], wasLive = pose.live;
    if (!wasLive && active(log)) { pose.initialized = false; pose.initial = false; pose.born = time; }
    pose.live = active(log); pose.heat = log.temperature;
    const mass = massOf(log), length = pose.baseLength * log.scale * (.84 + .16 * Math.sqrt(Math.min(1, mass)));
    const radius = pose.baseRadius * Math.max(.035, Math.sqrt(mass)) * log.scale * pose.compression;
    resize(pose, radius, length);
    updateMass(pose, mass * getFuelType(log.fuelType).mass * log.scale ** 3); syncPose(pose);
    if (pose.live && !pose.initialized) arrivals.push(pose);
  }
  const existing = state.logs.filter(p => p.live && p.initialized);
  const arrivalTime = pose => cycle.logs[pose.slot].addedAt >= 0 ? cycle.logs[pose.slot].addedAt + 1 : 0;
  arrivals.sort((a, b) => arrivalTime(a) - arrivalTime(b) || a.slot - b.slot);
  for (const pose of arrivals) { initializePose(pose, existing, groundHeight); existing.push(pose); }
  const liveIds = new Set(state.logs.filter(p => p.live).map(p => p.id));
  for (const pose of state.logs) if (pose.live && pose.supportIds.some(id => !liveIds.has(id))) wake(pose);
  ageFragments(state, cycle, elapsed);
  state.accumulator += elapsed;
  let steps = Math.floor((state.accumulator + 1e-9) / STEP);
  state.accumulator -= steps * STEP;
  if (elapsed === 0 && arrivals.length) {
    const bodies = state.logs.filter(p => p.live);
    correctPositions(bodies, groundHeight, state.rockColliders);
    const contacts = allContacts(bodies, groundHeight, state.rockColliders); setSupports(bodies, contacts, 0);
    // A deliberately prepared, balanced stack need not jitter for half a second
    // on page load. An off-center support or a slope still starts moving.
    for (const pose of arrivals) if (pose.initial && pose.contactCount && balancedAtRest(pose, contacts)) pose.sleeping = true;
  }
  for (let step = 0; step < steps; step++) {
    state.physicsTime += STEP;
    releaseWeakSupport(state, cycle, STEP, time);
    const bodies = [...state.logs.filter(p => p.live), ...state.fragments];
    const smallest = Math.max(.012, Math.min(...bodies.map(p => p.radius)));
    const sweptSpeed = Math.max(0, ...bodies.map(p => p.linearVelocity.length() + p.angularVelocity.length() * p.boundRadius));
    // Swept-distance substeps protect thin kindling and char from tunneling
    // during a fast fall; one body cannot cross another between narrow phases.
    const substeps = clamp(Math.ceil((sweptSpeed + GRAVITY * STEP) * STEP / (smallest * .65)), 1, 16);
    const dt = STEP / substeps;
    for (let substep = 0; substep < substeps; substep++) {
      wakeLoads(bodies);
      for (const pose of bodies) {
        if (pose.sleeping && (pose.linearVelocity.lengthSq() > 1e-8 || pose.angularVelocity.lengthSq() > 1e-8)) wake(pose);
        if (pose.sleeping) continue;
        pose.linearVelocity.y -= GRAVITY * dt;
        pose.linearVelocity.multiplyScalar(Math.exp(-dt * .035));
        // Wood dissipates rolling energy at contacts; air damping never steers
        // it toward an invented destination. Slopes still accelerate a round log.
        if (pose.contactCount) pose.angularVelocity.multiplyScalar(Math.exp(-dt * 1.1));
        pose.x += pose.linearVelocity.x * dt; pose.y += pose.linearVelocity.y * dt; pose.z += pose.linearVelocity.z * dt;
        const angularSpeed = pose.angularVelocity.length();
        if (angularSpeed > 1e-8) pose.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(pose.angularVelocity.clone().divideScalar(angularSpeed), angularSpeed * dt)).normalize();
        pose.maxFall = Math.max(pose.maxFall, pose.fallFrom - pose.y); syncPose(pose);
      }
      const contacts = allContacts(bodies, groundHeight, state.rockColliders);
      prepareContacts(contacts, time, state, dt); solveVelocity(contacts); correctPositions(bodies, groundHeight, state.rockColliders);
      setSupports(bodies, allContacts(bodies, groundHeight, state.rockColliders), dt);
    }
  }
  // New fractures happen during the physics step, after thermal aging.
  cycle.fragmentChar = state.fragments.reduce((sum, fragment) => sum + fragment.remainingChar, 0);
  cycle.fragmentHeat = cycle.fragmentChar > 0 ? state.fragments.reduce((sum, fragment) => sum + fragment.heat * fragment.remainingChar, 0) / cycle.fragmentChar : 0;
  if (hadFragments || state.fragments.length) cycle.updateSummary?.();
  return state;
}
