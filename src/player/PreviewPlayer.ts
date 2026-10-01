/** Owns the preview clock. It knows nothing about scenes, rendering or recording. */
export class PreviewPlayer {
  private running = false
  private animationFrame = 0
  private lastTimestamp = 0
  private generation = 0
  private readonly onTick: (deltaSeconds: number) => Promise<void>
  private readonly onError: (error: unknown) => void

  constructor(onTick: (deltaSeconds: number) => Promise<void>, onError: (error: unknown) => void) {
    this.onTick = onTick
    this.onError = onError
  }

  get playing(): boolean { return this.running }

  play(): void {
    if (this.running) return
    this.running = true
    this.generation++
    this.lastTimestamp = performance.now()
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  pause(): void {
    this.running = false
    this.generation++
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = 0
  }

  private tick = (timestamp: number): void => {
    this.animationFrame = 0
    if (!this.running) return
    const generation = this.generation
    const delta = Math.max(0, (timestamp - this.lastTimestamp) / 1000)
    this.lastTimestamp = timestamp
    void this.onTick(delta).then(() => {
      if (this.running && generation === this.generation) this.animationFrame = requestAnimationFrame(this.tick)
    }).catch(error => {
      if (generation === this.generation) this.pause()
      this.onError(error)
    })
  }
}
