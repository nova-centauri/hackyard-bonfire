import './style.css';
import { studies } from './styles.js';
import { BonfireViewer } from './scene.js';
import { mountBurnPanel } from './burn-panel.js';
import { FireAudio } from './fire-audio.js';
import { FirePoker } from './fire-poker.js';
import { mountFocusMode } from './focus-mode.js';
import { isTier } from './quality.js';
import { loadPreferences, savePreferences } from './preferences.js';

const flameIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2c1 6-6 7-5 12 1-2 3-3 4-5 0 3 5 5 5 8a5 5 0 0 1-10 0c-2-6 4-9 6-15Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const resetIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10a8 8 0 1 1 .8 6M4 4v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const focusIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const gearIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9.5 3-.6 2.2-1.7 1L5 5.6 2.5 9.9 4.1 11v2l-1.6 1.1L5 18.4l2.2-.6 1.7 1 .6 2.2h5l.6-2.2 1.7-1 2.2.6 2.5-4.3-1.6-1.1v-2l1.6-1.1L19 5.6l-2.2.6-1.7-1-.6-2.2h-5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>';
const addFuelIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const soundIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="sound-muted" d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
document.querySelector('#app').innerHTML=`
 <header class="masthead"><a class="wordmark" href="/" aria-label="Bonfire home">${flameIcon}<span>BONFIRE</span></a><div class="header-label">Studies in fire<span class="slash"> / </span><span class="quiet">Refining the atmosphere</span></div><span class="edition" id="edition">VOLUME 02</span><div class="header-controls"><div id="audio-controls" class="audio-controls" role="group" aria-label="Fire audio"></div><button id="focus-mode" class="focus-toggle" aria-pressed="false" title="Hide menus and focus on the fire">${focusIcon}<span>Focus mode</span></button></div></header>
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
 <footer><span>FLAME, WOOD & EVERYTHING BETWEEN</span><span>Three.js <span class="footer-dot">·</span> 360° studies</span></footer>
 <div id="focus-controls" class="focus-controls" role="group" aria-label="Focus mode controls" hidden><button id="add-fuel-focus" class="restore-menus" aria-label="Add a random piece of fuel" title="Add a random piece of fuel">${addFuelIcon}</button><button id="restore-menus" class="restore-menus" aria-label="Exit focus mode and show menus" title="Show menus (Esc)">${gearIcon}</button></div>`;

