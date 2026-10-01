import { Texture } from 'three/webgpu'
import { SceneRegistry } from './scenes/SceneRegistry.ts'
import { SceneRuntime } from './player/SceneRuntime.ts'
import { SessionController } from './player/SessionController.ts'
import type { PlaybackState } from './player/SessionController.ts'
import { VideoRecorder } from './export/VideoRecorder.ts'

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`Missing HTML element: ${selector}`)
  return node
}

function formatTime(seconds: number): string { return `${seconds.toFixed(1)}s` }

export class App {
  private readonly registry = new SceneRegistry()
  private readonly runtime = new SceneRuntime(element<HTMLCanvasElement>('#preview'))
  private readonly session = new SessionController(this.runtime, new VideoRecorder(), state => this.updatePlayback(state), error => this.showError(error))
  private readonly sceneSelect = element<HTMLSelectElement>('#scene')
  private readonly imageInput = element<HTMLInputElement>('#image')
  private readonly playButton = element<HTMLButtonElement>('#play')
  private readonly finishButton = element<HTMLButtonElement>('#finish')
  private readonly restartButton = element<HTMLButtonElement>('#restart')
  private readonly resolution = element<HTMLSelectElement>('#resolution')
  private readonly exportButton = element<HTMLButtonElement>('#export')
  private readonly cancelButton = element<HTMLButtonElement>('#cancel')
  private readonly download = element<HTMLAnchorElement>('#download')
  private readonly progress = element<HTMLProgressElement>('#progress')
  private readonly status = element<HTMLElement>('#status')
  private readonly error = element<HTMLElement>('#error')
  private busy = true
  private imageBitmap: ImageBitmap | null = null
  private downloadUrl: string | null = null

  async init(): Promise<void> {
    this.bindEvents()
    this.setBusy(true)
    try {
      await this.runtime.init()
      await this.selectScene(this.sceneSelect.value)
      this.session.play()
    } catch (error) {
      this.showError(error)
      this.setBusy(true)
    }
  }

  private bindEvents(): void {
    this.playButton.addEventListener('click', () => {
      if (this.session.state.playing) this.session.pause()
      else this.session.play()
    })
    this.restartButton.addEventListener('click', () => { void this.session.restart().catch(error => this.showError(error)) })
    this.finishButton.addEventListener('click', () => { void this.session.showFinal().catch(error => this.showError(error)) })
    this.sceneSelect.addEventListener('change', () => { void this.selectScene(this.sceneSelect.value).catch(error => this.showError(error)) })
    this.imageInput.addEventListener('change', () => { void this.loadImage().catch(error => this.showError(error)) })
    this.resolution.addEventListener('change', () => { void this.resize().catch(error => this.showError(error)) })
    element<HTMLSelectElement>('#fps').addEventListener('change', () => this.clearDownload())
    this.exportButton.addEventListener('click', () => { void this.exportVideo() })
    this.cancelButton.addEventListener('click', () => this.session.cancelRecording())
    window.addEventListener('pagehide', () => { void this.dispose() }, { once: true })
  }

  private async selectScene(id: string): Promise<void> {
    this.setBusy(true)
    try {
      await this.session.update(async () => {
        const scene = await this.registry.create(id)
        this.runtime.loadScene(scene)
        element<HTMLElement>('#scene-title').textContent = scene.title
        element<HTMLElement>('#sphere-count').textContent = String(scene.count)
        element<HTMLElement>('#duration').textContent = formatTime(this.runtime.duration)
      }, true)
      this.status.textContent = this.runtime.baked ? '繰り返し再生 · 画像は端末内で処理されます' : '未ベイク · 単色でシミュレーションを表示しています'
      this.clearDownload()
      this.error.hidden = true
    } finally { this.setBusy(false) }
  }

  private async loadImage(): Promise<void> {
    const file = this.imageInput.files?.[0]
    if (!file || this.busy) return
    this.setBusy(true)
    const decoded: { bitmap: ImageBitmap | null } = { bitmap: null }
    try {
      await this.session.update(async () => {
        decoded.bitmap = await createImageBitmap(file, { imageOrientation: 'flipY' })
        if (decoded.bitmap.width !== decoded.bitmap.height) throw new Error('正方形の画像を選んでください。')
        const texture = new Texture(decoded.bitmap)
        texture.flipY = false
        texture.needsUpdate = true
        this.runtime.setTexture(texture)
        this.imageBitmap?.close()
        this.imageBitmap = decoded.bitmap
        decoded.bitmap = null
      })
      element<HTMLElement>('#image-name').textContent = file.name
      this.error.hidden = true
      this.clearDownload()
    } finally {
      decoded.bitmap?.close()
      this.imageInput.value = ''
      this.setBusy(false)
    }
  }

  private async resize(): Promise<void> {
    this.setBusy(true)
    try {
      await this.session.update(() => this.runtime.setOutputSize(Number(this.resolution.value)))
      this.clearDownload()
    } finally { this.setBusy(false) }
  }

  private async exportVideo(): Promise<void> {
    if (this.busy) return
    this.setBusy(true)
    this.error.hidden = true
    this.clearDownload()
    this.progress.hidden = false
    this.progress.value = 0
    this.cancelButton.hidden = false
    try {
      const fps = Number(element<HTMLSelectElement>('#fps').value)
      const blob = await this.session.record(fps, value => {
        this.progress.value = value
        this.status.textContent = `MP4を書き出し中 · ${Math.round(value * 100)}%`
      })
      this.downloadUrl = URL.createObjectURL(blob)
      this.download.href = this.downloadUrl
      this.download.download = `${this.runtime.sceneId}-${this.runtime.outputSize}-${fps}fps.mp4`
      this.download.hidden = false
      this.status.textContent = 'MP4ができました。ダウンロードして保存できます。'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') this.status.textContent = '書き出しをキャンセルしました。'
      else this.showError(error)
    } finally {
      this.progress.hidden = true
      this.cancelButton.hidden = true
      this.setBusy(false)
    }
  }

  private updatePlayback(state: PlaybackState): void {
    element<HTMLElement>('#current-time').textContent = formatTime(state.time)
    this.playButton.textContent = state.showingFinal ? '先頭から再生' : state.playing ? '一時停止' : '再生'
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    for (const node of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[data-control]')) node.disabled = busy
    this.finishButton.disabled = busy || !this.runtime.baked
    element<HTMLElement>('#workspace').setAttribute('aria-busy', String(busy))
  }

  private showError(error: unknown): void {
    this.error.textContent = error instanceof Error ? error.message : String(error)
    this.error.hidden = false
  }

  private clearDownload(): void {
    this.download.hidden = true
    this.download.removeAttribute('href')
    if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl)
    this.downloadUrl = null
  }

  private async dispose(): Promise<void> {
    await this.session.dispose()
    this.runtime.dispose()
    this.imageBitmap?.close()
    this.clearDownload()
  }
}
