import * as THREE from 'three';

const { Vector3, Quaternion } = THREE;
const SPOT = .89;
const HALF_WIDTH = .29;
const HALF_HEIGHT = .37;
const RADIUS = .065;
const WIDTH = .026;
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

function rod(parent, a, b, radius, material, sides = 8) {
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, sides), material);
  mesh.position.copy(a).lerp(b, .5);
  mesh.quaternion.setFromUnitVectors(v(0, 1), b.clone().sub(a).normalize());
  parent.add(mesh);
}

function makeRacket(twoHanded = false) {
  const racket = new THREE.Group();
  const lowerHeight = twoHanded ? .245 : HALF_HEIGHT;
  const gripTop = twoHanded ? .638 : .53;
  const teal = new THREE.MeshStandardMaterial({ color: 0x09696d, roughness: .43, metalness: .22 });
  const mint = new THREE.MeshStandardMaterial({ color: 0x55e2b0, roughness: .37 });
  const wrap = new THREE.MeshStandardMaterial({ color: 0x293445, roughness: .86 });
  const points = Array.from({ length: 48 }, (_, i) => {
    const angle = i * Math.PI / 24;
    const y = Math.sin(angle);
    return v(Math.cos(angle) * HALF_WIDTH, SPOT + y * (y < 0 ? lowerHeight : HALF_HEIGHT));
  });
  const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 64, WIDTH, 8, true), teal);
  rim.castShadow = true;
  racket.add(rim);
  rod(racket, v(0, -.18), v(0, gripTop), .044, wrap, 8);
  rod(racket, v(0, -.20), v(0, -.167), .054, mint);
  rod(racket, v(0, gripTop - .015), v(0, gripTop + .01), .048, mint);
  for (const sign of [-1, 1]) {
    if (twoHanded) {
      rod(racket, v(0, gripTop), v(sign * .134, .673), .024, teal);
    } else {
      rod(racket, v(0, gripTop), v(sign * .15, .57), .024, teal);
      rod(racket, v(sign * .15, .57), v(sign * .18, .61), .024, teal);
    }
  }
  for (let i = 0; i < (twoHanded ? 15 : 13); i++) {
    const accent = new THREE.Mesh(new THREE.TorusGeometry(.043, .0027, 4, 8), wrap);
    accent.position.y = -.14 + i * .054;
    accent.rotation.x = Math.PI / 2 + .11;
    racket.add(accent);
  }
  const strings = [];
  for (let i = -5; i <= 5; i++) {
    const x = i * .045, extent = Math.sqrt(1 - (x / HALF_WIDTH) ** 2);
    strings.push(x, SPOT - lowerHeight * extent, .002, x, SPOT + HALF_HEIGHT * extent, .002);
  }
  for (let i = -7; i <= 7; i++) {
    const height = i < 0 ? lowerHeight : HALF_HEIGHT;
    const y = i * .046 * height / HALF_HEIGHT, extent = HALF_WIDTH * Math.sqrt(1 - (y / height) ** 2);
    strings.push(-extent, SPOT + y, -.002, extent, SPOT + y, -.002);
  }
  const net = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(strings, 3));
  racket.add(new THREE.LineSegments(net, new THREE.LineBasicMaterial({ color: 0x6f9d9e, opacity: .88, transparent: true })));
  racket.name = twoHanded ? 'Tennis backhand racket' : 'Tennis racket';
  return racket;
}

function makeBall() {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xc6ef2e, roughness: .76, emissive: 0x2d3803 }),
  );
  const seam = new THREE.LineBasicMaterial({ color: 0xf6f8c9 });
  const points = Array.from({ length: 65 }, (_, i) => {
    const angle = i * Math.PI / 32;
    const r = RADIUS * 1.012, bend = .47 * Math.sin(angle * 2);
    return v(Math.cos(angle) * Math.cos(bend) * r, Math.sin(bend) * r, Math.sin(angle) * Math.cos(bend) * r);
  });
  ball.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), seam));
  ball.name = 'Tennis ball';
  ball.castShadow = true;
  return ball;
}

