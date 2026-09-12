import * as THREE from 'three';

const noise = `
float hash(vec3 p) { p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 p) {
 vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { return noise3(p)*.57+noise3(p*2.03+9.2)*.28+noise3(p*4.09-3.8)*.15; }
vec2 boxHit(vec3 ro,vec3 rd,vec3 lo,vec3 hi) { vec3 a=(lo-ro)/rd,b=(hi-ro)/rd;vec3 c=min(a,b),d=max(a,b);return vec2(max(max(c.x,c.y),c.z),min(min(d.x,d.y),d.z)); }
`;

export function createVolume(kind, config, depthTexture) {
 const smoke=kind==='smoke';
 const bounds=smoke?[new THREE.Vector3(-2.7,.7,-2.5),new THREE.Vector3(3.7,6.8,2.5)]:[new THREE.Vector3(-1.8,.12,-1.8),new THREE.Vector3(1.8,4.3*config.flameScale,1.8)];
 const size=bounds[1].clone().sub(bounds[0]);
 const geometry=new THREE.BoxGeometry(size.x,size.y,size.z);geometry.translate(...bounds[0].clone().add(bounds[1]).multiplyScalar(.5).toArray());
 const material=new THREE.ShaderMaterial({
   transparent:true,depthWrite:false,depthTest:false,side:THREE.BackSide,
   uniforms:{uDepth:{value:depthTexture},uResolution:{value:new THREE.Vector2()},uInvProjection:{value:new THREE.Matrix4()},uCameraWorld:{value:new THREE.Matrix4()},uLo:{value:bounds[0]},uHi:{value:bounds[1]},uSeed:{value:config.seed},uScale:{value:config.flameScale},uMode:{value:config.mode},uSmokeColor:{value:new THREE.Color(config.smoke)},uTime:{value:0},uSmokeAmount:{value:1}},
   vertexShader:`varying vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`precision highp float;
     varying vec3 vPosition;
     uniform sampler2D uDepth;
     uniform vec2 uResolution;
     uniform mat4 uInvProjection,uCameraWorld;
     uniform vec3 uLo,uHi,uSmokeColor;
     uniform float uSeed,uScale,uTime,uSmokeAmount;
     uniform int uMode;
     ${noise}
     float flame(vec3 p) {
       p.y/=uScale;
       float envelope=0.;
       for(int i=0;i<13;i++) {
         float fi=float(i), angle=fi*2.39996+uSeed;
         float height= i==0?3.8:i<7?2.0+hash(vec3(fi,uSeed,8.)) * 1.5:.65+hash(vec3(fi,uSeed,8.))*1.1;
         float h=(p.y-.22)/height;
         if(h>0. && h<1.) {
           vec2 origin=vec2(sin(angle),cos(angle))*(i==0?.12:i<7?.62:.98);
           vec2 bend=vec2(sin(h*7.+fi*2.),cos(h*5.+fi))*h*.38;
           float radius=(.62+hash(vec3(fi,1.,uSeed))*.2)*pow(1.-h,.92);
           float r=length(p.xz-origin-bend);
           envelope=max(envelope,1.-r/max(.01,radius));
         }
       }
       vec3 q=p*vec3(3.8,2.5,3.8)+vec3(0,uSeed,0);
       q.xz+=vec2(noise3(p*2.+uSeed),noise3(p*2.-uSeed))*.8;
       float n=fbm(q);
       float fine=noise3(q*2.7+9.);
       return max(0.,envelope-(n*.86+.035))*(.8+fine*.5);
     }
     void main() {
       vec3 ro=cameraPosition,rd=normalize(vPosition-ro);
       vec2 hit=boxHit(ro,rd,uLo,uHi);
       float start=max(0.,hit.x),end=hit.y;
       vec2 screen=gl_FragCoord.xy/uResolution;
       float depth=texture2D(uDepth,screen).x;
       vec4 view=uInvProjection*vec4(screen*2.-1.,depth*2.-1.,1.);view/=view.w;
       vec3 opaque=(uCameraWorld*view).xyz;
       end=min(end,dot(opaque-ro,rd));
       if(end<=start) discard;
       vec4 sum=vec4(0.);
       float stepSize=(end-start)/${smoke?'52.':'88.'};
       float jitter=hash(vec3(gl_FragCoord.xy,uSeed));
       for(int i=0;i<${smoke?'52':'88'};i++) {
         vec3 p=ro+rd*(start+(float(i)+jitter)*stepSize);
         ${smoke?`
         float h=(p.y-.8)/5.8;
         vec2 center=vec2(.12+.52*h+sin(h*8.-uTime*.35)*.3,cos(h*6.-uTime*.28)*.22);
         float radius=.38+h*.84;
         float envelope=exp(-dot(p.xz-center,p.xz-center)/(radius*radius)*2.2);
         float cloud=fbm(p*vec3(2.2,1.5,2.2)+vec3(uSeed+uTime*.035,-uTime*.58,0));
         float density=max(0.,cloud-.29)*envelope*smoothstep(.9,2.8,p.y)*(1.-smoothstep(4.4,6.7,p.y))*(uMode==2?.55:uMode==3?.5:1.)*uSmokeAmount;
         float alpha=1.-exp(-density*stepSize*1.28);
         vec3 color=mix(vec3(.36,.23,.14),uSmokeColor,smoothstep(1.,3.8,p.y));
         color*=.8+cloud*.65;
         // Only the lower smoke catches the firelight; the plume disappears into night.
         if(uMode==5){
           float firelight=exp(-max(0.,p.y-1.3)*.9);
           color=mix(vec3(.018,.022,.027),vec3(.40,.19,.065),firelight)*(.75+cloud*.35);
           alpha*=1.-smoothstep(3.4,6.2,p.y);
         }
         `:`
         float density=flame(p);
         float heat=clamp(density*2.3,0.,1.);
         vec3 color=mix(vec3(1.,.045,.001),vec3(1.65,.34,.012),smoothstep(.05,.52,heat));
         color=mix(color,vec3(2.8,1.72,.5),smoothstep(.43,1.,heat));
         float blue=(1.-smoothstep(.24,.63,p.y/uScale))*(1.-smoothstep(.05,.29,density));
         color=mix(color,vec3(.09,.32,1.5),blue*.72);
         float alpha=1.-exp(-density*stepSize*7.5);
         `}
         sum.rgb+=(1.-sum.a)*alpha*color;sum.a+=(1.-sum.a)*alpha;
         if(sum.a>.985)break;
       }
       if(sum.a<.003)discard;
       gl_FragColor=vec4(sum.rgb/max(sum.a,.001),sum.a);
     }`
 });
 const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=smoke?4:2;
 return mesh;
}
