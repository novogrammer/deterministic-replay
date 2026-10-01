import type { BoxDefinition, PhysicsSettings } from '../SceneData.ts'

export class SquareTrayPerspectiveSettings implements PhysicsSettings {
  readonly id = 'square-tray-perspective'
  readonly title = 'Square tray — Perspective'
  readonly revision = 1
  readonly seed = 20261002
  readonly count = 400
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
}
