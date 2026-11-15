import * as THREE from 'three';

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.5, 1.0); }
`;

/** Fullscreen pass helper. */
export class FSQ {
  constructor(material) {
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }
  get material() { return this.mesh.material; }
  set material(m) { this.mesh.material = m; }
  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, cam);
  }
}

/** ShaderMaterial for fullscreen passes (no depth, no blending by default). */
export function passMaterial({ uniforms = {}, fragmentShader, defines = {}, blending = THREE.NoBlending, extra = {} }) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: FS_VERT, fragmentShader, defines,
    depthTest: false, depthWrite: false, blending, toneMapped: false, ...extra,
  });
}
