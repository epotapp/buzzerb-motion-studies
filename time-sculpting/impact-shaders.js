export const fieldVertex = /* glsl */ `
  varying vec3 vPosition;
  varying vec2 vUv;
  void main() {
    vPosition = position;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const output = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export const plumeFragment = /* glsl */ `
  uniform vec3 uEye;
  uniform float uAge;
  varying vec3 vPosition;

  float hash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec3 p) {
    vec3 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(cell), hash(cell + vec3(1,0,0)), f.x),
          mix(hash(cell + vec3(0,1,0)), hash(cell + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(cell + vec3(0,0,1)), hash(cell + vec3(1,0,1)), f.x),
          mix(hash(cell + vec3(0,1,1)), hash(cell + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float lobe(vec3 p, vec3 center, vec3 radius) {
    return 1.0 - length((p - center) / radius);
  }
  void main() {
    float age = uAge;
    float surge = 1.0 - exp(-age * 8.5);
    float spread = .16 + .61 * surge + .15 * age;
    float rise = .09 * surge + .17 * age;
    float drift = .20 * age;
    // March the evolving plume bounds inside the larger proxy box.
    vec3 lower = max(vec3(-1.0, -.75, -.30),
      vec3(-.33 * surge - .69 * spread, rise - .12 * surge - .57 * spread, drift - .58 * spread));
    vec3 upper = min(vec3(1.0, 1.25, 2.10),
      vec3(.38 * surge + .69 * spread, rise + .35 * surge + .65 * spread, drift + .69 * surge + 1.04 * spread));
    vec3 ray = normalize(vPosition - uEye);
    vec3 inv = 1.0 / ray;
    vec3 a = (lower - uEye) * inv;
    vec3 b = (upper - uEye) * inv;
    vec3 lo = min(a, b), hi = max(a, b);
    float enter = max(0.0, max(max(lo.x, lo.y), lo.z));
    float exit = min(min(hi.x, hi.y), hi.z);
    if (exit <= enter) discard;

    float burn = exp(-age * 3.4);
    float decay = 1.0 - smoothstep(.32, 1.37, age);
    float stepSize = (exit - enter) / 44.0;
    float dither = .43 + .14 * hash(vec3(gl_FragCoord.xy, 0.0));
    vec3 p = uEye + ray * (enter + stepSize * dither);
    vec4 total = vec4(0.0);

    for (int i = 0; i < 44; i++) {
      vec3 q = p - vec3(0.0, rise, drift);
      float front = lobe(q, vec3(.05 * surge, .06 * surge, .69 * surge),
        spread * vec3(.47, .38, .77));
      float crown = lobe(q, vec3(-.30 * surge, .31 * surge, .45 * surge),
        spread * vec3(.32, .37, .46));
      float flank = lobe(q, vec3(.35 * surge, -.08 * surge, .31 * surge),
        spread * vec3(.38, .24, .53));
      float envelope = max(front, max(crown, flank));
      if (envelope > -.49) {
        vec3 flow = (q - vec3(-.11, .20, .57) * age) * (3.8 / spread);
        float large = noise(flow);
        float rolls = .57 * large + .28 * noise(flow * 2.22 + 9.7)
          + .15 * noise(flow * 5.43 - 3.8);
        float density = clamp((envelope + (rolls - .58) * 1.63) * 3.1, 0.0, 1.0);
        float shadow = (noise(flow + vec3(-.32,.46,.17)) - large) * 1.85;
        float light = clamp(.37 + q.y * .80 - q.z * .17 - shadow, 0.0, 1.0);
        float heat = clamp((max(front, flank * .79) + (rolls - .60) * 1.42) * 2.65
          + burn * .22 - .39, 0.0, 1.0) * burn;
        vec3 soot = mix(vec3(.024,.016,.014), vec3(.28,.19,.15), light);
        vec3 flame = mix(vec3(.60,.035,.004), vec3(1.0,.28,.013), smoothstep(.13,.47,heat));
        flame = mix(flame, vec3(1.0,.87,.43), smoothstep(.49,.76,heat));
        vec3 color = mix(soot, flame, smoothstep(.10,.30,heat));
        vec3 edge = min(p - lower, upper - p);
        float boundaryFade = smoothstep(0.0, spread * .23, min(edge.x, min(edge.y, edge.z)));
        float opacity = (1.0 - exp(-density * stepSize * (11.0 + 5.0 * burn)))
          * boundaryFade * decay * smoothstep(.002, .043, age);
        total += vec4(color * opacity, opacity) * (1.0 - total.a);
      }
      if (total.a > .985) break;
      p += ray * stepSize;
    }
    if (total.a < .004) discard;
    gl_FragColor = vec4(total.rgb / total.a, total.a);
    ${output}
  }
`;

export const pressureFragment = /* glsl */ `
  uniform float uAge;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float angle = atan(p.y, p.x);
    float edge = length(p) + .020 * sin(angle * 7.0 + 1.2)
      + .009 * sin(angle * 19.0 + uAge * 8.0);
    float broken = smoothstep(-.42,.85,sin(angle*3.0+.9)+.42*sin(angle*11.0));
    float crestDistance = (edge - .78) / .013;
    float wakeDistance = (edge - .74) / .047;
    float ridge = exp(-crestDistance * crestDistance);
    float wake = exp(-wakeDistance * wakeDistance);
    float opacity = (.63 * ridge + .18 * wake) * (.12 + .88 * broken);
    opacity *= smoothstep(0.0,.028,uAge) * (1.0-smoothstep(.045,.42,uAge));
    if (opacity < .003) discard;
    gl_FragColor = vec4(mix(vec3(.63,.21,.063), vec3(1.0,.81,.56), ridge * .83), opacity);
    ${output}
  }
`;

export const streakVertex = /* glsl */ `
  attribute vec4 tint;
  varying vec4 vTint;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vTint = tint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const streakFragment = /* glsl */ `
  varying vec4 vTint;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float opacity = vTint.a * smoothstep(0.0, .70, across);
    vec3 color = mix(vTint.rgb, vec3(1.0,.83,.53), pow(across, 5.0) * vUv.y * .72);
    gl_FragColor = vec4(color, opacity);
    ${output}
  }
`;
