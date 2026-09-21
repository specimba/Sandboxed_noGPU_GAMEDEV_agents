/**
 * STEEL FRONTIER — AUDIO ENGINE (S4 art pass)
 * Fully procedural WebAudio kit. Signature = WEIGHT: a 30-ton walker fight.
 *
 * Public contract (byte-stable): init/setMuted/isMuted/ready/uiTick/uiConfirm/launch
 *   cannon()  90Hz sine thump + 2.5kHz bandpassed noise crack + tiny click (per-shot detune)
 *   explosion(power)  sub boom 55->28Hz + lowpassed wash + 3-5 debris ticks (80-300ms) + music duck
 *   hit()  armor tick · hurt()  two-tone descending warning + thud · dash()  whoosh
 *   lockTick(n)  rising sonar pips · missiles()  volley whoosh + 4 staggered micro-launches
 *   waveStart(n)  two-note brass stab, +1 semitone/wave (cap +7) · gameOver()  minor cluster + tail
 *   update(dt)  THE ONLY scheduler entry point (no setInterval/setTimeout anywhere)
 *
 * Music: 4-layer adaptive tension system, BPM 116, 16th grid, 4-bar loop.
 *   L0 Am drone pad (slow filter LFO, retriggered every 2 bars — every node stopped)
 *   L1 military snare pulse on 8ths · L2 Am-pent bass ostinato · L3 lead tension line.
 *   intensity: public 0..3 field (accessor) the orchestrator can assign later;
 *   until then auto-derived from kills (explosions) in the last 10s inside update(dt).
 *
 * Buses: music 0.4 / SFX 0.9 -> master 0.5 -> compressor (-14dB) -> destination.
 * Rules: event-driven, every node stopped, no-op-safe try/catch, SFX voice budget ~24
 * (oldest voice stolen on overflow).
 */

const MUSIC_BPM = 116;
const SPQ = 60 / MUSIC_BPM / 4; // seconds per 16th
const LOOP_STEPS = 64; // 4 bars of 16ths
const LOOKAHEAD = 0.15; // schedule horizon (s)
const MUSIC_LVL = 0.4;
const SFX_LVL = 0.9;
const SFX_BUDGET = 24;

interface SfxVoice {
  out: GainNode;
  start: number;
  stop: number;
  killed: boolean;
}

/** Am-pent bass ostinato, 4 bars (A1/A2/C2/D2/E2/G region). */
function buildBass(): (number | null)[] {
  const bar: (number | null)[] = [
    55, 55, null, 110, null, 65.41, null, 55,
    49, null, 55, null, 73.42, null, 82.41, null,
  ];
  const out: (number | null)[] = [];
  for (let b = 0; b < 4; b++) {
    for (let i = 0; i < 16; i++) {
      if (b === 3 && i >= 12) out.push(i === 12 ? 49 : i === 14 ? 55 : null); // turnaround
      else out.push(bar[i]);
    }
  }
  return out;
}

/** Lead tension line (A minor pent + F natural rub), sparse. */
function buildLead(): (number | null)[] {
  const p: (number | null)[] = new Array<number | null>(LOOP_STEPS).fill(null);
  p[0] = 440; p[6] = 523.25; p[12] = 659.25;
  p[16] = 698.46; p[22] = 659.25; p[28] = 587.33;
  p[32] = 523.25; p[38] = 587.33; p[44] = 659.25;
  p[48] = 392; p[54] = 440; p[58] = 329.63;
  return p;
}

const BASS_STEPS = buildBass();
const LEAD_STEPS = buildLead();

export class AudioEngine {
  isMuted = false;
  ready = false;

  private _intensity = 0;
  private intensityManual = false;
  /** Adaptive music tension 0..3. Orchestrator may assign directly (or setIntensity); auto-derived until then. */
  get intensity(): number { return this._intensity; }
  set intensity(v: number) {
    this.intensityManual = true;
    this._intensity = Math.max(0, Math.min(3, v));
  }
  setIntensity(v: number): void { this.intensity = v; }

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private sfx: SfxVoice[] = [];
  private musicOn = false;
  private mStep = 0;
  private mNext = 0;
  private killTimes: number[] = [];

