import * as T from './vendor/three/build/three.module.js';
import { clamp, ease, mix, makePoseSampler } from './temporal.js';

export const DURATION = 24;
export const SILHOUETTES = 5;
const collect = 12.5, collectStep = 1.35, collectTravel = 1.05;
const converge = collect + (SILHOUETTES - 1) * collectStep;
const hit = +(converge + collectTravel).toFixed(2);
const recover = +(hit + .20).toFixed(2);
export const TIMING = Object.freeze({
  prepEnd: 2.2, apex: 11.5, collect, collectStep, collectTravel,
  converge, windup: hit - .20, hit, recover, ready: +(recover + 1.15).toFixed(2),
});
export const CHAPTERS = [
  { at: 0, label: 'Slow kick', title: 'Every moment of the ascent', note: 'Five silhouettes stay behind as the kick rises in slow motion.' },
  { at: TIMING.apex, label: 'Apex', title: 'Hold the highest point', note: 'One performer at the peak. Five moments suspended below.' },
  { at: TIMING.collect, label: 'Gather', title: 'Closest to the peak first', note: 'The silhouette nearest the held kick joins first. The farthest joins last.' },
  { at: TIMING.converge, label: 'Converge', title: 'The last silhouette closes in', note: 'The final silhouette carries the gathered energy to the boot tip.' },
  { at: TIMING.hit, label: 'Strike', title: 'Release the impact', note: 'The last silhouette hits the toe. Fire, sparks and a pressure wave break out from contact.' },
  { at: TIMING.recover, label: 'Return', title: 'Back at full speed', note: 'The kick snaps into its normal recovery.' },
  { at: TIMING.ready, label: 'Ready', title: 'Ready for the next kick', note: 'Replay the performance, or scrub through any moment.' },
];

// Analyze the actual raised-shoe center, rather than assuming the old cue is
// the apex. The source remains an in-place kick; no layout or root flight is added.
export function analyzeKick(rig, clip) {
  const root = rig.root.clone(true), sample = makePoseSampler(root, clip, rig.hipsRest);
  const feet = ['L', 'R'].map(side => {
    const mesh = root.getObjectByName('BuzzerB_shoe_' + side);
    mesh.geometry.computeBoundingBox();
    // Local +Z points toward the toe. Use the actual frontmost mesh vertex.
    const vertices = mesh.geometry.attributes.position;
    let tipIndex = 0;
    for (let i = 1; i < vertices.count; i++) {
      if (vertices.getZ(i) > vertices.getZ(tipIndex)) tipIndex = i;
    }
    const toe = new T.Vector3().fromBufferAttribute(vertices, tipIndex);
    return { mesh, center: mesh.geometry.boundingBox.getCenter(new T.Vector3()), toe, points: [], toePoints: [] };
  });
  const point = new T.Vector3();
  for (let frame = 0; frame < clip.n; frame++) {
    sample(frame / clip.fps);
    for (const foot of feet) {
      foot.points.push(point.copy(foot.center).applyMatrix4(foot.mesh.matrixWorld).clone());
      foot.toePoints.push(point.copy(foot.toe).applyMatrix4(foot.mesh.matrixWorld).clone());
    }
  }
  const foot = feet.reduce((a, b) => {
    const range = f => Math.max(...f.points.map(p => p.y)) - Math.min(...f.points.map(p => p.y));
    return range(a) >= range(b) ? a : b;
  });
  let peakFrame = 0;
  foot.points.forEach((p, i) => { if (p.y > foot.points[peakFrame].y) peakFrame = i; });
  const apex = peakFrame / clip.fps, bottom = foot.points[0].y, rise = foot.points[peakFrame].y - bottom;
  const timeAtHeight = fraction => {
    if (fraction <= 0) return 0;
    const y = bottom + rise * fraction;
    for (let i = 1; i <= peakFrame; i++) {
      if (foot.points[i].y >= y) {
        const u = clamp((y - foot.points[i - 1].y) / Math.max(1e-8, foot.points[i].y - foot.points[i - 1].y));
        return (i - 1 + u) / clip.fps;
      }
    }
    return apex;
  };
  // Height-linear timing gives the fast source extension room to read in slow-mo.
  const riseTimes = Array.from({ length: 101 }, (_, i) => timeAtHeight(.035 + .965 * i / 100));
  const snapshotFractions = [0, .22, .44, .66, .84];
  const snapshotTimes = snapshotFractions.map(timeAtHeight);
  const peak = foot.points[peakFrame].clone();
  const duration = (clip.n - 1) / clip.fps;
  const impact = clamp(clip.events?.find(event => event.name === 'impact')?.time ?? apex, apex, duration);
  sample(impact);
  const impactToe = foot.toe.clone().applyMatrix4(foot.mesh.matrixWorld);
  const impactCenter = foot.center.clone().applyMatrix4(foot.mesh.matrixWorld);
  // Use the same approach window when the baked sample rate changes.
  const approachFrames = Math.max(1, Math.round(clip.fps * (4 / 60)));
  const approachFrame = Math.max(0, Math.round(impact * clip.fps) - approachFrames);
  const attack = impactCenter.sub(foot.points[approachFrame]);
  attack.y *= .15;
  if (attack.lengthSq() < .0001) attack.set(0, 0, 1);
  attack.normalize();
  const thrustDistance = rig.height * .14;
  return {
    duration, apex, peakFrame, peak, impact, impactToe,
    footName: foot.mesh.name, boneName: foot.mesh.parent.name,
    snapshotTimes, snapshotFractions, timeAtHeight, riseTimes, attack, thrustDistance,
    toePoints: foot.toePoints, fps: clip.fps,
    heights: snapshotTimes.map(time => {
      sample(time); return point.copy(foot.center).applyMatrix4(foot.mesh.matrixWorld).y;
    }),
  };
}

