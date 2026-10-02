import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { SeededRandom } from './SeededRandom.ts'

/** Scene-owned construction and spawning; the simulation manages their lifetime. */
export interface PhysicsDefinition {
  readonly seed: number
  readonly count: number
  readonly timeStep: number
  readonly spawnSteps: readonly number[]
  createWorld(): RAPIER.World
  createBody(world: RAPIER.World, id: number, random: SeededRandom): RAPIER.RigidBody
}

export class PhysicsSimulation {
  static readonly ready = RAPIER.init()
  readonly definition: PhysicsDefinition
  readonly spawnSteps: readonly number[]
  world!: RAPIER.World
  private bodies: (RAPIER.RigidBody | undefined)[] = []
  private readonly scheduledIds = new Map<number, number[]>()
  private random!: SeededRandom
  private disposed = true
  step = 0

  constructor(definition: PhysicsDefinition) {
    this.definition = definition
    const spawnSteps = [...definition.spawnSteps]
    if (!Number.isInteger(definition.count) || definition.count < 0
      || spawnSteps.length !== definition.count
      || spawnSteps.some(step => !Number.isInteger(step) || step < 0)) {
      throw new Error('Each instance needs a non-negative integer spawn step.')
    }
    this.spawnSteps = Object.freeze(spawnSteps)
    this.spawnSteps.forEach((step, id) => {
      const ids = this.scheduledIds.get(step) ?? []
      ids.push(id)
      this.scheduledIds.set(step, ids)
    })
    this.reset()
  }

  reset(): void {
    this.dispose()
    this.world = this.definition.createWorld()
    this.disposed = false
    this.world.timestep = this.definition.timeStep
    this.bodies = Array.from({ length: this.definition.count }, () => undefined)
    this.random = new SeededRandom(this.definition.seed)
    this.step = 0
    try { this.spawn() }
    catch (error) { this.dispose(); throw error }
  }

  advance(): void {
    this.world.step()
    this.step++
    this.spawn()
  }

  get settled(): boolean {
    return this.bodies.every(body => body !== undefined && body.isSleeping())
  }

  writePoses(target: Float32Array): void {
    target.fill(0)
    this.bodies.forEach((body, id) => {
      if (!body) return
      const p = body.translation()
      const q = body.rotation()
      target.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], id * 7)
    })
  }

  private spawn(): void {
    for (const id of this.scheduledIds.get(this.step) ?? []) {
      this.bodies[id] = this.definition.createBody(this.world, id, this.random)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.world.free()
    this.disposed = true
  }
}
