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
  // Three resolved octaves retain folds without paying for subpixel detail.
  float fbm(vec3 p) {return n3(p)*.57+n3(p*2.03+7.7)*.28+n3(p*4.11-5.3)*.15;}
  vec2 boxHit(vec3 ro,vec3 rd,vec3 lo,vec3 hi) {vec3 a=(lo-ro)/rd,b=(hi-ro)/rd,c=min(a,b),d=max(a,b);return vec2(max(max(c.x,c.y),c.z),min(min(d.x,d.y),d.z));}
`;

export function createHybridFire(config, depthTexture, logDefs) {
  const variant = config.fireVariant;
  const sources = inkFlameSources(config.seed);
  const lo = new THREE.Vector3(-2.15, -.32, -2.15), hi = new THREE.Vector3(2.35, 4.55, 2.15);
  // Bounds follow the actual burning pieces, including logs that roll out of
  // the stack. The unit box is expanded in the vertex shader.
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
    uniforms: {
      uDepth: { value: depthTexture }, uResolution: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uInvProjection: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() },
      uLo: { value: lo }, uHi: { value: hi },
      uCoreHeat: { value: 0 }, uFreshFuel: { value: 0 },
      uBurnMap: { value: null }, uLocalizedBurn: { value: 0 },
      uLogBasisX: { value: Array.from({ length: 7 }, () => new THREE.Vector3(1, 0, 0)) },
      uLogBasisZ: { value: Array.from({ length: 7 }, () => new THREE.Vector3(0, 0, 1)) },
      uSourceMotion: { value: sources.map(() => new THREE.Vector4(0, 0, 1, 1)) },
      uIntensity: { value: 1 }, uImpact: { value: 0 }, uFuel: { value: Array(12).fill(1) }, uLogHeat: { value: Array(7).fill(1) },
      uSources: { value: sources.map(s => new THREE.Vector4(...s.base.toArray(), s.height)) },
      uShapes: { value: sources.map(s => new THREE.Vector4(s.width, s.lean.x, s.lean.y, s.phase)) },
      uLogA: { value: logDefs.map(d => new THREE.Vector4(...d[0], d[2])) },
      uLogB: { value: logDefs.map(d => new THREE.Vector4(...d[1], d[2] * .9)) },
    },
    vertexShader: 'uniform vec3 uLo,uHi;varying vec3 vPosition;void main(){vPosition=mix(uLo,uHi,position+.5);gl_Position=projectionMatrix*modelViewMatrix*vec4(vPosition,1.);}',
    fragmentShader: `precision highp float;
      varying vec3 vPosition;
      uniform sampler2D uDepth,uBurnMap;
      uniform vec2 uResolution;
      uniform float uTime,uIntensity,uImpact,uCoreHeat,uFreshFuel,uLocalizedBurn,uFuel[12],uLogHeat[7];
      uniform mat4 uInvProjection,uCameraWorld;
      uniform vec3 uLo,uHi,uLogBasisX[7],uLogBasisZ[7];
      uniform vec4 uSources[12],uShapes[12],uSourceMotion[12],uLogA[7],uLogB[7];
      ${noise}

      // Neighboring tongues share rising eddies. Their gas moves through a
      // stable root, rather than the complete silhouette swaying like a flag.
      vec3 field(vec3 p) {
        float clockTime=uTime;
        float cleanCore=smoothstep(.58,.92,uCoreHeat)*(1.-uFreshFuel);
        vec3 drift=vec3(clockTime*.035,-clockTime*1.15,clockTime*.025);
        vec2 coarse=vec2(n3(p*1.8+drift+3.1),n3(p*1.8+drift-12.7))-.5;
        vec3 warp=p;
        warp.xz+=coarse*${variant === 2 ? '.31' : '.19'};
        float body=0., flameHeight=0., skin=0.;
        for(int i=0;i<12;i++) {
          if(uFuel[i]<.015)continue;
          vec4 source=uSources[i],shape=uShapes[i],motion=uSourceMotion[i];
          float height=source.w*motion.z*(1.+uImpact*.09)*(1.-cleanCore*.12);
          float t=(warp.y-source.y)/max(height,.015);
          if(t>0. && t<1.) {
            vec2 center=source.xz+(shape.yz*.70+motion.xy)*t*t;
            ${variant === 2 ? 'center+=vec2(.28,-.06)*t*t;' : ''}
            float radius=shape.x*(.62+.64*sin(3.141593*t))*pow(1.-t,.74)+.001;
            radius*=motion.w;
            // A round 3D cross section has no privileged viewing direction.
            // The advected domain warp makes irregular folds in every axis.
            vec2 local=warp.xz-center;
            float d=length(local)/max(radius*${variant === 2 ? '1.18' : '1.10'},.005);
            float envelope=max(0.,1.-d)*min(1.,uFuel[i]*1.65);
            if(envelope>body){flameHeight=t;skin=d;}
            body=max(body,envelope)+min(body,envelope)*.10;
          }
        }
        if(body<.001)return vec3(0.);
        vec3 flow=warp*vec3(8.4,3.8,8.4);
        flow.y-=clockTime*5.8;
        flow.xz+=coarse*1.2;
        float turbulence=fbm(flow+vec3(7.,-11.,3.));
        ${variant === 2 ? 'float fine=n3(flow*1.93-8.);' : ''}
        float edge=smoothstep(${variant === 2 ? '.045,.34' : '.02,.28'},body+(turbulence-.5)*${variant === 2 ? '.38' : '.23'});
        float flameRoot=smoothstep(0.,.075,flameHeight);
        float volume=edge*flameRoot;
        ${variant === 1 ? `
          // Luminous reaction zones wrap around transparent gas. They are
          // actual volumetric shells, never camera-facing or crossed cards.
          float reaction=exp(-pow((skin-(.55+(turbulence-.5)*.32))/.25,2.));
          volume*=.10+reaction*.72+turbulence*.12;
          float heat=clamp(reaction*.29+body*.43+turbulence*.31-.08-flameHeight*.16,0.,1.);
        ` : `
          float tear=smoothstep(.23,.57,turbulence+body*.25);
          volume*=tear*(.37+fine*.38);
          float heat=clamp(body*.65+turbulence*.44-.10-flameHeight*.20,0.,1.);
        `}
        // Char combustion exposes the incandescent wood. Fresh volatile gas
        // restores luminous yellow/orange folds above the newly lit surface.
        float coreWindow=1.-smoothstep(.12,.52,flameHeight);
        volume*=1.-cleanCore*(.18+coreWindow*.32);
        volume*=.68+.32*clamp(uIntensity,0.,1.);
        return vec3(volume,heat,flameHeight);
      }

      // A thin sheath of combustion hugs the log surface and lifts off its upper side.
      vec2 contactFire(vec3 p) {
        float density=0.;
        for(int i=0;i<7;i++) {
          if(uLogHeat[i]<.02)continue;
          vec3 a=uLogA[i].xyz,b=uLogB[i].xyz,axis=b-a;
          float t=clamp(dot(p-a,axis)/max(dot(axis,axis),.0001),0.,1.);
          vec3 center=mix(a,b,t),q=p-center;
          float radius=mix(uLogA[i].w,uLogB[i].w,t);
          float surface=length(q)-radius;
          // The sheath is thin: skip its exponential and all texture noise
          // outside the surface band, including empty space between logs.
          if(surface<-.11 || surface>.18 || q.y<-.05)continue;
          float visibleFlame=uLogHeat[i];
          if(uLocalizedBurn>.5) {
            float angle=atan(dot(q,uLogBasisZ[i]),dot(q,uLogBasisX[i]));
            vec2 uv=vec2(fract(angle/6.2831853)+.0625,(float(i)*5.+clamp(t*5.,.5,4.5))/35.);
            visibleFlame=texture2D(uBurnMap,uv).w;
          }
          if(visibleFlame<.008)continue;
          float upper=smoothstep(-.05,.20,q.y);
          float d=exp(-pow((surface-.028)/.046,2.))*upper;
          density=max(density,d*.25*visibleFlame);
        }
        if(density<.002)return vec2(0.);
        float burningPatch=smoothstep(.40,.72,fbm(p*vec3(8.,4.,8.)+vec3(13.,13.-uTime*4.8,13.)));
        density*=burningPatch;
        return vec2(density,density*(.48/.25));
      }

      void main() {
        if(uIntensity<.001)discard;
        vec3 ro=cameraPosition,rd=normalize(vPosition-ro);
        vec2 hit=boxHit(ro,rd,uLo,uHi);float start=max(hit.x,0.),end=hit.y;
        vec2 screen=gl_FragCoord.xy/uResolution;
        float depth=texture2D(uDepth,screen).r;
        vec4 view=uInvProjection*vec4(screen*2.-1.,depth*2.-1.,1.);view/=view.w;
        vec3 opaque=(uCameraWorld*view).xyz;end=min(end,dot(opaque-ro,rd));
        if(end<=start)discard;
        float ds=(end-start)/88.;
        // A restrained offset avoids the sparkling silhouettes of the first study.
        float jitter=.5+(hash(vec3(gl_FragCoord.xy,22.))-.5)*.28;
        vec4 sum=vec4(0.);
        for(int j=0;j<88;j++) {
          vec3 p=ro+rd*(start+(float(j)+jitter)*ds);
          vec3 sampleField=field(p);vec2 contact=contactFire(p);
          float density=max(sampleField.x,contact.x);
          if(density<.002)continue;
          float heat=max(sampleField.y,contact.y);
          // A broad heat palette: deep red wisps, copper folds, honey and ivory cores.
          vec3 color=mix(vec3(.82,.008,.001),vec3(1.65,.15,.003),smoothstep(.02,.38,heat));
          color=mix(color,vec3(2.5,.76,.055),smoothstep(.32,.69,heat));
          color=mix(color,vec3(3.0,1.95,.60),smoothstep(.61,.88,heat));
          color=mix(color,vec3(3.2,2.85,1.9),smoothstep(.86,1.,heat));
          float root=(1.-smoothstep(.04,.17,sampleField.z))*step(.004,sampleField.x);
          float blue=max(root*.65,contact.x*.8)*(1.-smoothstep(.35,.68,heat));
          color=mix(color,vec3(.10,.24,1.15),blue*.62);
          color*=1.+uImpact*.16;
          float alpha=1.-exp(-density*ds*${variant === 1 ? '3.65' : '3.8'});
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
  // Coherent value noise is sampled once per draw instead of for every ray
  // sample. Each source has its own phase and pace; none snap on frame changes.
  const hash1 = n => { const value = Math.sin(n * 127.1 + config.seed * .13) * 43758.5453; return value - Math.floor(value); };
  const smoothNoise = x => { const cell = Math.floor(x), f = x - cell, blend = f * f * (3 - 2 * f); return hash1(cell) * (1 - blend) + hash1(cell + 1) * blend; };
  mesh.onBeforeRender = () => {
    const u = material.uniforms, time = u.uTime.value;
    lo.set(Infinity, Infinity, Infinity); hi.set(-Infinity, -Infinity, -Infinity);
    let active = false;
    for (let i = 0; i < sources.length; i++) {
      const phase = 13.73 * i + config.seed, pace = .32 + (i % 5) * .027;
      const breath = smoothNoise(time * pace + phase);
      u.uSourceMotion.value[i].set((smoothNoise(time * .23 + phase + 17) - .5) * .34,
        (smoothNoise(time * .19 + phase - 23) - .5) * .30, .90 + breath * .20, .92 + breath * .16);
      if (u.uFuel.value[i] < .015) continue;
      active = true;
      const source = u.uSources.value[i], shape = u.uShapes.value[i];
      const reach = shape.x * 1.5 + Math.hypot(shape.y, shape.z) * .7 + .50;
      lo.x = Math.min(lo.x, source.x - reach); lo.z = Math.min(lo.z, source.z - reach); lo.y = Math.min(lo.y, source.y - .2);
      hi.x = Math.max(hi.x, source.x + reach); hi.z = Math.max(hi.z, source.z + reach); hi.y = Math.max(hi.y, source.y + source.w * 1.22 + .12);
    }
    for (let i = 0; i < logDefs.length; i++) {
      if (u.uLogHeat.value[i] < .02) continue;
      active = true;
      for (const point of [u.uLogA.value[i], u.uLogB.value[i]]) {
        const radius = point.w + .2;
        lo.x = Math.min(lo.x, point.x - radius); lo.y = Math.min(lo.y, point.y - radius); lo.z = Math.min(lo.z, point.z - radius);
        hi.x = Math.max(hi.x, point.x + radius); hi.y = Math.max(hi.y, point.y + radius); hi.z = Math.max(hi.z, point.z + radius);
      }
    }
    if (!active) { lo.set(-.1, -.1, -.1); hi.set(.1, .1, .1); }
  };
  return mesh;
}
