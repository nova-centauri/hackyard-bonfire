import * as THREE from 'three';
import { applyLogPoke } from './log-settling.js';

const UP = new THREE.Vector3(0, 1, 0);
const POKE_INTERVAL = .18;
const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 20 13-16 2 2L7 22Zm9-11 4 1M9 15l-3-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Raycast only visible opaque surfaces. The first stone/ground hit blocks wood
// behind it, and child bark hits resolve to the same live fuel body as its trunk.
export function pickPokeTarget(study, raycaster) {
  if (!study?.burnVisuals?.settling) return null;
  study.opaque.updateMatrixWorld(true);
  const surfaces = [];
  study.opaque.traverseVisible(object => { if (object.isMesh) surfaces.push(object); });
  const hit = raycaster.intersectObjects(surfaces, false)[0];
  if (!hit) return null;
  let owner = hit.object;
  while (owner && !study.logMeshes.includes(owner)) owner = owner.parent;
  const slot = study.logMeshes.indexOf(owner);
  const pose = study.burnVisuals.settling.logs[slot];
  if (!pose?.live) return { ...hit, slot: null };
  return { ...hit, slot, pose };
}

export class FirePoker {
  constructor(viewer) {
    this.viewer = viewer;
    this.canvas = viewer.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.equipped = false; this.inside = false; this.pointerId = null;
    this.lastPoke = -Infinity; this.strokeTime = -Infinity;
    this.pokeCount = 0;
    const stage = viewer.container.closest('.stage');
    stage.insertAdjacentHTML('beforeend', `<div class="fire-tool" hidden>
      <button id="equip-poker" aria-pressed="false" aria-describedby="poker-help">${icon}<span>Equip poking stick</span></button>
      <span id="poker-help">Move the wood. Tend the fire.</span>
      <span class="poker-feedback" role="status" aria-live="polite"></span>
    </div>`);
    this.panel = stage.querySelector('.fire-tool');
    this.button = stage.querySelector('#equip-poker');
    this.help = stage.querySelector('#poker-help');
    this.feedback = stage.querySelector('.poker-feedback');
    this.orbitHelp = stage.querySelector('.orbit-help > span');
    this.button.addEventListener('click', () => this.setEquipped(!this.equipped));

    this.visual = new THREE.Group(); this.visual.name = 'Poking stick';
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(.012, .024, 1, 8, 5),
      new THREE.MeshStandardMaterial({ color: '#90704a', roughness: 1, emissive: '#35281c', emissiveIntensity: .24 }));
    this.tip = new THREE.Mesh(new THREE.CylinderGeometry(.009, .012, .13, 7),
      new THREE.MeshStandardMaterial({ color: '#28241f', roughness: 1 }));
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(.058, .006, 5, 28),
      new THREE.MeshBasicMaterial({ color: '#f4d2a0', depthTest: false, depthWrite: false, transparent: true, opacity: .85 }));
    this.marker.renderOrder = 10;
    this.visual.add(this.shaft, this.tip, this.marker);
    this.visual.visible = false;

    this.canvas.addEventListener('pointermove', event => {
      this.trackPointer(event);
      if (this.equipped) viewer.queueRender();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.inside = false; this.release(); viewer.queueRender();
    });
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.equipped || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.canvas.focus({ preventScroll: true });
      this.trackPointer(event);
      if (viewer.paused) { this.announce('Play motion to poke the fire.'); return; }
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      this.poke(); viewer.queueRender();
    }, true);
    const release = event => {
      if (event.pointerId !== this.pointerId) return;
      event.stopImmediatePropagation(); this.release(); viewer.queueRender();
    };
    this.canvas.addEventListener('pointerup', release, true);
    this.canvas.addEventListener('pointercancel', release, true);
    this.canvas.addEventListener('lostpointercapture', () => this.release());
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.equipped) { event.preventDefault(); this.setEquipped(false); }
    });
  }

  trackPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
  }

  release() {
    const id = this.pointerId; this.pointerId = null;
    if (id !== null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }

  announce(message) { if (this.feedback.textContent !== message) this.feedback.textContent = message; }

  setEquipped(value) {
    value = !!value && !!this.viewer.current?.cycle;
    if (this.equipped === value) return;
    this.release(); this.equipped = value;
    const controls = this.viewer.controls;
    if (value) {
      this.mouseButtons = { ...controls.mouseButtons };
      controls.mouseButtons.LEFT = null; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    } else Object.assign(controls.mouseButtons, this.mouseButtons);
    this.button.setAttribute('aria-pressed', String(value));
    this.button.querySelector('span').textContent = value ? 'Put stick away' : 'Equip poking stick';
    this.canvas.classList.toggle('poker-equipped', value);
    if (!value) this.canvas.classList.remove('poker-on-wood');
    this.canvas.setAttribute('aria-label', value
      ? 'Interactive 3D bonfire. Click wood to poke, hold to push, right-drag to orbit, scroll to zoom. Escape puts the stick away.'
      : 'Interactive 3D bonfire. Drag to orbit, scroll to zoom.');
    this.orbitHelp.textContent = value ? 'Right-drag to orbit · Scroll to explore' : 'Drag to orbit · Scroll to explore';
    this.announce(''); this.sync(); this.viewer.queueRender();
  }

  reset() {
    this.release(); this.lastPoke = -Infinity; this.strokeTime = -Infinity;
    this.inside = false; this.visual.visible = false; this.announce('');
    this.canvas.classList.remove('poker-on-wood');
  }

  sync() {
    const available = !!this.viewer.current?.cycle;
    if (!available) this.setEquipped(false);
    this.panel.hidden = !available;
    if (this.viewer.paused) this.release();
    const text = !this.equipped ? 'Move the wood. Tend the fire.' : this.viewer.paused
      ? 'Fire paused · Play motion to poke.'
      : 'Click wood to nudge · Hold to push · Esc to put away';
    if (this.help.textContent !== text) this.help.textContent = text;
  }

  aim() {
    this.viewer.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera);
    return pickPokeTarget(this.viewer.current, this.raycaster);
  }

  poke() {
    const viewer = this.viewer, time = viewer.current?.animationTime ?? 0;
    if (!this.equipped || viewer.paused || !this.inside || time - this.lastPoke < POKE_INTERVAL) return false;
    const hit = this.aim();
    if (!hit?.pose) { this.announce('Aim at a piece of wood inside the rocks.'); return false; }
    // Push away from the viewer and slightly down into the pile. Keep the
    // impulse on the clicked surface so an end poke can turn a resting log.
    const direction = this.raycaster.ray.direction.clone();
    direction.y = Math.min(-.12, direction.y * .45); direction.normalize();
    if (!applyLogPoke(viewer.current.burnVisuals.settling, hit.pose, hit.point, direction, .6)) return false;
    this.lastPoke = time; this.strokeTime = time; this.pokeCount++;
    this.announce('Poking the wood');
    this.panel.dataset.pokes = this.pokeCount;
    viewer.depthDirty = true;
    return true;
  }

  update() {
    this.sync();
    const viewer = this.viewer;
    if (this.visual.parent !== viewer.current.scene) viewer.current.scene.add(this.visual);
    const visible = this.equipped && this.inside;
    const wasVisible = this.visual.visible;
    this.visual.visible = visible;
    if (!visible) { this.canvas.classList.remove('poker-on-wood'); return wasVisible; }
    if (this.pointerId !== null) this.poke();
    const hit = this.aim();
    const target = hit?.point?.clone() ?? this.raycaster.ray.at(Math.max(2, viewer.camera.position.distanceTo(viewer.controls.target)), new THREE.Vector3());
    const direction = this.raycaster.ray.direction.clone();
    const age = viewer.current.animationTime - this.strokeTime;
    const recoil = age >= 0 && age < POKE_INTERVAL ? Math.sin(age / POKE_INTERVAL * Math.PI) * .12 : 0;
    target.addScaledVector(direction, -.045 - recoil);
    this.raycaster.setFromCamera(new THREE.Vector2(.76, -.94), viewer.camera);
    const grip = this.raycaster.ray.at(1.15, new THREE.Vector3());
    const shaftDirection = target.clone().sub(grip), length = shaftDirection.length();
    this.shaft.position.copy(grip).lerp(target, .5);
    this.shaft.quaternion.setFromUnitVectors(UP, shaftDirection.normalize());
    this.shaft.scale.set(1, Math.max(.1, length - .13), 1);
    this.tip.position.copy(target).addScaledVector(shaftDirection, -.065);
    this.tip.quaternion.copy(this.shaft.quaternion);
    this.marker.visible = !!hit?.pose && !viewer.paused;
    if (this.marker.visible) {
      this.marker.position.copy(hit.point).addScaledVector(direction, -.025);
      this.marker.quaternion.copy(viewer.camera.quaternion);
    }
    this.canvas.classList.toggle('poker-on-wood', this.marker.visible);
    return true;
  }
}
