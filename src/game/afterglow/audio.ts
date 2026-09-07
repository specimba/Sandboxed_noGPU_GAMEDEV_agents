import { AudioEngine } from '../audio';
import type { AfterglowEvents, FoeKind, Sim } from './sim';

/**
 * AFTERGLOW audio adapter (Task 14-d) — the ONLY bridge between the sim's
 * event stream and the fully synthesized AudioEngine (src/game/audio.ts).
 *
 * Design laws:
 * - CHAIN, never clobber: the engine layer assigns its fx/HUD handlers when
 *   the Sim is constructed; attach() wraps each handler so the original fires
 *   first and the audio side-effect second.
 * - Pure-notification respect: the adapter never writes to sim state; it only
 *   reads public fields (time, player, foes) inside update().
 * - Audio can NEVER crash the game loop: every entry point is wrapped in
 *   try/catch and no-ops cleanly when WebAudio is unavailable or suspended
 *   (headless bun included).
 * - Zero allocation in update(): for-of scans, precomputed constants, a
 *   persistent windup-id Set, no closures or arrays.
 */

/** global kill switch — every adapter entry point no-ops while this is off */
let enabled = true;

export function setAfterglowAudioEnabled(on: boolean): void {
  enabled = on;
}

/** QA/self-test counters (per run; reset by attach() and on run restart) */
export interface AfterglowAudioCounts {
  volley: number;
  foeHurt: number;
  kill: number;
  huskKill: number;
  hurt: number;
  dash: number;
  waveStart: number;
  waveClear: number;
  draftOffer: number;
  draftPick: number;
  pickup: number;
  scream: number;
  heartbeat: number;
  death: number;
}

export interface AfterglowAudioAttachOpts {
  /** share an existing AudioEngine instead of owning one (rarely needed) */
  engine?: AudioEngine;
}

/** foes within this radius of the player count as "nearby" for the danger curve */
const THREAT_RADIUS = 7;
const THREAT_R2 = THREAT_RADIUS * THREAT_RADIUS;

const PEW_MIN_GAP = 0.07; // volley rate limit (spec)
const SCREAM_MIN_GAP = 0.35; // simultaneous husk windups share one scream
const HUSK_KILL_MIN_GAP = 0.5; // the heavy husk-death thump, not a stampede
const BEAT_PERIOD = 1.1; // low-HP heartbeat period (spec)
const DANGER_PERIOD = 0.25; // setDanger automation spam guard (4Hz)
const HOVER_MIN_MS = 60; // draft card hover tick (UI clock, not sim clock)

export class AfterglowAudio {
  private engine: AudioEngine;
  private attached: Sim | null = null;

  /** public for QA hooks / self-tests */
  readonly counts: AfterglowAudioCounts = {
    volley: 0,
    foeHurt: 0,
    kill: 0,
    huskKill: 0,
    hurt: 0,
    dash: 0,
    waveStart: 0,
    waveClear: 0,
    draftOffer: 0,
    draftPick: 0,
    pickup: 0,
    scream: 0,
    heartbeat: 0,
    death: 0,
  };

  // rate limits + schedulers on the SIM clock (deterministic + headless-safe)
  private moteN = 0; // pickup ladder counter (AudioEngine owns the 1.5s window)
  private lastPewT = -10;
  private lastScreamT = -10;
  private lastHuskKillT = -10;
  private lastBeatT = -10;
  private lastDangerT = -10;
  private clock = -10; // last seen sim.time, for run-restart detection
  private windups = new Set<number>(); // foe ids currently in windup
  private lastHoverMs = 0; // hover() may fire before any sim runs — wall clock

  constructor(engine?: AudioEngine) {
    this.engine = engine ?? new AudioEngine();
  }

  /** call once from the BEGIN/KINDLE button gesture (creates/resumes the context) */
  unlock(): void {
    if (!enabled) return;
    try {
      this.engine.unlock();
    } catch {
      /* no WebAudio here (headless / blocked) — stay silent */
    }
  }

