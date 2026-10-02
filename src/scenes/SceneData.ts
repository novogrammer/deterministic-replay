/** Settings implemented by each scene, used by physics and bake validation. */
export interface SceneSettings {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly seed: number
  readonly count: number
  readonly settingsKey: string
  readonly timeStep: number
  readonly maxSteps: number
  readonly holdSeconds: number
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
