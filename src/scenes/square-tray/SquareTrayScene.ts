import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import {
  BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial,
  OrthographicCamera, Quaternion, Scene, SphereGeometry, Texture, Vector3,
  InstancedBufferAttribute, DynamicDrawUsage,
} from 'three/webgpu'
import { attribute, instancedBufferAttribute, mat4, normalView, texture, uniform, varying, vec4 } from 'three/tsl'
import type { BakeFile, BakeMetadata, BoxDefinition, SceneSettings } from '../SceneData.ts'
import { settingsKey } from '../SceneData.ts'
import type { SimulationScene } from '../SimulationScene.ts'
import { ReplayData } from '../../replay/ReplayData.ts'
import bakeData from './bake.json' with { type: 'json' }

export class SquareTrayScene implements SimulationScene, SceneSettings {
  readonly id: string = 'square-tray'
  readonly title: string = 'Square tray'
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(-4.7, 4.7, 4.7, -4.7, 0.1, 100)
  readonly revision = 1
  readonly seed = 20261002
  readonly count = 440
  readonly radius = 0.2
  readonly width = 8
  readonly depth = 0.44
  readonly cameraHalfSize = 4.7
  readonly timeStep = 1 / 60
  readonly batchSize = 10
  readonly spawnEverySteps = 10
  readonly maxSteps = 1200
  readonly holdSeconds = 2
  readonly colliderBoxes: readonly BoxDefinition[] = [
    { position: [0, -4.1, 0], halfSize: [4.2, 0.1, 0.6] },
    { position: [-4.1, 2, 0], halfSize: [0.1, 10, 0.6] },
    { position: [4.1, 2, 0], halfSize: [0.1, 10, 0.6] },
    { position: [0, 2, -0.32], halfSize: [4.2, 10, 0.1] },
    { position: [0, 2, 0.32], halfSize: [4.2, 10, 0.1] },
  ]
  readonly visibleBoxes: readonly BoxDefinition[] = [
    { position: [0, -4.09, -0.04], halfSize: [4.14, 0.07, 0.295] },
    { position: [-4.09, 0, -0.04], halfSize: [0.07, 4.07, 0.295] },
    { position: [4.09, 0, -0.04], halfSize: [0.07, 4.07, 0.295] },
  ]
  private readonly textureNode = texture(new Texture())
  private readonly content = new Group()
  private spheres!: InstancedMesh
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly nextRotation = new Quaternion()
  private readonly scale = new Vector3()
  private replay!: ReplayData

  private constructor() {
    this.scene.background = new Color('#171a1c')
    this.camera.position.set(0, 0, 20)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
  }

  static async create(data: BakeFile = bakeData as BakeFile): Promise<SquareTrayScene> {
    if (data.formatVersion !== 1) throw new Error('Unsupported bake file version.')
    const scene = new SquareTrayScene()
    try {
      scene.replay = await ReplayData.fromBake(scene, data.bake)
      scene.build()
      return scene
    } catch (error) { scene.dispose(); throw error }
  }

  get world(): RAPIER.World { return this.replay.simulation.world }
  get motionDuration(): number { return this.replay.duration }
  get stepIndex(): number { return this.replay.stepIndex }
  get baked(): boolean { return this.replay.metadata !== null }

  setTexture(image: Texture): void { this.textureNode.value = image }
  step(): void { this.replay.advanceToStep(this.stepIndex + 1) }
  reset(): void { this.replay.reset(); this.updateView(0) }

