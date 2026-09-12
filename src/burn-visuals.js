import * as THREE from 'three';
import { random } from './textures.js';

const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), center = new THREE.Vector3();
const obj = new THREE.Object3D(), color = new THREE.Color();
const clamp = THREE.MathUtils.clamp;

export function burningMaterial(base, uniforms, cap = false) {
  const material = base.clone();
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vBurnPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurnPosition=position;');
    shader.fragmentShader = `varying vec3 vBurnPosition;uniform float uWood,uHeat,uChar;
      float burnHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float burnNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(burnHash(i),burnHash(i+vec2(1,0)),f.x),mix(burnHash(i+vec2(0,1)),burnHash(i+vec2(1)),f.x),f.y);}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float angle=atan(vBurnPosition.z,vBurnPosition.x);
      float grain=burnNoise(vec2(angle*19.,vBurnPosition.y*3.5));
      float fineGrain=sin(angle*53.+sin(vBurnPosition.y*12.)*.6)*.06;
      float charFront=clamp((1.-uWood)*1.8,0.,1.);
      float burnMask=smoothstep(grain*.6,grain*.6+.28,charFront);
      vec3 fresh=${cap ? 'diffuseColor.rgb*1.4' : 'mix(vec3(.105,.065,.033),vec3(.38,.27,.15),grain+fineGrain)'};
      diffuseColor.rgb=mix(fresh,diffuseColor.rgb*(.22+uWood*.55),burnMask);
      float ashDust=(1.-smoothstep(0.,.055,uWood))*(1.-smoothstep(0.,.10,uChar));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.29,.275,.24),ashDust*.65);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=uHeat*(.08+burnMask*2.5);');
  };
  material.customProgramCacheKey = () => `burn-log-${cap ? 'end' : 'bark'}-1`;
  return material;
}

export function createBurnVisuals(study) {
  const rand = random(4408), particles = [];
  const ash = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#b1ab9b', roughness: 1, flatShading: true }), 7 * 90);
  ash.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ash.receiveShadow = true; ash.frustumCulled = false;
  const ashSeeds = Array.from({ length: 7 * 90 }, () => [rand(), rand() - .5, .02 + rand() * .05, rand()]);
  const flakes = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#555048', emissive: '#ff4008', emissiveIntensity: .9, roughness: 1, flatShading: true }), 80);
  flakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); flakes.frustumCulled = false;
  for (let i = 0; i < 80; i++) { obj.scale.setScalar(0); obj.updateMatrix(); flakes.setMatrixAt(i, obj.matrix); flakes.setColorAt(i, new THREE.Color('#777269')); }
  study.opaque.add(ash, flakes);
  return { ash, ashSeeds, flakes, particles, coalMatrices:study.coals.instanceMatrix.array.slice(), cursor: 0, lastShed: Array(7).fill(0), seed: null, rand, lastGeometry: -1 };
}

export function updateBurnVisuals(study, force = false) {
  const cycle = study.cycle, view = study.burnVisuals, t = study.animationTime;
  if (!cycle || !view) return false;
  if (view.seed !== cycle.seed) {
    view.seed = cycle.seed; view.particles.length = 0; view.lastShed = cycle.logs.map(l => l.shed); view.lastGeometry = -1;
    study.logMeshes.forEach(log => { log.userData.arrived = -1; });
  }
  // Update opaque geometry at 15 Hz; gas motion continues at the full frame rate.
  const geometryChanged = force || t - view.lastGeometry > 1 / 15;
  const fire = study.volumes.find(v => v.material.uniforms.uSources);
  const fu = fire.material.uniforms;
  const ratio = clamp(cycle.flame / 3.8, 0, 1);
  fu.uIntensity.value = ratio;
  for (const volume of study.volumes) if (volume.material.uniforms.uSmokeAmount) volume.material.uniforms.uSmokeAmount.value = cycle.smoke;
  study.layers.flames.children.forEach(mesh => {
    const slot = mesh.userData.logSlot;
    if (slot !== undefined) mesh.visible = cycle.logs[slot].flame > .035 && cycle.logs[slot].phase !== 'queued';
    if (mesh.userData.twigFlame) mesh.visible = cycle.time < 420 && cycle.flame > .15;
    if (mesh.material?.uniforms?.uLife) mesh.material.uniforms.uLife.value = slot !== undefined ? cycle.logs[slot].flame : Math.min(1, cycle.flame);
  });
  if (!geometryChanged) return false;
  view.lastGeometry = t;
  for (let i = 0; i < 7; i++) {
    const log = cycle.logs[i], mesh = study.logMeshes[i], def = study.logDefs[i];
    if(mesh.userData.fuelId!==log.id){mesh.userData.fuelId=log.id;view.lastShed[i]=log.shed;}
    const a = new THREE.Vector3(...def[0]), b = new THREE.Vector3(...def[1]);
    a.applyAxisAngle(up, log.angle); b.applyAxisAngle(up, log.angle); a.x += log.offset; b.x += log.offset;
    const live = log.phase !== 'queued' && log.phase !== 'ash'; mesh.visible = live;
    const arriving = log.addedAt !== null && log.addedAt >= 0;
    if (arriving && mesh.userData.arrived !== log.id) { mesh.userData.arrived = log.id; mesh.userData.dropAt = t; }
    const dropDuration=Math.max(.10,.7/Math.sqrt(study.burnSpeed||1));
    const fall = arriving ? Math.max(0, 1 - (t - mesh.userData.dropAt) / dropDuration) ** 2 * .8 : 0;
    const mass = log.wood + log.char * 1.4;
    const radiusScale = Math.max(.055, Math.sqrt(mass)) * log.scale;
    const collapse = (1 - Math.min(1, radiusScale)) * .8;
    a.y = .13 + (a.y - .13) * (1 - collapse) + fall;
    b.y = .13 + (b.y - .13) * (1 - collapse) + fall;
    axis.subVectors(b, a); center.copy(a).lerp(b, .5);
    mesh.position.copy(center); mesh.quaternion.setFromUnitVectors(up, axis.clone().normalize());
    mesh.scale.set(radiusScale, axis.length() / mesh.userData.length * log.scale, radiusScale);
    const u = mesh.userData.burnUniforms;
    u.uWood.value = log.wood; u.uChar.value = log.char; u.uHeat.value = log.phase === 'queued' ? 0 : log.temperature;
    mesh.userData.charChips.visible = log.wood < .84;
    mesh.updateMatrixWorld();
    for(const ribbon of study.layers.flames.children)if(ribbon.userData.logSlot===i){
      ribbon.matrixAutoUpdate=false;ribbon.matrix.copy(mesh.matrixWorld).multiply(mesh.userData.baseInverse);ribbon.matrixWorldNeedsUpdate=true;
    }
    fu.uLogA.value[i].set(a.x, a.y, a.z, def[2] * radiusScale);
    fu.uLogB.value[i].set(b.x, b.y, b.z, def[2] * radiusScale * .9);
    fu.uLogHeat.value[i] = live && fall < .02 ? log.flame : 0;
    // Each tongue has a fuel owner; unlit or consumed logs cannot sustain floating fire.
    for (let j = i; j < 12; j += 7) {
      const original = study.flameSources[j], along = j < 7 ? .50 : .28;
      const root = a.clone().lerp(b, along);
      const strength = live && fall < .02 ? log.flame : 0;
      const height = original.w * (.14 + .86 * Math.sqrt(strength)) * (.5 + .5 * Math.sqrt(Math.min(1, mass)));
      const rootY=root.y+def[2]*radiusScale*.45;
      fu.uSources.value[j].set(root.x, rootY, root.z, Math.min(height,4.45-rootY));
      fu.uFuel.value[j] = strength;
    }
    for (const sprite of study.motion.steam) if (sprite.userData.steam.log === i) sprite.userData.steam.origin.copy(a);
    const ashAmount = Math.max(cycle.ashDeposits[i], log.phase === 'queued' ? 0 : log.phase === 'ash' ? 1 : clamp((1 - log.wood - log.char) * .88, 0, 1));
    for (let j = 0; j < 90; j++) {
      const index = i * 90 + j, [along, side, sz, spin] = view.ashSeeds[index];
      obj.position.copy(a).lerp(b, along); obj.position.y = -.002 + spin * .018;
      obj.position.x += side * .5; obj.position.z += Math.sin(spin * 20) * .19;
      obj.rotation.set(spin * 3, spin * 5, spin);
      obj.scale.set(sz * 1.9, sz * .32, sz * 1.7).multiplyScalar(ashAmount > j / 90 ? 1 : 0);
      obj.updateMatrix(); view.ash.setMatrixAt(index, obj.matrix);
    }
    if (log.shed - view.lastShed[i] > .001 && live) {
      view.lastShed[i] = log.shed;
      for (let k = 0; k < 2; k++) {
        const p = { index: view.cursor++ % 80, start: t, origin: a.clone().lerp(b, view.rand()), drift: (view.rand() - .5) * .7, size: .025 + view.rand() * .035 };
        p.origin.y += def[2] * radiusScale; view.particles = view.particles.filter(old => old.index !== p.index); view.particles.push(p);
      }
    }
  }
  view.ash.instanceMatrix.needsUpdate = true;
  const coalScale=.28+.72*Math.sqrt(Math.min(1,cycle.coalMass/.5));
  for(let i=0;i<study.coals.count;i++)for(let j=0;j<16;j++){
    const index=i*16+j;
    study.coals.instanceMatrix.array[index]=view.coalMatrices[index]*(j<12||j===13?coalScale:1);
  }
  study.coals.instanceMatrix.needsUpdate=true;
  for (let i = 0; i < 80; i++) { obj.scale.setScalar(0); obj.updateMatrix(); view.flakes.setMatrixAt(i, obj.matrix); }
  for (const p of view.particles) {
    const age = t - p.start, y = Math.max(.01, p.origin.y - age * age * 1.8);
    obj.position.set(p.origin.x + p.drift * Math.min(age, .8), y, p.origin.z + Math.sin(p.index) * Math.min(age, .8) * .22);
    obj.rotation.set(age * 2, age * 4 + p.index, age); obj.scale.set(p.size, p.size * .4, p.size * 1.5).multiplyScalar(Math.max(0, 1 - Math.max(0, age - 1.6) / 1.2));
    obj.updateMatrix(); view.flakes.setMatrixAt(p.index, obj.matrix);
    color.set('#d0b8a0').multiplyScalar(Math.max(.18, 2.4 - age * 1.6)); view.flakes.setColorAt(p.index, color);
  }
  view.particles = view.particles.filter(p => t - p.start < 2.8);
  view.flakes.instanceMatrix.needsUpdate = true; view.flakes.instanceColor.needsUpdate = true;
  const twigScale = Math.max(0, 1 - cycle.time / 600); study.twigs.scale.y = twigScale; study.twigs.visible = twigScale > .015;
  study.ashBed.material.color.set('#dbd5c7').multiplyScalar(.7 + Math.min(.3, cycle.ashMass * .12));
  return true;
}
