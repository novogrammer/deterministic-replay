import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { settingsKey } from '../scenes/SceneDefinition.ts'
import type { BakeMetadata, SceneDefinition } from '../scenes/SceneDefinition.ts'
import { PhysicsSimulation } from '../simulation/PhysicsSimulation.ts'

export class ReplayData {
  readonly metadata: BakeMetadata
  readonly duration: number
  readonly simulation: PhysicsSimulation
  readonly previous: Float32Array
  readonly next: Float32Array
  private frame = 0

  private constructor(scene: SceneDefinition, metadata: BakeMetadata) {
    this.metadata = metadata
    this.duration = metadata.endStep * metadata.timeStep
    this.simulation = new PhysicsSimulation(scene)
    this.previous = new Float32Array(scene.count * 7)
    this.next = new Float32Array(scene.count * 7)
    this.reset()
  }

  static async load(scene: SceneDefinition, signal?: AbortSignal): Promise<ReplayData> {
    const response = await fetch(`${import.meta.env.BASE_URL}scenes/${scene.id}/bake.json`, { signal })
    if (!response.ok) throw new Error('シーンデータを読み込めません。npm run bake を実行してください。')
    const metadata: BakeMetadata = await response.json()
    return this.fromBake(scene, metadata)
  }

  static async fromBake(scene: SceneDefinition, metadata: BakeMetadata): Promise<ReplayData> {
    await PhysicsSimulation.ready
    if (metadata.formatVersion !== 1 || metadata.sceneId !== scene.id
      || metadata.sceneRevision !== scene.revision || metadata.settingsKey !== settingsKey(scene)
      || metadata.rapierVersion !== RAPIER.version() || metadata.timeStep !== scene.timeStep
      || metadata.count !== scene.count || !metadata.settled
      || !Number.isInteger(metadata.endStep) || metadata.endStep < 1 || metadata.endStep > scene.maxSteps
      || !Array.isArray(metadata.finalMatrices) || metadata.finalMatrices.length !== scene.count * 16
      || !metadata.finalMatrices.every(Number.isFinite)
      || !Array.isArray(metadata.spawnSteps) || metadata.spawnSteps.length !== scene.count
      || metadata.spawnSteps.some((step, id) => step !== Math.floor(id / scene.batchSize) * scene.spawnEverySteps)) {
      throw new Error('シーン設定とベイクデータが一致しません。再ベイクしてください。')
    }
    return new ReplayData(scene, metadata)
  }

  reset(): void {
    this.simulation.reset()
    this.frame = 0
    this.simulation.writePoses(this.previous)
    this.simulation.advance()
    this.simulation.writePoses(this.next)
  }

  advanceToStep(frame: number): void {
    frame = Math.min(frame, this.metadata.endStep)
    if (!Number.isInteger(frame) || frame < this.frame) throw new Error('Replay only advances forward. Use reset to restart.')
    while (this.frame < frame) {
      this.previous.set(this.next)
      this.frame++
      if (this.simulation.step < this.metadata.endStep) {
        this.simulation.advance()
        this.simulation.writePoses(this.next)
      }
    }
  }

  dispose(): void { this.simulation.dispose() }
}
