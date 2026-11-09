import * as T from './vendor/three/build/three.module.js';
import { writeWorldBone } from './hand-structure.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const UP = V(0, 1, 0);
const rad = T.MathUtils.degToRad;
const surface = (color, roughness = .57, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
const ballRadius = .057;

export function makeGolfGripGeometry(source, side) {
  const geometry = source.clone();
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) * side;
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // Keep the existing cuff and palm. Curl the fingers across the back of
    // the handle, with a shorter bend for the thumb near the side of the palm.
    const thumb = Math.max(0, Math.min(1, (Math.abs(z) - .17) / .12));
    const hinge = T.MathUtils.lerp(.39, .32, thumb);
    const bend = T.MathUtils.lerp(5.55, 3.5, thumb);
    const a = Math.max(0, x - hinge) * bend;
    const sine = Math.sin(a), cosine = Math.cos(a);
    const curledX = a > 0 ? hinge + sine / bend + y * sine : x;
    const curledY = -(1 - cosine) / bend + y * cosine;
    // BuzzerB's open hand is disproportionately long. A compact fist keeps
    // the silhouette of two stacked mitts with room for both cuffs.
    positions.setXYZ(i, side * T.MathUtils.lerp(.425, curledX, .79), T.MathUtils.lerp(-.133, curledY, .79), z * .79 * (1 - .24 * Math.min(1, a)));
    const nx = normals.getX(i) * side, ny = normals.getY(i);
    normals.setXYZ(i, side * (nx * cosine + ny * sine), -nx * sine + ny * cosine, normals.getZ(i));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function cylinder(radius, bottom, length, material) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, bottom, length, 12), material);
  mesh.castShadow = true;
  return mesh;
}

export function buildGolfClub(type, length) {
  const club = new T.Group();
  const steel = surface(0xb8d8e1, .34, .40);
  const dark = surface(0x213845, .46, .22);
  const handle = cylinder(.052, .047, .81, surface(0x37423d));
  handle.position.y = -.018;
  const collar = cylinder(.050, .050, .028, surface(0xd6fca6));
  collar.position.y = .34;
  const shaft = cylinder(.028, .036, length - .26, steel);
  shaft.position.y = (length + .26) / 2;
  club.add(handle, collar, shaft);
  if (type === 'driver') {
    const head = new T.Mesh(new T.SphereGeometry(1, 20, 12), dark);
    head.scale.set(.151, .080, .165);
    head.position.set(-.039, length, -.061);
    head.name = 'Golf driver shell';
    const face = new T.Mesh(new T.SphereGeometry(1, 20, 12), steel);
    face.scale.set(.032, .071, .141);
    face.position.set(.089, length - .015, -.058);
    face.name = 'Golf club face';
    face.rotation.z = rad(-10);
    head.castShadow = true;
    club.add(head, face);
  } else {
    const thickness = type === 'lob' ? .019 : .098;
    const blade = new T.Mesh(new T.BoxGeometry(thickness, .118, .244), steel);
    blade.position.set(.036, length - .018, -.060);
    blade.name = 'Golf club face';
    blade.rotation.z = rad(type === 'lob' ? -55 : -42);
    blade.castShadow = true;
    const groove = surface(0x445f64, .46, .34);
    for (const y of [-.032, -.002, .028]) {
      const line = new T.Mesh(new T.BoxGeometry(.004, .006, .191), groove);
      line.position.set(thickness / 2 + .001, y, 0);
      blade.add(line);
    }
    club.add(blade);
  }
  return club;
}

function sandPatch() {
  const shape = new T.Shape();
  const points = [[-1.52,.30],[-1.31,1.02],[-.96,1.67],[-.20,1.96],[.57,1.92],[1.37,1.63],[1.67,.95],[1.66,.40],[1.14,-.30],[.36,-.47],[-.61,-.46],[-1.24,-.18]]
    .map(([x, z]) => new T.Vector2(x, -z));
  const curve = new T.SplineCurve([...points, points[0]]);
  shape.setFromPoints(curve.getPoints(80));
  const patch = new T.Mesh(new T.ShapeGeometry(shape), surface(0xc6a779, .96));
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = .001;
  patch.receiveShadow = true;
  return patch;
}

export function golfBallPosition(data, t, out = V()) {
  const [x, y, z] = data.ball, [distance, airtime, apex] = data.flight;
  if (t <= data.strike) return out.set(x, y, z);
  const elapsed = t - data.strike;
  const u = Math.min(1, elapsed / airtime);
  const arch = 4 * apex * u * (1 - u);
  const roll = T.MathUtils.smoothstep(elapsed, airtime, airtime + .53);
  const bounce = T.MathUtils.clamp((elapsed - airtime) / .24, 0, 1);
  const lastBounce = data.club === 'lob' ? .09 : .18;
  return out.set(x + distance * u + roll * (data.club === 'lob' ? .17 : .47),
    T.MathUtils.lerp(y, ballRadius, u) + arch + lastBounce * 4 * bounce * (1 - bounce),
    z + (data.club === 'driver' ? -.15 : -.14) * u);
}

