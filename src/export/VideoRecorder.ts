import { BufferTarget, VideoSample, VideoSampleSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny'
import type { PixelFrame } from '../rendering/PixelFrame.ts'

/** Encodes submitted frames. Frame times and scene updates belong to the session. */
export class VideoRecorder {
  private output: Output | null = null
  private source: VideoSampleSource | null = null
  private target: BufferTarget | null = null

  async start(width: number, height: number, fps: number): Promise<void> {
    if (this.output) throw new Error('Recording is already active.')
    const quality = new Quality('high')
    if (!await canEncodeVideo('avc', { width, height, quality, frameRate: fps })) {
      throw new Error('このブラウザは指定解像度のH.264書き出しに対応していません。別のブラウザまたは解像度をお試しください。')
    }
    this.target = new BufferTarget()
    this.output = new Output({ target: this.target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) })
    this.source = new VideoSampleSource({ codec: 'avc', quality })
    this.output.addVideoTrack(this.source, { frameRate: fps })
    await this.output.start()
  }

  async addFrame(frame: PixelFrame, timestamp: number, duration: number): Promise<void> {
    if (!this.source) throw new Error('Recording has not started.')
    const sample = new VideoSample(frame.pixels, {
      format: 'RGBA', codedWidth: frame.width, codedHeight: frame.height, timestamp, duration,
      colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
    })
    try { await this.source.add(sample) }
    finally { sample.close() }
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
