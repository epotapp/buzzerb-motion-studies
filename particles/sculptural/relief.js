import * as THREE from 'three';
import { SVGLoader } from './vendor/three/examples/jsm/loaders/SVGLoader.js';
import { DURATION, RELIEF_DEPTH, PHASES, clamp, smooth, range, mix, hash, phaseAt, weights, bezier } from './sequence-core.js';

const LOGO_URL = 'assets/cbs-eye-reference.svg';
const QUALITY = { low: 12000, medium: 26000, high: 48000 };
const TILE_STEP = .0275;
const TILE_RADIUS = TILE_STEP / Math.sqrt(3) * .992;
const TILE_DEPTH = .007;
const WIDTH = 3.65, CENTER_Y = 2.04, CENTER_Z = -0.28;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Rasterize the supplied artwork itself. Alpha preserves SVG winding, holes,
// curves and compound paths; no logo equations or reconstructed contours.
export async function loadLogoSurface() {
  const response = await fetch(LOGO_URL);
  if (!response.ok) throw new Error('CBS reference SVG could not be loaded.');
  const svg = await response.text();
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const box = doc.documentElement.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
  if (!box || box.length !== 4 || !(box[2] > 0 && box[3] > 0)) throw new Error('Replacement SVG needs a valid viewBox.');
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { image.src = url; await image.decode(); } finally { URL.revokeObjectURL(url); }
  const size = 1024, height = Math.round(size * box[3] / box[2]);
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, height);
  const pixels = ctx.getImageData(0, 0, size, height).data;
  let x0 = size, y0 = height, x1 = 0, y1 = 0, covered = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) if (pixels[(y * size + x) * 4 + 3] > 127) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); covered++;
  }
  if (covered < 100 || covered > size * height * .98) throw new Error('Use a transparent SVG silhouette with open negative spaces.');
  const w = x1 - x0 + 1, h = y1 - y0 + 1, worldH = WIDTH * box[3] / box[2];
  const alpha = (u, v) => {
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const x = Math.min(size - 1, Math.max(0, Math.floor(x0 + u * (w - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.floor(y0 + v * (h - 1))));
    return pixels[(y * size + x) * 4 + 3] / 255;
  };
  // The vector is also retained as a continuous relief. Its white face closes
  // microscopic sampling gaps; the particles provide the assembly and surface.
  const parsed = new SVGLoader().parse(svg);
  const scale = WIDTH / box[2];
  const map = p => new THREE.Vector2((p.x - box[0] - box[2] / 2) * scale, CENTER_Y - (p.y - box[1] - box[3] / 2) * scale);
  const shapes = parsed.paths.flatMap(p => SVGLoader.createShapes(p)).map(s => {
    const shape = new THREE.Shape(s.getPoints(48).map(map));
    shape.holes = s.holes.map(h => new THREE.Path(h.getPoints(48).map(map)));
    return shape;
  });
  const brandCanvas = document.createElement('canvas'); brandCanvas.width = size; brandCanvas.height = height;
  const brandContext = brandCanvas.getContext('2d');
  brandContext.fillStyle = '#000'; brandContext.fillRect(0, 0, size, height);
  brandContext.drawImage(image, 0, 0, size, height);
  const brandTexture = new THREE.CanvasTexture(brandCanvas);
  brandTexture.colorSpace = THREE.SRGBColorSpace;
  brandTexture.minFilter = THREE.LinearFilter; brandTexture.magFilter = THREE.LinearFilter;
  const sites = [], step = TILE_STEP, rowH = step * Math.sqrt(3) / 2;
  const du = step * .39 / WIDTH, dv = step * .39 / worldH;
  // Two densely packed planar faces. A shallow bevel draws the edges inward.
  for (let row = 0, y = -worldH / 2 + rowH / 2; y < worldH / 2; row++, y += rowH) {
    for (let x = -WIDTH / 2 + step * (.5 + (row % 2) / 2); x < WIDTH / 2; x += step) {
      const u = x / WIDTH + .5, v = .5 - y / worldH;
      if ([alpha(u, v), alpha(u - du, v), alpha(u + du, v), alpha(u, v - dv), alpha(u, v + dv)].some((a) => a < .5)) continue;
      sites.push({ p: [x, y + CENTER_Y, CENTER_Z + RELIEF_DEPTH / 2], n: [0, 0, 1], face: 0 });
      sites.push({ p: [x, y + CENTER_Y, CENTER_Z - RELIEF_DEPTH / 2], n: [0, 0, -1], face: 1 });
    }
  }
  // Sample the *actual mask boundary* with marching squares, then populate each
  // wall through the full finite depth. Both outer and negative-space walls exist.
  const nx = 300, ny = Math.round(nx * h / w), wallStep = .03;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const occ = corners.map(([dx, dy]) => alpha((ix + dx) / nx, (iy + dy) / ny) >= .5);
    const crossings = [];
    for (let e = 0; e < 4; e++) { const j = (e + 1) % 4; if (occ[e] !== occ[j]) crossings.push([(ix + (corners[e][0] + corners[j][0]) / 2) / nx, (iy + (corners[e][1] + corners[j][1]) / 2) / ny]); }
    if (!crossings.length) continue;
    for (let j = 0; j + 1 < crossings.length; j += 2) {
      const a = crossings[j], b = crossings[j + 1];
      const u = (a[0] + b[0]) / 2, v = (a[1] + b[1]) / 2;
      const gx = alpha(u + 2 / nx, v) - alpha(u - 2 / nx, v);
      const gy = alpha(u, v + 2 / ny) - alpha(u, v - 2 / ny);
      const norm = Math.hypot(gx, gy) || 1;
      const outwardX = -gx / norm, outwardY = gy / norm;
      // Staggered edge selection avoids oversampling the raster staircase.
      if (hash(ix * 619 + iy * 1291) > .72) continue;
      for (let z = -RELIEF_DEPTH / 2 + wallStep / 2; z < RELIEF_DEPTH / 2; z += wallStep) {
        sites.push({ p: [(u - .5) * WIDTH - outwardX * .012, (.5 - v) * worldH + CENTER_Y - outwardY * .012, z + CENTER_Z], n: [outwardX, outwardY, 0], face: 2 });
      }
    }
  }
  // Stratify the prefix by surface: the visible front receives twice the
  // sampling budget of the rear. Avoid spending most low-tier samples on walls.
  const layers = [0, 1, 2].map(face => sites.filter(s => s.face === face));
  for (const [layer, values] of layers.entries()) for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i * 31 + layer * 7919) * (i + 1)); [values[i], values[j]] = [values[j], values[i]];
  }
  const ordered = [], cursors = [0, 0, 0];
  while (ordered.length < sites.length) for (const layer of [0, 0, 1, 2]) {
    if (cursors[layer] < layers[layer].length) ordered.push(layers[layer][cursors[layer]++]);
  }
  return { sites: ordered, shapes, brandTexture, sourceAspect: box[2] / box[3], width: WIDTH, height: worldH, depth: RELIEF_DEPTH, alpha, coverage: covered / (size * height), source: LOGO_URL };
}

