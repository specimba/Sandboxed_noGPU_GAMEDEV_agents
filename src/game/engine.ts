import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { CAMERA, COLORS, GAME, PLAYER, WAVE, depthMeters, depthRoman } from './constants';
import {
  createDust,
  createWaveMaterial,
  VIGNETTE_SHADER,
  type DustField,
  type PulseArray,
} from './shaders';
import { Input } from './input';
import { AudioEngine } from './audio';
import { buildLevel, type LevelData } from './level';
import { Player, type PlayerEvents } from './player';
import { CameraRig } from './cameraRig';
import { Hunter } from './hunter';
import { Gate, Shard } from './objects';
import { ParticlePool } from './particles';
import { loadBestDepth, saveBestDepth, useGameStore } from './store';

/**
 * ECHOVOID engine — owns the renderer, the phase machine and the pulse system.
 * React talks to it through the exported methods + the zustand store.
 */

let activeEngine: Engine | null = null;
export function getEngine(): Engine | null {
  return activeEngine;
}

type Phase = 'title' | 'flying' | 'playing' | 'paused' | 'dead' | 'cleared';

interface WaveFx {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t0: number;
  origin: THREE.Vector3;
}

interface PendingEvent {
  t: number;
  fn: () => void;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private vignette: ShaderPass;

  readonly input: Input;
  private audio = new AudioEngine();
  private particles: ParticlePool;
  private dust: DustField;
  private rig = new CameraRig();

  private pulseUniform: { value: PulseArray } | null = null;
  private level: LevelData | null = null;
  private player!: Player;
  private hunters: Hunter[] = [];
  private shards: Shard[] = [];
  private gate: Gate | null = null;

  private waves: WaveFx[] = [];
  private pending: PendingEvent[] = [];
  private playerEvents: PlayerEvents = { landed: false, jumped: false, dashed: false };

  private phase: Phase = 'title';
  private depth = 1;
  private seed = 1;
  private runStart = 0;
  private deadAt = 0;
  private fadeTarget = 0;

  private clock = new THREE.Clock();
  private t = 0;
  private vitalsTimer = 0;
  private alertLevel = 0;
  private attractAngle = 0;
  private attractPulse = 2.2;
  private dpr = 1;
  private frameEma = 16;
  private dprCheck = 0;
  private raf = 0;
  private disposed = false;
  private reduceFx = false;

  private onResize = () => this.resize();
  private onVisibility = () => {
    if (document.hidden && this.phase === 'playing') this.pause();
  };

