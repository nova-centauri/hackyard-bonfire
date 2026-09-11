import * as THREE from 'three';
import { random } from './textures.js';

// Reproduce the 12 centerlines, widths and silhouettes in the original Ink & Wash.
// That study consumes 185 color samples after constructing each smooth flame.
export function inkFlameSources(seed = 22) {
  const rand = random(seed + 640), sources = [];
  for (let i = 0; i < 12; i++) {
    const phase = i * 2.3999, radius = i === 0 ? 0 : .26 + rand() * .66;
    const base = new THREE.Vector3(Math.cos(phase) * radius, .3 + rand() * .3, Math.sin(phase) * radius);
    const height = i < 3 ? 2.5 + rand() * .9 : 1.0 + rand() * 1.8;
    const width = .15 + rand() * .21;
    const lean = new THREE.Vector2((rand() - .5) * .8, (rand() - .5) * .7);
    sources.push({ base, height, width, lean, phase });
    for (let j = 0; j < 185; j++) rand();
  }
  return sources;
}

const noise = `
  float hash(vec3 p) { p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float n3(vec3 p) {
    vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float fbm(vec3 p) {return n3(p)*.54+n3(p*2.03+7.7)*.28+n3(p*4.11-5.3)*.13+n3(p*8.07+2.2)*.05;}
  vec2 boxHit(vec3 ro,vec3 rd,vec3 lo,vec3 hi) {vec3 a=(lo-ro)/rd,b=(hi-ro)/rd,c=min(a,b),d=max(a,b);return vec2(max(max(c.x,c.y),c.z),min(min(d.x,d.y),d.z));}
`;

