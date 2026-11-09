/** Seekable reveal clock. All visual envelopes depend on time, never frame history. */
export const DURATION = 12;
export const PHASES = [
  [0, .7, 'Awakening', 'Every surface becomes a point of light.'],
  [.7, 2.2, 'Unbound', 'One character. Thousands of possibilities.'],
  [2.2, 4.4, 'In flight', 'Color finds a new constellation.'],
  [4.4, 6, 'Recognition', 'A familiar shape comes into focus.'],
  [6, 9.2, 'The eye', 'A moment of clarity.'],
  [9.2, 11.4, 'Coming home', 'Every point remembers where it belongs.'],
  [11.4, 12, 'BuzzerB, again', 'Ready for the next move.'],
];
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, v) => { const t = clamp((v-a)/(b-a)); return t*t*(3-2*t); };
export function sampleTimeline(seconds) {
  const time = clamp(seconds, 0, DURATION);
  const phase = PHASES.find(([a,b]) => time >= a && time < b) || PHASES.at(-1);
  return { time, phase: phase[2], caption: phase[3],
    meshOpacity: 1-smooth(.72,1.72,time)+smooth(10.65,11.65,time),
    particleOpacity: smooth(0,.6,time)*(1-smooth(11.2,12,time)),
    hold: time >= 6 && time <= 9.2,
    logoBlend: smooth(4.4,6,time)*(1-smooth(9.2,11.4,time)),
    // CBS uses the supplied white treatment. Color clears before recognition;
    // it returns only after the returning particles have left the eye.
    brandWhite: smooth(3.5,4.2,time)*(1-smooth(9.75,10.7,time)),
    solidFinish: smooth(5.45,5.95,time)*(1-smooth(9.2,9.65,time)),
    blackStage: smooth(3.5,4.2,time)*(1-smooth(9.75,10.7,time)),
    brandLocked: time >= 4.4 && time <= 9.65,
    returnBlend: smooth(9.2,11.4,time),
    cameraBlend: smooth(0,2.5,time)*(1-smooth(11.4,12,time)),
  };
}
export function random32(seed = 0x51b00b) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t=state; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
}
export function upperBound(values, value) {
  let lo=0,hi=values.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<value)lo=mid+1;else hi=mid;}
  return lo;
}
