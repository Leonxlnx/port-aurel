// Minimal look-dev scene: ground, random blocks, a few spheres. Used to validate the pipeline.
import * as THREE from 'three';
import { makeMaterial } from '../engine/materials.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export async function createTestWorld(engine) {
  const scene = new THREE.Scene();
  const R = rng(7);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), makeMaterial({ color: 0x55585c, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const palette = [0xb08a6e, 0x9a6b52, 0xc9b79c, 0x8d8f94, 0x6f7f8c, 0xd8cdbb, 0x7a5a48];
  const mats = palette.map(c => makeMaterial({ color: c, roughness: 0.85 }));
  const N = 420; const perMat = Math.ceil(N / mats.length);
  const meshes = mats.map(m => { const im = new THREE.InstancedMesh(box, m, perMat); im.castShadow = im.receiveShadow = true; im.count = 0; scene.add(im); return im; });
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const gx = Math.floor(R() * 24) - 12, gz = Math.floor(R() * 24) - 12;
    const d = Math.hypot(gx, gz);
    const h = 8 + R() * R() * 140 * Math.exp(-d * 0.12) + R() * 20;
    p.set(gx * 42 + (R() - 0.5) * 6, 0, gz * 42 + (R() - 0.5) * 6);
    s.set(16 + R() * 18, h, 16 + R() * 18);
    M.compose(p, q, s);
    const im = meshes[i % mats.length]; im.setMatrixAt(im.count++, M);
  }
  meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });

  const sph = new THREE.SphereGeometry(3, 48, 32);
  const sm = [makeMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 }), makeMaterial({ color: 0xb33a2a, roughness: 0.35 }), makeMaterial({ color: 0xeeeeee, roughness: 0.6 })];
  sm.forEach((m, i) => { const o = new THREE.Mesh(sph, m); o.position.set(-10 + i * 10, 3, 520); o.castShadow = o.receiveShadow = true; scene.add(o); });

  return {
    scene,
    update(t) {},
    defaultView: { pos: [60, 14, 620], target: [0, 40, 0], fov: 38 },
  };
}
