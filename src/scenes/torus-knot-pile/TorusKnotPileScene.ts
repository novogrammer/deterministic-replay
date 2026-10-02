import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import {
  BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh,
  Quaternion, Scene, TorusKnotGeometry, Texture, Vector3,
  InstancedBufferAttribute, DynamicDrawUsage, PerspectiveCamera, MeshStandardNodeMaterial,
  HemisphereLight, DirectionalLight,
} from 'three/webgpu'
import { attribute, instancedBufferAttribute, mat4, output, texture, uniform, varying, vec4 } from 'three/tsl'
import type { BakeFile, BakeMetadata, BoxDefinition, SceneSettings } from '../SceneData.ts'
import type { PhysicsDefinition } from '../../simulation/PhysicsSimulation.ts'
import type { SeededRandom } from '../../simulation/SeededRandom.ts'
import type { SimulationScene } from '../SimulationScene.ts'
import { ReplayData } from '../../replay/ReplayData.ts'
import bakeData from './bake.json' with { type: 'json' }

export class TorusKnotPileScene implements SimulationScene, SceneSettings, PhysicsDefinition {
  readonly id = 'torus-knot-pile'
  readonly title = 'Torus knot pile · 透視投影＋ライト'
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(40, 1, 0.1, 100)
  readonly revision = 1
  readonly seed = 20261002
  readonly count = 180
  readonly knotRadius = 0.28
  readonly tubeRadius = 0.09
  readonly tubularSegments = 96
  readonly radialSegments = 12
  readonly knotP = 2
  readonly knotQ = 3
  readonly timeStep = 1 / 60
  readonly batchSize = 3
  readonly spawnEverySteps = 10
  readonly maxSteps = 1800
  readonly holdSeconds = 2
  readonly spawnHeight = 7
  readonly spawnJitter = 0.1
  readonly spawnPositions = [[-0.65, -0.65], [0.65, -0.65], [0, 0.65]] as const
  readonly gravity = { x: 0, y: -9.81, z: 0 }
  readonly solverIterations = 8
  readonly friction = 0.65
  readonly restitution = 0.04
  readonly linearDamping = 0.18
  readonly angularDamping = 0.55
  readonly imageRegionSize = 0.62
  readonly floorSize = 20
  readonly colliderBoxes: readonly BoxDefinition[] = [
    { position: [0, -0.1, 0], halfSize: [this.floorSize / 2, 0.1, this.floorSize / 2] },
  ]
  private readonly geometry = new TorusKnotGeometry(this.knotRadius, this.tubeRadius,
    this.tubularSegments, this.radialSegments, this.knotP, this.knotQ)
  private readonly hullVertices = new Float32Array(this.geometry.getAttribute('position').array)
  private readonly keyLight = new DirectionalLight('#fff2dd', 2.2)
  private readonly textureNode = texture(new Texture())
  private readonly content = new Group()
  private parts!: InstancedMesh
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly nextRotation = new Quaternion()
  private readonly scale = new Vector3()
  private replay!: ReplayData

