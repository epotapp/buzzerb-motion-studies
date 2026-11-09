import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRig, toClip, bakeClips } from './rig.js';
import { CameraChoreographer, CAMERA_MOVES } from './camera.js';
import { ReliefSequence, DURATION, PHASES, phaseAt } from './relief.js';
import { sourceClipTime } from './sequence-core.js';


let FBX_BUF, BUILT;
try {
  const ok = (r, n) => { if (!r.ok) throw new Error(n + ' (' + r.status + ')'); return r; };
  [FBX_BUF, BUILT] = await Promise.all([
    fetch('assets/buzzerb.fbx').then((r) => ok(r, 'buzzerb.fbx').arrayBuffer()),
    fetch('assets/clips.json').then((r) => ok(r, 'clips.json').json()),
  ]);
} catch (err) {
  document.getElementById('loading').textContent = 'Could not load the character files. Serve this folder over http(s); opening index.html from disk will not work. ' + err.message;
  throw err;
}

const $ = (s) => document.querySelector(s);

/* ---------- renderer, scene ---------- */
const viewport = $('#viewport'), canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 14, 32);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const HOME = { pos: new THREE.Vector3(0, 1.8, 7.0), target: new THREE.Vector3(0, 1.3, 0.3) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 16; controls.maxPolarAngle = Math.PI * 0.51;
controls.enablePan = false;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x151515, .9));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(3.5, 7, 5); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 7, bottom: -4, near: 1, far: 24 });
key.shadow.bias = -0.0004; key.shadow.radius = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(-5, 4, -5); scene.add(rim);
const softbox = new THREE.DirectionalLight(0xffffff, 1.2); softbox.position.set(-4, 3.5, 6); scene.add(softbox);
const bounce = new THREE.DirectionalLight(0xffffff, .5); bounce.position.set(4, .8, -2); scene.add(bounce);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: .18 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x3b4859, transparent: true, opacity: 0.08 });
for (const [r0, r1] of [[1.9, 1.94], [3.1, 3.13]]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);
}
function applyTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = cs.getPropertyValue('--ring').trim();
  if (v) ringMat.color.set(v);
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) {}
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
applyTheme();

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the whole character in frame on tall or narrow stages
  camera.fov = w / h < 1 ? 32 + (1 - w / h) * 26 : 32;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

/* ---------- character + rig ---------- */
const mats = {
  head: new THREE.MeshStandardMaterial({ color: 0xf2b91e, roughness: 0.5, side: THREE.DoubleSide }),
  glove: new THREE.MeshStandardMaterial({ color: 0xf7f7f4, roughness: 0.55 }),
  body: new THREE.MeshStandardMaterial({ color: 0x20232b, roughness: 0.45 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0xd9352f, roughness: 0.6 }),
};
const origLog = console.warn;
const srcChar = new FBXLoader().parse(FBX_BUF, '');
const rig = buildRig(srcChar, mats);
scene.add(rig.root);
const helper = new THREE.SkeletonHelper(rig.root);
helper.visible = false; helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 10;
helper.material.color.set(0xff4d8d);
scene.add(helper);

const mixer = new THREE.AnimationMixer(rig.root);
const choreography = new CameraChoreographer(camera, controls, rig.root);
const lib = new Map();   // id -> { id, title, tag, dur, action, btn, loop }
let current = null, idleId = null, paused = false, dragging = false, still = null;
let relief = null, sequenceAnchor = 0, sequenceCameraMode = 'auto';
// Consume gestures while the brand view is fixed. Disabled OrbitControls does
// not capture pointers, so otherwise a browser-native image drag can take over.
canvas.draggable = false;
canvas.style.userSelect = 'none';
canvas.addEventListener('dragstart', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (relief?.active && relief.brandLocked) {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
  }
}, { capture: true, passive: false });
canvas.addEventListener('pointermove', event => {
  if (relief?.active && relief.brandLocked) event.preventDefault();
}, { capture: true, passive: false });

