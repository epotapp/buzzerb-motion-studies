import * as THREE from 'three';

export function createAmericanFootballProp(scene, rig) {
  const ball = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x9c4c29, roughness: .77, transparent: true });
  const stitching = new THREE.MeshStandardMaterial({ color: 0xffeee0, roughness: .7, transparent: true });
  const materials = [leather, stitching];
  const profile = Array.from({ length: 33 }, (_, i) => {
    const u = (i - 16) / 16;
    return new THREE.Vector2(.165 * Math.pow(1 - u * u, .73), u * .315);
  });
  const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), leather);
  shell.castShadow = true;
  ball.add(shell);
  for (const y of [-.212, .212]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.165 * (1 - (y / .315) ** 2) ** .73, .011, 8, 40), stitching);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    ball.add(ring);
  }
  const addLace = (width, length, y, z) => {
    const lace = new THREE.Mesh(new THREE.BoxGeometry(width, length, .009), stitching);
    lace.position.set(0, y, z);
    ball.add(lace);
  };
  addLace(.015, .174, 0, .169);
  for (let i = -3; i <= 3; i++) addLace(.075, .010, i * .024, .169 - Math.abs(i) * .0023);
  ball.name = 'BuzzerB_football';
  ball.visible = false;
  scene.add(ball);

  const nextPosition = new THREE.Vector3();
  const nextRotation = new THREE.Quaternion();
  const handRotation = new THREE.Quaternion();
  return function sync(clip, time, transition) {
    ball.visible = false;
    const prop = clip?.prop;
    if (prop?.kind !== 'football') return;
    const frame = time * clip.fps;
    const segment = prop.segments.find(s => frame >= s.start && frame <= s.end);
    if (!segment) return;
    const i = Math.floor(frame), j = Math.min(i + 1, segment.end);
    const a = 8 * (i - segment.start), b = 8 * (j - segment.start), u = frame - i;
    const data = segment.pose;
    const fade = transition ? THREE.MathUtils.smoothstep(transition.elapsed / transition.duration, 0, 1) : 1;
    const alpha = THREE.MathUtils.lerp(data[a + 7], data[b + 7], u) * fade;
    if (alpha <= .001) return;
    ball.position.fromArray(data, a).lerp(nextPosition.fromArray(data, b), u);
    ball.quaternion.fromArray(data, a + 3).slerp(nextRotation.fromArray(data, b + 3), u).normalize();
    if (segment.space === 'hand') {
      const hand = rig.bones[prop.hand];
      hand.localToWorld(ball.position);
      ball.quaternion.premultiply(hand.getWorldQuaternion(handRotation));
    }
    for (const material of materials) {
      material.opacity = alpha;
      material.depthWrite = alpha > .99;
    }
    shell.castShadow = alpha > .7;
    ball.visible = true;
  };
}
