// NEXUS ARMOR — generic object pool. Zero-allocation recycling for hot paths.
export class Pool<T> {
  private items: T[] = []
  private used = new Set<T>()
  constructor(private factory: () => T, prewarm = 0) {
    for (let i = 0; i < prewarm; i++) this.items.push(factory())
  }
  acquire(): T {
    const item = this.items.pop() ?? this.factory()
    this.used.add(item)
    return item
  }
  release(item: T): void {
    if (this.used.delete(item)) this.items.push(item)
  }
  get activeCount(): number {
    return this.used.size
  }
  get pooledCount(): number {
    return this.items.length
  }
}
