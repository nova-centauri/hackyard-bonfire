// Quiet lifetime counts for the fire. Local totals live on the preferences
// record so they survive a refresh. Site-wide totals are a separate public
// tally (`src/global-stats.js`); this module never writes the burn clock.
//
// Meanings:
//   fires        — burn cycles started. Matches the lifecycle's "A new fire":
//                   opening a living study, Randomize, or changing place.
//                   Refresh starts a new fire. Switching rendering studies that
//                   keep the same pile does not. Still studies have no cycle.
//   pieces       — fuel on the bed: the opening stack plus every later addLog
//                   (queue release, auto-tend, or the plus button). Queued wood
//                   counts when it is placed, not while it waits.
//   burnSeconds  — BurnCycle.time, summed across visits. Burn clock only; the
//                   animation clock and wall time never add to this.
//   tended       — addLog calls with tended:true (a fresh piece because the
//                   fire ran low).
//   pops         — wood pops from the existing pop scheduler (animation clock).
import { loadPreferences, savePreferences, sanitizeStats } from './preferences.js';

const pad = n => String(n).padStart(2, '0');
const ZERO_DELTA = Object.freeze({ fires: 0, pieces: 0, burnSeconds: 0, tended: 0, pops: 0 });
const STATS_ROWS = Object.freeze([
  ['fires', 'Fires', 'Burn cycles started: a new fire on load, Randomize, or changing place', 'Fires started by everyone'],
  ['pieces', 'Fuel', 'Pieces placed on the bed in this browser, including the opening stack', 'Pieces placed on every fire'],
  ['burnSeconds', 'Burned', 'Burn-clock time in this browser, accumulated across visits', 'Burn-clock time across every fire, in whole minutes'],
  ['tended', 'Tended', 'Times a fresh piece was added because the fire ran low', 'Kept in this browser'],
  ['pops', 'Pops', 'Cracks and pops from the wood', 'Kept in this browser'],
]);

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400), h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60, s = total % 60;
  if (d) return `${d}d ${pad(h % 24)}:${pad(m)}:${pad(s)}`;
  if (h) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function formatStat(value, { time = false } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return time ? formatDuration(value) : String(Math.max(0, Math.floor(Number(value))));
}

export function cycleIdentity(cycle) {
  if (!cycle) return null;
  return `${cycle.seed >>> 0}:${cycle.resetSerial >>> 0}`;
}

function sameFire(session, cycle) {
  return session.cycle === cycle && session.resetSerial === cycle.resetSerial;
}

function placed(cycle) {
  if (Number.isFinite(cycle.piecesPlaced)) return Math.max(0, cycle.piecesPlaced);
  return cycle.logs ? cycle.logs.filter(log => log.phase !== 'queued').length : 0;
}

function tended(cycle) {
  return Number.isFinite(cycle.tendedCount) ? Math.max(0, cycle.tendedCount) : 0;
}

export function createFireStats({ storage = globalThis.localStorage, persistBurnEvery = 15 } = {}) {
  const totals = sanitizeStats(loadPreferences(storage).stats);
  const session = {
    cycle: null, resetSerial: -1, lastTime: 0, lastPieces: 0, lastTended: 0,
    popState: null, lastPops: 0, persistedBurn: totals.burnSeconds,
  };

  function persist() {
    savePreferences({ stats: { ...totals } }, storage);
    session.persistedBurn = totals.burnSeconds;
  }

  function maybePersist(discrete) {
    if (discrete || totals.burnSeconds - session.persistedBurn >= persistBurnEvery) persist();
  }

  return {
    snapshot() { return { ...totals }; },
    flush: persist,
    observeCycle(cycle) {
      const before = { ...totals };
      if (!cycle) return { ...ZERO_DELTA };
      if (!sameFire(session, cycle)) {
        totals.fires++;
        totals.pieces += placed(cycle);
        totals.tended += tended(cycle);
        totals.burnSeconds += Math.max(0, cycle.time);
        session.cycle = cycle;
        session.resetSerial = cycle.resetSerial;
        session.lastTime = cycle.time;
        session.lastPieces = placed(cycle);
        session.lastTended = tended(cycle);
        maybePersist(true);
        return {
          fires: totals.fires - before.fires, pieces: totals.pieces - before.pieces,
          burnSeconds: totals.burnSeconds - before.burnSeconds, tended: totals.tended - before.tended, pops: 0,
        };
      }
      const nextPieces = placed(cycle), nextTended = tended(cycle);
      const addedPieces = nextPieces - session.lastPieces;
      const addedTended = nextTended - session.lastTended;
      totals.burnSeconds += Math.max(0, cycle.time - session.lastTime);
      session.lastTime = cycle.time;
      let discrete = false;
      if (addedPieces > 0) { totals.pieces += addedPieces; session.lastPieces = nextPieces; discrete = true; }
      if (addedTended > 0) { totals.tended += addedTended; session.lastTended = nextTended; discrete = true; }
      maybePersist(discrete);
      return {
        fires: 0, pieces: Math.max(0, addedPieces),
        burnSeconds: totals.burnSeconds - before.burnSeconds, tended: Math.max(0, addedTended), pops: 0,
      };
    },
    observePops(popState) {
      const before = totals.pops;
      if (!popState) return { ...ZERO_DELTA };
      const serial = Number.isFinite(popState.serial) ? Math.max(0, popState.serial) : 0;
      if (session.popState !== popState) {
        session.popState = popState;
        session.lastPops = 0;
      }
      if (serial > session.lastPops) {
        totals.pops += serial - session.lastPops;
        session.lastPops = serial;
        maybePersist(true);
      }
      return { ...ZERO_DELTA, pops: totals.pops - before };
    },
  };
}

export function renderFireStats(local, global = {}) {
  const here = sanitizeStats(local);
  const everyone = global && typeof global === 'object' ? global : {};
  const head = '<li class="fire-stats-head"><span></span><span>Here</span><span>Everyone</span></li>';
  const rows = STATS_ROWS.map(([key, label, hereTitle, everyoneTitle]) => {
    const time = key === 'burnSeconds';
    const share = key === 'tended' || key === 'pops' ? null : everyone[key];
    return `<li><span>${label}</span><strong title="${hereTitle}">${formatStat(here[key], { time })}</strong><strong title="${everyoneTitle}">${formatStat(share, { time })}</strong></li>`;
  }).join('');
  return head + rows;
}

export function paintFireStats(root, local, global = {}) {
  if (!root) return;
  const here = sanitizeStats(local);
  const everyone = global && typeof global === 'object' ? global : {};
  const list = root.querySelector('#fire-stats-list') || root;
  const html = renderFireStats(here, everyone);
  if (list.innerHTML !== html) list.innerHTML = html;
  root.dataset.fires = here.fires;
  root.dataset.pieces = here.pieces;
  root.dataset.burnSeconds = here.burnSeconds;
  root.dataset.tended = here.tended;
  root.dataset.pops = here.pops;
  root.dataset.globalFires = everyone.fires == null ? '' : everyone.fires;
  root.dataset.globalPieces = everyone.pieces == null ? '' : everyone.pieces;
  root.dataset.globalBurnSeconds = everyone.burnSeconds == null ? '' : everyone.burnSeconds;
  root.dataset.globalSource = everyone.source || '';
}
