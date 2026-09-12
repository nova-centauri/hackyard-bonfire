import * as THREE from 'three';

// Incandescent interiors show through a cooler, broken shell of charcoal.
export function createCoalMaterial(mode, animated = false) {
  const material = new THREE.MeshStandardMaterial({ color: '#66514a', emissive: '#ff590b', emissiveIntensity: animated ? 1.95 : mode === 4 ? 2.1 : 1.3, roughness: .94, flatShading: mode === 1 });
  Object.assign(material.userData, { bedAsh: { value: 0 }, time: { value: 0 }, heat: { value: 1 }, impact: { value: 0 } });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uBedAsh: material.userData.bedAsh, uCoalTime: material.userData.time, uCoalTemperature: material.userData.heat, uCoalImpact: material.userData.impact });
    shader.vertexShader = 'varying vec3 vCoalSurface,vCoalOffset;varying float vCoalHeat;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoalSurface=position;vCoalOffset=instanceMatrix[3].xyz*2.73;vCoalHeat=.55+instanceColor.r*1.5;');
    shader.fragmentShader = `varying vec3 vCoalSurface,vCoalOffset;varying float vCoalHeat;
      uniform float uBedAsh,uCoalTime,uCoalTemperature,uCoalImpact;
      vec3 coalHash(vec3 p){return fract(sin(vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))))*43758.5453);}
      vec2 coalCells(vec3 p){vec3 cell=floor(p),f=fract(p);float first=8.,second=8.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 b=vec3(float(x),float(y),float(z)),r=b+coalHash(cell+b)-f;float d=dot(r,r);if(d<first){second=first;first=d;}else if(d<second)second=d;}return vec2(sqrt(first),sqrt(second));}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 cells=coalCells(vCoalSurface*3.2+vCoalOffset);
      float vein=cells.y-cells.x;
      float aa=max(fwidth(vein)*.65,.006);
      float crack=1.-smoothstep(.025-aa,.11+aa,vein);
      float halo=1.-smoothstep(.06,.26,vein);
      float crust=smoothstep(.5,.86,cells.x)*smoothstep(-.5,.4,vCoalSurface.y);
      float breath=.86+.10*sin(uCoalTime*1.4+vCoalOffset.x*3.)+.04*sin(uCoalTime*3.1+vCoalOffset.z*6.);
      float heat=clamp(uCoalTemperature*vCoalHeat*breath+uCoalImpact*.25,0.,1.);
      vec3 ember=mix(vec3(.70,.012,.001),vec3(1.5,.12,.003),smoothstep(.12,.7,heat));
      ember=mix(ember,vec3(2.0,.48,.025),crack*smoothstep(.55,1.,heat));
      totalEmissiveRadiance=emissive.r*ember*(.035+halo*.10+crack*.76)*(1.-crust*.68)*breath*vCoalHeat;
      diffuseColor.rgb*=.35+smoothstep(.02,.22,vein)*.45;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.235,.21),max(crust*.4,uBedAsh*.85));
    `);
  };
  material.customProgramCacheKey = () => 'incandescent-coal-2';
  return material;
}
