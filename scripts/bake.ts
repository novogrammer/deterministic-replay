import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { SceneRegistry } from '../src/scenes/SceneRegistry.ts'
import { settingsKey } from '../src/scenes/SceneDefinition.ts'
import type { BakeMetadata, SceneDefinition } from '../src/scenes/SceneDefinition.ts'
import { PhysicsSimulation } from '../src/simulation/PhysicsSimulation.ts'

class SceneBaker {
  async bake(scene: SceneDefinition): Promise<void> {
    const simulation = new PhysicsSimulation(scene)
    try {
      while (!simulation.settled && simulation.step < scene.maxSteps) simulation.advance()
      if (!simulation.settled) throw new Error(`${scene.id}: did not settle within ${scene.maxSteps} steps`)
      const poses = new Float32Array(scene.count * 7)
      simulation.writePoses(poses)
      const matrix = new Matrix4()
      const finalMatrices: number[] = []
      for (let id = 0; id < scene.count; id++) {
        const o = id * 7
        matrix.compose(new Vector3(poses[o], poses[o + 1], poses[o + 2]),
          new Quaternion(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]),
          new Vector3(scene.radius, scene.radius, scene.radius))
        finalMatrices.push(...matrix.elements)
      }
      const metadata: BakeMetadata = {
        formatVersion: 1, sceneId: scene.id, sceneRevision: scene.revision,
        settingsKey: settingsKey(scene), rapierVersion: RAPIER.version(),
        count: scene.count, timeStep: scene.timeStep,
        endStep: simulation.step, settled: simulation.settled,
        spawnSteps: simulation.spawnSteps, finalMatrices,
      }
      const directory = fileURLToPath(new URL(`../public/scenes/${scene.id}/`, import.meta.url))
      await mkdir(directory, { recursive: true })
      await writeFile(`${directory}/bake.json`, `${JSON.stringify(metadata)}\n`)
      console.log(`${scene.id}: ${scene.count} final Matrix4s, ${simulation.step} steps, ${(simulation.step * scene.timeStep).toFixed(2)}s; no trajectory saved`)
    } finally {
      simulation.dispose()
    }
  }
}

await PhysicsSimulation.ready
const registry = new SceneRegistry()
const requestedId = process.argv[2]
const scenes = requestedId ? [registry.get(requestedId)] : registry.list()
for (const scene of scenes) await new SceneBaker().bake(scene)
