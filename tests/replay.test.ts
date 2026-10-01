import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { ReplayData } from '../src/replay/ReplayData.ts'
import type { BakeMetadata } from '../src/scenes/SceneData.ts'
import { SquareTrayScene } from '../src/scenes/square-tray/SquareTrayScene.ts'
import bakeFile from '../src/scenes/square-tray/bake.json' with { type: 'json' }
import { PhysicsSimulation } from '../src/simulation/PhysicsSimulation.ts'

const scene = await SquareTrayScene.create()
after(() => scene.dispose())
const metadata: BakeMetadata = bakeFile.bake

for (const fps of [30, 60]) {
  test(`${fps}fps forward playback matches every physics sample and the baked end step`, async () => {
    const replay = await ReplayData.fromBake(scene, metadata)
    const baseline = new PhysicsSimulation(scene)
    const poses = new Float32Array(scene.count * 7)
    try {
      for (let run = 0; run < 2; run++) {
        if (run) { replay.reset(); baseline.reset() }
        const count = Math.ceil(replay.duration * fps) + 1
        for (let frame = 0; frame <= count; frame++) {
          const step = Math.min(Math.floor((frame / fps) / scene.timeStep), metadata.endStep)
          replay.advanceToStep(step)
          while (baseline.step < step) baseline.advance()
          baseline.writePoses(poses)
          assert.deepEqual(replay.previous, poses, `frame ${frame}`)
        }
        assert.equal(replay.simulation.step, metadata.endStep)
        assert.equal(replay.simulation.settled, true)
        assert.deepEqual(replay.previous, replay.next)
        assert.throws(() => replay.advanceToStep(0), /only advances forward/)
      }
    } finally { replay.dispose(); baseline.dispose() }
  })
}
