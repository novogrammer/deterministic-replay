import { writeFile } from 'node:fs/promises'
import { SceneRegistry } from '../src/scenes/SceneRegistry.ts'

const registry = new SceneRegistry()
const requestedId = process.argv[2]
const entries = requestedId ? [registry.get(requestedId)] : registry.list()
for (const entry of entries) {
  // Always construct without baked poses so stale/missing final poses do not block rebaking.
  const scene = await entry.create({ baked: false })
  try {
    const data = scene.bake()
    await writeFile(new URL(`../src/scenes/${entry.bakePath}`, import.meta.url), `${JSON.stringify(data)}\n`)
    const metadata = data.bake!
    console.log(`${scene.id}: ${scene.count} final Matrix4s, ${metadata.endStep} steps, ${(metadata.endStep * scene.timeStep).toFixed(2)}s; no trajectory saved`)
  } finally { scene.dispose() }
}
