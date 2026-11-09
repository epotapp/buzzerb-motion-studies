// Absolute, stateless sequence math. No wall-clock state enters a pose.
export const DURATION = 13.2;
export const RELIEF_DEPTH = 0.52;
export const PHASES = [
  { at: 0, name: 'Character', label: 'The familiar, in a different light.' },
  { at: 0.65, name: 'Faceted birth', label: 'A surface catches the light.' },
  { at: 1.65, name: 'Disintegration', label: 'One character. Thousands of facets.' },
  { at: 3.0, name: 'Depth lanes', label: 'Separate paths. A shared destination.' },
  { at: 4.55, name: 'Relief formation', label: 'Depth becomes a signature.' },
  { at: 6.4, name: 'CBS · relief', label: 'An icon, given dimension.' },
  { at: 9.55, name: 'Reassembly', label: 'Every fragment knows its way home.' },
  { at: 12.5, name: 'Character restored', label: 'Back to BuzzerB.' },
];
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const range = (t, a, b) => smooth((t - a) / (b - a));
export const mix = (a, b, u) => a + (b - a) * u;
export const hash = (n) => { let x = (n + 0x6d2b79f5) | 0; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
export function phaseAt(t) { return [...PHASES].reverse().find((p) => t >= p.at) || PHASES[0]; }
// Source advances at the beginning and end, freezes during detached travel.
export function sourceSeconds(t) { return Math.min(t, 1.35) + Math.max(0, t - 10.05); }
// Complete an integer number of source cycles per reveal. Absorb the additional
// phase during early return, before mesh restoration begins, so the fully visible
// birth and restored character both retain 1x source playback at the loop seam.
// Static poses hold their captured phase throughout instead of cycling their
// brief baked transition. Endpoints use the same normalized anchor exactly.
export function sourceClipTime(t, duration, anchor = 0, still = false) {
  if (!(duration > 0)) return 0;
  if (still) return clamp(anchor, 0, Math.max(0, duration - .00001));
  const wrap = (s) => ((s % duration) + duration) % duration;
  const start = wrap(anchor);
  if (t <= 0 || t >= DURATION) return start;
  const visibleAdvance = sourceSeconds(DURATION);
  const cycleAdvance = Math.max(1, Math.ceil(visibleAdvance / duration - 1e-10)) * duration;
  const extraPhase = Math.max(0, cycleAdvance - visibleAdvance) * range(t, 10.05, 11.45);
  return wrap(start + sourceSeconds(t) + extraPhase);
}
export function weights(t) {
  const birth = range(t, 0.65, 1.7);
  const restore = range(t, 11.65, 12.65);
  return { mesh: (1 - birth) + restore, particles: birth * (1 - restore), hero: range(t, 3.5, 6.1) * (1 - range(t, 9.6, 12.0)) };
}
// Cubic Bézier uses the same finite route in either playback direction.
export function bezier(a, b, c, d, u, out) {
  const v = 1 - u, aa = v * v * v, bb = 3 * v * v * u, cc = 3 * v * u * u, dd = u * u * u;
  out[0] = a[0] * aa + b[0] * bb + c[0] * cc + d[0] * dd;
  out[1] = a[1] * aa + b[1] * bb + c[1] * cc + d[1] * dd;
  out[2] = a[2] * aa + b[2] * bb + c[2] * cc + d[2] * dd;
  return out;
}
