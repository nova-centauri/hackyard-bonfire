// Keep the scene, camera and sound alive while the surrounding interface rests.
// The corner gear that brings the menus back is always present in focus mode
// at a low resting opacity and always clickable; any pointer, key, wheel or
// touch activity brings it up fully for a while. It used to vanish outright
// after a short idle and whenever the pointer crossed the window edge, which
// is exactly where a viewer reaching for it goes.
const GEAR_IDLE_MS = 4000, GEAR_ENTRY_MS = 6000;

export function mountFocusMode(viewer, { initial = false, onChange } = {}) {
  const button = document.querySelector('#focus-mode');
  const restore = document.querySelector('#restore-menus');
  const canvas = viewer.renderer.domElement;
  let active = false, idleTimer, scrollPosition = 0;

  function restGear() {
    clearTimeout(idleTimer);
    document.body.classList.remove('focus-pointer-active');
  }

  function revealGear(holdFor = GEAR_IDLE_MS) {
    if (!active) return;
    document.body.classList.add('focus-pointer-active');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(restGear, holdFor);
  }

  function setFocusMode(value) {
    if (active === value) return;
    active = value;
    restGear();
    if (active) {
      scrollPosition = window.scrollY;
      // A hovering poker and contact ring would otherwise remain over the fire.
      viewer.poker?.setEquipped(false);
    }
    document.body.classList.toggle('focus-mode', active);
    button.setAttribute('aria-pressed', String(active));
    restore.hidden = !active;
    if (active) {
      window.scrollTo(0, 0);
      canvas.focus({ preventScroll: true });
      // Show newcomers where the menus went before the gear settles back.
      revealGear(GEAR_ENTRY_MS);
    } else {
      button.focus({ preventScroll: true });
      window.scrollTo(0, scrollPosition);
    }
    // Edge-to-edge fire earns a slightly deeper vignette.
    viewer.setVignette?.(active ? .34 : .24);
    viewer.resize();
    onChange?.(active);
  }

  button.addEventListener('click', () => setFocusMode(true));
  // A viewer who left in focus mode comes back to the fire, not the menus.
  if (initial) setFocusMode(true);
  restore.addEventListener('click', () => setFocusMode(false));
  const activity = () => revealGear();
  document.addEventListener('pointermove', activity, { passive: true });
  document.addEventListener('pointerdown', activity, { passive: true });
  document.addEventListener('wheel', activity, { passive: true });
  document.documentElement.addEventListener('pointerenter', activity, { passive: true });
  // Leaving the window (or the tab) starts the idle timer rather than hiding
  // the gear at once: the top-right corner is where the pointer leaves.
  document.documentElement.addEventListener('pointerleave', activity);
  window.addEventListener('blur', restGear);
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setFocusMode(false);
    } else revealGear();
  });
}
