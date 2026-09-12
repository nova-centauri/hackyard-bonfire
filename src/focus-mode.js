// Keep the scene, camera and sound alive while the surrounding interface rests.
export function mountFocusMode(viewer) {
  const button = document.querySelector('#focus-mode');
  const restore = document.querySelector('#restore-menus');
  const canvas = viewer.renderer.domElement;
  let active = false, idleTimer, scrollPosition = 0;

  function hideGear() {
    clearTimeout(idleTimer);
    document.body.classList.remove('focus-pointer-active');
  }

  function revealGear() {
    if (!active) return;
    document.body.classList.add('focus-pointer-active');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(hideGear, 2400);
  }

  function setFocusMode(value) {
    if (active === value) return;
    active = value;
    hideGear();
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
    } else {
      button.focus({ preventScroll: true });
      window.scrollTo(0, scrollPosition);
    }
    // Edge-to-edge fire earns a slightly deeper vignette.
    viewer.setVignette?.(active ? .34 : .24);
    viewer.resize();
  }

  button.addEventListener('click', () => setFocusMode(true));
  restore.addEventListener('click', () => setFocusMode(false));
  document.addEventListener('pointermove', revealGear, { passive: true });
  document.documentElement.addEventListener('pointerenter', revealGear, { passive: true });
  document.documentElement.addEventListener('pointerleave', hideGear);
  // A tap reveals the same control on touchscreens, where hover is unavailable.
  document.addEventListener('pointerdown', revealGear, { passive: true });
  window.addEventListener('blur', hideGear);
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setFocusMode(false);
    } else if (event.key === 'Tab') revealGear();
  });
}
