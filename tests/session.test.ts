import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { SessionController } from '../src/player/SessionController.ts'
import type { FrameRecorder, SessionRuntime } from '../src/player/SessionController.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

class FakeRuntime implements SessionRuntime {
  readonly canvas = {} as HTMLCanvasElement
  duration = 0.1
  motionDuration = 0.08
  time = 0
  final = false
  draws: number[] = []
  updates: number[] = []
  resets = 0
  draw: () => Promise<void> = async () => {}
  reset(): void { this.resets++; this.time = 0; this.final = false }
  advance(delta: number): void {
    assert.ok(delta >= 0)
    assert.equal(this.final, false)
    this.time += delta
    this.updates.push(this.time)
  }
  showFinal(): void { this.final = true }
  async render(): Promise<void> { this.draws.push(this.time); await this.draw() }
}

class FakeRecorder implements FrameRecorder {
  timestamps: number[] = []
  starts = 0
  aborts = 0
  add: () => Promise<void> = async () => {}
  start(): Promise<void> { this.starts++; return Promise.resolve() }
  async addFrame(timestamp: number): Promise<void> { this.timestamps.push(timestamp); await this.add() }
  finish(): Promise<Blob> { return Promise.resolve(new Blob(['test'])) }
  abort(): Promise<void> { this.aborts++; return Promise.resolve() }
}

globalThis.requestAnimationFrame = () => { throw new Error('Clock not installed') }
globalThis.cancelAnimationFrame = () => {}

function setup(t: TestContext) {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 0
  t.mock.method(globalThis, 'requestAnimationFrame', callback => { callbacks.set(++nextId, callback); return nextId })
  t.mock.method(globalThis, 'cancelAnimationFrame', id => { callbacks.delete(id) })
  const runtime = new FakeRuntime()
  const recorder = new FakeRecorder()
  const errors: unknown[] = []
  const session = new SessionController(runtime, recorder, () => {}, error => errors.push(error))
  return {
    runtime, recorder, session, callbacks, errors,
    tick: () => {
      const [id, callback] = callbacks.entries().next().value!
      callbacks.delete(id)
      callback(performance.now() + 16)
    },
  }
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

test('record waits for the active preview draw and owns rendering until all frames finish', async t => {
  const { session, runtime, recorder, callbacks, tick } = setup(t)
  const draw = deferred()
  runtime.draw = () => draw.promise
  session.play()
  tick()
  const recording = session.record(30, () => {})
  assert.equal(callbacks.size, 0)
  await settle()
  assert.equal(recorder.starts, 0)
  session.play()
  assert.equal(callbacks.size, 0)
  runtime.draw = async () => {}
  draw.resolve()
  const blob = await recording
  assert.ok(blob.size > 0)
  assert.deepEqual(recorder.timestamps, [0, 1 / 30, 2 / 30])
  assert.deepEqual(runtime.draws.slice(1), [0, 1 / 30, 2 / 30, 0])
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, true)
  assert.equal(callbacks.size, 1)
  await session.dispose()
})

test('cancel during the handoff to record is honored before capturing a frame', async t => {
  const { session, runtime, recorder, tick } = setup(t)
  const draw = deferred()
  runtime.draw = () => draw.promise
  session.play()
  tick()
  const recording = session.record(30, () => {})
  session.cancelRecording()
  runtime.draw = async () => {}
  draw.resolve()
  await assert.rejects(recording, { name: 'AbortError' })
  assert.deepEqual(recorder.timestamps, [])
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, true)
  await session.dispose()
})

test('final view reads baked poses without advancing; play starts a new cycle', async t => {
  const { session, runtime, callbacks } = setup(t)
  await session.showFinal()
  assert.equal(runtime.final, true)
  assert.deepEqual(runtime.updates, [])
  assert.equal(session.state.time, runtime.motionDuration)
  assert.equal(session.state.showingFinal, true)
  assert.equal(callbacks.size, 0)
  session.play()
  assert.equal(runtime.final, false)
  assert.equal(runtime.time, 0)
  assert.equal(callbacks.size, 1)
  await session.dispose()
})

test('record failure cleans up and restores a paused preview at the start', async t => {
  const { session, runtime, recorder, callbacks } = setup(t)
  recorder.add = async () => { throw new Error('encode failed') }
  await assert.rejects(session.record(30, () => {}), /encode failed/)
  assert.equal(recorder.aborts, 1)
  assert.equal(runtime.time, 0)
  assert.equal(session.state.playing, false)
  assert.equal(callbacks.size, 0)
  await session.restart()
  assert.equal(callbacks.size, 1)
  await session.dispose()
})

test('settings updates cannot overlap recording; dispose waits for capture and never restarts preview', async t => {
  const { session, recorder, callbacks, runtime } = setup(t)
  const capture = deferred()
  recorder.add = () => capture.promise
  session.play()
  const recording = session.record(30, () => {})
  const rejectedRecording = assert.rejects(recording, { name: 'AbortError' })
  await settle()
  await assert.rejects(session.update(() => { throw new Error('should not execute') }), /busy/)
  let disposed = false
  const disposal = session.dispose().then(() => { disposed = true })
  await settle()
  assert.equal(disposed, false)
  capture.resolve()
  await rejectedRecording
  await disposal
  assert.equal(callbacks.size, 0)
  assert.equal(runtime.draws.length, 1)
})

test('preview wraps by resetting and advancing forward, with no renders while paused', async t => {
  const { session, runtime, callbacks, tick } = setup(t)
  runtime.time = runtime.duration - 0.001
  session.play()
  tick()
  await settle()
  assert.equal(runtime.resets, 1)
  assert.ok(runtime.time < runtime.duration)
  session.pause()
  const count = runtime.draws.length
  await settle()
  assert.equal(runtime.draws.length, count)
  assert.equal(callbacks.size, 0)
  await session.dispose()
})
