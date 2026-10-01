import assert from 'node:assert/strict'
import test from 'node:test'
import { InstancedMesh } from 'three/webgpu'
import { SquareTrayScene } from '../src/scenes/square-tray/SquareTrayScene.ts'
import type { SimulationScene } from '../src/scenes/SimulationScene.ts'
import bakeFile from '../src/scenes/square-tray/bake.json' with { type: 'json' }
import { SquareTrayPerspectiveScene } from '../src/scenes/square-tray-perspective/SquareTrayPerspectiveScene.ts'
import perspectiveBakeFile from '../src/scenes/square-tray-perspective/bake.json' with { type: 'json' }
import { DirectionalLight, HemisphereLight, MeshStandardNodeMaterial, PerspectiveCamera } from 'three/webgpu'

function spheres(scene: SimulationScene): InstancedMesh {
  let result: InstancedMesh | undefined
  scene.scene.traverse(child => { if (child instanceof InstancedMesh) result = child })
  assert.ok(result)
  return result
}

test('unbaked scene constructs and resets without dummy final matrices; baking matches saved poses', async () => {
  const scene = await SquareTrayScene.create({ formatVersion: 1, bake: null })
  try {
    assert.equal(scene.baked, false)
    assert.equal(spheres(scene).geometry.hasAttribute('finalColumn0'), false)
    assert.throws(() => scene.showFinal(), /未ベイク/)
    const initial = spheres(scene).instanceMatrix.array.slice()
    for (let i = 0; i < 173; i++) scene.step()
    scene.updateView(0.5)
    const midway = spheres(scene).instanceMatrix.array.slice()
    const previousWorld = scene.world
    scene.reset()
    assert.notEqual(scene.world, previousWorld)
    assert.equal(scene.stepIndex, 0)
    assert.deepEqual(spheres(scene).instanceMatrix.array, initial)
    for (let i = 0; i < 173; i++) scene.step()
    scene.updateView(0.5)
    assert.deepEqual(spheres(scene).instanceMatrix.array, midway)
    assert.deepEqual(scene.bake(), bakeFile)
    assert.equal(scene.stepIndex, 0)
    assert.equal(scene.baked, false, 'baking returns data; importing it on the next load enables projection')
  } finally { scene.dispose() }
})

test('scene advances to baked poses and final view leaves the physics untouched', async () => {
  const scene = await SquareTrayScene.create()
  try {
    assert.equal(scene.baked, true)
    assert.equal(spheres(scene).geometry.hasAttribute('finalColumn0'), true)
    const world = scene.world
    scene.showFinal()
    assert.equal(scene.stepIndex, 0)
    assert.equal(scene.world, world)
    const finalMatrices = spheres(scene).instanceMatrix.array.slice()
    scene.reset()
    const endStep = bakeFile.bake.endStep
    while (scene.stepIndex < endStep) scene.step()
    scene.updateView(0)
    // Slerp normalizes the float32 pose quaternion; compare with the runtime's tolerance.
    const actual = spheres(scene).instanceMatrix.array
    const maxDifference = Math.max(...actual.map((value, i) => Math.abs(value - finalMatrices[i])))
    assert.ok(maxDifference < 0.000002, `final matrix difference: ${maxDifference}`)
    scene.step()
    assert.equal(scene.stepIndex, endStep)
  } finally { scene.dispose() }
})

test('perspective scene owns its construction and bake data', async () => {
  const perspective = await SquareTrayPerspectiveScene.create()
  try {
    assert.ok(perspective.camera instanceof PerspectiveCamera)
    assert.ok(spheres(perspective).material instanceof MeshStandardNodeMaterial)
    assert.ok(perspective.scene.children.some(child => child instanceof DirectionalLight))
    assert.ok(perspective.scene.children.some(child => child instanceof HemisphereLight))
    for (let step = 0; step < 180; step++) perspective.step()
    perspective.updateView(0.5)
    const intermediate = spheres(perspective).instanceMatrix.array.slice()
    perspective.reset()
    for (let step = 0; step < 180; step++) perspective.step()
    perspective.updateView(0.5)
    assert.deepEqual(spheres(perspective).instanceMatrix.array, intermediate)
    assert.deepEqual(perspective.bake(), perspectiveBakeFile)
    assert.equal(perspectiveBakeFile.bake.sceneId, 'square-tray-perspective')
    await assert.rejects(SquareTrayPerspectiveScene.create(bakeFile as Parameters<typeof SquareTrayPerspectiveScene.create>[0]), /一致しません/)
  } finally { perspective.dispose() }
})
