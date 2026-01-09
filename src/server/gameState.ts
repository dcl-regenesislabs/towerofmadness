import { engine, Entity, Transform, GltfContainer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import {
  RoundStateComponent,
  LeaderboardComponent,
  WinnersComponent,
  TowerConfigComponent,
  RoundPhase
} from '../shared/schemas'

// Helper to protect synced components on an entity
type ComponentWithValidation = {
  validateBeforeChange: (entity: Entity, cb: (value: { senderAddress: string }) => boolean) => void
}

function protectServerEntity(entity: Entity, components: ComponentWithValidation[]) {
  for (const component of components) {
    component.validateBeforeChange(entity, (value) => {
      return value.senderAddress === AUTH_SERVER_PEER_ID
    })
  }
}

// Constants
const CHUNK_OPTIONS = ['Chunk01', 'Chunk02', 'Chunk03']
const MIN_CHUNKS = 3
const MAX_CHUNKS = 8
const BASE_TIMER = 420 // 7 minutes
const CHUNK_HEIGHT = 10.821
const TOWER_X = 40
const TOWER_Z = 40

// Player tracking (server-side only)
interface PlayerData {
  address: string
  displayName: string
  maxHeight: number
  bestTime: number
  isFinished: boolean
  finishOrder: number
}

export class GameState {
  private static instance: GameState

  // Synced state entities
  public roundStateEntity!: Entity
  public leaderboardEntity!: Entity
  public winnersEntity!: Entity
  public towerConfigEntity!: Entity

  // Tower entities (synced to clients)
  private towerEntities: Entity[] = []

  // Server-only state
  private players = new Map<string, PlayerData>()
  private roundStartTime: number = 0
  private finisherCount: number = 0

  public static getInstance(): GameState {
    if (!GameState.instance) {
      GameState.instance = new GameState()
    }
    return GameState.instance
  }

  private constructor() {}

  init() {
    console.log('[Server] Initializing game state...')

    // Create round state entity
    this.roundStateEntity = engine.addEntity()
    RoundStateComponent.create(this.roundStateEntity, {
      roundId: '',
      phase: RoundPhase.ACTIVE,
      baseTimer: BASE_TIMER,
      speedMultiplier: 1,
      lastSpeedChangeTime: Date.now(),
      remainingAtSpeedChange: BASE_TIMER,
      finisherCount: 0
    })
    syncEntity(this.roundStateEntity, [RoundStateComponent.componentId])

    // Create leaderboard entity
    this.leaderboardEntity = engine.addEntity()
    LeaderboardComponent.create(this.leaderboardEntity, {
      players: []
    })
    syncEntity(this.leaderboardEntity, [LeaderboardComponent.componentId])

    // Create winners entity
    this.winnersEntity = engine.addEntity()
    WinnersComponent.create(this.winnersEntity, {
      winners: []
    })
    syncEntity(this.winnersEntity, [WinnersComponent.componentId])

    // Create tower config entity
    this.towerConfigEntity = engine.addEntity()
    TowerConfigComponent.create(this.towerConfigEntity, {
      chunkIds: [],
      chunkHeight: CHUNK_HEIGHT,
      totalHeight: 0
    })
    syncEntity(this.towerConfigEntity, [TowerConfigComponent.componentId])

    console.log('[Server] Game state initialized')
  }

  // Player management
  getPlayer(address: string): PlayerData | undefined {
    return this.players.get(address)
  }

  setPlayer(address: string, data: PlayerData) {
    this.players.set(address, data)
    this.updateLeaderboard()
  }

  // Tower management
  private destroyTower() {
    for (const entity of this.towerEntities) {
      engine.removeEntity(entity)
    }
    this.towerEntities = []
    console.log('[Server] Tower destroyed')
  }

  private createTower(chunkIds: string[]) {
    // Create middle chunks
    for (let i = 0; i < chunkIds.length; i++) {
      const yPosition = CHUNK_HEIGHT * (i + 1)
      const rotationY = i % 2 === 0 ? 180 : 0

      const entity = engine.addEntity()
      Transform.create(entity, {
        position: Vector3.create(TOWER_X, yPosition, TOWER_Z),
        rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
        scale: Vector3.One()
      })
      GltfContainer.create(entity, {
        src: `assets/chunks/${chunkIds[i]}.glb`
      })
      protectServerEntity(entity, [Transform, GltfContainer])
      syncEntity(entity, [Transform.componentId, GltfContainer.componentId])
      this.towerEntities.push(entity)
    }

    // Create ChunkEnd at the top
    const endY = CHUNK_HEIGHT * (chunkIds.length + 1)
    const lastIndex = chunkIds.length - 1
    const endRotationY = lastIndex % 2 === 0 ? 180 : 0

    const endEntity = engine.addEntity()
    Transform.create(endEntity, {
      position: Vector3.create(TOWER_X, endY, TOWER_Z),
      rotation: Quaternion.fromEulerDegrees(0, endRotationY, 0),
      scale: Vector3.One()
    })
    GltfContainer.create(endEntity, {
      src: 'assets/chunks/ChunkEnd.glb'
    })
    protectServerEntity(endEntity, [Transform, GltfContainer])
    syncEntity(endEntity, [Transform.componentId, GltfContainer.componentId])
    this.towerEntities.push(endEntity)

    // Update tower config for UI (include ChunkStart at the beginning)
    const allChunks = ['ChunkStart', ...chunkIds, 'ChunkEnd']
    const totalHeight = CHUNK_HEIGHT * (chunkIds.length + 2) // +1 for ChunkEnd, +1 for base
    const towerConfig = TowerConfigComponent.getMutable(this.towerConfigEntity)
    towerConfig.chunkIds = allChunks
    towerConfig.totalHeight = totalHeight

    console.log(`[Server] Tower created: ${chunkIds.length} chunks`)
  }

  // Round management
  startNewRound() {
    const roundId = `round_${Date.now()}`

    // Destroy old tower
    this.destroyTower()

    // Generate random chunks
    const numChunks = Math.floor(Math.random() * (MAX_CHUNKS - MIN_CHUNKS + 1)) + MIN_CHUNKS
    const chunkIds: string[] = []
    for (let i = 0; i < numChunks; i++) {
      chunkIds.push(CHUNK_OPTIONS[Math.floor(Math.random() * CHUNK_OPTIONS.length)])
    }

    console.log(`[Server] New round: ${roundId}, chunks: [${chunkIds.join(' -> ')}]`)

    // Create new tower
    this.createTower(chunkIds)

    // Reset round state
    const now = Date.now()
    this.roundStartTime = now
    this.finisherCount = 0

    const roundState = RoundStateComponent.getMutable(this.roundStateEntity)
    roundState.roundId = roundId
    roundState.phase = RoundPhase.ACTIVE
    roundState.baseTimer = BASE_TIMER
    roundState.speedMultiplier = 1
    roundState.lastSpeedChangeTime = now
    roundState.remainingAtSpeedChange = BASE_TIMER
    roundState.finisherCount = 0

    // Reset all players
    this.players.forEach((player) => {
      player.maxHeight = 0
      player.bestTime = 0
      player.isFinished = false
      player.finishOrder = 0
    })

    // Clear winners
    const winners = WinnersComponent.getMutable(this.winnersEntity)
    winners.winners = []

    this.updateLeaderboard()
  }

  incrementFinisherCount(): number {
    this.finisherCount++
    const now = Date.now()

    // Calculate current remaining time before speed change
    const roundState = RoundStateComponent.get(this.roundStateEntity)
    const elapsed = (now - roundState.lastSpeedChangeTime) / 1000
    const adjustedElapsed = elapsed * roundState.speedMultiplier
    const currentRemaining = Math.max(0, roundState.remainingAtSpeedChange - adjustedElapsed)

    // Update with new speed multiplier and timestamp
    const mutableState = RoundStateComponent.getMutable(this.roundStateEntity)
    mutableState.finisherCount = this.finisherCount
    mutableState.speedMultiplier = this.finisherCount + 1
    mutableState.lastSpeedChangeTime = now
    mutableState.remainingAtSpeedChange = currentRemaining

    console.log(`[Server] Speed increased to x${this.finisherCount + 1}, remaining: ${currentRemaining.toFixed(1)}s`)

    return this.finisherCount
  }

  getSpeedMultiplier(): number {
    return RoundStateComponent.get(this.roundStateEntity).speedMultiplier
  }

  // Check if round timer has expired (no longer syncs - clients calculate locally)
  checkTimerExpired(): boolean {
    const roundState = RoundStateComponent.get(this.roundStateEntity)
    if (roundState.phase !== RoundPhase.ACTIVE) return false

    const now = Date.now()
    const elapsed = (now - roundState.lastSpeedChangeTime) / 1000
    const adjustedElapsed = elapsed * roundState.speedMultiplier
    const remaining = roundState.remainingAtSpeedChange - adjustedElapsed

    return remaining <= 0
  }

  endRound() {
    console.log('[Server] Round ended!')

    const roundState = RoundStateComponent.getMutable(this.roundStateEntity)
    roundState.phase = RoundPhase.ENDING

    // Calculate winners
    const playerArray = Array.from(this.players.values())
    playerArray.sort((a, b) => {
      if (a.isFinished && b.isFinished) return a.bestTime - b.bestTime
      if (a.isFinished) return -1
      if (b.isFinished) return 1
      return b.maxHeight - a.maxHeight
    })

    const top3 = playerArray.slice(0, 3)
    const winners = WinnersComponent.getMutable(this.winnersEntity)
    winners.winners = top3.map((p, i) => ({
      address: p.address,
      displayName: p.displayName,
      time: p.bestTime,
      height: p.maxHeight,
      rank: i + 1
    }))

    console.log('[Server] Winners:', top3.map((p) => p.displayName).join(', '))
  }

  setPhase(phase: RoundPhase) {
    const roundState = RoundStateComponent.getMutable(this.roundStateEntity)
    roundState.phase = phase
  }

  getPhase(): RoundPhase {
    return RoundStateComponent.get(this.roundStateEntity).phase
  }

  private updateLeaderboard() {
    const playerArray = Array.from(this.players.values())
    playerArray.sort((a, b) => {
      if (a.isFinished && b.isFinished) return a.finishOrder - b.finishOrder
      if (a.isFinished) return -1
      if (b.isFinished) return 1
      return b.maxHeight - a.maxHeight
    })

    const leaderboard = LeaderboardComponent.getMutable(this.leaderboardEntity)
    leaderboard.players = playerArray.slice(0, 10).map((p) => ({
      address: p.address,
      displayName: p.displayName,
      maxHeight: p.maxHeight,
      bestTime: p.bestTime,
      isFinished: p.isFinished,
      finishOrder: p.finishOrder
    }))
  }
}