let viewer,current;
const preferences=loadPreferences();
let awaitingSoundGesture=preferences.sound;
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
 button.querySelector('span').textContent=enabled?'Sound on':'Sound off';
 button.setAttribute('aria-pressed',String(enabled));
 button.setAttribute('aria-label',enabled?'Mute fire sound':'Enable fire sound');
 const status=document.querySelector('#sound-status');
 if(!status.dataset.error)status.textContent=!enabled?(awaitingSoundGesture?'Click or tap anywhere to resume the campfire sound':'Enable gentle campfire sound'):!current?.animated?'Still study · sound paused':viewer?.paused?'Paused with the fire':'Soft crackles & settling wood';
}
function mountAudioControls(){
 const volume=Math.round(viewer.audio.volume*100);
 document.querySelector('#audio-controls').innerHTML=`<button id="sound-toggle" class="sound-toggle" aria-pressed="false" aria-label="Enable fire sound" aria-describedby="sound-status">${soundIcon}<span>Sound off</span></button><label class="audio-volume" for="sound-volume"><span>Volume</span><input id="sound-volume" type="range" min="0" max="100" value="${volume}" aria-label="Fire sound volume" aria-valuetext="${volume}%"><output id="sound-volume-value" aria-hidden="true">${volume}%</output></label><span id="sound-status" class="audio-status" aria-live="polite">Enable gentle campfire sound</span>`;
 const enableSound=async enabled=>{
  const status=document.querySelector('#sound-status');delete status.dataset.error;
  awaitingSoundGesture=false;
  try{await viewer.audio.setEnabled(enabled);savePreferences({sound:viewer.audio.enabled});}
  catch(error){console.warn('Fire audio unavailable:',error);status.dataset.error='true';status.textContent='Sound unavailable in this browser';}
  updateAudioControl();
 };
 document.querySelector('#sound-toggle').addEventListener('click',()=>enableSound(!viewer.audio.enabled));
 document.querySelector('#sound-volume').addEventListener('input',event=>{
  viewer.audio.setVolume(Number(event.target.value)/100);savePreferences({volume:viewer.audio.volume});
  document.querySelector('#sound-volume-value').value=`${event.target.value}%`;
  event.target.setAttribute('aria-valuetext',`${event.target.value}%`);
 });
 // Browsers only start audio from a user gesture. If sound was on last time,
 // the first click, tap or key anywhere brings it back without a second ask.
 if(preferences.sound){
  updateAudioControl();
  const resume=event=>{
   if(event.target.closest?.('#audio-controls'))return;
   document.removeEventListener('pointerdown',resume,true);document.removeEventListener('keydown',resume,true);
   if(!viewer.audio.enabled)enableSound(true);
  };
  document.addEventListener('pointerdown',resume,true);document.addEventListener('keydown',resume,true);
 }
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
 // ?quality=low pins a level-of-detail tier for testing; otherwise the
 // governor chooses from window size and measured frame pacing.
 const forcedQuality=new URLSearchParams(location.search).get('quality');
 if(isTier(forcedQuality))viewer.lockQuality(forcedQuality);
 viewer.onQualityChange=(tier,settings)=>{const stage=document.querySelector('.stage');stage.dataset.qualityTier=tier;stage.dataset.qualityReason=viewer.governor.reason;console.info(`Bonfire quality: ${settings.label} (${viewer.governor.reason})`);};
 viewer.poker=new FirePoker(viewer);
 viewer.audio=new FireAudio();
 viewer.audio.setVolume(preferences.volume);
 mountAudioControls();
 viewer.setAutoFeed(preferences.autoFeed);
 const updateBurnPanel=mountBurnPanel(viewer,{onAutoFeed:autoFeed=>savePreferences({autoFeed})});
 viewer.onError=message=>{const loading=document.querySelector('#loading');loading.textContent=message;loading.hidden=false;};
 viewer.onPlaybackChange=updateMotionControl;
 viewer.onRender=()=>{
  if(!viewer.shaderErrors.length)document.querySelector('#loading').hidden=true;
  const stage=document.querySelector('.stage');stage.dataset.ready='true';
  stage.dataset.animation=current?.animated?(viewer.paused?'paused':'playing'):'still';
  stage.dataset.sceneTime=viewer.current.animationTime.toFixed(3);
  stage.dataset.frameCount=viewer.frameCount;
  stage.dataset.renderSize=`${viewer.renderSize.x}x${viewer.renderSize.y}`;
  stage.dataset.qualityTier=viewer.governor.tier;stage.dataset.fireSteps=viewer.current.volumes.find(v=>v.userData.volumeKind==='fire')?.material.uniforms.uSteps?.value??'';
  stage.dataset.drawCalls=viewer.renderer.info.render.calls;
  stage.dataset.depthPasses=viewer.depthPassCount;
  stage.dataset.shaderErrors=viewer.shaderErrors.length;
  stage.dataset.impactCount=viewer.current.burnVisuals?.impactSerial||0;
  stage.dataset.impactEmbers=viewer.current.burnVisuals?.embers.length||0;
  stage.dataset.visibleFlame=(viewer.current.cycle?.visibleFlame??0).toFixed(3);
  stage.dataset.flameSources=viewer.current.volumes.find(v=>v.material.uniforms.uFuel)?.material.uniforms.uFuel.value.map(v=>v.toFixed(3)).join(',')||'';
  stage.dataset.fragments=viewer.current.burnVisuals?.settling?.fragments?.length||0;
  stage.dataset.coalCount=viewer.current.coals.count;
  stage.dataset.ashCoverage=(viewer.current.ashBed?.userData.ashState?.amount||0).toFixed(3);
  stage.dataset.coalHeat=viewer.current.coals.userData.coalState?.pieces.map(p=>p.heat.toFixed(3)).join(',')||'';
  stage.dataset.audioState=viewer.audio?.context?.state||'off';
  stage.dataset.audioRecording=viewer.audio?.recordingStatus||'idle';
  updateBurnPanel();
 };
 loadStudy(resolveStudy());
 mountFocusMode(viewer,{initial:preferences.focus,onChange:active=>savePreferences({focus:active})});
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
