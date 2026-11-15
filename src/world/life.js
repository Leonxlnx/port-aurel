// Life: flocks of gulls (instanced, animated entirely in the vertex shader as a pure function of uTime).
import * as THREE from 'three';

export async function build(ctx) {
  const { makeShaderMaterial, layout: L } = ctx;
  const R = ctx.rng('gulls');
  // one bird: body + two 2-segment wings. aPart.x = signed span (-1..1), aPart.y = 1 for outer wing segment
  const P = [], A = [], C = [];
  const tri = (a, b, c, pa, pb, pc, col) => { P.push(...a, ...b, ...c); A.push(...pa, ...pb, ...pc); C.push(col, col, col); };
  const body = 0.9;
  tri([0, 0, -0.34], [0.06, 0, 0.05], [-0.06, 0, 0.05], [0, 0], [0, 0], [0, 0], body);
  tri([0.06, 0, 0.05], [0, 0, 0.36], [-0.06, 0, 0.05], [0, 0], [0, 0], [0, 0], 0.75);
  tri([0, 0.035, -0.1], [0.06, 0, 0.05], [0, 0, -0.34], [0, 0], [0, 0], [0, 0], 0.8);
  tri([0, 0.035, -0.1], [0, 0, -0.34], [-0.06, 0, 0.05], [0, 0], [0, 0], [0, 0], 0.8);
  for (const s of [-1, 1]) {
    // inner segment (root -> elbow), outer segment (elbow -> tip, dark tip)
    tri([0.04 * s, 0, -0.14], [0.36 * s, 0, -0.10], [0.04 * s, 0, 0.07], [0.06 * s, 0], [0.55 * s, 0], [0.06 * s, 0], 0.85);
    tri([0.36 * s, 0, -0.10], [0.36 * s, 0, 0.05], [0.04 * s, 0, 0.07], [0.55 * s, 0], [0.55 * s, 0], [0.06 * s, 0], 0.85);
    tri([0.36 * s, 0, -0.10], [0.68 * s, 0, -0.02], [0.36 * s, 0, 0.05], [0.55 * s, 1], [1.0 * s, 1], [0.55 * s, 1], 0.35);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 2));
  geo.setAttribute('aShade', new THREE.Float32BufferAttribute(C, 1));

  // flocks: centre, radii, count
  const flocks = [
    { c: [-560, 26, 150], r: [260, 12, 90], n: 46 },      // sunset corridor west of the canal mouth
    { c: [-190, 24, 150], r: [70, 10, 120], n: 30 },      // canal mouth / promenade
    { c: [-260, 18, 600], r: [90, 8, 50], n: 22 },        // pier
    { c: [-1150, 34, 170], r: [80, 14, 80], n: 26 },      // lighthouse
    { c: [250, 70, 153], r: [260, 20, 60], n: 16 },       // high over the canal
  ];
  const N = flocks.reduce((a, f) => a + f.n, 0);
  const iC = new Float32Array(N * 3), iR = new Float32Array(N * 3), iS = new Float32Array(N * 4);
  let k = 0;
  for (const f of flocks) for (let i = 0; i < f.n; i++, k++) {
    iC.set([f.c[0] + (R() - 0.5) * 30, f.c[1] + (R() - 0.5) * 8, f.c[2] + (R() - 0.5) * 30], k * 3);
    iR.set([f.r[0] * (0.45 + R() * 0.75), f.r[1] * (0.5 + R()), f.r[2] * (0.45 + R() * 0.75)], k * 3);
    iS.set([R() * 100, 0.75 + R() * 0.6, R() * 6.283, 0.85 + R() * 0.4], k * 4);   // phase, speed, flap phase, size
  }
  geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(iC, 3));
  geo.setAttribute('iRadius', new THREE.InstancedBufferAttribute(iR, 3));
  geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iS, 4));
  geo.instanceCount = N;

  const mat = makeShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec2 aPart; attribute float aShade; attribute vec3 iCenter; attribute vec3 iRadius; attribute vec4 iSeed;
      varying float vShade; varying vec3 vN;
      vec3 path(float t) {
        float a = t * 0.11 * iSeed.y + iSeed.x;
        return iCenter + vec3(cos(a) * iRadius.x + sin(a * 2.3 + iSeed.x) * iRadius.x * 0.18,
                              sin(a * 1.7 + iSeed.z) * iRadius.y + sin(a * 0.6) * iRadius.y * 0.6,
                              sin(a * 1.31 + iSeed.x * 0.37) * iRadius.z + cos(a * 2.9) * iRadius.z * 0.15);
      }
      void main() {
        vec3 p0 = path(uTime), p1 = path(uTime + 0.35), pm = path(uTime - 0.35);
        vec3 fwd = normalize(p1 - p0);
        vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        // bank into the turn
        vec3 acc = (p1 - 2.0 * p0 + pm);
        float bank = clamp(dot(acc, right) * 2.2, -0.9, 0.9);
        vec3 up = normalize(cross(right, fwd) + right * bank);
        right = normalize(cross(fwd, up));
        // flap: bursts of flapping separated by glides
        float ph = uTime * 6.5 * iSeed.y + iSeed.z;
        float glide = smoothstep(0.55, 0.8, sin(uTime * 0.35 * iSeed.y + iSeed.x * 3.0));
        float flap = sin(ph) * (1.0 - glide) + 0.25 * glide;
        float span = abs(aPart.x);
        float lift = flap * span * 0.34 + aPart.y * sin(ph - 0.9) * (1.0 - glide) * span * 0.16 - span * span * 0.05;
        vec3 lp = position; lp.y += lift; lp.x *= 1.0 - 0.12 * abs(flap) * span;
        lp *= iSeed.w * 1.0;
        vec3 wp = p0 + right * lp.x + up * lp.y - fwd * lp.z;
        vShade = aShade; vN = up;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vShade; varying vec3 vN;
      void main() {
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        vec3 alb = vec3(0.86, 0.87, 0.9) * vShade;
        vec3 lit = uLightColor * (0.25 + 0.75 * max(dot(n, uLightDir), 0.0)) / 3.14159 + uAmbient * (0.7 + 0.3 * n.y);
        gl_FragColor = vec4(alb * lit, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.layers.set(1); mesh.name = 'gulls';
  const group = new THREE.Group(); group.add(mesh);
  return { group, flocks };
}
