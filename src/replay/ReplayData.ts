import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { settingsKey } from '../scenes/SceneData.ts'
import type { BakeMetadata, PhysicsSettings } from '../scenes/SceneData.ts'
import { PhysicsSimulation } from '../simulation/PhysicsSimulation.ts'

export class ReplayData {
  readonly metadata: BakeMetadata | null
  readonly endStep: number
  readonly spawnSteps: number[]
  readonly duration: number
  readonly simulation: PhysicsSimulation
  readonly previous: Float32Array
  readonly next: Float32Array
  private frame = 0

  private constructor(scene: PhysicsSettings, metadata: BakeMetadata | null) {
    this.metadata = metadata
    this.endStep = metadata?.endStep ?? scene.maxSteps
    this.duration = this.endStep * scene.timeStep
    this.simulation = new PhysicsSimulation(scene)
    this.spawnSteps = this.simulation.spawnSteps
    this.previous = new Float32Array(scene.count * 7)
    this.next = new Float32Array(scene.count * 7)
    this.reset()
  }

  static async fromBake(scene: PhysicsSettings, metadata: BakeMetadata | null): Promise<ReplayData> {
    await PhysicsSimulation.ready
    if (metadata && (metadata.formatVersion !== 1 || metadata.sceneId !== scene.id
      || metadata.sceneRevision !== scene.revision || metadata.settingsKey !== settingsKey(scene)
      || metadata.rapierVersion !== RAPIER.version() || metadata.timeStep !== scene.timeStep
      || metadata.count !== scene.count || !metadata.settled
      || !Number.isInteger(metadata.endStep) || metadata.endStep < 1 || metadata.endStep > scene.maxSteps
      || !Array.isArray(metadata.finalMatrices) || metadata.finalMatrices.length !== scene.count * 16
      || !metadata.finalMatrices.every(Number.isFinite)
      || !Array.isArray(metadata.spawnSteps) || metadata.spawnSteps.length !== scene.count
      || metadata.spawnSteps.some((step, id) => step !== Math.floor(id / scene.batchSize) * scene.spawnEverySteps))) {
      throw new Error('シーン設定とベイクデータが一致しません。再ベイクしてください。')
    }
    return new ReplayData(scene, metadata)
  }

  get stepIndex(): number { return this.frame }

  reset(): void {
    this.simulation.reset()
    this.frame = 0
    this.simulation.writePoses(this.previous)
    this.simulation.advance()
    this.simulation.writePoses(this.next)
  }

  advanceToStep(frame: number): void {
    frame = Math.min(frame, this.endStep)
    if (!Number.isInteger(frame) || frame < this.frame) throw new Error('Replay only advances forward. Use reset to restart.')
    while (this.frame < frame) {
      this.previous.set(this.next)
      this.frame++
      if (this.simulation.step < this.endStep) {
        this.simulation.advance()
        this.simulation.writePoses(this.next)
      }
    }
  }

  dispose(): void { this.simulation.dispose() }
}
