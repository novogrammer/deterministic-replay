import assert from 'node:assert/strict'
import test from 'node:test'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { DirectionalLight, InstancedMesh, Matrix4, Quaternion, Texture, TorusKnotGeometry, Vector3 } from 'three/webgpu'
import { TorusKnotPileScene } from '../src/scenes/torus-knot-pile/TorusKnotPileScene.ts'
import bakeFile from '../src/scenes/torus-knot-pile/bake.json' with { type: 'json' }

function parts(scene: TorusKnotPileScene): InstancedMesh {
  let mesh: InstancedMesh | undefined
  scene.scene.traverse(child => { if (child instanceof InstancedMesh) mesh = child })
  assert.ok(mesh)
  return mesh
}

test('runtime-generated TorusKnot hulls reset and reconstruct deterministically, with no trajectory or vertices saved', async () => {
  const first = await TorusKnotPileScene.create({ formatVersion: 1, bake: null })
  const second = await TorusKnotPileScene.create({ formatVersion: 1, bake: null })
  try {
    const mesh = parts(first)
    assert.ok(mesh.geometry instanceof TorusKnotGeometry)
    assert.deepEqual(mesh.geometry.getAttribute('position').array, parts(second).geometry.getAttribute('position').array)
    assert.equal(mesh.geometry.hasAttribute('finalColumn0'), false)
    assert.throws(() => first.showFinal(), /未ベイク/)
    first.world.forEachCollider(collider => {
      if (collider.parent()) assert.equal(collider.shape.type, RAPIER.ShapeType.ConvexPolyhedron)
    })
    for (let step = 0; step < 200; step++) { first.step(); second.step() }
    first.updateView(0.5); second.updateView(0.5)
    const intermediate = mesh.instanceMatrix.array.slice()
    assert.deepEqual(intermediate, parts(second).instanceMatrix.array)
    const previousWorld = first.world
    first.reset()
    assert.notEqual(first.world, previousWorld)
    for (let step = 0; step < 200; step++) first.step()
    first.updateView(0.5)
    assert.deepEqual(mesh.instanceMatrix.array, intermediate)
    assert.deepEqual(first.bake(), bakeFile)
    assert.deepEqual(second.bake(), bakeFile)
    assert.equal(first.stepIndex, 0)
    assert.equal(first.baked, false)
    assert.deepEqual(Object.keys(bakeFile.bake).sort(), [
      'formatVersion', 'sceneId', 'sceneRevision', 'settingsKey', 'rapierVersion',
      'count', 'timeStep', 'endStep', 'settled', 'spawnSteps', 'finalMatrices',
    ].sort())
  } finally { first.dispose(); second.dispose() }
})

test('forward completion matches saved final view; camera, projection and shadow resources belong to this scene', async () => {
  const scene = await TorusKnotPileScene.create()
  try {
    const mesh = parts(scene)
    assert.equal(mesh.castShadow, true)
    assert.equal(mesh.receiveShadow, true)
    const light = scene.scene.children.find(child => child instanceof DirectionalLight) as DirectionalLight
    assert.equal(light.castShadow, true)
    assert.equal(light.shadow.intensity, 0.35)
    let shadowDisposed = false
    const shadowDispose = light.shadow.dispose.bind(light.shadow)
    light.shadow.dispose = () => { shadowDisposed = true; shadowDispose() }
    const camera = scene.camera.matrixWorld.clone()
    scene.showFinal()
    const final = mesh.instanceMatrix.array.slice()
    const matrix = new Matrix4()
    for (let id = 0; id < scene.count; id++) {
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
      matrix.fromArray(bakeFile.bake.finalMatrices, id * 16).decompose(position, rotation, scale)
      assert.ok(scale.distanceTo(new Vector3(1, 1, 1)) < 0.000001)
      assert.ok(position.y > 0 && Math.abs(position.x) < 4 && Math.abs(position.z) < 4)
      const projected = position.project(scene.camera)
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1)
    }
    scene.reset()
    while (scene.stepIndex < bakeFile.bake.endStep) scene.step()
    scene.updateView(0)
    assert.ok(mesh.instanceMatrix.array.every((value, i) => Math.abs(value - final[i]) < 0.000002))
    assert.deepEqual(scene.camera.matrixWorld, camera)
    const image = new Texture()
    scene.setTexture(image)
    assert.equal(scene.stepIndex, bakeFile.bake.endStep)
    image.dispose()
    scene.dispose()
    assert.equal(shadowDisposed, true)
  } finally { scene.dispose() }
})

test('shape and physics changes invalidate this scene bake', async () => {
  for (const field of ['knotRadius', 'tubeRadius', 'friction', 'spawnHeight']) {
    const settings = JSON.parse(bakeFile.bake.settingsKey)
    settings[field] += 0.01
    await assert.rejects(TorusKnotPileScene.create({
      formatVersion: 1, bake: { ...bakeFile.bake, settingsKey: JSON.stringify(settings) },
    }), /一致しません/)
  }
})
