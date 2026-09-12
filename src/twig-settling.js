import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const point = new THREE.Vector3(), world = new THREE.Vector3();
const matrix = new THREE.Matrix4(), worldDelta = new THREE.Matrix4();

function segmentEnds(mesh) {
  const half = mesh.geometry.parameters.height / 2;
  return [new THREE.Vector3(0, -half, 0).applyMatrix4(mesh.matrix), new THREE.Vector3(0, half, 0).applyMatrix4(mesh.matrix)];
}

function capture(object) {
  object.updateWorldMatrix(true, false);
  return { object, worldMatrix: object.matrixWorld.clone() };
}

// The scene builds each twig as a trunk followed by its fork. Keep the pair a
// rigid piece, including the separate spark and flame meshes attached to it.
export function createTwigSettling(twigs, layers) {
  twigs.updateWorldMatrix(true, true);
  const meshes = twigs.children.filter(child => child.isMesh), pieces = [];
  for (let i = 0; i < meshes.length; i += 2) {
    const parts = meshes.slice(i, i + 2), [a, b] = segmentEnds(parts[0]);
    const axis = b.clone().sub(a).normalize();
    const tip = parts[1] ? segmentEnds(parts[1])[1] : b.clone().add(new THREE.Vector3(.1, 0, 0));
    const normal = new THREE.Vector3().crossVectors(axis, tip.clone().sub(a)).normalize();
    if (normal.lengthSq() < .5) normal.crossVectors(axis, Math.abs(axis.y) < .9 ? up : new THREE.Vector3(1, 0, 0)).normalize();
    const inward = new THREE.Vector3(-a.x, 0, -a.z);
    if (inward.lengthSq() < .001) inward.set(1, 0, 0);
    inward.normalize();
    const from = new THREE.Matrix4().makeBasis(axis, normal, new THREE.Vector3().crossVectors(axis, normal));
    const to = new THREE.Matrix4().makeBasis(inward, up, new THREE.Vector3().crossVectors(inward, up));
    const rotation = new THREE.Quaternion().setFromRotationMatrix(to.multiply(from.invert()));
    const vertices = [];
    for (const part of parts) {
      const positions = part.geometry.attributes.position;
      for (let k = 0; k < positions.count; k++) vertices.push(new THREE.Vector3().fromBufferAttribute(positions, k).applyMatrix4(part.matrix).sub(a));
    }
    pieces.push({ anchor: a, end: b, rotation, vertices, items: parts.map(capture),
      inward, fallAt: null, support: null, transform: null });
  }
  const glows = layers.sparks.children.filter(child => child.userData.twigGlowOrigin);
  for (const glow of glows) {
    let closest, distance = Infinity;
    for (const piece of pieces) {
      const line = new THREE.Line3(piece.anchor, piece.end);
      line.closestPointToPoint(glow.userData.twigGlowOrigin, true, point);
      const candidate = point.distanceToSquared(glow.userData.twigGlowOrigin);
      if (candidate < distance) { closest = piece; distance = candidate; }
    }
    closest?.items.push(capture(glow));
  }
  // The final two twig pairs are the ones with flame jackets in stylized.js.
  layers.flames.children.filter(child => child.userData.twigFlame).forEach((flame, index) => {
    pieces[pieces.length - 2 + Math.floor(index / 2)]?.items.push(capture(flame));
  });
  return { twigs, pieces, resetToken: null, inverse: twigs.matrixWorld.clone().invert() };
}

function nearestSupport(piece, poses, twigs) {
  world.copy(piece.anchor).lerp(piece.end, .4).applyMatrix4(twigs.matrixWorld);
  let support, distance = Infinity;
  for (const pose of poses) {
    if (!pose.live) continue;
    new THREE.Line3(pose.a, pose.b).closestPointToPoint(world, true, point);
    const gap = point.distanceTo(world) - pose.radius;
    if (gap < .22 && gap < distance) { support = pose; distance = gap; }
  }
  return support ? { id: support.id, radius: support.radius } : null;
}

