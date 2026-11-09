import * as THREE from 'three';

export const FPS = 30;
const BONE = (k) => 'mixamorig' + k;
// 'mixamorig:Hips' / 'mixamorigHips' / 'mixamorig1:Hips' -> 'Hips'
export const strip = (n) => n.replace(/^.*?mixamorig\d*[:_]?/, '');

/* Split one mesh into a +X half (character's left) and a -X half (right). */
function splitByX(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  const names = Object.keys(g.attributes);
  const pos = g.attributes.position;
  const out = { L: {}, R: {} };
  names.forEach((n) => { out.L[n] = []; out.R[n] = []; });
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const s = cx > 0 ? 'L' : 'R';
    for (const n of names) {
      const a = g.attributes[n];
      for (let k = 0; k < 3; k++)
        for (let c = 0; c < a.itemSize; c++) out[s][n].push(a.array[(i + k) * a.itemSize + c]);
    }
  }
  const make = (s) => {
    const ng = new THREE.BufferGeometry();
    names.forEach((n) => ng.setAttribute(n, new THREE.BufferAttribute(new Float32Array(out[s][n]), g.attributes[n].itemSize)));
    ng.computeBoundingBox();
    return ng;
  };
  return { L: make('L'), R: make('R') };
}

function worldGeo(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  return g;
}

/* Build a Mixamo-named skeleton around the four static parts of the character. */
export function buildRig(srcGroup, mats) {
  const parts = {};
  srcGroup.traverse((o) => {
    if (!o.isMesh) return;
    for (const k of ['head', 'glove', 'body', 'shoe']) if (new RegExp(k, 'i').test(o.name)) parts[k] = o;
  });
  for (const k of ['head', 'glove', 'body', 'shoe'])
    if (!parts[k]) throw new Error('Character is missing its ' + k + ' mesh.');

  const head = worldGeo(parts.head), body = worldGeo(parts.body);
  const gl = splitByX(parts.glove), sh = splitByX(parts.shoe);
  const hbb = head.boundingBox, bbb = body.boundingBox;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mid = (b, a) => (b.min[a] + b.max[a]) / 2;

  const hips = V(mid(bbb, 'x'), mid(bbb, 'y'), mid(bbb, 'z'));
  const headP = V(mid(hbb, 'x'), hbb.min.y + 0.04, mid(hbb, 'z'));
  const def = {};
  const add = (k, parent, p) => { def[k] = { parent, pos: p }; };

  add('Hips', null, hips);
  add('Spine', 'Hips', hips.clone().add(V(0, 0.06, 0)));
  add('Spine1', 'Spine', hips.clone().add(V(0, 0.12, 0)));
  add('Spine2', 'Spine1', hips.clone().add(V(0, 0.18, 0)));
  add('Neck', 'Spine2', V(headP.x, headP.y - 0.14, headP.z));
  add('Head', 'Neck', headP);

  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    const gb = gl[s > 0 ? 'L' : 'R'].boundingBox, sb = sh[s > 0 ? 'L' : 'R'].boundingBox;
    const inner = s > 0 ? gb.min.x : -gb.max.x;
    const hand = V(s * (inner + 0.04), mid(gb, 'y'), mid(gb, 'z'));
    const ankle = V(mid(sb, 'x'), sb.min.y + 0.78 * (sb.max.y - sb.min.y), sb.min.z + 0.30 * (sb.max.z - sb.min.z));
    const upleg = V(s * 0.18, hips.y - 0.08, hips.z);
    add(side + 'Shoulder', 'Spine2', V(s * 0.14, hips.y + 0.12, hips.z));
    add(side + 'Arm', side + 'Shoulder', V(s * 0.42, hand.y, hand.z));
    add(side + 'ForeArm', side + 'Arm', V(s * (0.42 + (Math.abs(hand.x) - 0.42) / 2), hand.y, hand.z));
    add(side + 'Hand', side + 'ForeArm', hand);
    add(side + 'UpLeg', 'Hips', upleg);
    add(side + 'Leg', side + 'UpLeg', upleg.clone().lerp(ankle, 0.5));
    add(side + 'Foot', side + 'Leg', ankle);
  }

  const bones = {};
  for (const k of Object.keys(def)) {
    const b = new THREE.Bone();
    b.name = BONE(k);
    const pp = def[k].parent ? def[def[k].parent].pos : new THREE.Vector3();
    b.position.copy(def[k].pos).sub(pp);
    bones[k] = b;
    if (def[k].parent) bones[def[k].parent].add(b);
  }

  const attach = (geo, boneKey, mat, name) => {
    const g = geo.clone();
    g.translate(-def[boneKey].pos.x, -def[boneKey].pos.y, -def[boneKey].pos.z);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = true;
    bones[boneKey].add(m);
    return m;
  };
  attach(head, 'Head', mats.head, 'BuzzerB_head');
  attach(body, 'Spine1', mats.body, 'BuzzerB_body');
  attach(gl.L, 'LeftHand', mats.glove, 'BuzzerB_glove_L');
  attach(gl.R, 'RightHand', mats.glove, 'BuzzerB_glove_R');
  attach(sh.L, 'LeftFoot', mats.shoe, 'BuzzerB_shoe_L');
  attach(sh.R, 'RightFoot', mats.shoe, 'BuzzerB_shoe_R');

  const groundY = Math.min(sh.L.boundingBox.min.y, sh.R.boundingBox.min.y);
  const root = new THREE.Group();
  root.name = 'BuzzerB_Rig';
  root.add(bones.Hips);
  root.position.y = -groundY;
  root.updateMatrixWorld(true);

  return {
    root, bones, def, order: Object.keys(def),
    hipsRest: def.Hips.pos.clone(),
    legLen: def.Hips.pos.distanceTo(def.LeftFoot.pos),
    height: hbb.max.y - groundY,
  };
}