export function createHybridFire(config, depthTexture, logDefs) {
  const variant = config.fireVariant;
  const sources = inkFlameSources(config.seed);
  const lo = new THREE.Vector3(-1.9, .08, -1.9), hi = new THREE.Vector3(2.15, 4.55, 1.9);
  const size = hi.clone().sub(lo);
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(...lo.clone().add(hi).multiplyScalar(.5).toArray());
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
    uniforms: {
      uDepth: { value: depthTexture }, uResolution: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uInvProjection: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() },
      uLo: { value: lo }, uHi: { value: hi },
      uSources: { value: sources.map(s => new THREE.Vector4(...s.base.toArray(), s.height)) },
      uShapes: { value: sources.map(s => new THREE.Vector4(s.width, s.lean.x, s.lean.y, s.phase)) },
      uLogA: { value: logDefs.map(d => new THREE.Vector4(...d[0], d[2])) },
      uLogB: { value: logDefs.map(d => new THREE.Vector4(...d[1], d[2] * .9)) },
    },
    vertexShader: 'varying vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `precision highp float;
      varying vec3 vPosition;
      uniform sampler2D uDepth;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform mat4 uInvProjection,uCameraWorld;
      uniform vec3 uLo,uHi;
      uniform vec4 uSources[12],uShapes[12],uLogA[7],uLogB[7];
      ${noise}

      // The volume follows the ink silhouettes; interior structure is turbulent gas.
      vec3 field(vec3 p) {
        float clockTime=uTime*${variant === 2 ? '1.15' : '.72'};
        vec3 drift=vec3(clockTime*.13,-clockTime*1.2,clockTime*.08);
        vec3 coarse=vec3(n3(p*2.6+drift+3.1),n3(p*2.6+drift+18.4),n3(p*2.6+drift-12.7))-.5;
        vec3 warp=p;
        warp.xz+=coarse.xz*${variant === 2 ? '.15' : '.065'};
        float body=0., flameHeight=0., skin=0.;
        for(int i=0;i<12;i++) {
          vec4 source=uSources[i],shape=uShapes[i];
          float height=source.w*(1.+sin(clockTime*1.7+shape.w)*.055+sin(clockTime*3.1+shape.w*2.)*.025);
          float t=(warp.y-source.y)/height;
          if(t>0. && t<1.) {
            vec2 center=source.xz+vec2(sin(t*6.7+shape.w-clockTime*1.3)*t*.23, sin(t*4.8+shape.w-clockTime*.9)*t*.17)+shape.yz*t*t;
            ${variant === 2 ? `center+=vec2(t*t*(.43+sin(clockTime*.7)*.07)+sin(t*11.+shape.w-clockTime*2.)*t*.13,cos(t*8.+shape.w-clockTime*1.6)*t*.09);` : ''}
            float radius=shape.x*(.45+.7*sin(3.141593*t))*pow(1.-t,.85)+.001;
            radius*=1.+sin(clockTime*2.3+shape.w+t*7.)*.065;
            vec2 local=(warp.xz-center)/vec2(1.,.6);
            ${variant === 1 ? `float angle=atan(local.y,local.x);radius*=1.+sin(angle*3.+t*10.+shape.w-clockTime*1.9)*.14;` : ''}
            float d=length(local)/max(radius*${variant === 2 ? '1.2' : '1.0'},.005);
            float envelope=max(0.,1.-d);
            if(envelope>body){body=envelope;flameHeight=t;skin=d;}
          }
        }
        if(body<.001)return vec3(0.);
        vec3 flow=warp*vec3(10.5,5.6,10.5);
        flow.y-=clockTime*5.4;
        flow.xz+=coarse.xz*2.1;
        float turbulence=fbm(flow+vec3(7.,-11.,3.));
        float fine=n3(flow*2.73-8.);
        float edge=smoothstep(${variant === 2 ? '.065,.36' : '.015,.25'},body+(turbulence-.5)*${variant === 2 ? '.44' : '.18'});
        float flameRoot=smoothstep(0.,.10,flameHeight);
        float volume=edge*flameRoot;
        ${variant === 1 ? `
          float sheet=exp(-pow((skin-(.53+sin(warp.y*7.+turbulence*5.-clockTime*2.)*.14))/.24,2.));
          volume*=.17+sheet*.75+turbulence*.15;
          float heat=clamp(sheet*.46+body*.45+turbulence*.23-.08,0.,1.);
        ` : `
          float tear=smoothstep(.24,.57,turbulence+body*.20);
          volume*=tear*(.35+fine*.7);
          float heat=clamp(body*.68+turbulence*.50-.11,0.,1.);
        `}
        return vec3(volume,heat,flameHeight);
      }

      // A thin sheath of combustion hugs the log surface and lifts off its upper side.
      vec2 contactFire(vec3 p) {
        if(p.y>1.9)return vec2(0.);
        float density=0.,heat=0.;
        float burningPatch=smoothstep(.40,.72,fbm(p*8.+vec3(13.,13.-uTime*2.8,13.)));
        for(int i=0;i<7;i++) {
          vec3 a=uLogA[i].xyz,b=uLogB[i].xyz,axis=b-a;
          float t=clamp(dot(p-a,axis)/dot(axis,axis),0.,1.);
          vec3 center=mix(a,b,t),q=p-center;
          float radius=mix(uLogA[i].w,uLogB[i].w,t);
          float surface=length(q)-radius;
          float upper=smoothstep(-.05,.22,q.y);
          float d=exp(-pow((surface-.032)/.052,2.))*upper*burningPatch*smoothstep(.04,.24,t)*(1.-smoothstep(.80,.98,t));
          density=max(density,d*.34);heat=max(heat,d*.52);
        }
        return vec2(density,heat);
      }

      void main() {
        vec3 ro=cameraPosition,rd=normalize(vPosition-ro);
        vec2 hit=boxHit(ro,rd,uLo,uHi);float start=max(hit.x,0.),end=hit.y;
        vec2 screen=gl_FragCoord.xy/uResolution;
        float depth=texture2D(uDepth,screen).r;
        vec4 view=uInvProjection*vec4(screen*2.-1.,depth*2.-1.,1.);view/=view.w;
        vec3 opaque=(uCameraWorld*view).xyz;end=min(end,dot(opaque-ro,rd));
        if(end<=start)discard;
        float ds=(end-start)/96.;
        // A restrained offset avoids the sparkling silhouettes of the first study.
        float jitter=.5+(hash(vec3(gl_FragCoord.xy,22.))-.5)*.28;
        vec4 sum=vec4(0.);
        for(int j=0;j<96;j++) {
          vec3 p=ro+rd*(start+(float(j)+jitter)*ds);
          vec3 sampleField=field(p);vec2 contact=contactFire(p);
          float density=max(sampleField.x,contact.x);
          if(density<.002)continue;
          float heat=max(sampleField.y,contact.y);
          vec3 color=mix(vec3(.95,.026,.001),vec3(1.72,.29,.008),smoothstep(.04,.45,heat));
          color=mix(color,vec3(2.65,1.18,.19),smoothstep(.35,.80,heat));
          color=mix(color,vec3(3.1,2.05,.70),smoothstep(.73,1.,heat));
          float blue=(1.-smoothstep(.25,.54,p.y))*(1.-smoothstep(.20,.58,heat));
          color=mix(color,vec3(.045,.16,.68),blue*.7);
          float alpha=1.-exp(-density*ds*${variant === 1 ? '4.25' : '4.3'});
          sum.rgb+=(1.-sum.a)*alpha*color;sum.a+=(1.-sum.a)*alpha;
          if(sum.a>.98)break;
        }
        if(sum.a<.004)discard;
        gl_FragColor=vec4(sum.rgb/max(sum.a,.001),sum.a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;mesh.renderOrder = 2;
  return mesh;
}
