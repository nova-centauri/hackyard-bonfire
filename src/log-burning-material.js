// Surface state is fixed to the wood's material coordinates, so a hot face
// remains the same face when a piece rolls. The atlas stores thermal state,
// not a painted light projected from the fire.
export function burningMaterial(base, uniforms, cap = false) {
  const material = base.clone();
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vBurnPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurnPosition=position;');
    shader.fragmentShader = `varying vec3 vBurnPosition;
      uniform float uWood,uHeat,uChar,uBurnSlot,uBurnLength,uBurnTime,uLocalizedBurn;
      uniform sampler2D uBurnMap;
      float burnHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float burnNoise(vec2 p,float wrap){
        vec2 i=floor(p),j=i+1.,f=fract(p);f=f*f*(3.-2.*f);
        if(wrap>0.){i.x=mod(i.x,wrap);j.x=mod(j.x,wrap);}
        return mix(mix(burnHash(i),burnHash(vec2(j.x,i.y)),f.x),mix(burnHash(vec2(i.x,j.y)),burnHash(j),f.x),f.y);
      }
      vec3 charCells(vec2 p,float wrap){
        vec2 cell=floor(p),f=fract(p);float first=8.,second=8.,plate=0.;
        for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
          vec2 b=vec2(float(x),float(y)),id=cell+b;
          if(wrap>0.)id.x=mod(id.x,wrap);
          id+=vec2(uBurnSlot*17.13,uBurnSlot*9.71);
          vec2 jitter=vec2(burnHash(id),burnHash(id+vec2(43.1,17.9)));
          // Sites can nearly touch; weighted distances give the remaining
          // plates uneven areas instead of one similarly sized tile per cell.
          vec2 r=b+.04+jitter*.92-f;float d=dot(r,r)+burnHash(id+71.3)*.26;
          if(d<first){second=first;first=d;plate=burnHash(id+6.7);}else second=min(second,d);
        }
        return vec3(sqrt(first),sqrt(second)-sqrt(first),plate);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float angle=atan(vBurnPosition.z,vBurnPosition.x);
      float along=clamp(vBurnPosition.y/max(.01,uBurnLength)+.5,0.,1.);
      vec4 surfaceState=vec4(uHeat,uWood,uChar,0.);
      if(uLocalizedBurn>.5)surfaceState=texture2D(uBurnMap,vec2(fract(angle/6.2831853)+.0625,(uBurnSlot*5.+clamp(along*5.,.5,4.5))/35.));
      float localHeat=surfaceState.x,localWood=surfaceState.y,localChar=surfaceState.z;
      float grain=burnNoise(vec2(angle/6.2831853*108.,vBurnPosition.y*3.5)+vec2(0.,uBurnSlot*7.13),108.);
      float fineGrain=sin(angle*53.+sin(vBurnPosition.y*12.)*.6)*.06;
      float burnFront=clamp((1.-localWood)*1.7,0.,1.);
      float burnMask=smoothstep(grain*.26,grain*.26+.32,burnFront);
      vec2 cellPosition=${cap ? 'vBurnPosition.xz*24.' : 'vec2(angle/6.2831853*18.,vBurnPosition.y*8.5)'};
      // Warp in material space at two scales. The angular noise periods divide
      // the circumference exactly, including across the back of a rolled log.
      vec2 noiseOffset=vec2(0.,uBurnSlot*11.37);
      vec2 coarsePosition=cellPosition*vec2(1./6.,.19)+noiseOffset;
      float broadGrain=burnNoise(coarsePosition,${cap ? '0.' : '3.'});
      float crossGrain=burnNoise(coarsePosition+vec2(1.7,9.2),${cap ? '0.' : '3.'});
      float splinterGrain=burnNoise(cellPosition*vec2(1./3.,.43)+noiseOffset+vec2(2.1,3.8),${cap ? '0.' : '6.'});
      cellPosition+=(vec2(broadGrain,crossGrain)-.5)*1.8+(splinterGrain-.5)*vec2(.38,-.32);
      vec3 cells=charCells(cellPosition,${cap ? '0.' : '18.'});
      float aa=max(fwidth(cells.y)*.55,.003);
      float crackWidth=mix(.62,1.42,splinterGrain);
      float plateFace=smoothstep(.030*crackWidth-aa,.110*crackWidth+aa,cells.y);
      float fissureHalo=1.-smoothstep(.045*crackWidth,.20*crackWidth,cells.y);
      vec3 fresh=${cap ? 'diffuseColor.rgb*1.2' : 'mix(vec3(.105,.065,.033),vec3(.38,.27,.15),grain+fineGrain)'};
      vec3 charcoal=vec3(.019,.013,.009)*(.5+plateFace*.85+grain*.45);
      diffuseColor.rgb=mix(fresh,charcoal,burnMask);
      float ashDust=(1.-smoothstep(0.,.035,localWood))*(1.-smoothstep(0.,.025,localChar));
      float crust=smoothstep(.75,.98,cells.z)*(1.-smoothstep(.5,.88,localHeat));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.24,.225,.195),max(ashDust,crust*burnMask)*.8);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float incandescent=smoothstep(.27,.86,localHeat)*burnMask*smoothstep(.005,.07,localChar+burnFront*.10);
      // Heat varies slowly. Motion of the gas never scrolls this cracked surface.
      float emberBreath=.97+.03*sin(uBurnTime*.71+cells.z*19.+uBurnSlot*2.1);
      // Shared, larger heat patches keep adjacent plates related in color;
      // tiny grain variation breaks up their otherwise flat colored centers.
      float emberHeat=clamp(localHeat*(.72+broadGrain*.20+cells.z*.08),0.,1.);
      vec3 emberColor=mix(vec3(.65,.008,.0005),vec3(2.4,.13,.003),smoothstep(.28,.72,emberHeat));
      emberColor=mix(emberColor,vec3(3.8,.48,.012),smoothstep(.68,.98,emberHeat)*(.22+fissureHalo*.78));
      // Hot plates glow throughout; narrow, deeply recessed fissures stay dark.
      float plateLight=plateFace*smoothstep(.14,.42,broadGrain*.7+cells.z*.3)*(.50+cells.z*.32+grain*.18)*(1.-crust*.9);
      totalEmissiveRadiance=emberColor*plateLight*incandescent*emberBreath*(1.-ashDust)*.72;
    `);
  };
  material.customProgramCacheKey = () => `localized-ember-plates-${cap ? 'end' : 'bark'}-2`;
  return material;
}
