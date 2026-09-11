import * as THREE from 'three';

export function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function canvas(size) {
  const el = document.createElement('canvas'); el.width = el.height = size;
  return [el, el.getContext('2d')];
}
function texture(el) {
  const t = new THREE.CanvasTexture(el); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function woodTextures(seed = 5, mode = 0) {
  const rand = random(seed), size = 1024;
  const [bark, b] = canvas(size), [emission, e] = canvas(size);
  b.fillStyle = '#080604'; b.fillRect(0, 0, size, size);
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  const rows=27,cols=24,cells=[];
  for(let y=-2;y<=rows+2;y++)for(let x=-2;x<=cols+2;x++)cells.push({x:x+.1+rand()*.8,y:y+.1+rand()*.8,t:rand(),ix:x,iy:y});
  const grid=new Map(cells.map(c=>[`${c.ix},${c.iy}`,c]));
  const pixels=b.createImageData(size,size),glow=e.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=x/size*cols,py=y/size*rows;let d1=9,d2=9,nearest;
    for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){
      const c=grid.get(`${Math.floor(px)+xx},${Math.floor(py)+yy}`),d=(px-c.x)**2+(py-c.y)**2;
      if(d<d1){d2=d1;d1=d;nearest=c;}else if(d<d2)d2=d;
    }
    const edge=Math.sqrt(d2)-Math.sqrt(d1),plate=Math.min(1,edge*17),grain=(Math.sin(x*.8+Math.sin(y*.1))+rand()*3)*1.5;
    const ash=mode===4?1.45:mode===2?2.5:1,shade=(9+plate*(15+nearest.t*33)+grain)*ash;
    const i=(y*size+x)*4;pixels.data[i]=shade*1.12;pixels.data[i+1]=shade;pixels.data[i+2]=shade*.87;pixels.data[i+3]=255;
    const patch=Math.max(0,Math.sin(px*.8+Math.sin(py*.53))*Math.cos(py*.7)*.65+.26);
    const heat=Math.pow(Math.sin(y/size*Math.PI),1.5)*patch;
    const crack=Math.pow(Math.max(0,1-edge*42),.65)*heat;
    glow.data[i]=Math.min(255,crack*750);glow.data[i+1]=crack*85;glow.data[i+2]=crack*9;glow.data[i+3]=255;
  }
  b.putImageData(pixels,0,0);e.putImageData(glow,0,0);
  for(let i=0;i<28000;i++) {
    const n = rand(); b.fillStyle = n>.65 ? 'rgba(208,199,176,.13)' : 'rgba(0,0,0,.19)';
    b.fillRect(rand()*size,rand()*size,rand()*2+1,rand()*5+1);
  }
  const [end, c] = canvas(512), [endGlow, g] = canvas(512);
  const gr = c.createRadialGradient(256,256,5,256,256,258);
  gr.addColorStop(0,mode===4?'#716254':'#866a47'); gr.addColorStop(.74,'#68543d'); gr.addColorStop(.9,'#2e261d'); gr.addColorStop(1,'#0e100e');
  c.fillStyle=gr;c.fillRect(0,0,512,512);g.fillStyle='#000';g.fillRect(0,0,512,512);
  for(let ring=10;ring<253;ring+=7+rand()*8) {
    c.beginPath();
    for(let a=0;a<Math.PI*2+.05;a+=.04) {
      const r=ring+Math.sin(a*5+ring)*2+Math.cos(a*9)*1.6;
      const x=256+Math.cos(a)*r,y=256+Math.sin(a)*r*.99;
      if(a===0)c.moveTo(x,y);else c.lineTo(x,y);
    }
    c.strokeStyle=`rgba(17,12,8,${.16+rand()*.35})`;c.lineWidth=1+rand()*3;c.stroke();
  }
  for(let k=0;k<13;k++) {
    const a=rand()*Math.PI*2, begin=30+rand()*150;
    for(const ctx of [c,g]) {
      ctx.beginPath();
      for(let r=begin;r<258;r+=10) {
        const theta=a+Math.sin(r*.035+k)*.017;
        const x=256+Math.cos(theta)*r,y=256+Math.sin(theta)*r;
        if(r===begin)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=ctx===c?'#160d08': k%3===0?'#f25c10':'#641203';ctx.lineWidth=ctx===c?2.5+rand()*4:1.6;ctx.stroke();
    }
  }
  for(let i=0;i<8000;i++){c.fillStyle=rand()>.5?'#b9a4851a':'#100b0833';c.fillRect(rand()*512,rand()*512,1,1);}
  return { bark: texture(bark), emission: texture(emission), end: texture(end), endGlow: texture(endGlow) };
}

export function cloudTexture() {
  const size = 128, data = new Uint8Array(size*size*4), rand=random(810);
  const spots=Array.from({length:22},()=>[rand()*.8+.1,rand()*.8+.1,rand()*.2+.05]);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,rad=Math.hypot(u-.5,v-.5)*2;
    let field=0;
    for(const [sx,sy,sr] of spots)field+=Math.exp(-((u-sx)**2+(v-sy)**2)/(sr*sr)*3)*.4;
    const a=Math.max(0,1-rad*rad)*Math.min(1,field)*.8;
    const i=(y*size+x)*4;data[i]=255;data[i+1]=255;data[i+2]=255;data[i+3]=a*255;
  }
  const t=new THREE.DataTexture(data,size,size);t.needsUpdate=true;return t;
}
