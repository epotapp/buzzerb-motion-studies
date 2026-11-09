// Deterministic production data and CPU trajectory reference. No DOM or history.
export const VERSION = 'smooth-particles-4';
export const DURATION = 14.3;
export const SEED = 0xCB510E;
export const LOGO = { width: 2.8, height: 2.8 * 24 / 24.5, centerY: 1.8, z: .2 };
export const BRAND = Object.freeze({ foreground: '#ffffff', background: '#000000', sourceAspect: 24.5 / 24, columns: 224, holdStart: 6.4, holdEnd: 10.4 });
export const QUALITY = Object.freeze({ low: { dpr: 1, detail: 0 }, medium: { dpr: 1.5, detail: 1 }, high: { dpr: 2, detail: 2 } });
export const quintic = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * u * (u * (u * 6 - 15) + 10); };
export const smooth = quintic;
export function rng(seed = SEED) { return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function sourceClipTime(seconds, start, duration, still = false) {
  if (still) return Math.max(0, Math.min(duration * (1 - 1e-7), start));
  // Visible departure/return keep the clip's original 1x speed. The integer
  // cycle correction happens only while all particles have detached and the
  // solid character is fully dissolved (2.3..6.0 seconds).
  const cycles = Math.max(1, Math.round(DURATION / duration));
  const correction = (cycles * duration - DURATION) * quintic(2.3, 6, seconds);
  return ((start + seconds + correction) % duration + duration) % duration;
}
export function maskAt(mask, u, v) {
  const x = Math.floor(u * mask.width), y = Math.floor(v * mask.height);
  return x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.alpha[y * mask.width + x] > 127;
}

// Every cell intersecting any source-alpha texel is retained. A one-texel
// halo also retains the exact linear-filter footprint at curved boundaries.
export function buildLogoLattice(mask, columns = BRAND.columns) {
  const rows = Math.round(columns / (LOGO.width / LOGO.height)), stride = mask.width + 1;
  const integral = new Uint32Array(stride * (mask.height + 1));
  for (let y = 0; y < mask.height; y++) { let sum = 0; for (let x = 0; x < mask.width; x++) { sum += Number(mask.alpha[y * mask.width + x] > 0); integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum; } }
  const countRect = (x0, y0, x1, y1) => integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
  const cells = [], target = [], patches = [], seed = [], random = rng();
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const x0 = Math.max(0, Math.floor(col / columns * mask.width) - 1), x1 = Math.min(mask.width, Math.ceil((col + 1) / columns * mask.width) + 1);
    const y0 = Math.max(0, Math.floor(row / rows * mask.height) - 1), y1 = Math.min(mask.height, Math.ceil((row + 1) / rows * mask.height) + 1);
    if (!countRect(x0, y0, x1, y1)) continue;
    cells.push(col, row);
    target.push(((col + .5) / columns - .5) * LOGO.width, (.5 - (row + .5) / rows) * LOGO.height, 0);
    patches.push(col / columns, row / rows, 1 / columns, 1 / rows);
    seed.push(random(), random(), random(), random());
  }
  return { count: cells.length / 2, columns, rows, cells: Uint16Array.from(cells), target: Float32Array.from(target), patches: Float32Array.from(patches), seed: Float32Array.from(seed), tileSize: [LOGO.width / columns, LOGO.height / rows], sourceAspect: LOGO.width / LOGO.height, sourceWidth: mask.width, sourceHeight: mask.height };
}

