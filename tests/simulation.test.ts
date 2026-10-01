import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { SquareTrayScene } from '../src/scenes/SquareTrayScene.ts'
import { SceneRegistry } from '../src/scenes/SceneRegistry.ts'
import { settingsKey } from '../src/scenes/SceneDefinition.ts'
import { PhysicsSimulation } from '../src/simulation/PhysicsSimulation.ts'

await PhysicsSimulation.ready
const scene = new SquareTrayScene()

test('reset reproduces intermediate poses and spawning without saved trajectory', () => {
  const simulation = new PhysicsSimulation(scene)
  try {
    const checkpoints = [0, 10, 173, 350]
    const snapshots = checkpoints.map(step => {
      while (simulation.step < step) simulation.advance()
      const poses = new Float32Array(scene.count * 7)
      simulation.writePoses(poses)
      return poses
    })
    simulation.reset()
    checkpoints.forEach((step, index) => {
      while (simulation.step < step) simulation.advance()
      const poses = new Float32Array(scene.count * 7)
      simulation.writePoses(poses)
      assert.deepEqual(poses, snapshots[index])
    })
    assert.equal(simulation.spawnSteps[0], 0)
    assert.equal(simulation.spawnSteps[399], 390)
    assert.ok(snapshots[0].slice(10 * 7).every(value => value === 0))
  } finally { simulation.dispose() }
})

test('forward simulation reaches baked final matrices on each replay', async () => {
  const metadata = JSON.parse(await readFile(new URL('../public/scenes/square-tray/bake.json', import.meta.url), 'utf8'))
  assert.equal(metadata.settingsKey, settingsKey(scene))
  assert.equal(metadata.rapierVersion, RAPIER.version())
  assert.equal(metadata.sceneRevision, scene.revision)
  assert.equal(metadata.finalMatrices.length, scene.count * 16)
  assert.equal(Object.hasOwn(metadata, 'trajectoryFile'), false)
  const simulation = new PhysicsSimulation(scene)
  try {
    for (let replay = 0; replay < 2; replay++) {
      if (replay) simulation.reset()
      while (simulation.step < metadata.endStep) simulation.advance()
      assert.equal(simulation.settled, true)
      assert.deepEqual(simulation.spawnSteps, metadata.spawnSteps)
      const poses = new Float32Array(scene.count * 7)
      simulation.writePoses(poses)
      for (let id = 0; id < scene.count; id++) {
        const offset = id * 7
        const matrix = new Matrix4().compose(
          new Vector3().fromArray(poses, offset),
          new Quaternion().fromArray(poses, offset + 3),
          new Vector3().setScalar(scene.radius),
        )
        assert.deepEqual(matrix.elements, metadata.finalMatrices.slice(id * 16, id * 16 + 16))
        assert.ok(poses[offset + 1] + scene.radius < scene.width / 2, 'sphere stays within the final image region')
      }
    }
  } finally { simulation.dispose() }
})

test('scene registry supports independent scenes; physics changes invalidate settings', () => {
  const secondScene = { ...scene, id: 'second-tray', seed: 1234 }
  const registry = new SceneRegistry([scene, secondScene])
  assert.equal(registry.list().length, 2)
  assert.equal(registry.get('second-tray'), secondScene)
  assert.notEqual(settingsKey(scene), settingsKey(secondScene))
  assert.throws(() => new SceneRegistry([scene, scene]), /Duplicate/)
})