  /**
   * subscribe to a sim's event stream. Existing handlers (fx bursts, HUD
   * pushes, harness counters) are preserved and called FIRST. Call again for
   * each new Sim — the engine layer builds a fresh events object per run.
   */
  attach(sim: Sim, opts?: AfterglowAudioAttachOpts): void {
    if (opts?.engine) this.engine = opts.engine;
    this.attached = sim;
    this.resetRun();
    const ev = sim.events as AfterglowEvents;

    const prevFoeDie = ev.onFoeDie;
    ev.onFoeDie = (kind: FoeKind, x: number, z: number) => {
      prevFoeDie?.(kind, x, z);
      try {
        this.counts.kill++;
        this.engine.kill();
        if (kind === 'husk' && sim.time - this.lastHuskKillT >= HUSK_KILL_MIN_GAP) {
          this.lastHuskKillT = sim.time;
          this.counts.huskKill++;
          this.engine.wardenDie(); // extra heavy low thump for the big shell
        }
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevHurt = ev.onHurt;
    ev.onHurt = (x: number, z: number, hp: number) => {
      prevHurt?.(x, z, hp);
      try {
        this.counts.hurt++;
        this.engine.hurt();
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevDash = ev.onDash;
    ev.onDash = (x: number, z: number) => {
      prevDash?.(x, z);
      try {
        this.counts.dash++;
        this.engine.dash();
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevWaveStart = ev.onWaveStart;
    ev.onWaveStart = (n: number) => {
      prevWaveStart?.(n);
      try {
        this.counts.waveStart++;
        this.engine.waveStart(n);
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevWaveClear = ev.onWaveClear;
    ev.onWaveClear = (n: number) => {
      prevWaveClear?.(n);
      try {
        this.counts.waveClear++;
        this.engine.waveClear();
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevDraftOffer = ev.onDraftOffer;
    ev.onDraftOffer = (n: number, choices: string[]) => {
      prevDraftOffer?.(n, choices);
      try {
        this.counts.draftOffer++;
        this.engine.uiClick(); // soft chime under the overlay
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevDraftPick = ev.onDraftPick;
    ev.onDraftPick = (id: string) => {
      prevDraftPick?.(id);
      try {
        this.counts.draftPick++;
        this.engine.draftPick();
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevDeath = ev.onDeath;
    ev.onDeath = (x: number, z: number, wave: number, kills: number, light: number) => {
      prevDeath?.(x, z, wave, kills, light);
      try {
        this.counts.death++;
        this.engine.death();
      } catch {
        /* audio must never crash the game loop */
      }
    };

    // onPickup carries no args — the ladder is a local run counter; the
    // AudioEngine restarts it itself after a 1.5s gap and rate-limits bursts.
    const prevPickup = ev.onPickup;
    ev.onPickup = () => {
      prevPickup?.();
      try {
        this.counts.pickup++;
        this.engine.moteTick(this.moteN++);
      } catch {
        /* audio must never crash the game loop */
      }
    };

    // Extensible per-hit mapping — intentionally silent by default (impact
    // sounds are a later juice pass). Burn ticks arrive here too and are
    // simply ignored by the table until burn audio is wanted.
    const prevFoeHurt = ev.onFoeHurt;
    ev.onFoeHurt = (kind: FoeKind, x: number, z: number, dmg: number, src: 'bolt' | 'chain' | 'burn') => {
      prevFoeHurt?.(kind, x, z, dmg, src);
      try {
        this.counts.foeHurt++;
        switch (src) {
          case 'bolt':
          case 'chain':
          case 'burn':
          default:
            break; // no audio yet — add cases here as impact SFX land
        }
      } catch {
        /* audio must never crash the game loop */
      }
    };

    const prevVolley = ev.onVolley;
    ev.onVolley = (x: number, z: number, angle: number) => {
      prevVolley?.(x, z, angle);
      try {
        this.counts.volley++;
        if (sim.time - this.lastPewT < PEW_MIN_GAP) return;
        this.lastPewT = sim.time;
        this.engine.pew();
      } catch {
        /* audio must never crash the game loop */
      }
    };

    // onSpawn / onMote / onPillar stay untouched (no audio mapping in 14-b P0)

    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__agAudio = this;
    }
  }

  /** draft card hover — exposed for the DraftOverlay (rate-limited on wall clock) */
  hover(): void {
    if (!enabled) return;
    const now = Date.now();
    if (now - this.lastHoverMs < HOVER_MIN_MS) return;
    this.lastHoverMs = now;
    try {
      this.engine.draftHover();
    } catch {
      /* audio must never crash the game loop */
    }
  }

  /** route the store's muted boolean down to the engine (store owns the truth) */
  setMuted(muted: boolean): void {
    try {
      this.engine.setMuted(muted);
    } catch {
      /* audio must never crash the game loop */
    }
  }

  /**
   * per-frame driver — call once per rendered frame with the active sim:
   * 1. husk telegraph: huskScream() once per windup START (rate-limited)
   * 2. low-HP heartbeat: every ~1.1s while hp/maxHp < 0.3
   * 3. danger drone: setDanger(0.5*nearbyFoes/6 + 0.5*(1-hpFrac)), 4Hz
   */
  update(sim: Sim): void {
    if (!enabled) return;
    try {
      // run restart: a fresh run rewinds the sim clock
      if (sim.time + 0.25 < this.clock) this.resetRun();
      this.clock = sim.time;

      const p = sim.player;
      const hpFrac = p.maxHp > 0 ? p.hp / p.maxHp : 0;
      let nearby = 0;

      for (const f of sim.foes) {
        if (f.state === 'windup') {
          if (!this.windups.has(f.id)) {
            this.windups.add(f.id);
            if (sim.time - this.lastScreamT >= SCREAM_MIN_GAP) {
              this.lastScreamT = sim.time;
              this.counts.scream++;
              this.engine.huskScream();
            }
          }
        } else {
          this.windups.delete(f.id);
        }
        if (f.state === 'spawn') continue; // spawn-ramping foes are not threats yet
        const dx = f.x - p.x;
        const dz = f.z - p.z;
        if (dx * dx + dz * dz <= THREAT_R2) nearby++;
      }
      if (this.windups.size > 64) this.windups.clear(); // died-mid-windup leak guard

      if (this.clock - this.lastDangerT >= DANGER_PERIOD) {
        this.lastDangerT = this.clock;
        const level = Math.min(1, Math.max(0, 0.5 * (nearby / 6) + 0.5 * (1 - hpFrac)));
        this.engine.setDanger(level);
      }

      if (hpFrac > 0 && hpFrac < 0.3) {
        if (sim.time - this.lastBeatT >= BEAT_PERIOD) {
          this.lastBeatT = sim.time;
          this.counts.heartbeat++;
          this.engine.heartbeat();
        }
      } else {
        this.lastBeatT = -10; // re-entering danger beats immediately
      }
    } catch {
      /* audio must never crash the game loop */
    }
  }

  /** release the underlying engine (orchestrator teardown) */
  dispose(): void {
    try {
      this.engine.dispose();
    } catch {
      /* already gone */
    }
    this.attached = null;
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__agAudio === this) {
      delete (window as unknown as Record<string, unknown>).__agAudio;
    }
  }

  /** QA hook: which sim is currently attached (null after dispose) */
  get sim(): Sim | null {
    return this.attached;
  }

  private resetRun(): void {
    this.moteN = 0;
    this.lastPewT = -10;
    this.lastScreamT = -10;
    this.lastHuskKillT = -10;
    this.lastBeatT = -10;
    this.lastDangerT = -10;
    this.clock = -10;
    this.windups.clear();
    for (const k of Object.keys(this.counts) as (keyof AfterglowAudioCounts)[]) {
      this.counts[k] = 0;
    }
  }
}
