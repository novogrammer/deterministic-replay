import {
  MeshBasicNodeMaterial, SRGBColorSpace, Texture, TextureLoader,
  WebGPURenderer, NoToneMapping, RenderTarget, UnsignedByteType, QuadMesh,
} from 'three/webgpu'
import { sRGBTransferEOTF, texture, vec3 } from 'three/tsl'
import type { SimulationScene } from '../scenes/SimulationScene.ts'
import { packRgbaRows } from '../rendering/PixelFrame.ts'
import type { PixelFrame } from '../rendering/PixelFrame.ts'

export class SceneRuntime {
  readonly renderer: WebGPURenderer
  readonly canvas: HTMLCanvasElement
  private activeScene: SimulationScene | null = null
  private currentTexture: Texture | null = null
  private elapsed = 0
  private showingFinal = false
  // The output pass writes sRGB bytes. An sRGB GPU attachment would encode them a second time.
  private readonly frameTarget = new RenderTarget(1024, 1024, { type: UnsignedByteType })
  private readonly displayMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false })
  private readonly display = new QuadMesh(this.displayMaterial)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(1024, 1024, false)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = NoToneMapping
    this.renderer.shadowMap.enabled = true
    // Three's transfer-function types do not preserve the input's vec3 type.
    this.displayMaterial.colorNode = sRGBTransferEOTF(texture(this.frameTarget.texture).rgb) as ReturnType<typeof vec3>
  }

  async init(): Promise<void> {
    await this.renderer.init()
    const sample = await new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}images/replay-sample.svg`)
    this.setTexture(sample)
  }

  get outputSize(): number { return this.canvas.width }
  get duration(): number { return this.motionDuration + (this.activeScene?.holdSeconds ?? 0) }
  get motionDuration(): number { return this.activeScene?.motionDuration ?? 0 }
  get sceneId(): string { return this.activeScene?.id ?? '' }
  get baked(): boolean { return this.activeScene?.baked ?? false }
  get time(): number { return this.elapsed }

  setOutputSize(size: number): void {
    this.frameTarget.setSize(size, size)
    this.renderer.setSize(size, size, false)
    this.canvas.style.setProperty('--output-size', `${size}px`)
  }

  setTexture(image: Texture): void {
    image.colorSpace = SRGBColorSpace
    this.activeScene?.setTexture(image)
    this.currentTexture?.dispose()
    this.currentTexture = image
  }

  loadScene(scene: SimulationScene): void {
    this.activeScene?.dispose()
    this.activeScene = scene
    if (this.currentTexture) scene.setTexture(this.currentTexture)
    this.reset()
  }

  reset(): void {
    this.elapsed = 0
    this.showingFinal = false
    this.activeScene?.reset()
  }

  advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Scene only advances forward.')
    if (this.showingFinal) throw new Error('Restart before playing the final pose view.')
    this.elapsed = Math.min(this.elapsed + deltaSeconds, this.duration)
    const scene = this.activeScene
    if (!scene) return
    const sampleTime = Math.min(this.elapsed, scene.motionDuration) / scene.timeStep
    const frame = Math.min(Math.floor(sampleTime), Math.round(scene.motionDuration / scene.timeStep))
    while (scene.stepIndex < frame) scene.step()
    scene.updateView(sampleTime - frame)
  }

  showFinal(): void {
    this.activeScene?.showFinal()
    this.showingFinal = true
  }

  async render(): Promise<void> {
    if (!this.activeScene) return
    // The retained output target uses the same output conversion/MSAA as the canvas.
    this.renderer.setOutputRenderTarget(this.frameTarget)
    try { this.renderer.render(this.activeScene.scene, this.activeScene.camera) }
    finally {
      // The renderer's output pass also changes the active render target.
      this.renderer.setRenderTarget(null)
      this.renderer.setOutputRenderTarget(null)
    }
    this.display.render(this.renderer)
    const backend = this.renderer.backend as typeof this.renderer.backend & { device?: GPUDevice }
    if (backend.device) await backend.device.queue.onSubmittedWorkDone()
  }

  async readFrame(): Promise<PixelFrame> {
    const { width, height } = this.frameTarget
    const pixels = await this.renderer.readRenderTargetPixelsAsync(this.frameTarget, 0, 0, width, height)
    if (!(pixels instanceof Uint8Array)) throw new Error('Expected an RGBA8 render target.')
    const backend = this.renderer.backend as typeof this.renderer.backend & { isWebGLBackend?: boolean }
    return { width, height, pixels: packRgbaRows(pixels, width, height, backend.isWebGLBackend === true) }
  }

  dispose(): void {
    this.activeScene?.dispose()
    this.currentTexture?.dispose()
    this.frameTarget.dispose()
    this.displayMaterial.dispose()
    this.renderer.dispose()
  }
}
