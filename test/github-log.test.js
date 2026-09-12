import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GITHUB_REPO, buildLog, commitSubject, escapeHtml, formatLogDate, isMergeSubject,
  loadGithubLog, matchPrompt, parseGithubPayload, parseSidecar, renderLogEntries,
  safeHttpUrl,
} from '../src/github-log.js';

const sidecar = JSON.parse(readFileSync(new URL('../public/github-log.json', import.meta.url), 'utf8'));

test('the sidecar points at the public repo and keeps an empty prompt map for backfill', () => {
  assert.equal(sidecar.repoUrl, GITHUB_REPO.url);
  assert.equal(GITHUB_REPO.url, 'https://github.com/nova-centauri/hackyard-bonfire');
  assert.equal(typeof sidecar.howToBackfill, 'string');
  assert.ok(sidecar.howToBackfill.includes('prompts'));
  assert.deepEqual(sidecar.prompts, {});
  assert.ok(sidecar.commits.length >= 8, 'recent history is enough to read');
  for (const commit of sidecar.commits) {
    assert.match(commit.sha, /^[0-9a-f]{40}$/);
    assert.ok(commit.subject);
    assert.ok(!isMergeSubject(commit.subject), `${commit.subject} should stay out of the readable log`);
  }
});

test('buildLog skips merges, attaches known prompts by SHA prefix, and leaves empty slots otherwise', () => {
  const commits = [
    { sha: 'aaa1111deadbeef', date: '2026-09-12T12:00:00Z', subject: 'Merge branch \'x\' into main' },
    { sha: 'bbb2222cafe0001', date: '2026-09-12T11:00:00Z', subject: 'Seat the fire' },
    { sha: 'ccc3333feed0002', date: '2026-09-12T10:00:00Z', subject: 'Add scrap fuel' },
    { sha: 'ddd4444', date: '2026-09-12T09:00:00Z', message: 'Merge pull request #6 from nova\n\nbody' },
    { sha: 'eee5555', date: '2026-09-12T08:00:00Z', subject: 'Merge scrap fuel, focus-mode feed, and extra burn speeds (#6)' },
  ];
  const prompts = {
    bbb2222: { text: '  Make logs look like wood.  ', source: 'agent-notes' },
    ccc3333feed0002: { text: '   ' },
    missing: { text: 'should not appear' },
  };
  const log = buildLog(commits, prompts, { limit: 12 });
  assert.deepEqual(log.map(entry => entry.sha), ['bbb2222cafe0001', 'ccc3333feed0002']);
  assert.deepEqual(log[0].prompt, { text: 'Make logs look like wood.', source: 'agent-notes' });
  assert.equal(log[1].prompt, null, 'whitespace-only prompt stays an empty slot');
});

test('a string prompt entry and a GitHub API payload both round-trip into the log', () => {
  assert.equal(commitSubject('Seat the fire\n\nLonger body'), 'Seat the fire');
  assert.equal(matchPrompt('abcdef1', { abcdef1: 'Logs should sit in the dirt' }).text, 'Logs should sit in the dirt');
  assert.equal(matchPrompt('abcdef1', { abcdef1: { text: '' } }), null);
  const payload = [{
    sha: '6217815ab5751384b0a5c3e67d59fd52ba047cf7',
    html_url: 'https://github.com/nova-centauri/hackyard-bonfire/commit/6217815ab5751384b0a5c3e67d59fd52ba047cf7',
    commit: { message: 'Seat the fire: wood-shaped logs, no hover, warmer night light\n\nDetails', author: { date: '2026-09-12T19:36:11Z' } },
  }];
  const parsed = parseGithubPayload(payload);
  assert.equal(parsed[0].subject, 'Seat the fire: wood-shaped logs, no hover, warmer night light');
  assert.equal(formatLogDate(parsed[0].date), '2026-09-12');
});

test('renderLogEntries escapes markup and always shows a prompt slot', () => {
  const html = renderLogEntries(buildLog([
    { sha: 'abc1234', date: '2026-09-12T19:00:00Z', subject: 'Break <script>alert(1)</script>', url: 'https://github.com/nova-centauri/hackyard-bonfire/commit/abc1234' },
    { sha: 'def5678', date: '2026-09-12T18:00:00Z', subject: 'Known work' },
  ], { def5678: { text: 'Do not <b>invent</b>', source: 'pr-body' } }));
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /<blockquote class="github-prompt">Do not &lt;b&gt;invent&lt;\/b&gt;<\/blockquote>/);
  assert.match(html, /Break &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(renderLogEntries([]), '<li class="github-status">No recent commits</li>');
});

test('javascript: URLs are rejected and the sidecar parse keeps a blank prompt map', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), GITHUB_REPO.url);
  const parsed = parseSidecar({ repoUrl: 'https://example.invalid/not-the-repo', prompts: { a: { text: 'ok' } }, commits: sidecar.commits.slice(0, 1) });
  assert.equal(parsed.repoUrl, 'https://example.invalid/not-the-repo');
  assert.equal(parseSidecar({ prompts: [] }).prompts['anything'], undefined);
});

test('loadGithubLog prefers the live API and falls back to the sidecar without inventing prompts', async () => {
  const api = [{
    sha: 'eeeeeee11111111111111111111111111111111',
    html_url: 'https://github.com/nova-centauri/hackyard-bonfire/commit/eeeeeee11111111111111111111111111111111',
    commit: { message: 'Newer live commit', author: { date: '2026-09-12T20:00:00Z' } },
  }];
  const fetchFn = async url => {
    if (String(url).includes('github-log.json')) return { ok: true, json: async () => sidecar };
    if (String(url).includes('api.github.com')) return { ok: true, json: async () => api };
    return { ok: false };
  };
  const live = await loadGithubLog({ fetchFn });
  assert.equal(live.repoUrl, GITHUB_REPO.url);
  assert.equal(live.entries[0].subject, 'Newer live commit');
  assert.equal(live.entries[0].prompt, null);

  const offline = await loadGithubLog({
    fetchFn: async url => String(url).includes('github-log.json')
      ? { ok: true, json: async () => sidecar }
      : { ok: false },
  });
  assert.equal(offline.entries[0].sha, sidecar.commits[0].sha);
  assert.ok(offline.entries.every(entry => entry.prompt === null), 'no prompts were found in the repo, so every slot stays empty');
});
