import * as T from './vendor/three/build/three.module.js';
import { clamp, ease, mix } from './temporal.js';
import { TIMING, toePointAt } from './kick-performance.js';
import { fieldVertex, plumeFragment, pressureFragment, streakVertex, streakFragment } from './impact-shaders.js';

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [stop, color] of [
    [0, 'rgba(255,255,242,1)'], [.075, 'rgba(255,252,228,1)'],
    [.18, 'rgba(255,222,139,.94)'], [.33, 'rgba(249,147,51,.64)'],
    [.61, 'rgba(230,86,22,.22)'], [1, 'rgba(221,66,14,0)'],
  ]) glow.addColorStop(stop, color);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function glowSprite(texture, order) {
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }));
  sprite.renderOrder = order;
  return sprite;
}

// Tapered strips share one draw call per layer, with independent color and fade
// at each end.
function streaks(capacity, order) {
  const geometry = new T.BufferGeometry();
  const positions = new Float32Array(capacity * 18), colors = new Float32Array(capacity * 24);
  const uvs = new Float32Array(capacity * 12);
  for (let i = 0; i < capacity; i++) uvs.set([0,0, 1,0, 0,1, 0,1, 1,0, 1,1], i * 12);
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('tint', new T.BufferAttribute(colors, 4).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
  const mesh = new T.Mesh(geometry, new T.ShaderMaterial({
    vertexShader: streakVertex, fragmentShader: streakFragment,
    side: T.DoubleSide, transparent: true, depthWrite: false,
  }));
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  const normal = new T.Vector3(), v = new T.Vector3(), direction = new T.Vector3();
  return {
    mesh,
    write(index, tail, head, widths, view, color, opacity) {
      direction.subVectors(head, tail);
      normal.crossVectors(direction, view).normalize();
      const offset = index * 18;
      v.copy(tail).addScaledVector(normal, -widths[0]).toArray(positions, offset);
      v.copy(tail).addScaledVector(normal, widths[0]).toArray(positions, offset + 3);
      v.copy(head).addScaledVector(normal, -widths[1]).toArray(positions, offset + 6);
      v.toArray(positions, offset + 9);
      v.copy(tail).addScaledVector(normal, widths[0]).toArray(positions, offset + 12);
      v.copy(head).addScaledVector(normal, widths[1]).toArray(positions, offset + 15);
      const colorOffset = index * 24;
      for (let j = 0; j < 6; j++) {
        const alpha = (j < 2 || j === 4) ? opacity[0] : opacity[1];
        const at = colorOffset + j * 4;
        colors[at] = color.r;
        colors[at + 1] = color.g;
        colors[at + 2] = color.b;
        colors[at + 3] = alpha;
      }
    },
    commit(count) {
      geometry.setDrawRange(0, count * 6);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.tint.needsUpdate = true;
    },
    sample: () => Array.from(positions.subarray(0, 12)),
  };
}

function sparkPosition(spark, age, target) {
  const distance = (1 - Math.exp(-spark.drag * age)) / spark.drag;
  target.copy(spark.velocity).multiplyScalar(distance);
  target.y -= spark.gravity * age * age;
  return target;
}

// All layers sample the same absolute time, including when paused or scrubbed.
export function createImpactVFX(scene, height, motion) {
  const origin = motion.impactToe.clone().addScaledVector(motion.attack, motion.thrustDistance);
  const burst = new T.Group();
  burst.position.copy(origin);
  burst.scale.setScalar(height * .70);
  scene.add(burst);

  const strikeRotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), motion.attack);
  const plume = new T.Mesh(new T.BoxGeometry(2, 2, 2.4).translate(0, .25, .90), new T.ShaderMaterial({
    uniforms: { uEye: { value: new T.Vector3() }, uAge: { value: 0 } },
    vertexShader: fieldVertex, fragmentShader: plumeFragment, transparent: true, depthWrite: false,
    side: T.FrontSide,
  }));
  // Front surfaces handle an exterior camera; back surfaces let orbit inspection
  // enter the volume. Only one side is drawn for each camera position.
  plume.quaternion.copy(strikeRotation);
  plume.renderOrder = 20;
  burst.add(plume);

  const wave = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
    uniforms: { uAge: { value: 0 } },
    vertexShader: fieldVertex, fragmentShader: pressureFragment,
    side: T.DoubleSide, transparent: true, depthWrite: false,
  }));
  wave.quaternion.copy(strikeRotation);
  wave.renderOrder = 21;
  burst.add(wave);

  const texture = glowTexture();
  const flash = glowSprite(texture, 25), flare = glowSprite(texture, 26);
  flare.material.rotation = -.20;
  burst.add(flash, flare);
  const charge = glowSprite(texture, 19), tracer = glowSprite(texture, 24);
  scene.add(charge, tracer);
  const light = new T.PointLight(0xffa94c, 0, height * 2.3, 2);
  scene.add(light);

  let seed = 38543;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sparkColors = [0xb64713, 0xf57a1c, 0xe39a38, 0x7b3925, 0xffc65e].map(hex => new T.Color(hex));
  const sparks = Array.from({ length: 144 }, (_, i) => {
    const angle = random() * Math.PI * 2;
    const spread = .24 + random() * 1.15;
    const speed = 1.35 + random() * 4.6;
    const velocity = new T.Vector3(Math.cos(angle) * spread, Math.sin(angle) * spread + .17, .25 + random() * 1.3)
      .applyQuaternion(strikeRotation).normalize().multiplyScalar(speed);
    const ember = i >= 64;
    return {
      velocity, drag: ember ? 2.8 : 1.85,
      gravity: .45 + random() * .60,
      width: ember ? .003 + random() * .004 : .004 + random() * .006,
      trail: ember ? .012 + random() * .019 : .028 + random() * .060,
      delay: random() * (ember ? .23 : .044),
      life: ember ? .47 + random() * .79 : .16 + random() * .45,
      color: sparkColors[i % sparkColors.length],
    };
  });
  const debris = streaks(sparks.length, 23);
  burst.add(debris.mesh);
  const segments = 20, incoming = streaks(segments, 22);
  scene.add(incoming.mesh);
  const gold = new T.Color(0xd77b23);
  const head = new T.Vector3(), tail = new T.Vector3(), view = new T.Vector3();
  let liveSparks = 0;

  return {
    get diagnostics() {
      return {
        active: burst.visible, particleCount: liveSparks, origin: origin.toArray(),
        radius: wave.visible && burst.visible ? wave.scale.x * burst.scale.x : 0,
        particleSample: liveSparks ? debris.sample() : [],
      };
    },
    update(state, silhouettes, camera, reduced, visible) {
      const age = state.hitAge;
      const preHit = age < 0;
      burst.visible = visible && age >= 0 && age < 1.55;
      liveSparks = 0;

      const focus = state.charge;
      const lastApproach = ease((state.t - TIMING.converge) / (TIMING.hit - TIMING.converge));
      const energy = visible && preHit ? focus : 0;
      charge.visible = energy > .02;
      toePointAt(state.poseTime, motion, light.position).addScaledVector(motion.attack, motion.thrustDistance * state.thrust);
      charge.position.copy(light.position);
      charge.scale.setScalar(height * mix(.38, .085, lastApproach));
      charge.material.opacity = energy * (.26 + .46 * lastApproach);
      light.intensity = energy * 2.6;

      const movingIndex = silhouettes.findIndex(echo => echo.collecting);
      incoming.mesh.visible = tracer.visible = visible && movingIndex >= 0;
      if (incoming.mesh.visible) {
        const echo = silhouettes[movingIndex], final = movingIndex === 0;
        const start = Math.max(motion.snapshotTimes[movingIndex], echo.poseTime - (final ? .055 : .025));
        toePointAt(start, motion, tail);
        view.subVectors(camera.position, tail).normalize();
        const progress = ease(echo.travel / .12);
        for (let i = 0; i < segments; i++) {
          const a = i / segments, b = (i + 1) / segments;
          toePointAt(mix(start, echo.poseTime, b), motion, head)
            .addScaledVector(motion.attack, motion.thrustDistance * echo.thrust * b ** 4);
          const width = height * (final ? .024 : .012);
          incoming.write(i, tail, head, [width * a, width * b], view, gold, [a * progress * .55, b * progress * .76]);
          tail.copy(head);
        }
        incoming.commit(segments);
        tracer.position.copy(head);
        tracer.scale.setScalar(height * (final ? .25 : .13) * mix(.7, 1.2, echo.travel));
        tracer.material.opacity = progress * (reduced ? .55 : .94);
      }

      if (!burst.visible) return;
      light.position.copy(origin);
      light.intensity = (reduced ? 4 : 11) * Math.exp(-age * 15);
      const intensity = reduced ? .52 : 1;
      flash.visible = age < .32;
      flash.scale.setScalar(.40 + .67 * (1 - Math.exp(-age * 14)));
      flash.material.opacity = intensity * Math.exp(-age * 14);
      flare.visible = age < .16;
      flare.scale.set(1.15 + age * 3.2, .12 + age * .14, 1);
      flare.material.opacity = intensity * .78 * Math.exp(-age * 24);

      const eye = plume.material.uniforms.uEye.value;
      plume.worldToLocal(eye.copy(camera.position));
      plume.material.side = Math.abs(eye.x) < 1 && eye.y > -.75 && eye.y < 1.25 && eye.z > -.30 && eye.z < 2.10
        ? T.BackSide : T.FrontSide;
      plume.visible = age > .002;
      plume.material.uniforms.uAge.value = age;
      const pressure = .23 + 1.45 * (1 - Math.exp(-age * 6.8));
      wave.visible = age > 0 && age < .42;
      wave.scale.set(pressure, pressure * .77, 1);
      wave.position.copy(motion.attack).multiplyScalar(.10 + .72 * (1 - Math.exp(-age * 5.4)));
      wave.material.uniforms.uAge.value = age;

      view.subVectors(camera.position, origin).normalize();
      for (const spark of sparks) {
        const elapsed = age - spark.delay;
        if (elapsed <= 0 || elapsed >= spark.life) continue;
        const opacity = 1 - ease((elapsed - spark.life * .30) / (spark.life * .70));
        sparkPosition(spark, Math.max(0, elapsed - spark.trail), tail);
        sparkPosition(spark, elapsed, head);
        const width = spark.width * (1 - elapsed / spark.life * .53);
        debris.write(liveSparks++, tail, head, [width * .18, width], view, spark.color, [opacity * .06, opacity * .95]);
      }
      debris.commit(liveSparks);
    },
  };
}
