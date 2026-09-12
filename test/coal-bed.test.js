import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCoalBed,createCoalGeometry,updateCoalBed } from '../src/coal-bed.js';

const cycle=()=>({seed:42,resetSerial:1,time:0,coalHeat:.9,coalMass:.4});
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≈ ${b}`);

test('coal chunks have a closed angular, asymmetric silhouette rather than smooth egg geometry',()=>{
  for(const seed of [11,22,42,73]){
    const geometry=createCoalGeometry(seed),position=geometry.attributes.position,normal=geometry.attributes.normal;
    const size=geometry.boundingBox.getSize(new THREE.Vector3());
    assert.equal(position.count,108,'36 broad facets retain visible broken corners');
    assert.ok(size.y<size.x*.8,'pieces have a crushed low profile');
    const points=Array.from({length:position.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(position,i));
    const oppositeError=mean(points.map(point=>Math.min(...points.map(other=>point.clone().add(other).length()))));
    assert.ok(oppositeError>.075,'opposite corners do not form a symmetric egg or ellipsoid');
    const unique=new Map(),ids=[],edges=new Map();let signedVolume=0;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3();
    for(let i=0;i<position.count;i++){
      a.fromBufferAttribute(position,i);assert.ok(a.toArray().every(Number.isFinite));
      const key=a.toArray().map(value=>Math.round(value*1e6)).join(',');
      if(!unique.has(key))unique.set(key,unique.size);ids.push(unique.get(key));
      near(b.fromBufferAttribute(normal,i).length(),1);
    }
    for(let i=0;i<position.count;i+=3){
      a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);
      signedVolume+=a.dot(cross.crossVectors(b,c))/6;
      assert.ok(b.sub(a).cross(c.sub(a)).length()>.001,'each chipped facet has real area');
      for(let j=0;j<3;j++){
        const from=ids[i+j],to=ids[i+(j+1)%3],key=`${Math.min(from,to)},${Math.max(from,to)}`;
        const edge=edges.get(key)||{count:0,winding:0};edge.count++;edge.winding+=from<to?1:-1;edges.set(key,edge);
      }
    }
    for(const edge of edges.values()){assert.equal(edge.count,2);assert.equal(edge.winding,0);}
    assert.ok(signedVolume>.4,'the rough shell still encloses a solid');
  }
});

test('a single sparse instanced bed clusters most coals centrally with only a few isolated outskirts',()=>{
  for(const seed of [11,22,42,73]){
    const coals=createCoalBed({seed}),pieces=coals.userData.coalState.pieces;
    assert.ok(coals.isInstancedMesh);assert.equal(coals.count,76);assert.equal(coals.children.length,0);
    assert.equal(pieces.length,coals.count);assert.equal(coals.geometry.attributes.aCoalHeat.count,coals.count);
    assert.ok(pieces.filter(piece=>Math.hypot(piece.x,piece.z)<1.2).length>=66);
    const outer=pieces.filter(piece=>piece.isolated),inner=pieces.filter(piece=>!piece.isolated);
    assert.equal(outer.length,8);assert.ok(outer.every(piece=>Math.hypot(piece.x,piece.z)>1.4));
    assert.ok(mean(outer.map(piece=>piece.neighbors))<.06);assert.ok(mean(inner.map(piece=>piece.neighbors))>.5);
    assert.ok(new Set(pieces.map(piece=>piece.phase)).size>70,'shimmer phases are independent');
    assert.ok(new Set(pieces.map(piece=>piece.radius.toFixed(4))).size>65,'pieces differ in scale');
  }
});

test('seeded coal shape, layout and thermal starting state are reproducible and sit on actual ground',()=>{
  const groundHeight=(x,z)=>.12*x-.06*z+.015*Math.sin(x*9);
  const first=createCoalBed({seed:22,groundHeight}),same=createCoalBed({seed:22,groundHeight}),different=createCoalBed({seed:23,groundHeight});
  assert.deepEqual(first.instanceMatrix.array,same.instanceMatrix.array);
  assert.deepEqual(first.geometry.attributes.position.array,same.geometry.attributes.position.array);
  assert.deepEqual(first.userData.coalState.pieces,same.userData.coalState.pieces);
  assert.notDeepEqual(first.instanceMatrix.array,different.instanceMatrix.array);
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(let piece=0;piece<first.count;piece++){
    first.getMatrixAt(piece,matrix);let clearance=Infinity;
    for(let vertex=0;vertex<first.geometry.attributes.position.count;vertex++){
      point.fromBufferAttribute(first.geometry.attributes.position,vertex).applyMatrix4(matrix);
      clearance=Math.min(clearance,point.y-groundHeight(point.x,point.z));
    }
    near(clearance,.003);
  }
});

test('isolated coals cool much faster while a neighboring central cluster retains heat',()=>{
  const coals=createCoalBed({seed:22,animated:true}),burn=cycle();updateCoalBed(coals,burn);
  const state=coals.userData.coalState,matrices=coals.instanceMatrix.array.slice();
  state.pieces.forEach(piece=>{piece.heat=.85;});burn.time=120;
  assert.equal(updateCoalBed(coals,burn),true);
  const inner=state.pieces.filter(piece=>piece.exposure>.65),outer=state.pieces.filter(piece=>piece.isolated);
  assert.ok(mean(inner.map(piece=>piece.heat))>.7);assert.ok(mean(outer.map(piece=>piece.heat))<.15);
  assert.ok(mean(inner.map(piece=>piece.heat))>mean(outer.map(piece=>piece.heat))*4);
  assert.deepEqual(coals.instanceMatrix.array,matrices,'thermal updates never move or rescale coal geometry');
  state.pieces.forEach((piece,i)=>near(coals.geometry.attributes.aCoalHeat.getX(i),piece.heat));
  burn.coalHeat=0;burn.coalMass=0;burn.time+=2400;updateCoalBed(coals,burn);
  assert.ok(state.pieces.every(piece=>piece.heat===0),'without fuel or core heat the entire bed cools out');
});

test('thermal integration uses simulation time and paused updates do not churn heat buffers',()=>{
  const a=createCoalBed({seed:22}),b=createCoalBed({seed:22}),fast=cycle(),slow=cycle();
  updateCoalBed(a,fast);updateCoalBed(b,slow);
  fast.time=120;updateCoalBed(a,fast);
  for(let i=1;i<=120;i++){slow.time=i;updateCoalBed(b,slow);}
  a.userData.coalState.pieces.forEach((piece,i)=>near(piece.heat,b.userData.coalState.pieces[i].heat,1e-9));
  const attribute=a.geometry.attributes.aCoalHeat,version=attribute.version,heat=attribute.array.slice();
  for(let frame=0;frame<60;frame++){
    a.material.userData.time.value=frame/60;
    assert.equal(updateCoalBed(a,fast),false);
  }
  assert.equal(attribute.version,version);assert.deepEqual(attribute.array,heat);
});

test('reset replaces local thermal history, shares current heat with the shader and tolerates legacy fixtures',()=>{
  const coals=createCoalBed({seed:22,animated:true}),burn=cycle();updateCoalBed(coals,burn);
  const initial=coals.geometry.attributes.aCoalHeat.array.slice(),matrices=coals.instanceMatrix.array.slice();
  burn.coalHeat=0;burn.time=1000;updateCoalBed(coals,burn);
  assert.notDeepEqual(coals.geometry.attributes.aCoalHeat.array,initial);
  burn.resetSerial++;burn.time=0;burn.coalHeat=.9;updateCoalBed(coals,burn);
  assert.deepEqual(coals.geometry.attributes.aCoalHeat.array,initial);assert.deepEqual(coals.instanceMatrix.array,matrices);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  coals.material.onBeforeCompile(shader);
  for(const [uniform,key] of [['uCoalTime','time'],['uCoalTemperature','heat'],['uBedAsh','bedAsh'],['uCoalImpact','impact']]){
    assert.equal(shader.uniforms[uniform],coals.material.userData[key]);
  }
  assert.equal(shader.uniforms.uCoalLocalized.value,1);
  assert.ok(shader.vertexShader.includes('vCoalHeat=aCoalHeat'),'per-piece stored heat reaches the rendered surface');
  assert.equal(updateCoalBed(new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),1),burn),false);
});
