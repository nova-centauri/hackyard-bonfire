import { getFuelType } from './fuel-types.js';

// Reduced-order surface combustion, not calibrated thermochemistry. A log keeps
// its bulk heat reservoir while these material-attached cells carry the finite
// fuel, drying, char and thermal history that the renderer and fractures sample.
export const SURFACE_AXIAL = 5;
export const SURFACE_RADIAL = 8;
const COUNT = SURFACE_AXIAL * SURFACE_RADIAL, TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const definitions = [
  [[-1.45,.27,.8],[1.3,.43,-.6],.25], [[1.28,.31,1.08],[-1.22,.42,-.72],.28],
  [[-.85,.32,1.4],[.62,.66,-1.15],.23], [[-1.22,.43,-.96],[.1,1.37,.1],.25],
  [[1.3,.45,-.8],[-.22,1.4,.3],.24], [[-1.16,.56,.5],[.92,1.03,-.17],.23],
  [[.85,.52,.95],[-.22,1.62,-.12],.22],
];
const components = v => Array.isArray(v) ? v.slice(0, 3) : [v.x, v.y, v.z];
const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const rotate = (v, q) => {
  const [x,y,z] = v, { x:qx, y:qy, z:qz, w:qw } = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
};

export function copyCombustionPose(pose) {
  if (!pose?.a || !pose?.b || !Number.isFinite(pose.radius) || pose.radius <= 0) return null;
  const a = components(pose.a), b = components(pose.b);
  if (![...a,...b].every(Number.isFinite)) return null;
  const axis = unit(b.map((v, i) => v - a[i]));
  let x, z;
  if (pose.quaternion && ['x','y','z','w'].every(k => Number.isFinite(pose.quaternion[k]))) {
    x = rotate([1,0,0], pose.quaternion); z = rotate([0,0,1], pose.quaternion);
  } else if (pose.sectionX && pose.sectionZ) {
    x = unit(components(pose.sectionX)); z = unit(components(pose.sectionZ));
  } else {
    // The same shortest-arc +Y -> log-axis convention used by the log meshes.
    const q = { x: axis[2], y: 0, z: -axis[0], w: 1 + axis[1] };
    const n = Math.hypot(q.x,q.y,q.z,q.w);
    if (n < 1e-7) { q.x = 1; q.w = 0; } else for (const k of ['x','y','z','w']) q[k] /= n;
    x = rotate([1,0,0], q); z = rotate([0,0,1], q);
  }
  return { a, b, x, z, radius: pose.radius, id: pose.id };
}

export function fallbackCombustionPose(log) {
  const [aa, bb, radius] = definitions[log.slot % definitions.length], fuel = getFuelType(log.fuelType);
  const center = aa.map((v, i) => (v + bb[i]) / 2), half = bb.map((v, i) => (v - aa[i]) * fuel.lengthScale * log.scale / 2);
  const spin = p => [p[0] * Math.cos(log.angle) + p[2] * Math.sin(log.angle) + log.offset, p[1], p[2] * Math.cos(log.angle) - p[0] * Math.sin(log.angle)];
  return copyCombustionPose({ a: spin(center.map((v,i) => v - half[i])), b: spin(center.map((v,i) => v + half[i])), radius: radius * fuel.radiusScale * log.scale });
}

function remember(log) {
  log.surface.bulk = [log.wood, log.char, log.moisture, log.temperature, log.flame];
}

