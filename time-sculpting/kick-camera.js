import * as T from './vendor/three/build/three.module.js';
import { clamp, ease, mix } from './temporal.js';
import { DURATION, TIMING } from './kick-performance.js';

const traceCut = 4.4;
const landingCut = TIMING.recover + .33;
export const CAMERA_FADE_SECONDS = .30;

// Distance and aim offsets are expressed in character heights.
export const KICK_SHOTS = [
  { name: 'Floor sweep', at: 0, until: traceCut,
    yaw: [-.86, .56], pitch: [-.17, .035], distance: [2.63, 2.35], lift: [-.045, -.025], lead: .24 },
  { name: 'Rising profile', at: traceCut, until: TIMING.apex,
    yaw: [1.51, 2.26], pitch: [.03, .31], distance: [2.78, 2.48], lift: [-.015, .015], lead: .29 },
  { name: 'Overhead spiral', at: TIMING.apex, until: TIMING.converge,
    yaw: [2.97, 4.16], pitch: [1.17, .97], distance: [2.88, 2.58], lift: [-.09, -.09], lead: .31 },
  { name: 'Toe strike', at: TIMING.converge, until: TIMING.hit + .24,
    yaw: [1.96, 1.65], pitch: [.055, .155], distance: [2.87, 2.42], lift: [.035, .075], lead: .35 },
  { name: 'Reverse landing', at: landingCut, until: 22.45,
    yaw: [3.66, 4.90], pitch: [.49, .14], distance: [2.67, 2.92], lift: [-.025, 0], lead: .32 },
];

// Split each dip evenly around the cut so the new angle appears at full black.
export function cameraFadeAt(time) {
  const half = CAMERA_FADE_SECONDS / 2;
  const cut = KICK_SHOTS.find(shot => shot.at > 0 && Math.abs(time - shot.at) < half);
  return cut ? 1 - ease(Math.abs(time - cut.at) / half) : 0;
}

const wide = {
  name: 'Steady wide', at: 0, until: DURATION,
  yaw: [1.32, 1.32], pitch: [.10, .10], distance: [2.85, 2.85], lift: [0, 0], lead: .27,
};

export function createKickDirector(center, height) {
  const right = new T.Vector3(), direction = new T.Vector3(), up = new T.Vector3();
  return (state, aspect, width, reduced, position, target) => {
    const shot = reduced ? wide : KICK_SHOTS.findLast(candidate => state.t >= candidate.at);
    const progress = ease((state.t - shot.at) / (shot.until - shot.at));
    const yaw = mix(...shot.yaw, progress), pitch = mix(...shot.pitch, progress);
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    target.copy(center);
    target.y += height * mix(...shot.lift, progress);
    if (width > 600) target.addScaledVector(right, -height * shot.lead);
    const distance = height * Math.max(mix(...shot.distance, progress), 2.34 / aspect + .76);
    position.copy(target).addScaledVector(direction, distance);
    position.y = Math.max(position.y, height * .04);
    if (!reduced && state.hitAge >= 0 && state.hitAge < .34) {
      const age = clamp(state.hitAge / .34);
      const kickback = Math.sin(Math.PI * age) * (1 - age) * height;
      up.crossVectors(direction, right).normalize();
      position.addScaledVector(direction, kickback * .13).addScaledVector(up, kickback * .032);
    }
    return shot.name;
  };
}
