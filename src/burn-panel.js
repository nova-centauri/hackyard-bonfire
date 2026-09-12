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
      <div class="core-health">
        <div class="core-readout"><span class="eyebrow">CORE HEAT</span><strong id="core-heat-value">0<span>%</span></strong><span id="core-heat-status"></span></div>
        <div class="core-gauge"><div id="core-heat-meter" class="core-track" role="meter" aria-label="Core heat" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="core-heat-fill"></i></div><div class="core-scale"><span>Cold</span><span>Warming</span><span>Healthy</span><span>Very hot</span></div></div>
        <div class="core-guidance"><span id="core-heat-note"></span><span id="core-burn-effect" title="Effect of core heat on fuel consumption. Each log’s moisture and density also affect how fast it burns."></span></div>
      </div>
      <div class="burn-meta">
        <label class="feed-switch"><input id="auto-feed" type="checkbox" checked> Feed waiting logs</label>
        <span id="feed-status"></span>
        <span class="burn-cadence">Speed changes the burn clock; flame motion stays natural.</span>
      </div>
      <div class="fuel-timeline" aria-label="Individual log timeline">${Array.from({ length: 7 }, (_, i) => `
        <article class="fuel-card" data-log-slot="${i}"><div class="fuel-title"><span class="fuel-name">LOG ${String(i + 1).padStart(2, '0')}</span><span class="fuel-phase"></span></div><div class="fuel-track"><i class="wood-level"></i><i class="char-level"></i></div><div class="fuel-detail"></div><div class="fuel-moisture"><span>Moisture</span><span class="moisture-value"></span></div><div class="moisture-track" aria-hidden="true"><i></i></div></article>`).join('')}
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
    const coreHeat = cycle.coreHeat ?? cycle.coalHeat, heat = Math.round(coreHeat * 100);
    const coreStatus = cycle.coreStatus ?? 'Warming';
    panel.dataset.coreHeat = coreHeat.toFixed(4); panel.dataset.coreStatus = coreStatus;
    document.querySelector('#core-heat-value').innerHTML = `${heat}<span>%</span>`;
    document.querySelector('#core-heat-status').textContent = coreStatus;
    document.querySelector('#core-heat-fill').style.width = `${heat}%`;
    const meter = document.querySelector('#core-heat-meter');
    meter.setAttribute('aria-valuenow', heat); meter.setAttribute('aria-valuetext', `${heat} percent, ${coreStatus.toLowerCase()}`);
    document.querySelector('#core-heat-note').textContent = {
      Cold: 'Cold bed · fresh wood needs an ignition source.',
      Fading: 'Weak heat · the fire needs tending.',
      Warming: 'Moderate heat · damp wood takes longer to catch.',
      Healthy: 'Useful heat · logs catch as they dry.',
      'Very hot': 'Strong heat · logs consume fuel faster.',
    }[coreStatus];
    document.querySelector('#core-burn-effect').textContent = `Heat effect on burn rate ${(cycle.burnRateMultiplier ?? 1).toFixed(2)}×`;
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
      const moisture = Math.round(log.moisture * 100), condition = moisture < 8 ? 'Dry' : moisture < 22 ? 'Damp' : 'Wet';
      card.dataset.moisture = log.moisture.toFixed(4); card.dataset.condition = condition;
      card.querySelector('.moisture-value').textContent = log.phase === 'ash' ? '—' : `${moisture}% · ${condition.toLowerCase()}`;
      card.querySelector('.fuel-moisture').title = log.phase === 'ash' ? 'No wood remains' : `Started at ${Math.round((log.initialMoisture ?? log.moisture) * 100)}% moisture. Wet wood uses heat to dry before it can burn strongly.`;
      card.querySelector('.moisture-track i').style.width = log.phase === 'ash' ? '0%' : `${moisture}%`;
      card.setAttribute('aria-label', `Log ${log.id}: ${PHASE_LABELS[log.phase]}, ${Math.round((log.wood + log.char) * 100)} percent fuel remaining${log.phase === 'ash' ? '' : `, ${moisture} percent moisture, ${condition.toLowerCase()}`}`);
    });
    if (cycle.revision !== lastRevision || cycle.seed !== lastSeed) {
      document.querySelector('.burn-events').innerHTML = cycle.events.slice(0, 3).map(event => `<li><time>${formatTime(event.time)}</time><span>${event.title}<small>${event.detail}</small></span></li>`).join('');
      lastRevision = cycle.revision; lastSeed = cycle.seed;
    }
  }
  viewer.onLifecycleChange = () => update(true);
  return update;
}
