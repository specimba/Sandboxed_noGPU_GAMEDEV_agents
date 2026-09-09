import { PENTATONIC } from './constants';

/**
 * HOLLOW SUN audio — 100% synthesized WebAudio, zero assets.
 * The signature: ricochet chains climb a pentatonic ladder, one note per
 * bounce, so every good throw plays a melody.
 *
 * SPRINT 17 LAW (the escalation kill-chain):
 *  - Danger NEVER scales raw loudness. It opens a filter and adds arp density
 *    — pressure reads as the music brightening, capped, never a swelling hum.
 *  - Every ambient target is refreshed per-frame by the engine; `tick()` is a
 *    hard watchdog: any layer not refreshed within 0.6s force-decays to zero.
 *    No ambience state can outlive its driver.
 *  - Biomes own a root note + pad chord + filter color (identity, not volume).
 */

/** per-biome identity: drone roots, pad chord, filter color */
const BIOME_TONE = [
  { roots: [55, 55.4, 82.4], pad: [110, 130.8, 164.8], padFilter: 430 }, // ASHFALL — dusty A
  { roots: [46.2, 46.6, 69.3], pad: [92.5, 110, 138.6], padFilter: 640 }, // GLASS HOLLOW — cold F#
  { roots: [65.4, 65.9, 98], pad: [130.8, 164.8, 196], padFilter: 540 }, // THE HEART — open C
] as const;

/** 8-step arp pattern (pentatonic degree, octave lift) — fixed, deterministic */
const ARP_PATTERN: [number, number][] = [
  [0, 0], [2, 0], [4, 0], [2, 1], [0, 0], [4, 0], [5, 1], [2, 0],
];