export function sampleCharacter(meshes, count) {
  const triangles = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let total = 0;
  meshes.forEach((mesh, mi) => {
    const g = mesh.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const ai = idx ? idx.getX(i) : i, bi = idx ? idx.getX(i + 1) : i + 1, ci = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, ai); b.fromBufferAttribute(p, bi); c.fromBufferAttribute(p, ci);
      const area = b.sub(a).cross(c.sub(a)).length() / 2;
      if (area <= 1e-10) continue;
      total += area; triangles.push({ mi, ai, bi, ci, end: total });
    }
  });
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3), meshIds = new Uint8Array(count), seeds = new Float32Array(count);
  const bn = new THREE.Vector3(), cn = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const pick = hash(i * 73 + 17) * total;
    let lo = 0, hi = triangles.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (triangles[mid].end < pick) lo = mid + 1; else hi = mid; }
    const tri = triangles[lo], mesh = meshes[tri.mi], p = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal;
    const su = Math.sqrt(hash(i * 101 + 3)), v = hash(i * 157 + 7), aa = 1 - su, bb = su * (1 - v), cc = su * v;
    a.fromBufferAttribute(p, tri.ai).multiplyScalar(aa); b.fromBufferAttribute(p, tri.bi).multiplyScalar(bb); c.fromBufferAttribute(p, tri.ci).multiplyScalar(cc);
    a.add(b).add(c).toArray(positions, i * 3);
    if (normal) {
      a.fromBufferAttribute(normal, tri.ai).multiplyScalar(aa); bn.fromBufferAttribute(normal, tri.bi).multiplyScalar(bb); cn.fromBufferAttribute(normal, tri.ci).multiplyScalar(cc);
      a.add(bn).add(cn).normalize().toArray(normals, i * 3);
    } else { a.set(0, 1, 0).toArray(normals, i * 3); }
    mesh.material.color.toArray(colors, i * 3); meshIds[i] = tri.mi; seeds[i] = hash(i * 397 + 41);
  }
  return { positions, normals, colors, meshIds, seeds, area: total, triangleCount: triangles.length };
}

