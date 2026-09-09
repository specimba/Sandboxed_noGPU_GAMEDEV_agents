import { PENTATONIC } from './constants';

/**
 * HOLLOW SUN audio — 100% synthesized WebAudio, zero assets.
 *
 * SPRINT 14 "RESONANCE": the static saw drone is dead (it was the owner's
 * "single frequency persistently increasing" — a 55 Hz buzz whose gain was
 * swollen per-frame by setDanger and whose pitch was tugged between
 * setBiome and setOverdrive). Music is now a lookahead-scheduled adaptive
 * layer: sub pulse → pad chords → pentatonic arp, gated by wave depth,
 * re-tinted per biome, DUCKING under danger behind a hard-capped tension
 * bed, and opening its filter in Overdrive. One-shot SFX keep their voice.
 *
 * Laws:
 *  - every sustained frequency write happens in setBiome ONLY (event-driven);
 *  - setters called per-frame are state-diffed (no per-frame automation);
 *  - every scheduled note auto-stops — zero node accumulation;
 *  - the scheduler resyncs after tab-hidden throttling (no pileup, no burst).
 */

const STEP_DUR = 0.25; // 8th notes @ 120 BPM
const LOOKAHEAD = 0.4; // seconds of music scheduled ahead of the clock
const SCHED_MS = 100; // scheduler tick
const MUSIC_BASE = 0.8; // music bus gain (danger only ever ducks below this)
const FILTER_BASE = 800; // music lowpass when calm
const FILTER_OPEN = 2400; // music lowpass in overdrive
const TENSION_CAP = 0.026; // hard ceiling for the danger bed — texture, not tone
const SUB_ROOT = 55;
/** biome drone roots: A1 → C#2 → E2 → G2 — biome 4 (THE PALE CHOIR) resolves
 *  the climb to a mixolydian b7 shade: 55 × 1.78 ≈ 97.9 Hz, the flat-seventh
 *  that lets the choir drone lean outside the minor pad without breaking it */
const BIOME_RATIOS = [1, 1.26, 1.5, 1.78];

/** pad chords per biome — all A-minor family so one-shots stay consonant */
const PAD_CHORDS: number[][] = [
  [110, 130.81, 164.81, 196], // Am7
  [110, 138.59, 164.81, 196], // Am(maj7) — the C# bittersweet tint
  [110, 130.81, 164.81, 220], // Am7 + A3 sparkle
  [110, 130.81, 164.81, 246.94], // Am add9 — B natural against the G2 drone (A-minor family law holds)
];

