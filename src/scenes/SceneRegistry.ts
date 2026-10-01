import type { SceneEntry, SimulationScene } from './SimulationScene.ts'
import { SquareTrayScene } from './square-tray/SquareTrayScene.ts'

export class SceneRegistry {
  private readonly entries = new Map<string, SceneEntry>()

  constructor(scenes: SceneEntry[] = [{
    id: 'square-tray', title: 'Square tray',
    bakePath: 'square-tray/bake.json',
    create: options => SquareTrayScene.create(options?.baked === false ? { formatVersion: 1, bake: null } : undefined),
  }]) {
    for (const scene of scenes) {
      if (this.entries.has(scene.id)) throw new Error(`Duplicate scene: ${scene.id}`)
      this.entries.set(scene.id, scene)
    }
  }

  get(id: string): SceneEntry {
    const scene = this.entries.get(id)
    if (!scene) throw new Error(`Unknown scene: ${id}`)
    return scene
  }

  create(id: string): Promise<SimulationScene> { return this.get(id).create() }

  list(): SceneEntry[] {
    return [...this.entries.values()]
  }
}
