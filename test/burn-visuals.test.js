import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BurnCycle } from '../src/lifecycle.js';
import { createBurnVisuals, updateBurnVisuals } from '../src/burn-visuals.js';
import { createSceneFuelMesh, disposeFuelMesh } from '../src/fuel-mesh.js';
import { applyLogFracture } from '../src/log-damage.js';
import { sampleLogSurface } from '../src/log-combustion.js';
import { createHybridFire } from '../src/hybrid-fire.js';

const near = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance,`${a} ≈ ${b}`);
const sourceMaterials = () => Object.fromEntries(['barkMat','endMat','exposedMat'].map(key=>[key,new THREE.MeshStandardMaterial({color:'#60432a',roughness:1})]));

function visualStudy() {
  const cycle = new BurnCycle(42); cycle.setAutoFeed(false);
  cycle.logs.forEach((fuel,i)=>Object.assign(fuel,{fuelType:'log',scale:1,angle:0,offset:0,phase:i===0?'burning':'queued',
    wood:i===0?.55:1,char:i===0?.14:0,temperature:i===0?.9:.025,flame:i===0?.8:0,shed:0,addedAt:i===0?-100:null}));
  cycle.updateSummary();
  const logDefs = Array.from({length:7},(_,i)=>[[-1,.2,i*2.5],[1,.2,i*2.5],.2]);
  const materials = sourceMaterials(), opaque = new THREE.Group();
  const build = fuel => createSceneFuelMesh({definition:logDefs[fuel.slot],fuelType:fuel.fuelType,seed:cycle.seed+fuel.id*7919,mode:0,hybrid:true},materials);
  const logMeshes = cycle.logs.map(build); logMeshes.forEach(mesh=>opaque.add(mesh));
  const fire = createHybridFire({seed:22,fireVariant:1},new THREE.DepthTexture(1,1),logDefs);
  const coals = new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),1);
  coals.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,.03,0));
  const study={cycle,animationTime:0,logDefs,logMeshes,opaque,volumes:[fire],groundHeight:()=>0,
    layers:{flames:new THREE.Group(),sparks:new THREE.Group()},coals,motion:{steam:[]},twigs:new THREE.Group(),
    ashBed:new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial()),
    flameSources:fire.material.uniforms.uSources.value.map(source=>source.clone())};
  const keys = new Map();
  study.syncFuelMeshes=()=>{
    let changed=false;
    for(const fuel of cycle.logs){
      const key=`${cycle.seed}:${cycle.resetSerial}:${fuel.id}:${fuel.fuelType}`;
      if(keys.get(fuel.slot)===key)continue;
      if(keys.has(fuel.slot)){disposeFuelMesh(logMeshes[fuel.slot]);logMeshes[fuel.slot]=build(fuel);opaque.add(logMeshes[fuel.slot]);}
      keys.set(fuel.slot,key);changed=true;
    }
    return changed;
  };
  study.burnVisuals=createBurnVisuals(study); updateBurnVisuals(study,true);
  return study;
}

function materialsOf(mesh) {
  const materials=new Set();
  mesh.traverse(part=>{for(const material of Array.isArray(part.material)?part.material:[part.material])if(material)materials.add(material);});
  return [...materials];
}

function fragmentFor(study,index=0) {
  const clone=value=>value?.clone?value.clone():Array.isArray(value)?value.map(clone):value;
  const fragment=Object.fromEntries(Object.entries(study.burnVisuals.settling.logs[0]).map(([key,value])=>[key,clone(value)]));
  return Object.assign(fragment,{id:`char-test-${index}`,fragment:true,born:0,heat:.8,radius:.05,length:.11,
    x:index*.1,y:.1,z:0,position:new THREE.Vector3(index*.1,.1,0),quaternion:new THREE.Quaternion(),
    initialChar:.02,remainingChar:.02,thermalAge:0,fragmentRadius:.05,fragmentLength:.11});
}

function assertFiniteUniforms(uniforms) {
  const check=(value,name)=>{
    if(typeof value==='number'){assert.ok(Number.isFinite(value),`${name} must be finite, received ${value}`);return;}
    if(value===null || value===undefined)return;
    if(value.isTexture){if(value.image?.data)check(value.image.data,`${name}.pixels`);return;}
    if(Array.isArray(value) || ArrayBuffer.isView(value)){for(let i=0;i<value.length;i++)check(value[i],`${name}[${i}]`);return;}
    if(value.toArray)check(value.toArray(),name);
  };
  for(const [name,uniform] of Object.entries(uniforms))check(uniform.value,name);
}

