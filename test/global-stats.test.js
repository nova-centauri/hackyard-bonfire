import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalStats, loadHostStats, ABACUS } from '../src/global-stats.js';

const json = (body, type = 'application/json') => ({ ok: true, headers: { get: () => type }, json: async () => body });
const html = () => ({ ok: true, headers: { get: () => 'text/html' }, json: async () => ({ fires: 99 }) });

test('a JSON host API is preferred and a POST reports the delta without touching Abacus', async () => {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    if (String(url).includes('/api/stats')) {
      if (opts.method === 'POST') return json({ fires: 12, pieces: 40, burnSeconds: 180 });
      return json({ fires: 11, pieces: 30, burnSeconds: 120 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const stats = createGlobalStats({ fetchFn, hitGapMs: 0 });
  await stats.refresh();
  assert.equal(stats.snapshot().source, 'host');
  assert.equal(stats.snapshot().fires, 11);
  stats.ingest({ fires: 1, pieces: 0, burnSeconds: 0 });
  await stats.flush();
  assert.equal(stats.snapshot().fires, 12);
  assert.ok(calls.some(call => call.method === 'POST' && call.body.includes('"fires":1')));
  assert.ok(calls.every(call => !call.url.includes('abacus')));
});

test('HTML SPA fallback at /api/stats is not a stats API; Abacus get does not increment', async () => {
  const urls = [];
  const fetchFn = async url => {
    const href = String(url);
    urls.push(href);
    if (href.includes('/api/stats')) return html();
    if (href.includes('/get/') && href.endsWith('/fires')) return json({ value: 4 });
    if (href.includes('/get/') && href.endsWith('/pieces')) return json({ value: 9 });
    if (href.includes('/get/') && href.endsWith('/burn-minutes')) return json({ value: 2 });
    if (href.includes('/hit/')) return json({ value: 5 });
    return json({ value: 0 });
  };
  assert.equal(await loadHostStats(fetchFn), null);
  const stats = createGlobalStats({ fetchFn, hitGapMs: 0 });
  await stats.refresh();
  assert.equal(stats.snapshot().source, 'abacus');
  assert.equal(stats.snapshot().fires, 4);
  assert.equal(stats.snapshot().pieces, 9);
  assert.equal(stats.snapshot().burnSeconds, 120);
  assert.ok(urls.every(url => !url.includes('/hit/')));
  stats.ingest({ fires: 1 });
  await stats.flush();
  const hits = urls.filter(url => url.includes('/hit/'));
  assert.equal(hits.length, 1);
  assert.ok(hits[0].endsWith(`/${ABACUS.keys.fires}`));
});

test('global burn time is whole burn-clock minutes, never animation frames', async () => {
  const urls = [];
  const fetchFn = async url => {
    const href = String(url);
    urls.push(href);
    if (href.includes('/api/stats')) return html();
    if (href.includes('/hit/')) return json({ value: 3 });
    return json({ value: 0 });
  };
  const stats = createGlobalStats({ fetchFn, hitGapMs: 0 });
  await stats.refresh();
  stats.ingest({ burnSeconds: 59 });
  await stats.flush();
  assert.ok(!urls.some(url => url.includes('burn-minutes') && url.includes('/hit/')));
  stats.ingest({ burnSeconds: 1 });
  await stats.flush();
  assert.equal(urls.filter(url => url.includes('/hit/') && url.includes('burn-minutes')).length, 1);
  stats.ingest({ burnSeconds: 120 });
  await stats.flush();
  assert.equal(urls.filter(url => url.includes('/hit/') && url.includes('burn-minutes')).length, 3);
});

test('a downed counter leaves everyone empty so the UI can show a dash', async () => {
  const stats = createGlobalStats({ fetchFn: async () => { throw new Error('offline'); }, hitGapMs: 0 });
  await stats.refresh();
  assert.equal(stats.snapshot().source, null);
  assert.equal(stats.snapshot().fires, null);
  assert.equal(stats.snapshot().pieces, null);
  assert.equal(stats.snapshot().burnSeconds, null);
});

test('an empty flush does not swallow a later ingest', async () => {
  const urls = [];
  const fetchFn = async url => {
    const href = String(url);
    urls.push(href);
    if (href.includes('/api/stats')) return html();
    if (href.includes('/hit/')) return json({ value: 2 });
    return json({ value: 1 });
  };
  const stats = createGlobalStats({ fetchFn, hitGapMs: 0 });
  await stats.refresh();
  await stats.flush();
  stats.ingest({ fires: 1 });
  await stats.flush();
  assert.equal(urls.filter(url => url.includes('/hit/') && url.endsWith('/fires')).length, 1);
});