/* ---------- camera choreography ---------- */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const cameraButtons = [...document.querySelectorAll('[data-camera]')];
function updateCameraUI() {
  if (relief?.active) {
    $('#cameraState').textContent = relief.brandLocked ? 'CBS view' : relief.cameraEnabled ? (relief.paused ? 'Paused' : 'Relief') : 'Manual';
    $('#cameraReadout').textContent = relief.brandLocked ? 'CBS · OFFICIAL WHITE / BLACK' : relief.cameraEnabled ? 'RELIEF CAMERA · ' + (reducedMotion.matches ? 'Reduced motion' : 'Authored depth study') : 'MANUAL CAMERA · Reset view to restore the path';
    $('#cameraState').dataset.active = String((relief.cameraEnabled || relief.brandLocked) && !relief.paused);
    return;
  }
  for (const button of cameraButtons) button.setAttribute('aria-pressed', String(button.dataset.camera === choreography.mode));
  const active = choreography.active;
  const move = CAMERA_MOVES[choreography.move];
  $('#cameraState').textContent = active ? (paused ? 'Paused' : 'Playing') : 'Manual';
  $('#cameraState').dataset.active = String(active && !paused);
  $('#cameraReadout').textContent = active ? (choreography.mode === 'auto' ? 'Auto · ' : '') + move : 'Manual camera';
  $('#cameraNote').textContent = active
    ? 'Camera follows playback speed and pause. Drag the stage to take control.'
    : 'Drag to orbit and scroll to zoom. Choose a move to start choreography.';
  $('#cameraCycle').disabled = !active;
}
function setCameraMode(mode, immediate = paused) {
  if (relief?.active) { relief.cameraEnabled = mode !== 'manual'; relief.render(); updateCameraUI(); return; }
  choreography.setMode(mode, immediate);
  updateCameraUI();
}
for (const button of cameraButtons) button.addEventListener('click', () => setCameraMode(button.dataset.camera));
$('#cameraCycle').addEventListener('input', (e) => {
  choreography.setCycle(+e.target.value);
  $('#cameraCycleOut').textContent = e.target.value + 's';
});
controls.addEventListener('start', () => {
  if (relief?.active) { relief.cameraEnabled = false; controls.enableDamping = false; updateRevealUI(); }
  else if (choreography.active) setCameraMode('manual');
});
reducedMotion.addEventListener('change', (e) => { if (e.matches) setCameraMode('manual'); });

/* ---------- control board ---------- */
const builtEl = $('#built'), userEl = $('#user');
const order = [];  // ids in button order, for number keys

function addClip(data, { title, tag, where, loop = true, isIdle = false, group = '' }) {
  const id = 'c' + lib.size + '_' + data.name;
  const clip = toClip(data, rig);
  const action = mixer.clipAction(clip);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'clip'; btn.setAttribute('aria-pressed', 'false');
  const idx = order.length;
  btn.innerHTML = '<span class="t"></span><span class="m"></span><span class="k"></span>';
  btn.querySelector('.t').textContent = title;
  const still = data.d < 0.5;
  btn.querySelector('.m').textContent = (still ? 'pose' : data.d.toFixed(1) + 's') + (tag ? ' · ' + tag : '');
  btn.querySelector('.k').textContent = idx < 9 ? String(idx + 1) : '';
  btn.addEventListener('click', () => play(id));
  where.appendChild(btn);
  lib.set(id, { id, title, tag, group, isIdle, dur: clip.duration, still, action, btn, loop, cameraFrame: choreography.measureClip(clip) });
  order.push(id);
  if (isIdle) idleId = id;
  return id;
}