export function ensureLogSurface(log) {
  // Editing/replacing fuel through the existing public lifecycle API is allowed.
  // Rebase only an external reservoir edit, never an ordinary pose change.
  const old = log.surface?.bulk;
  if (!old || [log.wood,log.char,log.moisture,log.temperature,log.flame].some((v,i) => Math.abs(v-old[i]) > 1e-8)) {
    log.surface = { axial: SURFACE_AXIAL, radial: SURFACE_RADIAL, patches: Array.from({ length: COUNT }, (_, i) => ({
      along: (Math.floor(i / SURFACE_RADIAL) + .5) / SURFACE_AXIAL, angle: i % SURFACE_RADIAL * TAU / SURFACE_RADIAL,
      wood: log.wood, char: log.char, moisture: log.moisture, temperature: log.temperature,
      burn: 1 - log.wood, exposure: 0, flame: log.flame, glow: 0,
    })) };
    if (log.addedAt < 0 && log.everLit) {
      const pose = fallbackCombustionPose(log), patches = log.surface.patches;
      const weights = patches.map(p => .025 + surfaceExposure(pose,p.along,p.angle).exposure ** 2);
      const total = weights.reduce((a,b) => a+b,0);
      for (let i=0;i<COUNT;i++) {
        const patch = patches[i];
        patch.wood = 1; patch.burn = 0;
        patch.char = log.char * weights[i] / total * COUNT;
        patch.temperature = clamp(log.temperature * (.22 + .78 * weights[i] / total * COUNT));
        patch.glow = clamp((patch.temperature-.26)/.65) ** 1.6 * clamp(patch.char/.025);
      }
      remove(patches, 'wood', 1-log.wood, weights, (patch,amount) => { patch.burn += amount; });
    }
    updateSurfaceSignals(log); remember(log);
  }
  return log.surface;
}

// A low diffuse bed plus a directional radiative core heats the inward-facing
// bark most. Axial distance and height matter independently of the slot index.
export function surfaceExposure(pose, along, angle) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const normal = pose.x.map((v,i) => v * cs + pose.z[i] * sn);
  const point = pose.a.map((v,i) => v + (pose.b[i] - v) * along + normal[i] * pose.radius);
  const [x,y,z] = point, d = Math.hypot(x, y - .055, z) || .001;
  const facing = clamp((-normal[0] * x + normal[1] * (.055-y) - normal[2] * z) / d);
  const plume = Math.exp(-(x*x+z*z)/1.65) * Math.exp(-Math.max(0,y-.2)/1.7);
  return { point, exposure: clamp(plume * (.58 + .62 * facing), 0, 1.2) };
}

export function combustionEnvironment(log, pose) {
  const surface = ensureLogSurface(log), actual = pose || fallbackCombustionPose(log);
  let exposure = 0;
  for (const patch of surface.patches) {
    const sample = surfaceExposure(actual, patch.along, patch.angle);
    patch.exposure = sample.exposure; patch.position = sample.point; exposure += sample.exposure;
  }
  // The reservoir calibration assumes a crossed log in the coal bed. Preserve
  // that calibration in standalone cycles; live geometry reduces it as fuel
  // moves away from the bed, so distant logs cannot feed a central fire.
  // Unit coupling is the mean exposure of the seven designed slots (0.39), so
  // a settled crossed log burns as the reservoir model was tuned and only the
  // best-placed piece exceeds it. Normalising to the single best slot instead
  // ran the whole live pile at three quarters of the calibration, which left
  // fresh wood on a cooling bed too marginal to catch and the tended fire
  // went out within a couple of hours at every burn speed.
  surface.exposure = exposure / COUNT;
  surface.bedCoupling = pose ? clamp(surface.exposure / .39, 0, 1.12) : 1;
  surface.pose = actual;
  return surface;
}

export function nearbyFlameCoupling(a, b) {
  const center = p => p.a.map((v,i) => (v + p.b[i]) * .5);
  const ca = center(a), cb = center(b), d2 = ca.reduce((n,v,i) => n + (v-cb[i])**2, 0);
  return .25 * Math.exp(-d2 / 1.7);
}

// Remove a requested bulk amount from finite cells. Repeated redistribution
// handles a burnt-through hot patch without making any cell's fuel negative.
function remove(patches, field, amount, weights, onRemove) {
  let remaining = amount * COUNT, total = 0;
  for (let pass = 0; pass < COUNT && remaining > 1e-12; pass++) {
    let weightSum = 0;
    for (let i = 0; i < COUNT; i++) if (patches[i][field] > 1e-12) weightSum += weights[i];
    if (weightSum <= 0) break;
    const request = remaining;
    for (let i = 0; i < COUNT; i++) {
      const patch = patches[i];
      if (patch[field] <= 1e-12) continue;
      const taken = Math.min(patch[field], request * weights[i] / weightSum);
      patch[field] = Math.max(0, patch[field] - taken); remaining -= taken; total += taken;
      if (onRemove) onRemove(patch, taken);
    }
  }
  return total / COUNT;
}

