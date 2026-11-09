import * as THREE from 'three';

// Put twelve dark pentagons on the sphere using the vertices of an icosahedron.
// Subdivide the patches and project them onto the surface so they roll with it.
function panels(radius) {
  const ico = new THREE.IcosahedronGeometry(1);
  const p = ico.attributes.position;
  const points = [];
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
    if (!points.some((other) => other.distanceToSquared(v) < 1e-8)) points.push(v);
  }
  ico.dispose();
  const positions = [];
  function triangle(a, b, c, depth) {
    if (depth === 0) {
      for (const v of [a, b, c]) positions.push(...v.clone().normalize().multiplyScalar(radius * 1.002).toArray());
      return;
    }
    const ab = a.clone().lerp(b, .5), bc = b.clone().lerp(c, .5), ca = c.clone().lerp(a, .5);
    triangle(a, ab, ca, depth - 1);
    triangle(ab, b, bc, depth - 1);
    triangle(ca, bc, c, depth - 1);
    triangle(ab, bc, ca, depth - 1);
  }
  for (const pole of points) {
    const neighbors = points.filter((v) => Math.abs(v.dot(pole) - 1 / Math.sqrt(5)) < 1e-5);
    const x = neighbors[0].clone().addScaledVector(pole, -neighbors[0].dot(pole)).normalize();
    const y = pole.clone().cross(x);
    neighbors.sort((a, b) => Math.atan2(a.dot(y), a.dot(x)) - Math.atan2(b.dot(y), b.dot(x)));
    const tips = neighbors.map((v) => pole.clone().lerp(v, 1 / 3));
    for (let j = 0; j < tips.length; j++) triangle(pole, tips[j], tips[(j + 1) % tips.length], 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((value) => value / (radius * 1.002)), 3));
  return geometry;
}

export function makeFootballBall(scene, radius) {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0xfaf9eb, roughness: .74 }),
  );
  ball.name = 'FootballBall';
  ball.castShadow = true;
  ball.add(new THREE.Mesh(panels(radius), new THREE.MeshStandardMaterial({ color: 0x192132, roughness: .78 })));
  ball.visible = false;
  scene.add(ball);
  const nextP = new THREE.Vector3(), nextQ = new THREE.Quaternion();
  return (track, time, fps) => {
    ball.visible = !!track;
    if (!track) return;
    const frame = THREE.MathUtils.clamp(time * fps, 0, track.p.length / 3 - 1);
    const i = Math.floor(frame), j = Math.min(i + 1, track.p.length / 3 - 1), alpha = frame - i;
    ball.position.fromArray(track.p, i * 3).lerp(nextP.fromArray(track.p, j * 3), alpha);
    ball.quaternion.fromArray(track.q, i * 4).slerp(nextQ.fromArray(track.q, j * 4), alpha);
  };
}
