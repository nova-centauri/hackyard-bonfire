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
  return { a, b, x, z, radius: pose.radius, id: pose.id, fuelType: pose.fuelType };
}

export function fallbackCombustionPose(log) {
  const [aa, bb, radius] = definitions[log.slot % definitions.length], fuel = getFuelType(log.fuelType);
  const center = aa.map((v, i) => (v + bb[i]) / 2), half = bb.map((v, i) => (v - aa[i]) * fuel.lengthScale * log.scale / 2);
  const spin = p => [p[0] * Math.cos(log.angle) + p[2] * Math.sin(log.angle) + log.offset, p[1], p[2] * Math.cos(log.angle) - p[0] * Math.sin(log.angle)];
  return copyCombustionPose({ a: spin(center.map((v,i) => v - half[i])), b: spin(center.map((v,i) => v + half[i])), radius: radius * fuel.radiusScale * log.scale, fuelType: log.fuelType });
}

function remember(log) {
  log.surface.bulk = [log.wood, log.char, log.moisture, log.temperature, log.flame];
}

export function ensureLogSurface(log) {
  // Editing/replacing fuel through the existing public lifecycle API is allowed.
  // Rebase only an external reservoir edit, never an ordinary pose change.
  const old = log.surface?.bulk;
  if (!old || [log.wood,log.char,log.moisture,log.temperature,log.flame].some((v,i) => Math.abs(v-old[i]) > 1e-8)) {
    const phase = (log.id ?? log.slot + 1) * 2.399963 + (log.scale ?? 1) * 19.7;
    log.surface = { axial: SURFACE_AXIAL, radial: SURFACE_RADIAL, patches: Array.from({ length: COUNT }, (_, i) => {
      const along = (Math.floor(i / SURFACE_RADIAL) + .5) / SURFACE_AXIAL, angle = i % SURFACE_RADIAL * TAU / SURFACE_RADIAL;
      // Uneven bark density and checks follow this piece of wood through rolls.
      // Coherent variation avoids a uniform advancing band without introducing
      // frame noise or consuming the lifecycle's seeded random stream.
      const reactivity = 1 + .24 * Math.sin(angle * 3 + along * 7 + phase)
        + .18 * Math.sin(angle * 2 - along * 13 + phase * 1.7);
      return { along, angle, reactivity, wood: log.wood, char: log.char, moisture: log.moisture, temperature: log.temperature,
        burn: 1 - log.wood, exposure: 0, flame: log.flame, glow: 0 };
    }), temperatures: new Float64Array(COUNT) };
    if (log.addedAt < 0 && log.everLit) {
      const pose = fallbackCombustionPose(log), patches = log.surface.patches;
      const weights = patches.map(p => .006 + surfaceExposure(pose,p.along,p.angle).exposure ** 2 * p.reactivity);
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

// The lower, inward-facing surface receives direct radiation from the coal
// bed. Diffuse heat alone warms the protected crown much more slowly. Keep the
// reservoir's historical coupling separate: a surface detail must not change
// ignition thresholds or the calibrated rate at which a tended fire uses fuel.
export function surfaceExposure(pose, along, angle, fuel = getFuelType(pose.fuelType)) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const radial = pose.x.map((v,i) => v * cs + pose.z[i] * sn);
  const center = pose.a.map((v,i) => v + (pose.b[i] - v) * along);
  const legacy = center.map((v,i) => v + radial[i] * pose.radius);
  const legacyDistance = Math.hypot(legacy[0], legacy[1] - .055, legacy[2]) || .001;
  const legacyFacing = clamp((-radial[0] * legacy[0] + radial[1] * (.055-legacy[1]) - radial[2] * legacy[2]) / legacyDistance);
  const bedExposure = clamp(Math.exp(-(legacy[0]**2+legacy[2]**2)/1.65) * Math.exp(-Math.max(0,legacy[1]-.2)/1.7) * (.58 + .62 * legacyFacing), 0, 1.2);
  let radius = pose.radius, normal = radial;
  if (fuel.shape === 'board') {
    // The atlas still uses atan2(z,x), but those rays hit flat board faces,
    // not the enclosing cylinder. Broad faces share a normal and thin sheets
    // have a much shorter path for heat to reach their opposite face.
    const halfDepth = radius / Math.hypot(fuel.aspect, 1), halfWidth = halfDepth * fuel.aspect;
    const toX = halfWidth / Math.max(1e-9, Math.abs(cs)), toZ = halfDepth / Math.max(1e-9, Math.abs(sn));
    radius = Math.min(toX, toZ);
    normal = (toX < toZ ? pose.x : pose.z).map(v => v * Math.sign(toX < toZ ? cs : sn));
  }
  const point = center.map((v,i) => v + radial[i] * radius);
  const [x,y,z] = point, d = Math.hypot(x, y + .18, z) || .001;
  // The dirt bowl and coals sit below world zero. Radiation also comes from
  // the bed under the piece, not only one point that could fall inside a low
  // log and incorrectly leave its whole underside sheltered from the heat.
  const facing = Math.max(clamp((-normal[0] * x + normal[1] * (-.18-y) - normal[2] * z) / d), clamp(-normal[1]) * .72 * Math.exp(-(x*x+z*z)/.75));
  const plume = Math.exp(-(x*x+z*z)/1.65) * Math.exp(-Math.max(0,y-.2)/1.7);
  return { point, thickness: radius * 2, exposure: clamp(plume * (.11 + 1.1 * facing ** .8), 0, 1.2), bedExposure };
}

export function combustionEnvironment(log, pose) {
  const surface = ensureLogSurface(log), previous = surface.environment;
  // The lifecycle receives detached pose snapshots once per rendered frame.
  // Accelerated burn steps can reuse their geometric exposure; thermal state
  // still advances on every fixed step. Standalone poses change only when
  // placement/fuel properties change.
  const transform = pose ? [...pose.a, ...pose.b, ...pose.x, ...pose.z, pose.radius] : null;
  if (previous && previous.pose === pose && previous.fuelType === log.fuelType
    && (pose ? previous.transform.every((v,i) => v === transform[i])
      : previous.scale === log.scale && previous.angle === log.angle && previous.offset === log.offset && previous.slot === log.slot)) return surface;
  const actual = pose || fallbackCombustionPose(log);
  const fuel = getFuelType(log.fuelType);
  let exposure = 0, bedExposure = 0;
  for (const patch of surface.patches) {
    const sample = surfaceExposure(actual, patch.along, patch.angle, fuel);
    patch.exposure = sample.exposure; patch.position = sample.point; patch.thickness = sample.thickness;
    exposure += sample.exposure; bedExposure += sample.bedExposure;
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
  surface.bedCoupling = pose ? clamp(bedExposure / COUNT / .39, 0, 1.12) : 1;
  surface.pose = actual;
  surface.environment = { pose, transform, fuelType: log.fuelType, scale: log.scale, angle: log.angle, offset: log.offset, slot: log.slot };
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
  for (let i = 0; i < COUNT; i++) surface.temperatures[i] = patches[i].temperature;
  for (let i = 0; i < COUNT; i++) {
    const patch = patches[i];
    // Internal conduction provides slow background heat. The exposed side heats
    // first; a roll changes exposure immediately but cannot teleport old heat.
    // Sheltering half the circumference must not renormalize its weak diffuse
    // heat back to a hot-log average and make the protected crown glow again.
    const relative = clamp(patch.exposure / Math.max(.34, surface.exposure), 0, 2);
    const direct = clamp(log.temperature * (.12 + .88 * relative ** 1.4 * patch.reactivity));
    const opposite = Math.floor(i / SURFACE_RADIAL) * SURFACE_RADIAL + (i + SURFACE_RADIAL / 2) % SURFACE_RADIAL;
    const conduction = Math.exp(-(patch.thickness ?? .5) / .14) * clamp(1 - patch.moisture * 3);
    const target = Math.max(direct, surface.temperatures[opposite] * conduction);
    const charInsulation = clamp(patch.char / .12) * (1 - clamp(patch.wood / .3)) * 20;
    patch.temperature += (target - patch.temperature) * (1 - Math.exp(-dt * fuel.heatRate / (patch.moisture > .06 ? 38 : 16 + charInsulation)));
    thermal.push(.008 + Math.max(0,patch.temperature-.24) ** 2 * (.55 + patch.exposure * .85) * patch.reactivity);
    // The coal-facing underside receives the most radiation but less fresh
    // air. Its char survives as an insulating, glowing crust while the more
    // accessible edges oxidize; heat exposure is not an oxygen supply.
    oxidation.push(.05 + patch.temperature * (.18 + .55 * (1 - clamp(patch.exposure / 1.2))));
  }
  remove(patches, 'moisture', dry, thermal, (patch, amount) => { patch.temperature = Math.max(0, patch.temperature - amount * .7); });
  remove(patches, 'wood', consumed, thermal, (patch, amount) => { patch.burn += amount; patch.char += amount * (fuel.charYield ?? .26); });
  remove(patches, 'char', charBurn + shed, oxidation);
  updateSurfaceSignals(log);
  surface.cleanBurn = clamp(coreHeat) * (1 - log.visibleFlame / Math.max(.001, log.flame));
  remember(log);
}

function updateSurfaceSignals(log) {
  let glow = 0, visibleFlame = 0, peakFlame = 0;
  for (const patch of log.surface.patches) {
    const hot = clamp((patch.temperature - .26) / .65);
    patch.glow = hot ** 1.6 * clamp(patch.char / .025 + patch.burn * 1.4) * clamp((patch.wood + patch.char) / .025);
    // Yellow/orange luminosity tracks released volatiles. Mature hot char can
    // radiate strongly with little luminous gas, leaving the core visible.
    // Surface char is a porous vent for volatiles from the wood beneath it.
    // Exhausting this finite surface cell must not switch off a still-burning
    // interior; the local temperature continues to select where gas escapes.
    const gasWood = Math.max(patch.wood, log.wood);
    const fresh = clamp(gasWood / .72);
    const cleanChar = clamp((patch.temperature - .65) / .3) * (1 - fresh);
    const localGas = clamp((patch.temperature - .29) / .46) * clamp(gasWood / .12);
    patch.flame = clamp(log.flame * localGas * (.42 + fresh * .58) * (1 - cleanChar * .58));
    glow += patch.glow; visibleFlame += patch.flame; peakFlame = Math.max(peakFlame, patch.flame);
  }
  // A sheltered crown changes the emitting area rather than extinguishing
  // the whole fire. Keep overall luminosity tied to the active hot vents.
  log.glow = glow / COUNT; log.visibleFlame = peakFlame * .65 + visibleFlame / COUNT * .35;
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

// Volatile gas from the hot lower face rises around the wood. Main flame roots
// therefore follow a whole axial band rather than the temperature of its cool
// upper bark. Interpolate rows before reducing so roots move without a jump.
export function sampleLogFlameBand(log, along = .5) {
  const { patches } = ensureLogSurface(log);
  const row = clamp(along * SURFACE_AXIAL - .5, 0, SURFACE_AXIAL - 1), a = Math.floor(row), b = Math.min(a + 1, SURFACE_AXIAL - 1), blend = row - a;
  let sum = 0, peak = 0;
  for (let side = 0; side < SURFACE_RADIAL; side++) {
    const flame = patches[a * SURFACE_RADIAL + side].flame * (1-blend) + patches[b * SURFACE_RADIAL + side].flame * blend;
    sum += flame; peak = Math.max(peak, flame);
  }
  return peak * .65 + sum / SURFACE_RADIAL * .35;
}