export function updateLogSurface(log, dt, fuel, { consumed, dry, charBurn, shed, coreHeat }) {
  const surface = log.surface, patches = surface.patches, thermal = [], oxidation = [];
  for (const patch of patches) {
    // Internal conduction provides slow background heat. The exposed side heats
    // first; a roll changes exposure immediately but cannot teleport old heat.
    const relative = clamp(patch.exposure / Math.max(.12, surface.exposure), 0, 2);
    const target = clamp(log.temperature * (.16 + .84 * relative ** 1.3));
    patch.temperature += (target - patch.temperature) * (1 - Math.exp(-dt * fuel.heatRate / (patch.moisture > .06 ? 38 : 16)));
    thermal.push(.025 + Math.max(0,patch.temperature-.24) ** 2 * (.22 + patch.exposure * 1.8));
    oxidation.push(.06 + patch.temperature * (.35 + patch.exposure));
  }
  remove(patches, 'moisture', dry, thermal, (patch, amount) => { patch.temperature = Math.max(0, patch.temperature - amount * .7); });
  remove(patches, 'wood', consumed, thermal, (patch, amount) => { patch.burn += amount; patch.char += amount * (fuel.charYield ?? .26); });
  remove(patches, 'char', charBurn + shed, oxidation);
  updateSurfaceSignals(log);
  surface.cleanBurn = clamp(coreHeat) * (1 - log.visibleFlame / Math.max(.001, log.flame));
  remember(log);
}

function updateSurfaceSignals(log) {
  let glow = 0, visibleFlame = 0;
  for (const patch of log.surface.patches) {
    const hot = clamp((patch.temperature - .26) / .65);
    patch.glow = hot ** 1.6 * clamp(patch.char / .025 + patch.burn * 1.4) * clamp((patch.wood + patch.char) / .025);
    // Yellow/orange luminosity tracks released volatiles. Mature hot char can
    // radiate strongly with little luminous gas, leaving the core visible.
    const fresh = clamp(patch.wood / .72);
    const cleanChar = clamp((patch.temperature - .65) / .3) * (1 - fresh);
    const localGas = clamp((patch.temperature - .29) / .46) * clamp(patch.wood / .12);
    patch.flame = clamp(log.flame * localGas * (.42 + fresh * .58) * (1 - cleanChar * .58));
    glow += patch.glow; visibleFlame += patch.flame;
  }
  log.glow = glow / COUNT; log.visibleFlame = visibleFlame / COUNT;
}

export function extinguishLogSurface(log) {
  for (const patch of log.surface.patches) { patch.wood = 0; patch.char = 0; patch.flame = 0; patch.glow = 0; }
  log.visibleFlame = 0; log.glow = 0; remember(log);
}

export function removeCharFromSurface(log, amount, along = .5) {
  const surface = ensureLogSurface(log);
  const removed = remove(surface.patches, 'char', Math.max(0, amount), surface.patches.map(p => .03 + Math.exp(-(((p.along - along)/.22)**2))));
  log.char = Math.max(0, log.char - removed); remember(log);
  return removed;
}

export function sampleLogSurface(log, along = .5, angle = 0) {
  const { patches } = ensureLogSurface(log);
  const row = clamp(along * SURFACE_AXIAL - .5, 0, SURFACE_AXIAL - 1), a = Math.floor(row), b = Math.min(a + 1, SURFACE_AXIAL - 1), fy = row - a;
  const side = ((angle / TAU * SURFACE_RADIAL) % SURFACE_RADIAL + SURFACE_RADIAL) % SURFACE_RADIAL;
  const c = Math.floor(side), d = (c + 1) % SURFACE_RADIAL, fx = side - c;
  const result = {};
  for (const key of ['temperature','wood','char','moisture','exposure','glow','flame','burn']) {
    result[key] = (patches[a*SURFACE_RADIAL+c][key]*(1-fx)+patches[a*SURFACE_RADIAL+d][key]*fx)*(1-fy)
      + (patches[b*SURFACE_RADIAL+c][key]*(1-fx)+patches[b*SURFACE_RADIAL+d][key]*fx)*fy;
  }
  return result;
}
