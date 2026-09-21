import * as THREE from "three/webgpu";
import {
  pass, uniform, screenUV, vec2, vec3, vec4, float, mix, max, smoothstep,
  fract, sin, dot, length, pow, exp, convertToTexture, Fn,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { QualitySettings } from "@/frontier/core/Quality";

/**
 * TSL post stack: scene pass -> shockwave distortion -> 3-tap CA -> bloom ->
 * ONE fused Fn grade (warm lift-gamma-gain, vibrance, desat, flash, vignette,
 * bounded animated grain). Single output node; both backends.
 */
export class PostStack {
  params = {
    vignette: 0.40,
    chromaBase: 0.0007,
    chromaBoost: 0,
    flash: 0,
    desat: 0,
    grain: 0.035,
    shockX: 0.5,
    shockY: 0.5,
    shockR: 0,
    shockAmp: 0,
  };

  private post: THREE.PostProcessing;
  private uChroma = uniform(0.0007);
  private uFlash = uniform(0);
  private uFlashColor = uniform(vec3(1.0, 0.85, 0.6));
  private uDesat = uniform(0);
  private uGrain = uniform(0.035);
  private uVignette = uniform(0.40);
  private uTime = uniform(0);
  private uAspect = uniform(16 / 9);
  private uShock = uniform(vec4(0.5, 0.5, 0, 0));
  private uBloomMix = uniform(1);
  private bloomEnabled = true;
  private distortionEnabled = true;
  private aspect = 16 / 9;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode();

    const suv = screenUV;
    const sd = suv.sub(this.uShock.xy);
    const sdA = vec2(sd.x.mul(this.uAspect), sd.y);
    const sdLen = max(length(sdA), float(1e-4));
    const dRing = sdLen.sub(this.uShock.z);
    const band = exp(dRing.mul(dRing).div(-0.0035));
    const push = band.mul(this.uShock.w).mul(0.03);
    const uv2 = suv.sub(vec2(sdA.x.div(sdLen).div(this.uAspect), sdA.y.div(sdLen)).mul(push));

    const gradeFn = Fn(() => {
      const dir = uv2.sub(vec2(0.5, 0.5));
      const r2 = dot(dir, dir);
      const ca = this.uChroma.mul(float(0.35).add(r2.mul(4.0)));
      const off = dir.mul(ca);
      const col = vec3(
        sceneColor.sample(uv2.add(off)).r,
        sceneColor.sample(uv2).g,
        sceneColor.sample(uv2.sub(off)).b,
      ).toVar();

      const blTex = convertToTexture(bloom(sceneColor, 0.62, 0.5, 0.82));
      col.assign(col.add(blTex.sample(uv2).rgb.mul(this.uBloomMix)));

      // warm lift-gamma-gain
      col.assign(max(col, vec3(0.0)));
      const lift = vec3(0.022, 0.015, 0.010);
      const gain = vec3(1.06, 1.0, 0.94);
      const gam = vec3(0.95, 0.99, 1.04);
      col.assign(lift.add(gain.mul(pow(col, gam))));

      const lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col.assign(mix(vec3(lum), col, float(1.08)));
      col.assign(mix(col, vec3(lum).mul(vec3(1.04, 1.0, 0.94)), this.uDesat));

      col.assign(col.add(this.uFlashColor.mul(this.uFlash)));

      const vig = float(1.0).sub(this.uVignette.mul(smoothstep(0.30, 1.02, length(dir.mul(1.45)))));
      col.assign(col.mul(vig));

      const ox = vec2(fract(this.uTime.mul(61.7)).mul(251.0), fract(this.uTime.mul(47.9)).mul(251.0));
      const g1 = fract(sin(dot(uv2.mul(vec2(1831.0, 1049.0)).add(ox), vec2(12.9898, 78.233))).mul(43758.5453));
      col.assign(col.add(g1.sub(0.5).mul(this.uGrain)));

      return vec4(col, 1);
    })();

    this.post = new THREE.PostProcessing(renderer);
    this.post.outputNode = gradeFn;
  }

  setQuality(q: QualitySettings): void {
    this.bloomEnabled = q.bloom;
    this.uBloomMix.value = q.bloom ? 1 : 0;
    this.uGrain.value = q.grain ? 0.035 : 0;
    this.params.grain = q.grain ? 0.035 : 0;
    this.params.vignette = q.bloom ? 0.40 : 0.34;
    this.uVignette.value = this.params.vignette;
  }

  pulseBlast(nx: number, ny: number, radius: number, amp: number): void {
    this.params.shockX = nx;
    this.params.shockY = 1 - ny;
    this.params.shockR = Math.max(0.02, radius);
    this.params.shockAmp = amp;
  }

  chromaBoostPulse(amount: number): void {
    this.params.chromaBoost = Math.max(this.params.chromaBoost, amount);
  }

  setSize(w: number, h: number): void {
    if (h > 0) {
      this.aspect = w / h;
      this.uAspect.value = w / h;
    }
  }

  setPixelRatio(_pr: number): void { /* renderer-driven */ }

  render(dt: number, time: number): void {
    const p = this.params;
    p.flash *= Math.exp(-9 * dt);
    if (p.flash < 0.002) p.flash = 0;
    p.chromaBoost *= Math.exp(-6 * dt);
    if (p.chromaBoost < 0.0001) p.chromaBoost = 0;
    if (p.shockAmp > 0) {
      p.shockR += dt * 3.2;
      p.shockAmp *= Math.exp(-3.4 * dt);
      if (p.shockAmp < 0.02) p.shockAmp = 0;
    }
    this.uChroma.value = p.chromaBase + p.chromaBoost;
    this.uFlash.value = p.flash;
    this.uDesat.value = p.desat;
    this.uGrain.value = p.grain;
    this.uVignette.value = p.vignette;
    this.uTime.value = time;
    this.uShock.value.set(
      p.shockX,
      p.shockY,
      this.distortionEnabled ? p.shockR : 0,
      this.distortionEnabled ? p.shockAmp : 0,
    );
    this.post.render();
  }

  get bloomActive(): boolean {
    return this.bloomEnabled;
  }
}
