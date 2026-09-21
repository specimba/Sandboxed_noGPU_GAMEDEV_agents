import * as THREE from "three/webgpu";
import { vec3, vec4 } from "three/tsl";
import { Engine } from "@/frontier/core/Engine";
import { Input, type InputSnapshot } from "@/frontier/core/Input";
import { Rng } from "@/frontier/core/Rng";
import {
  AutoScaler, QUALITY_PRESETS, detectTier, loadUserTier, saveUserTier,
  type QualitySettings, type QualityTier,
} from "@/frontier/core/Quality";
import { SceneWorld } from "@/frontier/world/Scene";
import { Walker } from "@/frontier/world/Walker";
import { CameraRig } from "@/frontier/world/CameraRig";
import { EnemiesView } from "@/frontier/world/EnemiesView";
import { PostStack } from "@/frontier/fx/PostStack";
import { BattleFX } from "@/frontier/fx/BattleFX";
import { AudioEngine } from "@/frontier/audio/AudioEngine";
import { Hud, type HudStats } from "@/frontier/ui/Hud";
import { Menus, type UpgradeCardView } from "@/frontier/ui/Menus";
import { Player } from "@/frontier/sim/Player";
import { Projectiles } from "@/frontier/sim/Projectiles";
import { Enemies, EV_CONTACT, EV_SPIT } from "@/frontier/sim/Enemies";
import { Waves } from "@/frontier/sim/Waves";
import { UPGRADES, rollChoices, type UpgradeDef } from "@/frontier/sim/Upgrades";

type State = "title" | "playing" | "intermission" | "gameover" | "paused";

const MISSILE_SPEED = 26;
const MISSILE_TURN = 9;
const MISSILE_AOE = 2.6;

function loadBest(): number {
  try {
    const raw = localStorage.getItem("sf_best");
    if (raw) {
      const o = JSON.parse(raw) as { best?: number };
      if (typeof o.best === "number" && isFinite(o.best)) return o.best;
    }
  } catch { /* ignore */ }
  return 0;
}
function saveBest(b: number): void {
  try { localStorage.setItem("sf_best", JSON.stringify({ best: b })); } catch { /* ignore */ }
}

export class Game {
  private engine!: Engine;
  private input = new Input();
  private world!: SceneWorld;
  private walker!: Walker;
  private rig = new CameraRig();
  private post!: PostStack;
  private fx!: BattleFX;
  private view!: EnemiesView;
  private audio = new AudioEngine();
  private hud!: Hud;
  private menus!: Menus;
  private player = new Player();
  private shells = new Projectiles();
  private enemies = new Enemies();
  private waves = new Waves();
  private scaler!: AutoScaler;
  private rng = new Rng(1);

  private state: State = "title";
  private quality: QualitySettings;
  private userTier: QualityTier | null;
  private snap: InputSnapshot;
  private canvas: HTMLCanvasElement;
  private hudRoot: HTMLElement;
  private menusRoot: HTMLElement;

  private time = 0;
  private fireCd = 0;
  private best = 0;
  private score = 0;
  private kills = 0;
  private levels: Record<string, number> = {};
  private choices: UpgradeDef[] = [];
  private overShown = false;
  private deathSlow = 0;
  private pausedFrom: State = "playing";
  private hudAcc = 0;
  private prevDashCount = 0;
  private muzzleLightDecay = 0;

  // missile volley state
  private readonly maxMissiles = 10;
  private mx = new Float32Array(this.maxMissiles);
  private mz = new Float32Array(this.maxMissiles);
  private mvx = new Float32Array(this.maxMissiles);
  private mvz = new Float32Array(this.maxMissiles);
  private mT = new Int32Array(this.maxMissiles);
  private mLife = new Float32Array(this.maxMissiles);
  private mDmg = new Float32Array(this.maxMissiles);
  private mCur = 0;
  private lockIndices = new Int32Array(this.maxMissiles);
  private lockCount = 0;
  private lockTickAcc = 0;

  private aim = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private spawnType = new Uint8Array(40);
  private spawnX = new Float32Array(40);
  private spawnZ = new Float32Array(40);

