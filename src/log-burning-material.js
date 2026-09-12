// Surface state is fixed to the wood's material coordinates, so a hot face
// remains the same face when a piece rolls. The atlas stores thermal state,
// not a painted light projected from the fire.

// The procedural char glow ignores the material's emissive map. When an
// authored emissive mask (white where cracks should shine) has been loaded for
// a slot, its flag is raised and the glow concentrates along those cracks.
// Shared uniforms, so raising a flag needs no recompile.
export const authoredEmissive = Object.freeze({ bark: { value: 0 }, end: { value: 0 } });

export function burningMaterial(base, uniforms, surface = 'bark') {
  const cap = surface === 'end', exposed = surface !== 'bark';
  const material = base.clone();
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uBurnSeed = uniforms.uBurnSeed || { value: 0 };
    shader.uniforms.uAuthoredEmissive = cap ? authoredEmissive.end : authoredEmissive.bark;
    shader.vertexShader = 'varying vec3 vBurnPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurnPosition=position;');
    shader.fragmentShader = `varying vec3 vBurnPosition;
      uniform float uWood,uHeat,uChar,uBurnSlot,uBurnSeed,uBurnLength,uBurnTime,uLocalizedBurn,uAuthoredEmissive,uAshPath;
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
          id+=vec2(uBurnSeed*17.13,uBurnSeed*9.71);
          vec2 jitter=vec2(burnHash(id),burnHash(id+vec2(43.1,17.9)));
          // Sites can nearly touch; weighted distances give the remaining
          // plates uneven areas instead of one similarly sized tile per cell.
          vec2 r=b+.04+jitter*.92-f;float d=dot(r,r)+burnHash(id+71.3)*.26;
          if(d<first){second=first;first=d;plate=burnHash(id+6.7);}else second=min(second,d);
        }
        return vec3(sqrt(first),sqrt(second)-sqrt(first),plate);
      }
      vec3 charReliefNormal(vec3 viewPosition,vec3 surfaceNormal,float height,float side){
        vec3 dx=dFdx(viewPosition),dy=dFdy(viewPosition);
        vec3 rx=cross(dy,surfaceNormal),ry=cross(surfaceNormal,dx);
        float determinant=dot(dx,rx)*side;
        vec3 gradient=sign(determinant)*(dFdx(height)*rx+dFdy(height)*ry);
        return normalize(max(abs(determinant),1e-10)*surfaceNormal-gradient);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float angle=atan(vBurnPosition.z,vBurnPosition.x);
      float along=clamp(vBurnPosition.y/max(.01,uBurnLength)+.5,0.,1.);
      vec4 surfaceState=vec4(uHeat,uWood,uChar,0.);
      if(uLocalizedBurn>.5)surfaceState=texture2D(uBurnMap,vec2(fract(angle/6.2831853)+.0625,(uBurnSlot*5.+clamp(along*5.,.5,4.5))/35.));
      float localHeat=surfaceState.x,localWood=surfaceState.y,localChar=surfaceState.z;
      float grain=burnNoise(vec2(angle/6.2831853*108.,vBurnPosition.y*3.5)+vec2(0.,uBurnSeed*7.13),108.);
      float fineGrain=sin(angle*53.+sin(vBurnPosition.y*12.)*.6)*.06;
      float burnFront=clamp((1.-localWood)*1.7,0.,1.);
      // End grain is planar; every long surface (including sawn boards) must
      // vary along the length of the wood instead of extruding an end pattern.
      vec2 cellPosition=${cap ? 'vBurnPosition.xz*24.' : 'vec2(angle/6.2831853*18.,vBurnPosition.y*5.8)'};
      // Warp in material space at two scales. The angular noise periods divide
      // the circumference exactly, including across the back of a rolled log.
      vec2 noiseOffset=vec2(0.,uBurnSeed*11.37);
      vec2 coarsePosition=cellPosition*vec2(1./6.,.19)+noiseOffset;
      float broadGrain=burnNoise(coarsePosition,${cap ? '0.' : '3.'});
      float crossGrain=burnNoise(coarsePosition+vec2(1.7,9.2),${cap ? '0.' : '3.'});
      float splinterGrain=burnNoise(cellPosition*vec2(1./3.,.43)+noiseOffset+vec2(2.1,3.8),${cap ? '0.' : '6.'});
      // A ragged carbonization front leaves islands of bark and scorched wood.
      float frontThreshold=.06+broadGrain*.22+grain*.09;
      float burnMask=smoothstep(frontThreshold,frontThreshold+.27,burnFront);
      cellPosition+=(vec2(broadGrain,crossGrain)-.5)*1.8+(splinterGrain-.5)*vec2(.38,-.32);
      vec3 cells=charCells(cellPosition,${cap ? '0.' : '18.'});
      float aa=max(fwidth(cells.y)*.55,.003);
      float crackWidth=mix(.62,1.42,splinterGrain);
      float plateFace=smoothstep(.030*crackWidth-aa,.110*crackWidth+aa,cells.y);
      float fissureHalo=1.-smoothstep(.045*crackWidth,.20*crackWidth,cells.y);
      vec3 woodTone=mix(vec3(.105,.065,.033),vec3(.38,.27,.15),grain+fineGrain);
      vec3 fresh=${exposed ? 'diffuseColor.rgb*1.2' : 'mix(woodTone,diffuseColor.rgb,.62)'};
      fresh=mix(fresh,fresh*vec3(.42,.32,.24),smoothstep(.02,.32,burnFront)*.7);
      vec3 charcoal=vec3(.019,.013,.009)*(.5+plateFace*.85+grain*.45);
      vec3 spent=uAshPath>.5?vec3(.42,.40,.36):charcoal;
      diffuseColor.rgb=mix(fresh,spent,burnMask);
      float ashDust=(1.-smoothstep(0.,.035,localWood))*(1.-smoothstep(0.,.025,localChar));
      float crust=smoothstep(.64,.89,splinterGrain*.55+cells.z*.45)*(1.-smoothstep(.5,.88,localHeat));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.24,.225,.195),max(ashDust,crust*burnMask)*.8);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Char plates lift above their checks, catching the moving firelight even
      // after they stop glowing. This layers over authored bark normals.
      float charRelief=plateFace*(.65+cells.z*.35)*burnMask*.003*(1.-uAshPath);
      normal=charReliefNormal(-vViewPosition,normal,charRelief,faceDirection);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // Adjacent plates share hot patches but cross the glow threshold at
      // different times. Warm wood stays dark until its char is incandescent.
      float coolPatch=1.-(broadGrain*.65+cells.z*.35);
      float incandescent=smoothstep(.34+coolPatch*.14,.82+coolPatch*.10,localHeat)*burnMask*smoothstep(.005,.07,localChar+burnFront*.10);
      // Heat varies slowly. Motion of the gas never scrolls this cracked surface.
      float emberBreath=.96+.025*sin(uBurnTime*.71+cells.z*19.+uBurnSeed*2.1)+.015*sin(uBurnTime*.31+broadGrain*13.);
      // Shared, larger heat patches keep adjacent plates related in color;
      // tiny grain variation breaks up their otherwise flat colored centers.
      float emberHeat=clamp(localHeat*(.62+broadGrain*.26+cells.z*.12),0.,1.);
      vec3 emberColor=mix(vec3(.65,.008,.0005),vec3(2.4,.13,.003),smoothstep(.28,.72,emberHeat));
      emberColor=mix(emberColor,vec3(3.8,.48,.012),smoothstep(.68,.98,emberHeat)*(.22+fissureHalo*.78));
      // Hot plates glow throughout; narrow, deeply recessed fissures stay dark.
      float plateLight=plateFace*smoothstep(.14,.42,broadGrain*.7+cells.z*.3)*(.50+cells.z*.32+grain*.18)*(1.-crust*.9);
      #ifdef USE_EMISSIVEMAP
        // An authored crack mask (the sampled emissive texel) concentrates the
        // glow along the painted fissures; plate faces dim, cracks brighten.
        plateLight*=mix(1.,.45+1.25*smoothstep(.05,.55,emissiveColor.r),uAuthoredEmissive);
      #endif
      totalEmissiveRadiance=emberColor*plateLight*incandescent*emberBreath*(1.-ashDust)*.72;
    `);
  };
  material.customProgramCacheKey = () => `localized-ember-plates-${surface}-5`;
  return material;
}
