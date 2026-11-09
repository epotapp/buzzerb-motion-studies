import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRig, toClip, bakeClips } from './rig.js';
import { AnimationPlayer } from './player.js';
import { CameraChoreographer, CAMERA_MOVES } from './camera.js';
import { authoredPerformanceFrame, createPerformanceStage, performanceBounds } from './performance-stage.js';


let FBX_BUF, BUILT;
try {
  const ok = (r, n) => { if (!r.ok) throw new Error(n + ' (' + r.status + ')'); return r; };
  [FBX_BUF, BUILT] = await Promise.all([
    fetch('assets/buzzerb.fbx').then((r) => ok(r, 'buzzerb.fbx').arrayBuffer()),
    fetch('assets/clips.json', { cache: 'no-cache' }).then((r) => ok(r, 'clips.json').json()),
  ]);
} catch (err) {
  document.getElementById('loading').textContent = 'Could not load the character files. Serve this folder over http(s); opening index.html from disk will not work. ' + err.message;
  throw err;
}

const $ = (s) => document.querySelector(s);

/* ---------- renderer, scene ---------- */
const viewport = $('#viewport'), canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const HOME = { pos: new THREE.Vector3(0, 1.8, 7.0), target: new THREE.Vector3(0, 1.3, 0.3) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 16; controls.maxPolarAngle = Math.PI * 0.51;
controls.enablePan = false;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a6, 1.5));
const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
key.position.set(3.5, 7, 5); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
key.shadow.bias = -0.0004; key.shadow.radius = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9db8ff, 1.2); rim.position.set(-5, 4, -5); scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.ShadowMaterial({ opacity: 0.28 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xaab3c2, transparent: true, opacity: 0.9 });
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
const sampleProps = createPerformanceStage(scene, rig, BUILT);
const helper = new THREE.SkeletonHelper(rig.root);
helper.visible = false; helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 10;
helper.material.color.set(0xff4d8d);
scene.add(helper);

const mixer = new THREE.AnimationMixer(rig.root);
const player = new AnimationPlayer(mixer, (entry) => updateSelection(entry));
const choreography = new CameraChoreographer(camera, controls, rig.root);
const lib = new Map();   // id -> { id, title, tag, dur, action, btn, loop }
let current = null, idleId = null, paused = false, dragging = false;
const loopPreferences = new Map([[true, $('#loop').checked], [false, false]]);

/* ---------- camera choreography ---------- */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const cameraButtons = [...document.querySelectorAll('[data-camera]')];
function updateCameraUI() {
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
  choreography.setMode(mode, immediate);
  updateCameraUI();
}
for (const button of cameraButtons) button.addEventListener('click', () => setCameraMode(button.dataset.camera));
$('#cameraCycle').addEventListener('input', (e) => {
  choreography.setCycle(+e.target.value);
  $('#cameraCycleOut').textContent = e.target.value + 's';
});
controls.addEventListener('start', () => { if (choreography.active) setCameraMode('manual'); });
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
  const still = data.pose ?? data.d < 0.5;
  btn.querySelector('.m').textContent = (still ? 'pose' : data.d.toFixed(1) + 's') + (tag ? ' · ' + tag : '');
  btn.querySelector('.k').textContent = idx < 9 ? String(idx + 1) : '';
  btn.addEventListener('click', () => play(id));
  where.appendChild(btn);
  const cameraFrame = authoredPerformanceFrame(data) ?? choreography.measureClip(clip, performanceBounds(data));
  lib.set(id, { id, title, tag, group, isIdle, dur: clip.duration, still, action, btn, loop, end: data.end, data, cameraFrame });
  order.push(id);
  if (isIdle) idleId = id;
  return id;
}

function play(id) {
  const e = lib.get(id); if (!e) return;
  player.fade = parseFloat($('#blend').value);
  player.loop = loopPreferences.get(e.loop);
  player.idle = lib.get(idleId);
  // Cut away from a prop stage so an interrupted pose stays clear of the rig
  // and equipment used by the next performance.
  const cut = current?.end === 'hold' || e.data.golf;
  player.select(e, { fade: cut ? 0 : player.fade });
  if (paused) setPaused(false);
}
function updateSelection(e) {
  if (current) { current.btn.setAttribute('aria-pressed', 'false'); current.btn.style.setProperty('--p', '0%'); }
  current = e;
  $('#loop').checked = loopPreferences.get(e.loop);
  choreography.setClip(e);
  e.btn.setAttribute('aria-pressed', 'true');
  $('#nowTitle').textContent = e.title;
  $('#nowMeta').textContent = (e.tag ? e.tag + ' · ' : '') + (e.still ? 'static pose' : e.dur.toFixed(2) + 's');
  $('#tdur').textContent = e.dur.toFixed(2) + 's';
  updateProps();
  updateCameraUI();
}

