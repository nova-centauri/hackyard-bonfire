// The few things a returning viewer would expect the page to remember: whether
// they were in focus mode, whether sound was on, and how loud. Storage is a
// convenience, never a requirement: every read and write is guarded, and a
// missing or blocked store simply yields the defaults.
const KEY = 'bonfire.preferences.v1';
const DEFAULTS = Object.freeze({ focus: false, sound: false, volume: .3 });

const clampVolume = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULTS.volume;

export function sanitizePreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return { focus: source.focus === true, sound: source.sound === true, volume: clampVolume(Number(source.volume)) };
}

export function loadPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    return sanitizePreferences(raw ? JSON.parse(raw) : {});
  } catch { return sanitizePreferences({}); }
}

export function savePreferences(patch, storage = globalThis.localStorage) {
  const next = sanitizePreferences({ ...loadPreferences(storage), ...patch });
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* private mode or quota: keep the session value only */ }
  return next;
}
