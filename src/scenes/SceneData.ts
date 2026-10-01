/** Internal settings for the tray physics, rather than a public scene contract. */
export interface PhysicsSettings {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly seed: number
  readonly count: number
  readonly radius: number
  readonly width: number
  readonly depth: number
  readonly cameraHalfSize: number
  readonly timeStep: number
  readonly batchSize: number
  readonly spawnEverySteps: number
  readonly maxSteps: number
  readonly holdSeconds: number
  readonly colliderBoxes: readonly BoxDefinition[]
  readonly visibleBoxes: readonly BoxDefinition[]
}

export interface BoxDefinition {
  position: readonly [number, number, number]
  halfSize: readonly [number, number, number]
}

export interface BakeMetadata {
  formatVersion: 1
  sceneId: string
  sceneRevision: number
  settingsKey: string
  rapierVersion: string
  count: number
  timeStep: number
  endStep: number
  settled: boolean
  spawnSteps: number[]
  finalMatrices: number[]
}

export interface BakeFile {
  formatVersion: 1
  bake: BakeMetadata | null
}

export function settingsKey(scene: PhysicsSettings): string {
  return JSON.stringify({
    revision: scene.revision, seed: scene.seed, count: scene.count,
    radius: scene.radius, width: scene.width, depth: scene.depth,
    timeStep: scene.timeStep, batchSize: scene.batchSize,
    spawnEverySteps: scene.spawnEverySteps, maxSteps: scene.maxSteps,
    colliderBoxes: scene.colliderBoxes,
  })
}