  private stats: HudStats = {
    hp: 100, maxHp: 100, wave: 1, score: 0, enemies: 0,
    lockCount: 0, missileCd: 1, fps: 60, quality: "high", backend: "webgl2", muted: false,
  };

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.snap = this.input.poll();
    this.userTier = loadUserTier();
    this.quality = QUALITY_PRESETS[this.userTier ?? detectTier()];
    this.best = loadBest();

    this.hudRoot = document.createElement("div");
    this.hudRoot.className = "game-hud";
    document.body.appendChild(this.hudRoot);
    this.hud = new Hud(this.hudRoot);

    this.menusRoot = document.createElement("div");
    this.menusRoot.className = "game-hud";
    document.body.appendChild(this.menusRoot);
    this.menus = new Menus(this.menusRoot, {
      onStart: () => this.startRun(),
      onUpgradePick: (id) => this.applyUpgrade(id),
      onRestart: () => this.startRun(),
      onResume: () => this.togglePause(),
      onQuality: (t) => this.setQuality(t, true),
      onToggleMute: () => this.toggleMute(),
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const game = new Game(canvas);
    await game.initGraphics();
    game.ready();
    return game;
  }

  private async initGraphics(): Promise<void> {
    this.world = await SceneWorld.create(this.canvas, this.quality);
    this.walker = new Walker(this.world.scene);
    this.post = new PostStack(this.world.renderer, this.world.scene, this.world.camera);
    this.post.setQuality(this.quality);
    this.fx = new BattleFX(this.world.scene, this.quality);
    const caps = [
      Math.ceil(this.quality.maxEnemies * 0.5),
      Math.ceil(this.quality.maxEnemies * 0.22),
      Math.ceil(this.quality.maxEnemies * 0.14),
      Math.ceil(this.quality.maxEnemies * 0.1),
      2,
    ];
    this.view = new EnemiesView(this.world.scene, caps);

    this.scaler = new AutoScaler(this.quality.tier, this.userTier === null, "ultra");
    this.scaler.onChange = (t) => this.setQuality(t, false);

    this.input.attach();
    this.input.uiActive = true;

    this.engine = new Engine(
      (dt) => this.step(dt),
      (alpha, dt) => this.render(alpha, dt),
    );
    this.engine.onFrameEnd = (fps) => this.scaler.update(fps, 1 / 60);

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private ready(): void {
    this.onResize();
    this.menus.setQualityOptions(this.quality.tier);
    this.menus.showTitle(this.best);
    this.rig.enterTitle(this.player.x, this.player.z);
  }

  private onVisibility = (): void => {
    if (document.hidden && (this.state === "playing" || this.state === "intermission")) this.togglePause();
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.resize(w, h);
    this.post.setSize(w, h);
  };

  start(): void { this.engine.start(); }

  dispose(): void {
    this.engine.stop();
    this.input.detach();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.hud.dispose();
    this.menus.dispose();
    this.hudRoot.remove();
    this.menusRoot.remove();
    this.world.dispose();
  }

  private setQuality(tier: QualityTier, manual: boolean): void {
    this.quality = QUALITY_PRESETS[tier];
    if (manual) {
      saveUserTier(tier);
      this.scaler.setEnabled(false);
      this.userTier = tier;
    }
    this.world.setQuality(this.quality);
    this.post.setQuality(this.quality);
    this.fx.setQuality(this.quality);
    this.menus.setQualityOptions(tier);
  }

  private toggleMute(): void {
    this.audio.init();
    this.audio.setMuted(!this.audio.isMuted);
  }

  // ---------- run flow ----------

  private startRun(): void {
    this.rng = new Rng((Math.random() * 0xffffffff) >>> 0);
    this.player.reset();
    this.shells.reset();
    this.enemies.reset();
    this.mLife.fill(0);
    this.waves.begin(1);
    this.score = 0;
    this.kills = 0;
    this.levels = {};
    this.overShown = false;
    this.state = "playing";
    this.engine.timeScale = 1;
    this.engine.hitstop = 0;
    this.post.params.desat = 0;
    this.post.params.flash = 0;
    this.input.uiActive = false;
    this.menus.hideTitle();
    this.menus.hideGameOver();
    this.menus.hideUpgrades();
    this.menus.hidePause();
    this.hud.setVisible(true);
    this.rig.reset(this.player.x, this.player.z);
    this.audio.init();
    this.audio.launch();
    this.audio.waveStart(1);
  }

  private applyUpgrade(id: string): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def || this.state !== "intermission") return;
    def.apply(this.player.stats);
    if (id === "hull") {
      this.player.maxHp = Math.min(200, 100 + (this.levels["hull"] ?? 1) * 25);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
    } else if (id === "nano") {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.player.maxHp - this.player.hp) * 0.5);
    }
    this.levels[id] = (this.levels[id] ?? 0) + 1;
    this.menus.hideUpgrades();
    this.state = "playing";
    this.engine.timeScale = 1;
    this.waves.begin(this.waves.wave + 1);
    this.audio.uiConfirm();
    this.audio.waveStart(this.waves.wave);
    this.hud.showBanner(
      this.waves.isBoss ? "COLOSSUS INBOUND" : `WAVE ${this.waves.wave}`,
      this.waves.isBoss ? "KILL THE QUADRUPED" : "HOLD THE LINE",
      2.4,
    );
  }

  private togglePause(): void {
    if (this.state === "playing" || this.state === "intermission") {
      this.pausedFrom = this.state;
      this.state = "paused";
      this.engine.timeScale = 0;
      this.menus.showPause();
      this.input.uiActive = true;
    } else if (this.state === "paused") {
      this.state = this.pausedFrom;
      this.engine.timeScale = this.pausedFrom === "intermission" ? 0.13 : 1;
      this.menus.hidePause();
      this.input.uiActive = false;
    }
  }

  private gameOver(): void {
    if (this.state === "gameover") return;
    this.state = "gameover";
    this.engine.hitstop = 0.22;
    this.deathSlow = 1.3;
    this.overShown = false;
    this.engine.timeScale = 0.3;
    this.post.params.desat = 0.55;
    this.input.uiActive = true;
    this.audio.gameOver();
    let record = false;
    if (this.score > this.best) {
      this.best = this.score;
      record = true;
      saveBest(this.best);
    }
    this.pendingRecord = record;
  }
  private pendingRecord = false;

  // ---------- fixed-step sim ----------

  private step(dt: number): void {
    const s = this.snap;
    const p = this.player;

    switch (this.state) {
      case "title":
        break;

      case "playing": {
        this.updateAim();
        const dashStarted = p.step(dt, s.moveX, s.moveZ, s.dashPressed);
        if (dashStarted) {
          this.rig.addTrauma(0.12);
          this.rig.kickFov(4);
          this.audio.dash();
        }

        // cannon
        this.fireCd -= dt;
        if (s.fireHeld && this.fireCd <= 0) {
          this.fireCd = 0.18 / p.stats.fireRateMul;
          this.fireCannon();
        }

        // hydra lock + volley
        if (s.missileHeld) this.updateLock();
        else if (this.lockCount > 0) this.hud.setLocking(false);
        if (s.missileReleased && this.lockCount > 0) this.fireMissiles();

        // world sims
        this.enemies.step(dt, p.x, p.z);
        this.shells.step(dt);
        this.resolveShellHits();
        this.stepMissiles(dt);

        // events: contact damage (per-archetype) + spitter/colossus bolts
        for (let e = 0; e < this.enemies.evCount; e++) {
          const et = this.enemies.evType[e];
          const ex = this.enemies.evX[e];
          const ez = this.enemies.evZ[e];
          if (et === EV_CONTACT) {
            if (p.damage(this.enemies.evDmg[e])) {
              this.hud.flashDamage();
              this.rig.addTrauma(0.34);
              this.audio.hurt();
              this.post.chromaBoostPulse(0.005);
            }
          } else if (et === EV_SPIT) {
            this.shells.spawnBolt(ex, ez, this.enemies.evDx[e], this.enemies.evDz[e], this.enemies.evDmg[e], 14);
            this.fx.boltGlow(ex, 1.1, ez);
          }
        }
        // bolt hits vs player
        for (let i = 0; i < this.shells.maxB; i++) {
          if (this.shells.bLife[i] <= 0) continue;
          const dx = this.shells.bx[i] - p.x;
          const dz = this.shells.bz[i] - p.z;
          if (dx * dx + dz * dz < 1.0) {
            this.shells.killBolt(i);
            if (p.damage(9)) {
              this.hud.flashDamage();
              this.rig.addTrauma(0.28);
              this.audio.hurt();
              this.fx.impact(this.shells.bx[i], 1.2, this.shells.bz[i], false);
            }
          }
        }

        // kills -> juice + score
        if (this.enemies.killedCount > 0) {
          for (let k = 0; k < this.enemies.killedCount; k++) {
            const i = this.enemies.killed[k];
            this.kills++;
            this.score += Math.round(25 * p.stats.scoreMul);
            this.fx.explosion(this.enemies.x[i], 0.8, this.enemies.z[i], 1);
            this.audio.explosion(1);
          }
          const n = Math.min(this.enemies.killedCount, 5);
          this.engine.hitstop = 0.03 + 0.008 * n;
          this.rig.addTrauma(0.14 + 0.03 * n);
          const v = this.tmpV.set(p.x, 1.4, p.z).project(this.world.camera);
          this.post.pulseBlast((v.x + 1) / 2, (v.y + 1) / 2, 0.12 + n * 0.008, 0.8);
          this.enemies.clearKilled();
        }

        // wave flow
        const n = this.waves.step(dt, this.rng, this.spawnType, this.spawnX, this.spawnZ);
        for (let k = 0; k < n; k++) {
          this.enemies.spawn(this.spawnType[k], this.spawnX[k], this.spawnZ[k], 1 + (this.waves.wave - 1) * 0.08, this.rng);
        }
        if (this.waves.exhausted && this.enemies.count <= 0) {
          this.state = "intermission";
          this.engine.timeScale = 0.13;
          this.choices = rollChoices(this.rng, this.levels, 3);
          const cards: UpgradeCardView[] = this.choices.map((c) => ({
            id: c.id, name: c.name, desc: c.desc,
            level: this.levels[c.id] ?? 0, maxLevel: c.maxLevel,
          }));
          this.menus.showUpgrades(cards, this.waves.wave);
        }

        if (p.hp <= 0) this.gameOver();
        break;
      }

      case "intermission":
        this.updateAim();
        p.step(dt, s.moveX, s.moveZ, false);
        this.enemies.step(dt, p.x, p.z);
        this.shells.step(dt);
        break;

      case "gameover":
        p.step(dt, s.moveX * 0.2, s.moveZ * 0.2, false);
        this.enemies.step(dt, p.x, p.z);
        break;

      case "paused":
        break;
    }

    this.audio.update(dt);
  }

  private updateAim(): void {
    const s = this.snap;
    const cam = this.world.camera;
    this.tmpV.set(s.ndcX, s.ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = (1.6 - cam.position.y) / this.tmpV.y;
    if (t > 0 && isFinite(t)) {
      this.aim.copy(cam.position).addScaledVector(this.tmpV, t);
    }
  }

  private fireCannon(): void {
    const p = this.player;
    this.walker.kickRecoil(0.55);
    this.walker.muzzle.getWorldPosition(this.tmpV);
    const mx = this.tmpV.x;
    const my = this.tmpV.y;
    const mz = this.tmpV.z;
    let dx = this.aim.x - mx;
    let dz = this.aim.z - mz;
    const l = Math.hypot(dx, dz) + 1e-5;
    dx /= l; dz /= l;
    // slight spread
    const sp = (this.rng.next() - 0.5) * 0.024;
    const c = Math.cos(sp);
    const sn = Math.sin(sp);
    const rdx = dx * c - dz * sn;
    const rdz = dx * sn + dz * c;
    this.shells.spawnShell(mx, mz, rdx, rdz, 12 * p.stats.damageMul, p.stats.pierce ?? 0);
    this.fx.muzzleFlash(mx, my, mz, rdx, rdz);
    this.world.muzzleLight.position.set(mx, my, mz);
    this.world.muzzleLight.intensity = 30;
    this.muzzleLightDecay = 1;
    this.rig.addTrauma(0.05);
    this.audio.cannon();
  }

  private updateLock(): void {
    const p = this.player;
    let ax = this.aim.x - p.x;
    let az = this.aim.z - p.z;
    const al = Math.hypot(ax, az) + 1e-5;
    ax /= al; az /= al;
    // acquire targets in a cone toward the aim direction
    const range2 = p.stats.lockRange * p.stats.lockRange;
    const cand: number[] = [];
    const score = new Map<number, number>();
    for (let i = 0; i < this.enemies.max; i++) {
      if (!this.enemies.alive[i]) continue;
      const dx = this.enemies.x[i] - p.x;
      const dz = this.enemies.z[i] - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > range2) continue;
      const dotv = (dx * ax + dz * az) / (Math.sqrt(d2) + 1e-5);
      if (dotv < 0.5) continue;
      cand.push(i);
      score.set(i, d2 * (2 - dotv));
    }
    cand.sort((a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0));
    const want = Math.min(p.stats.missileCount, cand.length);
    if (want > this.lockCount) {
      const now = performance.now();
      if (now - this.lockTickAcc > 90) {
        this.lockTickAcc = now;
        this.audio.lockTick(this.lockCount);
      }
    }
    this.lockCount = want;
    for (let k = 0; k < want; k++) this.lockIndices[k] = cand[k];
    this.hud.setLocking(want > 0);
  }

  private fireMissiles(): void {
    const p = this.player;
    let launched = 0;
    for (let k = 0; k < this.lockCount; k++) {
      let slot = -1;
      for (let n = 0; n < this.maxMissiles; n++) {
        const i = (this.mCur + n) % this.maxMissiles;
        if (this.mLife[i] <= 0) { slot = i; this.mCur = (i + 1) % this.maxMissiles; break; }
      }
      if (slot < 0) break;
      const target = this.lockIndices[k];
      const a = this.rng.angle();
      this.mx[slot] = p.x + Math.cos(a) * 1.2;
      this.mz[slot] = p.z + Math.sin(a) * 1.2;
      this.mvx[slot] = Math.cos(a) * 10;
      this.mvz[slot] = Math.sin(a) * 10;
      this.mT[slot] = this.enemies.alive[target] ? target : -1;
      this.mLife[slot] = 3.4;
      this.mDmg[slot] = 26 * p.stats.missileDmgMul;
      launched++;
    }
    if (launched > 0) {
      this.audio.missiles();
      this.rig.addTrauma(0.1);
    }
    this.lockCount = 0;
    this.hud.setLocking(false);
  }

  private stepMissiles(dt: number): void {
    for (let i = 0; i < this.maxMissiles; i++) {
      if (this.mLife[i] <= 0) continue;
      this.mLife[i] -= dt;
      const t = this.mT[i];
      if (t >= 0 && this.enemies.alive[t]) {
        // steer toward target
        const dx = this.enemies.x[t] - this.mx[i];
        const dz = this.enemies.z[t] - this.mz[i];
        const want = Math.atan2(dz, dx);
        const cur = Math.atan2(this.mvz[i], this.mvx[i]);
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const na = cur + Math.sign(d) * Math.min(Math.abs(d), MISSILE_TURN * dt);
        const sp = Math.min(MISSILE_SPEED, Math.hypot(this.mvx[i], this.mvz[i]) + 40 * dt);
        this.mvx[i] = Math.cos(na) * sp;
        this.mvz[i] = Math.sin(na) * sp;
      }
      this.mx[i] += this.mvx[i] * dt;
      this.mz[i] += this.mvz[i] * dt;
      if (Math.random() < 0.6) this.fx.missileTrail(this.mx[i], 1.1, this.mz[i]);

      // hit vs target or any enemy
      let hit = -1;
      for (let j = 0; j < this.enemies.max && hit < 0; j++) {
        if (!this.enemies.alive[j]) continue;
        const dx = this.enemies.x[j] - this.mx[i];
        const dz = this.enemies.z[j] - this.mz[i];
        if (dx * dx + dz * dz < 1.6) hit = j;
      }
      if (hit >= 0 || this.mLife[i] <= 0) {
        // AoE
        for (let j = 0; j < this.enemies.max; j++) {
          if (!this.enemies.alive[j]) continue;
          const dx = this.enemies.x[j] - this.mx[i];
          const dz = this.enemies.z[j] - this.mz[i];
          const d2 = dx * dx + dz * dz;
          if (d2 < MISSILE_AOE * MISSILE_AOE) {
            this.enemies.damageFrom(j, this.mDmg[i] * (0.7 + 0.3 * (1 - Math.sqrt(d2) / MISSILE_AOE)), this.mx[i], this.mz[i]);
          }
        }
        this.fx.explosion(this.mx[i], 0.9, this.mz[i], 1.4);
        this.audio.explosion(1.4);
        this.rig.addTrauma(0.1);
        this.mLife[i] = 0;
      }
    }
    if (this.enemies.killedCount > 0) {
      for (let k = 0; k < this.enemies.killedCount; k++) {
        const i = this.enemies.killed[k];
        this.kills++;
        this.score += Math.round(25 * this.player.stats.scoreMul);
        this.fx.explosion(this.enemies.x[i], 0.8, this.enemies.z[i], 1);
        this.audio.explosion(1);
      }
      this.engine.hitstop = Math.min(0.06, 0.03 + 0.006 * this.enemies.killedCount);
      this.rig.addTrauma(0.1 + 0.03 * Math.min(5, this.enemies.killedCount));
      this.enemies.clearKilled();
    }
  }

  private resolveShellHits(): void {
    const sh = this.shells;
    const en = this.enemies;
    for (let i = 0; i < sh.maxS; i++) {
      if (sh.sLife[i] <= 0) continue;
      for (let j = 0; j < en.max; j++) {
        if (!en.alive[j]) continue;
        const dx = en.x[j] - sh.sx[i];
        const dz = en.z[j] - sh.sz[i];
        if (dx * dx + dz * dz < 1.0) {
          en.damageFrom(j, sh.sDmg[i], sh.sx[i], sh.sz[i]);
          this.fx.impact(sh.sx[i], 1.0, sh.sz[i], false);
          this.audio.hit();
          if (sh.sPierce[i] > 0) {
            sh.sPierce[i]--;
          } else {
            sh.killShell(i);
            break;
          }
        }
      }
    }
  }

  // ---------- per-frame render ----------

  private render(alpha: number, dt: number): void {
    void alpha;
    const s = this.input.poll();
    this.snap = s;
    this.time += dt;

    if (this.state === "title" && s.confirmPressed) this.startRun();
    else if (this.state === "gameover" && this.overShown && (s.restartPressed || s.confirmPressed)) this.startRun();
    else if (this.state === "intermission" && (s.pausePressed || s.confirmPressed) === false && s.pausePressed) this.togglePause();
    else if (s.pausePressed && (this.state === "playing" || this.state === "intermission" || this.state === "paused")) this.togglePause();

    if (this.state === "gameover") {
      this.deathSlow -= dt;
      if (this.deathSlow <= 0 && !this.overShown) {
        this.overShown = true;
        this.engine.timeScale = 0.05;
        this.menus.showGameOver(this.score, this.waves.wave, this.kills, this.best, this.pendingRecord);
      }
    }

    const p = this.player;
    this.rig.update(dt, this.world.camera, p.x, p.z, this.aim.x, this.aim.z, p.dashTimer > 0);
    this.walker.update(
      dt, p.x, p.z, p.hullAngle,
      Math.atan2(this.aim.x - p.x, this.aim.z - p.z),
      p.moving, s.fireHeld,
    );
    this.view.sync(this.enemies, this.time);
    this.fx.update(dt);
    this.world.update(dt, p.x, p.z, Math.min(1, this.enemies.count / 14));

    // muzzle light decay
    if (this.muzzleLightDecay > 0) {
      this.muzzleLightDecay -= dt * 5;
      this.world.muzzleLight.intensity *= Math.exp(-14 * dt);
      if (this.muzzleLightDecay <= 0) this.world.muzzleLight.intensity = 0;
    }

    this.projectilesViewSync();

    this.hud.tick(dt);
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) {
      this.hudAcc = 0;
      const st = this.stats;
      st.hp = Math.max(0, p.hp);
      st.maxHp = p.maxHp;
      st.wave = this.waves.wave;
      st.score = this.score;
      st.enemies = this.enemies.count;
      st.lockCount = this.lockCount;
      const dashFrac = 1 - Math.max(0, p.dashCd) / 1.6;
      st.missileCd = dashFrac;
      st.fps = this.engine.fps;
      st.quality = this.quality.tier;
      st.backend = this.world.backendName;
      st.muted = this.audio.isMuted;
      this.hud.setStats(st, dt);
      let bossFrac = -1;
      for (let i = 0; i < this.enemies.max; i++) {
        if (this.enemies.alive[i] && this.enemies.type[i] === 4) {
          bossFrac = this.enemies.hp[i] / Math.max(1, this.enemies.hpMax[i]);
          break;
        }
      }
      this.hud.setBoss(bossFrac);
    }

    this.post.render(dt, this.time);
  }

  // shell tracers + enemy bolts live visuals (instanced)
  private shellMesh: THREE.InstancedMesh | null = null;
  private boltMesh: THREE.InstancedMesh | null = null;
  private m4 = new THREE.Matrix4();
  private qq = new THREE.Quaternion();
  private ee = new THREE.Euler();
  private vv = new THREE.Vector3();
  private ss = new THREE.Vector3();

  private projectilesViewSync(): void {
    const sh = this.shells;
    if (!this.shellMesh) {
      const g = new THREE.BoxGeometry(0.07, 0.07, 1.6);
      const mat = new THREE.MeshBasicNodeMaterial({
        colorNode: vec4(vec3(1.6, 0.9, 0.4), 1),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      this.shellMesh = new THREE.InstancedMesh(g, mat, sh.maxS);
      this.shellMesh.frustumCulled = false;
      this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.world.scene.add(this.shellMesh);
    }
    if (!this.boltMesh) {
      const g = new THREE.SphereGeometry(0.16, 8, 6);
      const mat = new THREE.MeshBasicNodeMaterial({
        colorNode: vec4(vec3(2.2, 0.5, 0.2), 1),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      this.boltMesh = new THREE.InstancedMesh(g, mat, sh.maxB);
      this.boltMesh.frustumCulled = false;
      this.boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.world.scene.add(this.boltMesh);
    }

    let n = 0;
    for (let i = 0; i < sh.maxS && n < sh.maxS; i++) {
      if (sh.sLife[i] <= 0) continue;
      const yaw = Math.atan2(sh.svx[i], sh.svz[i]);
      this.ee.set(0, yaw, 0);
      this.qq.setFromEuler(this.ee);
      this.vv.set(sh.sx[i], 1.05, sh.sz[i]);
      this.ss.set(1, 1, 1);
      this.m4.compose(this.vv, this.qq, this.ss);
      this.shellMesh.setMatrixAt(n++, this.m4);
    }
    this.shellMesh.count = n;
    if (n > 0) this.shellMesh.instanceMatrix.needsUpdate = true;

    let b = 0;
    for (let i = 0; i < sh.maxB && b < sh.maxB; i++) {
      if (sh.bLife[i] <= 0) continue;
      this.vv.set(sh.bx[i], 1.15, sh.bz[i]);
      this.ss.setScalar(1 + Math.sin(this.time * 22 + i) * 0.15);
      this.m4.compose(this.vv, this.qq, this.ss);
      this.boltMesh.setMatrixAt(b++, this.m4);
    }
    this.boltMesh.count = b;
    if (b > 0) this.boltMesh.instanceMatrix.needsUpdate = true;
  }
}
