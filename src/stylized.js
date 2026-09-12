import * as THREE from 'three';
import { random } from './textures.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z);
function flameGeometry(base,height,width,lean,phase,faceted=false) {
 const radial=faceted?6:14,steps=faceted?7:36,positions=[],uvs=[],indices=[];
 for(let y=0;y<=steps;y++){
  const t=y/steps;
  const cx=base.x+Math.sin(t*6.7+phase)*t*.23+lean.x*t*t,cz=base.z+Math.sin(t*4.8+phase)*t*.17+lean.z*t*t;
  const radius=width*(.45+.7*Math.sin(Math.PI*t))*Math.pow(1-t,.85)+.001;
  for(let j=0;j<=radial;j++){
   const a=j/radial*Math.PI*2+t*2.1;
   positions.push(cx+Math.cos(a)*radius,base.y+t*height,cz+Math.sin(a)*radius*.6);uvs.push(j/radial,t);
   if(y<steps&&j<radial){const p=y*(radial+1)+j;indices.push(p,p+1,p+radial+1,p+1,p+radial+2,p+radial+1);}
  }
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
 return faceted?geo.toNonIndexed():geo;
}
function applyFlameColors(geo,rand,mode) {
 const uv=geo.attributes.uv,colors=[],count=geo.attributes.position.count;
 const lower=new THREE.Color(mode===2?'#faad43':'#ffcf61'),upper=new THREE.Color(mode===2?'#d84620':'#f04413');
 let face=1;
 for(let i=0;i<count;i++){
   if(i%3===0)face=.77+rand()*.34;
   const t=uv.getY(i),c=lower.clone().lerp(upper,Math.pow(t,.8));c.multiplyScalar(mode===1?face:1);
   colors.push(c.r,c.g,c.b);
 }
 geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}
function line(points,color,opacity=1) {return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));}

