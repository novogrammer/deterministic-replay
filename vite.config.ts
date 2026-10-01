import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url))
const publicRoot = fileURLToPath(new URL('./public', import.meta.url))
const outputRoot = fileURLToPath(new URL('./dist', import.meta.url))

export default defineConfig({
  root: sourceRoot,
  base: './',
  publicDir: publicRoot,
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
  },
})