function play(id) {
  const e = lib.get(id); if (!e) return;
  if (relief?.active) relief.cancel();
  still = null;
  const fade = parseFloat($('#blend').value);
  const a = e.action;
  const looping = !e.still && ($('#loop').checked || id === idleId);
  a.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  a.clampWhenFinished = true;
  a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(1);
  a.reset();
  if (current && current.action !== a) a.crossFadeFrom(current.action, fade, false);
  else if (fade > 0) a.fadeIn(fade);
  a.play();
  if (current) current.btn.setAttribute('aria-pressed', 'false');
  current = e;
  choreography.setClip(e);
  e.btn.setAttribute('aria-pressed', 'true');
  $('#nowTitle').textContent = e.title;
  $('#nowMeta').textContent = (e.tag ? e.tag + ' · ' : '') + (e.still ? 'static pose' : e.dur.toFixed(2) + 's');
  $('#tdur').textContent = e.dur.toFixed(2) + 's';
  if (paused) setPaused(false);
  updateCameraUI();
}
mixer.addEventListener('finished', (ev) => {
  if (relief?.active) return;
  if (!current || ev.action !== current.action || !idleId || current.id === idleId) return;
  if (current.still) { if ($('#loop').checked) still = { e: current, t: 0, phase: 0 }; }
  else play(idleId);
});
/* Static poses: hold ~1.5s, relax into Idle for a beat, then play the pose again. */
function stillTick(dt) {
  if (!still || paused) return;
  if (current !== still.e) { still = null; return; }
  still.t += dt;
  const fade = Math.max(0.35, parseFloat($('#blend').value));
  const ia = lib.get(idleId).action, a = still.e.action;
  if (still.phase === 0 && still.t > 1.5) {
    ia.setLoop(THREE.LoopRepeat, Infinity); ia.enabled = true; ia.setEffectiveWeight(1); ia.setEffectiveTimeScale(1);
    ia.reset(); ia.crossFadeFrom(a, fade, false); ia.play(); still.phase = 1;
  } else if (still.phase === 1 && still.t > 2.7) {
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(1);
    a.crossFadeFrom(ia, fade, false); a.play(); still = null;
  }
}

function setPaused(p) {
  paused = p;
  if (relief?.active) { relief.paused = p; updateRevealUI(); }
  $('#pause').textContent = p ? 'Play' : 'Pause';
  updateCameraUI();
}
$('#pause').addEventListener('click', () => setPaused(relief?.active ? !relief.paused : !paused));
$('#speed').addEventListener('input', (e) => { $('#speedOut').textContent = (+e.target.value).toFixed(2) + '×'; });
$('#blend').addEventListener('input', (e) => { $('#blendOut').textContent = (+e.target.value).toFixed(2) + 's'; });
$('#rigvis').addEventListener('change', (e) => { helper.visible = e.target.checked; });
$('#reset').addEventListener('click', () => {
  if (relief?.active) { relief.cameraEnabled = true; choreography.clearOrbitMomentum(); relief.render(); return; }
  setCameraMode('manual');
  choreography.clearOrbitMomentum();
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update();
});
$('#loop').addEventListener('change', () => { if (current) { const l = !current.still && ($('#loop').checked || current.id === idleId); current.action.setLoop(l ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); } });

const scrub = $('#scrub');
scrub.addEventListener('pointerdown', () => { dragging = true; setPaused(true); });
scrub.addEventListener('input', () => {
  if (!current) return;
  if (relief?.active) relief.cancel();
  setPaused(true);
  current.action.time = (scrub.value / 1000) * current.dur;
  mixer.update(0);
  choreography.seek(current.action.time);
});
window.addEventListener('pointerup', () => { dragging = false; });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
  if (e.key >= '1' && e.key <= '9') { const id = order[+e.key - 1]; if (id) play(id); }
  else if (e.key === ' ' && tag !== 'button' && tag !== 'input') { e.preventDefault(); setPaused(relief?.active ? !relief.paused : !paused); }
});

/* ---------- built-in Mixamo clips ---------- */
let lastGroup = null;
for (const c of BUILT) {
  if (c.group && c.group !== lastGroup) { const h = document.createElement('div'); h.className = 'grp'; h.textContent = c.group; builtEl.appendChild(h); lastGroup = c.group; }
  addClip(c, { title: c.title, tag: c.tag, where: builtEl, group: c.group, loop: c.loop !== false, isIdle: !!c.idle });
}
$('#countBuilt').textContent = String(BUILT.length);