test('the actual hybrid fire receives finite uniforms for fresh, queued, mature, ash and flame-free fuel', () => {
  const study=visualStudy(),fire=study.volumes[0],u=fire.material.uniforms;
  for(const state of [
    {phase:'fresh',wood:1,char:0,temperature:.025,flame:0,addedAt:0},
    {phase:'queued',wood:1,char:0,temperature:.025,flame:0,addedAt:null},
    {phase:'burning',wood:.5,char:.15,temperature:.9,flame:.8,addedAt:-100},
    {phase:'glowing',wood:0,char:.15,temperature:.9,flame:0,addedAt:-100},
    {phase:'ash',wood:0,char:0,temperature:.025,flame:0,addedAt:-100},
  ]){
    for(const log of study.cycle.logs)Object.assign(log,state);
    study.cycle.updateSummary();updateBurnVisuals(study);fire.onBeforeRender();
    assertFiniteUniforms(u);for(const mesh of study.logMeshes)assertFiniteUniforms(mesh.userData.burnUniforms);
    assert.ok(u.uFreshFuel.value>=0 && u.uFreshFuel.value<=1);assert.ok(u.uIntensity.value>=0 && u.uIntensity.value<=1);
    if(!state.flame){assert.equal(u.uFreshFuel.value,0);assert.equal(u.uIntensity.value,0);assert.ok(u.uFuel.value.every(value=>value===0));}
  }
});

test('bark, exposed wood, caps and chips share the live atlas through their actual material uniforms', () => {
  const study=visualStudy(),atlas=study.burnVisuals.burnMap;
  assert.equal(atlas.image.width,8);assert.equal(atlas.image.height,35);
  assert.equal(atlas.wrapS,THREE.RepeatWrapping);
  const gas=study.volumes[0].material.uniforms;
  assert.equal(gas.uBurnMap.value,atlas);assert.equal(gas.uLocalizedBurn.value,1);
  for(let slot=0;slot<7;slot++){
    const mesh=study.logMeshes[slot],u=mesh.userData.burnUniforms,patches=study.cycle.logs[slot].surface.patches;
    assert.equal(u.uBurnMap.value,atlas);assert.equal(u.uBurnSlot.value,slot);near(u.uBurnLength.value,mesh.userData.length);
    for(const material of materialsOf(mesh)){
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.uBurnMap,u.uBurnMap);assert.equal(shader.uniforms.uBurnSlot,u.uBurnSlot);
      assert.ok(shader.fragmentShader.includes('texture2D(uBurnMap'),'material actually samples localized thermal state');
    }
    for(let axial=0;axial<5;axial++)for(let side=0;side<8;side++){
      const patch=patches[axial*8+side],offset=((slot*5+axial)*8+side)*4;
      near(atlas.image.data[offset],slot===0?patch.temperature:0);near(atlas.image.data[offset+1],patch.wood);
      near(atlas.image.data[offset+2],patch.char);near(atlas.image.data[offset+3],slot===0?patch.flame:0);
    }
  }
});

test('a rolled material keeps its patch atlas while gas sampling and world bases follow the quaternion', () => {
  const study=visualStudy(),view=study.burnVisuals,pose=view.settling.logs[0],mesh=study.logMeshes[0],log=study.cycle.logs[0];
  const atlas=view.burnMap.image.data.slice(),orientation=mesh.quaternion.clone();
  pose.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
  updateBurnVisuals(study);
  assert.ok(mesh.quaternion.angleTo(orientation)>3);assert.deepEqual(view.burnMap.image.data,atlas);
  const gas=study.volumes[0].material.uniforms;
  assert.ok(gas.uLogBasisX.value[0].distanceTo(new THREE.Vector3(1,0,0).applyQuaternion(mesh.quaternion))<1e-9);
  assert.ok(gas.uLogBasisZ.value[0].distanceTo(new THREE.Vector3(0,0,1).applyQuaternion(mesh.quaternion))<1e-9);
  const localUp=new THREE.Vector3(0,1,0).applyQuaternion(mesh.quaternion.clone().invert());
  const expected=sampleLogSurface(log,.5,Math.atan2(localUp.z,localUp.x)).flame;
  near(gas.uFuel.value[0],expected);
  assert.ok(study.cycle.logPoses[0].x.every((value,i)=>Math.abs(value-gas.uLogBasisX.value[0].getComponent(i))<1e-9));
});

