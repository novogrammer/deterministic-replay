import type { SceneDefinition } from './SceneDefinition.ts'
import { SquareTrayScene } from './SquareTrayScene.ts'

export class SceneRegistry {
  private readonly definitions = new Map<string, SceneDefinition>()

  constructor(scenes: SceneDefinition[] = [new SquareTrayScene()]) {
    for (const scene of scenes) {
      if (this.definitions.has(scene.id)) throw new Error(`Duplicate scene: ${scene.id}`)
      this.definitions.set(scene.id, scene)
    }
  }

  get(id: string): SceneDefinition {
    const scene = this.definitions.get(id)
    if (!scene) throw new Error(`Unknown scene: ${id}`)
    return scene
  }

  list(): SceneDefinition[] {
    return [...this.definitions.values()]
  }
}
