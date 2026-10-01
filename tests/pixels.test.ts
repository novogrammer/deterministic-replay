import assert from 'node:assert/strict'
import test from 'node:test'
import { packRgbaRows } from '../src/rendering/PixelFrame.ts'

test('readback strips WebGPU row padding and owns its pixel buffer', () => {
  const source = new Uint8Array(256 + 12)
  source.fill(11, 0, 12)
  source.fill(22, 256)
  const pixels = packRgbaRows(source, 3, 2, false)
  assert.deepEqual([...pixels], [...Array(12).fill(11), ...Array(12).fill(22)])
  source.fill(99)
  assert.equal(pixels[0], 11)
})

test('WebGL readback flips bottom-up rows without changing columns', () => {
  const source = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255])
  assert.deepEqual([...packRgbaRows(source, 1, 2, true)], [4, 5, 6, 255, 1, 2, 3, 255])
  assert.throws(() => packRgbaRows(source, 3, 2, false), /readback size/)
})
