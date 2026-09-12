import './style.css';
import { studies } from './styles.js';
import { BonfireViewer } from './scene.js';
import { mountBurnPanel } from './burn-panel.js';
import { FireAudio } from './fire-audio.js';

const flameIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2c1 6-6 7-5 12 1-2 3-3 4-5 0 3 5 5 5 8a5 5 0 0 1-10 0c-2-6 4-9 6-15Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const resetIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10a8 8 0 1 1 .8 6M4 4v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
document.querySelector('#app').innerHTML=`
 <header class="masthead"><a class="wordmark" href="/" aria-label="Bonfire home">${flameIcon}<span>BONFIRE</span></a><div class="header-label">Studies in fire<span class="slash"> / </span><span class="quiet">Refining the atmosphere</span></div><span class="edition" id="edition">VOLUME 02</span></header>
 <main>
  <section class="stage" aria-label="Bonfire rendering">
   <div id="canvas-container"></div>
   <div class="study-caption"><div id="study-tag" class="eyebrow"></div><h1 id="study-title"></h1><p id="study-description"></p><span id="frozen-label" class="frozen"><span class="pause-icon">Ⅱ</span> A moment, held still</span><button id="motion-toggle" class="motion-toggle" hidden>Pause motion</button></div>
   <div class="stage-index"><span class="index-total">STUDY </span><span id="study-number">07</span></div>
   <details class="layers-panel"><summary>Scene layers <span>＋</span></summary><div class="layer-list">${[['flames','Flames'],['smoke','Smoke'],['steam','Log-end steam'],['sparks','Embers & sparks'],['glow','Fire glow']].map(([id,label])=>`<label><span>${label}</span><input type="checkbox" data-layer="${id}" checked><span class="switch"></span></label>`).join('')}</div></details>
   <div id="loading" class="loading"><span></span>Preparing the fire…</div>
   <div class="stage-bottom"><div class="view-control" role="group" aria-label="Camera views"><span class="view-label">LOOK CLOSER</span><button data-view="full" class="selected" aria-pressed="true">Whole fire</button><button data-view="logs" aria-pressed="false">Logs & flame</button><button data-view="coals" aria-pressed="false">Ember bed</button></div><div class="orbit-help"><span>Drag to orbit <b>·</b> Scroll to explore</span><button id="reset" aria-label="Reset camera" title="Reset camera (0)">${resetIcon}</button></div></div>
  </section>
  <div class="collection-bar"><div role="group" aria-label="Study collection"><button data-collection="refinements" class="selected" aria-pressed="true">Animated studies <span>07—08</span></button><button data-collection="originals" aria-pressed="false">Original studies <span>01—05</span></button></div><span class="collection-note">Ink & Wash foundation · Cinematic atmosphere</span></div>
  <nav class="study-nav" aria-label="Rendering styles"></nav>
 </main>
 <footer><span>FLAME, WOOD & EVERYTHING BETWEEN</span><span>Three.js <span class="footer-dot">·</span> 360° studies</span></footer>`;

