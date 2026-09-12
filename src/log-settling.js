import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const massOf = log => Math.max(0, log.wood + log.char * 1.4);
const active = log => log.phase !== 'queued' && log.phase !== 'ash';
const randomFor = seed => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

export function createLogSettling(definitions, seed = 1) {
  return { definitions, random: randomFor(seed), logs: [], lastTime: null, nextCollapse: 8 + (seed % 7), impacts: [] };
}

function endpoints(pose) {
  const half = pose.length * .5, horizontal = Math.cos(pose.pitch) * half;
  const dx = Math.cos(pose.yaw) * horizontal, dz = Math.sin(pose.yaw) * horizontal, dy = Math.sin(pose.pitch) * half;
  pose.a.set(pose.x - dx, pose.y - dy, pose.z - dz);
  pose.b.set(pose.x + dx, pose.y + dy, pose.z + dz);
}

// Closest points on the two projected rods. The vertical constraint then uses
// the actual height of the lower rod at that contact, not its original height.
function crossing(a, b, c, d) {
  const ux = b.x - a.x, uz = b.z - a.z, vx = d.x - c.x, vz = d.z - c.z;
  const wx = a.x - c.x, wz = a.z - c.z;
  const aa = ux * ux + uz * uz, bb = ux * vx + uz * vz, cc = vx * vx + vz * vz;
  const dd = ux * wx + uz * wz, ee = vx * wx + vz * wz;
  const denominator = aa * cc - bb * bb;
  let t = denominator > 1e-8 ? clamp((bb * ee - cc * dd) / denominator, 0, 1) : .5;
  let s = cc > 1e-8 ? clamp((bb * t + ee) / cc, 0, 1) : 0;
  t = aa > 1e-8 ? clamp((bb * s - dd) / aa, 0, 1) : 0;
  s = cc > 1e-8 ? clamp((bb * t + ee) / cc, 0, 1) : 0;
  return { t, s, distance: Math.hypot(a.x + ux * t - c.x - vx * s, a.z + uz * t - c.z - vz * s) };
}

function constraints(pose, lowerLogs, groundHeight) {
  const contacts = [], radialHeight = pose.radius * Math.cos(pose.pitch);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, x = THREE.MathUtils.lerp(pose.a.x, pose.b.x, t), z = THREE.MathUtils.lerp(pose.a.z, pose.b.z, t);
    contacts.push({ t, height: groundHeight(x, z) + radialHeight + .012, slot: -1 });
  }
  for (const lower of lowerLogs) {
    if (!lower.live) continue;
    const contact = crossing(pose.a, pose.b, lower.a, lower.b), combined = pose.radius + lower.radius;
    if (contact.distance >= combined * .98) continue;
    const height = THREE.MathUtils.lerp(lower.a.y, lower.b.y, contact.s) + Math.sqrt(combined * combined - contact.distance * contact.distance);
    contacts.push({ t: contact.t, height, slot: lower.slot });
  }
  return contacts;
}

// Find the lowest center of mass whose whole axis clears the soil and crossed
// logs. A tilted rod normally rests on an endpoint and one crossed log.
function restingPose(pose, contacts) {
  let best = { y: Infinity, difference: 0 };
  const limit = pose.length * .62;
  const evaluate = difference => {
    if (Math.abs(difference) > limit) return;
    let y = -Infinity;
    for (const contact of contacts) y = Math.max(y, contact.height - (contact.t - .5) * difference);
    // Prefer a small tilt when several support arrangements have equal height.
    if (y + Math.abs(difference) * .001 < best.y + Math.abs(best.difference) * .001) best = { y, difference };
  };
  evaluate(0); evaluate(-limit); evaluate(limit);
  for (let i = 0; i < contacts.length; i++) for (let j = i + 1; j < contacts.length; j++) {
    const distance = contacts[i].t - contacts[j].t;
    if (Math.abs(distance) > .025) evaluate((contacts[i].height - contacts[j].height) / distance);
  }
  return { y: best.y, pitch: Math.asin(clamp(best.difference / pose.length, -.62, .62)) };
}

function makePose(definition, log, time, groundHeight) {
  const a = new THREE.Vector3(...definition[0]).applyAxisAngle(new THREE.Vector3(0, 1, 0), log.angle);
  const b = new THREE.Vector3(...definition[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), log.angle);
  const delta = b.clone().sub(a), center = a.clone().lerp(b, .5);
  return { id: log.id, slot: log.slot, x: center.x + log.offset, y: center.y + groundHeight(center.x, center.z), z: center.z,
    baseX: center.x + log.offset, baseZ: center.z, baseLength: delta.length(), baseRadius: definition[2],
    length: delta.length() * log.scale, radius: definition[2] * Math.sqrt(massOf(log)) * log.scale,
    yaw: Math.atan2(delta.z, delta.x), pitch: Math.asin(delta.y / delta.length()), pitchVelocity: 0, velocity: 0,
    targetX: center.x + log.offset, targetZ: center.z, targetYaw: Math.atan2(delta.z, delta.x), compression: 1,
    a, b, live: active(log), born: time, initial: log.addedAt === null || log.addedAt < 0, initialized: false,
    maxFall: 0, fallFrom: 0, inFlight: false, supports: [], lastImpact: -10, releases: 0 };
}