export function addStylizedFire(layers,config,logDefs) {
 const mode=config.mode,rand=random(config.seed+640);
 const smokeMaterials=[];
 if(mode===1||mode===2||mode===3){
  for(let i=0;i<12;i++){
   const a=i*2.3999,r=i===0?0:.26+rand()*.66;
   const base=V(Math.cos(a)*r,.3+rand()*.3,Math.sin(a)*r);
   const height=i<3?2.5+rand()*.9:1.0+rand()*1.8,width=.15+rand()*.21;
   const lean=V((rand()-.5)*.8,0,(rand()-.5)*.7);
   if(mode===3){
    const points=[];
    for(let k=0;k<=32;k++){
      const t=k/32;points.push(base.clone().add(V(Math.sin(t*5+a)*t*.45+lean.x*t*t,height*t,Math.cos(t*5+a)*t*.3+lean.z*t*t)));
    }
    const path=new THREE.CatmullRomCurve3(points);
    const geo=ribbonGeometry(path,width,a,50);
    const mat=new THREE.MeshPhysicalMaterial({color:i%3===0?'#ffcc5b':'#ff811e',emissive:i%3===0?'#ffb324':'#ff5612',emissiveIntensity:.23,metalness:.24,roughness:.12,clearcoat:1,clearcoatRoughness:.08,side:THREE.DoubleSide,transparent:true,opacity:.84});
    layers.flames.add(new THREE.Mesh(geo,mat));
    const edgeA=[],edgeB=[];
    for(let j=0;j<=50;j++){
     const t=j/50,p=path.getPoint(t),w=width*(.22+Math.sin(Math.PI*t)*.85)*Math.pow(1-t,.6);
     const side=V(Math.cos(a+t*5),0,Math.sin(a+t*5));edgeA.push(p.clone().addScaledVector(side,w));edgeB.push(p.clone().addScaledVector(side,-w));
    }
    layers.flames.add(line(edgeA,new THREE.Color(2.2,.85,.15),.85),line(edgeB,new THREE.Color(1.8,.48,.08),.8));
   }else{
    const geo=flameGeometry(base,height,width,lean,a,mode===1);applyFlameColors(geo,rand,mode);
    const mat=mode===1?new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}):new THREE.MeshToonMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:.78});
    const flame=new THREE.Mesh(geo,mat);layers.flames.add(flame);
    const inner=flameGeometry(base.clone().add(V(.035,.02,.04)),height*.65,width*.6,lean.clone().multiplyScalar(.6),a,mode===1);
    const innerMesh=new THREE.Mesh(inner,new THREE.MeshBasicMaterial({color:mode===2?'#ffdf8d':'#ffe39d',transparent:mode===2,opacity:.76,side:THREE.DoubleSide}));layers.flames.add(innerMesh);
    if(mode===2){
     const outline=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:'#9f3c26',side:THREE.BackSide,transparent:true,opacity:.55}));outline.scale.set(1.009,1.004,1.009);layers.flames.add(outline);
     const left=[],right=[];
     for(let k=0;k<=36;k++){
      const t=k/36,cx=base.x+Math.sin(t*6.7+a)*t*.23+lean.x*t*t,cz=base.z+Math.sin(t*4.8+a)*t*.17+lean.z*t*t;
      const radius=width*(.45+.7*Math.sin(Math.PI*t))*Math.pow(1-t,.85)+.001;
      left.push(V(cx-radius*.85,base.y+t*height,cz+radius*.42));right.push(V(cx+radius*.85,base.y+t*height,cz-radius*.42));
     }
     layers.flames.add(line(left,'#b45631',.7),line(right,'#a7512d',.5));
    }
   }
  }
  // Smoke has its own visual language in each study.
  if(mode===1){
   for(let i=0;i<11;i++){
    const t=i/10,mat=new THREE.MeshBasicMaterial({color:new THREE.Color('#8b9fae').lerp(new THREE.Color(config.background),t*.6),transparent:true,opacity:.32*(1-t*.91),depthWrite:false});smokeMaterials.push(mat);
    const cloud=new THREE.Mesh(new THREE.IcosahedronGeometry(.19+t*.36,0),mat);cloud.position.set(Math.sin(t*7)*.34+t*.58,2.7+t*2.4,Math.cos(t*5)*.18);cloud.scale.set(1.1,.82,1);cloud.rotation.set(t*3,t*5,t);layers.smoke.add(cloud);
   }
  }else{
   for(let j=0;j<(mode===2?9:7);j++){
    const points=[];
    for(let k=0;k<=70;k++){
     const t=k/70,a=t*6.8+j*.33;
     points.push(V(Math.sin(a)*(.13+t*.44)+t*.72,2.25+t*3.5+j*.02,Math.cos(a)*(.13+t*.3)));
    }
    layers.smoke.add(line(points,mode===2?'#595c56':'#a5bac8',mode===2?.21:.19));
   }
  }
 }
 // Small tongues follow the surface of logs before lifting into the draft.
 for(let i=0;i<9;i++){
  const definition=logDefs[i%logDefs.length],a=new THREE.Vector3(...definition[0]),b=new THREE.Vector3(...definition[1]),r=definition[2];
  const axis=b.clone().sub(a).normalize(),mid=a.clone().lerp(b,.2+rand()*.6);
  const side=new THREE.Vector3().crossVectors(axis,V(0,1,0)).normalize(),up=new THREE.Vector3().crossVectors(side,axis).normalize();
  const points=[];
  for(let k=0;k<=25;k++){
   const t=k/25,ang=-.85+t*2.6;
   points.push(mid.clone().addScaledVector(side,Math.cos(ang)*(r+.025)).addScaledVector(up,Math.sin(ang)*(r+.025)).addScaledVector(axis,t*.17).add(V(t*t*.1,t*t*.48,0)));
  }
  const path=new THREE.CatmullRomCurve3(points),geo=ribbonGeometry(path,.045+rand()*.045,rand()*3,28);
  const mat=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,
   uniforms:{uInk:{value:mode===2?1:0},uTime:{value:0},uLife:{value:1}},
   vertexShader:`varying vec2 vUv;uniform float uTime;
    void main(){vUv=uv;vec3 p=position;float phase=uv.y*12.+position.x*3.,tip=uv.y*uv.y;
      p.x+=(sin(phase-uTime*4.8)-sin(phase))*tip*.028;
      p.z+=(cos(phase-uTime*3.7)-cos(phase))*tip*.018;
      p.y+=(sin(phase-uTime*5.6)-sin(phase))*tip*.065;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
   fragmentShader:`varying vec2 vUv;uniform float uInk,uTime,uLife;void main(){float edge=pow(max(0.,1.-abs(vUv.x*2.-1.)),.65);float alpha=edge*.73*(1.-smoothstep(.7,1.,vUv.y));alpha*=1.+(sin(vUv.y*14.-uTime*7.8)-sin(vUv.y*14.))*.18;vec3 c=mix(vec3(.1,.22,1.1),vec3(2.,.65,.045),smoothstep(.02,.28,vUv.y));c=mix(c,vec3(2.2,1.3,.3),edge*.6);c=mix(c,vec3(1.,.4,.07),uInk);gl_FragColor=vec4(c,alpha*uLife);}`});
  const m=new THREE.Mesh(geo,mat);m.renderOrder=3;m.userData.logSlot=i%logDefs.length;layers.flames.add(m);
 }
 // Two forked twigs are entirely sheathed in flame, including their tips.
 for(let j=0;j<2;j++){
  const a=V(-.54+j*.61,.22,1.18-j*.15),b=a.clone().add(V(.25,.36,-.61));
  for(let fork=0;fork<2;fork++){
   const start=fork===0?a:a.clone().lerp(b,.55),end=fork===0?b:b.clone().add(V(.15,.09,.07));
   const path=new THREE.CatmullRomCurve3([start,start.clone().lerp(end,.5).add(V(.018,.028,0)),end]);
   const shell=new THREE.TubeGeometry(path,22,fork===0?.046:.03,mode===1?5:10,false);
   const jacket=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,
    uniforms:{uTime:{value:0},uLife:{value:1}},
    vertexShader:'varying vec2 vUv;varying vec3 vSurface;void main(){vUv=uv;vSurface=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 vUv;varying vec3 vSurface;uniform float uTime,uLife;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec2 drift=vec2(-uTime*1.7,uTime*.27);float n=noise(vUv*vec2(9.,4.)+drift)*.65+noise(vUv*vec2(19.,9.)+drift*2.)*.35;float a=.16+smoothstep(.25,.7,n)*.34;vec3 c=mix(vec3(.08,.16,.7),vec3(1.6,.52,.025),smoothstep(.22,.37,vSurface.y));c=mix(c,vec3(1.8,.85,.13),smoothstep(.55,.9,n)*.6);gl_FragColor=vec4(c,a*uLife);}`});
   const twigFlame=new THREE.Mesh(shell,jacket);twigFlame.userData.twigFlame=true;layers.flames.add(twigFlame);
  }
 }
}

function ribbonGeometry(path,width,phase,steps){
 const positions=[],uvs=[],indices=[];
 for(let i=0;i<=steps;i++){
  const t=i/steps,p=path.getPoint(t),w=width*(.22+Math.sin(Math.PI*t)*.85)*Math.pow(1-t,.6);
  const side=V(Math.cos(phase+t*5),0,Math.sin(phase+t*5));
  for(let k=0;k<=4;k++){
   const s=k/4*2-1,q=p.clone().addScaledVector(side,w*s);q.y+=Math.sin(s*Math.PI)*w*.2;
   positions.push(...q.toArray());uvs.push(k/4,t);
   if(i<steps&&k<4){const n=i*5+k;indices.push(n,n+1,n+5,n+1,n+6,n+5);}
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
