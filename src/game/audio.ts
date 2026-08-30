import * as THREE from 'three';

/**
 * ECHOVOID audio — fully synthesized, zero assets.
 *
 * Key trick: chimes and growls are scheduled at ctx.currentTime + delay where
 * delay = distance/waveSpeed, so you literally *hear* the shockwave hit shards,
 * gates and listeners — the sound arrives like a sonar return.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private alertGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private whaleTimer = 14;
  private started = false;

  /** must be called from a user gesture (autoplay policy) */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return; // no WebAudio — game still works, just silent
    }
    const ctx = this.ctx;
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    // ---- echo bus (cave sonar returns) ----
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.26;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1500;
    this.echoIn.connect(delay);
    delay.connect(damp).connect(fb).connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    delay.connect(wet).connect(this.master);
    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    this.echoIn.connect(dry).connect(this.master);

    // ---- noise buffer (reused) ----
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995;
      data[i] = brown * 3.2;
    }
    this.noiseBuffer = buf;

    // ---- ambient drone ----
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 190;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    this.droneFilter.connect(droneGain).connect(this.master);
    for (const f of [55, 55.6, 110.4]) {
      const o = ctx.createOscillator();
      o.type = f > 100 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 100 ? 0.25 : 0.5;
      o.connect(g).connect(this.droneFilter);
      o.start();
    }

    // ---- wind (filtered brown noise with slow swell) ----
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 380;
    windFilter.Q.value = 0.5;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.028;
    wind.connect(windFilter).connect(windGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.014;
    lfo.connect(lfoGain).connect(windGain.gain);
    lfo.start();
    wind.start();

    // ---- threat heartbeat (gain driven by alert level) ----
    const hb = ctx.createOscillator();
    hb.type = 'sine';
    hb.frequency.value = 47;
    this.alertGain = ctx.createGain();
    this.alertGain.gain.value = 0;
    hb.connect(this.alertGain).connect(this.master);
    hb.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  setAlert(v: number): void {
    if (this.alertGain && this.ctx) {
      this.alertGain.gain.setTargetAtTime(Math.min(1, v) * 0.4, this.ctx.currentTime, 0.15);
    }
  }

  /** deeper = darker drone */
  setDepthMood(depth: number): void {
    if (this.droneFilter && this.ctx) {
      const f = Math.max(90, 190 - depth * 22);
      this.droneFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 1.0);
    }
  }

  /** occasional distant void-call, panned */
  update(dt: number): void {
    if (!this.ctx || !this.echoIn || !this.noiseBuffer || !this.started) return;
    this.whaleTimer -= dt;
    if (this.whaleTimer <= 0) {
      this.whaleTimer = 16 + Math.random() * 26;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150 + Math.random() * 60, t);
      o.frequency.exponentialRampToValueAtTime(95 + Math.random() * 30, t + 2.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(pan).connect(this.echoIn);
      o.start(t);
      o.stop(t + 2.7);
    }
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(
    freqFrom: number,
    freqTo: number,
    dur: number,
    gain: number,
    type: OscillatorType,
    at = 0,
    dest?: AudioNode,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.now() + at;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freqFrom), t);
    if (freqTo !== freqFrom) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number,
    gain: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 1,
    at = 0,
    dest?: AudioNode,
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.now() + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest ?? this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** the echo pulse — sub thump + sonar sweep into the cave echo */
  pulse(): void {
    this.tone(150, 44, 0.55, 0.5, 'sine');
    this.tone(940, 210, 0.42, 0.2, 'sine', 0, this.echoIn ?? undefined);
    this.noise(0.3, 0.1, 'bandpass', 750, 2.2, 0, this.echoIn ?? undefined);
  }

  /** a chime that arrives with the wavefront (delay in seconds) */
  chime(delay: number, freq: number, gain = 0.15): void {
    this.tone(freq, freq, 1.0, gain, 'sine', delay, this.echoIn ?? undefined);
    this.tone(freq * 2.01, freq * 2.01, 0.7, gain * 0.35, 'sine', delay, this.echoIn ?? undefined);
  }

  /** a listener heard you */
  growl(delay: number): void {
    this.tone(88, 60, 0.9, 0.3, 'sawtooth', delay, this.echoIn ?? undefined);
    this.noise(0.5, 0.12, 'lowpass', 300, 1, delay, this.echoIn ?? undefined);
  }

  shard(index: number): void {
    const base = 660 * Math.pow(1.122, index);
    this.tone(base, base, 0.6, 0.22, 'sine', 0, this.echoIn ?? undefined);
    this.tone(base * 1.5, base * 1.5, 0.9, 0.1, 'sine', 0.06, this.echoIn ?? undefined);
  }

  stun(): void {
    this.tone(220, 180, 0.35, 0.3, 'square');
    this.noise(0.3, 0.18, 'highpass', 2400, 1);
  }

  hit(): void {
    this.noise(0.35, 0.5, 'lowpass', 700, 1);
    this.tone(200, 55, 0.5, 0.5, 'sawtooth');
  }

  death(): void {
    this.tone(320, 36, 1.4, 0.45, 'sawtooth');
    this.noise(1.2, 0.3, 'lowpass', 400, 1);
    this.tone(60, 30, 1.6, 0.5, 'sine');
  }

  gateOpen(): void {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((n, i) => this.tone(n, n, 1.2, 0.16, 'sine', i * 0.12, this.echoIn ?? undefined));
    this.tone(65, 40, 1.8, 0.5, 'sine');
  }

  cleared(): void {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((n, i) => this.tone(n, n, 1.4, 0.18, 'triangle', i * 0.1));
    this.noise(2.0, 0.12, 'bandpass', 1200, 0.7, 0.3);
  }

  jump(): void {
    this.tone(300, 470, 0.12, 0.1, 'sine');
  }

  land(): void {
    this.tone(95, 55, 0.14, 0.3, 'sine');
    this.noise(0.08, 0.12, 'lowpass', 900, 1);
  }

  dash(): void {
    this.noise(0.24, 0.22, 'highpass', 900, 1);
    this.tone(240, 520, 0.18, 0.08, 'sine');
  }

  click(): void {
    this.tone(740, 620, 0.07, 0.1, 'sine');
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const AUDIO_COLOR_HZ: Record<string, number> = {
  shard: 1150,
  gate: 540,
};

export function colorToHex(c: THREE.Color): string {
  return `#${c.getHexString()}`;
}
