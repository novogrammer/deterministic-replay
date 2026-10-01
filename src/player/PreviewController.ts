import { ScenePlayer } from './ScenePlayer.ts'

export interface PreviewState { time: number; playing: boolean }

export class PreviewController {
  private time = 0
  private playing = false
  private suspended = false
  private pending: Promise<void> | null = null
  private animationFrame = 0
  private lastTimestamp = 0
  private readonly player: ScenePlayer
  private readonly onFrame: (state: PreviewState) => void
  private readonly onError: (error: unknown) => void

  constructor(player: ScenePlayer, onFrame: (state: PreviewState) => void, onError: (error: unknown) => void) {
    this.player = player
    this.onFrame = onFrame
    this.onError = onError
  }

  get state(): PreviewState { return { time: this.time, playing: this.playing } }

  start(): void {
    if (this.animationFrame) return
    this.lastTimestamp = performance.now()
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  play(): void {
    if (this.suspended) return
    this.playing = true
    this.lastTimestamp = performance.now()
    this.onFrame(this.state)
  }

  pause(): void {
    this.playing = false
    this.onFrame(this.state)
  }

  seek(time: number): void {
    this.time = Math.max(0, Math.min(time, this.player.duration))
    this.lastTimestamp = performance.now()
    this.onFrame(this.state)
  }

  async suspend(): Promise<PreviewState> {
    const state = this.state
    this.suspended = true
    if (this.pending) await this.pending
    return state
  }

  async restore(state: PreviewState): Promise<void> {
    this.time = state.time
    this.playing = state.playing
    try {
      await this.player.renderAt(this.time)
    } finally {
      this.suspended = false
      this.lastTimestamp = performance.now()
      this.onFrame(this.state)
    }
  }

  private tick = (timestamp: number): void => {
    this.animationFrame = requestAnimationFrame(this.tick)
    const delta = Math.max(0, (timestamp - this.lastTimestamp) / 1000)
    if (this.suspended || this.pending) return
    this.lastTimestamp = timestamp
    if (this.playing && this.player.duration > 0) {
      this.time = (this.time + delta) % this.player.duration
    }
    this.pending = this.player.renderAt(this.time)
      .then(() => this.onFrame(this.state))
      .catch(error => { this.pause(); this.onError(error) })
      .finally(() => { this.pending = null })
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = 0
  }
}
