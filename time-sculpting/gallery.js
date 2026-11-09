import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRig } from './rig.js';
import { clamp, ease, mix, makePoseSampler } from './temporal.js';
import { analyzeKick, performanceAt, silhouetteAt, showTimeForPose, DURATION, SILHOUETTES, TIMING, CHAPTERS } from './kick-performance.js';
import { createImpactVFX } from './impact-vfx.js';
import { cameraFadeAt, createKickDirector } from './kick-camera.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const cameraFade = $('cameraFade');
try {
  async function load(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response;
  }
  const [fbx, kick] = await Promise.all([
    load('assets/buzzerb.fbx').then(r => r.arrayBuffer()),
    load('assets/kick.clip.json').then(r => r.json()),
  ]);
  if (kick.title !== 'Kick') throw new Error('The Kick animation is missing.');
  const renderer = new T.WebGLRenderer({ canvas: $('gl'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0xf4f3ee);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(34, 1, .1, 220);
  const controls = new OrbitControls(camera, $('gl'));
  Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 3, maxDistance: 60, maxPolarAngle: Math.PI * .49 });
  scene.add(new T.HemisphereLight(0xffffff, 0xb5b5ab, 1.4));
  const key = new T.DirectionalLight(0xfffbef, 2);
  key.position.set(5, 9, 6); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 35 });
  key.shadow.bias = -.0003; key.shadow.normalBias = .01; scene.add(key);
  const rim = new T.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-5, 5, -6); scene.add(rim);
  const floorGeometry = new T.PlaneGeometry(250, 250);
  const floor = new T.Mesh(floorGeometry, new T.MeshBasicMaterial({ color: 0xf4f3ee }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.025; scene.add(floor);
  const shadow = new T.Mesh(floorGeometry, new T.ShadowMaterial({ opacity: .18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.024; shadow.receiveShadow = true; scene.add(shadow);
  const materials = {
    head: new T.MeshStandardMaterial({ color: 0xf2b91e, roughness: .48, side: T.DoubleSide }),
    body: new T.MeshStandardMaterial({ color: 0x20232b, roughness: .7 }),
    glove: new T.MeshStandardMaterial({ color: 0xfaf9f3, roughness: .65 }),
    shoe: new T.MeshStandardMaterial({ color: 0xd13f2e, roughness: .65 }),
  };
  const rig = buildRig(new FBXLoader().parse(fbx, ''), materials);
  const height = rig.height;
  scene.add(rig.root);
  const sampleHero = makePoseSampler(rig.root, kick, rig.hipsRest);
  const motion = analyzeKick(rig, kick);
  const clipBounds = new T.Box3();
  for (let i = 0; i < kick.n; i++) { sampleHero(i / kick.fps); clipBounds.expandByObject(rig.root); }
  const sampleCamera = createKickDirector(clipBounds.getCenter(new T.Vector3()), height);
  const strikeBone = rig.root.getObjectByName(motion.boneName);
  const inverseParent = new T.Quaternion(), thrustVector = new T.Vector3();
  const echoBlue = new T.Color(0x4e8192), echoAmber = new T.Color(0xe88b34);
  const silhouettes = Array.from({ length: SILHOUETTES }, (_, index) => {
    const root = rig.root.clone(true);
    const material = new T.ShaderMaterial({
      uniforms: { uColor: { value: echoBlue.clone() }, uAlpha: { value: 0 }, uPartWeight: { value: 1 } },
      transparent: true, depthWrite: false, side: T.FrontSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      vertexShader: `varying vec3 vN; varying vec3 vP;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.);vP=p.xyz;vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform vec3 uColor;uniform float uAlpha;uniform float uPartWeight;varying vec3 vN;varying vec3 vP;
        void main(){float rim=pow(1.-abs(dot(normalize(vN),normalize(-vP))),1.4);
        gl_FragColor=vec4(uColor,uAlpha*uPartWeight*(.23+.77*rim));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    const soft = material.clone(), hands = material.clone();
    soft.uniforms.uPartWeight.value = .24; hands.uniforms.uPartWeight.value = .55;
    root.traverse(o => { if (o.isMesh) {
      o.material = /shoe/.test(o.name) ? material : /glove/.test(o.name) ? hands : soft;
      o.castShadow = false; o.renderOrder = index + 1;
    } });
    scene.add(root);
    return { root, strikeBone: root.getObjectByName(motion.boneName), materials: [material, soft, hands], sample: makePoseSampler(root, kick, rig.hipsRest), state: null };
  });
  const inlay = new T.Mesh(new T.RingGeometry(height * .72, height * .725, 128), new T.MeshBasicMaterial({ color: 0xd7d8ce }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.y = -.02; scene.add(inlay);
  const effects = createImpactVFX(scene, height, motion);
  const params = new URLSearchParams(location.search), qa = params.has('qa');
  const reducedMedia = matchMedia('(prefers-reduced-motion: reduce)');
  $('reduced').checked = reducedMedia.matches;
  let time = clamp(Number(params.get('t') || 0), 0, DURATION);
  if (!Number.isFinite(time)) time = 0;
  if (params.get('mode') === 'manual' && Number.isFinite(Number(params.get('pose')))) time = showTimeForPose(Number(params.get('pose')), motion);
  let running = !params.has('t') && !reducedMedia.matches;
  let cameraMode = 'director', showSilhouettes = params.get('silhouettes') !== '0';
  let lastFrame = performance.now(), first = true, cameraTransition = null;
  let frameCount = 0, uiKey = '', noticeTimeout, lastCue = -1, lastGathered = 0;
  const visited = new Set();
  const cameraTarget = new T.Vector3(), cameraPosition = new T.Vector3();
  let cameraShot = null;
  function parseVector(name) {
    const a = (params.get(name) || '').split(',').map(Number);
    return a.length === 3 && a.every(n => Number.isFinite(n) && Math.abs(n) < 200) ? new T.Vector3(...a) : null;
  }
  const savedCamera = parseVector('cam'), savedTarget = parseVector('target');
  if (savedCamera && savedTarget && savedCamera.distanceTo(savedTarget) > 1) {
    camera.position.copy(savedCamera); controls.target.copy(savedTarget); camera.lookAt(savedTarget);
    cameraMode = 'inspect'; $('camera').textContent = 'Inspecting'; $('camera').setAttribute('aria-pressed', 'false');
  }
  $('overview').textContent = showSilhouettes ? 'Silhouettes on' : 'Silhouettes off';
  $('overview').setAttribute('aria-pressed', String(showSilhouettes));
  $('poseScrub').max = String(motion.duration);
  let audio = null, sound = false, noiseBuffer = null;
  const sounds = new Set();
  function stopSound() { for (const source of sounds) { try { source.stop(); } catch {} } sounds.clear(); }
  function tone(hz, length = .25, end = hz, volume = .025) {
    if (!sound || audio?.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    oscillator.frequency.setValueAtTime(hz, now); oscillator.frequency.exponentialRampToValueAtTime(end, now + length);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(volume, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + length);
    oscillator.connect(gain).connect(audio.destination); sounds.add(oscillator);
    oscillator.onended = () => { sounds.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(); oscillator.stop(now + length + .02);
  }
  function impactSound() {
    if (!sound || audio?.state !== 'running') return;
    tone(80, .38, 24, .12);
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain(), now = audio.currentTime;
    source.buffer = noiseBuffer; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3800, now); filter.frequency.exponentialRampToValueAtTime(180, now + .3);
    gain.gain.setValueAtTime(.14, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .35);
    source.connect(filter).connect(gain).connect(audio.destination); sounds.add(source);
    source.onended = () => { sounds.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(); source.stop(now + .38);
  }
  function notice(text) { $('notice').textContent = text; clearTimeout(noticeTimeout); noticeTimeout = setTimeout(() => $('notice').textContent = '', 3500); }
  function setCamera(mode) {
    cameraMode = mode;
    if (mode === 'director') {
      const damping = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = damping;
      cameraTransition = { position: camera.position.clone(), target: controls.target.clone(), elapsed: 0 };
    }
    $('camera').textContent = mode === 'director' ? 'Director view' : 'Inspecting';
    $('camera').setAttribute('aria-pressed', String(mode === 'director'));
  }
  function start() { stopSound(); time = 0; running = true; lastCue = -1; lastGathered = 0; visited.clear(); setCamera('director'); cameraTransition = null; }
  function seek(value) { stopSound(); time = clamp(value, 0, DURATION); running = false; lastCue = -1; cameraTransition = null; }
  function hold() { running = false; stopSound(); }
  function collect() { if (time < TIMING.apex || time >= TIMING.windup) return; time = Math.max(time, TIMING.collect); running = true; }
  function toggle() { if (time === DURATION) start(); else { running = !running; if (!running) stopSound(); } }
  $('start').onclick = start; $('restart').onclick = start; $('pause').onclick = toggle; $('freeze').onclick = hold; $('release').onclick = collect;
  $('showScrub').oninput = e => seek(+e.target.value);
  $('poseScrub').oninput = e => seek(showTimeForPose(+e.target.value, motion));
  $('speed').oninput = e => $('speedOut').textContent = (+e.target.value).toFixed(2) + '×';
  $('camera').onclick = () => setCamera(cameraMode === 'director' ? 'inspect' : 'director');
  controls.addEventListener('start', () => setCamera('inspect'));
  $('overview').onclick = () => {
    showSilhouettes = !showSilhouettes;
    $('overview').textContent = showSilhouettes ? 'Silhouettes on' : 'Silhouettes off';
    $('overview').setAttribute('aria-pressed', String(showSilhouettes));
  };
  $('reduced').onchange = () => setCamera('director');
  reducedMedia.addEventListener('change', e => { $('reduced').checked = e.matches; setCamera('director'); });
  $('sound').onclick = async () => {
    try {
      if (!audio) {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * .4), audio.sampleRate);
        const channel = noiseBuffer.getChannelData(0); let seed = 1357;
        for (let i = 0; i < channel.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; channel[i] = seed / 4294967296 * 2 - 1; }
      }
      sound = !sound;
      if (sound) { await audio.resume(); tone(330); } else { stopSound(); await audio.suspend(); }
      $('sound').textContent = sound ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', String(sound));
    } catch { sound = false; notice('Audio is unavailable in this browser.'); }
  };
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); } catch { notice('Fullscreen is unavailable in this browser.'); } };
  $('copyMoment').onclick = () => {
    hold(); const link = new URL(location.href); link.search = ''; link.searchParams.set('t', time.toFixed(3));
    if (!showSilhouettes) link.searchParams.set('silhouettes', '0');
    if (cameraMode === 'inspect') {
      link.searchParams.set('cam', camera.position.toArray().map(n => n.toFixed(3)).join(','));
      link.searchParams.set('target', controls.target.toArray().map(n => n.toFixed(3)).join(','));
    }
    $('momentURL').value = link.href; $('copyStatus').textContent = ''; $('momentDialog').showModal(); $('momentURL').select();
  };
  $('copyLink').onclick = async () => { try { await navigator.clipboard.writeText($('momentURL').value); $('copyStatus').textContent = 'Copied. Paste it in the chat with your note.'; } catch { $('momentURL').focus(); $('momentURL').select(); $('copyStatus').textContent = 'Press Ctrl+C (or hold to copy), then paste in the chat.'; } };
  CHAPTERS.forEach((chapter, index) => {
    const button = document.createElement('button'); button.textContent = chapter.label; button.dataset.step = String(index + 1).padStart(2, '0');
    button.style.left = chapter.at / DURATION * 100 + '%'; button.setAttribute('aria-label', `${chapter.label}, ${chapter.at} seconds`);
    button.onclick = () => seek(chapter.at); $('chapters').append(button);
  });
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.target.closest('button,input,a,select,textarea,summary,[contenteditable]')) return;
    const key = e.key.toLowerCase(); if ([' ', 'f', 'r', 'enter'].includes(key)) e.preventDefault();
    if (key === ' ') toggle(); if (key === 'f') hold(); if (key === 'r') start(); if (key === 'enter') collect();
  });
  document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); if (document.hidden) { hold(); audio?.suspend(); } else if (sound) audio?.resume().catch(() => {}); });
  function extendBoot(bone, thrust) {
    if (thrust <= 0) return;
    bone.parent.getWorldQuaternion(inverseParent).invert();
    thrustVector.copy(motion.attack).multiplyScalar(motion.thrustDistance * thrust).applyQuaternion(inverseParent);
    bone.position.add(thrustVector);
    bone.updateMatrixWorld(true);
  }
  function updateActors(state) {
    sampleHero(state.poseTime);
    extendBoot(strikeBone, state.thrust);
    for (let i = 0; i < silhouettes.length; i++) {
      const echo = silhouettes[i]; echo.state = silhouetteAt(i, state, motion);
      echo.sample(echo.state.poseTime);
      extendBoot(echo.strikeBone, echo.state.thrust);
      echo.root.visible = showSilhouettes && echo.state.visible;
      const heat = i === 0 ? ease(echo.state.travel / .8) : 0;
      for (const material of echo.materials) {
        material.uniforms.uAlpha.value = (.28 + i * .025 + heat * .26) * echo.state.opacity;
        material.uniforms.uColor.value.copy(echoBlue).lerp(echoAmber, heat);
      }
    }
  }
  function directCamera(state, dt) {
    const reduced = $('reduced').checked;
    cameraShot = sampleCamera(state, camera.aspect, stage.clientWidth, reduced, cameraPosition, cameraTarget);
    if (cameraTransition && !first && !reduced) {
      cameraTransition.elapsed += dt; const u = ease(cameraTransition.elapsed / .5);
      camera.position.lerpVectors(cameraTransition.position, cameraPosition, u);
      controls.target.lerpVectors(cameraTransition.target, cameraTarget, u);
      if (u === 1) cameraTransition = null;
    } else {
      camera.position.copy(cameraPosition); controls.target.copy(cameraTarget);
    }
    camera.lookAt(controls.target);
  }
  function updateUI(state) {
    const chapter = CHAPTERS[state.chapter], count = silhouettes.filter(e => e.state.visible).length;
    const collected = silhouettes.filter(e => e.state.travel >= 1).length;
    const key = [running, state.chapter, count, collected, time >= TIMING.windup].join('|');
    if (key !== uiKey) {
      $('chapterNumber').textContent = String(state.chapter + 1).padStart(2, '0') + ' / 07';
      $('chapterTitle').textContent = chapter.title; $('chapterNote').textContent = chapter.note;
      $('stageMode').textContent = state.complete ? 'Ready / complete' : state.chapter === 2 ? `Gathering ${collected} / 5` : `${chapter.label} / ${running ? 'playing' : 'held'}`;
      $('pause').textContent = running ? 'Ⅱ' : '▶'; $('pause').setAttribute('aria-label', running ? 'Pause playback' : 'Play sequence');
      $('release').disabled = time < TIMING.apex || time >= TIMING.windup;
      [...$('chapters').children].forEach((button, i) => button.setAttribute('aria-current', String(i === state.chapter)));
      uiKey = key;
    }
    $('showTime').textContent = time.toFixed(2); $('showScrub').value = String(time);
    $('showScrub').setAttribute('aria-valuetext', `${time.toFixed(2)} seconds, ${chapter.label}`);
    $('poseScrub').value = String(state.poseTime); $('poseTime').textContent = state.poseTime.toFixed(3) + ' / ' + motion.duration.toFixed(2) + ' s';
  }
  function resize() { renderer.setSize(stage.clientWidth, stage.clientHeight, false); camera.aspect = stage.clientWidth / stage.clientHeight; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(stage); resize();
  $('gl').addEventListener('webglcontextlost', e => { e.preventDefault(); hold(); $('error').hidden = false; $('error').textContent = 'The graphics connection was interrupted. Reload to reopen the performance.'; });
  function frame(now) {
    const dt = Math.max(0, (now - lastFrame) / 1000); lastFrame = now;
    const previousTime = time;
    if (running) { time = Math.min(DURATION, time + dt * +$('speed').value); if (time === DURATION) running = false; }
    const state = performanceAt(time, motion);
    updateActors(state);
    const gathered = silhouettes.filter(e => e.state.travel >= 1).length;
    if (running) {
      visited.add(state.chapter);
      if (gathered > lastGathered && time < TIMING.hit) tone(280 + gathered * 100, .14, 440 + gathered * 100, .018);
      if (state.chapter === 3 && lastCue !== 3) tone(220, .8, 880, .025);
      if (time >= TIMING.hit && previousTime < TIMING.hit) impactSound();
    }
    lastGathered = gathered; lastCue = state.chapter;
    if (cameraMode === 'director') directCamera(state, dt); else controls.update();
    const fade = running && cameraMode === 'director' && !$('reduced').checked ? cameraFadeAt(state.t) : 0;
    cameraFade.style.opacity = fade;
    effects.update(state, silhouettes.map(e => e.state), camera, $('reduced').checked, $('traces').checked);
    updateUI(state); renderer.render(scene, camera); first = false; frameCount++;
    if (qa) stage.dataset.qa = JSON.stringify({
      version: 3, clipRevision: kick.revision, showTime: time, running, poseTime: state.poseTime, phase: state.chapter, apex: motion.apex,
      hitAge: state.hitAge, thrust: state.thrust, cameraMode, visibleSilhouettes: silhouettes.filter(e => e.root.visible).length,
      silhouettes: silhouettes.map(e => ({ ...e.state, visible: e.root.visible })), snapshotTimes: motion.snapshotTimes,
      snapshotHeights: motion.heights, gathered, visited: [...visited], geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures, vfx: effects.diagnostics, frameCount,
      camera: { shot: cameraMode === 'director' ? cameraShot : null, fade, position: camera.position.toArray(), target: controls.target.toArray() },
      pose: rig.order.map(k => [...rig.bones[k].position.toArray(), ...rig.bones[k].quaternion.toArray()]),
    });
    requestAnimationFrame(frame);
  }
  await renderer.compileAsync(scene, camera);
  lastFrame = performance.now();
  $('loading').remove(); requestAnimationFrame(frame);
} catch (error) {
  console.error(error); $('loading')?.remove(); $('error').hidden = false; $('error').textContent = 'The performance could not open. ' + error.message;
}
