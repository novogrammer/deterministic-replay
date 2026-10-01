import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { PhysicsSettings } from '../scenes/SceneData.ts'

class SeededRandom {
  private state: number
  constructor(seed: number) { this.state = seed >>> 0 }
  next(): number {
    this.state ^= this.state << 13
    this.state ^= this.state >>> 17
    this.state ^= this.state << 5
    return (this.state >>> 0) / 4294967296
  }
}

export class PhysicsSimulation {
  static readonly ready = RAPIER.init()
  readonly definition: PhysicsSettings
  readonly spawnSteps: number[]
  world!: RAPIER.World
  private bodies: RAPIER.RigidBody[] = []
  private random!: SeededRandom
  step = 0

  constructor(definition: PhysicsSettings) {
    this.definition = definition
    this.spawnSteps = Array.from({ length: definition.count }, (_, id) =>
      Math.floor(id / definition.batchSize) * definition.spawnEverySteps)
    this.reset()
  }

  reset(): void {
    this.world?.free()
    const scene = this.definition
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = scene.timeStep
    this.world.integrationParameters.numSolverIterations = 8
    this.bodies = []
    this.random = new SeededRandom(scene.seed)
    this.step = 0
    for (const box of scene.colliderBoxes) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(...box.halfSize)
        .setTranslation(...box.position).setFriction(0.6).setRestitution(0))
    }
    this.spawn()
  }

  advance(): void {
    this.world.step()
    this.step++
    this.spawn()
  }

  get settled(): boolean {
    return this.bodies.length === this.definition.count && this.bodies.every(body => body.isSleeping())
  }

  writePoses(target: Float32Array): void {
    target.fill(0)
    this.bodies.forEach((body, id) => {
      const p = body.translation()
      const q = body.rotation()
      target.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], id * 7)
    })
  }

  private spawn(): void {
    const scene = this.definition
    while (this.bodies.length < scene.count && this.spawnSteps[this.bodies.length] === this.step) {
      const lane = this.bodies.length % scene.batchSize
      const x = -scene.width / 2 + 0.5 + lane * ((scene.width - 1) / (scene.batchSize - 1))
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x + (this.random.next() - 0.5) * 0.16, 5.4 + this.random.next() * 0.18, 0)
        .setLinvel((this.random.next() - 0.5) * 0.4, -0.2, 0)
        .setAngvel({ x: this.random.next() - 0.5, y: this.random.next() - 0.5, z: this.random.next() - 0.5 })
        .setLinearDamping(0.12).setAngularDamping(0.4).setCcdEnabled(true))
      this.world.createCollider(RAPIER.ColliderDesc.ball(scene.radius)
        .setDensity(1).setFriction(0.45).setRestitution(0.08), body)
      this.bodies.push(body)
    }
  }

  dispose(): void { this.world.free() }
}
