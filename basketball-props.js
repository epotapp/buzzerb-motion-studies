import * as T from './vendor/three/build/three.module.js';

export const BALL_RADIUS = 0.195;
export const RIM_RADIUS = 0.37;

function lineCurve(points, radius, material, closed = false) {
  const curve = new T.CatmullRomCurve3(points, closed);
  return new T.Mesh(new T.TubeGeometry(curve, points.length, radius, 5, closed), material);
}

function makeBall() {
  const ball = new T.Group();
  const leather = new T.MeshStandardMaterial({ color: 0xd05b28, roughness: 0.86 });
  const channels = new T.MeshStandardMaterial({ color: 0x2e1b18, roughness: 0.92 });
  const skin = new T.Mesh(new T.SphereGeometry(BALL_RADIUS, 32, 24), leather);
  skin.castShadow = true;
  ball.add(skin);
  const seam = (f) => lineCurve(Array.from({ length: 64 }, (_, i) => {
    const a = i * Math.PI / 32;
    return f(a).normalize().multiplyScalar(BALL_RADIUS);
  }), 0.0045, channels, true);
  ball.add(
    seam(a => new T.Vector3(Math.cos(a), Math.sin(a), 0)),
    seam(a => new T.Vector3(0, Math.cos(a), Math.sin(a))),
    seam(a => new T.Vector3(Math.cos(a), 0.60 * Math.sin(2 * a), Math.sin(a))),
    seam(a => new T.Vector3(Math.cos(a), -0.60 * Math.sin(2 * a), Math.sin(a))),
  );
  return ball;
}

function makeHoop() {
  const group = new T.Group();
  const rimMat = new T.MeshStandardMaterial({ color: 0xbc4932, roughness: 0.56 });
  const frameMat = new T.MeshStandardMaterial({ color: 0x546171, roughness: 0.58 });
  const glass = new T.MeshStandardMaterial({
    color: 0xd2e6f0, roughness: 0.6, transparent: true, opacity: 0.24, depthWrite: false,
  });
  const trim = new T.MeshBasicMaterial({ color: 0x788895, transparent: true, opacity: 0.83 });
  const box = (w, h, d, x, y, z, mat) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  const back = -0.52;
  box(1.23, 0.63, 0.035, 0, 0.26, back, glass);
  box(1.26, 0.025, 0.05, 0, 0.585, back, frameMat);
  box(1.26, 0.025, 0.05, 0, -0.06, back, frameMat);
  for (const s of [-1, 1]) box(0.024, 0.63, 0.05, s * 0.62, 0.26, back, frameMat);
  box(0.48, 0.018, 0.022, 0, 0.40, back + 0.025, trim);
  box(0.48, 0.018, 0.022, 0, 0.10, back + 0.025, trim);
  for (const s of [-1, 1]) box(0.018, 0.30, 0.022, s * 0.24, 0.25, back + 0.025, trim);
  box(0.19, 0.045, 0.18, 0, -0.026, -0.45, rimMat);
  const rim = new T.Mesh(new T.TorusGeometry(RIM_RADIUS, 0.023, 10, 64), rimMat);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  const net = new T.Group();
  const cord = new T.LineBasicMaterial({ color: 0x8998aa, transparent: true, opacity: 0.87 });
  const points = [];
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    for (const sign of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        for (const k of [j, j + 1]) {
          const u = k / 3;
          const r = T.MathUtils.lerp(RIM_RADIUS, 0.218, u);
          const angle = a + sign * u * Math.PI / 4;
          points.push(new T.Vector3(r * Math.cos(angle), -0.44 * u, r * Math.sin(angle)));
        }
      }
    }
  }
  const geometry = new T.BufferGeometry().setFromPoints(points);
  net.add(new T.LineSegments(geometry, cord));
  group.add(net);
  return { group, net };
}

export function createBasketballProps(scene) {
  const ball = makeBall();
  const { group: hoop, net } = makeHoop();
  const target = new T.Vector3();
  const sample = new T.Vector3();
  const spin = new T.Vector3(0.77, 0.08, 0.63).normalize();
  scene.add(ball, hoop);
  ball.name = 'Basketball';
  hoop.name = 'Basketball hoop';
  ball.visible = hoop.visible = false;

  return {
    update(data, time = 0, transition = 1) {
      ball.visible = !!data;
      hoop.visible = !!data?.hoop;
      if (!data) return;
      const f = Math.min(data.ball.length / 4 - 1, Math.max(0, time * data.fps));
      const i = Math.floor(f) * 4;
      const j = Math.min(i + 4, data.ball.length - 4);
      sample.fromArray(data.ball, j);
      ball.position.fromArray(data.ball, i).lerp(sample, f % 1);
      ball.quaternion.setFromAxisAngle(spin, T.MathUtils.lerp(data.ball[i + 3], data.ball[j + 3], f % 1));
      const alpha = T.MathUtils.clamp(transition * 1.75, 0.001, 1);
      ball.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.material.transparent = alpha < 1;
        mesh.material.depthWrite = alpha === 1;
        mesh.material.opacity = alpha;
      });
      if (!data.hoop) return;
      hoop.position.fromArray(data.hoop.center);
      hoop.rotation.y = data.hoop.yaw;
      const d = time - data.hoop.through;
      const pulse = d >= 0 ? Math.sin(d * 24) * Math.exp(-d * 7) : 0;
      const vertices = net.children[0].geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const rest = net.children[0].userData.rest ??= Float32Array.from(vertices.array);
        target.fromArray(rest, i * 3);
        const amount = 1 + 0.23 * pulse * (-target.y / 0.44);
        vertices.setXYZ(i, target.x * amount, target.y * (1 + 0.15 * pulse), target.z * amount);
      }
      vertices.needsUpdate = true;
    },
  };
}
