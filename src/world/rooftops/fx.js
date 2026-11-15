// Animated extras on layer 1: steam plumes (soft camera-facing puffs) and flags (vertex animated cloth).
// Everything is a pure function of uTime.
import * as THREE from 'three';

export const WIND = [0.94, 0, 0.34];     // sea breeze: blows from the bay toward the east / south-east

/** emitters: [{x,y,z, size (vent radius, m), rise (m), strength 0..1}] */
export function buildSteam(ctx, group, emitters, rng) {
  if (!emitters.length) return null;
  const PER = 22;
  const emit = [], par = [];
  for (const e of emitters) for (let i = 0; i < PER; i++) {
    emit.push(e.x, e.y, e.z, e.size);
    par.push((i + rng() * 0.6) / PER, rng(), e.rise, e.strength);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aEmit', new THREE.InstancedBufferAttribute(new Float32Array(emit), 4));
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(par), 4));
  g.instanceCount = emit.length / 4;
  const mat = ctx.makeShaderMaterial({
    uniforms: { uWind: { value: new THREE.Vector3(WIND[0], WIND[1], WIND[2]) } },
    vertexShader: /* glsl */`
      attribute vec4 aEmit; attribute vec4 aP; uniform vec3 uWind;
      varying vec2 vQ; varying vec4 vInfo; varying vec3 vL;
      void main() {
        float seed = aP.y; float rise = aP.z;
        float life = mix(10.0, 15.0, fract(seed * 7.13));
        float age = fract(uTime / life + aP.x);
        float up = rise * (1.0 - exp(-age * 2.2)) / (1.0 - exp(-2.2));
        float drift = rise * (0.22 * age + 1.05 * age * age);
        vec3 p = aEmit.xyz + vec3(0.0, up + aEmit.w * 0.5, 0.0) + uWind * drift;
        float wob = 0.11 * rise * age;
        p.x += sin(age * 8.0 + seed * 40.0 + uTime * 0.13) * wob; p.z += cos(age * 6.5 + seed * 23.0 - uTime * 0.11) * wob;
        float size = aEmit.w * (1.0 + 6.5 * pow(age, 0.85)) * (0.8 + 0.4 * fract(seed * 3.3));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float rot = seed * 30.0 + age * 3.0 * (fract(seed * 5.7) - 0.5);
        vec2 q = position.xy * 2.0; float cr = cos(rot), sr = sin(rot);
        mv.xy += vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y) * size;
        vQ = q;
        float fade = smoothstep(0.0, 0.05, age) * pow(1.0 - age, 2.1);
        vInfo = vec4(age, seed, aP.w * fade, size);
        vec3 sv = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
        vec2 s2 = normalize(sv.xy + 1e-4);
        vL = vec3(cr * s2.x + sr * s2.y, -sr * s2.x + cr * s2.y, dot(normalize(p - uCamPos), uSunDir));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vQ; varying vec4 vInfo; varying vec3 vL;
      void main() {
        float r = length(vQ);
        if (r > 1.0) discard;
        // irregular, wispy outline: the radius is perturbed by two scales of noise that evolve with the puff's age
        vec2 w = vQ * 2.1 + vec2(vInfo.y * 17.0, vInfo.y * 9.0);
        float n = fbm2(w + vInfo.x * 1.1);
        float n2 = fbm2(w * 2.7 + 5.0 - vInfo.x * 1.7);
        float rr = r + (n - 0.47) * 1.0 + (n2 - 0.47) * 0.5 + vInfo.x * 0.3;
        float body = smoothstep(0.9, 0.05, rr);
        float a = body * (0.4 + 0.8 * n2);
        a *= min(vInfo.z * 1.55, 0.95) * smoothstep(1.0, 0.72, r);
        float sunVis = smoothstep(-3.5, 2.5, uSunElev);
        float fwd = vL.z;
        float phase = 0.8 + 0.2 * fwd * fwd + 0.25 * max(fwd, 0.0) + 2.0 * pow(max(fwd, 0.0), 8.0);
        float shade = clamp(0.62 + 0.45 * dot(vQ, vL.xy) + 0.5 * (n - 0.5) + 0.25 * (body - 0.5), 0.15, 1.25);
        vec3 col = uSunColor * 0.3 * phase * shade * sunVis
                 + uAmbient * (0.95 + 0.3 * shade)
                 + vec3(1.0, 0.72, 0.45) * 0.006 * uNight * (1.0 - 0.5 * vQ.y);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.layers.set(1); mesh.renderOrder = 10; mesh.name = 'roof_steam';
  group.add(mesh);
  return mesh;
}

/** flags: [{x,y,z (top of hoist), s (scale), color:[r,g,b]}] ; cloth geometry has its hoist edge at x = 0 */
export function buildFlags(ctx, group, cloth, flags) {
  if (!flags.length) return null;
  const mat = ctx.makeMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }, {
    key: 'roofflag',
    vertexPars: 'varying vec2 vUv2;',
    vertex: /* glsl */`
      vUv2 = uv;
      {
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        #endif
        float u = uv.x; float amp = u * (0.55 + 0.45 * u); float dAmp = 0.55 + 0.9 * u;
        float a1 = u * 7.0 - uTime * 5.2 + ph + uv.y * 1.3, a2 = u * 13.0 - uTime * 8.3 + ph * 1.7 - uv.y * 2.1;
        float gust = 0.75 + 0.25 * sin(uTime * 0.7 + ph * 2.0);
        float w = (sin(a1) * 0.17 + sin(a2) * 0.06) * gust;
        float dw = (cos(a1) * 7.0 * 0.17 + cos(a2) * 13.0 * 0.06) * gust;
        transformed.z += w * amp;
        transformed.y -= u * u * 0.13 * (1.0 + 0.4 * sin(uTime * 1.3 + ph)) + 0.03 * amp * sin(u * 9.0 - uTime * 6.0 + ph);
        transformed.x -= amp * 0.05 * (1.0 - cos(a1));
        vec3 on = normalize(vec3(-(dw * amp + w * dAmp) / 1.8, 0.0, 1.0));
        #ifdef USE_INSTANCING
          on = mat3(instanceMatrix) * on;
        #endif
        vNormal = normalize(normalMatrix * on);
      }`,
    fragPars: 'varying vec2 vUv2;',
    color: /* glsl */`
    {
      vec3 field = diffuseColor.rgb;
      float band = step(0.36, vUv2.y) * step(vUv2.y, 0.64);
      float disc = 1.0 - smoothstep(0.165, 0.18, length((vUv2 - vec2(0.36, 0.5)) * vec2(1.636, 1.0)));
      vec3 c = mix(field, vec3(0.8, 0.77, 0.66), band);
      c = mix(c, vec3(0.78, 0.5, 0.1), disc);
      c *= 0.85 + 0.25 * vnoise(vUv2 * vec2(60.0, 40.0));
      diffuseColor.rgb = c;
    }`,
    emissive: /* glsl */`
    {
      vec3 nw = viewToWorldDir(normal);
      float back = max(-dot(nw, uSunDir), 0.0) * smoothstep(-2.0, 2.0, uSunElev);
      totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * 0.11;
    }`,
  });
  const mesh = new THREE.InstancedMesh(cloth, mat, flags.length);
  const m = new THREE.Matrix4(); const col = new Float32Array(flags.length * 3);
  const ry = Math.atan2(-WIND[2], WIND[0]); const c = Math.cos(ry), s = Math.sin(ry);
  flags.forEach((f, i) => {
    m.set(c * f.s, 0, s * f.s, f.x, 0, f.s, 0, f.y - 0.55 * f.s, -s * f.s, 0, c * f.s, f.z, 0, 0, 0, 1);
    mesh.setMatrixAt(i, m); col.set(f.color, i * 3);
  });
  mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.layers.set(1); mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false; mesh.name = 'roof_flags';
  group.add(mesh);
  return mesh;
}
