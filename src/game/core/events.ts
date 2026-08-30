// NEXUS ARMOR — typed EventBus. Sim/render publish; UI subscribes. No React coupling.
import type { GameEvent } from './types'

type Handler = (e: GameEvent) => void

export class EventBus {
  private handlers = new Set<Handler>()

  on(h: Handler): () => void {
    this.handlers.add(h)
    return () => {
      this.handlers.delete(h)
    }
  }

  emit(e: GameEvent): void {
    for (const h of this.handlers) {
      try {
        h(e)
      } catch (err) {
        // One bad subscriber must never break the game loop.
        console.error('[events] handler error', err)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
