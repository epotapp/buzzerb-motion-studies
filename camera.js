import * as THREE from './vendor/three/build/three.module.js';
import { cloneRigRoot } from './finger-rig.js';

export const CAMERA_MOVES = {
  manual: 'Manual', auto: 'Auto', orbit: 'Orbit', dolly: 'Push / pull',
  sweep: 'Side sweep', crane: 'Crane',
};

const TAU = Math.PI * 2;
const BLEND_SECONDS = 0.8;
const ease = (t) => t * t * (3 - 2 * t);
const shortestAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function chooseCameraMove(clip) {
  if (clip.still || clip.isIdle || clip.group === 'Mood') return 'dolly';
  if (/jump/i.test(clip.title || '')) return 'crane';
  if (['Move', 'Action', 'Basketball', 'Golf'].includes(clip.group)) return 'sweep';
  return 'orbit';
}

// All paths meet smoothly at the end of a cycle, including the full orbit.
export function sampleCameraMove(move, seconds, cycle = 16) {
  const phase = TAU * seconds / cycle;
  const wave = (1 - Math.cos(phase)) / 2;
  switch (move) {
    case 'orbit': return { yaw: phase, pitch: 0.14 + 0.04 * Math.sin(phase), range: 1.12 };
    case 'dolly': return { yaw: 0.1, pitch: 0.1, range: 1.32 - 0.27 * wave };
    case 'sweep': return { yaw: 0.8 * Math.sin(phase), pitch: 0.16, range: 1.12 };
    case 'crane': return { yaw: 0.24 * Math.sin(phase), pitch: 0.12 + 0.44 * wave, range: 1.12 };
    default: throw new Error('Unknown camera move: ' + move);
  }
}

export class CameraChoreographer {
  constructor(camera, controls, subject) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'manual';
    this.cycle = 16;
    this.time = 0;
    this.clip = null;
    this.transition = null;
    // Sample a separate rig so measuring a new clip never interrupts playback.
    this.sampleRoot = cloneRigRoot(subject);
    this.sampleMixer = new THREE.AnimationMixer(this.sampleRoot);
    this.offset = new THREE.Vector3();
    this.spherical = new THREE.Spherical();
    this.center = new THREE.Vector3();
    this.frame = this.frameFromBounds(new THREE.Box3().setFromObject(subject));
  }

  get active() { return this.mode !== 'manual'; }
  get move() { return this.mode === 'auto' ? chooseCameraMove(this.clip || {}) : this.mode; }

  frameFromBounds(bounds) {
    return {
      center: bounds.getCenter(new THREE.Vector3()),
      radius: Math.max(0.5, bounds.getSize(new THREE.Vector3()).length() / 2),
    };
  }

  measureClip(clip, bounds = new THREE.Box3()) {
    const action = this.sampleMixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const steps = Math.max(1, Math.min(1800, Math.ceil(clip.duration * 30)));
    for (let i = 0; i <= steps; i++) {
      this.sampleMixer.setTime(clip.duration * i / steps);
      this.sampleRoot.updateMatrixWorld(true);
      bounds.expandByObject(this.sampleRoot);
    }
    action.stop();
    this.sampleMixer.uncacheAction(clip);
    return this.frameFromBounds(bounds);
  }

  beginTransition() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const yaw = sampleCameraMove(this.move, this.time, this.cycle).yaw;
    this.transition = {
      elapsed: 0,
      center: this.controls.target.clone(),
      spherical,
      // Fix the direction at the start, even if the path crosses the back view.
      yawOffset: spherical.theta + shortestAngle(yaw - spherical.theta) - yaw,
    };
  }

  clearOrbitMomentum() {
    const position = this.camera.position.clone();
    const target = this.controls.target.clone();
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
  }

  setMode(mode, immediate = false) {
    if (!Object.hasOwn(CAMERA_MOVES, mode)) throw new Error('Unknown camera mode: ' + mode);
    if (mode === this.mode) return;
    this.clearOrbitMomentum();
    this.mode = mode;
    if (this.active && !immediate) this.beginTransition();
    else this.transition = null;
    this.apply();
  }

  setClip(clip) {
    this.clip = clip;
    this.frame = clip.cameraFrame;
    this.time = 0;
    if (this.active) this.beginTransition();
  }

  setCycle(seconds) {
    if (!Number.isFinite(seconds) || seconds < 6 || seconds > 30) return;
    // Keep the same point on the path when changing its speed.
    this.time *= seconds / this.cycle;
    this.cycle = seconds;
    this.apply();
  }

  seek(seconds) {
    this.time = Math.max(0, seconds);
    this.transition = null;
    this.apply();
  }

  update(dt) {
    this.time += dt;
    if (this.transition) this.transition.elapsed += dt;
    this.apply();
  }

  apply() {
    if (!this.active) return;
    const { camera, controls, frame } = this;
    const shot = sampleCameraMove(this.move, this.time, this.cycle);
    // A sphere enclosing the entire clip fits even during a jump or a wide kick.
    // Use the smaller field of view, so portrait stages also retain the subject.
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const fit = frame.radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.12;
    this.spherical.set(Math.max(controls.minDistance, fit * shot.range), Math.PI / 2 - shot.pitch, shot.yaw);
    this.center.copy(frame.center);
    if (this.transition) {
      const t = Math.min(1, this.transition.elapsed / BLEND_SECONDS);
      const u = ease(t), from = this.transition;
      this.center.lerpVectors(from.center, frame.center, u);
      this.spherical.radius = THREE.MathUtils.lerp(from.spherical.radius, this.spherical.radius, u);
      this.spherical.phi = THREE.MathUtils.lerp(from.spherical.phi, this.spherical.phi, u);
      this.spherical.theta = THREE.MathUtils.lerp(from.spherical.theta, this.spherical.theta + from.yawOffset, u);
      if (t === 1) this.transition = null;
    }
    this.offset.setFromSpherical(this.spherical);
    camera.position.copy(this.center).add(this.offset);
    controls.target.copy(this.center);
    camera.lookAt(this.center);
    const far = Math.max(100, this.spherical.radius + frame.radius * 4);
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
  }
}
