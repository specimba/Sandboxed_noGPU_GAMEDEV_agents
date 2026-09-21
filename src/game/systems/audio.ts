// NEXUS ARMOR — 100% procedural WebAudio SFX (no asset files; DR-05).
// AudioContext unlocks on first user gesture; every path fails safe (silent).
export class AudioSystem {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private engineOsc: OscillatorNode | null = null
  private engineOsc2: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private ambientSrc: AudioBufferSourceNode | null = null
  disabled = false
  private volume = 0.8
  private sfxScale = 0.9

  /** must be called from a user gesture */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!AC) {
          this.disabled = true
          return
        }
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.volume
        this.master.connect(this.ctx.destination)
        // 1s white noise buffer, reused everywhere
        const len = this.ctx.sampleRate
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
        this.startAmbient()
        this.startEngine()
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.disabled = true
    }
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  private noise(dur: number, filterType: BiquadFilterType, f0: number, f1: number, gain: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const t = this.now() + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const filt = this.ctx.createBiquadFilter()
    filt.type = filterType
    filt.frequency.setValueAtTime(f0, t)
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain * this.sfxScale, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    src.connect(filt).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.05)
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0,
  ): void {
    if (!this.ctx || !this.master) return
    const t = this.now() + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain * this.sfxScale, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  playWeapon(sound: string, big: boolean): void {
    if (this.disabled) return
    switch (sound) {
      case 'autocannon':
        this.noise(0.09, 'bandpass', 1800, 700, 0.5)
        this.tone('square', 220, 90, 0.06, 0.22)
        break
      case 'cannon':
        this.noise(big ? 0.5 : 0.35, 'lowpass', 900, 90, 0.85)
        this.tone('sine', 90, 42, 0.4, 0.7)
        break
      case 'howitzer':
      case 'brute':
        this.noise(0.6, 'lowpass', 700, 60, 0.95)
        this.tone('sine', 70, 34, 0.55, 0.85)
        break
      case 'railgun':
        this.tone('sawtooth', 1100, 160, 0.22, 0.5)
        this.noise(0.2, 'highpass', 3000, 1200, 0.4)
        this.tone('sine', 60, 40, 0.3, 0.5)
        break
      case 'sniper':
        this.noise(0.3, 'bandpass', 2400, 500, 0.7)
        this.tone('sine', 120, 55, 0.3, 0.5)
        break
      default:
        this.noise(0.3, 'lowpass', 800, 100, 0.7)
    }
  }

  explosion(big: boolean): void {
    if (this.disabled) return
    this.noise(big ? 0.9 : 0.55, 'lowpass', 600, 50, big ? 1 : 0.7)
    this.tone('sine', 60, 28, big ? 0.7 : 0.45, big ? 0.9 : 0.6)
    this.noise(0.2, 'bandpass', 2500, 800, 0.4)
  }

  impact(): void {
    if (this.disabled) return
    this.noise(0.1, 'bandpass', 2200, 900, 0.4)
    this.tone('triangle', 300, 120, 0.08, 0.25)
  }

  ping(): void {
    if (this.disabled) return
    this.tone('sine', 2400, 1300, 0.28, 0.4)
    this.tone('sine', 3200, 2000, 0.18, 0.2)
  }

  uiClick(): void {
    if (this.disabled) return
    this.tone('square', 660, 520, 0.05, 0.16)
  }

  ability(): void {
    if (this.disabled) return
    this.tone('sine', 420, 840, 0.18, 0.3)
    this.tone('sine', 630, 1260, 0.22, 0.2, 0.05)
  }

  toastGood(): void {
    if (this.disabled) return
    this.tone('sine', 520, 660, 0.1, 0.22)
    this.tone('sine', 780, 990, 0.14, 0.18, 0.08)
  }

  victory(): void {
    if (this.disabled) return
    const notes = [392, 494, 587, 784]
    notes.forEach((n, i) => this.tone('sine', n, n, 0.28, 0.3, i * 0.14))
  }

  defeat(): void {
    if (this.disabled) return
    this.tone('sine', 220, 160, 0.5, 0.35)
    this.tone('sine', 165, 110, 0.7, 0.3, 0.25)
  }

  private startEngine(): void {
    if (!this.ctx || !this.master) return
    this.engineOsc = this.ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 55
    this.engineOsc2 = this.ctx.createOscillator()
    this.engineOsc2.type = 'square'
    this.engineOsc2.frequency.value = 27
    this.engineFilter = this.ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 240
    this.engineGain = this.ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc.connect(this.engineFilter)
    this.engineOsc2.connect(this.engineFilter)
    this.engineFilter.connect(this.engineGain).connect(this.master)
    this.engineOsc.start()
    this.engineOsc2.start()
  }

  /** speed01: 0..1, throttle: -1..1 */
  setEngine(speed01: number, moving: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return
    const t = this.now()
    const target = this.disabled ? 0 : moving ? 0.035 + speed01 * 0.05 : 0.022
    this.engineGain.gain.setTargetAtTime(target, t, 0.12)
    this.engineOsc.frequency.setTargetAtTime(50 + speed01 * 46, t, 0.15)
    this.engineOsc2!.frequency.setTargetAtTime(25 + speed01 * 22, t, 0.15)
    this.engineFilter.frequency.setTargetAtTime(220 + speed01 * 320, t, 0.2)
  }

  private startAmbient(): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    this.ambientSrc = this.ctx.createBufferSource()
    this.ambientSrc.buffer = this.noiseBuf
    this.ambientSrc.loop = true
    const filt = this.ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.value = 320
    const g = this.ctx.createGain()
    g.gain.value = this.disabled ? 0 : 0.028
    this.ambientSrc.connect(filt).connect(g).connect(this.master)
    this.ambientSrc.start()
  }

  dispose(): void {
    try {
      this.engineOsc?.stop()
      this.engineOsc2?.stop()
      this.ambientSrc?.stop()
      void this.ctx?.close()
    } catch {
      /* noop */
    }
    this.ctx = null
  }
}
