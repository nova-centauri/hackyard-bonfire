import * as THREE from 'three';

// Steam and moisture leaving the log ends: one instanced billboard draw for all
// puffs instead of one sprite draw per puff. Motion, growth, fade and rotation
// are functions of time in the vertex shader; the CPU only tells the shader
// where each log's end is and how much it is steaming.
export function createSteam({ logs = 7, perLog = 15, map, color = '#c0cace', opacity = .21 } = {}) {
  const count = logs * perLog;
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('position', quad.attributes.position); geometry.setAttribute('uv', quad.attributes.uv); geometry.setIndex(quad.index);
  const logIndex = new Float32Array(count), phase = new Float32Array(count);
  for (let li = 0; li < logs; li++) for (let k = 0; k < perLog; k++) { logIndex[li * perLog + k] = li; phase[li * perLog + k] = k / Math.max(1, perLog - 1); }
  geometry.setAttribute('aLog', new THREE.InstancedBufferAttribute(logIndex, 1));
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geometry.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 }, uMap: { value: map }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
    uOrigins: { value: Array.from({ length: logs }, () => new THREE.Vector3()) },
    uStrength: { value: new Float32Array(logs).fill(1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute float aLog,aPhase;
      uniform float uTime;uniform vec3 uOrigins[${logs}];uniform float uStrength[${logs}];
      varying vec2 vUv;varying float vAlpha;
      void main(){
        int index=int(aLog+.5);
        float age=fract(aPhase+uTime*.27);
        vec3 p=uOrigins[index]+vec3(sin(age*7.+aLog-uTime*.3)*.12*age,.1+age*.95,cos(age*5.+aLog)*.06*age);
        float fade=min(1.,age/.05)*min(1.,(1.-age)/.2);
        vAlpha=fade*(1.-age*.5)*uStrength[index];
        float scale=.09+age*.39,rotation=age*3.+aLog+uTime*.12,c=cos(rotation),s=sin(rotation);
        vec2 corner=position.xy*scale;corner=vec2(corner.x*c-corner.y*s,corner.x*s+corner.y*c);
        vec4 mv=modelViewMatrix*vec4(p,1.);mv.xy+=corner;
        gl_Position=projectionMatrix*mv;vUv=uv;
      }`,
    fragmentShader: /* glsl */`uniform sampler2D uMap;uniform vec3 uColor;uniform float uOpacity;varying vec2 vUv;varying float vAlpha;
      void main(){float a=texture2D(uMap,vUv).a*vAlpha*uOpacity;if(a<.002)discard;gl_FragColor=vec4(uColor,a);
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