const DRONE_BASE = 0.05;
const DRONE_MAX = 0.075; // hard ceiling — the drone may never swell past this
const WATCHDOG_S = 0.6; // a layer not refreshed this long is force-decayed

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private padGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private muted = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastGrazeT = 0;
  private lastMoteT = -10;

  // ambient state machine (watchdog-driven)
  private dangerLevel = 0;
  private lastDangerAt = -10;
  private biome = 0;

  // arp sequencer
  private arpT = 0;
  private arpStep = 0;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** call from a user gesture */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 20;
      comp.ratio.value = 8;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      // pre-baked noise buffer
      const len = this.ctx.sampleRate * 1.2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.startDrone();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  dispose(): void {
    for (const o of this.droneOscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.droneOscs = [];
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* ambient — biome identity + watchdog-driven danger                 */
  /* ---------------------------------------------------------------- */

  /** biome identity: root note, pad chord, filter color — NOT loudness */
  setBiome(b: number): void {
    this.biome = Math.max(0, Math.min(BIOME_TONE.length - 1, b));
    if (!this.ctx) return;
    const tone = BIOME_TONE[this.biome];
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3 && i < this.droneOscs.length; i++) {
      this.droneOscs[i].frequency.setTargetAtTime(tone.roots[i], t, 0.6);
    }
    // pad chord morph (indexes 3..5 of droneOscs are the pad voices)
    for (let i = 0; i < 3 && i + 3 < this.droneOscs.length; i++) {
      this.droneOscs[i + 3].frequency.setTargetAtTime(tone.pad[i], t, 0.8);
    }
    this.padFilter?.frequency.setTargetAtTime(tone.padFilter, t, 0.8);
  }

  /**
   * Danger level 0..1 — pressure opens the drone filter and adds arp density.
   * MUST be refreshed per frame by the engine while playing; the tick()
   * watchdog force-decays anything stale. Clamped; never scales raw gain
   * beyond the DRONE_MAX ceiling.
   */
  setDanger(level: number): void {
    if (!this.ctx || !this.droneGain || !this.droneFilter) return;
    const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    this.dangerLevel = l;
    this.lastDangerAt = this.ctx.currentTime;
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(DRONE_BASE + l * (DRONE_MAX - DRONE_BASE), t, 0.4);
    this.droneFilter.frequency.setTargetAtTime(200 + l * 380, t, 0.5);
  }

  /**
   * Per-frame ambient maintenance — call from the engine loop in EVERY phase.
   * The failsafe: if setDanger stopped being driven (death, pause, crash of
   * the caller), decay everything to silence within WATCHDOG_S. Also runs
   * the arp sequencer (danger = density + brightness, never loudness).
   */
  tick(dt: number): void {
    if (!this.ctx || !this.droneGain || !this.droneFilter) return;
    const now = this.ctx.currentTime;
    if (now - this.lastDangerAt > WATCHDOG_S && this.dangerLevel > 0) {
      this.dangerLevel = 0;
      this.droneGain.gain.setTargetAtTime(DRONE_BASE, now, 0.35);
      this.droneFilter.frequency.setTargetAtTime(200, now, 0.45);
    }
    if (this.muted) return;
    // arp: only speaks under pressure, denser + brighter as danger climbs
    if (this.dangerLevel > 0.06) {
      this.arpT -= dt;
      if (this.arpT <= 0) {
        const period = 0.62 - this.dangerLevel * 0.22; // 0.62s calm → 0.40s hot
        this.arpT = period;
        const [deg, oct] = ARP_PATTERN[this.arpStep % ARP_PATTERN.length];
        this.arpStep = (this.arpStep + 1) % ARP_PATTERN.length;
        const root = BIOME_TONE[this.biome].roots[0];
        const semi = PENTATONIC[deg % PENTATONIC.length] / 261.63; // degree ratio
        const freq = root * 4 * semi * (oct > 0 ? 1.5 : 1);
        const g = 0.045 + this.dangerLevel * 0.035; // capped: quiet by design
        this.tone(freq, 0.34, 'triangle', g);
      }
    } else {
      this.arpT = Math.max(this.arpT, 0.18); // first note lands immediately
    }
  }

  /* ---------------------------------------------------------------- */
  /* CC cue suite — stun / root / slow have SOUND, not just visuals    */
  /* ---------------------------------------------------------------- */

  /** foe STUNNED — crystal crack: two bright sines + a snap of noise */
  ccStun(): void {
    this.tone(1980, 0.09, 'sine', 0.14, 2650);
    this.tone(2640, 0.14, 'sine', 0.09, 1980, 0.05);
    this.noise(0.08, 0.1, 'highpass', 5200);
  }

  /** foe ROOTED — ash clamps: low thud + gravel scrape, descending */
  ccRoot(): void {
    this.thump(0.8, 82);
    this.noise(0.22, 0.13, 'bandpass', 420, 160);
  }

  /** foe SLOWED — cold drag: muted descending square */
  ccFoeSlow(): void {
    this.tone(520, 0.18, 'square', 0.07, 240);
    this.noise(0.14, 0.06, 'bandpass', 900, 380);
  }

  /** herald rings a veil volley — glassy double-chime telegraph */
  veilVolley(): void {
    this.tone(1244, 0.16, 'sine', 0.1, 1174);
    this.tone(1864, 0.22, 'sine', 0.07, 1760, 0.07);
  }

  /** PLAYER VEILED (slowed) — icy hit: downward saw + frost noise + thud */
  ccVeilHit(): void {
    this.tone(340, 0.3, 'sawtooth', 0.16, 96);
    this.noise(0.34, 0.14, 'bandpass', 2600, 500);
    this.thump(0.7, 70);
  }

  /** slow cleansed (dash) — recovery blip climbing back to pitch */
  ccCleanse(): void {
    this.tone(392, 0.1, 'triangle', 0.12, 784);
    this.noise(0.08, 0.08, 'highpass', 3600);
  }

  /* ---------------------------------------------------------------- */
  /* one-shots (existing score)                                        */
  /* ---------------------------------------------------------------- */

  recall(): void {
    this.noise(0.18, 0.12, 'bandpass', 2600, 900);
    this.tone(980, 0.12, 'sine', 0.1, 620);
  }

  shieldBreak(): void {
    this.tone(1480, 0.2, 'triangle', 0.18, 740);
    this.noise(0.12, 0.12, 'highpass', 5200);
  }

  /** bulwark armor clang — dull metal, not the shimmer of a shield break */
  block(): void {
    this.tone(196, 0.14, 'square', 0.14, 148);
    this.tone(1244, 0.05, 'sine', 0.08);
    this.noise(0.07, 0.12, 'highpass', 2800);
  }

  /** caster lance — heavy charged whoosh */
  heavyShot(): void {
    this.noise(0.26, 0.2, 'bandpass', 700, 180);
    this.tone(150, 0.22, 'sawtooth', 0.12, 62);
  }

  bossPhase(): void {
    // rising fifth + swell — the warden breathes
    this.tone(196, 0.5, 'sawtooth', 0.2, 294);
    this.tone(98, 0.6, 'sawtooth', 0.16, 147);
    this.noise(0.55, 0.18, 'lowpass', 900, 2400);
  }

  revive(): void {
    for (let i = 0; i < 5; i++) {
      this.tone(PENTATONIC[4 + (i % 5)] ?? 440, 0.4, 'triangle', 0.12, undefined, i * 0.08);
    }
  }

  shrine(): void {
    this.tone(523.25, 0.3, 'triangle', 0.12);
    this.tone(659.26, 0.4, 'triangle', 0.1, undefined, 0.1);
    this.tone(783.99, 0.5, 'triangle', 0.08, undefined, 0.2);
  }

  /* ---------------------------------------------------------------- */
  /* ambience graph                                                    */
  /* ---------------------------------------------------------------- */

  private startDrone(): void {
    if (!this.ctx || !this.master) return;
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = DRONE_BASE;
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 200;
    this.droneGain.connect(this.droneFilter);
    this.droneFilter.connect(this.master);
    const tone = BIOME_TONE[this.biome];
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = tone.roots[i];
      o.detune.value = [0, 4, -6][i];
      o.connect(this.droneGain);
      o.start();
      this.droneOscs.push(o);
    }

    // overdrive pad — silent until enabled; chord = biome identity
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter = this.ctx.createBiquadFilter();
    this.padFilter.type = 'bandpass';
    this.padFilter.frequency.value = tone.padFilter;
    this.padFilter.Q.value = 1.4;
    this.padGain.connect(this.padFilter);
    this.padFilter.connect(this.master);
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = tone.pad[i];
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(this.padGain);
      o.start();
      this.droneOscs.push(o);
    }
  }

  setOverdrive(active: boolean, t01: number): void {
    if (!this.ctx || !this.padGain) return;
    const target = active ? 0.055 : 0;
    this.padGain.gain.setTargetAtTime(target * (1 - t01 * 0.4), this.ctx.currentTime, active ? 0.08 : 0.3);
    // world slowed: pitch the DRONE down, then restore the biome root —
    // the pre-17 bug clobbered the biome identity with hardcoded numbers
    if (this.droneGain) {
      const tone = BIOME_TONE[this.biome];
      for (let i = 0; i < 3; i++) {
        const o = this.droneOscs[i];
        o.frequency.setTargetAtTime(active ? tone.roots[i] * 0.72 : tone.roots[i], this.ctx.currentTime, 0.15);
      }
    }
  }

  heartbeat(): void {
    this.thump(0.9, 68);
    window.setTimeout(() => this.thump(0.6, 58), 190);
  }

  /* ---------------------------------------------------------------- */
  /* one-shot builders                                                 */
  /* ---------------------------------------------------------------- */

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, gain: number, filterType: BiquadFilterType, f0: number, f1?: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private thump(gain: number, freq: number): void {
    this.tone(freq, 0.22, 'sine', gain * 0.5, freq * 0.5);
  }

  ricochet(bounceIndex: number): void {
    const note = PENTATONIC[Math.min(PENTATONIC.length - 1, bounceIndex)];
    this.tone(note, 0.34, 'triangle', 0.3);
    this.tone(note * 2, 0.18, 'sine', 0.12);
    this.noise(0.06, 0.1, 'highpass', 3200);
  }

  throwShard(): void {
    this.noise(0.22, 0.16, 'bandpass', 2400, 500);
    this.tone(720, 0.1, 'sine', 0.06, 1250);
  }

  catchShard(): void {
    this.tone(520, 0.09, 'triangle', 0.16, 640);
    this.noise(0.04, 0.08, 'highpass', 4200);
  }

  graze(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGrazeT < 0.06) return; // rate limit stampedes
    this.lastGrazeT = now;
    this.tone(1720, 0.05, 'sine', 0.12, 2100);
  }

  kill(): void {
    this.thump(1.0, 96);
    this.noise(0.24, 0.2, 'lowpass', 1400, 240);
    this.tone(1320, 0.12, 'sine', 0.08, 400);
  }

  wardenDie(): void {
    this.thump(1.0, 70);
    this.noise(0.8, 0.3, 'lowpass', 2000, 90);
    for (let i = 0; i < 6; i++) {
      this.tone(PENTATONIC[i % PENTATONIC.length] * 2, 0.3, 'triangle', 0.1, undefined, i * 0.07);
    }
  }

  hurt(): void {
    this.tone(160, 0.3, 'sawtooth', 0.3, 55);
    this.noise(0.3, 0.24, 'lowpass', 900, 120);
  }

  dash(): void {
    this.noise(0.16, 0.14, 'bandpass', 900, 2600);
  }

  overdriveStart(): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(980, t0 + 0.42);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    o.connect(g);
    if (this.master) g.connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.55);
    this.tone(440, 0.5, 'triangle', 0.14, 880, 0.05);
  }

  wardenSpawn(): void {
    this.tone(98, 1.0, 'sawtooth', 0.22, 82);
    this.tone(103, 1.0, 'sawtooth', 0.18, 86);
    this.noise(0.9, 0.1, 'lowpass', 500, 90);
  }

  waveStart(n: number): void {
    const base = 261.63 * Math.pow(2, ((n - 1) % 5) / 12);
    this.tone(base, 0.24, 'triangle', 0.16);
    this.tone(base * 1.5, 0.3, 'triangle', 0.12, undefined, 0.12);
  }

  waveClear(): void {
    this.tone(659.26, 0.16, 'triangle', 0.14);
    this.tone(880, 0.22, 'triangle', 0.14, undefined, 0.1);
  }

  shardGain(): void {
    for (let i = 0; i < 4; i++) {
      this.tone(PENTATONIC[5 + i] ?? 880, 0.26, 'triangle', 0.14, undefined, i * 0.09);
    }
  }

  death(): void {
    this.tone(220, 1.4, 'sawtooth', 0.26, 40);
    this.noise(1.2, 0.26, 'lowpass', 1200, 60);
  }

  uiClick(): void {
    this.tone(880, 0.06, 'triangle', 0.1);
  }

  /* ---------------------------------------------------------------- */
  /* additive SFX — volley / motes / draft / husk                      */
  /* ---------------------------------------------------------------- */

  /** light volley shot — bandpass noise sweep + rising sine chirp */
  pew(): void {
    this.noise(0.07, 0.1, 'bandpass', 2400, 900);
    this.tone(900, 0.07, 'sine', 0.1, 1400);
  }

  /**
   * mote pickup pitch ladder — pentatonic step per pickup, restarts the
   * ladder after a 1.5s gap, rate-limited against bursts (graze pattern).
   */
  moteTick(n: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastMoteT < 0.04) return; // rate limit stampedes
    const step = now - this.lastMoteT > 1.5 ? 0 : n;
    this.lastMoteT = now;
    const note = PENTATONIC[Math.min(PENTATONIC.length - 1, step)];
    this.tone(note, 0.16, 'triangle', 0.12);
    this.tone(note * 2, 0.08, 'sine', 0.05);
  }

  /** draft card hover — barely-there tick */
  draftHover(): void {
    this.tone(400, 0.05, 'sine', 0.05);
  }

  /** draft pick — two-note shard chime (shardGain family, shorter) */
  draftPick(): void {
    this.tone(PENTATONIC[5] ?? 523.25, 0.24, 'triangle', 0.14);
    this.tone(PENTATONIC[7] ?? 659.26, 0.3, 'triangle', 0.12, undefined, 0.09);
  }

  /** husk charge telegraph — 140→90Hz saw SWELL so the scream is audible mid-windup, + low rumble */
  huskScream(): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(0.2, t0 + 0.45); // the swell
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.72);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.75);
    this.noise(0.6, 0.1, 'lowpass', 800, 140);
  }
}