/* ---------- user-supplied Mixamo FBX ---------- */
const msg = $('#msg');
const say = (t, err) => { msg.textContent = t; msg.className = 'msg' + (err ? ' err' : ''); };
const nice = (s) => s.replace(/\.fbx$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
let userCount = 0;
async function addFiles(files) {
  const list = [...files].filter((f) => /\.fbx$/i.test(f.name));
  if (!list.length) { say('Only .fbx files are supported. Download from Mixamo as FBX.', true); return; }
  let lastId = null, added = 0;
  for (const f of list) {
    try {
      say('Retargeting ' + f.name + '…');
      await new Promise((r) => setTimeout(r, 30));
      const g = new FBXLoader().parse(await f.arrayBuffer(), '');
      if (!g.animations.length) throw new Error('No animation found. Download a clip, not just a character.');
      const baked = bakeClips(g, rig, g.animations, () => nice(f.name)).filter((d) => d.n >= 2 && d.d > 0);
      baked.forEach((d, i) => { if (baked.length > 1) d.name += ' ' + (i + 1); });
      for (const d of baked) {
        lastId = addClip(d, { title: d.name, tag: 'yours', where: userEl });
        userCount++; added++;
      }
    } catch (err) {
      const m = err && err.message && !/^THREE\./.test(err.message) ? err.message : 'could not be read. Download it from Mixamo as FBX Binary (.fbx).';
      say(f.name + ': ' + m, true);
      return;
    }
  }
  $('#countUser').textContent = String(userCount);
  if (lastId) { play(lastId); say(added + (added === 1 ? ' clip added.' : ' clips added.')); }
}
$('#file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const over = $('#fullover'); let depth = 0;
window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; over.classList.add('on'); } });
window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) over.classList.remove('on'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; over.classList.remove('on'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const animationDt = paused ? 0 : dt * parseFloat($('#speed').value);
  if (relief?.active) relief.advance(dt);
  else {
    mixer.update(animationDt);
    stillTick(animationDt);
    choreography.update(animationDt);
  }
  if (current) {
    const t = current.action.time;
    const u = current.dur ? ((t % current.dur) + current.dur) % current.dur / current.dur : 0;
    if (!dragging) scrub.value = Math.round(Math.min(1, t >= current.dur ? 1 : u) * 1000);
    $('#tcur').textContent = Math.min(t, current.dur).toFixed(2);
    current.btn.style.setProperty('--p', (u * 100).toFixed(1) + '%');
  }
  if ((!relief?.active && !choreography.active) || (relief?.active && !relief.cameraEnabled)) {
    if (!relief?.active || !relief.paused) controls.update();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
resize();
$('#loading').remove();
const first = BUILT.findIndex((c) => c.idle);
play(order[first >= 0 ? first : 0]);
setCameraMode(reducedMotion.matches ? 'manual' : 'auto', true);

/* ---------- sculptural surface-fragment sequence ---------- */
let lastDiagnosticTime = -100;
function updateRevealUI() {
  if (!relief) return;
  const state = phaseAt(relief.time), active = relief.active;
  $('#revealTimeline').value = relief.time.toFixed(3);
  $('#revealTime').textContent = relief.time.toFixed(2) + ' / ' + DURATION.toFixed(2);
  $('#revealPhase').textContent = active ? state.name : 'Surface → relief → character';
  $('#phaseCopy').textContent = active ? state.label : 'A familiar character. A dimensional signature.';
  $('#revealPause').textContent = active && !relief.paused ? 'Pause' : 'Play';
  $('#revealPause').setAttribute('aria-label', active && !relief.paused ? 'Pause reveal' : 'Play reveal');
  $('#reverse').setAttribute('aria-pressed', String(relief.speed < 0));
  $('#rate').value = String(Math.abs(relief.speed) || 1);
  $('#rateOut').textContent = (Math.abs(relief.speed) || 1).toFixed(2) + '×';
  $('#particleCount').textContent = relief.count.toLocaleString() + ' tiles';
  $('#quality').value = relief.quality;
  $('#reveal').textContent = active ? 'Restart reveal' : 'Reveal the icon';
  $('#returnAnimation').hidden = !active;
  document.body.classList.toggle('revealing', active);
  if (relief.paused || Math.abs(relief.time - lastDiagnosticTime) > .12) {
    $('#sequenceDiagnostics').textContent = JSON.stringify(relief.inspect());
    lastDiagnosticTime = relief.time;
  }
  document.querySelectorAll('[data-phase]').forEach((b) => b.setAttribute('aria-current', String(active && +b.dataset.phase <= relief.time && !PHASES.some((p) => p.at > +b.dataset.phase && p.at <= relief.time))));
  updateCameraUI();
}

try {
  relief = new ReliefSequence({ scene, rig, camera, controls, renderer, reducedMotion,
    onBegin() {
      sequenceAnchor = current.action.time; sequenceCameraMode = choreography.mode;
      still = null; mixer.stopAllAction();
      current.action.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      choreography.setMode('manual', true); choreography.clearOrbitMomentum();
      controls.enableDamping = false;
    },
    evaluateSource(t) {
      const action = current.action;
      action.enabled = true; action.paused = false; action.setEffectiveWeight(1); action.setEffectiveTimeScale(1);
      action.time = sourceClipTime(t, current.dur, sequenceAnchor, current.still);
      mixer.update(0);
    },
    onEnd() {
      controls.enableDamping = true;
      current.action.setLoop(!current.still && ($('#loop').checked || current.id === idleId) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      choreography.setMode(reducedMotion.matches ? 'manual' : sequenceCameraMode, true);
      paused = false; $('#pause').textContent = 'Pause';
    },
    onState: updateRevealUI,
  });
  await relief.init();
  $('#reveal').disabled = false;
  $('#reveal').addEventListener('click', () => { relief.speed = Math.abs(relief.speed) || 1; relief.restart(); });
  $('#revealPause').addEventListener('click', () => relief.active && !relief.paused ? relief.pause() : relief.play());
  $('#reverse').addEventListener('click', () => { relief.setSpeed(-(relief.speed || 1)); relief.play(); });
  $('#revealTimeline').addEventListener('input', (e) => relief.seek(+e.target.value));
  $('#rate').addEventListener('input', (e) => relief.setSpeed(+e.target.value * (relief.speed < 0 ? -1 : 1)));
  $('#revealLoop').addEventListener('change', (e) => { relief.loop = e.target.checked; });
  $('#quality').addEventListener('change', (e) => { relief.setQuality(e.target.value); resize(); });
  $('#returnAnimation').addEventListener('click', () => relief.cancel());
  document.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', () => relief.seek(+b.dataset.phase)));
  window.__particles = {
    seek: (seconds) => relief.seek(seconds), play: () => relief.play(), pause: () => relief.pause(), restart: () => relief.restart(), setSpeed: (rate) => relief.setSpeed(rate),
    duration: DURATION, inspect: () => relief.inspect(),
  };
  updateRevealUI();
} catch (error) {
  console.error(error); $('#revealPhase').textContent = 'Artwork could not be prepared'; $('#phaseCopy').textContent = error.message;
}
requestAnimationFrame(frame);

window.__pg = { play, lib, order, rig, mixer, setPaused, renderer, scene, camera, controls, choreography, setCameraMode,
  show(id, t) { play(id); setPaused(true); const e = lib.get(id); mixer.update(0); e.action.time = t; e.action.setEffectiveWeight(1); mixer.update(0); choreography.seek(t); renderer.render(scene, camera); } };
window.__pgReady = true;
