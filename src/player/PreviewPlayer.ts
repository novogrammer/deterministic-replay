/** Owns the preview clock; timestamps are supplied by the renderer's animation loop. */
export class PreviewPlayer {
  private running = false
  private lastTimestamp = 0

  get playing(): boolean { return this.running }

  play(): void {
    if (this.running) return
    this.running = true
    this.lastTimestamp = performance.now()
  }

  pause(): void { this.running = false }

  tick(timestamp: number): number | null {
    if (!this.running) return null
    const delta = Math.max(0, (timestamp - this.lastTimestamp) / 1000)
    this.lastTimestamp = timestamp
    return delta
  }
}
