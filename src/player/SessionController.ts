import type { QualityLevel } from 'mediabunny'
import { PreviewPlayer } from './PreviewPlayer.ts'
import type { PixelFrame } from '../rendering/PixelFrame.ts'

export interface SessionRuntime {
  readonly canvas: HTMLCanvasElement
  readonly duration: number
  readonly motionDuration: number
  readonly time: number
  setAnimationLoop(callback: ((timestamp: number) => void) | null): Promise<void>
  reset(): void
  advance(deltaSeconds: number): void
  showFinal(): void
  render(): Promise<void>
  readFrame(): Promise<PixelFrame>
}

export interface FrameRecorder {
  start(width: number, height: number, fps: number, quality: QualityLevel): Promise<void>
  addFrame(frame: PixelFrame, timestamp: number, duration: number): Promise<void>
  finish(): Promise<Blob>
  abort(): Promise<void>
}

export interface PlaybackState { time: number; playing: boolean; showingFinal: boolean }

/** The only caller of scene updates/rendering, and the owner of preview/record transitions. */
export class SessionController {
  private mode: 'preview' | 'record' | 'update' | 'disposed' = 'preview'
  private readonly runtime: SessionRuntime
  private readonly recorder: FrameRecorder
  private readonly clock: PreviewPlayer
  private readonly onState: (state: PlaybackState) => void
  private readonly onError: (error: unknown) => void
  private pending: Promise<void> | null = null
  private operation: Promise<unknown> | null = null
  private finalView = false
  private cancelled = false
  private drawing = false
  private requestedDraw: { resolve: () => void; reject: (error: unknown) => void } | null = null

  constructor(runtime: SessionRuntime, recorder: FrameRecorder,
    onState: (state: PlaybackState) => void, onError: (error: unknown) => void) {
    this.runtime = runtime
    this.recorder = recorder
    this.onState = onState
    this.onError = onError
    this.clock = new PreviewPlayer()
    void runtime.setAnimationLoop(this.animationFrame).catch(error => this.onError(error))
  }

  get state(): PlaybackState {
    return { time: this.finalView ? this.runtime.motionDuration : this.runtime.time, playing: this.clock.playing, showingFinal: this.finalView }
  }
  private get disposed(): boolean { return this.mode === 'disposed' }

  play(): void {
    if (this.mode !== 'preview') return
    if (this.finalView) { this.runtime.reset(); this.finalView = false }
    this.clock.play()
    this.notify()
  }

  pause(): void {
    if (this.mode !== 'preview') return
    this.clock.pause()
    this.notify()
  }

  async restart(): Promise<void> {
    await this.update(() => this.runtime.reset(), true)
    this.play()
  }

  async showFinal(): Promise<void> {
    this.pause()
    await this.update(() => { this.runtime.showFinal(); this.finalView = true })
  }

  update(action: () => void | Promise<void>, resetPlayback = false): Promise<void> {
    return this.track(() => this.performUpdate(action, resetPlayback))
  }

  private async performUpdate(action: () => void | Promise<void>, resetPlayback: boolean): Promise<void> {
    const wasPlaying = await this.enter('update')
    try {
      await action()
      if (resetPlayback) this.finalView = false
      if (!this.disposed) await this.requestDraw()
    } finally { this.leave(wasPlaying) }
  }

  record(fps: number, onProgress: (progress: number) => void, quality: QualityLevel = 'high'): Promise<Blob> {
    return this.track(() => this.recordFrames(fps, onProgress, quality))
  }

