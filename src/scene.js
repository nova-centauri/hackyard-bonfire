import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { woodTextures, cloudTexture, random } from './textures.js';
import { createVolume } from './volume.js';
import { addStylizedFire } from './stylized.js';
import { createHybridFire } from './hybrid-fire.js';
import { createMotionState, updateStudyMotion } from './motion.js';
import { BurnCycle, SPEEDS } from './lifecycle.js';
import { addDirtClearing, groundHeight } from './ground.js';
import { addStoneRing } from './rocks.js';
import { createCoalBed } from './coal-bed.js';
import { createAshBed, updateAshBed } from './ash-bed.js';
import { createBurnVisuals, updateBurnVisuals } from './burn-visuals.js';
import { createSceneFuelMesh, disposeFuelMesh } from './fuel-mesh.js';

const UP=new THREE.Vector3(0,1,0);
const V=(x,y,z)=>new THREE.Vector3(x,y,z);

function mesh(scene,geometry,material,position,scale) {
  const m=new THREE.Mesh(geometry,material);
  if(position)m.position.copy(position);if(scale)m.scale.copy(scale);
  m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;
}
function line(scene,points,color,opacity=1) {
  const g=new THREE.BufferGeometry().setFromPoints(points);
  const m=new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity});
  const l=new THREE.Line(g,m);scene.add(l);return l;
}
function branch(scene,a,b,r,material,sides=7) {
 const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(r*.55,r,delta.length(),sides,3);
 const m=mesh(scene,g,material,a.clone().add(b).multiplyScalar(.5));m.quaternion.setFromUnitVectors(UP,delta.normalize());return m;
}

