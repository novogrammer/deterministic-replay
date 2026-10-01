/** An owned CPU snapshot, tightly packed RGBA8/sRGB, rows ordered from top to bottom. */
export interface PixelFrame {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
}

export function packRgbaRows(source: Uint8Array, width: number, height: number, flipY: boolean): Uint8Array {
  const rowBytes = width * 4
  // WebGPU readback rows may be aligned to 256 bytes; WebGL returns tightly packed rows.
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256
  const stride = source.length === rowBytes * height ? rowBytes : paddedRowBytes
  if (source.length < (height - 1) * stride + rowBytes) throw new Error('Invalid RGBA readback size.')
  const pixels = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const sourceY = flipY ? height - 1 - y : y
    pixels.set(source.subarray(sourceY * stride, sourceY * stride + rowBytes), y * rowBytes)
  }
  return pixels
}
