import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodTextures, cloudTexture, random } from './textures.js';
import { createVolume } from './volume.js';
import { addStylizedFire } from './stylized.js';
import { createHybridFire } from './hybrid-fire.js';
import { createMotionState, updateStudyMotion } from './motion.js';
import { BurnCycle, SPEEDS } from './lifecycle.js';
import { addDirtClearing } from './ground.js';
import { burningMaterial, createBurnVisuals, updateBurnVisuals } from './burn-visuals.js';

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
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
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
  this.composer=new EffectComposer(this.renderer);
  this.renderPass=new RenderPass(new THREE.Scene(),this.camera);this.composer.addPass(this.renderPass);
  this.bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.45,.7,1.05);this.composer.addPass(this.bloom);
  this.composer.addPass(new OutputPass());
  this.finish=new ShaderPass({uniforms:{tDiffuse:{value:null},uMode:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform sampler2D tDiffuse;uniform int uMode;void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;if(uMode==2){float l=dot(c,vec3(.299,.587,.114));float hatch=step(.88,fract((gl_FragCoord.x+gl_FragCoord.y*.63)*.2));c-=hatch*.055*(1.-smoothstep(.16,.67,l));c+=n*.038;}else{c+=n*.004;}gl_FragColor=vec4(c,1.);}`});this.composer.addPass(this.finish);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
  document.addEventListener('visibilitychange',()=>{
    this.lastTick=null;
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
  this.renderer.setSize(w,h);this.composer.setSize(w,h);
  const ratio=this.renderer.getPixelRatio();this.depthTarget.setSize(w*ratio,h*ratio);
  this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.queueRender();
  this.depthDirty=true;
 }
 load(config) {
  this.config=config;
  if(!this.scenes.has(config.id))this.scenes.set(config.id,this.buildScene(config));
  this.current=this.scenes.get(config.id);this.renderPass.scene=this.current.scene;
  this.current.burnSpeed=this.speed;
  this.lastTick=null;this.depthDirty=true;this.renderer.shadowMap.needsUpdate=true;
  const pixelRatio=Math.min(devicePixelRatio,config.animated?1.25:1.65);
  this.renderer.setPixelRatio(pixelRatio);this.composer.setPixelRatio(pixelRatio);
  this.renderer.toneMappingExposure=config.exposure;this.bloom.strength=config.bloom;
  this.finish.uniforms.uMode.value=config.mode;
  this.resize();this.setView('full');
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
   if(key==='glow')this.bloom.strength=value?this.config.bloom:0;
   else if(this.current.layers[key])this.current.layers[key].visible=value;
   this.queueRender();
 }
 setPaused(paused) {
  this.paused=paused;this.lastTick=null;this.onPlaybackChange?.();this.onLifecycleChange?.();this.queueRender();
 }
 setSpeed(speed) {
  if(SPEEDS.includes(speed)){this.speed=speed;if(this.current)this.current.burnSpeed=speed;this.lastTick=null;this.onLifecycleChange?.();}
 }
 resetFire() {
  if(!this.current?.cycle)return;
  const seed=crypto.getRandomValues(new Uint32Array(1))[0];
  this.current.cycle.reset(seed);this.current.animationTime=0;this.lastTick=null;
  this.refreshBurn();
 }
 addLog() {
  if(this.current?.cycle?.addLog())this.refreshBurn();
 }
 refreshBurn() {
  updateBurnVisuals(this.current,true);updateStudyMotion(this.current);
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
    this.lastTick=running?now:null;this.lastDraw=now;this.needsRender=false;
    this.render();
  }
  if(running)this.scheduleFrame();
 }
 render() {
  if(!this.current)return;
  const {scene,volumes,layers}=this.current;
  this.camera.updateMatrixWorld();
  // Rebuild depth when the camera moves or a log burns, settles, or sheds char.
  if(this.depthDirty){
    const hidden=[layers.flames,layers.smoke,layers.sparks,layers.steam],vis=hidden.map(g=>g.visible);
    hidden.forEach(g=>g.visible=false);
    this.renderer.setRenderTarget(this.depthTarget);this.renderer.render(scene,this.camera);this.renderer.setRenderTarget(null);
    hidden.forEach((g,i)=>g.visible=vis[i]);this.depthDirty=false;
  }
  const size=new THREE.Vector2();this.renderer.getDrawingBufferSize(size);
  for(const v of volumes){const u=v.material.uniforms;u.uResolution.value.copy(size);u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);u.uCameraWorld.value.copy(this.camera.matrixWorld);}
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
  const groundMat=new THREE.MeshStandardMaterial({color:config.ground,roughness:mode===3?.2:1,metalness:mode===3?.65:0});
  const floor=mesh(opaque,new THREE.PlaneGeometry(200,200),groundMat);floor.rotation.x=-Math.PI/2;floor.position.y=-.11;floor.castShadow=false;
  const dirtMat=new THREE.MeshStandardMaterial({color:mode===2?'#aaa69a':mode===1?'#303d4a':'#151512',roughness:1});
  const dirtGeo=new THREE.CylinderGeometry(2.32,2.5,.16,mode===1?11:70);
  if(mode===0||mode===4){const p=dirtGeo.attributes.position;for(let i=0;i<p.count;i++){const a=Math.atan2(p.getZ(i),p.getX(i)),f=1+Math.sin(a*7)*.024+Math.sin(a*13)*.014;p.setX(i,p.getX(i)*f);p.setZ(i,p.getZ(i)*f);}dirtGeo.computeVertexNormals();}
  const dirt=mesh(opaque,dirtGeo,dirtMat,V(0,-.09,0));
  if(hybrid){dirt.visible=false;addDirtClearing(opaque,config.seed);}
  if(mode===3)dirt.material=new THREE.MeshStandardMaterial({color:'#121820',roughness:.23,metalness:.8});
  const ambient=new THREE.HemisphereLight(mode===2&&!hybrid?'#fff5de':'#9cadc6',mode===2&&!hybrid?'#827f72':'#211915',hybrid?1.0:mode===2?2.3:.65);scene.add(ambient);
  const moon=new THREE.DirectionalLight(mode===2&&!hybrid?'#ffffff':'#b2c9e4',hybrid?1.55:mode===2?2:mode===1?3.0:1.2);moon.position.set(-3,7,3);moon.castShadow=true;
  moon.shadow.mapSize.set(2048,2048);moon.shadow.camera.left=-4;moon.shadow.camera.right=4;moon.shadow.camera.top=5;moon.shadow.camera.bottom=-4;moon.shadow.normalBias=.035;scene.add(moon);
  const light=new THREE.PointLight('#ff852a',mode===2&&!hybrid?7:21,9,2);light.position.set(0,1.45,0);scene.add(light);
  const coreLight=new THREE.PointLight('#ff3209',8,5,2);coreLight.position.set(0,.38,.6);scene.add(coreLight);
  const rim=new THREE.DirectionalLight('#ffbe70',mode===3?2:.4);rim.position.set(0,3,-5);scene.add(rim);
  const barkMat=new THREE.MeshStandardMaterial({map:wood.bark,bumpMap:wood.bark,bumpScale:.04,roughness:.99,emissiveMap:wood.emission,emissive:'#ffb68b',emissiveIntensity:mode===4?1.65:.9});
  const endMat=new THREE.MeshStandardMaterial({map:wood.end,bumpMap:wood.end,bumpScale:.025,roughness:.95,emissiveMap:wood.endGlow,emissive:'#ff5310',emissiveIntensity:1.4});
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
  const flakeGeometries=[],logMeshes=[];
  const ashMat=new THREE.MeshStandardMaterial({color:mode===2?'#dbd5c7':'#888379',roughness:1,flatShading:true});
  for(let li=0;li<logDefs.length;li++) {
    const [aa,bb,radius]=logDefs[li],a=new THREE.Vector3(...aa),b=new THREE.Vector3(...bb);
    const dir=b.clone().sub(a),length=dir.length(),sides=mode===1?8:22;
    const geo=new THREE.CylinderGeometry(radius*.88,radius,length,sides,mode===1?5:22,false);
    const pos=geo.attributes.position;
    for(let i=0;i<pos.count;i++){
      const y=pos.getY(i),theta=Math.atan2(pos.getZ(i),pos.getX(i));
      const f=1+Math.sin(theta*7+y*8+li)*.035+Math.cos(theta*11-y*5)*.02;
      pos.setX(i,pos.getX(i)*f);pos.setZ(i,pos.getZ(i)*f);
    }
    geo.computeVertexNormals();
    const burnUniforms={uWood:{value:1},uChar:{value:0},uHeat:{value:0}};
    const materials=hybrid?[burningMaterial(barkMat,burnUniforms),burningMaterial(endMat,burnUniforms,true)]:[barkMat,endMat];
    const log=mesh(opaque,geo,materials,a.clone().add(b).multiplyScalar(.5));log.quaternion.setFromUnitVectors(UP,dir.clone().normalize());
    log.userData.length=length;log.userData.burnUniforms=burnUniforms;logMeshes.push(log);
    log.updateMatrixWorld();
    log.userData.baseInverse=log.matrixWorld.clone().invert();
    if(mode===2){
      const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geo,27),new THREE.LineBasicMaterial({color:'#342e29',transparent:true,opacity:.85}));log.add(outline);
      for(let j=0;j<17;j++){
        const theta=j/17*Math.PI*2,points=[];
        for(let k=0;k<=26;k++){const t=k/26,y=(t-.5)*length,rr=radius*(.94-y/length*.1)+.004;points.push(V(Math.cos(theta+Math.sin(t*14+j)*.007)*rr,y,Math.sin(theta+Math.sin(t*14+j)*.007)*rr));}
        line(log,points,'#342e25',.58);
      }
    }
    const localChips=[];
    for(let k=0;k<(mode===1?10:45);k++){
      const theta=rand()*Math.PI*2,y=(rand()-.5)*length*.97;
      const chip=new THREE.DodecahedronGeometry(1,0);
      const radiusAt=radius*(.94-y/length*.1);
      const obj=new THREE.Object3D();obj.position.set(Math.cos(theta)*radiusAt,y,Math.sin(theta)*radiusAt);
      obj.scale.set(.022+rand()*.025,.025+rand()*.07,.012+rand()*.014);obj.rotation.set(0,-theta,rand()*.4);
      obj.updateMatrix();chip.applyMatrix4(obj.matrix);
      if(hybrid)localChips.push(chip);else{chip.applyMatrix4(log.matrixWorld);flakeGeometries.push(chip);}
    }
    if(hybrid){
      log.userData.charChips=mesh(log,mergeGeometries(localChips),new THREE.MeshStandardMaterial({color:'#534d42',roughness:1,flatShading:true}));
      localChips.forEach(g=>g.dispose());
    }
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
  if(flakeGeometries.length)mesh(opaque,mergeGeometries(flakeGeometries),new THREE.MeshStandardMaterial({color:mode===2?'#746d5f':mode===4?'#a29b88':'#39362f',roughness:1,flatShading:true}));
  flakeGeometries.forEach(g=>g.dispose());
  const coalGeo=new THREE.DodecahedronGeometry(1,mode===1?0:1);
  const coalMat=new THREE.MeshStandardMaterial({color:'#6b5950',emissive:'#ff5a09',emissiveIntensity:mode===4?2.1:1.3,roughness:.9,flatShading:true});
  coalMat.userData.bedAsh={value:0};
  coalMat.onBeforeCompile=shader=>{
    shader.uniforms.uBedAsh=coalMat.userData.bedAsh;
    shader.vertexShader='varying vec3 vCoalSurface,vCoalOffset;varying float vCoalHeat;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCoalSurface=position;vCoalOffset=instanceMatrix[3].xyz*2.73;vCoalHeat=.12+instanceColor.r*1.45;');
    shader.fragmentShader=`varying vec3 vCoalSurface,vCoalOffset;varying float vCoalHeat;uniform float uBedAsh;
      vec3 coalHash(vec3 p){return fract(sin(vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))))*43758.5453);}
      vec2 coalCells(vec3 p){vec3 cell=floor(p),f=fract(p);float first=8.,second=8.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 b=vec3(float(x),float(y),float(z)),r=b+coalHash(cell+b)-f;float d=dot(r,r);if(d<first){second=first;first=d;}else if(d<second)second=d;}return vec2(sqrt(first),sqrt(second));}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      vec3 cp=vCoalSurface;
      vec2 cells=coalCells(cp*3.2+vCoalOffset);
      float vein=cells.y-cells.x;
      float crack=1.-smoothstep(.015,.078,vein);
      float hot=.28+.72*smoothstep(-.7,.5,cp.y);
      float crust=smoothstep(.5,.86,cells.x)*smoothstep(-.5,.4,cp.y);
      totalEmissiveRadiance*= (.008+crack*.8)*hot*(1.-crust*.75)*vCoalHeat;
      diffuseColor.rgb=mix(diffuseColor.rgb*(.55+smoothstep(.02,.22,vein)*.6),vec3(.21,.18,.14),crust*.8);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.26,.25,.22),uBedAsh*.82);
    `);
  };
  const coals=new THREE.InstancedMesh(coalGeo,coalMat,210),obj=new THREE.Object3D();
  const ashGeo=new THREE.DodecahedronGeometry(1,0),ash=new THREE.InstancedMesh(ashGeo,ashMat,120);
  for(let i=0;i<210;i++){
    const a=rand()*Math.PI*2,r=Math.sqrt(rand())*1.73;
    obj.position.set(Math.cos(a)*r,.018+rand()*.11,Math.sin(a)*r);obj.rotation.set(rand()*3,rand()*3,rand()*3);
    const sz=.032+rand()*.105;obj.scale.set(sz,sz*(.4+rand()*.55),sz*(.7+rand()));obj.updateMatrix();coals.setMatrixAt(i,obj.matrix);
    const c=new THREE.Color().setHSL(.018+rand()*.06,.8, .07+rand()*.26);coals.setColorAt(i,c);
    if(i<120){obj.position.y+=sz*.45;obj.scale.multiplyScalar(.83);obj.scale.y*=.27;obj.updateMatrix();ash.setMatrixAt(i,obj.matrix);}
  }
  coals.castShadow=true;coals.receiveShadow=true;opaque.add(coals,ash);
  const stoneMat=new THREE.MeshStandardMaterial({color:mode===1?'#62707d':mode===2?'#96988e':'#62605a',roughness:.96,flatShading:mode===1||mode===2});
  let stoneGeo=new THREE.IcosahedronGeometry(1,mode===1?0:mode===2?1:3);
  if(mode===0||mode===3||mode===4)stoneGeo=mergeVertices(stoneGeo);
  if(mode!==1){const p=stoneGeo.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=1+Math.sin(x*12+y*8)*Math.sin(z*13-x*7)*.045;p.setXYZ(i,x*f,y*f,z*f);}stoneGeo.computeVertexNormals();}
  const stones=new THREE.InstancedMesh(stoneGeo,stoneMat,21);
  for(let i=0;i<21;i++){
    const a=i/21*Math.PI*2,r=2.05+rand()*.12;
    obj.position.set(Math.cos(a)*r,.075,Math.sin(a)*r);obj.rotation.set(rand(),rand()*3,rand());
    obj.scale.set(.18+rand()*.13,.13+rand()*.09,.17+rand()*.1);obj.updateMatrix();stones.setMatrixAt(i,obj.matrix);
    stones.setColorAt(i,new THREE.Color().setScalar(.6+rand()*.6));
  }
  stones.castShadow=true;stones.receiveShadow=true;opaque.add(stones);
  const debris=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:mode===2?'#777267':'#777067',roughness:1}),310);
  for(let i=0;i<310;i++){
    const a=rand()*Math.PI*2,r=Math.sqrt(rand())*3.25;
    obj.position.set(Math.cos(a)*r,-.035+rand()*.05,Math.sin(a)*r);obj.rotation.set(rand()*3,rand()*3,rand()*3);
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
  for(let k=0;k<24;k++){
    const y=.7+rand()*3.7,x=(rand()-.5)*(1+y*.35),z=(rand()-.5)*(1+y*.28);
    const points=[V(x,y,z),V(x+.009,y+.025+rand()*.06,z),V(x+.018,y+.045+rand()*.095,z)];
    const streak=line(layers.sparks,points,new THREE.Color(2.4,.65,.1),.7);
    streak.userData.streak={y,phase:y/5.3,index:k};
  }
  const study={scene,opaque,layers,volumes,logDefs,logMeshes,twigs,coals,ashBed:ash,config,animationTime:0};
  if(config.animated)study.motion=createMotionState(layers,sparks,[light,coreLight],coalMat,barkMat);
  if(hybrid){
    study.flameSources=volumes.find(v=>v.material.uniforms.uSources).material.uniforms.uSources.value.map(s=>s.clone());
    study.cycle=new BurnCycle(8108);study.burnVisuals=createBurnVisuals(study);
    updateBurnVisuals(study,true);updateStudyMotion(study);
  }
  return study;
 }
}