test('replacing a fractured ash slot rebuilds intact fuel and clears the old heat, char and flame roots', () => {
  const study=visualStudy(),old=study.logMeshes[0],view=study.burnVisuals;
  applyLogFracture(old,{t:.5,angle:0,severity:.55});
  let disposed=0;old.geometry.addEventListener('dispose',()=>disposed++);
  const replacement=study.cycle.makeLog(0,false,'plank');replacement.phase='fresh';replacement.addedAt=study.cycle.time;
  study.cycle.logs[0]=replacement;study.cycle.updateSummary();
  updateBurnVisuals(study);
  const mesh=study.logMeshes[0],gas=study.volumes[0].material.uniforms;
  assert.notEqual(mesh,old);assert.equal(disposed,1);assert.equal(old.parent,null);
  assert.equal(mesh.userData.fuelId,replacement.id);assert.equal(mesh.userData.fuelType,'plank');
  assert.equal(mesh.userData.fractureSeverity,undefined);assert.equal(mesh.geometry.userData.intactPositions,undefined);
  assert.equal(view.settling.logs[0].id,replacement.id);assert.equal(view.settling.logs[0].fracture,null);
  assert.equal(view.lastShed[0],replacement.shed);assert.equal(mesh.userData.charChips.visible,false);
  for(let patch=0;patch<40;patch++){
    const offset=patch*4;near(view.burnMap.image.data[offset],replacement.temperature);
    assert.equal(view.burnMap.image.data[offset+1],1);assert.equal(view.burnMap.image.data[offset+2],0);assert.equal(view.burnMap.image.data[offset+3],0);
  }
  assert.equal(gas.uLogHeat.value[0],0);assert.equal(gas.uFuel.value[0],0);assert.equal(gas.uFuel.value[7],0);
});

test('repeated updates at paused time keep geometry, material time, patch data and active fragments fixed', () => {
  const study=visualStudy(),view=study.burnVisuals;
  view.settling.fragments.push(fragmentFor(study));
  updateBurnVisuals(study);
  const snapshot=()=>({matrices:study.logMeshes.map(mesh=>mesh.matrixWorld.toArray()),atlas:Array.from(view.burnMap.image.data),
    fragments:Array.from(view.fragments.instanceMatrix.array),heat:Array.from(view.fragments.geometry.attributes.instanceHeat.array),
    time:study.logMeshes.map(mesh=>mesh.userData.burnUniforms.uBurnTime.value),gas:study.volumes[0].material.uniforms.uSources.value.map(p=>p.toArray())});
  const before=snapshot();
  for(let i=0;i<5;i++)updateBurnVisuals(study);
  assert.deepEqual(snapshot(),before);
});

test('reset retires every active fragment and clears particle and transform history with the same seed', () => {
  const study=visualStudy(),view=study.burnVisuals;
  for(let i=0;i<12;i++)view.settling.fragments.push(fragmentFor(study,i));
  updateBurnVisuals(study);assert.equal(view.fragments.count,12);
  const atlas=view.burnMap,oldToken=view.resetToken;
  study.cycle.reset(42);study.animationTime=0;updateBurnVisuals(study,true);
  assert.notEqual(view.resetToken,oldToken);assert.equal(view.fragments.count,0);assert.deepEqual(view.settling.fragments,[]);
  assert.equal(view.embers.length,0);assert.equal(view.particles.length,0);assert.equal(view.impactEvents.length,0);
  assert.equal(view.fragmentTransforms.length,0);
  assert.equal(view.burnMap,atlas,'reuse the fixed-size GPU atlas after reset');
});

function sealedEdges(geometry) {
  const p=geometry.attributes.position,vertices=[],ids=new Map(),edges=new Map(),index=geometry.index.array;
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e6)).join(',');
    if(!ids.has(key))ids.set(key,ids.size);vertices.push(ids.get(key));
  }
  for(let i=0;i<index.length;i+=3)for(let j=0;j<3;j++){
    const a=vertices[index[i+j]],b=vertices[index[i+(j+1)%3]],key=`${Math.min(a,b)},${Math.max(a,b)}`;
    const edge=edges.get(key)||{count:0,winding:0};edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);
  }
  for(const edge of edges.values()){assert.equal(edge.count,2,'every deformed edge stays sealed');assert.equal(edge.winding,0);}
}

test('fracturing a donor and its caps preserves a sealed solid with finite normals', () => {
  for(const fuelType of ['log','plank','stump']){
    const mesh=createSceneFuelMesh({definition:[[-1,.3,0],[1,.3,0],.25],fuelType,seed:42,mode:0,hybrid:true},sourceMaterials());
    const original=mesh.geometry.attributes.position.array.slice();
    assert.equal(applyLogFracture(mesh,{t:.98,angle:.3,severity:.6}),true);
    assert.notDeepEqual(mesh.geometry.attributes.position.array,original);sealedEdges(mesh.geometry);
    for(const value of mesh.geometry.attributes.normal.array)assert.ok(Number.isFinite(value));
    mesh.traverse(part=>{if(part.geometry)assert.ok(part.geometry.boundingSphere.radius>0);});
  }
});

test('a different fracture location invalidates the donor geometry even when severity is unchanged', () => {
  const mesh=createSceneFuelMesh({definition:[[-1,.3,0],[1,.3,0],.25],fuelType:'log',seed:42,mode:0,hybrid:true},sourceMaterials());
  applyLogFracture(mesh,{t:.3,angle:0,severity:.6});
  const first=mesh.geometry.attributes.position.array.slice();
  assert.equal(applyLogFracture(mesh,{t:.7,angle:Math.PI,severity:.6}),true);
  assert.notDeepEqual(mesh.geometry.attributes.position.array,first);
  sealedEdges(mesh.geometry);
});
