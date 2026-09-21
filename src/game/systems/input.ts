// NEXUS ARMOR — input: keyboard + mouse + touch → PlayerInput building blocks.
// The engine computes the world-space aim (raycast) and writes it into the sim.
export interface TouchStick {
  id: number
  ox: number
  oy: number
  dx: number
  dy: number
}

export class InputSystem {
  private keys = new Set<string>()
  mouseDown = false
  aimNDC = { x: 0, y: -0.5 }
  /** touch mode detected on first touchstart */
  touchMode = false
  private moveStick: TouchStick | null = null
  private aimStick: TouchStick | null = null
  fireBtn = false // set by TouchControls buttons
  abilityBtn = false
  enabled = false // capture only during battle
  private el: HTMLElement | null = null

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    const c = e.code
    if (GAME_KEYS.has(c)) e.preventDefault()
    this.keys.add(c)
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }
  private onMouseMove = (e: MouseEvent) => {
    if (!this.el || !this.enabled) return
    const r = this.el.getBoundingClientRect()
    this.aimNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1
    this.aimNDC.y = -(((e.clientY - r.top) / r.height) * 2 - 1)
  }
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && this.enabled) this.mouseDown = true
  }
  private onMouseUp = () => {
    this.mouseDown = false
  }
  private onTouchStart = (e: TouchEvent) => {
    if (!this.enabled) return
    this.touchMode = true
    const r = this.el!.getBoundingClientRect()
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - r.left
      const y = t.clientY - r.top
      if (x < r.width * 0.45 && !this.moveStick) {
        this.moveStick = { id: t.identifier, ox: x, oy: y, dx: 0, dy: 0 }
      } else if (!this.aimStick) {
        this.aimStick = { id: t.identifier, ox: x, oy: y, dx: 0, dy: 0 }
      }
    }
    e.preventDefault()
  }
  private onTouchMove = (e: TouchEvent) => {
    if (!this.enabled) return
    const r = this.el!.getBoundingClientRect()
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - r.left
      const y = t.clientY - r.top
      if (this.moveStick && t.identifier === this.moveStick.id) {
        this.moveStick.dx = clampA(x - this.moveStick.ox, -70, 70)
        this.moveStick.dy = clampA(y - this.moveStick.oy, -70, 70)
      } else if (this.aimStick && t.identifier === this.aimStick.id) {
        this.aimStick.dx = x - this.aimStick.ox
        this.aimStick.dy = y - this.aimStick.oy
      }
    }
    e.preventDefault()
  }
  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (this.moveStick && t.identifier === this.moveStick.id) this.moveStick = null
      if (this.aimStick && t.identifier === this.aimStick.id) this.aimStick = null
    }
  }

  attach(el: HTMLElement): void {
    this.el = el
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    el.addEventListener('touchstart', this.onTouchStart, { passive: false })
    el.addEventListener('touchmove', this.onTouchMove, { passive: false })
    el.addEventListener('touchend', this.onTouchEnd)
    el.addEventListener('touchcancel', this.onTouchEnd)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    if (this.el) {
      this.el.removeEventListener('touchstart', this.onTouchStart)
      this.el.removeEventListener('touchmove', this.onTouchMove)
      this.el.removeEventListener('touchend', this.onTouchEnd)
      this.el.removeEventListener('touchcancel', this.onTouchEnd)
    }
    this.el = null
  }

  /** world-space aim direction for touch (unit vector) or null when using mouse */
  touchAimDir(): { x: number; z: number } | null {
    if (!this.touchMode) return null
    if (this.aimStick && Math.hypot(this.aimStick.dx, this.aimStick.dy) > 14) {
      const len = Math.hypot(this.aimStick.dx, this.aimStick.dy)
      return { x: this.aimStick.dx / len, z: this.aimStick.dy / len }
    }
    return null
  }

  collect(): { throttle: number; steer: number; fire: boolean; brake: boolean; ability: boolean } {
    let throttle = 0
    let steer = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1

    let fire = this.mouseDown
    let brake = this.keys.has('Space')
    let ability = this.keys.has('KeyE')

    if (this.touchMode && this.moveStick) {
      throttle = clampA(-this.moveStick.dy / 48, -1, 1)
      steer = clampA(this.moveStick.dx / 48, -1, 1)
    }
    if (this.fireBtn) fire = true
    if (this.abilityBtn) ability = true

    return { throttle, steer, fire, brake, ability }
  }

  releaseAll(): void {
    this.keys.clear()
    this.mouseDown = false
    this.fireBtn = false
    this.abilityBtn = false
    this.moveStick = null
    this.aimStick = null
  }
}

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyE', 'KeyQ', 'KeyR',
])

function clampA(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
