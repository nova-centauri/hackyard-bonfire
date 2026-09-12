import { PHASE_LABELS, SPEEDS } from './lifecycle.js';

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds)), h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function mountBurnPanel(viewer) {
  document.querySelector('.stage').insertAdjacentHTML('afterend', `
    <section class="burn-panel" aria-label="Fire lifecycle" hidden>
      <div class="burn-toolbar">
        <div class="burn-heading"><span class="eyebrow">THE BURN CLOCK</span><div><span class="live-coal"></span><strong id="burn-phase" aria-live="polite"></strong><time id="burn-clock">00:00</time></div></div>
        <div class="burn-actions" id="burn-actions">
          <button id="add-log" class="burn-button">＋ Add one log</button>
          <button id="randomize-fire" class="burn-button" title="Reset with new log ages, fuel, moisture, and coal heat">↻ Randomize</button>
          <label class="speed-control">Burn speed<select id="burn-speed" aria-label="Burn speed">${SPEEDS.map(n => `<option value="${n}">${n}×${n === 1 ? ' · real time' : ''}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="burn-meta">
        <div class="coal-meter"><span>Coal heat <b id="coal-heat"></b></span><div><i id="coal-heat-fill"></i></div></div>
        <label class="feed-switch"><input id="auto-feed" type="checkbox" checked> Feed waiting logs</label>
        <span id="feed-status"></span>
        <span class="burn-cadence">Speed changes the burn clock; flame motion stays natural.</span>
      </div>
      <div class="fuel-timeline" aria-label="Individual log timeline">${Array.from({ length: 7 }, (_, i) => `
        <article class="fuel-card" data-log-slot="${i}"><div class="fuel-title"><span class="fuel-name">LOG ${String(i + 1).padStart(2, '0')}</span><span class="fuel-phase"></span></div><div class="fuel-track"><i class="wood-level"></i><i class="char-level"></i></div><div class="fuel-detail"></div></article>`).join('')}
      </div>
      <div class="burn-bottom"><span class="phase-key"><i></i> Wood <i></i> Char <i></i> Ash <span>Whole → dry → flame → char → ash</span></span><span id="burn-seed"></span></div>
      <ol class="burn-events" aria-label="Recent fire events"></ol>
    </section>`);
  document.querySelector('#burn-actions').prepend(document.querySelector('#motion-toggle'));
  const panel = document.querySelector('.burn-panel'), cards = [...document.querySelectorAll('.fuel-card')];
  let lastUpdate = 0, lastRevision = -1, lastSeed = null;
  document.querySelector('#burn-speed').addEventListener('change', e => viewer.setSpeed(Number(e.target.value)));
  document.querySelector('#randomize-fire').addEventListener('click', () => viewer.resetFire());
  document.querySelector('#add-log').addEventListener('click', () => viewer.addLog());
  document.querySelector('#auto-feed').addEventListener('change', e => { viewer.current?.cycle?.setAutoFeed(e.target.checked); update(true); });
  function update(force = false) {
    const cycle = viewer.current?.cycle;
    panel.hidden = !cycle; document.body.dataset.lifecycle = String(!!cycle);
    if (!cycle || (!force && performance.now() - lastUpdate < 220)) return;
    lastUpdate = performance.now();
    panel.dataset.seed = cycle.seed; panel.dataset.burnTime = cycle.time; panel.dataset.phase = cycle.phase;
    panel.dataset.flame = cycle.flame.toFixed(3); panel.dataset.coalHeat = cycle.coalHeat.toFixed(4); panel.dataset.fuel = cycle.fuel.toFixed(4);
    const phase = document.querySelector('#burn-phase'); if (phase.textContent !== cycle.phase) phase.textContent = cycle.phase;
    document.querySelector('#burn-clock').textContent = formatTime(cycle.time);
    document.querySelector('#burn-speed').value = viewer.speed;
    const heat = Math.round(cycle.coalHeat * 100);
    document.querySelector('#coal-heat').textContent = `${heat}%`; document.querySelector('#coal-heat-fill').style.width = `${heat}%`;
    document.querySelector('#auto-feed').checked = cycle.autoFeed;
    document.querySelector('#add-log').disabled = !cycle.canAdd;
    document.querySelector('#add-log').title = cycle.canAdd ? 'Place one whole log on the fire bed' : 'All seven positions are occupied; wait for a log to become ash';
    document.querySelector('#feed-status').textContent = cycle.queued ? `${cycle.queued} waiting · ${cycle.autoFeed ? `next in ${formatTime(cycle.nextFeed - cycle.time)}` : 'feeding paused'}` : cycle.phase==='Cold fire bed' ? 'Fire is out · randomize to start again' : 'Feed complete · letting the fire burn down';
    document.querySelector('#burn-seed').textContent = `START ${cycle.seed.toString(16).toUpperCase().padStart(8, '0')}`;
    let queued = 0;
    cards.forEach((card, i) => {
      const log = cycle.logs[i]; card.dataset.phase = log.phase;
      card.querySelector('.fuel-name').textContent = `LOG ${String(log.id).padStart(2, '0')}`;
      card.querySelector('.fuel-phase').textContent = PHASE_LABELS[log.phase];
      card.querySelector('.wood-level').style.width = `${log.wood * 100}%`;
      card.querySelector('.char-level').style.width = `${log.char * 100}%`;
      card.querySelector('.fuel-detail').textContent = log.phase === 'queued' ? cycle.autoFeed ? `Added in ${formatTime(cycle.nextFeed + queued++ * cycle.feedInterval - cycle.time)}` : 'Whole wood · on hold' : log.phase === 'ash' ? 'Returned to the fire bed' : log.phase === 'cold' ? 'Waiting for heat' : `${Math.round((log.wood + log.char) * 100)}% fuel · ${formatTime(cycle.time - log.addedAt)} on the bed`;
      card.setAttribute('aria-label', `Log ${log.id}: ${PHASE_LABELS[log.phase]}, ${Math.round((log.wood + log.char) * 100)} percent fuel remaining`);
    });
    if (cycle.revision !== lastRevision || cycle.seed !== lastSeed) {
      document.querySelector('.burn-events').innerHTML = cycle.events.slice(0, 3).map(event => `<li><time>${formatTime(event.time)}</time><span>${event.title}<small>${event.detail}</small></span></li>`).join('');
      lastRevision = cycle.revision; lastSeed = cycle.seed;
    }
  }
  viewer.onLifecycleChange = () => update(true);
  return update;
}