export function tennisBounds(data, bounds) {
  const pos = v(), q = new Quaternion();
  for (let i = 0; i < data.n; i++) {
    pos.fromArray(data.tennis.grip, i * 3);
    q.fromArray(data.tennis.racket, i * 4);
    const center = v(0, SPOT, 0).applyQuaternion(q).add(pos);
    bounds.expandByPoint(center.clone().addScalar(HALF_HEIGHT));
    bounds.expandByPoint(center.clone().addScalar(-HALF_HEIGHT));
    // Frame the toss. Rally balls are intentionally allowed to exit the stage.
    if (data.tennis.release && i / data.fps <= data.tennis.contact) {
      bounds.expandByPoint(v().fromArray(data.tennis.ball, i * 3).addScalar(RADIUS));
    }
  }
  return bounds;
}

function addGripMorph(mesh, side) {
  const geo = mesh.geometry;
  const positions = geo.attributes.position, normals = geo.attributes.normal;
  const curled = [], curledNormals = [];
  for (let i = 0; i < positions.count; i++) {
    const x = side * positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const base = .50 + .04 * Math.abs(z);
    const length = Math.max(0, x - base), radius = .155;
    const theta = Math.min(2.35, length / radius);
    const thumb = THREE.MathUtils.smoothstep(side * z, .185, .32)
      * THREE.MathUtils.smoothstep(x, .32, .53);
    const nx = base + Math.sin(theta) * (radius + y);
    const ny = -radius + Math.cos(theta) * (radius + y);
    curled.push(side * (x > base ? nx : x), (x > base ? ny : y) - .115 * thumb, z - side * .048 * thumb);
    const normal = v().fromBufferAttribute(normals, i).applyAxisAngle(v(0, 0, 1), -side * theta);
    curledNormals.push(...normal.toArray());
  }
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(curled, 3)];
  geo.morphAttributes.normal = [new THREE.Float32BufferAttribute(curledNormals, 3)];
  mesh.updateMorphTargets();
  return mesh.morphTargetInfluences;
}

export function createTennisProps(scene, rig) {
  const standard = makeRacket(), extendedGrip = makeRacket(true), ball = makeBall();
  const right = addGripMorph(rig.root.getObjectByName('BuzzerB_glove_R'), -1);
  const left = addGripMorph(rig.root.getObjectByName('BuzzerB_glove_L'), 1);
  const point = v(), rotation = new Quaternion();
  scene.add(standard, extendedGrip, ball);
  return (clip, time, transitioning) => {
    const data = clip?.tennis;
    const articulated = !!clip?.q.LeftHandIndex1;
    const racket = data?.twoHanded && articulated ? extendedGrip : standard;
    standard.visible = extendedGrip.visible = false;
    racket.visible = !!data && !transitioning;
    ball.visible = racket.visible && time >= data.enter && time <= data.exit;
    // Authored finger chains deform the skinned glove. Keep the old morph
    // as a fallback for unconverted clips.
    right[0] = racket.visible && !clip.q.RightHandIndex1 ? 1 : 0;
    left[0] = racket.visible && data.twoHanded && !articulated ? 1 : 0;
    if (!racket.visible) return;
    const frame = THREE.MathUtils.clamp(time * clip.fps, 0, clip.n - 1);
    const a = Math.floor(frame), b = Math.min(clip.n - 1, a + 1), u = frame - a;
    racket.position.fromArray(data.grip, a * 3).lerp(point.fromArray(data.grip, b * 3), u);
    racket.quaternion.fromArray(data.racket, a * 4).slerp(rotation.fromArray(data.racket, b * 4), u);
    if (ball.visible) {
      ball.position.fromArray(data.ball, a * 3).lerp(point.fromArray(data.ball, b * 3), u);
      ball.rotation.set(time * 9, 0, time * 4);
    }
  };
}