  private constructor() {
    this.scene.background = new Color('#171a1c')
    this.camera.position.set(8, 9, 11)
    this.camera.lookAt(0, 0.35, 0)
    this.camera.updateMatrixWorld()
    const key = this.keyLight
    key.position.set(-6, 12, 8)
    key.target.position.set(0, 2, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.intensity = 0.35
    key.shadow.normalBias = 0.025
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.1, far: 35 })
    key.shadow.camera.updateProjectionMatrix()
    this.scene.add(key, key.target, new HemisphereLight('#dce9ff', '#39434a', 1.6))
  }

  static async create(data: BakeFile = bakeData as BakeFile): Promise<TorusKnotPileScene> {
    if (data.formatVersion !== 1) throw new Error('Unsupported bake file version.')
    const scene = new TorusKnotPileScene()
    try {
      scene.replay = await ReplayData.fromBake(scene, data.bake)
      scene.build()
      return scene
    } catch (error) { scene.dispose(); throw error }
  }

  get settingsKey(): string {
    return JSON.stringify({
      revision: this.revision, seed: this.seed, count: this.count,
      knotRadius: this.knotRadius, tubeRadius: this.tubeRadius,
      tubularSegments: this.tubularSegments, radialSegments: this.radialSegments,
      knotP: this.knotP, knotQ: this.knotQ,
      timeStep: this.timeStep, batchSize: this.batchSize,
      spawnEverySteps: this.spawnEverySteps, maxSteps: this.maxSteps,
      spawnHeight: this.spawnHeight, spawnJitter: this.spawnJitter, spawnPositions: this.spawnPositions,
      gravity: this.gravity, solverIterations: this.solverIterations,
      friction: this.friction, restitution: this.restitution,
      linearDamping: this.linearDamping, angularDamping: this.angularDamping,
      colliderBoxes: this.colliderBoxes, ccd: true,
    })
  }

  get spawnSteps(): readonly number[] {
    return Array.from({ length: this.count }, (_, id) =>
      Math.floor(id / this.batchSize) * this.spawnEverySteps)
  }

  createWorld(): RAPIER.World {
    const world = new RAPIER.World(this.gravity)
    world.integrationParameters.numSolverIterations = this.solverIterations
    for (const box of this.colliderBoxes) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(...box.halfSize)
        .setTranslation(...box.position).setFriction(this.friction).setRestitution(0))
    }
    return world
  }

  createBody(world: RAPIER.World, id: number, random: SeededRandom): RAPIER.RigidBody {
    const [x, z] = this.spawnPositions[id % this.batchSize]
    const rotation = new Quaternion(random.next() - 0.5, random.next() - 0.5,
      random.next() - 0.5, random.next() - 0.5).normalize()
    const collider = RAPIER.ColliderDesc.convexHull(this.hullVertices)
    if (!collider) throw new Error('TorusKnotの凸包Colliderを生成できません。')
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x + (random.next() - 0.5) * this.spawnJitter * 2,
        this.spawnHeight + random.next() * 0.18,
        z + (random.next() - 0.5) * this.spawnJitter * 2)
      .setRotation(rotation).setLinvel(0, -0.2, 0)
      .setAngvel({ x: random.next() - 0.5, y: random.next() - 0.5, z: random.next() - 0.5 })
      .setLinearDamping(this.linearDamping).setAngularDamping(this.angularDamping).setCcdEnabled(true))
    world.createCollider(collider.setDensity(1).setFriction(this.friction).setRestitution(this.restitution), body)
    return body
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
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    const finalViewProjection = this.camera.projectionMatrix.clone().multiply(this.camera.matrixWorldInverse)

    const geometry = this.geometry
    const material = new MeshStandardNodeMaterial({ roughness: 0.65, metalness: 0 })
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
      const imageUv = uvScreen.sub((1 - this.imageRegionSize) / 2).div(this.imageRegionSize)
      const inside = imageUv.x.greaterThanEqual(0).and(imageUv.x.lessThanEqual(1))
        .and(imageUv.y.greaterThanEqual(0)).and(imageUv.y.lessThanEqual(1))
      const sampled = this.textureNode.sample(imageUv)
      material.colorNode = sampled.rgb
      // Replace outside pixels after lighting so they match the clear color exactly.
      material.outputNode = inside.select(output, vec4(uniform(this.scene.background as Color), 1))
    } else {
      const color = uniform(new Color('#ff00ff')).rgb
      material.colorNode = color
    }
    const parts = new InstancedMesh(geometry, material, definition.count)
    parts.instanceMatrix.setUsage(DynamicDrawUsage)
    parts.frustumCulled = false
    parts.castShadow = true
    parts.receiveShadow = true
    this.parts = parts
    const content = this.content
    content.add(parts)

    const floorMaterial = new MeshStandardNodeMaterial({ color: '#343c43', roughness: 0.9 })
    const floor = new Mesh(new BoxGeometry(this.floorSize, 0.2, this.floorSize), floorMaterial)
    floor.position.y = -0.1
    floor.receiveShadow = true
    content.add(floor)
    this.scene.add(content)
    this.reset()
  }

  showFinal(): void {
    if (!this.replay.metadata) throw new Error('未ベイクのシーンには完成姿勢がありません。')
    for (let id = 0; id < this.replay.metadata.count; id++) {
      this.matrix.fromArray(this.replay.metadata.finalMatrices, id * 16)
      this.parts.setMatrixAt(id, this.matrix)
    }
    this.parts.instanceMatrix.needsUpdate = true
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
        this.scale.setScalar(1)
        this.matrix.compose(this.position, this.rotation, this.scale)
        if (metadata && frame === metadata.endStep && this.matrix.elements.some((value, index) =>
          Math.abs(value - metadata.finalMatrices[id * 16 + index]) > 0.000002)) {
          throw new Error('再生結果がベイク済み最終姿勢と一致しません。再ベイクしてください。')
        }
      }
      this.parts.setMatrixAt(id, this.matrix)
    }
    this.parts.instanceMatrix.needsUpdate = true
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
          this.rotation.fromArray(poses, offset + 3), this.scale.setScalar(1))
        finalMatrices.push(...this.matrix.elements)
      }
      const metadata: BakeMetadata = {
        formatVersion: 1, sceneId: settings.id, sceneRevision: settings.revision,
        settingsKey: settings.settingsKey, rapierVersion: RAPIER.version(),
        count: this.count, timeStep: this.timeStep, endStep: simulation.step,
        settled: true, spawnSteps: [...simulation.spawnSteps], finalMatrices,
      }
      return { formatVersion: 1, bake: metadata }
    } finally { this.reset() }
  }

  dispose(): void {
    this.replay?.dispose()
    const materials = new Set<MeshStandardNodeMaterial>()
    this.content.traverse(object => {
      if (object instanceof Mesh) {
        if (object.geometry !== this.geometry) object.geometry.dispose()
        materials.add(object.material as MeshStandardNodeMaterial)
      }
    })
    materials.forEach(material => material.dispose())
    this.geometry.dispose()
    this.keyLight.shadow.dispose()
    this.parts?.dispose()
    this.scene.clear()
  }
}
