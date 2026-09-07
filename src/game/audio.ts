import { PENTATONIC } from './constants';

/**
 * HOLLOW SUN audio — 100% synthesized WebAudio, zero assets.
 * The signature: ricochet chains climb a pentatonic ladder, one note per
 * bounce, so every good throw plays a melody.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private padGain: GainNode | null = null;
  private muted = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastGrazeT = 0;
  private lastMoteT = -10;

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

  /* biome drone root: A1 → C#2 → E2 */
  setBiome(b: number): void {
    if (!this.ctx) return;
    const ratios = [1, 1.26, 1.5];
    const r = ratios[Math.min(ratios.length - 1, Math.max(0, b))];
    const bases = [55, 55.4, 82.4];
    for (let i = 0; i < 3 && i < this.droneOscs.length; i++) {
      this.droneOscs[i].frequency.setTargetAtTime(bases[i] * r, this.ctx.currentTime, 0.6);
    }
  }

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
  /* ambience                                                          */
  /* ---------------------------------------------------------------- */

  private startDrone(): void {
    if (!this.ctx || !this.master) return;
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0.05;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    this.droneGain.connect(filter);
    filter.connect(this.master);
    for (const [freq, detune] of [
      [55, 0],
      [55.4, 4],
      [82.4, -6],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(this.droneGain);
      o.start();
      this.droneOscs.push(o);
    }

    // overdrive pad — silent until enabled
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0;
    const padFilter = this.ctx.createBiquadFilter();
    padFilter.type = 'bandpass';
    padFilter.frequency.value = 440;
    padFilter.Q.value = 1.4;
    this.padGain.connect(padFilter);
    padFilter.connect(this.master);
    for (const freq of [110, 164.8, 220, 329.6]) {
      const o = this.ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
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
    // world slowed: pitch the ambience down
    if (this.droneGain) {
      // detune via playbackRate is not on osc; nudge frequency instead
      for (let i = 0; i < 3; i++) {
        const o = this.droneOscs[i];
        const base = [55, 55.4, 82.4][i];
        o.frequency.setTargetAtTime(active ? base * 0.72 : base, this.ctx.currentTime, 0.15);
      }
    }
  }

  setDanger(level: number): void {
    if (!this.ctx || !this.droneGain) return;
    this.droneGain.gain.setTargetAtTime(0.05 + level * 0.05, this.ctx.currentTime, 0.4);
  }

  heartbeat(): void {
    this.thump(0.9, 68);
    window.setTimeout(() => this.thump(0.6, 58), 190);
  }

  /* ---------------------------------------------------------------- */
  /* one-shots                                                         */
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
    this.tone(note, 0.34, 'triangle', 0.30);
    this.tone(note * 2, 0.18, 'sine', 0.12);
    this.noise(0.06, 0.10, 'highpass', 3200);
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
  /* AFTERGLOW additive SFX (Task 14-d) — volley / motes / draft / husk */
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
