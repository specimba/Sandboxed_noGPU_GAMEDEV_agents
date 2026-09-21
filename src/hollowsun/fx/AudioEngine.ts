import { EV, type SimEvent, type Snap } from "@/hollowsun/types";

/**
 * HOLLOW SUN — procedural audio engine (DESIGN_C §11, zero assets).
 *
 * Master: DynamicsCompressor (threshold −10dB, ratio 12) -> gain 0.5 -> destination.
 * Buses:  music 0.5 (drone + kick, ducked −3dB in Overdrive) / sfx 0.9.
 * Drone:  2 detuned saws 55 / 55.5 Hz -> lowpass 300 + 900·sun -> gain 0.05.
 * Beat:   kick sine 120→40Hz (0.1s), gain decay 0.25s, interval 1.0s → 0.45s by wave 10.
 * SFX:    launch zap · ricochet = A-minor-pentatonic step per chain (reset per chain
 *         by the sim's chain count) · kill noise burst + sine drop 200→60 · graze
 *         tick+shimmer · dash whoosh · hurt distorted boom · wave clear chord ·
 *         bossdie sub-drop implode · pickup chime · sunrank rising chord ·
 *         overdrive minor-pentatonic 16th arp.
 *
 * Lazy AudioContext: nothing is created until unlock() (Game calls it on the first
 * user gesture). Every node creation is guarded + try/catch; the ONLY scheduler is
 * update(dt, snap) on the AudioContext clock (no setInterval/setTimeout). Every
 * one-shot node is stopped + disconnected via onended.
 */

const MUSIC_LVL = 0.5;
const SFX_LVL = 0.9;
const MASTER_LVL = 0.5;
const OD_DUCK = Math.pow(10, -3 / 20); // −3 dB
const LOOKAHEAD = 0.14;
const SFX_BUDGET = 20;

/** A minor pentatonic from A3, ~2.5 octaves (chain index -> pitch). */
const PENT_SEMIS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
/** Overdrive arp pattern (pentatonic indices), up-down shimmer. */
const ARP_SEQ = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];

function pentFreq(step: number): number {
  const i = Math.max(0, Math.min(PENT_SEMIS.length - 1, Math.round(step)));
  return 220 * Math.pow(2, PENT_SEMIS[i] / 12);
}

interface SfxVoice {
  out: GainNode;
  start: number;
  stop: number;
  killed: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private isMuted = false;
  private sfx: SfxVoice[] = [];
  private distCurve: Float32Array<ArrayBuffer> | null = null;

  // drone (long-lived)
  private droneOscs: OscillatorNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;

  // schedulers (AudioContext clock only)
  private kickNext = 0;
  private arpNext = 0;
  private arpStep = 0;
  private odWas = false;
  private musicFaded = false;

  // ---------- lifecycle ----------

