import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny'

/** Encodes submitted frames. Frame times and scene updates belong to the session. */
export class VideoRecorder {
  private output: Output | null = null
  private source: CanvasSource | null = null
  private target: BufferTarget | null = null

  async start(canvas: HTMLCanvasElement, fps: number): Promise<void> {
    if (this.output) throw new Error('Recording is already active.')
    const quality = new Quality('high')
    if (!await canEncodeVideo('avc', { width: canvas.width, height: canvas.height, quality, frameRate: fps })) {
      throw new Error('このブラウザは指定解像度のH.264書き出しに対応していません。別のブラウザまたは解像度をお試しください。')
    }
    this.target = new BufferTarget()
    this.output = new Output({ target: this.target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) })
    this.source = new CanvasSource(canvas, { codec: 'avc', quality })
    this.output.addVideoTrack(this.source, { frameRate: fps })
    await this.output.start()
  }

  async addFrame(timestamp: number, duration: number): Promise<void> {
    if (!this.source) throw new Error('Recording has not started.')
    await this.source.add(timestamp, duration)
  }

  async finish(): Promise<Blob> {
    if (!this.output || !this.source || !this.target) throw new Error('Recording has not started.')
    this.source.close()
    await this.output.finalize()
    if (!this.target.buffer) throw new Error('動画データを生成できませんでした。')
    const blob = new Blob([this.target.buffer], { type: 'video/mp4' })
    this.release()
    return blob
  }

  async abort(): Promise<void> {
    this.source?.close()
    try {
      if (this.output && this.output.state !== 'finalized' && this.output.state !== 'canceled') await this.output.cancel()
    } finally { this.release() }
  }

  private release(): void { this.output = null; this.source = null; this.target = null }
}
