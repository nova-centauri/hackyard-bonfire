// Quiet GitHub presence for the page footer: a repo link and a collapsed
// recent-commit list. Prompts are never invented. They come from
// public/github-log.json (keyed by SHA) so they can be backfilled later; each
// commit still renders an empty slot when none is on file. Live history is
// preferred from the public GitHub API; the sidecar's commit list is the
// offline fallback.
export const GITHUB_REPO = Object.freeze({
  owner: 'nova-centauri',
  name: 'hackyard-bonfire',
  url: 'https://github.com/nova-centauri/hackyard-bonfire',
  api: 'https://api.github.com/repos/nova-centauri/hackyard-bonfire/commits?per_page=30',
  sidecar: '/github-log.json',
});

const LOG_LIMIT = 12;

export function commitSubject(message) {
  return String(message || '').split('\n')[0].trim();
}

export function isMergeSubject(subject) {
  return /^Merge\b/i.test(subject);
}

export function commitUrl(sha) {
  return `${GITHUB_REPO.url}/commit/${sha}`;
}

export function safeHttpUrl(url, fallback = GITHUB_REPO.url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch { /* keep fallback */ }
  return fallback;
}

export function formatLogDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function matchPrompt(sha, prompts) {
  if (!sha || !prompts || typeof prompts !== 'object' || Array.isArray(prompts)) return null;
  const key = Object.keys(prompts).find(candidate => candidate && (sha.startsWith(candidate) || candidate.startsWith(sha)));
  if (!key) return null;
  const entry = prompts[key];
  const text = typeof entry === 'string' ? entry : entry?.text;
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  return { text: trimmed, source: typeof entry === 'object' && entry.source ? String(entry.source) : null };
}

export function normalizeCommit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sha = String(raw.sha || '').trim();
  const subject = commitSubject(raw.subject || raw.message || raw.commit?.message);
  if (!sha || !subject) return null;
  const date = raw.date || raw.commit?.author?.date || raw.commit?.committer?.date || '';
  const url = raw.url || raw.html_url || commitUrl(sha);
  return { sha, date, subject, url: safeHttpUrl(url, commitUrl(sha)) };
}

export function parseGithubPayload(payload) {
  return Array.isArray(payload) ? payload.map(normalizeCommit).filter(Boolean) : [];
}

export function parseSidecar(data) {
  const source = data && typeof data === 'object' ? data : {};
  const repoUrl = safeHttpUrl(source.repoUrl || source.repo?.url, GITHUB_REPO.url);
  const prompts = source.prompts && typeof source.prompts === 'object' && !Array.isArray(source.prompts) ? source.prompts : {};
  const commits = Array.isArray(source.commits) ? source.commits.map(normalizeCommit).filter(Boolean) : [];
  return { repoUrl, commits, prompts };
}

export function buildLog(commits, prompts, { limit = LOG_LIMIT } = {}) {
  return (commits || [])
    .map(normalizeCommit)
    .filter(commit => commit && !isMergeSubject(commit.subject))
    .slice(0, limit)
    .map(commit => ({ ...commit, prompt: matchPrompt(commit.sha, prompts) }));
}

export function renderLogEntries(entries) {
  if (!entries.length) return '<li class="github-status">No recent commits</li>';
  return entries.map(entry => {
    const short = escapeHtml(entry.sha.slice(0, 7));
    const date = formatLogDate(entry.date);
    const prompt = entry.prompt
      ? `<blockquote class="github-prompt">${escapeHtml(entry.prompt.text)}</blockquote>`
      : '<p class="github-prompt empty">Prompt not recorded</p>';
    return `<li><a href="${escapeHtml(entry.url)}" rel="noopener noreferrer"><time datetime="${escapeHtml(entry.date)}">${escapeHtml(date)}</time> <code>${short}</code> ${escapeHtml(entry.subject)}</a>${prompt}</li>`;
  }).join('');
}

async function fetchJson(fetchFn, url) {
  try {
    const response = await fetchFn(url);
    if (!response?.ok) return null;
    return await response.json();
  } catch { return null; }
}

export async function loadGithubLog({ fetchFn = fetch, sidecarUrl = GITHUB_REPO.sidecar, apiUrl = GITHUB_REPO.api } = {}) {
  const sidecar = parseSidecar(await fetchJson(fetchFn, sidecarUrl));
  const remote = parseGithubPayload(await fetchJson(fetchFn, apiUrl));
  return {
    repoUrl: sidecar.repoUrl,
    entries: buildLog(remote.length ? remote : sidecar.commits, sidecar.prompts),
  };
}

export async function mountGithubLog(options = {}) {
  const list = document.querySelector('#github-commits');
  if (!list) return null;
  const log = await loadGithubLog(options);
  const link = document.querySelector('.github-link');
  if (link) link.href = log.repoUrl;
  list.innerHTML = renderLogEntries(log.entries);
  return log;
}