export class ReliefSequence {
  constructor({ scene, rig, camera, controls, renderer, reducedMotion, onBegin, evaluateSource, onEnd, onState }) {
    Object.assign(this, { scene, rig, camera, controls, renderer, reducedMotion, onBegin, evaluateSource, onEnd, onState });
    this.time = 0; this.duration = DURATION; this.speed = 1; this.active = false; this.paused = true; this.loop = false; this.cameraEnabled = true; this.quality = globalThis.innerWidth && globalThis.innerWidth < 760 ? 'low' : 'high';
    this.meshes = []; rig.root.traverse((o) => { if (o.isMesh) this.meshes.push(o); });
    this.materials = [...new Set(this.meshes.map((m) => m.material))];
    this.savedMaterials = this.materials.map((m) => ({ roughness: m.roughness, metalness: m.metalness }));
    this.normalMatrices = this.meshes.map(() => new THREE.Matrix3());
    this.startPos = camera.position.clone(); this.startTarget = controls.target.clone();
    this.work = new THREE.Object3D(); this.source = new THREE.Vector3(); this.normal = new THREE.Vector3(); this.color = new THREE.Color(); this.sourceQ = new THREE.Quaternion(); this.targetQ = new THREE.Quaternion(); this.spinQ = new THREE.Quaternion(); this.euler = new THREE.Euler();
    this.p = [0, 0, 0]; this.a = [0, 0, 0]; this.b = [0, 0, 0]; this.c = [0, 0, 0]; this.lane = [0, 0, 0];
    this.stats = {};
  }

