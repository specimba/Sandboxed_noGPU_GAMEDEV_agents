import * as THREE from "three/webgpu";
import {
  pass, uniform, screenUV, vec2, vec3, vec4, float, mix, max, smoothstep,
  fract, sin, dot, length, convertToTexture, Fn,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { FXState } from "@/hollowsun/types";

/**
 * HOLLOW SUN — TSL post stack (DESIGN_C §12, proven frontier/periapsis architecture).
 *
 * pass(scene, camera) -> radial chromatic aberration (3-tap, fx.chroma) -> bloom
 * (strength 0.9 / radius 0.6 / threshold 0.6) -> ONE fused composite Fn (golden
 * lift fx.golden, vignette 0.45, bounded-hash grain 0.035) assigned as the single
 * `outputNode` of the render pipeline. ACES tone mapping + sRGB conversion are
 * applied by the pipeline AFTER the composite (outputColorTransform), so the
 * scene renders linear HDR and is tone-mapped exactly once.
 *
 * Grain is hashed from a BOUNDED phase uniform (wraps at 16s on the CPU; the
 * shader only ever sees fract()-wrapped offsets) — never an unbounded uTime.
 */
export class PostStack {
  private pipeline: THREE.RenderPipeline;
  private uChroma = uniform(0.0);
  private uGolden = uniform(0.0);
  private uPhase = uniform(0.0);
  private uGrain = uniform(0.035);
  private uVignette = uniform(0.45);
  private phase = 0;
  private aspect = 16 / 9;

  private constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    // ACES is applied post-composite by the pipeline's output transform.
    if (renderer.toneMapping === THREE.NoToneMapping) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode();

    // Bloom (half the look; The Light Rule). Sampled through convertToTexture.
    const blTex = convertToTexture(bloom(sceneColor, 0.9, 0.6, 0.6));

    // ALL .toVar()/.assign() chains MUST live inside a Fn stack (TSL rule —
    // assignments at constructor scope throw "No stack defined for assign").
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputNode = Fn(() => {
      const uv = screenUV;
      const dir = uv.sub(vec2(0.5, 0.5));
      const r2 = dot(dir, dir);

      // Radial chromatic aberration — magnitude driven by fx.chroma (0..0.006).
      const ca = this.uChroma.mul(float(0.35).add(r2.mul(4.0)));
      const off = dir.mul(ca);
      const col = vec3(
        sceneColor.sample(uv.add(off)).r,
        sceneColor.sample(uv).g,
        sceneColor.sample(uv.sub(off)).b,
      ).toVar();

      col.assign(col.add(blTex.sample(uv).rgb));

      // Golden grade lift — fx.golden 0..1 warms highlights & lifts shadows gold.
      col.assign(max(col, vec3(0.0)));
      const lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      const warm = col
        .mul(vec3(1.16, 1.03, 0.74))
        .add(vec3(0.05, 0.03, 0.0).mul(smoothstep(0.0, 0.6, lum)));
      col.assign(mix(col, warm, this.uGolden));

      // Vignette 0.45 — edge of arena dissolves into darkness.
      const vig = float(1.0).sub(this.uVignette.mul(smoothstep(0.30, 1.02, length(dir.mul(1.45)))));
      col.assign(col.mul(vig));

      // Animated film grain 0.035 — bounded per-frame hash (phase wraps on CPU).
      const ox = vec2(fract(this.uPhase.mul(61.7)).mul(251.0), fract(this.uPhase.mul(47.9)).mul(251.0));
      const g1 = fract(sin(dot(uv.mul(vec2(1831.0, 1049.0)).add(ox), vec2(12.9898, 78.233))).mul(43758.5453));
      col.assign(col.add(g1.sub(0.5).mul(this.uGrain)));

      return vec4(col, 1);
    })();
    this.pipeline = pipeline;
  }

  static async create(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): Promise<PostStack> {
    return new PostStack(renderer, scene, camera);
  }

  /** Reads fx.chroma / fx.golden each frame. Grain phase advances in REAL time (alive during hitstop). */
  update(realDt: number, fx: FXState): void {
    const dt = Math.max(0, realDt);
    this.phase = (this.phase + dt) % 16;
    this.uPhase.value = this.phase;
    this.uChroma.value = Math.min(0.006, Math.max(0, fx.chroma));
    this.uGolden.value = Math.min(1, Math.max(0, fx.golden));
  }

  setSize(w: number, h: number): void {
    if (w > 0 && h > 0) this.aspect = w / h;
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