/* Build a THREE.AnimationClip for the rig from baked data. */
export function toClip(data, rig) {
  const n = data.n;
  const times = new Float32Array(n);
  for (let i = 0; i < n; i++) times[i] = i / data.fps;
  const tracks = [];
  for (const k of Object.keys(data.q)) {
    tracks.push(new THREE.QuaternionKeyframeTrack(BONE(k) + '.quaternion', times, Float32Array.from(data.q[k])));
  }
  const h = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    h[i * 3] = rig.hipsRest.x + data.h[i * 3];
    h[i * 3 + 1] = rig.hipsRest.y + data.h[i * 3 + 1];
    h[i * 3 + 2] = rig.hipsRest.z + data.h[i * 3 + 2];
  }
  tracks.push(new THREE.VectorKeyframeTrack(BONE('Hips') + '.position', times, h));
  // Authored effector translations are absolute bone-local positions. Emit rest
  // tracks for legacy/imported clips too, so blends never retain another clip's offsets.
  for (const k of rig.order) {
    if (k === 'Hips') continue;
    const rest = rig.def[k].pos.clone().sub(rig.def[rig.def[k].parent].pos);
    const values = data.p?.[k] || Array.from({ length: n }, () => rest.toArray()).flat();
    tracks.push(new THREE.VectorKeyframeTrack(BONE(k) + '.position', times, values));
  }
  return new THREE.AnimationClip(data.name, (n - 1) / data.fps, tracks);
}

/* The gloves are long, so a straight-down arm would push them through the shoes.
   Every arm bone gets a constant outward swing about the forward axis (a world-space
   offset, so it never changes how the animation reads). */
export const ARM_OUT = 0.5;
const ARM_FIX = {};
for (const [side, s] of [['Left', 1], ['Right', -1]])
  for (const b of ['Arm', 'ForeArm', 'Hand'])
    ARM_FIX[side + b] = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * ARM_OUT);

const r4 = (v) => Math.round(v * 10000) / 10000;

/* Sample every clip of a Mixamo-skeleton source and retarget it to the rig by
   world-space rotation deltas. Returns plain data objects (JSON-friendly). */
export function bakeClips(srcRoot, rig, clips, nameFor) {
  srcRoot.updateMatrixWorld(true);
  const found = {};
  srcRoot.traverse((o) => {
    if (!o.name || o.isMesh || o.isSkinnedMesh) return;
    const k = strip(o.name);
    if (rig.def[k] && !found[k]) found[k] = o;
  });
  if (!found.Hips || !found.LeftFoot) throw new Error('No Mixamo skeleton (mixamorig bones) found in this file.');

  const P = (k) => found[k].getWorldPosition(new THREE.Vector3());
  const Q = (k) => found[k].getWorldQuaternion(new THREE.Quaternion());

  // reference frame of the source: x = character left, y = up, z = forward
  const up = (found.Head ? P('Head') : P('Neck')).sub(P('Hips')).normalize();
  const across = P('LeftArm').sub(P('RightArm'));
  const X = across.clone().addScaledVector(up, -across.dot(up)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, up);
  const Rs = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z)).invert();
  const RsInv = Rs.clone().invert();

  const restInv = {};
  for (const k of Object.keys(found)) restInv[k] = Q(k).invert();
  const hips0 = P('Hips');
  const ratio = rig.legLen / hips0.distanceTo(P('LeftFoot'));

  const out = [];
  clips.forEach((clip, ci) => {
    const mixer = new THREE.AnimationMixer(srcRoot);
    const act = mixer.clipAction(clip);
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = true;
    act.play();
    const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
    const q = {}; rig.order.forEach((k) => (q[k] = []));
    const h = [];
    for (let i = 0; i < n; i++) {
      mixer.setTime(Math.min(i / FPS, clip.duration));
      srcRoot.updateMatrixWorld(true);
      const D = {};
      for (const k of rig.order) {
        const parentD = rig.def[k].parent ? D[rig.def[k].parent] : new THREE.Quaternion();
        let d;
        if (found[k]) {
          d = Q(k).multiply(restInv[k]);
          d = Rs.clone().multiply(d).multiply(RsInv);
        } else d = parentD.clone();
        if (ARM_FIX[k]) d = ARM_FIX[k].clone().multiply(d);
        D[k] = d;
        const local = parentD.clone().invert().multiply(d);
        const prev = q[k].length ? q[k].slice(-4) : null;
        if (prev && prev[0] * local.x + prev[1] * local.y + prev[2] * local.z + prev[3] * local.w < 0)
          local.set(-local.x, -local.y, -local.z, -local.w);
        q[k].push(r4(local.x), r4(local.y), r4(local.z), r4(local.w));
      }
      const disp = P('Hips').sub(hips0).applyQuaternion(Rs).multiplyScalar(ratio);
      h.push(disp.x, disp.y, disp.z);
    }
    // locomotion clips drift away from the origin: keep them in place
    const dx = h[(n - 1) * 3] - h[0], dz = h[(n - 1) * 3 + 2] - h[2];
    if (Math.hypot(dx, dz) > 0.35) for (let i = 0; i < n; i++) { h[i * 3] = 0; h[i * 3 + 2] = 0; }
    out.push({ name: nameFor(clip, ci), fps: FPS, n, d: clip.duration, q, h: h.map(r4) });
    act.stop(); mixer.stopAllAction(); mixer.uncacheRoot(srcRoot);
    srcRoot.updateMatrixWorld(true);
  });
  return out;
}