  async init(suppliedSurface = null) {
    this.logo = suppliedSurface || await loadLogoSurface();
    this.capacity = Math.min(QUALITY.high, this.logo.sites.length);
    this.samples = sampleCharacter(this.meshes, this.capacity);
    const geometry = new THREE.CylinderGeometry(1, 1, TILE_DEPTH / TILE_RADIUS, 6, 1).rotateX(Math.PI / 2);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .3, metalness: .08, transparent: true, opacity: 1 });
    this.fragments = new THREE.InstancedMesh(geometry, this.material, this.capacity);
    this.fragments.name = 'CBS relief · persistent surface fragments';
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.fragments.frustumCulled = false; this.fragments.castShadow = false; this.fragments.receiveShadow = false;
    this.scene.add(this.fragments); this.fragments.visible = false;
    this.targetNormals = new Float32Array(this.capacity * 3); this.targets = new Float32Array(this.capacity * 3);
    this.faceCounts = [0, 0, 0];
    this.logo.sites.slice(0, this.capacity).forEach((s, i) => { this.targets.set(s.p, i * 3); this.targetNormals.set(s.n, i * 3); this.faceCounts[s.face]++; });
    let outsideMask = 0, minZ = Infinity, maxZ = -Infinity;
    this.logo.sites.slice(0, this.capacity).forEach((s) => {
      minZ = Math.min(minZ, s.p[2]); maxZ = Math.max(maxZ, s.p[2]);
      if (s.face < 2 && this.logo.alpha && this.logo.alpha(s.p[0] / WIDTH + .5, .5 - (s.p[1] - CENTER_Y) / this.logo.height) < .5) outsideMask++;
    });
    this.targetMetrics = { outsideMask, depthSpan: maxZ - minZ, reliefSurfaceSites: this.logo.sites.length };
    if (this.logo.shapes?.length) {
      this.solidMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .28, metalness: .08, transparent: true, opacity: 0 });
      const body = new THREE.ExtrudeGeometry(this.logo.shapes, { depth: RELIEF_DEPTH - .04, bevelEnabled: true, bevelThickness: .02, bevelSize: .026, bevelOffset: -.026, bevelSegments: 3, curveSegments: 32, steps: 1 });
      body.translate(0, 0, CENTER_Z - RELIEF_DEPTH / 2 + .02);
      this.solid = new THREE.Mesh(body, this.solidMaterial);
      this.solid.name = 'CBS exact vector relief'; this.solid.castShadow = true; this.solid.visible = false;
      this.faceMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.logo.brandTexture, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false, fog: false });
      this.face = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, this.logo.height), this.faceMaterial);
      this.face.position.set(0, CENTER_Y, CENTER_Z + RELIEF_DEPTH / 2 + .009);
      this.face.name = 'CBS official white face'; this.face.visible = false;
      this.scene.add(this.solid, this.face);
    }
    this.setQuality(this.quality);
    return this;
  }

  setQuality(q) {
    if (!(q in QUALITY)) return;
    this.quality = q; this.count = Math.min(QUALITY[q], this.capacity);
    this.fragments.count = this.count;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, q === 'high' ? 2 : q === 'low' ? 1 : 1.5));
    if (this.active) this.render();
    this.onState?.();
  }

  prepare() {
    if (this.active) return;
    this.startPos.copy(this.camera.position); this.startTarget.copy(this.controls.target);
    this.onBegin(); this.active = true; this.cameraEnabled = true;
  }

  restart() { this.prepare(); this.time = this.speed < 0 ? DURATION : 0; this.paused = false; this.render(); this.onState?.(); }
  play() { this.prepare(); if (this.time >= DURATION && this.speed > 0) this.time = 0; if (this.time <= 0 && this.speed < 0) this.time = DURATION; this.paused = false; this.render(); this.onState?.(); }
  pause() { this.paused = true; this.onState?.(); }
  setSpeed(rate) { if (!Number.isFinite(rate) || Math.abs(rate) > 4) return; this.speed = rate; if (!rate) this.paused = true; this.onState?.(); }
  seek(seconds) { this.prepare(); this.time = clamp(+seconds || 0, 0, DURATION); this.paused = true; this.render(); this.onState?.(); return this.inspect(); }
  cancel() {
    if (!this.active) return;
    this.restore(); this.active = false; this.paused = true; this.onEnd?.(); this.onState?.();
  }
  restore() {
    this.fragments.visible = false;
    if (this.solid) this.solid.visible = false;
    if (this.face) this.face.visible = false;
    this.controls.enabled = true;
    this.meshes.forEach((m) => { m.visible = true; m.castShadow = true; });
    this.materials.forEach((m, i) => { m.opacity = 1; m.transparent = false; m.depthWrite = true; Object.assign(m, this.savedMaterials[i]); m.needsUpdate = true; });
  }
  advance(dt) {
    if (!this.active) return;
    if (this.paused) return;
    if (!this.paused) {
      let next = this.time + dt * this.speed;
      if (this.loop && (next > DURATION || next < 0)) next = (next % DURATION + DURATION) % DURATION;
      else if (next >= DURATION || next <= 0) { next = clamp(next, 0, DURATION); this.paused = true; }
      this.time = next;
    }
    this.render();
  }

  render() {
    if (!this.active || !this.fragments) return;
    const t = this.time, w = weights(t);
    this.evaluateSource(t);
    this.rig.root.updateMatrixWorld(true);
    this.meshes.forEach((m, i) => { this.normalMatrices[i].getNormalMatrix(m.matrixWorld); m.visible = w.mesh > .001; m.castShadow = w.mesh > .3; });
    this.materials.forEach((m, i) => {
      if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
      m.opacity = clamp(w.mesh); m.depthWrite = w.mesh > .98;
      m.roughness = mix(this.savedMaterials[i].roughness, .22, range(t, .4, 1.4) * (1 - range(t, 11.5, 12.8)));
      m.metalness = mix(this.savedMaterials[i].metalness, .3, range(t, .4, 1.4) * (1 - range(t, 11.5, 12.8)));
    });
    this.material.opacity = clamp(w.particles * 1.8);
    const fused = range(t, 5.5, 6.4) * (1 - range(t, 9.55, 10.15));
    this.fragments.visible = w.particles > .001 && !(this.face && fused >= .99999);
    if (this.solid) { this.solid.visible = fused > .001; this.solidMaterial.opacity = fused; }
    if (this.face) { this.face.visible = fused > .001; this.faceMaterial.opacity = fused; }
    const { positions, normals, meshIds, seeds, colors } = this.samples;
    const reduced = this.reducedMotion.matches;
    const beadScale = TILE_RADIUS;
    let finite = true, attachedError = 0;
    if (this.fragments.visible) for (let i = 0; i < this.count; i++) {
      const k = i * 3, seed = seeds[i], mi = meshIds[i], delay = seed * .5;
      this.source.fromArray(positions, k).applyMatrix4(this.meshes[mi].matrixWorld);
      this.normal.fromArray(normals, k).applyMatrix3(this.normalMatrices[mi]).normalize();
      this.sourceQ.setFromUnitVectors(Z_AXIS, this.normal);
      const sx = this.source.x, sy = this.source.y, sz = this.source.z;
      const laneId = i % 5, angle = hash(i * 89 + 2) * Math.PI * 2;
      const lx = Math.sin(angle) * (2.7 + .11 * laneId), ly = CENTER_Y + Math.cos(angle) * (1.35 + .12 * laneId), lz = (laneId - 2) * .9;
      const tx = this.targets[k], ty = this.targets[k + 1], tz = this.targets[k + 2];
      this.a[0] = sx; this.a[1] = sy; this.a[2] = sz;
      this.lane[0] = lx; this.lane[1] = ly; this.lane[2] = lz;
      const outEnd = 3.0 + delay;
      let orientation = 0, flight = 0;
      if (t < outEnd) {
        const u = range(t, 1.55 + delay * .55, outEnd);
        this.b[0] = sx + this.normal.x * .8; this.b[1] = sy + .45 + this.normal.y * .7; this.b[2] = sz + this.normal.z * .9 + lz * .25;
        this.c[0] = lx * .9; this.c[1] = ly + .7; this.c[2] = lz * 1.2;
        bezier(this.a, this.b, this.c, this.lane, u, this.p); flight = u;
      } else if (t < 6.4) {
        const u = range(t, outEnd, 6.05 + delay * .55);
        this.a[0] = tx; this.a[1] = ty; this.a[2] = tz;
        this.b[0] = lx * .8; this.b[1] = ly + .65; this.b[2] = lz;
        this.c[0] = tx * 1.08; this.c[1] = ty + .2; this.c[2] = tz + (laneId - 2) * .38;
        bezier(this.lane, this.b, this.c, this.a, u, this.p); orientation = u; flight = 1 - u;
      } else if (t < 9.55 + delay * .4) {
        this.p[0] = tx; this.p[1] = ty; this.p[2] = tz; orientation = 1;
      } else {
        const u = range(t, 9.55 + delay * .4, 12.0 + delay * .45);
        this.a[0] = tx; this.a[1] = ty; this.a[2] = tz;
        this.b[0] = tx * 1.25; this.b[1] = ty + .55; this.b[2] = tz + (laneId - 2) * .64;
        this.c[0] = sx + Math.sin(angle) * .8; this.c[1] = sy + .7; this.c[2] = sz + lz * .6;
        this.lane[0] = sx; this.lane[1] = sy; this.lane[2] = sz;
        bezier(this.a, this.b, this.c, this.lane, u, this.p); orientation = 1 - u; flight = Math.sin(u * Math.PI);
        if (u === 1) attachedError = Math.max(attachedError, Math.hypot(this.p[0] - sx, this.p[1] - sy, this.p[2] - sz));
      }
      this.work.position.set(...this.p);
      this.normal.fromArray(this.targetNormals, k);
      this.targetQ.setFromUnitVectors(Z_AXIS, this.normal);
      this.work.quaternion.copy(this.sourceQ).slerp(this.targetQ, smooth(orientation));
      if (!reduced && flight > .001) {
        this.euler.set(seed * 13 + t * (seed - .5) * 4, seed * 7 + t * 1.2, seed * 9);
        this.spinQ.setFromEuler(this.euler); this.work.quaternion.slerp(this.spinQ, flight * .9);
      }
      const size = beadScale * mix(.8 + hash(i * 197) * .4, 1, smooth(orientation)) * Math.min(1, w.particles * 3);
      // Flattened faceted beads make a convincing light-catching surface while
      // retaining thickness along all axes. Side beads face their wall normal.
      this.work.scale.setScalar(size);
      this.work.updateMatrix(); this.fragments.setMatrixAt(i, this.work.matrix);
      // The recognizable mark is always the official white treatment. Source
      // character colors return only after the assembled mark has dispersed.
      const brand = range(t, 3.4, 4.3) * (1 - range(t, 10.2, 11.6));
      this.color.setRGB(mix(colors[k], 1, brand), mix(colors[k + 1], 1, brand), mix(colors[k + 2], 1, brand));
      this.fragments.setColorAt(i, this.color);
      finite &&= Number.isFinite(this.p[0] + this.p[1] + this.p[2]);
    }
    if (!this.fragments.visible) {
      // Hidden endpoints have a canonical matrix buffer too: seeking or reversing
      // to an invisible phase never retains the preceding visible pose.
      this.fragments.instanceMatrix.array.fill(0);
      for (let i = 0; i < this.capacity; i++) this.fragments.instanceMatrix.array[i * 16 + 15] = 1;
    }
    this.fragments.instanceMatrix.needsUpdate = true;
    if (this.fragments.instanceColor) this.fragments.instanceColor.needsUpdate = true;
    const brandLocked = t >= 4.55 && t <= 9.55;
    this.brandLocked = brandLocked;
    this.controls.enabled = !brandLocked;
    if (this.cameraEnabled || brandLocked) this.updateCamera();
    this.stats = { finite, attachedError };
    this.onState?.();
  }

  updateCamera() {
    const t = this.time, home = this.startPos.toArray(), aim = this.startTarget.toArray();
    let points;
    if (this.reducedMotion.matches) points = [[0, [0, CENTER_Y, 11.8], [0, CENTER_Y, CENTER_Z]], [DURATION, [0, CENTER_Y, 11.8], [0, CENTER_Y, CENTER_Z]]];
    else points = [
      [0, home, aim], [1.35, [.35, 2.3, 8.2], [0, 1.65, 0]],
      [3.4, [2.9, 3.15, 12.5], [0, 2.05, 0]],
      [4.55, [0, 2.04, 9.25], [0, 2.04, CENTER_Z]],
      [6.4, [0, 2.04, 9.25], [0, 2.04, CENTER_Z]],
      [7.35, [0, 2.04, 9.25], [0, 2.04, CENTER_Z]],
      [8.6, [0, 2.04, 9.25], [0, 2.04, CENTER_Z]],
      [9.55, [0, 2.04, 9.25], [0, 2.04, CENTER_Z]],
      [10.6, [2.4, 3.0, 11.5], [0, 1.9, 0]], [12.8, home, aim], [DURATION, home, aim],
    ];
    let j = 0; while (j < points.length - 2 && t > points[j + 1][0]) j++;
    const a = points[j], b = points[j + 1], u = range(t, a[0], b[0]);
    const aspect = this.camera.aspect;
    const narrow = aspect < 1 ? 1 + (1 - aspect) * .72 : 1;
    this.camera.position.set(mix(a[1][0], b[1][0], u), mix(a[1][1], b[1][1], u), mix(a[1][2], b[1][2], u) * narrow);
    this.controls.target.set(mix(a[2][0], b[2][0], u), mix(a[2][1], b[2][1], u), mix(a[2][2], b[2][2], u));
    this.camera.lookAt(this.controls.target);
  }

  inspect() {
    const sampled = Array.from(new Set(this.samples?.meshIds || []));
    return { approach: 'sculptural relief', time: this.time, duration: DURATION, phase: phaseAt(this.time).name, active: this.active, paused: this.paused, speed: this.speed, loop: this.loop, count: this.count, capacity: this.capacity, quality: this.quality, permanentIds: true, sampledMeshCount: sampled.length, sampledMeshNames: sampled.map((i) => this.meshes[i].name), sourceTriangles: this.samples?.triangleCount, logoDepth: this.logo?.depth, logoWidth: this.logo?.width, logoHeight: this.logo?.height, logoSourceAspect: this.logo?.sourceAspect, palette: { foreground: '#FFFFFF', background: '#000000' }, fusedFinish: this.faceMaterial?.opacity || 0, brandLocked: !!this.brandLocked, targetFaceCounts: this.faceCounts, ...this.targetMetrics, artwork: LOGO_URL, artworkStatus: 'Official website reference; eye-alone final approval pending', camera: this.brandLocked ? 'Frontal brand hold' : this.cameraEnabled ? 'Authored relief path' : 'Manual takeover', reducedMotion: this.reducedMotion.matches, ...this.stats };
  }
}

export { DURATION, PHASES, phaseAt };
