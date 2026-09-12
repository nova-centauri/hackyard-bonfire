import * as THREE from 'three';
import { random } from './textures.js';
import { inkFlameSources } from './hybrid-fire.js';

// Rising embers live entirely on the GPU: two draw calls (soft dots and short
// motion trails) replace 130 CPU-animated points and 24 separate line objects.
// Every ember is a pure function of time and its seed, so nothing is uploaded
// per frame. Embers emit from the actual flame roots: the uniform arrays are
// shared by reference with the volumetric fire, so a rolled-away or spent log
// stops shedding sparks the moment its flame source goes out.
export const EMBER_COUNT = 360, TRAIL_COUNT = 48;

const emberFunctions = /* glsl */`
  uniform float uTime,uPower,uCoalHeat,uDensity,uImpact,uPixelScale;
  uniform vec3 uWind;
  uniform vec4 uSources[12];
  uniform float uFuel[12];
  float emberHash(float n){return fract(sin(n)*43758.5453);}
  // seed = (phase, pace, sway, order); returns world position, and writes the
  // normalized age plus a visibility factor for the caller.
  vec3 emberPosition(vec4 seed, int sourceIndex, float time, out float age, out float visible) {
    vec4 source=uSources[sourceIndex];
    float fuel=uFuel[sourceIndex];
    float life=2.4+seed.z*2.6;
    age=fract(seed.x+time/life);
    // Weak fires shed fewer embers: each ember has its own heat threshold.
    float heat=clamp(fuel*1.3,0.,1.)*clamp(uPower*1.25+uCoalHeat*.15,0.,1.);
    visible=step(seed.w,uDensity)*step(.015,fuel)*step(seed.y*.95,heat);
    float angle=seed.x*6.2831853+seed.y*12.;
    vec3 p=source.xyz+vec3(cos(angle),0.,sin(angle))*(.05+.18*seed.z);
    // Buoyant rise that slows as the ember cools, then wanders in the plume.
    float rise=source.w*(1.0+seed.y*1.4)*(.8+.2*uPower);
    float eased=1.-pow(1.-age,1.55);
    p.y+=eased*rise+.08;
    float spread=age*age;
    p.x+=sin(age*9.+seed.x*40.)*spread*.28+sin(age*3.7+seed.y*21.)*age*.13+uWind.x*age*age*1.7;
    p.z+=cos(age*7.3+seed.z*40.)*spread*.24+cos(age*4.6+seed.x*33.)*age*.11+uWind.z*age*age*1.7;
    return p;
  }
  vec3 emberColor(float age, vec4 seed, float time, out float alpha) {
    // Cools from near-white through orange to a dull red before winking out.
    float temperature=(1.-age)*(.72+.28*emberHash(seed.x*7.1+seed.z));
    float flicker=.74+.26*sin(time*(9.+seed.y*11.)+seed.x*50.);
    vec3 color=mix(vec3(1.2,.07,.004),vec3(2.7,.55,.035),smoothstep(.12,.55,temperature));
    color=mix(color,vec3(3.3,1.8,.55),smoothstep(.62,.96,temperature));
    alpha=smoothstep(0.,.05,age)*(1.-smoothstep(.5,1.,age))*flicker*(1.+uImpact*.3);
    return color;
  }
`;

export function createEmbers({ seed = 22, sources = null, fuel = null, count = EMBER_COUNT, trails = TRAIL_COUNT } = {}) {
  const rand = random(seed + 9101);
  const sourceValues = sources || inkFlameSources(seed).map(s => new THREE.Vector4(s.base.x, s.base.y, s.base.z, s.height));
  const uniforms = {
    uTime: { value: 0 }, uPower: { value: 1 }, uCoalHeat: { value: 1 }, uDensity: { value: 1 }, uImpact: { value: 0 }, uPixelScale: { value: 600 },
    uWind: { value: new THREE.Vector3() }, uSources: { value: sourceValues }, uFuel: { value: fuel || Array(12).fill(1) },
  };
  const seeds = (n, perItem) => {
    const seedArray = new Float32Array(n * perItem * 4), sourceArray = new Float32Array(n * perItem);
    for (let i = 0; i < n; i++) {
      const values = [rand(), rand(), rand(), rand()], source = Math.floor(rand() * 12);
      for (let k = 0; k < perItem; k++) { seedArray.set(values, (i * perItem + k) * 4); sourceArray[i * perItem + k] = source; }
    }
    return { seedArray, sourceArray };
  };
  const dotSeeds = seeds(count, 1), dots = new THREE.BufferGeometry();
  dots.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  dots.setAttribute('aSeed', new THREE.Float32BufferAttribute(dotSeeds.seedArray, 4));
  dots.setAttribute('aSource', new THREE.Float32BufferAttribute(dotSeeds.sourceArray, 1));
  const points = new THREE.Points(dots, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute vec4 aSeed;attribute float aSource;varying vec3 vColor;varying float vAlpha;
      ${emberFunctions}
      void main(){
        float age,visible;
        vec3 p=emberPosition(aSeed,int(aSource+.5),uTime,age,visible);
        float alpha;vColor=emberColor(age,aSeed,uTime,alpha);vAlpha=alpha*visible;
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        float size=(.011+aSeed.w*.019)*(1.-age*.35);
        gl_PointSize=visible>0.?clamp(size*uPixelScale/max(.3,-mv.z),1.,14.):0.;
      }`,
    fragmentShader: /* glsl */`varying vec3 vColor;varying float vAlpha;
      void main(){
        if(vAlpha<=0.)discard;
        float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
        float glow=exp(-r*r*4.5),core=1.-smoothstep(.08,.5,r);
        gl_FragColor=vec4(vColor*(glow*.55+core),glow*vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  points.frustumCulled = false; points.name = 'Rising embers';
  const trailSeeds = seeds(trails, 2), lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(trails * 2 * 3), 3));
  lines.setAttribute('aSeed', new THREE.Float32BufferAttribute(trailSeeds.seedArray, 4));
  lines.setAttribute('aSource', new THREE.Float32BufferAttribute(trailSeeds.sourceArray, 1));
  lines.setAttribute('aTrail', new THREE.Float32BufferAttribute(Float32Array.from({ length: trails * 2 }, (_, i) => i % 2), 1));
  const streaks = new THREE.LineSegments(lines, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute vec4 aSeed;attribute float aSource,aTrail;varying vec3 vColor;varying float vAlpha;
      ${emberFunctions}
      void main(){
        // The tail vertex is the same ember a moment earlier: a motion trail.
        float age,visible;
        vec3 p=emberPosition(aSeed,int(aSource+.5),uTime-aTrail*.055,age,visible);
        float alpha;vColor=emberColor(age,aSeed,uTime,alpha);vAlpha=alpha*visible*.7*(1.-aTrail*.8);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: /* glsl */`varying vec3 vColor;varying float vAlpha;
      void main(){if(vAlpha<=0.)discard;gl_FragColor=vec4(vColor,vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  streaks.frustumCulled = false; streaks.name = 'Ember trails';
  const group = new THREE.Group(); group.name = 'Embers'; group.add(points, streaks);
  return Object.assign(group, { uniforms, points, streaks,
    setDensity(density) { uniforms.uDensity.value = THREE.MathUtils.clamp(density, 0, 1); },
    dispose() { dots.dispose(); lines.dispose(); points.material.dispose(); streaks.material.dispose(); } });
}