// Small twigs burn down over the first ten simulated minutes. The slow shrink
// is quantized to half-percent steps: invisible on a twig, but it stops every
// burn step from re-rendering depth and shadows.
export function twigBurnScale(burnTime) {
  const remaining = clamp(1 - burnTime / 600, 0, 1);
  return { scale: Math.round((.12 + .88 * Math.sqrt(remaining)) * 200) / 200, visible: remaining > .015 };
}

export function updateTwigSettling(state, cycle, time, poses = [], groundHeight = () => 0) {
  const { twigs, pieces } = state, token = `${cycle.seed}:${cycle.resetSerial}`;
  let changed = false;
  if (state.resetToken !== token) {
    state.resetToken = token;
    for (const piece of pieces) {
      piece.fallAt = null; piece.transform = null; piece.support = nearestSupport(piece, poses, twigs);
    }
    changed = true;
  }
  // Twigs retain their shape while falling. Scaling their whole group's Y
  // axis left the unsupported upper tips hanging in air.
  const { scale, visible } = twigBurnScale(cycle.time);
  if (twigs.visible !== visible) { twigs.visible = visible; changed = true; }
  twigs.scale.setScalar(1); twigs.updateWorldMatrix(true, false);
  if (!visible) return changed;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index], support = piece.support && poses.find(pose => pose.id === piece.support.id && pose.live);
    let unsupported = !support || support.radius < piece.support.radius * .72;
    if (support && !unsupported) {
      world.copy(piece.anchor).lerp(piece.end, .4).applyMatrix4(twigs.matrixWorld);
      new THREE.Line3(support.a, support.b).closestPointToPoint(world, true, point);
      unsupported = point.distanceTo(world) > support.radius + .22;
    }
    const collapseTime = 24 + (index * 17 % 47);
    if (piece.fallAt === null && (unsupported || cycle.time >= collapseTime)) piece.fallAt = time;
    const age = piece.fallAt === null ? 0 : Math.max(0, time - piece.fallAt);
    const progress = clamp(age / (.7 + index % 4 * .09), 0, 1);
    const drop = Math.min(2, age * age * 2.4);
    if (piece.transform && piece.lastScale === scale && piece.lastProgress === progress && piece.lastDrop === drop) continue;
    piece.lastScale = scale; piece.lastProgress = progress; piece.lastDrop = drop;
    const eased = progress * progress * (3 - 2 * progress);
    const rotation = new THREE.Quaternion().slerp(piece.rotation, eased);
    const anchor = piece.anchor.clone().addScaledVector(piece.inward, .16 * eased);
    anchor.y -= drop;
    // Rest the complete fork on the actual uneven clearing. This also follows
    // its changing thickness as it burns down without leaving a ground gap.
    let lift = -Infinity;
    for (const vertex of piece.vertices) {
      world.copy(vertex).multiplyScalar(scale).applyQuaternion(rotation).add(anchor).applyMatrix4(twigs.matrixWorld);
      lift = Math.max(lift, groundHeight(world.x, world.z) + .003 - world.y);
    }
    if (age > 0) anchor.y += Math.max(0, lift);
    matrix.compose(anchor, rotation, new THREE.Vector3(scale, scale, scale));
    matrix.multiply(new THREE.Matrix4().makeTranslation(-piece.anchor.x, -piece.anchor.y, -piece.anchor.z));
    if (piece.transform?.equals(matrix)) continue;
    piece.transform = matrix.clone(); changed = true;
    worldDelta.multiplyMatrices(twigs.matrixWorld, matrix).multiply(state.inverse);
    for (const item of piece.items) {
      item.object.parent.updateWorldMatrix(true, false);
      const local = item.object.parent.matrixWorld.clone().invert().multiply(worldDelta).multiply(item.worldMatrix);
      local.decompose(item.object.position, item.object.quaternion, item.object.scale);
      item.object.updateMatrixWorld();
    }
  }
  return changed;
}