/** arp pool — the same pentatonic family as ricochet/moteTick/shardGain */
const ARP_POOL = PENTATONIC.slice(0, 8);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastGrazeT = 0;
  private lastMoteT = -10;

  /* music bus + scheduler state */
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private subGain: GainNode | null = null;
  private subOscs: OscillatorNode[] = [];
  private tensionGain: GainNode | null = null;
  private tensionSrc: AudioBufferSourceNode | null = null;
  private schedTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private biome = 0;
  private musicLevel = 0;
  private dangerQ = -1;
  private odOn = false;
  private musicPaused = false;

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

      this.startMusic();
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
    if (this.schedTimer !== null) {
      clearInterval(this.schedTimer);
      this.schedTimer = null;
    }
    for (const o of this.subOscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.subOscs = [];
    try {
      this.tensionSrc?.stop();
    } catch {
      /* already stopped */
    }
    this.tensionSrc = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.musicFilter = null;
      this.subGain = null;
      this.tensionGain = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* adaptive music                                                    */
  /* ---------------------------------------------------------------- */

  /** biome drone root: A1 → C#2 → E2 — the ONLY place sub frequencies move */
  setBiome(b: number): void {
    if (!this.ctx) return;
    const nb = Math.min(BIOME_RATIOS.length - 1, Math.max(0, b));
    if (nb === this.biome) return; // state-diff: one glide per real change
    this.biome = nb;
    const r = BIOME_RATIOS[nb];
    const bases = [SUB_ROOT, SUB_ROOT * 1.5];
    for (let i = 0; i < 2 && i < this.subOscs.length; i++) {
      this.subOscs[i].frequency.setTargetAtTime(bases[i] * r, this.ctx.currentTime, 0.3);
    }
  }

  /** wave depth gate: 0 = sub only · 1 = +pad chords · 2 = +arp plucks */
  setMusicLevel(n: number): void {
    const nl = Math.min(2, Math.max(0, Math.round(n)));
    if (nl === this.musicLevel) return;
    this.musicLevel = nl;
  }

  /** pause/resume the scheduler (death, menus, tab-hidden) — no fading notes */
  setMusicPaused(p: boolean): void {
    if (p === this.musicPaused) return;
    this.musicPaused = p;
    if (!p && this.ctx) {
      this.nextNoteTime = Math.max(this.nextNoteTime, this.ctx.currentTime + 0.05);
    }
  }

  /**
   * DANGER — replaces the old endless swell. Quantized + state-diffed so the
   * per-frame engine call costs ~nothing when unchanged. Danger DUCKS the
   * music (floor 0.65×) and raises a hard-capped low tension bed. No
   * frequency automation, ever.
   */
  setDanger(level: number): void {
    if (!this.ctx || !this.musicGain || !this.tensionGain) return;
    const q = Math.round(Math.min(1, Math.max(0, level)) * 4) / 4;
    if (q === this.dangerQ) return;
    this.dangerQ = q;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(MUSIC_BASE * (1 - q * 0.35), t, 0.5);
    this.tensionGain.gain.setTargetAtTime(TENSION_CAP * q, t, 0.6);
  }

  /** OVERDRIVE — opens the music filter + lifts the arp an octave. It no
   *  longer touches any oscillator frequency (the old biome tug-of-war). */
  setOverdrive(active: boolean): void {
    if (!this.ctx || !this.musicFilter) return;
    if (active === this.odOn) return;
    this.odOn = active;
    this.musicFilter.frequency.setTargetAtTime(active ? FILTER_OPEN : FILTER_BASE, this.ctx.currentTime, 0.25);
  }

  /** music bus: subOscs + scheduled pad/arp → lowpass → musicGain → master */
  private startMusic(): void {
    if (!this.ctx || !this.master) return;

    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = FILTER_BASE;
    this.musicFilter.Q.value = 0.7;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = MUSIC_BASE;

    this.musicFilter.connect(this.musicGain);
    this.musicGain.connect(this.master);

    // persistent sub pair — silent between pulses (envelope lives on subGain)
    this.subGain = this.ctx.createGain();
    this.subGain.gain.value = 0.0001;
    this.subGain.connect(this.musicFilter);
    for (const [freq, type] of [
      [SUB_ROOT, 'sine'],
      [SUB_ROOT * 1.5, 'triangle'],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(this.subGain);
      o.start();
      this.subOscs.push(o);
    }

    // danger tension bed — looped noise, silent until setDanger raises it
    if (this.noiseBuf) {
      this.tensionGain = this.ctx.createGain();
      this.tensionGain.gain.value = 0;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 200;
      bp.Q.value = 0.8;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.connect(bp);
      bp.connect(this.tensionGain);
      this.tensionGain.connect(this.master);
      src.start();
      this.tensionSrc = src;
    }

    // lookahead scheduler — resync guard makes tab-throttling harmless
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.schedTimer = window.setInterval(() => this.schedule(), SCHED_MS);
  }

  private schedule(): void {
    if (!this.ctx || this.musicPaused) return;
    const ct = this.ctx.currentTime;
    if (this.nextNoteTime < ct) this.nextNoteTime = ct + 0.05; // resync, no pileup
    while (this.nextNoteTime < ct + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += STEP_DUR;
      this.step++;
    }
  }

  /** the composer — reads only state fields, schedules auto-stopping notes */
  private scheduleStep(step: number, t: number): void {
    const inBar = step % 8;
    const bar = Math.floor(step / 8);

    // sub pulse — beats 1 & 3
    if (inBar === 0 || inBar === 4) this.pulseSub(t);

    // pad chord — every 2 bars once waves deepen
    if (this.musicLevel >= 1 && step % 16 === 0) this.pulsePad(t);

    // pentatonic arp — 8th-note plucks at full depth
    if (this.musicLevel >= 2) {
      const idx = (step * 5 + bar * 3) % ARP_POOL.length;
      const note = this.odOn && step % 2 === 1 ? ARP_POOL[idx] * 2 : ARP_POOL[idx];
      this.pluck(note, t);
    }
  }

  private pulseSub(t: number): void {
    if (!this.ctx || !this.subGain) return;
    const dur = STEP_DUR * 1.6;
    const g = this.subGain.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(0.22, t + 0.02);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private pulsePad(t: number): void {
    if (!this.ctx || !this.musicFilter) return;
    const dur = STEP_DUR * 16; // 2 bars
    const chord = PAD_CHORDS[this.biome];
    for (const f of chord) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 1.1);
      g.gain.setValueAtTime(0.035, t + dur - 0.9);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g);
      g.connect(this.musicFilter);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private pluck(note: number, t: number): void {
    if (!this.ctx || !this.musicFilter) return;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = note;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.34);
    o.connect(g);
    g.connect(this.musicFilter);
    o.start(t);
    o.stop(t + 0.4);
  }

  /* ---------------------------------------------------------------- */
  /* stingers + one-shots                                              */
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

  /* ---- HEX LOOM / crowd-control cues — one-shots, state-diffed upstream ---- */

  /** dread tick under the hex telegraph — a loom winding up */
  hexAnchor(): void {
    this.tone(147, 0.5, 'sawtooth', 0.06, 131);
    this.noise(0.4, 0.05, 'lowpass', 420);
  }

  /** the hex answers the floor — hit variant thumps, miss variant hisses */
  hexDetonate(hit: boolean): void {
    if (hit) {
      this.thump(1.0, 74);
      this.noise(0.3, 0.2, 'lowpass', 1100, 200);
      this.tone(98, 0.22, 'square', 0.1, 62);
    } else {
      this.noise(0.12, 0.08, 'bandpass', 900, 300);
    }
  }

  /** the bind lands — a low thunk with a crackling tail */
  rootBind(): void {
    this.tone(84, 0.32, 'sine', 0.3, 50);
    this.tone(126, 0.16, 'triangle', 0.1);
    this.noise(0.34, 0.13, 'lowpass', 900, 160);
  }

  /** the bind snaps — bright release */
  rootBreak(): void {
    this.noise(0.08, 0.16, 'highpass', 2800);
    this.tone(720, 0.08, 'sine', 0.1, 1180);
  }

  /* ---- SPRINT 18 crown cue — CINDERBOUND ember wake drop ---------------- */

  /** an ember patch lands — short dull thud + a falling sizzle tail.
   *  One-shot family law: tone/noise only, auto-stop, modest gain. x/z shade
   *  the pitch deterministically (zero rng) so a moving wake doesn't machine-gun. */
  emberDrop(x: number, z: number): void {
    const wob = 1 + (Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 2 - 1) * 0.04;
    this.thump(0.7, 84 * wob); // the drop itself
    this.noise(0.42, 0.09, 'bandpass', 3600, 1100); // sizzle tail — falling band
    this.tone(1180 * wob, 0.08, 'sine', 0.05, 560, 0.02); // hot fleck sparkle
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

  /* ---------------------------------------------------------------- */
  /* sprint 17 CC/veil cue suite — stun / chill / veil have SOUND       */
  /* ---------------------------------------------------------------- */

  /** foe STUNNED — crystal crack: two bright sines + a snap of noise */
  ccStun(): void {
    this.tone(1980, 0.09, 'sine', 0.14, 2650);
    this.tone(2640, 0.14, 'sine', 0.09, 1980, 0.05);
    this.noise(0.08, 0.1, 'highpass', 5200);
  }

  /** foe SLOWED — cold drag: muted descending square */
  ccFoeSlow(): void {
    this.tone(520, 0.18, 'square', 0.07, 240);
    this.noise(0.14, 0.06, 'bandpass', 900, 380);
  }

  /** foe ROOTED by a dash-strike — ash clamps: low thud + gravel scrape
   *  (distinct from rootBind, which is the PLAYER's hex bind chime) */
  ccRootCue(): void {
    this.thump(0.8, 82);
    this.noise(0.22, 0.13, 'bandpass', 420, 160);
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
}
