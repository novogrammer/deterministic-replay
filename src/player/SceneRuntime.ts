import {
  BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial,
  OrthographicCamera, Quaternion, Scene, SphereGeometry, SRGBColorSpace,
  Texture, TextureLoader, Vector3, WebGPURenderer, InstancedBufferAttribute,
  NoToneMapping, DynamicDrawUsage,
} from 'three/webgpu'
import { attribute, instancedBufferAttribute, mat4, normalView, texture, uniform, varying, vec4 } from 'three/tsl'
import type { SceneDefinition } from '../scenes/SceneDefinition.ts'
import { ReplayData } from '../replay/ReplayData.ts'

export class SceneRuntime {
  readonly renderer: WebGPURenderer
  readonly canvas: HTMLCanvasElement
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-4.7, 4.7, 4.7, -4.7, 0.1, 100)
  private readonly textureNode = texture(new Texture())
  private currentTexture: Texture | null = null
  private content: Group | null = null
  private spheres: InstancedMesh | null = null
  private definition: SceneDefinition | null = null
  private replay: ReplayData | null = null
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly nextRotation = new Quaternion()
  private readonly scale = new Vector3()
  private elapsed = 0
  private showingFinal = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(1024, 1024, false)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = NoToneMapping
    this.scene.background = new Color('#171a1c')
    this.camera.position.set(0, 0, 20)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
  }

  async init(): Promise<void> {
    await this.renderer.init()
    const sample = await new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}images/sample.svg`)
    this.setTexture(sample)
  }

  get outputSize(): number { return this.canvas.width }
  get duration(): number { return (this.replay?.duration ?? 0) + (this.definition?.holdSeconds ?? 0) }
  get motionDuration(): number { return this.replay?.duration ?? 0 }
  get sceneId(): string { return this.definition?.id ?? '' }
  get time(): number { return this.elapsed }

  setOutputSize(size: number): void {
    this.renderer.setSize(size, size, false)
    this.canvas.style.setProperty('--output-size', `${size}px`)
  }

  setTexture(image: Texture): void {
    image.colorSpace = SRGBColorSpace
    this.textureNode.value = image
    this.currentTexture?.dispose()
    this.currentTexture = image
  }

  loadScene(definition: SceneDefinition, replay: ReplayData): void {
    this.disposeContent()
    this.definition = definition
    this.replay = replay
    const half = definition.cameraHalfSize
    Object.assign(this.camera, { left: -half, right: half, top: half, bottom: -half })
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    const finalViewProjection = this.camera.projectionMatrix.clone().multiply(this.camera.matrixWorldInverse)

    const geometry = new SphereGeometry(1, 20, 14)
    const columns = Array.from({ length: 4 }, (_, column) => {
      const values = new Float32Array(definition.count * 4)
      for (let id = 0; id < definition.count; id++) {
        values.set(replay.metadata.finalMatrices.slice(id * 16 + column * 4, id * 16 + column * 4 + 4), id * 4)
      }
      const attribute = new InstancedBufferAttribute(values, 4)
      geometry.setAttribute(`finalColumn${column}`, attribute)
      return instancedBufferAttribute<'vec4'>(attribute, 'vec4')
    })
    // Final Matrix4 is held as four per-instance columns. UVs are never baked.
    const finalMatrix = mat4(columns[0], columns[1], columns[2], columns[3])
    // positionLocal is mutated by Three.js instancing; read raw geometry for the final transform.
    const finalClip = varying(uniform(finalViewProjection).mul(finalMatrix.mul(vec4(attribute('position', 'vec3'), 1))), 'finalClip')
    const uvScreen = finalClip.xy.div(finalClip.w).mul(0.5).add(0.5)
    const regionSize = definition.width / (half * 2)
    const imageUv = uvScreen.sub((1 - regionSize) / 2).div(regionSize)
    const inside = imageUv.x.greaterThanEqual(0).and(imageUv.x.lessThanEqual(1))
      .and(imageUv.y.greaterThanEqual(0)).and(imageUv.y.lessThanEqual(1))
    const sampled = this.textureNode.sample(imageUv)
    const material = new MeshBasicNodeMaterial()
    // Gentle surface shading keeps the spheres readable without obscuring the image.
    material.colorNode = inside.select(sampled.rgb, vec4(0.24, 0.28, 0.29, 1).rgb)
      .mul(normalView.z.clamp(0, 1).mul(0.16).add(0.84))
    const spheres = new InstancedMesh(geometry, material, definition.count)
    spheres.instanceMatrix.setUsage(DynamicDrawUsage)
    spheres.frustumCulled = false
    this.spheres = spheres
    const content = new Group()
    content.add(spheres)

    const rimMaterial = new MeshBasicNodeMaterial({ color: '#657074' })
    for (const box of definition.visibleBoxes) {
      const mesh = new Mesh(new BoxGeometry(...box.halfSize.map(size => size * 2) as [number, number, number]), rimMaterial)
      mesh.position.set(...box.position)
      content.add(mesh)
    }
    this.content = content
    this.scene.add(content)
    this.reset()
  }

  reset(): void {
    this.elapsed = 0
    this.showingFinal = false
    this.replay?.reset()
    this.updateInstances()
  }

  advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Scene only advances forward.')
    if (this.showingFinal) throw new Error('Restart before playing the final pose view.')
    this.elapsed = Math.min(this.elapsed + deltaSeconds, this.duration)
    this.updateInstances()
  }

  showFinal(): void {
    if (!this.replay || !this.spheres) return
    this.showingFinal = true
    for (let id = 0; id < this.replay.metadata.count; id++) {
      this.matrix.fromArray(this.replay.metadata.finalMatrices, id * 16)
      this.spheres.setMatrixAt(id, this.matrix)
    }
    this.spheres.instanceMatrix.needsUpdate = true
  }

  private updateInstances(): void {
    if (!this.replay || !this.spheres || !this.definition) return
    const { metadata } = this.replay
    const time = Math.min(this.elapsed, this.replay.duration)
    const sampleTime = time / metadata.timeStep
    const frame = Math.min(Math.floor(sampleTime), metadata.endStep)
    this.replay.advanceToStep(frame)
    const alpha = sampleTime - frame
    for (let id = 0; id < metadata.count; id++) {
      if (sampleTime < metadata.spawnSteps[id]) {
        this.matrix.makeScale(0, 0, 0)
      } else {
        const a = id * 7
        const previous = this.replay.previous
        const next = this.replay.next
        this.position.set(
          previous[a] + (next[a] - previous[a]) * alpha,
          previous[a + 1] + (next[a + 1] - previous[a + 1]) * alpha,
          previous[a + 2] + (next[a + 2] - previous[a + 2]) * alpha,
        )
        this.rotation.fromArray(previous, a + 3)
        this.nextRotation.fromArray(next, a + 3)
        this.rotation.slerp(this.nextRotation, alpha)
        this.scale.setScalar(this.definition.radius)
        this.matrix.compose(this.position, this.rotation, this.scale)
        if (frame === metadata.endStep && this.matrix.elements.some((value, index) =>
          Math.abs(value - metadata.finalMatrices[id * 16 + index]) > 0.000002)) {
          throw new Error('再生結果がベイク済み最終姿勢と一致しません。再ベイクしてください。')
        }
      }
      this.spheres.setMatrixAt(id, this.matrix)
    }
    this.spheres.instanceMatrix.needsUpdate = true
  }

  async render(): Promise<void> {
    this.renderer.render(this.scene, this.camera)
    // Capture must wait for this frame before CanvasSource snapshots the canvas.
    const backend = this.renderer.backend as typeof this.renderer.backend & { device?: GPUDevice }
    if (backend.device) await backend.device.queue.onSubmittedWorkDone()
  }

  private disposeContent(): void {
    this.replay?.dispose()
    this.replay = null
    if (!this.content) return
    this.scene.remove(this.content)
    const materials = new Set<MeshBasicNodeMaterial>()
    this.content.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        materials.add(object.material as MeshBasicNodeMaterial)
      }
    })
    materials.forEach(material => material.dispose())
    this.spheres?.dispose()
    this.content = null
    this.spheres = null
  }

  dispose(): void {
    this.disposeContent()
    this.currentTexture?.dispose()
    this.renderer.dispose()
  }
}
