import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { Camera, Scene, Texture } from 'three/webgpu'
import type { BakeFile } from './SceneData.ts'

export interface SimulationScene {
  readonly id: string
  readonly title: string
  readonly count: number
  readonly scene: Scene
  readonly camera: Camera
  readonly world: RAPIER.World
  readonly timeStep: number
  readonly stepIndex: number
  readonly motionDuration: number
  readonly holdSeconds: number
  readonly baked: boolean
  step(): void
  reset(): void
  updateView(alpha: number): void
  setTexture(texture: Texture): void
  showFinal(): void
  bake(): BakeFile
  dispose(): void
}

export interface SceneEntry {
  readonly id: string
  readonly title: string
  readonly bakePath: string
  create(options?: { baked: boolean }): Promise<SimulationScene>
}
