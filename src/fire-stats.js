// Quiet lifetime counts for the fire, kept on the same preferences record so
// they survive a refresh. One-way: stats observe the burn cycle and pop
// serial; they never write back into heat, feed, or animation state.
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
const STATS_ROWS = Object.freeze([
  ['fires', 'Fires', 'Burn cycles started: a new fire on load, Randomize, or changing place'],
  ['pieces', 'Fuel', 'Pieces placed on the bed, including the opening stack'],
  ['burnSeconds', 'Burned', 'Burn-clock time, accumulated across visits'],
  ['tended', 'Tended', 'Times a fresh piece was added because the fire ran low'],
  ['pops', 'Pops', 'Cracks and pops from the wood'],
]);

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400), h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60, s = total % 60;
  if (d) return `${d}d ${pad(h % 24)}:${pad(m)}:${pad(s)}`;
  if (h) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
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
      if (!cycle) return;
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
        return;
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
    },
    observePops(popState) {
      if (!popState) return;
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
    },
  };
}

export function renderFireStats(stats) {
  const values = sanitizeStats(stats);
  return STATS_ROWS.map(([key, label, title]) => {
    const value = key === 'burnSeconds' ? formatDuration(values[key]) : String(values[key]);
    return `<li title="${title}"><span>${label}</span><strong>${value}</strong></li>`;
  }).join('');
}

export function paintFireStats(root, stats) {
  if (!root) return;
  const values = sanitizeStats(stats);
  const list = root.querySelector('#fire-stats-list') || root;
  const html = renderFireStats(values);
  if (list.innerHTML !== html) list.innerHTML = html;
  root.dataset.fires = values.fires;
  root.dataset.pieces = values.pieces;
  root.dataset.burnSeconds = values.burnSeconds;
  root.dataset.tended = values.tended;
  root.dataset.pops = values.pops;
}
