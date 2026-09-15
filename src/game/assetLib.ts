import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * HOLLOW SUN — assetLib: runtime loader for the assetgen pipeline.
 *
 * Generated .glb files live in public/assets/meshes (see scripts/assetgen.ts).
 * Loading is a progressive enhancement: every consumer has a procedural
 * fallback, so a missing asset never breaks the game — it only downgrades
 * the silhouette.
 */

const cache = new Map<string, Promise<THREE.BufferGeometry | null>>();

/** full-scene load for the LIVING FOES (sprint 19-b): returns the glTF scene
 *  root (armature + SkinnedMesh) and its animation clips. Clone per consumer
 *  with SkeletonUtils — the resolved scene is the SHARED prototype. */
const sceneCache = new Map<string, Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] } | null>>();

export function loadAssetScene(name: string): Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] } | null> {
  const hit = sceneCache.get(name);
  if (hit) return hit;
  const p = new Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] } | null>((resolve) => {
    let loader: GLTFLoader;
    try {
      loader = new GLTFLoader();
    } catch {
      resolve(null);
      return;
    }
    loader.load(
      `assets/meshes/${name}.glb`,
      (gltf) => resolve({ scene: gltf.scene as unknown as THREE.Group, clips: gltf.animations ?? [] }),
      undefined,
      () => resolve(null),
    );
  });
  sceneCache.set(name, p);
  return p;
}

/** load the first mesh geometry from assets/meshes/<name>.glb (null on miss) */
export function loadAssetGeometry(name: string, recenter = false): Promise<THREE.BufferGeometry | null> {
  const hit = cache.get(name);
  if (hit) return hit;
  const p = new Promise<THREE.BufferGeometry | null>((resolve) => {
    let loader: GLTFLoader;
    try {
      loader = new GLTFLoader();
    } catch {
      resolve(null);
      return;
    }
    loader.load(
      `assets/meshes/${name}.glb`,
      (gltf) => {
        const geoms: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) geoms.push(mesh.geometry);
        });
        const found = geoms[0] ?? null;
        if (found && recenter) {
          found.computeBoundingBox();
          const bb = found.boundingBox;
          if (bb) {
            const c = new THREE.Vector3();
            bb.getCenter(c);
            found.translate(-c.x, -c.y, -c.z);
          }
        }
        resolve(found);
      },
      undefined,
      () => resolve(null),
    );
  });
  cache.set(name, p);
  return p;
}
