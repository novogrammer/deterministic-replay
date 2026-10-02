import assert from 'node:assert/strict'
import test from 'node:test'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { PhysicsSimulation } from '../src/simulation/PhysicsSimulation.ts'
import type { PhysicsDefinition } from '../src/simulation/PhysicsSimulation.ts'
import { ReplayData } from '../src/replay/ReplayData.ts'

await PhysicsSimulation.ready

// No sphere radius, tray dimensions, or regular batch interval is required.
const definition: PhysicsDefinition = {
  seed: 42, count: 3, timeStep: 1 / 60, spawnSteps: [2, 0, 2],
  createWorld: () => new RAPIER.World({ x: 0, y: 0, z: 0 }),
  createBody: (world, id, random) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(id * 3 + random.next(), 1, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.3, 0.4), body)
    body.sleep()
    return body
  },
}

test('scene construction controls shape, world, and arbitrary spawning while poses retain instance IDs', () => {
  const simulation = new PhysicsSimulation(definition)
  try {
    const poses = new Float32Array(definition.count * 7)
    simulation.writePoses(poses)
    assert.deepEqual(simulation.world.gravity, { x: 0, y: 0, z: 0 })
    assert.equal(simulation.world.timestep, Math.fround(definition.timeStep))
    assert.ok(poses[7] > 3 && poses[7] < 4, 'instance 1 spawns before instance 0')
    assert.ok(poses.slice(0, 7).every(value => value === 0))
    assert.ok(poses.slice(14).every(value => value === 0))
    assert.equal(simulation.settled, false, 'future instances prevent early settlement')
    const initial = poses.slice()
    simulation.advance()
    assert.equal(simulation.settled, false)
    simulation.advance()
    assert.equal(simulation.settled, true)
    simulation.writePoses(poses)
    assert.ok(poses[0] > 0 && poses[0] < 1)
    assert.ok(poses[14] > 6 && poses[14] < 7)
    simulation.world.forEachCollider(collider => assert.equal(collider.shape.type, RAPIER.ShapeType.Cuboid))
    const final = poses.slice()
    const world = simulation.world
    simulation.reset()
    assert.notEqual(simulation.world, world)
    simulation.writePoses(poses)
    assert.deepEqual(poses, initial)
    simulation.advance()
    simulation.advance()
    simulation.writePoses(poses)
    assert.deepEqual(poses, final)
  } finally { simulation.dispose() }
})

test('replay validates the scene-provided schedule and advances non-spherical bodies', async () => {
  const scene = {
    ...definition, id: 'boxes', title: 'Boxes', revision: 1,
    settingsKey: 'boxes-v1', maxSteps: 10, holdSeconds: 2,
  }
  const metadata = {
    formatVersion: 1 as const, sceneId: scene.id, sceneRevision: scene.revision,
    settingsKey: scene.settingsKey, rapierVersion: RAPIER.version(),
    count: scene.count, timeStep: scene.timeStep, endStep: 2, settled: true,
    spawnSteps: [...scene.spawnSteps], finalMatrices: Array(scene.count * 16).fill(0),
  }
  await assert.rejects(ReplayData.fromBake(scene, { ...metadata, spawnSteps: [0, 0, 2] }), /一致しません/)
  const replay = await ReplayData.fromBake(scene, metadata)
  const baseline = new PhysicsSimulation(scene)
  try {
    for (let step = 0; step <= 2; step++) {
      replay.advanceToStep(step)
      while (baseline.step < step) baseline.advance()
      const poses = new Float32Array(scene.count * 7)
      baseline.writePoses(poses)
      assert.deepEqual(replay.previous, poses)
    }
    assert.equal(replay.simulation.settled, true)
    assert.deepEqual(replay.next, replay.previous)
  } finally { replay.dispose(); baseline.dispose() }
})

test('invalid spawn schedules fail before allocating a world', () => {
  for (const spawnSteps of [[0], [0, -1, 2], [0, 1.5, 2]]) {
    assert.throws(() => new PhysicsSimulation({
      ...definition, spawnSteps,
      createWorld: () => { assert.fail('invalid schedule must not create a world') },
    }), /spawn step/)
  }
})

test('failed spawning frees the world and disposal remains safe', () => {
  let freed = 0
  const simulation = new PhysicsSimulation({
    ...definition, spawnSteps: [1, 1, 1],
    createWorld: () => {
      const world = definition.createWorld()
      const free = world.free.bind(world)
      world.free = () => { freed++; free() }
      return world
    },
    createBody: () => { throw new Error('collider construction failed') },
  })
  simulation.dispose()
  simulation.dispose()
  assert.equal(freed, 1)
  // Force the same construction failure during reset, which also spawns step 0.
  assert.throws(() => new PhysicsSimulation({
    ...definition,
    createWorld: () => {
      const world = definition.createWorld()
      const free = world.free.bind(world)
      world.free = () => { freed++; free() }
      return world
    },
    createBody: () => { throw new Error('collider construction failed') },
  }), /collider construction failed/)
  assert.equal(freed, 2)
})