  /** Create the context on first user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();

        // Master: compressor (-10dB, 12:1) -> gain 0.5 -> destination.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 8;
        comp.ratio.value = 12;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        const master = ctx.createGain();
        master.gain.value = this.isMuted ? 0 : MASTER_LVL;
        comp.connect(master).connect(ctx.destination);

        const music = ctx.createGain();
        music.gain.value = MUSIC_LVL;
        music.connect(comp);
        const sfx = ctx.createGain();
        sfx.gain.value = SFX_LVL;
        sfx.connect(comp);

        // Shared white-noise buffer (1s).
        const len = Math.max(1, Math.floor(ctx.sampleRate));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

        // Soft-clip curve for the HURT distortion.
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * 2 - 1;
          curve[i] = Math.tanh(4 * x);
        }

        this.ctx = ctx;
        this.master = master;
        this.musicBus = music;
        this.sfxBus = sfx;
        this.noiseBuf = buf;
        this.distCurve = curve;
        this.kickNext = ctx.currentTime + 0.1;
        this.arpNext = ctx.currentTime + 0.1;
        this.startDrone();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* audio unavailable — stay silent */
    }
  }

  setMuted(m: boolean): void {
    this.isMuted = m;
    if (this.master && this.ctx) {
      try {
        this.master.gain.setTargetAtTime(m ? 0 : MASTER_LVL, this.ctx.currentTime, 0.02);
      } catch {
        /* no-op */
      }
    }
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Event entry point (SimEvent ids per types.ts EV). No-op before unlock(). */
  handleEvent(ev: SimEvent): void {
    if (!this.ctx) return;
    switch (ev.type) {
      case EV.LAUNCH:
        this.sfxLaunch();
        break;
      case EV.RICOCHET:
        this.sfxRicochet(ev.a);
        break;
      case EV.KILL:
        this.sfxKill();
        break;
      case EV.GRAZE:
        this.sfxGraze();
        break;
      case EV.DASH:
        this.sfxDash();
        break;
      case EV.HURT:
        this.sfxHurt();
        break;
      case EV.WAVE:
        this.sfxWaveClear(ev.a);
        break;
      case EV.OVERDRIVE:
        this.sfxOverdriveOn();
        break;
      case EV.BOSSDIE:
        this.sfxBossdie();
        break;
      case EV.PICKUP:
        this.sfxPickup();
        break;
      case EV.SUNRANK:
        this.sfxSunrank(ev.a);
        break;
      case EV.DIE:
        this.sfxDie();
        break;
      default:
        break;
    }
  }

  /** The ONLY scheduler. Drives kick, overdrive arp, drone filter, voice GC. */
  update(dt: number, snap: Snap): void {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;

      // Tab-stall resync.
      if (dt > 0.2) {
        this.kickNext = now + 0.05;
        this.arpNext = now + 0.05;
      }

      // Voice GC.
      if (this.sfx.length > 0) this.sfx = this.sfx.filter((v) => v.stop > now - 0.05);

      // Drone filter opens with the sun: 300 + 900·sun.
      if (this.droneFilter) {
        this.droneFilter.frequency.setTargetAtTime(300 + 900 * Math.max(0, Math.min(1, snap.sun)), now, 0.2);
      }

      // Overdrive duck (−3 dB on the music bus).
      const od = snap.odActive;
      if (od !== this.odWas) {
        this.odWas = od;
        if (this.musicBus && !this.musicFaded) {
          const g = this.musicBus.gain;
          g.cancelScheduledValues(now);
          g.setTargetAtTime(MUSIC_LVL * (od ? OD_DUCK : 1), now, od ? 0.06 : 0.3);
        }
      }

      // Beat: kick 1.0s -> 0.45s by wave 10.
      if (snap.alive && !snap.runOver) {
        const w = Math.max(1, snap.wave);
        const beatInt = 1.0 - 0.55 * Math.min(1, Math.max(0, (w - 1) / 9));
        if (this.kickNext < now - 0.25) this.kickNext = now + 0.05;
        let guard = 0;
        while (this.kickNext < now + LOOKAHEAD && guard++ < 8) {
          this.kick(this.kickNext);
          this.kickNext += beatInt;
        }

        // Overdrive arp: minor-pentatonic 16ths (16ths of the current beat).
        if (od) {
          const stepInt = Math.max(0.055, beatInt / 4);
          if (this.arpNext < now - 0.25) this.arpNext = now + 0.02;
          let guard2 = 0;
          while (this.arpNext < now + LOOKAHEAD && guard2++ < 12) {
            this.arpNote(this.arpNext, ARP_SEQ[this.arpStep % ARP_SEQ.length]);
            this.arpStep++;
            this.arpNext += stepInt;
          }
        }
      }
    } catch {
      /* no-op */
    }
  }

  dispose(): void {
    try {
      for (const o of this.droneOscs) {
        try {
          o.stop();
          o.disconnect();
        } catch {
          /* no-op */
        }
      }
    } catch {
      /* no-op */
    }
    this.droneOscs.length = 0;
    this.droneFilter = null;
    this.droneGain = null;
    try {
      void this.ctx?.close();
    } catch {
      /* no-op */
    }
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noiseBuf = null;
    this.sfx.length = 0;
  }

  // ---------- long-lived layers ----------

  private startDrone(): void {
    if (!this.ctx || !this.musicBus || this.droneOscs.length > 0) return;
    try {
      const ctx = this.ctx;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 300;
      f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      f.connect(g).connect(this.musicBus);
      for (const hz of [55, 55.5]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz;
        o.connect(f);
        o.start();
        this.droneOscs.push(o);
      }
      this.droneFilter = f;
      this.droneGain = g;
    } catch {
      /* no-op */
    }
  }

  // ---------- music voices ----------

  private kick(t: number): void {
    if (!this.ctx || !this.musicBus) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); // 0.25s decay
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.28);
      o.onended = () => {
        try {
          o.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
    } catch {
      /* no-op */
    }
  }

  private arpNote(t: number, step: number): void {
    if (!this.ctx || !this.sfxBus) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.value = pentFreq(step);
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2600;
      f.Q.value = 0.7;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.085, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(f).connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + 0.1);
      o.onended = () => {
        try {
          o.disconnect();
          f.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
    } catch {
      /* no-op */
    }
  }

  /** Sustained Overdrive duck helper is in update(); this is a one-shot duck pulse. */
  private duckPulse(t: number, hold: number, depth = 0.45): void {
    if (!this.ctx || !this.musicBus || this.odWas || this.musicFaded) return;
    try {
      const g = this.musicBus.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(MUSIC_LVL, t);
      g.linearRampToValueAtTime(MUSIC_LVL * depth, t + 0.05);
      g.setValueAtTime(MUSIC_LVL * depth, t + 0.05 + hold);
      g.linearRampToValueAtTime(MUSIC_LVL, t + 0.05 + hold + 0.35);
    } catch {
      /* no-op */
    }
  }

  // ---------- SFX ----------

  private sfxLaunch(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.12);
    if (!v) return;
    const d = 1 + (Math.random() - 0.5) * 0.08;
    this.osc(v, "sawtooth", 1500 * d, 320 * d, t, 0.07, 0.15);
    this.noise(v, "highpass", 4200, 0.7, t, 0.03, 0.08);
  }

  /** Ricochet — pentatonic step per chain (a = chain count). */
  private sfxRicochet(chain: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const hz = pentFreq(Math.max(0, chain));
    const v = this.sfxOut(t, t + 0.2);
    if (!v) return;
    this.osc(v, "triangle", hz, hz, t, 0.14, 0.2);
    this.osc(v, "sine", hz * 2, hz * 2, t + 0.015, 0.1, 0.08);
    this.noise(v, "bandpass", 5000 + Math.random() * 1500, 1.4, t, 0.02, 0.06);
  }

  private sfxKill(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.35);
    if (!v) return;
    this.noise(v, "lowpass", 2000, 0.6, t, 0.15, 0.4, 260); // 0.15s burst
    this.osc(v, "sine", 200, 60, t + 0.01, 0.2, 0.45); // drop 200->60
    this.osc(v, "triangle", 90, 45, t + 0.02, 0.16, 0.2);
    this.duckPulse(t, 0.08, 0.7);
  }

  private sfxGraze(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.12);
    if (!v) return;
    this.osc(v, "square", 1850, 1850, t, 0.028, 0.1); // tick
    this.osc(v, "sine", 2500, 3400, t + 0.012, 0.07, 0.05); // shimmer
  }

  private sfxDash(): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.3);
    if (!v) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.1;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.11);
      f.frequency.exponentialRampToValueAtTime(650, t + 0.25);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      src.connect(f).connect(g).connect(v);
      src.start(t, Math.random() * 0.9);
      src.stop(t + 0.28);
      src.onended = () => {
        try {
          src.disconnect();
          f.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
    } catch {
      /* no-op */
    }
  }

  /** Hurt — low boom through soft-clip distortion + thud. */
  private sfxHurt(): void {
    if (!this.ctx || !this.sfxBus || !this.distCurve) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.55);
    if (!v) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(32, t + 0.38);
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.distCurve;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.55, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(shaper).connect(g).connect(v);
      o.start(t);
      o.stop(t + 0.45);
      o.onended = () => {
        try {
          o.disconnect();
          shaper.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
      this.noise(v, "lowpass", 500, 0.7, t, 0.14, 0.3, 120);
      this.duckPulse(t, 0.2, 0.4);
    } catch {
      /* no-op */
    }
  }

  /** Wave clear — rising A-minor chord, brighter each wave. */
  private sfxWaveClear(wave: number): void {
    if (!this.ctx || !this.sfxBus) return;
    // New run safety: a wave banner also means a live run — unfade the music.
    if (this.musicFaded && this.ctx && this.musicBus) {
      try {
        this.musicFaded = false;
        const g = this.musicBus.gain;
        g.cancelScheduledValues(this.ctx.currentTime);
        g.setTargetAtTime(MUSIC_LVL * (this.odWas ? OD_DUCK : 1), this.ctx.currentTime, 0.4);
      } catch {
        /* no-op */
      }
    }
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 1.3);
    if (!v) return;
    const bright = Math.min(2400, 900 + Math.max(1, wave) * 140);
    const notes = [110, 130.81, 164.81, 220, 329.63];
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.05;
      this.pad(v, notes[i], at, 0.9, 0.12, bright);
    }
  }

  /** Overdrive ignite — saw riser through an opening lowpass. */
  private sfxOverdriveOn(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.45);
    if (!v) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(960, t + 0.35);
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(4200, t + 0.35);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(f).connect(g).connect(v);
      o.start(t);
      o.stop(t + 0.42);
      o.onended = () => {
        try {
          o.disconnect();
          f.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
      this.noise(v, "bandpass", 900, 0.9, t, 0.35, 0.12, 3400);
    } catch {
      /* no-op */
    }
  }

  /** Boss die — sub-drop implode + falling debris wash. */
  private sfxBossdie(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 1.6);
    if (!v) return;
    this.osc(v, "sine", 90, 18, t, 1.1, 0.7);
    this.osc(v, "triangle", 55, 22, t + 0.05, 1.2, 0.3);
    this.noise(v, "lowpass", 2400, 0.6, t, 0.8, 0.3, 100);
    this.duckPulse(t, 0.5, 0.3);
  }

  /** Pickup — sparkle chime (E6 -> A6). */
  private sfxPickup(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.3);
    if (!v) return;
    this.osc(v, "sine", 1318.51, 1318.51, t, 0.09, 0.13);
    this.osc(v, "sine", 1760, 1760, t + 0.06, 0.12, 0.13);
    this.osc(v, "sine", 2637.02, 2637.02, t + 0.06, 0.09, 0.05);
  }

  /** Sun rank up — rising chord, longer with rank (a = rank). */
  private sfxSunrank(rank: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const notes = 3 + Math.max(0, Math.min(4, Math.round(rank)));
    const v = this.sfxOut(t, t + notes * 0.07 + 0.7);
    if (!v) return;
    for (let i = 0; i < notes; i++) {
      const at = t + i * 0.07;
      this.osc(v, "triangle", pentFreq(i), pentFreq(i), at, 0.22, 0.13);
      this.osc(v, "sine", pentFreq(i) * 2, pentFreq(i) * 2, at + 0.01, 0.16, 0.05);
    }
    this.pad(v, 220, t + notes * 0.07, 0.6, 0.1, 1800); // settle on A3
  }

  /** Player death — dark fall + music fade (restored on next wave/run). */
  private sfxDie(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 2.4);
    if (!v) return;
    this.osc(v, "sawtooth", 220, 55, t, 1.2, 0.18); // A3 -> A1
    this.osc(v, "sine", 70, 24, t + 0.05, 1.0, 0.4);
    this.noise(v, "lowpass", 900, 0.5, t, 1.8, 0.22, 70);
    try {
      if (this.musicBus) {
        this.musicFaded = true;
        const g = this.musicBus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.linearRampToValueAtTime(0.0001, t + 1.4);
      }
    } catch {
      /* no-op */
    }
  }

  // ---------- voice plumbing (proven frontier pattern) ----------

  private sfxOut(t0: number, t1: number): GainNode | null {
    if (!this.ctx || !this.sfxBus) return null;
    try {
      const g = this.ctx.createGain();
      g.gain.value = 1;
      g.connect(this.sfxBus);
      this.sfx.push({ out: g, start: t0, stop: t1, killed: false });
      const alive = this.sfx.filter((v) => !v.killed);
      if (alive.length > SFX_BUDGET) {
        let oldest: SfxVoice | null = null;
        for (const v of alive) {
          if (!oldest || v.start < oldest.start) oldest = v;
        }
        if (oldest) {
          oldest.killed = true;
          try {
            const t = this.ctx.currentTime;
            oldest.out.gain.cancelScheduledValues(t);
            oldest.out.gain.setTargetAtTime(0.0001, t, 0.01);
          } catch {
            /* no-op */
          }
        }
      }
      return g;
    } catch {
      return null;
    }
  }

  /** One-shot oscillator voice with attack/decay envelope + optional pitch sweep. */
  private osc(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    vol: number,
  ): void {
    if (!this.ctx) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, f0), t);
      if (f1 > 0 && Math.abs(f1 - f0) > 0.01) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.03);
      o.onended = () => {
        try {
          o.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
    } catch {
      /* no-op */
    }
  }

  /** One-shot filtered-noise voice with optional exponential filter sweep. */
  private noise(
    dest: AudioNode,
    type: BiquadFilterType,
    freq: number,
    q: number,
    t: number,
    dur: number,
    vol: number,
    sweepTo?: number,
  ): void {
    if (!this.ctx || !this.noiseBuf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = Math.max(20, freq);
      f.Q.value = q;
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.008, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(dest);
      src.start(t, Math.random() * 0.9);
      src.stop(t + dur + 0.03);
      src.onended = () => {
        try {
          src.disconnect();
          f.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
    } catch {
      /* no-op */
    }
  }

  /** Soft pad voice (wave chord settle) — detuned saw pair through a lowpass. */
  private pad(dest: AudioNode, freq: number, t: number, dur: number, vol: number, cutoff: number): void {
    if (!this.ctx) return;
    try {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = Math.max(120, cutoff);
      f.Q.value = 0.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      f.connect(g).connect(dest);
      const oscs: OscillatorNode[] = [];
      for (const det of [-4, 4]) {
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq;
        o.detune.value = det;
        const og = this.ctx.createGain();
        og.gain.value = 0.5;
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
        oscs.push(o);
      }
      oscs[0].onended = () => {
        try {
          for (const o of oscs) o.disconnect();
          f.disconnect();
          g.disconnect();
        } catch {
          /* no-op */
        }
      };
    } catch {
      /* no-op */
    }
  }
}
