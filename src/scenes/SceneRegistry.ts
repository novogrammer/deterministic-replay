import type { SceneEntry, SimulationScene } from './SimulationScene.ts'
import { SquareTrayScene } from './square-tray/SquareTrayScene.ts'
import { SquareTrayPerspectiveScene } from './square-tray-perspective/SquareTrayPerspectiveScene.ts'
import { TorusKnotPileScene } from './torus-knot-pile/TorusKnotPileScene.ts'

export class SceneRegistry {
  private readonly entries = new Map<string, SceneEntry>()

  constructor(scenes: SceneEntry[] = [{
    id: 'square-tray', title: 'Square tray · 平行投影',
    bakePath: 'square-tray/bake.json',
    create: options => SquareTrayScene.create(options?.baked === false ? { formatVersion: 1, bake: null } : undefined),
  }, {
    id: 'square-tray-perspective', title: 'Square tray · 透視投影＋ライト',
    bakePath: 'square-tray-perspective/bake.json',
    create: options => SquareTrayPerspectiveScene.create(options?.baked === false ? { formatVersion: 1, bake: null } : undefined),
  }, {
    id: 'torus-knot-pile', title: 'Torus knot pile · 透視投影＋ライト',
    bakePath: 'torus-knot-pile/bake.json',
    create: options => TorusKnotPileScene.create(options?.baked === false ? { formatVersion: 1, bake: null } : undefined),
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
