import * as THREE from 'three';
import { random } from './textures.js';
import { createLogSettling, updateLogSettling } from './log-settling.js';

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
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(320 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  emberGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(320 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  emberGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(320), 1).setUsage(THREE.DynamicDrawUsage));
  const emberMaterial = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute float aSize;varying vec3 vColor;
      void main(){vColor=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*680./max(.2,-p.z),0.,18.);}`,
    fragmentShader: `varying vec3 vColor;
      void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;float glow=exp(-r*r*5.);float core=1.-smoothstep(.05,.48,r);gl_FragColor=vec4(vColor*(glow*.55+core),glow);}`,
  });
  const impactEmbers = new THREE.Points(emberGeometry, emberMaterial); impactEmbers.frustumCulled = false;
  study.layers.sparks.add(impactEmbers);
  return { ash, ashSeeds, flakes, particles, impactEmbers, embers: [], emberCursor: 0,
    coalMatrices: study.coals.instanceMatrix.array.slice(), cursor: 0, lastShed: Array(7).fill(0), seed: null, rand, lastGeometry: -1,
    settling: null, impactEvents: [], impactSerial: 0, resetToken: null, impactPulse: 0 };
}

function emitImpact(view, impact, time, cycle) {
  const event = { id: ++view.impactSerial, time, strength: impact.strength, position: impact.position.clone() };
  view.impactEvents.push(event);
  if (view.impactEvents.length > 16) view.impactEvents.shift();
  // Cold wood still lands, but only a hot bed throws incandescent embers.
  const heat = Math.max(impact.heat, cycle.coalHeat);
  if (heat < .12) return;
  const count = Math.round((22 + impact.strength * 82) * Math.min(1, heat * 1.5));
  for (let i = 0; i < count; i++) {
    const angle = view.rand() * Math.PI * 2, spread = view.rand() * .28;
    const index = view.emberCursor++ % 320;
    view.embers = view.embers.filter(ember => ember.index !== index);
    view.embers.push({ index, start: time, life: 1.3 + view.rand() * 2.1, size: .023 + view.rand() * .042,
      origin: impact.position.clone().add(new THREE.Vector3(Math.cos(angle) * spread, .04 + view.rand() * .08, Math.sin(angle) * spread)),
      velocity: new THREE.Vector3(Math.cos(angle) * (.3 + view.rand() * 1.25), .8 + view.rand() * (1.2 + impact.strength * 2.2), Math.sin(angle) * (.3 + view.rand() * 1.25)),
      heat: .65 + view.rand() * .35 });
  }
}

function updateImpactEmbers(view, time) {
  const geometry = view.impactEmbers.geometry, positions = geometry.attributes.position, colors = geometry.attributes.color, sizes = geometry.attributes.aSize;
  sizes.array.fill(0); colors.array.fill(0);
  view.embers = view.embers.filter(ember => time - ember.start < ember.life);
  for (const ember of view.embers) {
    const age = time - ember.start, progress = age / ember.life, drag = (1 - Math.exp(-age * .65)) / .65;
    positions.setXYZ(ember.index, ember.origin.x + ember.velocity.x * drag + Math.sin(age * 8 + ember.index) * age * .035,
      ember.origin.y + ember.velocity.y * drag - age * age * .19,
      ember.origin.z + ember.velocity.z * drag + Math.cos(age * 6 + ember.index) * age * .025);
    const fade = Math.min(1, age * 25 + .18) * Math.pow(1 - progress, 1.25);
    sizes.setX(ember.index, ember.size * (.55 + .45 * fade));
    colors.setXYZ(ember.index, (3.2 + ember.heat * 2) * fade, (.45 + ember.heat * .8) * fade * (1 - progress * .8), .045 * fade * (1 - progress));
  }
  positions.needsUpdate = true; colors.needsUpdate = true; sizes.needsUpdate = true;
  view.impactEmbers.visible = view.embers.length > 0;
  view.impactPulse = view.impactEvents.reduce((pulse, impact) => Math.max(pulse, impact.strength * Math.exp(-(time - impact.time) * 4.8)), 0);
}

export function updateBurnVisuals(study, force = false) {
  const cycle = study.cycle, view = study.burnVisuals, t = study.animationTime;
  if (!cycle || !view) return false;
  const groundHeight = study.groundHeight || (() => 0);
  const resetToken = `${cycle.seed}:${cycle.resetSerial}`;
  if (view.resetToken !== resetToken) {
    view.resetToken = resetToken; view.seed = cycle.seed; view.particles.length = 0; view.embers.length = 0;
    view.impactEvents.length = 0; view.impactPulse = 0; view.lastShed = cycle.logs.map(log => log.shed); view.lastGeometry = -1;
    view.settling = createLogSettling(study.logDefs, cycle.seed);
  }
  const updateAsh = force || t - view.lastGeometry > 1 / 15;
  if (updateAsh) view.lastGeometry = t;
  const fire = study.volumes.find(volume => volume.material.uniforms.uSources);
  const fu = fire.material.uniforms;
  fu.uIntensity.value = clamp(cycle.flame / 3.8, 0, 1);
  for (const volume of study.volumes) if (volume.material.uniforms.uSmokeAmount) volume.material.uniforms.uSmokeAmount.value = cycle.smoke;
  study.layers.flames.children.forEach(mesh => {
    const slot = mesh.userData.logSlot;
    if (slot !== undefined) mesh.visible = cycle.logs[slot].flame > .035 && cycle.logs[slot].phase !== 'queued';
    if (mesh.userData.twigFlame) mesh.visible = cycle.time < 420 && cycle.flame > .15;
    if (mesh.material?.uniforms?.uLife) mesh.material.uniforms.uLife.value = slot !== undefined ? cycle.logs[slot].flame : Math.min(1, cycle.flame);
  });
  updateLogSettling(view.settling, cycle, t, groundHeight);
  for (const impact of view.settling.impacts) emitImpact(view, impact, t, cycle);
  for (let i = 0; i < cycle.logs.length; i++) {
    const log = cycle.logs[i], mesh = study.logMeshes[i], def = study.logDefs[i], pose = view.settling.logs[i];
    if (mesh.userData.fuelId !== log.id) { mesh.userData.fuelId = log.id; view.lastShed[i] = log.shed; }
    const live = pose.live, mass = log.wood + log.char * 1.4, radiusScale = pose.radius / def[2];
    mesh.visible = live;
    axis.subVectors(pose.b, pose.a); center.copy(pose.a).lerp(pose.b, .5);
    mesh.position.copy(center); mesh.quaternion.setFromUnitVectors(up, axis.clone().normalize());
    mesh.scale.set(radiusScale, pose.length / mesh.userData.length, radiusScale);
    const u = mesh.userData.burnUniforms;
    u.uWood.value = log.wood; u.uChar.value = log.char; u.uHeat.value = log.phase === 'queued' ? 0 : log.temperature;
    mesh.userData.charChips.visible = log.wood < .84;
    mesh.updateMatrixWorld();
    // Derive every gas root from the transformed, shortened cylinder itself.
    const a = new THREE.Vector3(0, -mesh.userData.length * .5, 0).applyMatrix4(mesh.matrixWorld);
    const b = new THREE.Vector3(0, mesh.userData.length * .5, 0).applyMatrix4(mesh.matrixWorld);
    for (const ribbon of study.layers.flames.children) if (ribbon.userData.logSlot === i) {
      ribbon.matrixAutoUpdate = false; ribbon.matrix.copy(mesh.matrixWorld).multiply(mesh.userData.baseInverse); ribbon.matrixWorldNeedsUpdate = true;
    }
    fu.uLogA.value[i].set(a.x, a.y, a.z, pose.radius);
    fu.uLogB.value[i].set(b.x, b.y, b.z, pose.radius * .88);
    fu.uLogHeat.value[i] = live ? log.flame : 0;
    for (let j = i; j < 12; j += 7) {
      const original = study.flameSources[j], along = j < 7 ? .50 : .28, root = a.clone().lerp(b, along);
      const strength = live ? log.flame : 0;
      const height = original.w * (.14 + .86 * Math.sqrt(strength)) * (.5 + .5 * Math.sqrt(Math.min(1, mass)));
      const rootY = root.y + pose.radius * .45;
      fu.uSources.value[j].set(root.x, rootY, root.z, Math.min(height, 4.45 - rootY)); fu.uFuel.value[j] = strength;
    }
    for (const sprite of study.motion.steam) if (sprite.userData.steam.log === i) sprite.userData.steam.origin.copy(a);
    if (updateAsh) {
      const ashAmount = Math.max(cycle.ashDeposits[i], log.phase === 'queued' ? 0 : log.phase === 'ash' ? 1 : clamp((1 - log.wood - log.char) * .88, 0, 1));
      for (let j = 0; j < 90; j++) {
        const index = i * 90 + j, [along, side, sz, spin] = view.ashSeeds[index];
        obj.position.copy(a).lerp(b, along); obj.position.x += side * .5; obj.position.z += Math.sin(spin * 20) * .19;
        obj.position.y = groundHeight(obj.position.x, obj.position.z) + .012 + spin * .018;
        obj.rotation.set(spin * 3, spin * 5, spin);
        obj.scale.set(sz * 1.9, sz * .32, sz * 1.7).multiplyScalar(ashAmount > j / 90 ? 1 : 0);
        obj.updateMatrix(); view.ash.setMatrixAt(index, obj.matrix);
      }
    }
    if (log.shed - view.lastShed[i] > .001 && live) {
      view.lastShed[i] = log.shed;
      for (let k = 0; k < 2; k++) {
        const p = { index: view.cursor++ % 80, start: t, origin: a.clone().lerp(b, view.rand()), drift: (view.rand() - .5) * .7, size: .025 + view.rand() * .035 };
        p.origin.y += pose.radius; view.particles = view.particles.filter(old => old.index !== p.index); view.particles.push(p);
      }
    }
  }
  if (updateAsh) view.ash.instanceMatrix.needsUpdate = true;
  const coalScale = .28 + .72 * Math.sqrt(Math.min(1, cycle.coalMass / .5));
  for (let i = 0; i < study.coals.count; i++) {
    const offset = i * 16;
    for (let j = 0; j < 16; j++) study.coals.instanceMatrix.array[offset + j] = view.coalMatrices[offset + j] * (j < 12 ? coalScale : 1);
    const ground = groundHeight(view.coalMatrices[offset + 12], view.coalMatrices[offset + 14]);
    study.coals.instanceMatrix.array[offset + 13] = ground + (view.coalMatrices[offset + 13] - ground) * coalScale;
  }
  study.coals.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < 80; i++) { obj.scale.setScalar(0); obj.updateMatrix(); view.flakes.setMatrixAt(i, obj.matrix); }
  for (const p of view.particles) {
    const age = t - p.start;
    obj.position.set(p.origin.x + p.drift * Math.min(age, .8), p.origin.y - age * age * 1.8, p.origin.z + Math.sin(p.index) * Math.min(age, .8) * .22);
    obj.position.y = Math.max(groundHeight(obj.position.x, obj.position.z) + .016, obj.position.y);
    obj.rotation.set(age * 2, age * 4 + p.index, age); obj.scale.set(p.size, p.size * .4, p.size * 1.5).multiplyScalar(Math.max(0, 1 - Math.max(0, age - 1.6) / 1.2));
    obj.updateMatrix(); view.flakes.setMatrixAt(p.index, obj.matrix);
    color.set('#d0b8a0').multiplyScalar(Math.max(.18, 2.4 - age * 1.6)); view.flakes.setColorAt(p.index, color);
  }
  view.particles = view.particles.filter(p => t - p.start < 2.8);
  view.flakes.instanceMatrix.needsUpdate = true; view.flakes.instanceColor.needsUpdate = true;
  updateImpactEmbers(view, t);
  const twigScale = Math.max(0, 1 - cycle.time / 600); study.twigs.scale.y = twigScale; study.twigs.visible = twigScale > .015;
  for (const flame of study.layers.flames.children) if (flame.userData.twigFlame) {
    flame.position.copy(study.twigs.position); flame.scale.copy(study.twigs.scale);
  }
  for (const spark of study.layers.sparks.children) if (spark.userData.twigGlowOrigin) {
    spark.position.copy(spark.userData.twigGlowOrigin).multiply(study.twigs.scale).add(study.twigs.position);
    spark.scale.y = 2.2 * twigScale;
  }
  study.ashBed.material.color.set('#dbd5c7').multiplyScalar(.7 + Math.min(.3, cycle.ashMass * .12));
  return true;
}
