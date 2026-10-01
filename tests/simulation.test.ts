import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { SquareTrayScene } from '../src/scenes/square-tray/SquareTrayScene.ts'
import bakeFile from '../src/scenes/square-tray/bake.json' with { type: 'json' }
import { SceneRegistry } from '../src/scenes/SceneRegistry.ts'
import { settingsKey } from '../src/scenes/SceneData.ts'
import { PhysicsSimulation } from '../src/simulation/PhysicsSimulation.ts'

await PhysicsSimulation.ready
const scene = await SquareTrayScene.create()
after(() => scene.dispose())

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
  const metadata = bakeFile.bake
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

test('scene registry uses independent factories; physics changes invalidate settings', async () => {
  const original = new SceneRegistry().get('square-tray')
  const registry = new SceneRegistry([original, { ...original, id: 'second-tray' }])
  assert.equal(registry.list().length, 2)
  const first = await registry.create('square-tray')
  const second = await registry.create('second-tray')
  try {
    assert.notEqual(first.scene, second.scene)
    assert.notEqual(first.world, second.world)
    assert.notEqual(settingsKey(scene), settingsKey({ ...scene, seed: 1234 }))
    assert.throws(() => new SceneRegistry([original, original]), /Duplicate/)
  } finally { first.dispose(); second.dispose() }
})