let viewer,current;
let selectedCollection='refinements';
const collectionMemory={refinements:'wild-draft',originals:'cinematic'};
function renderNavigation(collection){
 selectedCollection=collection;
 const entries=studies.filter(s=>(s.collection||'originals')===collection);
 const nav=document.querySelector('.study-nav');nav.style.setProperty('--study-count',entries.length);
 nav.classList.toggle('refinements',collection==='refinements');
 nav.innerHTML=entries.map(s=>`<a href="/study/${s.id}" class="study-link" data-study="${s.id}" style="--card-accent:${s.color}"><span class="card-number">${s.number}</span><span class="card-copy"><span class="card-style">${s.style}</span><span class="card-name">${s.name}</span></span><span class="card-indicator" aria-hidden="true">↗</span></a>`).join('');
 document.querySelectorAll('[data-collection]').forEach(b=>{const active=b.dataset.collection===collection;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});
 document.querySelector('.collection-note').textContent=collection==='refinements'?'Whole wood · flame · char · ash':'The first five directions';
 document.querySelector('#edition').textContent=collection==='refinements'?'VOLUME 03':'VOLUME 01';
}
function resolveStudy(){
 const found=studies.find(s=>location.pathname===`/study/${s.id}`);
 if(found)return found;
 const fallback=studies.find(s=>s.id==='wild-draft');
 history.replaceState({},'',`/study/${fallback.id}`);
 return fallback;
}
function updateMotionControl(){
 const button=document.querySelector('#motion-toggle');
 button.hidden=!current?.animated;
 document.querySelector('#frozen-label').hidden=!!current?.animated;
 button.textContent=viewer?.paused?'Play motion':'Pause motion';
 button.setAttribute('aria-label',viewer?.paused?'Play animation':'Pause animation');
 updateAudioControl();
}
function updateAudioControl(){
 const button=document.querySelector('#sound-toggle');
 if(!button)return;
 const enabled=!!viewer?.audio?.enabled;
 button.textContent=enabled?'Sound on':'Sound off';
 button.setAttribute('aria-pressed',String(enabled));
 button.setAttribute('aria-label',enabled?'Mute fire sound':'Enable fire sound');
 document.querySelector('#sound-volume').disabled=!enabled;
 const status=document.querySelector('#sound-status');
 if(!status.dataset.error)status.textContent=!enabled?'Ambience & wood crackles':!current?.animated?'Still study · sound paused':viewer?.paused?'Paused with the fire':'Crackles follow falling logs';
}
function mountAudioControls(){
 document.querySelector('.layers-panel').insertAdjacentHTML('beforeend',`<div class="audio-controls" role="group" aria-label="Fire audio"><button id="sound-toggle" class="sound-toggle" aria-pressed="false" aria-label="Enable fire sound">Sound off</button><label class="audio-volume" for="sound-volume"><span>Volume</span><output id="sound-volume-value" aria-hidden="true">30%</output><input id="sound-volume" type="range" min="0" max="100" value="30" aria-label="Fire sound volume" disabled></label><span id="sound-status" class="audio-status" aria-live="polite">Ambience & wood crackles</span></div>`);
 document.querySelector('#sound-toggle').addEventListener('click',async()=>{
  const status=document.querySelector('#sound-status');delete status.dataset.error;
  try{await viewer.audio.setEnabled(!viewer.audio.enabled);}
  catch(error){console.warn('Fire audio unavailable:',error);status.dataset.error='true';status.textContent='Sound unavailable in this browser';}
  updateAudioControl();
 });
 document.querySelector('#sound-volume').addEventListener('input',event=>{
  viewer.audio.setVolume(Number(event.target.value)/100);
  document.querySelector('#sound-volume-value').value=`${event.target.value}%`;
 });
}
function loadStudy(config){
 current=config;
 const collection=config.collection||'originals';collectionMemory[collection]=config.id;
 renderNavigation(collection);
 document.body.dataset.style=config.id;document.documentElement.style.setProperty('--accent',config.color);
 document.title=`${config.name} — Bonfire`;
 document.querySelector('#study-tag').textContent=config.tag;document.querySelector('#study-title').textContent=config.name;
 document.querySelector('#study-description').textContent=config.description;document.querySelector('#study-number').textContent=config.number;
 document.querySelectorAll('[data-study]').forEach(link=>{const active=link.dataset.study===config.id;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view==='full');b.setAttribute('aria-pressed',b.dataset.view==='full');});
 if(viewer){viewer.load(config);document.querySelectorAll('[data-layer]').forEach(input=>viewer.setLayer(input.dataset.layer,input.checked));}
}
try{
 viewer=new BonfireViewer(document.querySelector('#canvas-container'));
 viewer.audio=new FireAudio();
 mountAudioControls();
 const updateBurnPanel=mountBurnPanel(viewer);
 viewer.onError=message=>{const loading=document.querySelector('#loading');loading.textContent=message;loading.hidden=false;};
 viewer.onPlaybackChange=updateMotionControl;
 viewer.onRender=()=>{
  if(!viewer.shaderErrors.length)document.querySelector('#loading').hidden=true;
  const stage=document.querySelector('.stage');stage.dataset.ready='true';
  stage.dataset.animation=current?.animated?(viewer.paused?'paused':'playing'):'still';
  stage.dataset.sceneTime=viewer.current.animationTime.toFixed(3);
  stage.dataset.frameCount=viewer.frameCount;
  stage.dataset.renderSize=`${viewer.renderSize.x}x${viewer.renderSize.y}`;
  stage.dataset.drawCalls=viewer.renderer.info.render.calls;
  stage.dataset.depthPasses=viewer.depthPassCount;
  stage.dataset.shaderErrors=viewer.shaderErrors.length;
  stage.dataset.impactCount=viewer.current.burnVisuals?.impactSerial||0;
  stage.dataset.impactEmbers=viewer.current.burnVisuals?.embers.length||0;
  stage.dataset.audioState=viewer.audio?.context?.state||'off';
  updateBurnPanel();
 };
 loadStudy(resolveStudy());
 window.bonfire={viewer,studies,get current(){return current.id;}};
}catch(error){
 console.error(error);document.querySelector('#loading').innerHTML='This study needs WebGL 2. Please open it in a browser with hardware acceleration enabled.';
}
document.querySelector('.study-nav').addEventListener('click',e=>{const link=e.target.closest('[data-study]');if(!link||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();history.pushState({},'',link.href);loadStudy(studies.find(s=>s.id===link.dataset.study));});
document.querySelectorAll('[data-collection]').forEach(button=>button.addEventListener('click',()=>{if(selectedCollection===button.dataset.collection)return;const config=studies.find(s=>s.id===collectionMemory[button.dataset.collection]);history.pushState({},'',`/study/${config.id}`);loadStudy(config);}));
addEventListener('popstate',()=>loadStudy(resolveStudy()));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{viewer?.setView(button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',b===button);});}));
document.querySelectorAll('[data-layer]').forEach(input=>input.addEventListener('change',()=>viewer?.setLayer(input.dataset.layer,input.checked)));
document.querySelector('#reset').addEventListener('click',()=>document.querySelector('[data-view="full"]').click());
document.querySelector('#motion-toggle').addEventListener('click',()=>viewer?.setPaused(!viewer.paused));