  private build(): void {
    const definition = this
    const half = definition.cameraHalfSize
    Object.assign(this.camera, { left: -half, right: half, top: half, bottom: -half })
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    const finalViewProjection = this.camera.projectionMatrix.clone().multiply(this.camera.matrixWorldInverse)

    const geometry = new SphereGeometry(1, 20, 14)
    const material = new MeshBasicNodeMaterial()
    const metadata = this.replay.metadata
    if (metadata) {
      const columns = Array.from({ length: 4 }, (_, column) => {
        const values = new Float32Array(definition.count * 4)
        for (let id = 0; id < definition.count; id++) {
          values.set(metadata.finalMatrices.slice(id * 16 + column * 4, id * 16 + column * 4 + 4), id * 4)
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
      // Gentle surface shading keeps the spheres readable without obscuring the image.
      const color = sampled.rgb.mul(normalView.z.clamp(0, 1).mul(0.16).add(0.84))
      material.colorNode = inside.select(color, uniform(this.scene.background as Color).rgb)
    } else {
      const color = uniform(new Color('#ff00ff')).rgb
      material.colorNode = color.mul(normalView.z.clamp(0, 1).mul(0.16).add(0.84))
    }
    const spheres = new InstancedMesh(geometry, material, definition.count)
    spheres.instanceMatrix.setUsage(DynamicDrawUsage)
    spheres.frustumCulled = false
    this.spheres = spheres
    const content = this.content
    content.add(spheres)

    const rimMaterial = new MeshBasicNodeMaterial({ color: '#657074' })
    for (const box of definition.visibleBoxes) {
      const mesh = new Mesh(new BoxGeometry(...box.halfSize.map(size => size * 2) as [number, number, number]), rimMaterial)
      mesh.position.set(...box.position)
      content.add(mesh)
    }
    this.scene.add(content)
    this.reset()
  }

  showFinal(): void {
    if (!this.replay.metadata) throw new Error('未ベイクのシーンには完成姿勢がありません。')
    for (let id = 0; id < this.replay.metadata.count; id++) {
      this.matrix.fromArray(this.replay.metadata.finalMatrices, id * 16)
      this.spheres.setMatrixAt(id, this.matrix)
    }
    this.spheres.instanceMatrix.needsUpdate = true
  }

  updateView(alpha: number): void {
    const metadata = this.replay.metadata
    const frame = this.replay.stepIndex
    const sampleTime = frame + alpha
    for (let id = 0; id < this.count; id++) {
      if (sampleTime < this.replay.spawnSteps[id]) {
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
        this.scale.setScalar(this.radius)
        this.matrix.compose(this.position, this.rotation, this.scale)
        if (metadata && frame === metadata.endStep && this.matrix.elements.some((value, index) =>
          Math.abs(value - metadata.finalMatrices[id * 16 + index]) > 0.000002)) {
          throw new Error('再生結果がベイク済み最終姿勢と一致しません。再ベイクしてください。')
        }
      }
      this.spheres.setMatrixAt(id, this.matrix)
    }
    this.spheres.instanceMatrix.needsUpdate = true
  }

  bake(): BakeFile {
    const simulation = this.replay.simulation
    const settings = this
    simulation.reset()
    try {
      while (!simulation.settled && simulation.step < settings.maxSteps) simulation.advance()
      if (!simulation.settled) throw new Error(`${this.id}: did not settle within ${settings.maxSteps} steps`)
      const poses = new Float32Array(this.count * 7)
      simulation.writePoses(poses)
      const finalMatrices: number[] = []
      for (let id = 0; id < this.count; id++) {
        const offset = id * 7
        this.matrix.compose(this.position.fromArray(poses, offset),
          this.rotation.fromArray(poses, offset + 3), this.scale.setScalar(settings.radius))
        finalMatrices.push(...this.matrix.elements)
      }
      const metadata: BakeMetadata = {
        formatVersion: 1, sceneId: settings.id, sceneRevision: settings.revision,
        settingsKey: settingsKey(settings), rapierVersion: RAPIER.version(),
        count: this.count, timeStep: this.timeStep, endStep: simulation.step,
        settled: true, spawnSteps: [...simulation.spawnSteps], finalMatrices,
      }
      return { formatVersion: 1, bake: metadata }
    } finally { this.reset() }
  }

  dispose(): void {
    this.replay?.dispose()
    const materials = new Set<MeshBasicNodeMaterial>()
    this.content.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        materials.add(object.material as MeshBasicNodeMaterial)
      }
    })
    materials.forEach(material => material.dispose())
    this.spheres?.dispose()
    this.scene.clear()
  }
}
