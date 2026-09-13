// Site-wide fire counts, shared across visitors. Local lifetime totals stay in
// preferences; this module only talks to the network.
//
// bonfire.observer is a static `dist/` with no stats API (`/api/stats` falls
// through to index.html). When that path later returns JSON it wins. Until then
// we use Abacus, a no-key CORS counter (the CountAPI successor). Anyone can
// increment those keys; the totals are a public tally, not an audit log.
//
// Abacus can only add one per request without an admin secret the repo does
// not have, so global burn time is whole minutes. Tended and pops stay local.
export const HOST_STATS_URL = '/api/stats';
export const ABACUS = Object.freeze({
  base: 'https://abacus.jasoncameron.dev',
  namespace: 'bonfire.observer',
  keys: Object.freeze({ fires: 'fires', pieces: 'pieces', burnMinutes: 'burn-minutes' }),
});

const emptyGlobal = () => ({ fires: null, pieces: null, burnSeconds: null, source: null });
const jsonType = res => (res?.headers?.get?.('content-type') || '').includes('json');
const count = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };

export function isStatsPayload(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && (Number.isFinite(Number(raw.fires)) || Number.isFinite(Number(raw.pieces)) || Number.isFinite(Number(raw.burnSeconds)));
}

export async function loadHostStats(fetchFn, url = HOST_STATS_URL) {
  try {
    const response = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!response?.ok || !jsonType(response)) return null;
    const raw = await response.json();
    if (!isStatsPayload(raw)) return null;
    return {
      fires: count(raw.fires) ?? 0,
      pieces: count(raw.pieces) ?? 0,
      burnSeconds: count(raw.burnSeconds) ?? 0,
    };
  } catch { return null; }
}

export function createGlobalStats({
  fetchFn = fetch,
  hostUrl = HOST_STATS_URL,
  abacusBase = ABACUS.base,
  namespace = ABACUS.namespace,
  hitGapMs = 350,
  onChange,
} = {}) {
  const totals = emptyGlobal();
  const queue = { fires: 0, pieces: 0, burnMinutes: 0 };
  let burnRemainder = 0, chain = Promise.resolve();

  function snapshot() { return { ...totals }; }
  function publish() { onChange?.(snapshot()); }

  async function abacus(path) {
    const response = await fetchFn(`${abacusBase}/${path}`);
    if (!response?.ok || !jsonType(response)) return null;
    return count((await response.json())?.value);
  }

  async function refresh() {
    try {
      const host = await loadHostStats(fetchFn, hostUrl);
      if (host) {
        totals.fires = host.fires; totals.pieces = host.pieces; totals.burnSeconds = host.burnSeconds; totals.source = 'host';
        publish();
        return snapshot();
      }
      const [fires, pieces, minutes] = await Promise.all([
        abacus(`get/${namespace}/${ABACUS.keys.fires}`),
        abacus(`get/${namespace}/${ABACUS.keys.pieces}`),
        abacus(`get/${namespace}/${ABACUS.keys.burnMinutes}`),
      ]);
      totals.fires = fires; totals.pieces = pieces;
      totals.burnSeconds = minutes == null ? null : minutes * 60;
      totals.source = fires == null && pieces == null && minutes == null ? null : 'abacus';
    } catch {
      totals.fires = null; totals.pieces = null; totals.burnSeconds = null; totals.source = null;
    }
    publish();
    return snapshot();
  }

  async function postHost(delta) {
    const response = await fetchFn(hostUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(delta),
    });
    if (!response?.ok || !jsonType(response)) return null;
    const raw = await response.json();
    if (!isStatsPayload(raw)) return null;
    return { fires: count(raw.fires) ?? 0, pieces: count(raw.pieces) ?? 0, burnSeconds: count(raw.burnSeconds) ?? 0 };
  }

  async function hit(key) {
    return abacus(`hit/${namespace}/${key}`);
  }

  async function step() {
    if (totals.source === 'host' && (queue.fires || queue.pieces || queue.burnMinutes)) {
      const posted = await postHost({
        fires: queue.fires, pieces: queue.pieces, burnSeconds: queue.burnMinutes * 60,
      });
      if (posted) {
        queue.fires = 0; queue.pieces = 0; queue.burnMinutes = 0;
        totals.fires = posted.fires; totals.pieces = posted.pieces; totals.burnSeconds = posted.burnSeconds;
        publish();
        return;
      }
      totals.source = 'abacus';
    }
    if (queue.fires) {
      const value = await hit(ABACUS.keys.fires);
      if (value == null) return;
      queue.fires--; totals.fires = value; totals.source = 'abacus';
      publish();
      return;
    }
    if (queue.pieces) {
      const value = await hit(ABACUS.keys.pieces);
      if (value == null) return;
      queue.pieces--; totals.pieces = value; totals.source = 'abacus';
      publish();
      return;
    }
    if (queue.burnMinutes) {
      const value = await hit(ABACUS.keys.burnMinutes);
      if (value == null) return;
      queue.burnMinutes--; totals.burnSeconds = value * 60; totals.source = 'abacus';
      publish();
    }
  }

  function pump() {
    chain = chain.catch(() => {}).then(async () => {
      while (queue.fires || queue.pieces || queue.burnMinutes) {
        const before = queue.fires + queue.pieces + queue.burnMinutes;
        await step();
        if (queue.fires + queue.pieces + queue.burnMinutes === before) break;
        if (hitGapMs > 0 && (queue.fires || queue.pieces || queue.burnMinutes)) {
          await new Promise(resolve => setTimeout(resolve, hitGapMs));
        }
      }
    });
    return chain;
  }

  return {
    snapshot,
    refresh,
    ingest(delta) {
      const fires = Math.max(0, Math.floor(Number(delta?.fires) || 0));
      const pieces = Math.max(0, Math.floor(Number(delta?.pieces) || 0));
      const burn = Math.max(0, Number(delta?.burnSeconds) || 0);
      if (fires) queue.fires += fires;
      if (pieces) queue.pieces += pieces;
      burnRemainder += burn;
      while (burnRemainder >= 60 - 1e-9) { queue.burnMinutes++; burnRemainder = Math.max(0, burnRemainder - 60); }
      if (queue.fires || queue.pieces || queue.burnMinutes) return pump();
    },
    async flush() { await pump(); },
  };
}