  private async recordFrames(fps: number, onProgress: (progress: number) => void, quality: QualityLevel): Promise<Blob> {
    if (!Number.isInteger(fps) || fps <= 0) throw new Error('Invalid frame rate.')
    this.cancelled = false
    const wasPlaying = await this.enter('record')
    try {
      this.runtime.reset()
      this.finalView = false
      await this.recorder.start(this.runtime.canvas.width, this.runtime.canvas.height, fps, quality)
      const frameCount = Math.ceil(this.runtime.duration * fps)
      for (let frame = 0; frame < frameCount; frame++) {
        this.checkCancelled()
        const timestamp = frame / fps
        this.runtime.advance(Math.max(0, timestamp - this.runtime.time))
        await this.requestDraw()
        this.checkCancelled()
        const pixels = await this.runtime.readFrame()
        this.checkCancelled()
        await this.recorder.addFrame(pixels, timestamp, 1 / fps)
        onProgress((frame + 1) / frameCount)
      }
      this.checkCancelled()
      const blob = await this.recorder.finish()
      this.checkCancelled()
      return blob
    } finally {
      try { await this.recorder.abort() }
      finally {
        try {
          if (!this.disposed) { this.runtime.reset(); await this.requestDraw() }
        } finally { this.leave(wasPlaying) }
      }
    }
  }

  cancelRecording(): void { if (this.mode === 'record') this.cancelled = true }

  async dispose(): Promise<void> {
    this.cancelled = true
    this.mode = 'disposed'
    this.clock.pause()
    const request = this.requestedDraw
    this.requestedDraw = null
    request?.reject(new DOMException('Session disposed.', 'AbortError'))
    try { if (this.pending) await this.pending } catch { /* Already reported by the preview clock. */ }
    try { await this.operation } catch { /* The caller reports operation failures. */ }
    await this.runtime.setAnimationLoop(null)
  }

  private async enter(mode: 'update' | 'record'): Promise<boolean> {
    if (this.mode !== 'preview') throw new Error('The scene is busy.')
    this.mode = mode
    const wasPlaying = this.clock.playing
    this.clock.pause()
    try {
      if (this.pending) await this.pending
      if (this.disposed) throw new DOMException('Session disposed.', 'AbortError')
    } catch (error) {
      this.leave(false)
      throw error
    }
    this.notify()
    return wasPlaying
  }

  private leave(wasPlaying: boolean): void {
    if (this.disposed) return
    this.mode = 'preview'
    if (wasPlaying) this.clock.play()
    this.notify()
  }

  private track<T>(action: () => Promise<T>): Promise<T> {
    if (this.mode !== 'preview') return Promise.reject(new Error('The scene is busy.'))
    const operation = action()
    this.operation = operation
    return operation.finally(() => { if (this.operation === operation) this.operation = null })
  }

  // Only this callback submits scene draws, after Three has advanced its frame ID.
  private animationFrame = (timestamp: number): void => {
    if (this.drawing || this.pending) return
    const request = this.requestedDraw
    if (request) {
      this.requestedDraw = null
      this.drawing = true
      void this.runtime.render().then(() => {
        this.drawing = false
        request.resolve()
      }, error => {
        this.drawing = false
        request.reject(error)
      })
      return
    }
    if (this.mode !== 'preview') return
    const delta = this.clock.tick(timestamp)
    if (delta === null) return
    void this.previewTick(delta).catch(error => {
      this.clock.pause()
      this.onError(error)
      this.notify()
    })
  }

  private requestDraw(): Promise<void> {
    if (this.requestedDraw) return Promise.reject(new Error('A scene draw is already queued.'))
    return new Promise((resolve, reject) => { this.requestedDraw = { resolve, reject } })
  }

  private async previewTick(delta: number): Promise<void> {
    if (this.mode !== 'preview') return Promise.resolve()
    const duration = this.runtime.duration
    if (duration > 0 && this.runtime.time + delta >= duration) {
      const remainder = (this.runtime.time + delta) % duration
      this.runtime.reset()
      this.runtime.advance(remainder)
    } else this.runtime.advance(delta)
    const pending = this.runtime.render().then(() => { if (this.mode === 'preview') this.notify() })
    this.pending = pending
    return pending.finally(() => { if (this.pending === pending) this.pending = null })
  }

  private checkCancelled(): void {
    if (this.cancelled || this.disposed) throw new DOMException('書き出しをキャンセルしました。', 'AbortError')
  }

  private notify(): void { if (!this.disposed) this.onState(this.state) }
}