  init(): void {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 10;
        comp.ratio.value = 5;
        comp.attack.value = 0.004;
        comp.release.value = 0.18;
        const master = ctx.createGain();
        master.gain.value = this.isMuted ? 0 : 0.5;
        master.connect(comp).connect(ctx.destination);
        const music = ctx.createGain();
        music.gain.value = MUSIC_LVL;
        music.connect(master);
        const sfx = ctx.createGain();
        sfx.gain.value = SFX_LVL;
        sfx.connect(master);
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.master = master;
        this.musicBus = music;
        this.sfxBus = sfx;
        this.noiseBuf = buf;
      }
      // (re)start music cleanly — also undoes the gameOver fade on redeploy
      if (this.musicBus && this.ctx) {
        this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
        this.musicBus.gain.setValueAtTime(MUSIC_LVL, this.ctx.currentTime);
      }
      this.musicOn = true;
      if (this.ctx.state === "suspended") void this.ctx.resume();
      this.ready = true;
    } catch { this.ready = false; }
  }

  setMuted(m: boolean): void {
    this.isMuted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  update(dt: number): void {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      if (this.sfx.length > 0) this.sfx = this.sfx.filter((v) => v.stop > now - 0.05);
      if (!this.intensityManual) this.deriveIntensity(dt, now);
      this.runMusicScheduler(now);
    } catch { /* no-op */ }
  }

  // ---------- adaptive tension ----------

  private deriveIntensity(dt: number, now: number): void {
    this.killTimes = this.killTimes.filter((x) => now - x < 10);
    const k = this.killTimes.length;
    const target = k >= 9 ? 3 : k >= 4 ? 2 : k >= 1 ? 1 : 0;
    const rate = target > this._intensity ? 5 : 0.7; // snap up, ease down
    this._intensity += (target - this._intensity) * Math.min(1, dt * rate);
    if (Math.abs(target - this._intensity) < 0.002) this._intensity = target;
  }

  // ---------- music scheduler (update(dt) only) ----------

  private runMusicScheduler(now: number): void {
    if (!this.ctx || !this.musicBus || !this.musicOn || this.isMuted) return;
    if (this.mNext < now - 0.2) this.mNext = now + 0.06; // resync after stall / hidden tab
    let guard = 0;
    while (this.mNext < now + LOOKAHEAD && guard++ < 32) {
      this.scheduleStep(this.mStep, this.mNext);
      this.mStep = (this.mStep + 1) % LOOP_STEPS;
      this.mNext += SPQ;
    }
  }

  private scheduleStep(step: number, time: number): void {
    if (!this.musicBus) return;
    const bus = this.musicBus;
    const lvl = this._intensity;
    if (step % 32 === 0) this.padChord(bus, time);
    if (lvl >= 0.5 && step % 2 === 0) {
      const accent = step % 8 === 0;
      if (accent || Math.random() < 0.85) {
        this.snare(bus, time, accent ? 0.15 : 0.06 + Math.random() * 0.03);
        if (step % 16 === 12) this.snare(bus, time + SPQ * 0.9, 0.08); // military flam
      }
    }
    if (lvl >= 1.5) {
      const b = BASS_STEPS[step];
      if (b) this.bassNote(bus, b, time);
    }
    if (lvl >= 2.5) {
      const l = LEAD_STEPS[step];
      if (l) this.leadNote(bus, l, time);
    }
  }

  /** L0 — Am drone pad, retriggered every 2 bars; slow filter LFO; every node stopped. */
  private padChord(bus: AudioNode, t: number): void {
    if (!this.ctx) return;
    try {
      const dur = SPQ * 32 + 0.6;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 520;
      f.Q.value = 0.6;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.15, t + 1.4);
      g.gain.setValueAtTime(0.15, t + dur - 1.2);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      f.connect(g).connect(bus);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lg = this.ctx.createGain();
      lg.gain.value = 260;
      lfo.connect(lg).connect(f.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
      const oscs: OscillatorNode[] = [];
      const notes = [55, 110, 130.81, 164.81]; // A1 A2 C3 E3
      for (let i = 0; i < notes.length; i++) {
        const o = this.ctx.createOscillator();
        o.type = i < 2 ? "sawtooth" : "triangle";
        o.frequency.value = notes[i];
        o.detune.value = (Math.random() - 0.5) * 7;
        const og = this.ctx.createGain();
        og.gain.value = i < 2 ? 0.3 : 0.22;
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
        oscs.push(o);
      }
      const bye = () => {
        try {
          for (const o of oscs) o.disconnect();
          f.disconnect(); g.disconnect(); lfo.disconnect(); lg.disconnect();
        } catch { /* no-op */ }
      };
      oscs[0].onended = bye;
    } catch { /* no-op */ }
  }

  /** L1 — military snare-ish noise pulse. */
  private snare(bus: AudioNode, t: number, vol: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1750;
      f.Q.value = 0.8;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 500;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(f).connect(hp).connect(g).connect(bus);
      src.start(t, Math.random() * 0.9);
      src.stop(t + 0.09);
      src.onended = () => {
        try { src.disconnect(); f.disconnect(); hp.disconnect(); g.disconnect(); } catch { /* no-op */ }
      };
    } catch { /* no-op */ }
  }

  /** L2 — Am-pent bass ostinato, saw through a closing lowpass. */
  private bassNote(bus: AudioNode, freq: number, t: number): void {
    if (!this.ctx) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t);
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 3;
      f.frequency.setValueAtTime(1100, t);
      f.frequency.exponentialRampToValueAtTime(220, t + 0.16);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(f).connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.2);
      o.onended = () => { try { o.disconnect(); f.disconnect(); g.disconnect(); } catch { /* no-op */ } };
    } catch { /* no-op */ }
  }

  /** L3 — lead tension line with a soft echo. */
  private leadNote(bus: AudioNode, freq: number, t: number): void {
    this.leadVoice(bus, freq, t, 0.09);
    this.leadVoice(bus, freq, t + SPQ * 1.5, 0.032);
  }

  private leadVoice(bus: AudioNode, freq: number, t: number, vol: number): void {
    if (!this.ctx) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = (Math.random() - 0.5) * 6;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2600;
      f.Q.value = 0.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.setValueAtTime(vol * 0.7, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(f).connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.33);
      o.onended = () => { try { o.disconnect(); f.disconnect(); g.disconnect(); } catch { /* no-op */ } };
    } catch { /* no-op */ }
  }

  // ---------- voice plumbing ----------

  /** Register a per-sound output gain on the SFX bus; enforces the ~24 voice budget (steal oldest). */
  private sfxOut(t0: number, t1: number): GainNode | null {
    if (!this.ctx || !this.sfxBus) return null;
    try {
      const g = this.ctx.createGain();
      g.gain.value = 1;
      g.connect(this.sfxBus);
      this.sfx.push({ out: g, start: t0, stop: t1, killed: false });
      this.trimSfx();
      return g;
    } catch { return null; }
  }

  private trimSfx(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.sfx.length > SFX_BUDGET + 8) this.sfx = this.sfx.filter((v) => v.stop > now - 0.05);
    let alive = 0;
    let oldest: SfxVoice | null = null;
    for (const v of this.sfx) {
      if (v.killed) continue;
      alive++;
      if (!oldest || v.start < oldest.start) oldest = v;
    }
    if (alive > SFX_BUDGET && oldest) this.killVoice(oldest);
  }

  private killVoice(v: SfxVoice): void {
    if (v.killed || !this.ctx) return;
    v.killed = true;
    try {
      const t = this.ctx.currentTime;
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setValueAtTime(Math.max(0.0001, v.out.gain.value), t);
      v.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
    } catch { /* no-op */ }
  }

  /** One-shot oscillator voice with attack/decay envelope. */
  private osc(dest: AudioNode, type: OscillatorType, f0: number, f1: number | null, t: number, dur: number, vol: number): void {
    if (!this.ctx) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, f0), t);
      if (f1 != null && f1 > 0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.03);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* no-op */ } };
    } catch { /* no-op */ }
  }

  /** One-shot filtered-noise voice; optional exponential filter sweep. */
  private noise(dest: AudioNode, type: BiquadFilterType, freq: number, q: number, t: number, dur: number, vol: number, sweepTo?: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
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
        try { src.disconnect(); f.disconnect(); g.disconnect(); } catch { /* no-op */ }
      };
    } catch { /* no-op */ }
  }

  private duckMusic(t: number): void {
    if (!this.musicBus) return;
    try {
      const g = this.musicBus.gain;
      const depth = MUSIC_LVL * 0.3;
      g.cancelScheduledValues(t);
      g.setValueAtTime(MUSIC_LVL, t);
      g.linearRampToValueAtTime(depth, t + 0.05);
      g.setValueAtTime(depth, t + 0.3); // ~0.25s duck hold
      g.linearRampToValueAtTime(MUSIC_LVL, t + 0.7);
    } catch { /* no-op */ }
  }

  // ---------- SFX ----------

  uiTick(): void {
    if (!this.ctx || !this.sfxBus) return;
    this.osc(this.sfxBus, "square", 1200, null, this.ctx.currentTime, 0.04, 0.1);
  }

  uiConfirm(): void {
    if (!this.ctx || !this.sfxBus) return;
    this.osc(this.sfxBus, "square", 660, 990, this.ctx.currentTime, 0.09, 0.14);
  }

  launch(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.7);
    if (!v) return;
    this.noise(v, "lowpass", 900, 0.6, t, 0.5, 0.32, 260);   // reactor settle
    this.osc(v, "sine", 70, 40, t, 0.45, 0.4);               // frame thud
    this.osc(v, "sawtooth", 52, 96, t, 0.5, 0.1);            // servos spin up
  }

  /** 30-ton cannon: sub thump + bandpass crack + click, per-shot detune. */
  cannon(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const d = 1 + (Math.random() - 0.5) * 0.09;
    const thump = this.sfxOut(t, t + 0.2);
    if (thump) {
      this.osc(thump, "sine", 90 * d, 46 * d, t, 0.09, 0.95);
      this.osc(thump, "triangle", 55 * d, 38, t, 0.15, 0.3); // weight tail
    }
    const crack = this.sfxOut(t, t + 0.12);
    if (crack) {
      this.noise(crack, "bandpass", 2500 * (1 + (Math.random() - 0.5) * 0.12), 0.7, t, 0.05, 0.55);
      this.noise(crack, "highpass", 4200, 0.7, t, 0.012, 0.35); // tiny click
    }
  }

  /** Layered boom: 55->28Hz sub + wash + 3-5 randomized debris ticks + music duck. */
  explosion(power: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const p = Math.max(0.4, Math.min(2.6, power));
    this.killTimes.push(t);
    const boom = this.sfxOut(t, t + 1.1);
    if (boom) this.osc(boom, "sine", 55, 28, t, 0.5 + 0.1 * p, 0.75 + 0.18 * p);
    const wash = this.sfxOut(t, t + 0.5 + 0.35 * p);
    if (wash) this.noise(wash, "lowpass", 900 - 180 * p, 0.5, t, 0.45 + 0.3 * p, 0.5, 120);
    const n = 3 + Math.floor(Math.random() * 3); // 3..5 debris ticks, 80-300ms out
    for (let i = 0; i < n; i++) {
      const at = t + 0.08 + Math.random() * 0.22;
      const tick = this.sfxOut(at, at + 0.06);
      if (tick) this.noise(tick, "bandpass", 2200 + Math.random() * 2600, 2.2, at, 0.028, 0.14 + Math.random() * 0.1);
    }
    this.duckMusic(t);
  }

  /** Short armor tick. */
  hit(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const d = 1 + (Math.random() - 0.5) * 0.2;
    const v = this.sfxOut(t, t + 0.08);
    if (!v) return;
    this.osc(v, "square", 2000 * d, 1400 * d, t, 0.03, 0.16);
    this.noise(v, "bandpass", 3000 * d, 1.5, t, 0.02, 0.2);
  }

  /** Player damage: two-tone descending warning + armor thud. */
  hurt(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.35);
    if (!v) return;
    this.osc(v, "square", 330, 235, t, 0.09, 0.24);
    this.osc(v, "square", 250, 180, t + 0.09, 0.11, 0.24);
    this.noise(v, "lowpass", 240, 0.8, t, 0.12, 0.4);
  }

  /** Dash whoosh: bandpass rises then falls over 0.28s. */
  dash(): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.32);
    if (!v) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.1;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      f.frequency.exponentialRampToValueAtTime(650, t + 0.28);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      src.connect(f).connect(g).connect(v);
      src.start(t, Math.random() * 0.9);
      src.stop(t + 0.31);
      src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch { /* no-op */ } };
    } catch { /* no-op */ }
  }

  /** Rising sonar acquisition pips. */
  lockTick(n: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const f = 900 + Math.min(7, Math.max(0, n)) * 160;
    const v = this.sfxOut(t, t + 0.2);
    if (!v) return;
    this.osc(v, "sine", f, f, t, 0.055, 0.22);
    this.osc(v, "sine", f * 1.5, f * 1.5, t + 0.07, 0.05, 0.08); // sonar echo
  }

  /** Volley: launch whoosh + 4 staggered micro-launches. */
  missiles(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOut(t, t + 0.75);
    if (!v) return;
    this.noise(v, "bandpass", 700, 1.2, t, 0.45, 0.4, 2100);
    this.noise(v, "lowpass", 300, 0.7, t, 0.3, 0.3);
    for (let i = 0; i < 4; i++) {
      const at = t + 0.09 + i * 0.075;
      this.noise(v, "bandpass", 1100 + i * 260, 1.6, at, 0.07, 0.26, 1900 + i * 200);
      this.osc(v, "sawtooth", 240 + i * 70, 420 + i * 90, at, 0.06, 0.1);
    }
  }

  /** Two-note brass-ish stab; +1 semitone per wave, capped at +7. */
  waveStart(n: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const semi = Math.min(7, Math.max(0, n - 1));
    const k = Math.pow(2, semi / 12);
    const v = this.sfxOut(t, t + 0.55);
    if (!v) return;
    this.brass(v, 130.81 * k, t, 0.18, 0.24);
    this.brass(v, 130.81 * k * 1.4983, t + 0.11, 0.3, 0.2);
  }

  private brass(dest: AudioNode, freq: number, t: number, dur: number, vol: number): void {
    if (!this.ctx) return;
    try {
      const o1 = this.ctx.createOscillator();
      o1.type = "sawtooth";
      o1.frequency.setValueAtTime(freq, t);
      const o2 = this.ctx.createOscillator();
      o2.type = "sawtooth";
      o2.frequency.setValueAtTime(freq * 1.007, t);
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 1.1;
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(700, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o1.connect(f);
      o2.connect(f);
      f.connect(g).connect(dest);
      o1.start(t);
      o2.start(t);
      o1.stop(t + dur + 0.03);
      o2.stop(t + dur + 0.03);
      o1.onended = () => {
        try { o1.disconnect(); o2.disconnect(); f.disconnect(); g.disconnect(); } catch { /* no-op */ }
      };
    } catch { /* no-op */ }
  }

  /** Death: descending A2/F2/C2 minor cluster + sub boom + 2.5s noise tail; music fades. */
  gameOver(): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.musicOn = false;
    try {
      if (this.musicBus) {
        const g = this.musicBus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.linearRampToValueAtTime(0.0001, t + 1.4);
      }
    } catch { /* no-op */ }
    const v = this.sfxOut(t, t + 3);
    if (!v) return;
    this.osc(v, "sawtooth", 110, 74, t, 1.5, 0.16);        // A2
    this.osc(v, "sawtooth", 87.31, 58, t + 0.06, 1.6, 0.16); // F2
    this.osc(v, "triangle", 65.41, 44, t + 0.12, 1.7, 0.2);  // C2
    this.osc(v, "sine", 48, 24, t, 1.3, 0.6);                // sub boom
    this.noise(v, "bandpass", 1800, 0.8, t, 0.4, 0.25, 300); // impact crack
    this.noise(v, "lowpass", 600, 0.4, t, 2.5, 0.35, 90);    // long tail
  }
}
