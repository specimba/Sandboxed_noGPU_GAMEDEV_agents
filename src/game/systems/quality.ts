// NEXUS ARMOR — adaptive quality: EMA frame-time monitor with hysteresis (DR-10).
import { AUTO_DOWN_MS, AUTO_DOWN_SECS, AUTO_UP_MS, AUTO_UP_SECS } from '../config/balance'
import type { AutoQuality, QualityTier } from '../core/types'

const ORDER: QualityTier[] = ['low', 'medium', 'high']

export class QualityManager {
  tier: QualityTier = 'high'
  auto: boolean
  private ema = 16
  private downT = 0
  private upT = 0
  private onChange: (tier: QualityTier) => void

  constructor(setting: AutoQuality, onChange: (tier: QualityTier) => void) {
    this.auto = setting === 'auto'
    this.tier = setting === 'auto' ? 'high' : setting
    this.onChange = onChange
  }

  setSetting(setting: AutoQuality): void {
    this.auto = setting === 'auto'
    if (!this.auto) {
      this.tier = setting as QualityTier
      this.onChange(this.tier)
    }
  }

  update(dtReal: number, frameMs: number): void {
    this.ema += (frameMs - this.ema) * 0.06
    if (!this.auto) return
    const idx = ORDER.indexOf(this.tier)

    if (this.ema > AUTO_DOWN_MS && idx > 0) {
      this.downT += dtReal
      if (this.downT >= AUTO_DOWN_SECS) {
        this.tier = ORDER[idx - 1]
        this.downT = 0
        this.upT = 0
        this.onChange(this.tier)
      }
    } else {
      this.downT = 0
    }

    if (this.ema < AUTO_UP_MS && idx < ORDER.length - 1) {
      this.upT += dtReal
      if (this.upT >= AUTO_UP_SECS) {
        this.tier = ORDER[idx + 1]
        this.upT = 0
        this.downT = 0
        this.onChange(this.tier)
      }
    } else {
      this.upT = 0
    }
  }
}
