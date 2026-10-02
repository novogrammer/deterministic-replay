import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualityLevel } from 'mediabunny'
import { SessionController } from '../src/player/SessionController.ts'
import type { PixelFrame } from '../src/rendering/PixelFrame.ts'
import type { FrameRecorder, SessionRuntime } from '../src/player/SessionController.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

class FakeRuntime implements SessionRuntime {
  readonly canvas = { width: 1, height: 1 } as HTMLCanvasElement
  duration = 0.1
  motionDuration = 0.08
  time = 0
  final = false
  draws: number[] = []
  updates: number[] = []
  resets = 0
  draw: () => Promise<void> = async () => {}
  animationLoop: ((timestamp: number) => void) | null = null
  setAnimationLoop(callback: ((timestamp: number) => void) | null): Promise<void> {
    this.animationLoop = callback
    return Promise.resolve()
  }
  reset(): void { this.resets++; this.time = 0; this.final = false }
  advance(delta: number): void {
    assert.ok(delta >= 0)
    assert.equal(this.final, false)
    this.time += delta
    this.updates.push(this.time)
  }
  showFinal(): void { this.final = true }
  async render(): Promise<void> { this.draws.push(this.time); await this.draw() }
  async readFrame(): Promise<PixelFrame> { return { width: 1, height: 1, pixels: new Uint8Array([0, 0, 0, 255]) } }
}

class FakeRecorder implements FrameRecorder {
  timestamps: number[] = []
  starts = 0
  qualities: QualityLevel[] = []
  aborts = 0
  add: () => Promise<void> = async () => {}
  start(_width: number, _height: number, _fps: number, quality: QualityLevel): Promise<void> {
    this.starts++
    this.qualities.push(quality)
    return Promise.resolve()
  }
  async addFrame(_frame: PixelFrame, timestamp: number): Promise<void> { this.timestamps.push(timestamp); await this.add() }
  finish(): Promise<Blob> { return Promise.resolve(new Blob(['test'])) }
  abort(): Promise<void> { this.aborts++; return Promise.resolve() }
}

function setup() {
  const runtime = new FakeRuntime()
  const recorder = new FakeRecorder()
  const errors: unknown[] = []
  const session = new SessionController(runtime, recorder, () => {}, error => errors.push(error))
  let timestamp = performance.now()
  const tick = () => { timestamp = Math.max(timestamp + 16, performance.now()); runtime.animationLoop?.(timestamp) }
  // Run renderer frames only when explicitly requested by the test.
  const drive = async <T>(operation: Promise<T>): Promise<T> => {
    let done = false
    void operation.then(() => { done = true }, () => { done = true })
    for (let i = 0; !done && i < 100; i++) { tick(); await settle() }
    assert.equal(done, true, 'operation should finish through renderer frames')
    return operation
  }
  return { runtime, recorder, session, errors, tick, drive }
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

test('record waits for the active preview draw and owns rendering until all frames finish', async () => {
  const { session, runtime, recorder, tick, drive } = setup()
  const draw = deferred()
  runtime.draw = () => draw.promise
  session.play()
  tick()
  const recording = session.record(30, () => {})
  assert.equal(session.state.playing, false)
  await settle()
  assert.equal(recorder.starts, 0)
  session.play()
  assert.equal(session.state.playing, false)
  runtime.draw = async () => {}
  draw.resolve()
  const blob = await drive(recording)
  assert.ok(blob.size > 0)
  assert.deepEqual(recorder.timestamps, [0, 1 / 30, 2 / 30])
  assert.deepEqual(runtime.draws.slice(1), [0, 1 / 30, 2 / 30, 0])
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, true)
  await session.dispose()
})

test('cancel during the handoff to record is honored before capturing a frame', async () => {
  const { session, runtime, recorder, tick, drive } = setup()
  const draw = deferred()
  runtime.draw = () => draw.promise
  session.play()
  tick()
  const recording = session.record(30, () => {})
  session.cancelRecording()
  runtime.draw = async () => {}
  draw.resolve()
  await assert.rejects(drive(recording), { name: 'AbortError' })
  assert.deepEqual(recorder.timestamps, [])
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, true)
  await session.dispose()
})

test('final view reads baked poses without advancing; play starts a new cycle', async () => {
  const { session, runtime, drive } = setup()
  await drive(session.showFinal())
  assert.equal(runtime.final, true)
  assert.deepEqual(runtime.updates, [])
  assert.equal(session.state.time, runtime.motionDuration)
  assert.equal(session.state.showingFinal, true)
  assert.equal(session.state.playing, false)
  session.play()
  assert.equal(runtime.final, false)
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, true)
  await session.dispose()
})