function updateProps() {
  sampleProps(current?.data, current?.action.time, player.transition);
}
function atHeldFinish() {
  return current?.end === 'hold' && current.action.time >= current.dur;
}
function updateTransport() {
  const label = atHeldFinish() ? 'Replay' : paused ? 'Play' : 'Pause';
  if ($('#pause').textContent !== label) $('#pause').textContent = label;
}
function setPaused(p) {
  paused = p;
  player.paused = p;
  updateTransport();
  updateCameraUI();
}
function togglePlayback() {
  if (atHeldFinish()) play(current.id);
  else setPaused(!paused);
}
$('#pause').addEventListener('click', togglePlayback);
$('#speed').addEventListener('input', (e) => { $('#speedOut').textContent = (+e.target.value).toFixed(2) + '×'; });
$('#blend').addEventListener('input', (e) => { player.fade = +e.target.value; $('#blendOut').textContent = (+e.target.value).toFixed(2) + 's'; });
$('#rigvis').addEventListener('change', (e) => { helper.visible = e.target.checked; });
$('#reset').addEventListener('click', () => {
  setCameraMode('manual');
  choreography.clearOrbitMomentum();
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update();
});
$('#loop').addEventListener('change', () => {
  if (!current) return;
  const loop = $('#loop').checked;
  loopPreferences.set(current.loop, loop);
  player.setLoop(loop);
});

const scrub = $('#scrub');
scrub.addEventListener('pointerdown', () => { dragging = true; setPaused(true); });
scrub.addEventListener('input', () => {
  if (!current) return;
  setPaused(true);
  player.seek((scrub.value / 1000) * current.dur);
  choreography.seek(current.action.time);
  updateProps();
  updateTransport();
});
window.addEventListener('pointerup', () => { dragging = false; });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
  if (e.key >= '1' && e.key <= '9') { const id = order[+e.key - 1]; if (id) play(id); }
  else if (e.key === ' ' && !e.target.closest?.('button, summary')) { e.preventDefault(); togglePlayback(); }
});

/* ---------- built-in Mixamo clips ---------- */
const clipGroups = new Map();
for (const c of BUILT) {
  const group = c.group || 'Other';
  if (!clipGroups.has(group)) {
    const category = document.createElement('details');
    category.className = 'clip-group';
    const heading = document.createElement('summary');
    heading.textContent = group;
    const count = document.createElement('span');
    count.className = 'group-count';
    heading.append(count);
    const grid = document.createElement('div');
    grid.className = 'grid';
    category.append(heading, grid);
    builtEl.append(category);
    clipGroups.set(group, { grid, count });
  }
  const { grid, count } = clipGroups.get(group);
  addClip(c, { title: c.title, tag: c.tag, where: grid, group: c.group, loop: c.loop !== false, isIdle: !!c.idle });
  count.textContent = grid.childElementCount;
}
$('#countBuilt').textContent = String(BUILT.length);
$('#rigline').textContent = 'Mixamo rig · ' + rig.order.length + ' bones · 120 fps built-in clips';

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
const perf = new URLSearchParams(location.search).has('diagnostics') ? document.createElement('output') : null;
let perfFrames = 0, perfStart = performance.now();
if (perf) { perf.style.cssText = 'position:absolute;right:12px;top:12px;font:12px monospace'; viewport.append(perf); }
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const animationDt = paused ? 0 : dt * parseFloat($('#speed').value);
  player.update(animationDt);
  updateProps();
  updateTransport();
  choreography.update(animationDt);
  if (current) {
    const t = current.action.time;
    const u = current.dur ? Math.min(1, Math.max(0, t / current.dur)) : 0;
    if (!dragging) scrub.value = Math.round(Math.min(1, t >= current.dur ? 1 : u) * 1000);
    $('#tcur').textContent = Math.min(t, current.dur).toFixed(2);
    current.btn.style.setProperty('--p', (u * 100).toFixed(1) + '%');
  }
  if (!choreography.active) controls.update();
  renderer.render(scene, camera);
  if (perf && ++perfFrames % 60 === 0) perf.textContent = ((perfFrames * 1000) / (performance.now() - perfStart)).toFixed(1) + ' fps · ' + renderer.info.render.calls + ' draws · ' + renderer.info.render.triangles + ' triangles';
  requestAnimationFrame(frame);
}
resize();
$('#loading').remove();
const first = BUILT.findIndex((c) => c.idle);
play(order[first >= 0 ? first : 0]);
setCameraMode(reducedMotion.matches ? 'manual' : 'auto', true);
requestAnimationFrame(frame);

window.__pg = { play, lib, order, rig, mixer, player, setPaused, renderer, scene, camera, controls, choreography, setCameraMode,
  show(id, t) { play(id); setPaused(true); const e = lib.get(id); player.seek(t); updateProps(); choreography.seek(t); renderer.render(scene, camera); } };
window.__pgReady = true;