export function particleProgress(time, seed) {
  return {
    departure: quintic(.55 + seed[0] * .35, 1.75 + seed[0] * .45, time),
    arrival: quintic(2.6 + seed[2] * 1.25, 5.15 + seed[3] * 1.25, time),
    returning: quintic(10.4 + seed[2] * .55, 13.35 + seed[3] * .55, time),
  };
}
export function stateAt(seconds) {
  const t = Math.max(0, Math.min(DURATION, Number.isFinite(seconds) ? seconds : 0));
  const phase = t < .5 ? 'Presence' : t < 1.5 ? 'Particle birth' : t < 2.6 ? 'Detached flow' : t < 6.4 ? 'Gathering the CBS eye' : t < 10.4 ? 'CBS eye · particle hold' : t < 13.9 ? 'Return & reassembly' : 'BuzzerB · restored';
  return { time: t, phase, formation: t >= 6.4 && t <= 10.4 ? 'positive' : 'transit',
    birth: quintic(.45, 1.45, t), visibility: quintic(.45, 1.45, t) * (1 - quintic(13.9, 14.3, t)),
    dissolve: quintic(.75, 1.9, t) * (1 - quintic(13, 14.1, t)),
    blackBackground: quintic(1.5, 2.3, t) * (1 - quintic(13, 14.3, t)),
    neutralColor: quintic(1.85, 2.55, t) * (1 - quintic(12.2, 13.9, t)),
    arrivalProgress: quintic(2.6, 6.4, t), returnProgress: quintic(10.4, 13.9, t),
    pointerStrength: quintic(.8, 1.8, t) * (1 - quintic(4.2, 6.4, t)),
  };
}

const mix = (a, b, t) => a.map((x, i) => x * (1 - t) + b[i] * t);
// This mirrors the shader algebra for deterministic continuity/endpoint checks;
// source/target are WORLD positions after actual rigid and logo-space matrices.
export function sampleTrajectory(time, seed, source, target, { normal = [0, 1, 0], pointer = [0, 0], reduced = 0 } = {}) {
  const progress = particleProgress(time, seed), { departure: d, arrival: a, returning: r } = progress;
  const lane = Math.floor(seed[1] * 15), angle = lane * Math.PI * 2 / 15 + time * (1.7 + seed[3] * .55) + seed[2] * .23;
  const radius = .75 + 1.65 * seed[0] + .18 * Math.sin(time * 2.3 + seed[2] * Math.PI * 2);
  const flow = [Math.cos(angle) * radius, 1.8 + Math.sin(angle) * radius * .72, Math.sin(angle * 1.8 + seed[2] * 4) * .62];
  const turbulence = [Math.sin(angle * 3 + seed[0] * 8), Math.cos(angle * 2 + seed[1] * 7), Math.sin(angle * 4)];
  for (let k = 0; k < 3; k++) flow[k] += turbulence[k] * .12 * (1 - reduced * .65);
  const q = [flow[0] - pointer[0], flow[1] - (pointer[1] + 1.8)];
  const force = Math.exp(-(q[0] ** 2 + q[1] ** 2) * 1.9) * .48 * stateAt(time).pointerStrength * (1 - a);
  flow[0] += -q[1] * force; flow[1] += q[0] * force;
  // Smooth bounded compression, avoiding the velocity corners of hard clamps.
  flow[0] = 2.8 * Math.tanh(flow[0] / 2.8); flow[1] = 1.8 + 2.05 * Math.tanh((flow[1] - 1.8) / 2.05);
  let p = mix(source, flow, d);
  for (let k = 0; k < 3; k++) p[k] += normal[k] * Math.sin(Math.PI * d) * .22;
  const arc = [Math.sin(seed[1] * Math.PI * 2) * .52, Math.cos(seed[2] * Math.PI * 2) * .38, Math.sin(seed[3] * Math.PI * 2) * .7];
  p = mix(p, target, a);
  for (let k = 0; k < 3; k++) p[k] += Math.sin(Math.PI * a) * arc[k];
  if (r > 0) {
    p = mix(target, source, r);
    const bow = Math.sin(Math.PI * r);
    const mid = mix(target, source, r);
    for (let k = 0; k < 3; k++) p[k] += bow * (flow[k] - mid[k]) * .75 + bow * arc[k];
  }
  return { position: p, ...progress, shape: a * (1 - r), neutralColor: stateAt(time).neutralColor, visibility: stateAt(time).visibility };
}