export function toePointAt(seconds, motion, target = new T.Vector3()) {
  const f = clamp(seconds, 0, motion.duration) * motion.fps;
  const a = Math.min(Math.floor(f), motion.toePoints.length - 1), b = Math.min(a + 1, motion.toePoints.length - 1);
  return target.lerpVectors(motion.toePoints[a], motion.toePoints[b], f - a);
}

export function ascentTime(progress, motion) {
  const f = clamp(progress) * (motion.riseTimes.length - 1), a = Math.floor(f), b = Math.min(a + 1, motion.riseTimes.length - 1);
  return mix(motion.riseTimes[a], motion.riseTimes[b], f - a);
}

export function performanceAt(seconds, motion) {
  const t = clamp(seconds, 0, DURATION);
  const release = ease((t - TIMING.windup) / (TIMING.hit - TIMING.windup));
  let poseTime;
  if (t < TIMING.prepEnd) poseTime = mix(0, motion.riseTimes[0], ease(t / TIMING.prepEnd));
  else if (t < TIMING.apex) poseTime = ascentTime((t - TIMING.prepEnd) / (TIMING.apex - TIMING.prepEnd), motion);
  else if (t < TIMING.recover) poseTime = mix(motion.apex, motion.impact, release);
  else if (t < TIMING.ready) poseTime = mix(motion.impact, motion.duration, (t - TIMING.recover) / (TIMING.ready - TIMING.recover));
  else poseTime = motion.duration;
  const charge = clamp((t - TIMING.collect) / (TIMING.hit - TIMING.collect));
  // A short source-pose extension gives the impact a physical accent, then
  // returns to zero before the normal source recovery begins.
  const thrust = t < TIMING.hit
    ? release
    : 1 - ease((t - TIMING.hit) / (TIMING.recover - TIMING.hit));
  const chapter = CHAPTERS.findLastIndex(c => t >= c.at);
  return { t, poseTime, charge: t < TIMING.recover ? charge : 0, thrust, release,
    hitAge: t - TIMING.hit, chapter, complete: t === DURATION };
}

export function silhouetteAt(index, state, motion) {
  const capturedTime = motion.snapshotTimes[index];
  const captured = state.t < TIMING.apex
    ? ease((state.poseTime - capturedTime) / .025) : 1;
  // Snapshots are stored from lowest to highest. Gather from the peak outward.
  const collectOrder = SILHOUETTES - 1 - index;
  const collectStart = TIMING.collect + collectOrder * TIMING.collectStep;
  const last = index === 0;
  const end = last ? TIMING.hit : collectStart + TIMING.collectTravel;
  const progress = clamp((state.t - collectStart) / (end - collectStart));
  const travel = state.t >= end ? 1 : last ? progress * progress : ease(progress);
  const collecting = state.t >= collectStart && state.t < end;
  const fadeStart = last ? .90 : .60;
  const visible = captured > .001 && state.t < end;
  const collectedPose = motion.timeAtHeight(mix(motion.snapshotFractions[index], 1, travel));
  return {
    poseTime: collectedPose + (last ? (motion.impact - motion.apex) * state.release : 0), travel, collectStart,
    opacity: captured * (1 - ease((travel - fadeStart) / (1 - fadeStart))), visible, collecting,
    thrust: last && collecting ? state.thrust : 0,
  };
}

export function showTimeForPose(poseTime, motion) {
  const pose = clamp(poseTime, 0, motion.duration);
  if (pose === motion.apex) return TIMING.apex;
  if (pose === motion.impact) return TIMING.hit;
  if (pose > motion.impact) return mix(TIMING.recover, TIMING.ready, (pose - motion.impact) / (motion.duration - motion.impact));
  let low = pose < motion.apex ? 0 : TIMING.windup;
  let high = pose < motion.apex ? TIMING.apex : TIMING.hit;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (performanceAt(mid, motion).poseTime < pose) low = mid; else high = mid;
  }
  return (low + high) / 2;
}
