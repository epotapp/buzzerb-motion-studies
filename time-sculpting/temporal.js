import * as THREE from './vendor/three/build/three.module.js';

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const ease = x => { const u = clamp(x); return u * u * (3 - 2 * u); };
export const mix = (a, b, u) => a + (b - a) * u;

// Preserve the rig's rest translations AND the newer authored effector tracks.
// A sampler owns scratch quaternions, so any actor can be sampled in any order.
export function makePoseSampler(root, data, hipsRest) {
  const bones = Object.keys(data.q).map(key => {
    const bone = root.getObjectByName('mixamorig' + key);
    if (!bone) throw new Error('Missing bone: ' + key);
    return { bone, key, rest: bone.position.clone(), rotations: data.q[key], positions: data.p?.[key] };
  });
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const duration = (data.n - 1) / data.fps;
  return seconds => {
    const f = clamp(seconds, 0, duration) * data.fps;
    const a = Math.min(data.n - 1, Math.floor(f)), b = Math.min(data.n - 1, a + 1), u = f - a;
    for (const { bone, key, rest, rotations, positions } of bones) {
      qa.fromArray(rotations, a * 4).normalize(); qb.fromArray(rotations, b * 4).normalize();
      bone.quaternion.slerpQuaternions(qa, qb, u).normalize();
      if (key === 'Hips') {
        bone.position.set(
          hipsRest.x + mix(data.h[a * 3], data.h[b * 3], u),
          hipsRest.y + mix(data.h[a * 3 + 1], data.h[b * 3 + 1], u),
          hipsRest.z + mix(data.h[a * 3 + 2], data.h[b * 3 + 2], u));
      } else if (positions) {
        bone.position.set(mix(positions[a * 3], positions[b * 3], u),
          mix(positions[a * 3 + 1], positions[b * 3 + 1], u),
          mix(positions[a * 3 + 2], positions[b * 3 + 2], u));
      } else bone.position.copy(rest);
    }
    root.updateMatrixWorld(true);
  };
}