  constructor(private canvas: HTMLCanvasElement) {
    // intentional module-level singleton so React UI can reach the engine
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeEngine = this;
    const store = useGameStore.getState();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(COLORS.bg, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);
    this.scene.background = new THREE.Color(COLORS.bg);

    // HDR target so bloom has headroom
    const target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      samples: 2,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.65, 0.35, 0.7);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VIGNETTE_SHADER);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());

    // shared pulse ring buffer
    const pulses = Array.from({ length: WAVE.maxPulses }, () => new THREE.Vector4(0, 0, 0, -1));
    this.pulseUniform = { value: pulses };

    this.particles = new ParticlePool(this.scene, 700);
    this.dust = createDust(this.pulseUniform, 3200);
    this.scene.add(this.dust.points);
    this.dust.uniforms.uPix.value = this.dpr;

    this.input = new Input(canvas);
    this.player = new Player(this.scene, this.particles);

    this.seed = (Date.now() % 100000) | 0;
    this.buildLevelObjects(1, this.seed);

    store.set({
      phase: 'title',
      depth: 1,
      shards: 0,
      hearts: GAME.heartsMax,
      bestDepth: loadBestDepth(),
      gateActive: false,
      gateDir: null,
      alert: 0,
      pulseReady: 1,
      dashReady: 1,
    });

    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    store.set({ touch: isTouch });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);

    // dev/test hook for automated verification
    (window as unknown as Record<string, unknown>).__echovoid = this;
  }

  /* ================= public API (used by React UI) ================= */

  begin(): void {
    if (this.phase !== 'title') return;
    this.audio.unlock();
    this.audio.click();
    this.audio.setDepthMood(this.depth);
    this.phase = 'flying';
    useGameStore.getState().set({ phase: 'flying' });
    this.rig.startFly(this.rig.currentPos.clone(), this.rig.currentLook.clone(), 1.5);
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    useGameStore.getState().set({ phase: 'paused' });
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.audio.unlock();
    this.phase = 'playing';
    useGameStore.getState().set({ phase: 'playing' });
  }

  togglePause(): void {
    if (this.phase === 'playing') this.pause();
    else if (this.phase === 'paused') this.resume();
  }

  restartDepth(): void {
    if (this.phase !== 'paused') return;
    this.clearLevelObjects();
    this.buildLevelObjects(this.depth, (Math.random() * 100000) | 0);
    this.player.respawn(this.level!.spawn);
    this.fadeTarget = 0;
    this.phase = 'playing';
    useGameStore.getState().set({ phase: 'playing', shards: 0, hearts: GAME.heartsMax, gateActive: false, gateDir: null });
  }

  quitToTitle(): void {
    this.clearLevelObjects();
    this.depth = 1;
    this.buildLevelObjects(1, (Math.random() * 100000) | 0);
    this.attractAngle = Math.random() * Math.PI * 2;
    this.fadeTarget = 0;
    this.phase = 'title';
    useGameStore.getState().set({
      phase: 'title',
      depth: 1,
      shards: 0,
      hearts: GAME.heartsMax,
      gateActive: false,
      gateDir: null,
    });
  }

  respawn(): void {
    if (this.phase !== 'dead') return;
    this.player.respawn(this.level!.spawn);
    for (const h of this.hunters) h.reset();
    this.fadeTarget = 0;
    this.phase = 'playing';
    useGameStore.getState().set({ phase: 'playing', hearts: GAME.heartsMax, alert: 0 });
  }

  descend(): void {
    if (this.phase !== 'cleared') return;
    this.depth += 1;
    const best = Math.max(this.depth, useGameStore.getState().bestDepth);
    saveBestDepth(best);
    this.clearLevelObjects();
    this.buildLevelObjects(this.depth, (Math.random() * 100000) | 0);
    this.player.hearts = Math.min(GAME.heartsMax, this.player.hearts + 1);
    this.player.reposition(this.level!.spawn);
    this.audio.setDepthMood(this.depth);
    this.fadeTarget = 0;
    this.phase = 'playing';
    this.runStart = this.t;
    useGameStore.getState().set({
      phase: 'playing',
      depth: this.depth,
      bestDepth: best,
      shards: 0,
      hearts: this.player.hearts,
      gateActive: false,
      gateDir: null,
    });
    useGameStore
      .getState()
      .pushToast(`DEPTH ${depthRoman(this.depth)} — ${depthMeters(this.depth)}m BELOW`, 'gold');
  }

  toggleMute(): void {
    const m = !useGameStore.getState().muted;
    useGameStore.getState().set({ muted: m });
    this.audio.setMuted(m);
  }

  toggleReduceFx(): void {
    const r = !useGameStore.getState().reduceFx;
    this.reduceFx = r;
    this.bloom.strength = r ? 0.4 : 0.85;
    useGameStore.getState().set({ reduceFx: r });
  }

  /* ================= level lifecycle ================= */

  private buildLevelObjects(depth: number, seed: number): void {
    const level = buildLevel(depth, seed, this.pulseUniform!);
    this.level = level;
    this.scene.add(level.group);

    for (const p of level.shardPositions) this.shards.push(new Shard(this.scene, p));
    this.gate = new Gate(this.scene, level.gatePosition, level.gateYaw);
    for (const h of level.hunterHomes) this.hunters.push(new Hunter(this.scene, h, depth));

    this.player.respawn(level.spawn);
    // face down the path
    this.rig.yaw = Math.atan2(
      level.gatePosition.x - level.spawn.x,
      level.gatePosition.z - level.spawn.z,
    ) + Math.PI;
    this.rig.pitch = 0.38;
  }

  private clearLevelObjects(): void {
    for (const s of this.shards) s.dispose(this.scene);
    this.shards = [];
    for (const h of this.hunters) h.dispose(this.scene);
    this.hunters = [];
    this.gate?.dispose(this.scene);
    this.gate = null;
    this.level?.dispose();
    this.level = null;
    this.pending = [];
    for (const w of this.waves) {
      w.mesh.removeFromParent();
      w.mat.dispose();
      w.mesh.geometry.dispose();
    }
    this.waves = [];
  }

  /* ================= pulse system ================= */

  private pulseIdx = 0;

  private emitPulse(origin: THREE.Vector3, kind: 'teal' | 'gold' = 'teal', silent = false): void {
    const pulses = this.pulseUniform!.value;
    // round-robin slot so simultaneous echoes coexist in the shader buffer
    this.pulseIdx = (this.pulseIdx + 1) % pulses.length;
    pulses[this.pulseIdx].set(origin.x, origin.y, origin.z, this.t);

    // visual shockwave sphere
    const mat = createWaveMaterial();
    mat.uniforms.uColor.value = kind === 'gold' ? COLORS.gate.clone() : new THREE.Color('#6ff2df');
    const mesh = new THREE.Mesh(waveGeo, mat);
    mesh.position.copy(origin);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.scene.add(mesh);
    this.waves.push({ mesh, mat, t0: this.t, origin: origin.clone() });

    if (!silent) {
      this.audio.pulse();
      this.rig.addFovKick(5);
      this.rig.addShake(0.1);
    }

    // schedule wavefront hits at physically-correct delays
    const schedule = (obj: THREE.Vector3, fn: () => void) => {
      const d = obj.distanceTo(origin);
      if (d > WAVE.revealRadius) return;
      this.pending.push({ t: this.t + d / WAVE.speed, fn });
    };
    for (const s of this.shards) {
      if (s.taken) continue;
      const i = this.shards.indexOf(s);
      schedule(
        s.group.position,
        () => {
          s.bloom();
          this.audio.chime(0, 1100 + i * 140, 0.14);
        },
      );
    }
    if (this.gate && !this.gate.active) {
      schedule(this.gate.group.position, () => {
        this.gate!.reveal = 1;
        this.audio.chime(0, 480, 0.12);
      });
    }
    for (const h of this.hunters) {
      const d = h.pos.distanceTo(origin);
      if (d > WAVE.revealRadius) continue;
      if (d < WAVE.stunRadius) {
        this.pending.push({
          t: this.t + d / WAVE.speed,
          fn: () => {
            h.onPulse(origin, 'stun');
            this.audio.stun();
            this.particles.burst(h.pos, 14, 4, { color: COLORS.hazard, life: 0.7, size: 0.4 });
          },
        });
      } else if (d < WAVE.alertRadius) {
        this.pending.push({
          t: this.t + d / WAVE.speed,
          fn: () => {
            h.onPulse(origin, 'alert');
            this.audio.growl(0);
          },
        });
      } else {
        this.pending.push({ t: this.t + d / WAVE.speed, fn: () => h.onPulse(origin, 'reveal') });
      }
    }

    if (kind === 'gold') {
      this.particles.burst(origin, 40, 7, { color: COLORS.gate, life: 1.2, size: 0.5 });
    }
  }

  /* ================= damage / death ================= */

  private damage(from: THREE.Vector3, scatterHunters: boolean): void {
    if (this.player.invuln > 0 || this.phase !== 'playing') return;
    this.player.hearts -= 1;
    const store = useGameStore.getState();
    store.set({ hearts: Math.max(0, this.player.hearts) });
    this.vignette.uniforms.uHurt.value = 1;
    this.rig.addShake(0.55);
    this.audio.hit();
    const away = this.player.pos.clone().sub(from).setY(0);
    if (away.lengthSq() < 0.01) away.set(0, 0, 1);
    away.normalize().multiplyScalar(13);
    this.player.vel.set(away.x, 6.5, away.z);
    this.player.invuln = 1.4;
    if (scatterHunters) for (const h of this.hunters) h.scatter();
    if (this.player.hearts <= 0) this.die();
  }

  private die(): void {
    this.phase = 'dead';
    this.deadAt = this.t;
    this.fadeTarget = 0.9;
    this.audio.death();
    this.audio.setAlert(0);
    const store = useGameStore.getState();
    store.set({ phase: 'dead', deaths: store.deaths + 1, alert: 0 });
    this.particles.burst(this.player.pos, 50, 9, { color: COLORS.player, life: 1.2, size: 0.5 });
  }

  /* ================= main loop ================= */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;

    this.frameEma = this.frameEma * 0.95 + dt * 1000 * 0.05;
    this.adaptDpr(dt);

    switch (this.phase) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'flying':
        this.updateFlying(dt);
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'paused':
      case 'dead':
      case 'cleared':
        this.updateFrozen(dt);
        break;
    }

    // shared uniforms
    for (const u of [this.level?.material.uniforms, this.dust.uniforms]) {
      if (!u) continue;
      if ('uTime' in u) u.uTime.value = this.t;
      if ('uPlayerPos' in u) (u.uPlayerPos.value as THREE.Vector3).copy(this.player.pos);
    }
    this.dust.uniforms.uPix.value = this.dpr;

    // vignette state
    const v = this.vignette.uniforms;
    v.uTime.value = this.t;
    v.uHurt.value = Math.max(0, v.uHurt.value - dt * 1.6);
    v.uAlert.value += (this.alertLevel - v.uAlert.value) * Math.min(1, dt * 3);
    v.uFade.value += (this.fadeTarget - v.uFade.value) * Math.min(1, dt * 2.2);

    this.composer.render();
    this.input.clearFrame();
  };

  private updateTitle(dt: number): void {
    this.attractAngle += dt * 0.06;
    const center = this.level!.center;
    this.rig.setOrbit(center, this.attractAngle, 26, 15);
    this.camera.position.copy(this.rig.currentPos);
    this.camera.lookAt(this.rig.currentLook);

    this.attractPulse -= dt;
    if (this.attractPulse <= 0) {
      this.attractPulse = 3.4;
      const n = this.level!.colliders[(Math.random() * this.level!.colliders.length) | 0];
      this.emitPulse(new THREE.Vector3(n.x, n.top + 0.5, n.z), 'teal', true);
    }
    this.updateAmbient(dt);
    if (this.input.consumeBegin()) this.begin();
  }

  private updateFlying(dt: number): void {
    // camera flies to the wisp; world idles
    this.updateAmbient(dt);
    this.rig.update(dt, this.camera, this.player.pos, ZERO, this.level!.colliders, this.reduceFx);
    this.player.group.position.copy(this.player.pos);
    this.player.group.position.y += Math.sin(this.t * 2) * 0.06;
    if (!this.rig.flying) {
      this.phase = 'playing';
      this.runStart = this.t;
      const store = useGameStore.getState();
      store.set({ phase: 'playing', runTime: 0 });
      store.pushToast(`DEPTH ${depthRoman(this.depth)} — ${depthMeters(this.depth)}m BELOW`, 'gold');
      store.pushToast('CLICK / F — ECHO PULSE', 'info');
    }
  }

  private updatePlaying(dt: number): void {
    const store = useGameStore.getState();
    const level = this.level!;

    // --- input actions ---
    if (this.input.consumePause()) {
      this.pause();
      return;
    }
    if (this.input.consumePulse()) this.tryPulse();
    if (this.input.consumeJump()) this.player.requestJump();
    if (this.input.consumeDash()) {
      const yaw = this.rig.yaw;
      const mx = this.input.moveX;
      const my = this.input.moveY;
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);
      const dx = fwdX * my + -fwdZ * mx;
      const dz = fwdZ * my + fwdX * mx;
      if (this.player.tryDash(dx, dz)) this.audio.dash();
    }

    // camera orbit
    this.rig.orbit(this.input.lookX, this.input.lookY);
    this.rig.rotate(this.input.rotateAxis, dt);
    if (this.input.zoom !== 0) this.rig.zoomBy(this.input.zoom);

    // --- player physics ---
    this.player.update(
      dt,
      { moveX: this.input.moveX, moveY: this.input.moveY, jumpHeld: this.input.jumpHeld },
      this.rig.yaw,
      level.colliders,
      this.playerEvents,
    );
    if (this.playerEvents.landed) {
      this.audio.land();
      this.particles.burst(this.player.pos, 8, 2.5, { color: COLORS.rock, life: 0.4, size: 0.3 });
    }
    if (this.playerEvents.jumped) this.audio.jump();

    // fell into the abyss
    if (this.player.pos.y < PLAYER.killY) {
      this.damage(this.player.pos, false);
      if (this.player.hearts > 0) this.player.reposition(level.spawn);
    }

    // --- spikes ---
    for (const s of level.spikes) {
      if (Math.hypot(this.player.pos.x - s.x, this.player.pos.z - s.z) < s.r + 0.3) {
        if (this.player.pos.y < s.top + 1.2) {
          const spikePos = new THREE.Vector3(s.x, this.player.pos.y - 0.5, s.z);
          this.damage(spikePos, false);
        }
      }
    }

    // --- shards ---
    let collected = -1;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      s.update(dt, this.t);
      if (!s.taken && s.group.position.distanceTo(this.player.pos) < 1.5) collected = i;
    }
    if (collected >= 0) {
      this.shards[collected].collect(this.particles);
      this.audio.shard(collected);
      const count = this.shards.filter((s) => s.taken).length;
      store.set({ shards: count });
      store.pushToast(`ECHO SHARD ${count}/${GAME.shardsNeeded}`, 'gold');
      if (count >= GAME.shardsNeeded && this.gate && !this.gate.active) {
        this.gate.activate(this.particles);
        this.audio.gateOpen();
        store.set({ gateActive: true });
        store.pushToast('THE GATE AWAKENS — REACH THE GOLD LIGHT', 'gold');
        this.emitPulse(this.gate.group.position.clone().add(new THREE.Vector3(0, 2, 0)), 'gold');
      }
    }

    // --- gate ---
    this.gate?.update(dt, this.t);
    if (this.gate?.active) {
      const d = Math.hypot(
        this.player.pos.x - this.gate.group.position.x,
        this.player.pos.z - this.gate.group.position.z,
      );
      if (d < 2.2 && Math.abs(this.player.pos.y - this.gate.group.position.y) < 3) {
        this.clearDepth();
        return;
      }
    }

    // --- hunters ---
    let alert = 0;
    for (const h of this.hunters) {
      const hit = h.update(dt, this.t, this.player.pos, 1);
      if (hit && this.player.invuln <= 0) this.damage(h.pos, true);
      if (h.state === 'alert') {
        const prox = 1 - Math.min(1, h.pos.distanceTo(this.player.pos) / 30);
        alert = Math.max(alert, prox);
      }
    }
    this.alertLevel = alert;
    this.audio.setAlert(alert);

    // --- fx ---
    this.updateAmbient(dt);

    // --- camera ---
    this.rig.update(dt, this.camera, this.player.pos, this.player.vel, level.colliders, this.reduceFx);

    // --- HUD vitals (throttled) ---
    this.vitalsTimer -= dt;
    if (this.vitalsTimer <= 0) {
      this.vitalsTimer = 0.09;
      const st = useGameStore.getState();
      st.set({
        pulseReady: 1 - Math.min(1, this.pulseCd / WAVE.cooldown),
        dashReady: this.player.dashReady ? 1 : 0,
        alert,
        runTime: this.t - this.runStart,
        gateDir: this.gate?.active ? this.gateAngle() : null,
      });
    }
  }

  private pulseCd = 0;

  private tryPulse(): void {
    if (this.pulseCd > 0) return;
    this.pulseCd = WAVE.cooldown;
    this.emitPulse(this.player.pos.clone(), 'teal');
  }

  private gateAngle(): number {
    if (!this.gate) return 0;
    const dx = this.gate.group.position.x - this.player.pos.x;
    const dz = this.gate.group.position.z - this.player.pos.z;
    return Math.atan2(dx, dz) + this.rig.yaw;
  }

  private clearDepth(): void {
    this.phase = 'cleared';
    this.fadeTarget = 1;
    this.lastRunTime = this.t - this.runStart;
    this.audio.cleared();
    useGameStore.getState().set({ phase: 'cleared', lastRunTime: this.lastRunTime, alert: 0 });
    this.audio.setAlert(0);
    if (this.gate) {
      this.particles.burst(
        new THREE.Vector3(this.gate.group.position.x, this.gate.group.position.y + 2, this.gate.group.position.z),
        80,
        10,
        { color: COLORS.gate, life: 1.6, size: 0.6 },
      );
    }
  }

  private lastRunTime = 0;

  private updateFrozen(dt: number): void {
    // world suspended; only the abyss keeps whispering
    this.audio.update(dt);
  }

  private updateAmbient(dt: number): void {
    this.audio.update(dt);
    this.particles.update(dt);
    this.updateWaves();
    for (const s of this.shards) s.update(dt, this.t);
    this.gate?.update(dt, this.t);
  }

  private updateWaves(): void {
    const speed = WAVE.speed;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const age = this.t - w.t0;
      const radius = age * speed;
      if (radius > 110 || age > 4.2) {
        w.mesh.removeFromParent();
        w.mat.dispose();
        this.waves.splice(i, 1);
        continue;
      }
      // the shell is a launch cue only — hand over to the geometry band
      w.mesh.visible = radius < 26;
      w.mesh.scale.setScalar(Math.max(0.01, radius));
      w.mat.uniforms.uAge.value = age;
    }
  }

  /* ================= perf ================= */

  private adaptDpr(dt: number): void {
    this.dprCheck += dt;
    if (this.dprCheck < 2) return;
    this.dprCheck = 0;
    const target = Math.min(window.devicePixelRatio || 1, 2);
    if (this.frameEma > 21 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.applyDpr();
    } else if (this.frameEma < 13.5 && this.dpr < target) {
      this.dpr = Math.min(target, this.dpr + 0.25);
      this.applyDpr();
    }
  }

  private applyDpr(): void {
    this.renderer.setPixelRatio(this.dpr);
    this.composer.setPixelRatio(this.dpr);
    this.particles.setPixelRatio(this.dpr);
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dpr = this.renderer.getPixelRatio();
  }

  private rigPos(): THREE.Vector3 {
    return this.rig.currentPos;
  }
  private rigLook(): THREE.Vector3 {
    return this.rig.currentLook;
  }

  /** current player position (for debug/verification) */
  get playerPos(): THREE.Vector3 {
    return this.player.pos;
  }

  get phaseName(): string {
    return this.phase;
  }

  /** expose shard/taken state for verification */
  get shardTaken(): boolean[] {
    return this.shards.map((s) => s.taken);
  }

  /** compact state for automated verification */
  get debugState(): object {
    return {
      depth: this.depth,
      hearts: this.player.hearts,
      gateActive: this.gate?.active ?? false,
      gatePos: this.gate ? this.gate.group.position.toArray().map((v) => Math.round(v * 10) / 10) : null,
      hunters: this.hunters.map((h) => h.state),
      shardPos: this.shards.filter((s) => !s.taken).map((s) => s.group.position.toArray().map((v) => Math.round(v * 10) / 10)),
      shardsTaken: this.shards.filter((s) => s.taken).length,
      time: Math.round(this.t * 100) / 100,
      matTime: this.level ? Math.round((this.level.material.uniforms.uTime.value as number) * 100) / 100 : -1,
      pulses: (this.pulseUniform?.value ?? []).map((p) => [p.x, p.y, p.z, Math.round(p.w * 100) / 100]).filter((p) => p[3] >= 0),
      camPos: this.camera.position.toArray().map((v) => Math.round(v * 10) / 10),
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.clearLevelObjects();
    this.player.dispose(this.scene);
    this.particles.dispose();
    this.dust.dispose();
    this.audio.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (activeEngine === this) activeEngine = null;
  }
}

const ZERO = new THREE.Vector3();
const waveGeo = new THREE.SphereGeometry(1, 40, 26);
