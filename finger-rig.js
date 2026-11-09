import * as THREE from './vendor/three/build/three.module.js';

// Knuckles and tips measured in the left glove's wrist-local space.
// The right glove mirrors X, including the directions of its bend axes.
const digits = [
  { name: 'Pinky', points: [[.435, -.003, -.204], [.592, -.013, -.250], [.690, -.023, -.286], [.755, -.025, -.294]], curl: [61, 72, 36] },
  { name: 'Ring', points: [[.480, .013, -.112], [.649, .008, -.139], [.779, -.007, -.158], [.875, -.012, -.164]], curl: [58, 71, 34] },
  { name: 'Middle', points: [[.500, .019, -.007], [.685, .013, -.017], [.816, -.007, -.015], [.912, -.018, -.010]], curl: [55, 67, 32] },
  { name: 'Index', points: [[.493, .012, .093], [.657, .006, .112], [.767, -.010, .128], [.858, -.025, .137]], curl: [49, 61, 30] },
  { name: 'Thumb', points: [[.302, -.038, .163], [.425, -.055, .226], [.487, -.075, .271], [.548, -.086, .286]], curl: [22, 32, 19] },
];
const hands = [['LeftHand', 1], ['RightHand', -1]];
const jointKey = (hand, digit, index) => hand + digit.name + (index + 1);

export function addFingerBones(add, hand, origin, sign) {
  for (const digit of digits) {
    let parent = hand;
    for (const [index, [x, y, z]] of digit.points.entries()) {
      const key = jointKey(hand, digit, index);
      add(key, parent, origin.clone().add(new THREE.Vector3(sign * x, y, z)));
      parent = key;
    }
  }
}

// The contours split at different depths. Blend across the webbing and use
// narrow boundaries once the adjacent digits separate.
function digitBoundaries(x, z) {
  const cuts = [
    [-.193 - .25 * (x - .60), .60],
    [-.075 - .105 * (x - .63), .63],
    [.047 + .18 * (x - .66), .66],
    [.161 + .48 * (x - .46), .46],
  ];
  return cuts.map(([cut, split]) => {
    const width = THREE.MathUtils.lerp(.033, .001, THREE.MathUtils.smoothstep(x, split - .10, split));
    return THREE.MathUtils.smoothstep(z, cut - width, cut + width);
  });
}

export function skinGlove(geometry, material, bones, hand, sign) {
  const joints = [bones[hand], ...digits.flatMap(digit => digit.curl.map((_, i) => bones[jointKey(hand, digit, i)]))];
  const position = geometry.getAttribute('position');
  const indices = new Uint16Array(position.count * 4);
  const weights = new Float32Array(position.count * 4);
  const smoothstep = THREE.MathUtils.smoothstep;

  for (let i = 0; i < position.count; i++) {
    const x = sign * position.getX(i);
    const z = position.getZ(i);
    const boundaries = [1, ...digitBoundaries(x, z), 0];
    const influences = [[0, 1]];
    for (const [digitIndex, digit] of digits.entries()) {
      const share = boundaries[digitIndex] - boundaries[digitIndex + 1];
      if (share <= 0) continue;
      const [[base], [middle], [tip]] = digit.points;
      const start = share * smoothstep(x, base - .047, base + .061);
      const next = smoothstep(x, middle - .038, middle + .038);
      const last = smoothstep(x, tip - .026, tip + .026);
      const joint = digitIndex * 3 + 1;
      influences[0][1] -= start;
      influences.push([joint, start * (1 - next)], [joint + 1, start * next * (1 - last)], [joint + 2, start * next * last]);
    }
    const strongest = influences.sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [j, [bone, weight]] of strongest.entries()) {
      indices[i * 4 + j] = bone;
      weights[i * 4 + j] = weight / total;
    }
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, joints };
}

// Object3D.clone copies SkinnedMesh references but does not remap their bones.
export function cloneRigRoot(root) {
  const copy = root.clone(true);
  copy.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { bones, boneInverses } = mesh.skeleton;
    mesh.skeleton = new THREE.Skeleton(bones.map(bone => copy.getObjectByName(bone.name)), boneInverses);
  });
  return copy;
}

export function addFingerTracks(tracks, data, rig) {
  const keys = data.fingerCurl;
  const times = keys?.map(([time]) => time);
  for (const [hand, sign] of hands) {
    for (const digit of digits) {
      for (let i = 0; i < digit.curl.length; i++) {
        const joint = jointKey(hand, digit, i);
        if (data.q[joint]) continue;
        const bone = rig.bones[joint];
        if (!keys) {
          tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', [0], [0, 0, 0, 1]));
          continue;
        }
        const direction = rig.bones[jointKey(hand, digit, i + 1)].position;
        const palm = new THREE.Vector3(0, -1, digit.name === 'Thumb' ? -.58 : 0);
        const axis = new THREE.Vector3().crossVectors(direction, palm).normalize();
        const maxAngle = THREE.MathUtils.degToRad(digit.curl[i]);
        const values = keys.flatMap(key => new THREE.Quaternion().setFromAxisAngle(axis, key[sign > 0 ? 1 : 2] * maxAngle).toArray());
        tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, values));
      }
    }
  }
}
