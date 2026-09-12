import * as THREE from 'three';
import { random } from './textures.js';
import { createCoalMaterial } from './coals.js';

const COUNT = 76, OUTER_COUNT = 8, TAU = Math.PI * 2;
const clamp = (value,min=0,max=1) => Math.max(min,Math.min(max,value));

// Preserve a closed, inexpensive polyhedron, but split its formerly regular
// outline into crushed corners, broad cut faces, and unequal projections.
export function createCoalGeometry(seed=1) {
  const geometry=new THREE.DodecahedronGeometry(1,0),position=geometry.attributes.position;
  const rand=random(seed^0xC0A1),vertices=new Map();
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    const key=[x,y,z].map(v=>Math.round(v*1e6)).join(',');
    if(!vertices.has(key)){
      const rough=.68+rand()*.60;
      let px=x*rough+.17*y+.09*z,py=y*rough*.62,pz=z*rough*.86-.12*x;
      py=Math.min(py,.39+px*.19-pz*.11);
      px=Math.min(px,.81-pz*.28);
      pz=Math.max(pz,-.76-px*.18);
      vertices.set(key,[px,py,pz]);
    }
    position.setXYZ(i,...vertices.get(key));
  }
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData.angularCoal=true;
  return geometry;
}

function layout(seed) {
  const rand=random(seed^0xBEDE),pieces=[];
  const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(.00001,rand())))*Math.cos(rand()*TAU);
  const centers=[[-.35,.14],[.28,.14],[.02,-.32],[.03,.10]];
  for(let i=0;i<COUNT;i++){
    const isolated=i>=COUNT-OUTER_COUNT;
    const radius=isolated?.058+rand()*.049:.067+rand()*.092;
    let best=null,bestClearance=-Infinity;
    for(let attempt=0;attempt<120;attempt++){
      let x,z;
      if(isolated){
        const angle=(i-(COUNT-OUTER_COUNT))/OUTER_COUNT*TAU+(rand()-.5)*.3,r=1.45+rand()*.39;
        x=Math.cos(angle)*r;z=Math.sin(angle)*r;
      }else{
        const center=centers[Math.floor(rand()*centers.length)];
        x=center[0]+gaussian()*.32;z=center[1]+gaussian()*.29;
        if(Math.hypot(x,z)>1.17)continue;
      }
      const clearance=pieces.reduce((distance,piece)=>Math.min(distance,Math.hypot(piece.x-x,piece.z-z)/(radius+piece.radius)),Infinity);
      if(clearance>bestClearance){bestClearance=clearance;best={x,z};}
      if(clearance>(isolated?1.7:.77))break;
    }
    const {x,z}=best;
    pieces.push({x,z,radius,isolated,phase:rand()*TAU,heat:0,exposure:0,neighbors:0,
      sizeX:.83+rand()*.55,sizeY:.60+rand()*.48,sizeZ:.60+rand()*.47,
      rotationX:(rand()-.5)*.40,rotationY:rand()*TAU,rotationZ:(rand()-.5)*.32,
      shade:.40+rand()*.35,retention:.88+rand()*.24});
  }
  for(const piece of pieces){
    piece.neighbors=clamp(pieces.reduce((sum,other)=>other===piece?sum:sum+Math.exp(-((piece.x-other.x)**2+(piece.z-other.z)**2)/.085),0)/4);
    piece.exposure=clamp(Math.exp(-(piece.x**2+piece.z**2)/.82)*.85+piece.neighbors*.15);
    piece.coolingTime=(30+piece.radius*150+piece.neighbors*125)*piece.retention;
  }
  return pieces;
}

export function createCoalBed({seed=42,mode=0,animated=false,groundHeight=()=>0}={}) {
  const geometry=createCoalGeometry(seed),material=createCoalMaterial(mode,animated,{localized:true});
  const pieces=layout(seed),heat=new THREE.InstancedBufferAttribute(new Float32Array(COUNT),1).setUsage(THREE.DynamicDrawUsage);
  const phase=new THREE.InstancedBufferAttribute(new Float32Array(pieces.map(piece=>piece.phase)),1);
  geometry.setAttribute('aCoalHeat',heat);geometry.setAttribute('aCoalPhase',phase);
  const coals=new THREE.InstancedMesh(geometry,material,COUNT),object=new THREE.Object3D(),vertex=new THREE.Vector3();
  for(let i=0;i<COUNT;i++){
    const piece=pieces[i];
    object.position.set(piece.x,0,piece.z);object.rotation.set(piece.rotationX,piece.rotationY,piece.rotationZ);
    object.scale.set(piece.radius*piece.sizeX,piece.radius*piece.sizeY,piece.radius*piece.sizeZ);object.updateMatrix();
    let lift=-Infinity;
    for(let j=0;j<geometry.attributes.position.count;j++){
      vertex.fromBufferAttribute(geometry.attributes.position,j).applyMatrix4(object.matrix);
      lift=Math.max(lift,groundHeight(vertex.x,vertex.z)+.003-vertex.y);
    }
    object.position.y=lift;object.updateMatrix();coals.setMatrixAt(i,object.matrix);
    coals.setColorAt(i,new THREE.Color(piece.shade,piece.shade*.95,piece.shade*.88));
    piece.y=lift;piece.heat=clamp(.20+piece.exposure*.80);heat.setX(i,piece.heat);
  }
  coals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);coals.castShadow=true;coals.receiveShadow=true;
  coals.userData.coalState={pieces,lastTime:null,resetToken:null,seed};
  return coals;
}

// Local heat is independent of animation time: a paused fire has static heat,
// and an accelerated burn advances cooling consistently with the wood/coals.
// This only updates thermal attributes; the scene owns mass-based mesh shrink.
export function updateCoalBed(coals,cycle,force=false) {
  const state=coals?.userData.coalState;
  if(!state || !cycle)return false;
  const time=Number.isFinite(cycle.time)?cycle.time:0,token=`${cycle.seed}:${cycle.resetSerial}`;
  const core=clamp(Number.isFinite(cycle.coalHeat)?cycle.coalHeat:0);
  const reset=state.resetToken!==token || state.lastTime===null || time<state.lastTime;
  const dt=reset?0:Math.max(0,time-state.lastTime);
  const available=clamp(Math.sqrt(Math.max(0,cycle.coalMass??0)/.10));
  const attribute=coals.geometry.attributes.aCoalHeat;
  let changed=force;
  for(let i=0;i<state.pieces.length;i++){
    const piece=state.pieces[i];
    if(reset)piece.heat=clamp(core*(.20+piece.exposure*.80));
    else if(dt>0){
      const coupling=clamp(.025+piece.exposure*.91+piece.neighbors*.14);
      const target=core*available*coupling;
      piece.heat+=(target-piece.heat)*(1-Math.exp(-dt/piece.coolingTime));
      if(piece.heat<.0001)piece.heat=0;
    }
    if(Math.abs(attribute.getX(i)-piece.heat)>1e-7){attribute.setX(i,piece.heat);changed=true;}
  }
  state.resetToken=token;state.lastTime=time;
  coals.material.userData.heat.value=core;
  if(changed)attribute.needsUpdate=true;
  return changed;
}
