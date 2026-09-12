import * as THREE from 'three';

// Steam and moisture leaving the log ends: one instanced billboard draw for all
// wisps instead of one sprite draw per puff. Motion, growth, fade and rotation
// are functions of time in the vertex shader; the CPU only tells the shader
// where each log's end is, how much it is steaming, and the shared wind.
export function createSteam({ logs = 7, perLog = 15, map, color = '#818986', opacity = .085 } = {}) {
  const count = logs * perLog;
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('position', quad.attributes.position); geometry.setAttribute('uv', quad.attributes.uv); geometry.setIndex(quad.index);
  const logIndex = new Float32Array(count), phase = new Float32Array(count), seed = new Float32Array(count * 2);
  for (let li = 0; li < logs; li++) for (let k = 0; k < perLog; k++) {
    const index = li * perLog + k;
    logIndex[index] = li;
    // Half-open phases avoid placing both the first and last wisp at age zero.
    // Each log starts elsewhere in the cycle, while its wisps stay evenly spaced.
    phase[index] = (k / perLog + li * .61803398875) % 1;
    seed[index * 2] = ((index + 1) * .75487766625) % 1;
    seed[index * 2 + 1] = ((index + 1) * .56984029099) % 1;
  }
  geometry.setAttribute('aLog', new THREE.InstancedBufferAttribute(logIndex, 1));
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
  geometry.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 }, uMap: { value: map }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uWind: { value: new THREE.Vector2() },
    uOrigins: { value: Array.from({ length: logs }, () => new THREE.Vector3()) },
    uStrength: { value: new Float32Array(logs).fill(1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute float aLog,aPhase;attribute vec2 aSeed;
      uniform float uTime;uniform vec2 uWind;uniform vec3 uOrigins[${logs}];uniform float uStrength[${logs}];
      varying vec2 vUv;varying float vAlpha,vAge,vSeed;
      void main(){
        int index=int(aLog+.5);
        float age=fract(aPhase+uTime*(.24+fract(aLog*.37)*.018));
        vec2 curl=vec2(sin(age*5.+aLog*1.7-uTime*.18),cos(age*4.+aLog))*(.028+age*.035)*age;
        vec3 p=uOrigins[index]+vec3(curl.x,.02+age*1.02,curl.y);
        p.xz+=uWind*(age*.14+age*age*.34);
        float fade=smoothstep(0.,.11,age)*(1.-smoothstep(.52,1.,age));
        vAlpha=fade*uStrength[index]*(.86+aSeed.y*.14);vAge=age;vSeed=aSeed.x;
        // Tall, overlapping wisps dissolve into a shared flow instead of round beads.
        float scale=(.15+age*.34)*(.9+aSeed.x*.2);
        float rotation=sin(age*3.+aLog*1.3-uTime*.12)*.2+(aSeed.y-.5)*.18,c=cos(rotation),s=sin(rotation);
        vec2 corner=position.xy*vec2(scale,scale*1.9);corner=vec2(corner.x*c-corner.y*s,corner.x*s+corner.y*c);
        vec4 mv=modelViewMatrix*vec4(p,1.);mv.xy+=corner;
        gl_Position=projectionMatrix*mv;vUv=uv;
      }`,
    fragmentShader: /* glsl */`uniform sampler2D uMap;uniform vec3 uColor;uniform float uOpacity,uTime;varying vec2 vUv;varying float vAlpha,vAge,vSeed;
      void main(){
        vec2 q=vUv*2.-1.;
        q.x+=sin(q.y*3.+vAge*4.-uTime*.25+vSeed*6.283)*.11*(1.-q.y*q.y);
        float radius=dot(q,q);
        float soft=exp(-radius*3.8)*(1.-smoothstep(.55,1.,radius));
        // Authored alpha has dense islands. Let it modulate a continuous soft
        // field rather than expose the outline of each repeated sprite.
        float detail=.84+texture2D(uMap,vUv).a*.16;
        float a=1.-exp(-soft*detail*vAlpha*uOpacity);
        if(a<.0008)discard;gl_FragColor=vec4(uColor,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.name = 'Log-end steam';
  return Object.assign(mesh, { uniforms, logs,
    setOrigin(index, position) { if (index < logs) uniforms.uOrigins.value[index].copy(position); },
    setStrength(index, strength) { if (index < logs) uniforms.uStrength.value[index] = THREE.MathUtils.clamp(strength, 0, 1); },
  });
}
