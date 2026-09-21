// NEXUS ARMOR — 2D canvas minimap. Static cover prerendered once per map.
import type { BattleSim } from '../sim/battle'

export class Minimap {
  private ctx: CanvasRenderingContext2D
  private staticLayer: HTMLCanvasElement
  private size = 176

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.staticLayer = document.createElement('canvas')
    this.resize()
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const size = rect.width > 0 ? Math.round(rect.width) : this.size
    this.size = size
    this.canvas.width = size
    this.canvas.height = size
  }

  prerenderStatic(sim: BattleSim): void {
    const c = this.staticLayer
    c.width = this.size
    c.height = this.size
    const g = c.getContext('2d')!
    const half = sim.world.half
    const s = this.size / (half * 2)
    g.fillStyle = 'rgba(20,24,20,0.72)'
    g.fillRect(0, 0, this.size, this.size)
    g.strokeStyle = 'rgba(255,190,90,0.25)'
    g.lineWidth = 1
    g.strokeRect(0.5, 0.5, this.size - 1, this.size - 1)
    g.fillStyle = 'rgba(210,190,140,0.5)'
    for (const p of sim.world.props) {
      g.fillRect((p.x - p.hx + half) * s, (p.z - p.hz + half) * s, p.hx * 2 * s, p.hz * 2 * s)
    }
  }

  draw(sim: BattleSim): void {
    const g = this.ctx
    const half = sim.world.half
    const s = this.size / (half * 2)
    g.clearRect(0, 0, this.size, this.size)
    g.drawImage(this.staticLayer, 0, 0)

    // targets
    for (const t of sim.targets) {
      if (!t.alive) continue
      g.fillStyle = '#ffb03a'
      const r = 3
      g.fillRect((t.x + half) * s - r / 2, (t.z + half) * s - r / 2, r, r)
    }

    // enemies
    for (const e of sim.enemies) {
      g.fillStyle = e.kindId === 'boss' ? '#ff4030' : '#ff6a50'
      const r = e.kindId === 'boss' ? 4.5 : 2.6
      g.beginPath()
      g.arc((e.x + half) * s, (e.z + half) * s, r, 0, Math.PI * 2)
      g.fill()
    }

    // player (triangle with heading)
    const p = sim.player
    const px = (p.x + half) * s
    const pz = (p.z + half) * s
    g.save()
    g.translate(px, pz)
    g.rotate(-p.angle + Math.PI / 2)
    g.fillStyle = '#ffe9b0'
    g.beginPath()
    g.moveTo(0, -5)
    g.lineTo(3.6, 4)
    g.lineTo(-3.6, 4)
    g.closePath()
    g.fill()
    g.restore()

    // aim line
    g.strokeStyle = 'rgba(255,220,140,0.4)'
    g.beginPath()
    g.moveTo(px, pz)
    g.lineTo((p.aimX + half) * s, (p.aimZ + half) * s)
    g.stroke()
  }
}
