// The few things a returning viewer would expect the page to remember: whether
// they were in focus mode, whether sound was on, how loud, and whether the fire
// tends itself. Storage is a convenience, never a requirement: every read and
// write is guarded, and a missing or blocked store simply yields the defaults.
// The fire opens in focus mode: the menus are there for whoever goes looking,
// and only a viewer who explicitly left focus mode comes back to them.
// Focus became the default in v2. Every v1 store carried focus:false (any
// sound or volume save wrote the whole record), so v1 is read once for its
// sound and volume only; the focus choice starts over. autoFeed was added in
// v2 as a new field: a missing value means the fire still tends itself.
const KEY = 'bonfire.preferences.v2', LEGACY_KEY = 'bonfire.preferences.v1';
const DEFAULTS = Object.freeze({ focus: true, sound: false, volume: .3, autoFeed: true });

const clampVolume = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULTS.volume;

export function sanitizePreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    focus: source.focus !== false,
    sound: source.sound === true,
    volume: clampVolume(Number(source.volume)),
    autoFeed: source.autoFeed !== false,
  };
}

export function loadPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return sanitizePreferences(JSON.parse(raw));
    const legacy = storage?.getItem(LEGACY_KEY);
    const { sound, volume } = sanitizePreferences(legacy ? JSON.parse(legacy) : {});
    return { ...DEFAULTS, sound, volume };
  } catch { return sanitizePreferences({}); }
}

export function savePreferences(patch, storage = globalThis.localStorage) {
  const next = sanitizePreferences({ ...loadPreferences(storage), ...patch });
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* private mode or quota: keep the session value only */ }
  return next;
}