test('record failure cleans up and restores a paused preview at the start', async () => {
  const { session, runtime, recorder, drive } = setup()
  recorder.add = async () => { throw new Error('encode failed') }
  await assert.rejects(drive(session.record(30, () => {})), /encode failed/)
  assert.equal(recorder.aborts, 1)
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, false)
  await drive(session.restart())
  assert.equal(session.state.playing, true)
  await session.dispose()
})

test('settings updates cannot overlap recording; dispose waits for capture and never restarts preview', async () => {
  const { session, recorder, runtime, tick, drive } = setup()
  const capture = deferred()
  recorder.add = () => capture.promise
  session.play()
  const recording = session.record(30, () => {})
  const rejectedRecording = assert.rejects(recording, { name: 'AbortError' })
  await settle()
  tick()
  await settle()
  await assert.rejects(session.update(() => { throw new Error('should not execute') }), /busy/)
  let disposed = false
  const disposal = session.dispose().then(() => { disposed = true })
  await settle()
  assert.equal(disposed, false)
  capture.resolve()
  await drive(disposal)
  await rejectedRecording
  assert.equal(runtime.animationLoop, null)
  assert.equal(session.state.playing, false)
  assert.equal(runtime.draws.length, 1)
})

test('preview wraps by resetting and advancing forward, with no renders while paused', async () => {
  const { session, runtime, tick } = setup()
  runtime.time = runtime.duration - 0.001
  session.play()
  tick()
  await settle()
  assert.equal(runtime.resets, 1)
  assert.ok(runtime.time < runtime.duration)
  session.pause()
  const count = runtime.draws.length
  tick()
  await settle()
  assert.equal(runtime.draws.length, count)
  assert.equal(session.state.playing, false)
  await session.dispose()
})

test('cancel waits for pixel readback and never submits the cancelled frame', async () => {
  const { session, runtime, recorder, tick, drive } = setup()
  const readback = deferred()
  runtime.readFrame = async () => {
    await readback.promise
    return { width: 1, height: 1, pixels: new Uint8Array(4) }
  }
  const recording = session.record(30, () => {})
  const rejected = assert.rejects(recording, { name: 'AbortError' })
  await settle()
  tick()
  await settle()
  assert.equal(runtime.draws.length, 1)
  assert.equal(recorder.timestamps.length, 0)
  session.cancelRecording()
  readback.resolve()
  await drive(rejected)
  assert.equal(recorder.timestamps.length, 0)
  assert.equal(runtime.time, 0)
  await session.dispose()
})


test('every requested draw waits for a renderer frame, including reset after final view', async () => {
  const { session, runtime, recorder, tick, drive } = setup()
  const final = session.showFinal()
  await settle()
  assert.equal(runtime.draws.length, 0)
  tick()
  await final
  const recording = session.record(30, () => {})
  await settle()
  assert.equal(runtime.draws.length, 1)
  assert.equal(runtime.final, false)
  tick()
  await settle()
  assert.deepEqual(recorder.timestamps, [0])
  assert.deepEqual(runtime.draws, [0, 0])
  await drive(recording)
  await session.dispose()
})

test('slow GPU and encoder do not advance or submit extra recording frames', async () => {
  const { session, runtime, recorder, tick, drive } = setup()
  const gpu = deferred(), encode = deferred()
  runtime.draw = () => gpu.promise
  recorder.add = () => encode.promise
  const recording = session.record(30, () => {})
  await settle()
  tick()
  await settle()
  for (let i = 0; i < 5; i++) { tick(); await settle() }
  assert.deepEqual(runtime.draws, [0])
  assert.deepEqual(runtime.updates, [0])
  assert.deepEqual(recorder.timestamps, [])
  runtime.draw = async () => {}
  gpu.resolve()
  await settle()
  assert.deepEqual(recorder.timestamps, [0])
  for (let i = 0; i < 5; i++) { tick(); await settle() }
  assert.deepEqual(runtime.updates, [0])
  assert.deepEqual(runtime.draws, [0])
  recorder.add = async () => {}
  encode.resolve()
  await drive(recording)
  assert.deepEqual(recorder.timestamps, [0, 1 / 30, 2 / 30])
  await session.dispose()
})


test('dispose rejects a queued draw without waiting for another renderer frame', async () => {
  const { session, runtime } = setup()
  const update = session.showFinal()
  const rejected = assert.rejects(update, { name: 'AbortError' })
  await settle()
  assert.equal(runtime.draws.length, 0)
  await session.dispose()
  await rejected
  assert.equal(runtime.animationLoop, null)
  assert.equal(runtime.draws.length, 0)
})


test('record forwards selected quality and defaults to high without changing frame times', async () => {
  const { session, recorder, drive } = setup()
  await drive(session.record(30, () => {}, 'medium'))
  await drive(session.record(30, () => {}))
  assert.deepEqual(recorder.qualities, ['medium', 'high'])
  assert.deepEqual(recorder.timestamps, [0, 1 / 30, 2 / 30, 0, 1 / 30, 2 / 30])
  await session.dispose()
})
