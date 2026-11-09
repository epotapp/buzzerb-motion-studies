import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRig, toClip, bakeClips } from './rig.js';
import { CameraChoreographer, CAMERA_MOVES } from './camera.js';
import { PlanarReveal, RevealSound } from './particles.js';


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
const helper = new THREE.SkeletonHelper(rig.root);
helper.visible = false; helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 10;
helper.material.color.set(0xff4d8d);
scene.add(helper);

const mixer = new THREE.AnimationMixer(rig.root);
const choreography = new CameraChoreographer(camera, controls, rig.root);
const lib = new Map();   // id -> { id, title, tag, dur, action, btn, loop }
let current = null, idleId = null, paused = false, dragging = false, still = null;

/* ---------- camera choreography ---------- */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const reveal = new PlanarReveal({rig,scene,camera,controls,renderer,reducedMotion,
  onChange: updateRevealUI,
  onExit: () => { choreography.clearOrbitMomentum(); updateCameraUI(); },
});
reveal.audio = new RevealSound();
const brandDiagnostics=document.createElement('output');
brandDiagnostics.id='particleDiagnostics';brandDiagnostics.hidden=true;brandDiagnostics.setAttribute('aria-hidden','true');document.body.appendChild(brandDiagnostics);
const debugBrand=new URLSearchParams(location.search).get('debugBrand')==='1';
const diagnosticContext=renderer.getContext(),diagnosticContextAttributes=diagnosticContext.getContextAttributes();
let diagnosticFrames=0,lastBrandPixelProbe=-Infinity,brandPixel=null;
function updateBrandDiagnostics(afterRender=false){
  const numbers=[...camera.position.toArray(),...camera.quaternion.toArray(),...controls.target.toArray(),...camera.matrixWorld.elements,...camera.projectionMatrix.elements];
  const state=reveal.inspect(),carrier=reveal.carrier;
  if(debugBrand&&afterRender&&state.hold&&performance.now()-lastBrandPixelProbe>200&&!diagnosticContext.isContextLost()){
    const projected=new THREE.Vector3(0,2.35,.004).project(camera),pixel=new Uint8Array(4);
    const x=Math.round((projected.x*.5+.5)*(canvas.width-1)),y=Math.round((projected.y*.5+.5)*(canvas.height-1));
    if(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<canvas.width&&y<canvas.height){
      diagnosticContext.readPixels(x,y,1,1,diagnosticContext.RGBA,diagnosticContext.UNSIGNED_BYTE,pixel);
      brandPixel={rgba:[...pixel],x,y,frame:diagnosticFrames,at:performance.now()};
    }
    lastBrandPixelProbe=performance.now();
  }
  brandDiagnostics.textContent=JSON.stringify({version:'frontal-pointer-guard-1',...state,
    renderedFrames:diagnosticFrames,at:performance.now(),cameraPosition:camera.position.toArray(),cameraQuaternion:camera.quaternion.toArray(),controlsTarget:controls.target.toArray(),controlsEnabled:controls.enabled,
    carrierVisible:carrier?.visible??false,carrierOpacity:carrier?.material.opacity??null,carrierPosition:carrier?.position.toArray()??null,carrierScale:carrier?.scale.toArray()??null,carrierTextureReady:!!carrier?.material.map?.image?.complete,
    finite:numbers.every(Number.isFinite)&&(!carrier||Number.isFinite(carrier.material.opacity)),contextLost:diagnosticContext.isContextLost(),contextAttributes:diagnosticContextAttributes,renderCalls:renderer.info.render.calls,
    canvasSize:[canvas.width,canvas.height],visibility:document.visibilityState,blockedBrandGestures:reveal.blockedBrandGestures,debugBrand,centerPixel:brandPixel});
}
function updateRevealUI() {
  const r=reveal, s=r.inspect();
  $('#startReveal').disabled=!s.ready;
  $('#startReveal').textContent=s.error?'Reference unavailable':s.active?'Restart reveal':'Start reveal';
  $('#revealPlay').textContent=s.playing?'Pause':'Play';
  $('#revealPlay').disabled=!s.ready;
  $('#revealReverse').setAttribute('aria-pressed',String(s.speed<0));
  $('#revealTime').value=s.time;
  $('#revealClock').textContent=s.time.toFixed(1)+' / 12.0s';
  $('#revealPhase').textContent=s.active?s.phase:'A change of perspective';
  $('#revealCaption').textContent=s.active?r.state?.caption||'':s.error||'BuzzerB becomes a living constellation, then the iconic eye.';
  $('#revealStatus').textContent=s.error||(!s.ready?'Preparing the constellation…':s.active?(s.brandLocked?'Frontal view locked · orbit returns after the eye disperses':s.camera==='manual'?'Manual camera · frame to return':'Move your pointer through the swarm'):'Twelve seconds. Every point has a place.');
  $('#stageReveal').dataset.active=String(s.active);
  $('#revealSpeedOut').textContent=s.speed.toFixed(2)+'×';
  $('#revealFrame').disabled=!s.active||s.brandLocked;
  $('#resumeClips').disabled=!s.active;
  $('#nowTitle').textContent=(s.active?'Source · ':'')+(current?.title||'BuzzerB');
  $('#pause').disabled=s.active;
  $('#pause').textContent=s.active?'Source held':paused?'Play':'Pause';
  for(const id of ['scrub','speed','blend','loop','rigvis'])$('#'+id).disabled=s.active;
  helper.visible=!s.active&&$('#rigvis').checked;
  updateCameraUI();
  updateBrandDiagnostics();
}
$('#startReveal').addEventListener('click',()=>{choreography.clearOrbitMomentum();reveal.restart();});
$('#revealPlay').addEventListener('click',()=>{if(reveal.playing)reveal.pause();else if(!reveal.active&&(reveal.time===0||reveal.time===12))reveal.restart();else reveal.play();});
$('#revealReverse').addEventListener('click',()=>{reveal.setSpeed(-reveal.speed);if(!reveal.active){reveal.seek(reveal.speed<0?12:0);}reveal.play();});
$('#revealTime').addEventListener('input',e=>reveal.seek(+e.target.value));
$('#revealRate').addEventListener('input',e=>reveal.setSpeed(+e.target.value*(reveal.speed<0?-1:1)));
$('#revealLoop').addEventListener('change',e=>{reveal.loop=e.target.checked;});
$('#quality').addEventListener('change',e=>reveal.setQuality(e.target.value));
$('#revealFrame').addEventListener('click',()=>{choreography.clearOrbitMomentum();reveal.resetCamera();});
$('#resumeClips').addEventListener('click',()=>reveal.exit());
$('#sound').addEventListener('click',async e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true';try{if(on)await reveal.audio.enable();else reveal.audio.disable();$('#sound').setAttribute('aria-pressed',String(on));$('#sound').textContent=on?'Sound on':'Sound off';}catch(err){$('#revealStatus').textContent='Sound is unavailable in this browser.';}});
const cameraButtons = [...document.querySelectorAll('[data-camera]')];
function updateCameraUI() {
  for (const button of cameraButtons) {button.setAttribute('aria-pressed', String(button.dataset.camera === choreography.mode));button.disabled=reveal.active&&(reveal.state?.brandLocked||button.dataset.camera!=='manual');}
  if(reveal.active){
    const locked=reveal.state?.brandLocked;
    $('#cameraState').textContent=locked?'Frontal lock':reveal.cameraAuto?'Reveal':'Manual';
    $('#cameraState').dataset.active=String(reveal.playing);
    $('#cameraReadout').textContent=locked?'Reveal · locked frontal view':reveal.cameraAuto?'Reveal · directed camera':'Reveal · manual camera';
    $('#cameraNote').textContent=locked?'The CBS reference stays frontal to preserve its exact shape. Orbit returns when the eye disperses.':'The reveal has its own camera. Drag the stage to take control; Frame reveal returns to the directed view.';
    $('#cameraCycle').disabled=true;
    return;
  }
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
  if(reveal.active)reveal.cameraAuto=false;
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
  if(reveal.active)reveal.exit();
  reveal.pose=null;reveal.time=0;
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
  updateRevealUI();
}
mixer.addEventListener('finished', (ev) => {
  if(reveal.active)return;
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
  $('#pause').textContent = p ? 'Play' : 'Pause';
  updateCameraUI();
}
$('#pause').addEventListener('click', () => setPaused(!paused));
$('#speed').addEventListener('input', (e) => { $('#speedOut').textContent = (+e.target.value).toFixed(2) + '×'; });
$('#blend').addEventListener('input', (e) => { $('#blendOut').textContent = (+e.target.value).toFixed(2) + 's'; });
$('#rigvis').addEventListener('change', (e) => { helper.visible = e.target.checked; });
$('#reset').addEventListener('click', () => {
  if(reveal.active){choreography.clearOrbitMomentum();reveal.resetCamera();return;}
  setCameraMode('manual');
  choreography.clearOrbitMomentum();
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update();
});
$('#loop').addEventListener('change', () => { if (current) { const l = !current.still && ($('#loop').checked || current.id === idleId); current.action.setLoop(l ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); } });

const scrub = $('#scrub');
scrub.addEventListener('pointerdown', () => { dragging = true; setPaused(true); });
scrub.addEventListener('input', () => {
  if (!current) return;
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
  else if (e.key === ' ' && tag !== 'button' && tag !== 'input') { e.preventDefault(); if(reveal.active){reveal.playing?reveal.pause():reveal.play();}else setPaused(!paused); }
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
  if(!reveal.active){mixer.update(animationDt);stillTick(animationDt);choreography.update(animationDt);}
  reveal.update(dt);
  floor.material.opacity=.28*(reveal.active?reveal.state?.meshOpacity??1:1);
  const blackStage=reveal.active?reveal.state?.blackStage??0:0;
  renderer.setClearColor(0x000000,blackStage);
  ringMat.opacity=.9*(1-blackStage);
  if (current) {
    const t = current.action.time;
    const u = current.dur ? ((t % current.dur) + current.dur) % current.dur / current.dur : 0;
    if (!dragging) scrub.value = Math.round(Math.min(1, t >= current.dur ? 1 : u) * 1000);
    $('#tcur').textContent = Math.min(t, current.dur).toFixed(2);
    current.btn.style.setProperty('--p', (u * 100).toFixed(1) + '%');
  }
  if (reveal.active ? !reveal.cameraAuto&&!reveal.state?.brandLocked : !choreography.active) controls.update();
  renderer.render(scene, camera);
  diagnosticFrames++;updateBrandDiagnostics(true);
  requestAnimationFrame(frame);
}
resize();
$('#loading').remove();
const first = BUILT.findIndex((c) => c.idle);
play(order[first >= 0 ? first : 0]);
setCameraMode(reducedMotion.matches ? 'manual' : 'auto', true);
requestAnimationFrame(frame);

window.__pg = { play, lib, order, rig, mixer, setPaused, renderer, scene, camera, controls, choreography, setCameraMode,
  show(id, t) { play(id); setPaused(true); const e = lib.get(id); mixer.update(0); e.action.time = t; e.action.setEffectiveWeight(1); mixer.update(0); choreography.seek(t); renderer.render(scene, camera); } };
window.__pgReady = true;
window.__particles = reveal;
