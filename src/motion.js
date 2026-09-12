// Gas motion uses real seconds; the separate burn clock controls the fuel and heat.
// Embers and steam are computed on the GPU from time, so this only forwards
// the slow-changing state they depend on (fire power, heat, per-log steam).

export function createMotionState(layers, { embers, steam, twigInstances, lights, coalMaterial, barkMaterial }) {
  const uniforms = new Set();
  for (const group of Object.values(layers)) group.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material?.uniforms?.uTime) uniforms.add(material.uniforms.uTime);
  });
  return {
    uniforms: [...uniforms], embers, steam, twigInstances,
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
  const cycle = study.cycle;
  const firePower = cycle ? Math.min(1, cycle.flame / 3.2) : 1;
  const coalHeat = cycle ? cycle.coalHeat : 1;
  const impact = study.burnVisuals?.impactPulse || 0;
  for (const volume of study.volumes) if (volume.material.uniforms.uImpact) volume.material.uniforms.uImpact.value = impact;
  if (motion.embers) {
    const u = motion.embers.uniforms;
    u.uPower.value = firePower; u.uCoalHeat.value = cycle?.coalMass > .005 ? coalHeat : 0; u.uImpact.value = impact;
    motion.embers.visible = firePower > .002 || (cycle?.coalMass > .005 && coalHeat > .12);
  }
  if (motion.steam && cycle) for (let i = 0; i < motion.steam.logs; i++) {
    const fuel = cycle.logs[i];
    motion.steam.setStrength(i, !fuel || fuel.phase === 'queued' || fuel.phase === 'ash' ? 0 : Math.min(1, fuel.moisture * 10) * fuel.temperature);
  }
  // Low-amplitude light variation keeps the material detail readable.
  motion.lights.forEach(({ light, intensity }, index) => {
    light.intensity = intensity * (1 + Math.sin(time * 6.2 + index * 2) * .065 + Math.sin(time * 10.7 + 1.3) * .035 + impact * .32) * (index === 0 ? firePower : coalHeat);
  });
  motion.coalMaterial.emissiveIntensity = motion.coalEmission;
  if (motion.coalMaterial.userData.time) {
    motion.coalMaterial.userData.time.value = time;
    motion.coalMaterial.userData.heat.value = coalHeat;
    motion.coalMaterial.userData.impact.value = impact;
  }
  if (cycle) motion.coalMaterial.userData.bedAsh.value = Math.min(1, cycle.ashMass / (cycle.coalMass + cycle.ashMass + .001)) * (1 - coalHeat * .7);
  motion.barkMaterial.emissiveIntensity = motion.barkEmission * (1 + Math.sin(time * 3.1 + .8) * .045);
  if (cycle && motion.twigInstances?.glowMesh) motion.twigInstances.glowMesh.visible = cycle.time < 600 && firePower > .04;
}