export class BonfireViewer {
 constructor(container) {
  this.container=container;this.scenes=new Map();this.cloud=cloudTexture();this.detail='full';
  this.paused=false;this.speed=1;this.frameCount=0;this.depthDirty=true;this.lastTick=null;this.lastDraw=0;this.needsRender=false;this.lastShadow=0;
  // Antialias the offscreen scene, not the final full-screen canvas as well.
  this.renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'default'});
  this.renderer.info.autoReset=false;
  this.renderSize=new THREE.Vector2();this.depthPassCount=0;
  this.shaderErrors=[];
  this.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
    const detail=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
    this.shaderErrors.push(detail);console.error('Bonfire shader compilation failed:',detail);
    this.onError?.('A fire shader could not load. Please try a browser with WebGL 2 hardware acceleration.');
  };
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.renderer.shadowMap.autoUpdate=false;
  this.renderer.domElement.setAttribute('aria-label','Interactive 3D bonfire. Drag to orbit, scroll to zoom.');
  this.renderer.domElement.setAttribute('role','img');this.renderer.domElement.tabIndex=0;
  container.append(this.renderer.domElement);
  this.camera=new THREE.PerspectiveCamera(39,1,.1,60);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);
  this.controls.minDistance=2.1;this.controls.maxDistance=19;this.controls.maxPolarAngle=Math.PI*.48;
  this.controls.enableDamping=false;this.controls.enablePan=true;this.controls.target.set(0,1.8,0);
  this.controls.addEventListener('change',()=>{this.depthDirty=true;this.queueRender();});
  this.depthTarget=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.depthTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  this.depthMaterial=new THREE.MeshDepthMaterial({colorWrite:false});
  // The composer renders offscreen, so canvas antialiasing alone cannot smooth stone edges.
  const sceneTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  this.composer=new EffectComposer(this.renderer,sceneTarget);
  this.renderPass=new RenderPass(new THREE.Scene(),this.camera);this.composer.addPass(this.renderPass);
  this.bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.45,.7,1.05);this.composer.addPass(this.bloom);
  this.composer.addPass(new OutputPass());
  this.finish=new ShaderPass({uniforms:{tDiffuse:{value:null},uMode:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform sampler2D tDiffuse;uniform int uMode;void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;if(uMode==2){float l=dot(c,vec3(.299,.587,.114));float hatch=step(.88,fract((gl_FragCoord.x+gl_FragCoord.y*.63)*.2));c-=hatch*.055*(1.-smoothstep(.16,.67,l));c+=n*.038;}else{c+=n*.003*smoothstep(.008,.06,dot(c,vec3(.299,.587,.114)));}gl_FragColor=vec4(c,1.);}`});this.composer.addPass(this.finish);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
  document.addEventListener('visibilitychange',()=>{
    this.lastTick=null;
    this.audio?.update(this.current,!document.hidden&&!this.paused&&!!this.config?.animated);
    if(document.hidden){cancelAnimationFrame(this.pending);this.pending=0;}
    else this.queueRender();
  });
  this.renderer.domElement.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key))return;
    e.preventDefault();
    if(e.key==='0')this.setView('full');
    else {
      const offset=this.camera.position.clone().sub(this.controls.target),s=new THREE.Spherical().setFromVector3(offset);
      if(e.key==='ArrowLeft')s.theta-=.13;if(e.key==='ArrowRight')s.theta+=.13;
      if(e.key==='ArrowUp')s.phi=Math.max(.12,s.phi-.1);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI*.48,s.phi+.1);
      if(e.key==='+'||e.key==='=')s.radius=Math.max(2.1,s.radius*.88);if(e.key==='-')s.radius=Math.min(19,s.radius*1.12);
      this.camera.position.copy(new THREE.Vector3().setFromSpherical(s).add(this.controls.target));this.controls.update();
    }
  });
 }
 resize() {
  const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;
  // Bound ray-marching and HDR buffers on large/retina displays while retaining MSAA edges.
  const ratio=this.config?.animated?Math.min(devicePixelRatio,1.5,Math.sqrt(1500000/(w*h))):Math.min(devicePixelRatio,1.65);
  if(this.renderer.getPixelRatio()!==ratio){this.renderer.setPixelRatio(ratio);this.composer.setPixelRatio(ratio);}
  this.renderer.setSize(w,h);this.composer.setSize(w,h);
  this.renderer.getDrawingBufferSize(this.renderSize);this.depthTarget.setSize(this.renderSize.x,this.renderSize.y);
  this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.queueRender();
  this.depthDirty=true;
 }
 load(config) {
  this.poker?.reset();
  this.config=config;
  if(!this.scenes.has(config.id))this.scenes.set(config.id,this.buildScene(config));
  this.current=this.scenes.get(config.id);this.renderPass.scene=this.current.scene;
  this.poker?.sync();
  this.current.burnSpeed=this.speed;
  this.lastTick=null;this.depthDirty=true;this.renderer.shadowMap.needsUpdate=true;
  this.renderer.toneMappingExposure=config.exposure;this.bloom.strength=config.bloom;
  this.bloom.enabled=config.bloom>0;
  this.finish.uniforms.uMode.value=config.mode;
  this.resize();this.setView('full');
  this.audio?.update(this.current,config.animated&&!this.paused&&!document.hidden);
  this.onPlaybackChange?.();
  this.onLifecycleChange?.();
 }
 setView(view) {
  if(!this.config)return;this.detail=view;
  const c=this.config;
  if(view==='logs'){this.camera.position.set(3.3,2.5,4.6);this.controls.target.set(.03,.94,.15);}
  else if(view==='coals'){this.camera.position.set(2.65,1.65,3.15);this.controls.target.set(.05,.35,.6);}
  else {this.camera.position.fromArray(c.camera);this.controls.target.fromArray(c.target);if(this.camera.aspect<1)this.camera.position.multiplyScalar(1.3);}
  this.camera.updateMatrixWorld();this.controls.update();this.depthDirty=true;this.queueRender();
 }
 setLayer(key,value) {
   if(!this.current)return;
   if(key==='glow'){this.bloom.strength=value?this.config.bloom:0;this.bloom.enabled=this.bloom.strength>0;}
   else if(this.current.layers[key])this.current.layers[key].visible=value;
   this.queueRender();
 }
 setPaused(paused) {
  this.paused=paused;this.poker?.sync();this.lastTick=null;this.audio?.update(this.current,!!this.config?.animated&&!paused&&!document.hidden);this.onPlaybackChange?.();this.onLifecycleChange?.();this.queueRender();
 }
 setSpeed(speed) {
  if(SPEEDS.includes(speed)){this.speed=speed;if(this.current)this.current.burnSpeed=speed;this.lastTick=null;this.onLifecycleChange?.();}
 }
 resetFire() {
  if(!this.current?.cycle)return;
  this.poker?.reset();
  const seed=crypto.getRandomValues(new Uint32Array(1))[0];
  this.current.cycle.reset(seed);this.current.animationTime=0;this.lastTick=null;
  this.refreshBurn();
 }
 addLog(fuelType) {
  if(this.current?.cycle?.addLog(fuelType))this.refreshBurn();
 }
 refreshBurn() {
  updateBurnVisuals(this.current,true);updateStudyMotion(this.current);
  this.audio?.update(this.current,!!this.config?.animated&&!this.paused&&!document.hidden);
  this.depthDirty=true;this.renderer.shadowMap.needsUpdate=true;
  this.onLifecycleChange?.();this.queueRender();
 }
 queueRender() {
  this.needsRender=true;this.scheduleFrame();
 }
 scheduleFrame() {
  if(this.pending||document.hidden)return;
  this.pending=requestAnimationFrame(now=>this.tick(now));
 }
 tick(now) {
  this.pending=0;
  const running=!!this.config?.animated&&!this.paused&&!document.hidden;
  if(this.needsRender||(running&&now-this.lastDraw>=1000/30-.5)){
    if(running&&this.current){
      const delta=this.lastTick===null?0:Math.min((now-this.lastTick)/1000,.12);
      this.current.animationTime+=delta;
      if(this.current.cycle){
        this.current.cycle.advance(delta*this.speed);
        if(updateBurnVisuals(this.current)){
          this.depthDirty=true;
          if(now-this.lastShadow>200){this.renderer.shadowMap.needsUpdate=true;this.lastShadow=now;}
        }
      }
      updateStudyMotion(this.current);
    }
    this.audio?.update(this.current,running);
    this.lastTick=running?now:null;this.lastDraw=now;this.needsRender=false;
    this.render();
  }
  if(running)this.scheduleFrame();
 }
 render() {
  if(!this.current)return;
  const {scene,volumes,layers}=this.current;
  if(this.poker?.update())this.depthDirty=true;
  this.renderer.info.reset();
  this.camera.updateMatrixWorld();
  // Rebuild depth when the camera moves or a log burns, settles, or sheds char.
  if(this.depthDirty){
    const hidden=[layers.flames,layers.smoke,layers.sparks,layers.steam];
    if(this.poker)hidden.push(this.poker.marker);
    const vis=hidden.map(g=>g.visible);
    hidden.forEach(g=>g.visible=false);
    const override=scene.overrideMaterial,shadowUpdate=this.renderer.shadowMap.needsUpdate;
    // Only positions/depth are needed here; skip wood/coal shaders and leave shadows for the color pass.
    scene.overrideMaterial=this.depthMaterial;this.renderer.shadowMap.needsUpdate=false;
    try{
      this.renderer.setRenderTarget(this.depthTarget);this.renderer.render(scene,this.camera);
      this.depthPassCount++;
    }finally{
      this.renderer.setRenderTarget(null);scene.overrideMaterial=override;
      this.renderer.shadowMap.needsUpdate=shadowUpdate;
      hidden.forEach((g,i)=>g.visible=vis[i]);
    }
    this.depthDirty=false;
  }
  for(const v of volumes){const u=v.material.uniforms;u.uResolution.value.copy(this.renderSize);u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);u.uCameraWorld.value.copy(this.camera.matrixWorld);}
  this.composer.render();
  this.frameCount++;
  if(this.onRender)this.onRender();
 }
 buildScene(config) {
  const rand=random(config.seed),mode=config.solidMode??config.mode,hybrid=config.fireVariant!==undefined,scene=new THREE.Scene(),volumes=[];
  scene.background=new THREE.Color(config.background);scene.fog=new THREE.FogExp2(config.background,mode===2&&!hybrid?.015:.033);
  const layers={};for(const name of ['flames','smoke','sparks','steam']){layers[name]=new THREE.Group();layers[name].name=name;scene.add(layers[name]);}
  const opaque=new THREE.Group();scene.add(opaque);
  const wood=woodTextures(config.seed,mode);
  const groundMat=new THREE.MeshStandardMaterial({color:hybrid?'#000000':config.ground,roughness:mode===3?.2:1,metalness:mode===3?.65:0});
  const floor=mesh(opaque,new THREE.PlaneGeometry(200,200),groundMat);floor.rotation.x=-Math.PI/2;floor.position.y=hybrid?-.4:-.11;floor.castShadow=false;
  const dirtMat=new THREE.MeshStandardMaterial({color:mode===2?'#aaa69a':mode===1?'#303d4a':'#151512',roughness:1});
  const dirtGeo=new THREE.CylinderGeometry(2.32,2.5,.16,mode===1?11:70);
  if(mode===0||mode===4){const p=dirtGeo.attributes.position;for(let i=0;i<p.count;i++){const a=Math.atan2(p.getZ(i),p.getX(i)),f=1+Math.sin(a*7)*.024+Math.sin(a*13)*.014;p.setX(i,p.getX(i)*f);p.setZ(i,p.getZ(i)*f);}dirtGeo.computeVertexNormals();}
  const dirt=mesh(opaque,dirtGeo,dirtMat,V(0,-.09,0));
  let ashSurface=dirt;
  if(hybrid){dirt.visible=false;ashSurface=addDirtClearing(opaque,config.seed);}
  if(mode===3)dirt.material=new THREE.MeshStandardMaterial({color:'#121820',roughness:.23,metalness:.8});
  const ambient=new THREE.HemisphereLight(mode===2&&!hybrid?'#fff5de':'#9cadc6',mode===2&&!hybrid?'#827f72':'#211915',hybrid?.14:mode===2?2.3:.65);scene.add(ambient);
  const moon=new THREE.DirectionalLight(mode===2&&!hybrid?'#ffffff':'#b2c9e4',hybrid?.36:mode===2?2:mode===1?3.0:1.2);moon.position.set(-3,7,3);moon.castShadow=!hybrid;
  moon.shadow.mapSize.set(2048,2048);moon.shadow.camera.left=-4;moon.shadow.camera.right=4;moon.shadow.camera.top=5;moon.shadow.camera.bottom=-4;moon.shadow.normalBias=.035;scene.add(moon);
  const light=new THREE.PointLight('#ff9a43',hybrid?24:mode===2?7:21,hybrid?7:9,2);light.position.set(0,hybrid?.9:1.45,0);scene.add(light);
  if(hybrid){light.castShadow=true;light.shadow.mapSize.set(512,512);light.shadow.camera.near=.08;light.shadow.camera.far=7;light.shadow.bias=-.001;light.shadow.normalBias=.025;}
  const coreLight=new THREE.PointLight('#ff420a',hybrid?4.5:8,hybrid?3.5:5,2);coreLight.position.set(0,hybrid?.14:.38,.3);scene.add(coreLight);
  const rim=new THREE.DirectionalLight('#ffbe70',hybrid?.045:mode===3?2:.4);rim.position.set(0,3,-5);scene.add(rim);
  const barkMat=new THREE.MeshStandardMaterial({map:wood.bark,bumpMap:wood.bark,bumpScale:.04,roughness:.99,emissiveMap:wood.emission,emissive:'#ffb68b',emissiveIntensity:mode===4?1.65:.9});
  const endMat=new THREE.MeshStandardMaterial({map:wood.end,bumpMap:wood.end,bumpScale:.025,roughness:.95,emissiveMap:wood.endGlow,emissive:'#ff5310',emissiveIntensity:1.4});
  const exposedMat=new THREE.MeshStandardMaterial({map:wood.exposed,bumpMap:wood.exposed,bumpScale:.006,roughness:.96,emissiveMap:wood.emission,emissive:'#ff6319',emissiveIntensity:.6});
  if(mode===1){barkMat.flatShading=true;barkMat.bumpScale=0;barkMat.color.set('#c39569');}
  if(mode===2){barkMat.color.set('#b6ada2');barkMat.emissiveIntensity=.45;endMat.emissiveIntensity=.2;}
  if(mode===3){barkMat.metalness=.7;barkMat.roughness=.26;barkMat.emissiveIntensity=1.8;}
  const logDefs=[
   [[-1.45,.27,.8],[1.3,.43,-.6],.25],
   [[1.28,.31,1.08],[-1.22,.42,-.72],.28],
   [[-.85,.32,1.4],[.62,.66,-1.15],.23],
   [[-1.22,.43,-.96],[.1,1.37,.1],.25],
   [[1.3,.45,-.8],[-.22,1.4,.3],.24],
   [[-1.16,.56,.5],[.92,1.03,-.17],.23],
   [[.85,.52,.95],[-.22,1.62,-.12],.22],
  ];
  if(mode===4){for(let i=3;i<logDefs.length;i++){logDefs[i][0][1]*=.8;logDefs[i][1][1]*=.58;}}
  const cycle=hybrid?new BurnCycle(8108):null,logMeshes=[];
  const fuelMaterials={barkMat,endMat,exposedMat};
  const buildFuel=(li,fuel)=>createSceneFuelMesh({definition:logDefs[li],fuelType:fuel?.fuelType,seed:hybrid?cycle.seed+fuel.id*7919:config.seed+li*7919,mode,hybrid,...(hybrid?{}:{rand})},fuelMaterials);
  for(let li=0;li<logDefs.length;li++) {
    const [aa,bb]=logDefs[li],a=new THREE.Vector3(...aa),b=new THREE.Vector3(...bb);
    const dir=b.clone().sub(a);
    const log=buildFuel(li,cycle?.logs[li]);opaque.add(log);logMeshes.push(log);
    if(hybrid)log.userData.visualKey=`${cycle.seed}:${cycle.resetSerial}:${cycle.logs[li].id}:${cycle.logs[li].fuelType}`;
    if(li<3||hybrid){
      const end=a.clone().addScaledVector(dir.clone().normalize(),-.018);
      for(let k=0;k<15;k++){
        const t=k/14;
        const p=end.clone().add(V(Math.sin(t*7+li)*.11*t,t*.9+.11,Math.cos(t*4)*.04));
        const mat=new THREE.SpriteMaterial({map:this.cloud,color:mode===2&&!hybrid?'#7b807b':'#c0cace',opacity:(1-t)*.22,depthWrite:false});
        const sprite=new THREE.Sprite(mat);sprite.position.copy(p);sprite.scale.setScalar(.11+t*.38);sprite.material.rotation=t*3+li;
        sprite.userData.steam={origin:end.clone(),phase:t,log:li};layers.steam.add(sprite);
      }
    }
  }
  const coals=createCoalBed({seed:config.seed,mode,animated:hybrid,groundHeight:hybrid?groundHeight:()=>0});
  const coalMat=coals.material,obj=new THREE.Object3D();
  const ash=createAshBed(ashSurface);
  opaque.add(coals);
  if(!hybrid)updateAshBed(ash,{seed:config.seed,resetSerial:0,time:0,coalMass:.5,ashMass:.2},coals,0,true);
  const stoneRing=addStoneRing(opaque,{seed:config.seed,mode,hybrid});
  const debris=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:mode===2?'#777267':'#777067',roughness:1}),310);
  for(let i=0;i<310;i++){
    const a=rand()*Math.PI*2,r=Math.sqrt(rand())*3.25;
    obj.position.set(Math.cos(a)*r,-.035+rand()*.05,Math.sin(a)*r);
    if(hybrid)obj.position.y=groundHeight(obj.position.x,obj.position.z)+.006;obj.rotation.set(rand()*3,rand()*3,rand()*3);
    const s=.004+rand()*.035;obj.scale.set(s,s*.35,s*1.5);obj.updateMatrix();debris.setMatrixAt(i,obj.matrix);
  }opaque.add(debris);
  const twigMat=new THREE.MeshStandardMaterial({color:mode===2?'#32291f':'#161410',roughness:1,emissive:'#7d1d05',emissiveIntensity:.55});
  const twigs=new THREE.Group();opaque.add(twigs);
  for(let k=0;k<26;k++){
    const a=V((rand()-.5)*2.9,.13+rand()*.3,(rand()-.5)*2.7),b=a.clone().add(V((rand()-.5)*.95,.15+rand()*.7,(rand()-.5)*.75));
    branch(twigs,a,b,.016+rand()*.018,twigMat);
    const fork=a.clone().lerp(b,.58);branch(twigs,fork,b.clone().add(V(.2,.12,-.18)),.009,twigMat,5);
    if(k<10){
      for(let j=0;j<4;j++){
        const t=(j+.4)/4,p=a.clone().lerp(b,t);
        const glow=mesh(layers.sparks,new THREE.IcosahedronGeometry(.018,0),new THREE.MeshBasicMaterial({color:new THREE.Color(2.2,.27,.008)}),p);
        glow.scale.set(1,2.2,1);
        if(hybrid){glow.userData.twigGlowOrigin=p.clone();glow.position.y-=.16;}
      }
    }
  }
  for(let j=0;j<2;j++){
    const a=V(-.54+j*.61,.22,1.18-j*.15),b=a.clone().add(V(.25,.36,-.61));
    branch(twigs,a,b,.023,twigMat);branch(twigs,a.clone().lerp(b,.55),b.clone().add(V(.15,.09,.07)),.013,twigMat);
  }
  if(hybrid){const fire=createHybridFire(config,this.depthTarget.depthTexture,logDefs);layers.flames.add(fire);volumes.push(fire);}
  else if(mode===0||mode===4){const fire=createVolume('fire',config,this.depthTarget.depthTexture);layers.flames.add(fire);volumes.push(fire);}
  if(mode!==1){const smoke=createVolume('smoke',config,this.depthTarget.depthTexture);layers.smoke.add(smoke);volumes.push(smoke);}
  addStylizedFire(layers,hybrid?{...config,mode:0}:config,logDefs);
  const sparkPositions=[],sparkColors=[];
  for(let k=0;k<130;k++){
    const y=.3+Math.pow(rand(),.72)*5.0,r=.4+y*.17;
    sparkPositions.push((rand()-.5)*r*2+.04*y,y,(rand()-.5)*r*1.8);
    const c=new THREE.Color(2+rand(),.32+rand()*.8,.03);sparkColors.push(c.r,c.g,c.b);
  }
  const sparkGeo=new THREE.BufferGeometry();sparkGeo.setAttribute('position',new THREE.Float32BufferAttribute(sparkPositions,3));sparkGeo.setAttribute('color',new THREE.Float32BufferAttribute(sparkColors,3));
  const sparks=new THREE.Points(sparkGeo,new THREE.PointsMaterial({size:mode===1?.037:.022,vertexColors:true,transparent:true,opacity:.94,depthWrite:false}));layers.sparks.add(sparks);
  if(hybrid){
    sparks.material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a*=1.-smoothstep(.12,.5,length(gl_PointCoord-.5));\n#include <opaque_fragment>');
    };
    sparks.material.customProgramCacheKey=()=> 'soft-fire-spark-1';
  }
  for(let k=0;k<24;k++){
    const y=.7+rand()*3.7,x=(rand()-.5)*(1+y*.35),z=(rand()-.5)*(1+y*.28);
    const points=[V(x,y,z),V(x+.009,y+.025+rand()*.06,z),V(x+.018,y+.045+rand()*.095,z)];
    const streak=line(layers.sparks,points,new THREE.Color(2.4,.65,.1),.7);
    streak.userData.streak={y,phase:y/5.3,index:k};
  }
  if(hybrid){twigs.position.y=-.16;layers.flames.children.forEach(m=>{if(m.userData.twigFlame)m.position.y=-.16;});}
  const study={groundHeight:hybrid?groundHeight:()=>0,rockColliders:stoneRing.userData.colliders,scene,opaque,layers,volumes,logDefs,logMeshes,twigs,coals,ashBed:ash,config,animationTime:0};
  if(config.animated)study.motion=createMotionState(layers,sparks,[light,coreLight],coalMat,barkMat);
  if(hybrid){
    study.flameSources=volumes.find(v=>v.material.uniforms.uSources).material.uniforms.uSources.value.map(s=>s.clone());
    study.cycle=cycle;
    study.syncFuelMeshes=()=>{
      let changed=false;
      for(const fuel of cycle.logs){
        const key=`${cycle.seed}:${cycle.resetSerial}:${fuel.id}:${fuel.fuelType}`,old=logMeshes[fuel.slot];
        if(old.userData.visualKey===key)continue;
        const replacement=buildFuel(fuel.slot,fuel);replacement.userData.visualKey=key;
        disposeFuelMesh(old);opaque.add(replacement);logMeshes[fuel.slot]=replacement;changed=true;
      }
      return changed;
    };
    study.burnVisuals=createBurnVisuals(study);
    updateBurnVisuals(study,true);updateStudyMotion(study);
  }
  return study;
 }
}
