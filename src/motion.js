// Gas motion uses real seconds; the separate burn clock controls the fuel and heat.
const fract = value => value - Math.floor(value);
const fade = age => Math.min(1, age / .05) * Math.min(1, (1 - age) / .2);

export function createMotionState(layers, sparks, lights, coalMaterial, barkMaterial) {
  const uniforms = new Set();
  for (const group of Object.values(layers)) group.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material?.uniforms?.uTime) uniforms.add(material.uniforms.uTime);
  });
  return {
    uniforms: [...uniforms],
    steam: layers.steam.children.filter(sprite => sprite.userData.steam),
    sparks,
    sparkOrigins: sparks.geometry.attributes.position.array.slice(),
    sparkColors: sparks.geometry.attributes.color.array.slice(),
    streaks: layers.sparks.children.filter(object => object.userData.streak),
    lights: lights.map(light => ({ light, intensity: light.intensity })),
    coalMaterial, coalEmission: coalMaterial.emissiveIntensity,
    barkMaterial, barkEmission: barkMaterial.emissiveIntensity,
  };
}

export function updateStudyMotion(study) {
  const motion = study.motion;
  if (!motion) return;
  const time = study.animationTime;
  for (const uniform of motion.uniforms) uniform.value = time;
  const driftSpeed = 1.55;
  const cycle = study.cycle;
  const firePower = cycle ? Math.min(1, cycle.flame / 3.2) : 1;
  const coalHeat = cycle ? cycle.coalHeat : 1;
  const impact = study.burnVisuals?.impactPulse || 0;
  for (const volume of study.volumes) if (volume.material.uniforms.uImpact) volume.material.uniforms.uImpact.value = impact;
  const sparkPower=firePower+(cycle?.coalMass>.005?coalHeat*.10:0);
  motion.sparks.visible=sparkPower>.002;
  motion.sparks.material.opacity=.94*Math.min(1,sparkPower);
  for (const sprite of motion.steam) {
    const { origin, phase, log } = sprite.userData.steam;
    const age = fract(phase + time * .27);
    sprite.position.copy(origin);
    sprite.position.x += Math.sin(age * 7 + log - time * .3) * .12 * age;
    sprite.position.y += .1 + age * .95;
    sprite.position.z += Math.cos(age * 5 + log) * .06 * age;
    sprite.scale.setScalar(.09 + age * .39);
    sprite.material.opacity = fade(age) * (1 - age * .5) * .21;
    if(cycle){const fuel=cycle.logs[log];sprite.material.opacity*=fuel.phase==='queued'?0:Math.min(1,fuel.moisture*10)*fuel.temperature;}
    sprite.material.rotation = age * 3 + log + time * .12;
  }
  const positions = motion.sparks.geometry.attributes.position;
  const colors = motion.sparks.geometry.attributes.color;
  for (let i = 0; i < positions.count; i++) {
    const offset = i * 3, origin = motion.sparkOrigins;
    const age = fract(origin[offset + 1] / 5.3 + time * driftSpeed / (4.7 + i % 9 * .24));
    const y = .25 + age * 5.2;
    positions.array[offset] = origin[offset] * .52 + age * age * .48 + Math.sin(age * 8 + i * 2) * age * .17;
    positions.array[offset + 1] = y;
    positions.array[offset + 2] = origin[offset + 2] * .55 + Math.cos(age * 7 + i) * age * .19;
    const brightness = fade(age) * (.83 + Math.sin(time * 4 + i) * .17) * (firePower + (cycle?.coalMass > .005 ? coalHeat * .10 : 0));
    for (let channel = 0; channel < 3; channel++) colors.array[offset + channel] = motion.sparkColors[offset + channel] * brightness;
  }
  positions.needsUpdate = true;colors.needsUpdate = true;
  // Bounds include every point's lifetime, avoiding culling as particles recycle.
  motion.sparks.frustumCulled = false;
  for (const streak of motion.streaks) {
    const { y, phase, index } = streak.userData.streak;
    const age = fract(phase + time * driftSpeed / (3.4 + index % 7 * .3));
    streak.position.set(age * age * .42 + Math.sin(age * 7 + index) * age * .15, .5 + age * 4.6 - y, Math.cos(age * 5 + index) * age * .12);
    streak.material.opacity = fade(age) * .66 * firePower;
  }
  // Low-amplitude light variation keeps the material detail readable.
  motion.lights.forEach(({ light, intensity }, index) => {
    light.intensity = intensity * (1 + Math.sin(time * 6.2 + index * 2) * .065 + Math.sin(time * 10.7 + 1.3) * .035 + impact * .32) * (index===0 ? firePower : coalHeat);
  });
  motion.coalMaterial.emissiveIntensity = motion.coalEmission * (1 + Math.sin(time * 2.3) * .065) * coalHeat * 1.7;
  if(motion.coalMaterial.userData.time){
    motion.coalMaterial.userData.time.value=time;
    motion.coalMaterial.userData.heat.value=coalHeat;
    motion.coalMaterial.userData.impact.value=impact;
  }
  if(cycle)motion.coalMaterial.userData.bedAsh.value=Math.min(1,cycle.ashMass/(cycle.coalMass+cycle.ashMass+.001))*(1-coalHeat*.7);
  motion.barkMaterial.emissiveIntensity = motion.barkEmission * (1 + Math.sin(time * 3.1 + .8) * .045);
  if(cycle)for(const item of study.layers.sparks.children)if(item.isMesh)item.visible=cycle.time<600&&firePower>.04;
}
