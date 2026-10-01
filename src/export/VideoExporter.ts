import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny'
import { ScenePlayer } from '../player/ScenePlayer.ts'

export class VideoExporter {
  private cancelled = false

  cancel(): void { this.cancelled = true }

  async export(player: ScenePlayer, fps: number, onProgress: (progress: number) => void): Promise<Blob> {
    this.cancelled = false
    const size = player.outputSize
    const quality = new Quality('high')
    const config = { width: size, height: size, quality, frameRate: fps }
    if (!await canEncodeVideo('avc', config)) {
      throw new Error('このブラウザは指定解像度のH.264書き出しに対応していません。別のブラウザまたは解像度をお試しください。')
    }
    if (this.cancelled) throw new DOMException('書き出しをキャンセルしました。', 'AbortError')
    const target = new BufferTarget()
    const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) })
    const source = new CanvasSource(player.canvas, { codec: 'avc', quality })
    output.addVideoTrack(source, { frameRate: fps })
    try {
      await output.start()
      const frameCount = Math.ceil(player.duration * fps)
      for (let frame = 0; frame < frameCount; frame++) {
        if (this.cancelled) throw new DOMException('書き出しをキャンセルしました。', 'AbortError')
        await player.renderAt(frame / fps)
        await source.add(frame / fps, 1 / fps)
        onProgress((frame + 1) / frameCount)
        if (frame % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
      source.close()
      await output.finalize()
      if (this.cancelled) throw new DOMException('書き出しをキャンセルしました。', 'AbortError')
      if (!target.buffer) throw new Error('動画データを生成できませんでした。')
      return new Blob([target.buffer], { type: 'video/mp4' })
    } catch (error) {
      source.close()
      if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
      throw error
    }
  }
}