export function sampleGolfClub(data, fps, time, position, rotation) {
  const f = T.MathUtils.clamp(time * fps, 0, data.positions.length / 3 - 1);
  const i = Math.floor(f), j = Math.ceil(f), u = f - i;
  position.fromArray(data.positions, 3 * i);
  rotation.fromArray(data.rotations, 4 * i).normalize();
  if (i === j) return;
  position.lerp(V().fromArray(data.positions, 3 * j), u);
  rotation.slerp(new T.Quaternion().fromArray(data.rotations, 4 * j).normalize(), u);
}

export function createGolfStage(scene, rig) {
  const stage = new T.Group();
  stage.name = 'Golf props';
  stage.visible = false;
  scene.add(stage);
  const clubs = new Map();
  const ball = new T.Mesh(new T.SphereGeometry(ballRadius, 18, 12), surface(0xfefcf0, .37));
  ball.castShadow = true;
  const tee = cylinder(.032, .018, .08, surface(0xf3b96a));
  const sand = sandPatch();
  const chip = new T.Mesh(new T.CircleGeometry(.14, 20), surface(0x9f784e));
  chip.rotation.x = -Math.PI / 2;
  chip.scale.y = .43;
  const specks = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), surface(0xffcf95), 37);
  specks.frustumCulled = false;
  stage.add(tee, ball, sand, chip, specks);
  const gripMeshes = [1, -1].map(side => {
    const mesh = rig.root.getObjectByName('BuzzerB_glove_' + (side === 1 ? 'L' : 'R'));
    return { mesh, wrist: mesh.parent, original: mesh.geometry, grip: makeGolfGripGeometry(mesh.geometry, side) };
  });
  const particle = new T.Object3D();
  let active = null, club = null;

  return {
    update(data, fps, time) {
      if (data !== active) {
        if (club) club.visible = false;
        active = data;
        stage.visible = Boolean(data);
        for (const hand of gripMeshes) {
          const articulated = data?.articulatedGrip && hand.mesh.isSkinnedMesh;
          hand.mesh.geometry = data && !articulated ? hand.grip : hand.original;
          hand.wrist.scale.setScalar(articulated ? data.articulatedGrip.scale : 1);
        }
        if (data) {
          if (!clubs.has(data.club)) {
            const model = buildGolfClub(data.club, data.length);
            stage.add(model);
            clubs.set(data.club, model);
          }
          club = clubs.get(data.club);
          club.visible = true;
          tee.visible = data.club === 'driver';
          tee.position.set(data.ball[0], .041, data.ball[2]);
          sand.visible = data.sand != null;
        }
      }
      if (!data) return;
      sampleGolfClub(data, fps, time, club.position, club.quaternion);
      if (data.articulatedGrip) {
        // Hands and the club interpolate through different hierarchies. Match
        // the authored grip in club space after sampling both at this time.
        for (const [i, attachment] of data.articulatedGrip.wrists.entries()) {
          const hand = gripMeshes[i].wrist, forearm = hand.parent;
          const position = V().fromArray(attachment.position).applyQuaternion(club.quaternion).add(club.position);
          const rotation = club.quaternion.clone().multiply(new T.Quaternion().fromArray(attachment.rotation)).normalize();
          const correction = position.clone().sub(hand.getWorldPosition(V()));
          writeWorldBone(forearm, forearm.getWorldPosition(V()).add(correction), rotation);
          writeWorldBone(hand, position, rotation);
        }
      }
      golfBallPosition(data, time, ball.position);
      ball.rotation.z = (ball.position.x - data.ball[0]) * -8;
      const splashTime = data.sand == null ? -1 : time - data.sand;
      chip.visible = splashTime >= 0;
      specks.visible = splashTime >= 0 && splashTime < .70;
      if (chip.visible) {
        chip.position.fromArray(data.sandPoint);
        chip.position.x += .115;
        chip.position.y = .006;
      }
      if (specks.visible) {
        for (let i = 0; i < specks.count; i++) {
          const spread = Math.sin(i * 2.39996), variation = .5 + .5 * Math.cos(i * 1.746);
          const dt = Math.max(0, splashTime - i % 5 * .006);
          particle.position.fromArray(data.sandPoint);
          particle.position.x += dt * (1.35 + variation * 2.30);
          particle.position.y += dt * (1.3 + variation * 2.9) - 6.1 * dt * dt;
          particle.position.z += dt * (spread * .95 - .09);
          particle.rotation.set(dt * (5 + i % 4), dt * 8, i);
          const size = particle.position.y > 0 && dt > 0
            ? (.020 + .026 * variation) * (1 - T.MathUtils.smoothstep(dt, .29, .65))
            : 0;
          particle.scale.setScalar(size);
          particle.updateMatrix();
          specks.setMatrixAt(i, particle.matrix);
        }
        specks.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
