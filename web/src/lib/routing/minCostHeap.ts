interface HeapEntry {
  cost: number
}

/** Min-Heap für Dijkstra — O(log n) statt sortierter Queue pro Schritt. */
export class MinCostHeap<T extends HeapEntry> {
  private data: T[] = []

  get size(): number {
    return this.data.length
  }

  push(entry: T): void {
    this.data.push(entry)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.sinkDown(0)
    }
    return top
  }

  private bubbleUp(index: number): void {
    let i = index
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.data[parent].cost <= this.data[i].cost) break
      ;[this.data[parent], this.data[i]] = [this.data[i], this.data[parent]]
      i = parent
    }
  }

  private sinkDown(index: number): void {
    let i = index
    const n = this.data.length
    while (true) {
      let smallest = i
      const left = 2 * i + 1
      const right = 2 * i + 2
      if (left < n && this.data[left].cost < this.data[smallest].cost) smallest = left
      if (right < n && this.data[right].cost < this.data[smallest].cost) smallest = right
      if (smallest === i) break
      ;[this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]]
      i = smallest
    }
  }
}