function releaseWeakSupport(state, cycle, time) {
  if (time < state.nextCollapse) return;
  state.nextCollapse = time + 9 + state.random() * 12;
  const candidates = state.logs.filter(pose => {
    const log = cycle.logs[pose.slot];
    return pose.live && log.temperature > .42 && log.wood < .74 && pose.releases < 3 && !pose.inFlight;
  });
  if (!candidates.length) return;
  candidates.sort((a, b) => cycle.logs[a.slot].wood + a.releases * .22 - cycle.logs[b.slot].wood - b.releases * .22);
  const pose = candidates[0], turn = (state.random() - .5) * .36;
  pose.releases++;
  pose.compression *= .81;
  // A charred shell gives way, rolling toward the center and disturbing logs
  // it supported. Gravity and actual contacts determine when the impact occurs.
  pose.targetX = pose.x * .75 + Math.sin(pose.yaw) * turn;
  pose.targetZ = pose.z * .75 - Math.cos(pose.yaw) * turn;
  pose.targetYaw += turn;
  pose.pitchVelocity += (state.random() - .5) * .8;
}

export function updateLogSettling(state, cycle, time, groundHeight = () => 0) {
  state.impacts = [];
  const firstUpdate = state.lastTime === null;
  const elapsed = firstUpdate ? 0 : clamp(time - state.lastTime, 0, .12);
  state.lastTime = time;
  for (let i = 0; i < cycle.logs.length; i++) {
    const log = cycle.logs[i];
    if (!state.logs[i] || state.logs[i].id !== log.id) state.logs[i] = makePose(state.definitions[i], log, time, groundHeight);
    const pose = state.logs[i];
    if (!pose.live && active(log)) { pose.initialized = false; pose.initial = false; pose.born = time; }
    pose.live = active(log);
    const mass = massOf(log);
    pose.length = pose.baseLength * log.scale * (.84 + .16 * Math.sqrt(Math.min(1, mass)));
    pose.radius = pose.baseRadius * Math.max(.035, Math.sqrt(mass)) * log.scale * pose.compression;
  }
  releaseWeakSupport(state, cycle, time);
  // Stable contact order follows arrival: replacement fuel is laid on the
  // current pile rather than being teleported underneath older logs.
  const ordered = state.logs.filter(pose => pose.live).sort((a, b) => {
    const la = cycle.logs[a.slot], lb = cycle.logs[b.slot];
    return (la.addedAt >= 0 ? la.addedAt + 1 : 0) - (lb.addedAt >= 0 ? lb.addedAt + 1 : 0) || a.slot - b.slot;
  });
  const steps = Math.max(1, Math.ceil(elapsed / (1 / 90))), dt = elapsed / steps;
  for (let step = 0; step < steps; step++) {
    const lower = [];
    for (const pose of ordered) {
      endpoints(pose);
      let contacts = constraints(pose, lower, groundHeight), rest = restingPose(pose, contacts);
      if (!pose.initialized) {
        pose.pitch = rest.pitch; endpoints(pose);
        contacts = constraints(pose, lower, groundHeight); rest = restingPose(pose, contacts);
        pose.y = rest.y + (pose.initial ? 0 : .92);
        pose.pitch = rest.pitch; pose.initialized = true; pose.fallFrom = pose.y;
      }
      if (dt > 0) {
        const slide = 1 - Math.exp(-dt * 3.7);
        pose.x += (pose.targetX - pose.x) * slide; pose.z += (pose.targetZ - pose.z) * slide;
        pose.yaw += (pose.targetYaw - pose.yaw) * slide;
        pose.pitchVelocity += (rest.pitch - pose.pitch) * dt * 38;
        pose.pitchVelocity *= Math.exp(-dt * 8.5);
        pose.pitch = clamp(pose.pitch + pose.pitchVelocity * dt, -.68, .68);
        endpoints(pose); contacts = constraints(pose, lower, groundHeight);
        let floor = -Infinity;
        const difference = Math.sin(pose.pitch) * pose.length;
        for (const contact of contacts) floor = Math.max(floor, contact.height - (contact.t - .5) * difference);
        const clearance = pose.y - floor;
        if (clearance > .003) {
          if (!pose.inFlight) pose.fallFrom = pose.y;
          pose.inFlight = true;
          pose.velocity -= 5.8 * dt;
          pose.y += pose.velocity * dt;
          pose.maxFall = Math.max(pose.maxFall, pose.fallFrom - pose.y);
        }
        if (pose.y <= floor + .003) {
          if (pose.inFlight && pose.velocity < -.38 && pose.maxFall > .016 && time - pose.lastImpact > .45) {
            const strength = clamp((-pose.velocity * .22 + pose.maxFall * .75) * Math.sqrt(Math.max(.05, massOf(cycle.logs[pose.slot]))), .08, 1);
            const contactDistance = contact => Math.abs(contact.height - (floor + (contact.t - .5) * difference)) + Math.abs(contact.t - .5) * .002;
            const lowest = contacts.reduce((best, contact) => contactDistance(contact) < contactDistance(best) ? contact : best, contacts[0]);
            const position = pose.a.clone().lerp(pose.b, lowest.t); position.y = floor + (lowest.t - .5) * difference - pose.radius * .65;
            state.impacts.push({ slot: pose.slot, time, strength, position, heat: cycle.logs[pose.slot].temperature });
            pose.lastImpact = time;
          }
          pose.y = floor; pose.velocity = 0; pose.inFlight = false; pose.maxFall = 0;
        }
      }
      endpoints(pose);
      pose.supports = contacts.filter(c => c.slot >= 0 && Math.abs(c.height - THREE.MathUtils.lerp(pose.a.y, pose.b.y, c.t)) < .06).map(c => c.slot);
      lower.push(pose);
    }
  }
  return state;
}
