import { engine, Entity, Transform, GltfContainer, VisibilityComponent, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { Storage } from '@dcl/sdk/server'
import { sendMANA } from './prizeTransfer'
import { TOURNAMENT_CONFIG } from './tournamentConfig'
import {
  RoundStateComponent,
  LeaderboardComponent,
  PointLeaderboardComponent,
  TournamentLeaderboardComponent,
  WinnersComponent,
  TowerConfigComponent,
  TournamentComponent,
  ChunkComponent,
  ChunkEndComponent,
  TriggerEndComponent,
  RoundPhase
} from '../shared/schemas'
import {
  CHUNK_END_ID,
  CHUNK_START_ID,
  MAX_TOWER_MIDDLE_CHUNKS,
  MIDDLE_CHUNK_IDS,
  MIN_TOWER_MIDDLE_CHUNKS,
  getChunkAssetPath
} from '../shared/chunks'
import { PodiumAvatarsServer } from './podiumAvatarsServer'

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
const BASE_TIMER = 420 // 7 minutes
const CHUNK_HEIGHT = 10.821
const TOWER_X = 40
const TOWER_Z = 40
const TRIGGER_END_OFFSET = Vector3.create(0, 0, -37.25)
const TRIGGER_END_SCALE = Vector3.create(23.6, 10.9, 19.6)
const GLOBAL_LEADERBOARD_KEY = 'globalLeaderboard'
const GLOBAL_LEADERBOARD_SIZE = 10
const WEEKLY_LEADERBOARD_KEY = 'weeklyLeaderboard'
const WEEKLY_LEADERBOARD_SIZE = 10
const POINTS_GLOBAL_LEADERBOARD_KEY = 'globalPointLeaderboard'
const POINTS_GLOBAL_LEADERBOARD_SIZE = 10
const POINTS_WEEKLY_LEADERBOARD_KEY = 'weeklyPointLeaderboard'
const POINTS_WEEKLY_LEADERBOARD_SIZE = 10
const TOURNAMENT_STATE_KEY = 'tournamentState'
const TOURNAMENT_LEADERBOARD_KEY = 'tournamentLeaderboard'

function getWeekStartKeyUTC(now: number = Date.now()): string {
  const d = new Date(now)
  const day = d.getUTCDay() // 0 = Sunday
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - day)
  const y = start.getUTCFullYear()
  const m = String(start.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(start.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const WINNER_POINTS = [100, 90, 80]
const ADDITIONAL_WINNER_POINTS = 30
const NOWIN_START_POINTS = 5
const NOWIN_MIN_POINTS = 1

// Player tracking (server-side only, current round)
interface PlayerData {
  address: string
  displayName: string
  maxHeight: number
  bestTime: number
  isFinished: boolean
  finishOrder: number
  attemptStartTime: number // Server timestamp when player started attempt (0 = not started)
  lastHeight: number
  lastHeightTime: number
  teleportStrikes: number
}

// All-time best scores (persisted)
interface AllTimeBest {
  address: string
  displayName: string
  bestTime: number
  bestHeight: number
  finishCount: number
  lastPlayed: number
}

interface WeeklyBest {
  address: string
  displayName: string
  bestTime: number
  bestHeight: number
  finishCount: number
  lastPlayed: number
}

interface AllTimePoints {
  address: string
  displayName: string
  points: number
  lastPlayed: number
}

interface WeeklyPoints {
  address: string
  displayName: string
  points: number
  lastPlayed: number
}

function orderByFinishTime<T extends { bestTime: number; finishOrder: number; address: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.bestTime !== b.bestTime) return a.bestTime - b.bestTime
    if (a.finishOrder !== b.finishOrder) return a.finishOrder - b.finishOrder
    return a.address.localeCompare(b.address)
  })
}

function orderByHeight<T extends { maxHeight: number; address: string; lastHeightTime?: number }>(
  entries: T[],
  useLastHeightTimeTieBreaker: boolean = false
): T[] {
  return [...entries].sort((a, b) => {
    if (a.maxHeight !== b.maxHeight) return b.maxHeight - a.maxHeight
    if (useLastHeightTimeTieBreaker && a.lastHeightTime !== undefined && b.lastHeightTime !== undefined) {
      if (a.lastHeightTime !== b.lastHeightTime) return a.lastHeightTime - b.lastHeightTime
    }
    return a.address.localeCompare(b.address)
  })
}

function orderByBestResult<T extends { finishCount: number; bestTime: number; bestHeight: number; address: string }>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) => {
    if (a.finishCount > 0 && b.finishCount > 0) return a.bestTime - b.bestTime
    if (a.finishCount > 0) return -1
    if (b.finishCount > 0) return 1
    if (a.bestHeight !== b.bestHeight) return b.bestHeight - a.bestHeight
    return a.address.localeCompare(b.address)
  })
}


export class GameState {
  private static instance: GameState

  // Synced state entities
  public roundStateEntity!: Entity
  public leaderboardEntity!: Entity
  public pointLeaderboardEntity!: Entity
  public winnersEntity!: Entity
  public towerConfigEntity!: Entity
  public triggerEndEntity!: Entity
  public tournamentEntity!: Entity

  // Tower entities (synced to clients)
  private towerEntities: Entity[] = []
  private towerEntityPool: Entity[] = []
  private podiumServer: PodiumAvatarsServer | null = null

  // Server-only state
  private players = new Map<string, PlayerData>()
  private roundStartTime: number = 0
  private finisherCount: number = 0

  // All-time best scores (persisted)
  private allTimeBests = new Map<string, AllTimeBest>()
  private weeklyBests = new Map<string, WeeklyBest>()
  private weeklyMetaKey: string = getWeekStartKeyUTC()
  private lastAllTimeKey: string = ''
  private lastWeeklyKey: string = ''
  private allTimePoints = new Map<string, AllTimePoints>()
  private weeklyPoints = new Map<string, WeeklyPoints>()
  private weeklyPointsMetaKey: string = getWeekStartKeyUTC()
  private lastAllTimePointsKey: string = ''
  private lastWeeklyPointsKey: string = ''

  // Tournament leaderboard (separate from weekly/alltime)
  private tournamentPoints = new Map<string, { address: string; displayName: string; points: number }>()
  private tournamentLeaderboardEntity!: Entity

  // Tournament state (server-only)
  public tournamentActive: boolean = false
  private tournamentEndTime: number = 0
  private tournamentPrizeMANA: number = 0
  private tournamentId: string = ''
  private tournamentEnding: boolean = false

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
      players: [],
      weeklyPlayers: []
    })
    syncEntity(this.leaderboardEntity, [LeaderboardComponent.componentId])

    // Create winners entity
    this.winnersEntity = engine.addEntity()
    WinnersComponent.create(this.winnersEntity, {
      winners: []
    })
    syncEntity(this.winnersEntity, [WinnersComponent.componentId])

    // Create point leaderboard entity
    this.pointLeaderboardEntity = engine.addEntity()
    PointLeaderboardComponent.create(this.pointLeaderboardEntity, {
      players: [],
      weeklyPlayers: []
    })
    syncEntity(this.pointLeaderboardEntity, [PointLeaderboardComponent.componentId])

    // Create tournament leaderboard entity
    this.tournamentLeaderboardEntity = engine.addEntity()
    TournamentLeaderboardComponent.create(this.tournamentLeaderboardEntity, {
      tournamentId: '',
      players: []
    })
    syncEntity(this.tournamentLeaderboardEntity, [TournamentLeaderboardComponent.componentId])

    // Create tournament entity
    this.tournamentEntity = engine.addEntity()
    TournamentComponent.create(this.tournamentEntity, {
      tournamentMode: TOURNAMENT_CONFIG.tournamentMode,
      active: false,
      tournamentId: '',
      endTime: 0,
      prizeMANA: 0,
      winnerAddress: '',
      winnerName: '',
      winnerPoints: 0,
      paymentTxHash: ''
    })
    syncEntity(this.tournamentEntity, [TournamentComponent.componentId])

    // Create tower config entity
    this.towerConfigEntity = engine.addEntity()
    TowerConfigComponent.create(this.towerConfigEntity, {
      chunkIds: [],
      chunkHeight: CHUNK_HEIGHT,
      totalHeight: 0
    })
    syncEntity(this.towerConfigEntity, [TowerConfigComponent.componentId])

    // Create trigger end entity (synced; client adds TriggerArea)
    this.triggerEndEntity = engine.addEntity()
    Transform.create(this.triggerEndEntity, {
      position: Vector3.create(TOWER_X + TRIGGER_END_OFFSET.x, 0 + TRIGGER_END_OFFSET.y, TOWER_Z + TRIGGER_END_OFFSET.z),
      scale: TRIGGER_END_SCALE
    })
    MeshRenderer.setBox(this.triggerEndEntity)
    Material.setPbrMaterial(this.triggerEndEntity, {
      albedoColor: Color4.create(1, 0, 0, 0.4),
      metallic: 0,
      roughness: 1
    })
    VisibilityComponent.create(this.triggerEndEntity, { visible: false })
    TriggerEndComponent.create(this.triggerEndEntity, {})
    protectServerEntity(this.triggerEndEntity, [Transform, MeshRenderer, Material, VisibilityComponent, TriggerEndComponent])
    syncEntity(this.triggerEndEntity, [
      Transform.componentId,
      MeshRenderer.componentId,
      Material.componentId,
      VisibilityComponent.componentId,
      TriggerEndComponent.componentId
    ])

    // Create entity pool for tower chunks (max middle chunks + 1 for ChunkEnd)
    for (let i = 0; i < MAX_TOWER_MIDDLE_CHUNKS + 1; i++) {
      const entity = engine.addEntity()
      Transform.create(entity, {
        position: Vector3.create(TOWER_X, 0, TOWER_Z),
        scale: Vector3.One()
      })
      GltfContainer.create(entity, { src: '' })
      VisibilityComponent.create(entity, { visible: false })
      ChunkComponent.create(entity, {})
      protectServerEntity(entity, [Transform, GltfContainer, VisibilityComponent, ChunkComponent, ChunkEndComponent])
      syncEntity(entity, [
        Transform.componentId,
        GltfContainer.componentId,
        VisibilityComponent.componentId,
        ChunkComponent.componentId,
        ChunkEndComponent.componentId
      ])
      this.towerEntityPool.push(entity)
    }

    this.podiumServer = new PodiumAvatarsServer()

    console.log('[Server] Game state initialized')

    void this.loadGlobalLeaderboard()
    void this.loadWeeklyLeaderboard()
    void this.loadGlobalPointLeaderboard()
    void this.loadWeeklyPointLeaderboard()
    void this.restoreTournamentState()
  }

  // Player management (normalize address to lowercase for consistency)
  getPlayer(address: string): PlayerData | undefined {
    return this.players.get(address.toLowerCase())
  }

  setPlayer(address: string, data: PlayerData) {
    const normalizedAddress = address.toLowerCase()
    data.address = normalizedAddress
    this.players.set(normalizedAddress, data)

    // Update all-time bests in real-time
    this.updateAllTimeBest(
      normalizedAddress,
      data.displayName,
      data.bestTime,
      data.maxHeight,
      data.isFinished
    )

    // Update weekly bests in real-time
    this.updateWeeklyBest(
      normalizedAddress,
      data.displayName,
      data.bestTime,
      data.maxHeight,
      data.isFinished
    )

    this.updateLeaderboard()

  }

  // All-time best management
  updateAllTimeBest(
    address: string,
    displayName: string,
    time: number,
    height: number,
    finished: boolean
  ): boolean {
    const normalizedAddress = address.toLowerCase()
    const existing = this.allTimeBests.get(normalizedAddress)
    let changed = false

    if (existing) {
      if (finished && (time < existing.bestTime || existing.bestTime === 0)) {
        existing.bestTime = time
        existing.finishCount++
        changed = true
      }
      if (height > existing.bestHeight) {
        existing.bestHeight = height
        changed = true
      }
      if (existing.displayName !== displayName) {
        existing.displayName = displayName
        changed = true
      }
      existing.lastPlayed = Date.now()
    } else {
      this.allTimeBests.set(normalizedAddress, {
        address: normalizedAddress,
        displayName: displayName,
        bestTime: finished ? time : 0,
        bestHeight: height,
        finishCount: finished ? 1 : 0,
        lastPlayed: Date.now()
      })
      changed = true
    }
    return changed
  }

  updateWeeklyBest(
    address: string,
    displayName: string,
    time: number,
    height: number,
    finished: boolean
  ): boolean {
    this.ensureWeeklyCurrent()
    const normalizedAddress = address.toLowerCase()
    const existing = this.weeklyBests.get(normalizedAddress)
    let changed = false

    if (existing) {
      if (finished && (time < existing.bestTime || existing.bestTime === 0)) {
        existing.bestTime = time
        existing.finishCount++
        changed = true
      }
      if (height > existing.bestHeight) {
        existing.bestHeight = height
        changed = true
      }
      if (existing.displayName !== displayName) {
        existing.displayName = displayName
        changed = true
      }
      existing.lastPlayed = Date.now()
    } else {
      this.weeklyBests.set(normalizedAddress, {
        address: normalizedAddress,
        displayName: displayName,
        bestTime: finished ? time : 0,
        bestHeight: height,
        finishCount: finished ? 1 : 0,
        lastPlayed: Date.now()
      })
      changed = true
    }
    return changed
  }

  getAllTimeBests(): AllTimeBest[] {
    return orderByBestResult(Array.from(this.allTimeBests.values()))
  }

  getWeeklyBests(): WeeklyBest[] {
    return orderByBestResult(Array.from(this.weeklyBests.values()))
  }

  // Tower management
  private destroyTower() {
    for (const entity of this.towerEntityPool) {
      // Reset src to empty string so CRDT always emits a delta when createTower assigns a new src.
      // Without this, if the same chunk asset is reused across rounds the CRDT sees no change and
      // some clients skip reloading the GLTF, losing colliders on those chunks.
      GltfContainer.getMutable(entity).src = ''
      VisibilityComponent.getMutable(entity).visible = false
    }
    this.towerEntities = []
    console.log('[Server] Tower hidden')
  }

  private createTower(chunkIds: string[]) {
    this.towerEntities = []

    // Configure middle chunks from pool
    for (let i = 0; i < chunkIds.length; i++) {
      const entity = this.towerEntityPool[i]
      const yPosition = CHUNK_HEIGHT * (i + 1)
      const rotationY = i % 2 === 0 ? 180 : 0

      const transform = Transform.getMutable(entity)
      transform.position = Vector3.create(TOWER_X, yPosition, TOWER_Z)
      transform.rotation = Quaternion.fromEulerDegrees(0, rotationY, 0)
      transform.scale = Vector3.One()

      GltfContainer.getMutable(entity).src = getChunkAssetPath(chunkIds[i])
      VisibilityComponent.getMutable(entity).visible = true

      this.towerEntities.push(entity)
    }

    // Configure ChunkEnd from pool
    const endEntity = this.towerEntityPool[chunkIds.length]
    const endY = CHUNK_HEIGHT * (chunkIds.length + 1)
    const endRotationY = (chunkIds.length - 1) % 2 === 0 ? 180 : 0

    const endTransform = Transform.getMutable(endEntity)
    endTransform.position = Vector3.create(TOWER_X, endY, TOWER_Z)
    endTransform.rotation = Quaternion.fromEulerDegrees(0, endRotationY, 0)
    endTransform.scale = Vector3.One()

    GltfContainer.getMutable(endEntity).src = getChunkAssetPath(CHUNK_END_ID)
    VisibilityComponent.getMutable(endEntity).visible = true
    // Ensure only the current end entity has the ChunkEnd tag
    for (const entity of this.towerEntityPool) {
      if (ChunkEndComponent.has(entity)) ChunkEndComponent.deleteFrom(entity)
    }
    ChunkEndComponent.create(endEntity, {})

    this.towerEntities.push(endEntity)

    // Position TriggerEnd in world space (parent is not synced to clients)
    const triggerTransform = Transform.getMutable(this.triggerEndEntity)
    triggerTransform.parent = undefined
    const rotatedOffset = Vector3.rotate(TRIGGER_END_OFFSET, endTransform.rotation)
    triggerTransform.position = Vector3.create(
      endTransform.position.x + rotatedOffset.x,
      endTransform.position.y + rotatedOffset.y,
      endTransform.position.z + rotatedOffset.z
    )
    triggerTransform.scale = TRIGGER_END_SCALE
    console.log(`[Server] TriggerEnd positioned at y=${triggerTransform.position.y.toFixed(2)}`)

    // Hide unused pool entities (if fewer chunks this round)
    for (let i = chunkIds.length + 1; i < this.towerEntityPool.length; i++) {
      VisibilityComponent.getMutable(this.towerEntityPool[i]).visible = false
    }

    // Update tower config for UI (include ChunkStart at the beginning)
    const allChunks = [CHUNK_START_ID, ...chunkIds, CHUNK_END_ID]
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
    const numChunks =
      Math.floor(Math.random() * (MAX_TOWER_MIDDLE_CHUNKS - MIN_TOWER_MIDDLE_CHUNKS + 1)) +
      MIN_TOWER_MIDDLE_CHUNKS
    const chunkIds = Array.from({ length: numChunks }, () =>
      MIDDLE_CHUNK_IDS[Math.floor(Math.random() * MIDDLE_CHUNK_IDS.length)]
    )

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
      player.attemptStartTime = 0
      player.lastHeight = 0
      player.lastHeightTime = 0
      player.teleportStrikes = 0
    })

    // Clear winners
    const winners = WinnersComponent.getMutable(this.winnersEntity)
    winners.winners = []

    this.podiumServer?.clear()

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

    // Calculate podium winners:
    // - If at least one player finished, rank only finishers by best time.
    // - If nobody finished, rank all players by max height reached.
    const playerArray = Array.from(this.players.values())
    const finishers = playerArray.filter((player) => player.isFinished)
    const podiumCandidates =
      finishers.length > 0 ? orderByFinishTime(finishers) : orderByHeight(playerArray, true)

    const top3 = podiumCandidates.slice(0, 3)
    const winners = WinnersComponent.getMutable(this.winnersEntity)
    winners.winners = top3.map((p, i) => ({
      address: p.address,
      displayName: p.displayName,
      time: p.bestTime,
      height: p.maxHeight,
      rank: i + 1
    }))

    this.podiumServer?.showWinners(winners.winners)

    console.log('[Server] Winners:', top3.map((p) => p.displayName).join(', '))

    const pointsChanged = this.calculateRoundPoints(playerArray)
    this.updateLeaderboard()

    void this.persistGlobalLeaderboard()
    void this.persistWeeklyLeaderboard()
    if (pointsChanged) {
      void this.persistGlobalPointLeaderboard()
      void this.persistWeeklyPointLeaderboard()
    }
  }

  setPhase(phase: RoundPhase) {
    const roundState = RoundStateComponent.getMutable(this.roundStateEntity)
    roundState.phase = phase
  }

  getPhase(): RoundPhase {
    return RoundStateComponent.get(this.roundStateEntity).phase
  }

  getTowerConfig(): { totalHeight: number; chunkCount: number } {
    const config = TowerConfigComponent.get(this.towerConfigEntity)
    return {
      totalHeight: config.totalHeight,
      chunkCount: config.chunkIds.length
    }
  }

  private calculateRoundPoints(players: PlayerData[]): boolean {
    if (players.length === 0) {
      console.log('[Server][Points] No players this round')
      return false
    }

    const pointsToAward = new Map<string, { displayName: string; points: number }>()
    const queuePoints = (player: PlayerData, points: number) => {
      const existing = pointsToAward.get(player.address)
      if (existing) {
        existing.points += points
        existing.displayName = player.displayName
      } else {
        pointsToAward.set(player.address, { displayName: player.displayName, points })
      }
    }

    const finishers = players.filter((player) => player.isFinished)
    if (finishers.length > 0) {
      console.log('[Server][Points] Winners detected. Awarding finish points.')
      const sortedFinishers = orderByFinishTime(finishers)

      sortedFinishers.forEach((player, index) => {
        const points = index < 3 ? WINNER_POINTS[index] : ADDITIONAL_WINNER_POINTS
        const label = index < 3 ? `winner #${index + 1}` : 'additional winner'
        queuePoints(player, points)
        console.log(
          `[Server][Points] ${player.displayName} (${player.address}) +${points} pts (${label})`
        )
      })
      return this.applyPoints(pointsToAward)
    }

    console.log(
      `[Server][Points] No winners this round. Awarding points to highest climbers (${NOWIN_START_POINTS}..${NOWIN_MIN_POINTS}).`
    )
    const sortedByHeight = orderByHeight(players, true)

    let points = NOWIN_START_POINTS
    let rank = 1
    for (const player of sortedByHeight) {
      if (points < NOWIN_MIN_POINTS) break
      queuePoints(player, points)
      console.log(
        `[Server][Points] ${player.displayName} (${player.address}) +${points} pts (highest #${rank})`
      )
      points--
      rank++
    }
    return this.applyPoints(pointsToAward)
  }

  private updateLeaderboard() {
    this.ensureWeeklyCurrent()

    const allTimeSorted = orderByBestResult(Array.from(this.allTimeBests.values()))
    const weeklySorted = orderByBestResult(Array.from(this.weeklyBests.values()))

    const buildEntry = (
      address: string,
      displayName: string,
      allTime: AllTimeBest | undefined,
      weekly: WeeklyBest | undefined
    ) => {
      const currentRound = this.players.get(address)
      return {
        address: address,
        displayName: displayName,
        maxHeight: currentRound?.maxHeight || 0,
        bestTime: currentRound?.bestTime || 0,
        isFinished: currentRound?.isFinished || false,
        finishOrder: currentRound?.finishOrder || 0,
        allTimeBestTime: allTime?.bestTime || 0,
        allTimeBestHeight: allTime?.bestHeight || 0,
        allTimeFinishCount: allTime?.finishCount || 0,
        weeklyBestTime: weekly?.bestTime || 0,
        weeklyBestHeight: weekly?.bestHeight || 0,
        weeklyFinishCount: weekly?.finishCount || 0
      }
    }

    const leaderboard = LeaderboardComponent.getMutable(this.leaderboardEntity)
    const allTimeTop = allTimeSorted.slice(0, 10)
    const weeklyTop = weeklySorted.slice(0, 10)

    const allTimeKey = allTimeTop
      .map((p) => `${p.address}:${p.displayName}:${p.bestTime}:${p.bestHeight}:${p.finishCount}`)
      .join('|')
    const weeklyKey = weeklyTop
      .map((p) => `${p.address}:${p.displayName}:${p.bestTime}:${p.bestHeight}:${p.finishCount}`)
      .join('|')

    if (allTimeKey === this.lastAllTimeKey && weeklyKey === this.lastWeeklyKey) {
      return
    }
    this.lastAllTimeKey = allTimeKey
    this.lastWeeklyKey = weeklyKey

    leaderboard.players = allTimeTop.map((allTime) => {
      const weekly = this.weeklyBests.get(allTime.address)
      return buildEntry(allTime.address, allTime.displayName, allTime, weekly)
    })

    leaderboard.weeklyPlayers = weeklyTop.map((weekly) => {
      const allTime = this.allTimeBests.get(weekly.address)
      const displayName = allTime?.displayName || weekly.displayName
      return buildEntry(weekly.address, displayName, allTime, weekly)
    })
  }

  private applyPoints(pointsToAward: Map<string, { displayName: string; points: number }>): boolean {
    if (pointsToAward.size === 0) return false
    this.ensureWeeklyPointsCurrent()

    let changed = false
    const now = Date.now()
    for (const [address, award] of pointsToAward.entries()) {
      if (award.points <= 0) continue

      const allTime = this.allTimePoints.get(address)
      if (allTime) {
        allTime.points += award.points
        allTime.displayName = award.displayName
        allTime.lastPlayed = now
      } else {
        this.allTimePoints.set(address, {
          address,
          displayName: award.displayName,
          points: award.points,
          lastPlayed: now
        })
      }

      const weekly = this.weeklyPoints.get(address)
      if (weekly) {
        weekly.points += award.points
        weekly.displayName = award.displayName
        weekly.lastPlayed = now
      } else {
        this.weeklyPoints.set(address, {
          address,
          displayName: award.displayName,
          points: award.points,
          lastPlayed: now
        })
      }

      // Tournament leaderboard — only accumulate if a tournament is active
      if (TOURNAMENT_CONFIG.tournamentMode && this.tournamentActive) {
        const t = this.tournamentPoints.get(address)
        if (t) {
          t.points += award.points
          t.displayName = award.displayName
        } else {
          this.tournamentPoints.set(address, { address, displayName: award.displayName, points: award.points })
        }
        this.updateTournamentLeaderboard()
        void this.persistTournamentLeaderboard()
      }

      changed = true
    }

    if (changed) {
      this.updatePointLeaderboard()
    }

    return changed
  }

  private updatePointLeaderboard() {
    this.ensureWeeklyPointsCurrent()

    const sortByPoints = (a: { points: number; address: string }, b: { points: number; address: string }) => {
      if (a.points !== b.points) return b.points - a.points
      return a.address.localeCompare(b.address)
    }

    const allTimeSorted = Array.from(this.allTimePoints.values()).sort(sortByPoints)
    const weeklySorted = Array.from(this.weeklyPoints.values()).sort(sortByPoints)
    const allTimeTop = allTimeSorted.slice(0, POINTS_GLOBAL_LEADERBOARD_SIZE)
    const weeklyTop = weeklySorted.slice(0, POINTS_WEEKLY_LEADERBOARD_SIZE)

    const allTimeKey = allTimeTop.map((p) => `${p.address}:${p.displayName}:${p.points}`).join('|')
    const weeklyKey = weeklyTop.map((p) => `${p.address}:${p.displayName}:${p.points}`).join('|')

    if (allTimeKey === this.lastAllTimePointsKey && weeklyKey === this.lastWeeklyPointsKey) {
      return
    }
    this.lastAllTimePointsKey = allTimeKey
    this.lastWeeklyPointsKey = weeklyKey

    const pointLeaderboard = PointLeaderboardComponent.getMutable(this.pointLeaderboardEntity)
    pointLeaderboard.players = allTimeTop.map((entry) => ({
      address: entry.address,
      displayName: entry.displayName,
      points: entry.points
    }))
    pointLeaderboard.weeklyPlayers = weeklyTop.map((entry) => ({
      address: entry.address,
      displayName: entry.displayName,
      points: entry.points
    }))
  }

  private async loadGlobalLeaderboard() {
    if (!isServer()) return

    try {
      const stored = await Storage.get<string>(GLOBAL_LEADERBOARD_KEY)
      if (!stored) return

      const entries = JSON.parse(stored) as AllTimeBest[]
      for (const entry of entries) {
        if (!entry?.address) continue
        const normalizedAddress = entry.address.toLowerCase()
        this.allTimeBests.set(normalizedAddress, {
          address: normalizedAddress,
          displayName: entry.displayName || normalizedAddress.substring(0, 8),
          bestTime: Number(entry.bestTime) || 0,
          bestHeight: Number(entry.bestHeight) || 0,
          finishCount: Number(entry.finishCount) || 0,
          lastPlayed: Number(entry.lastPlayed) || 0
        })
      }

      console.log(`[Server][Storage] Loaded global leaderboard: ${entries.length} entries`)
      this.updateLeaderboard()
    } catch (error) {
      console.error('[Server][Storage] Failed to load global leaderboard:', error)
    }
  }

  private async loadWeeklyLeaderboard() {
    if (!isServer()) return

    try {
      const currentWeek = getWeekStartKeyUTC()
      this.weeklyMetaKey = currentWeek

      const stored = await Storage.get<string>(`${WEEKLY_LEADERBOARD_KEY}_${currentWeek}`)
      if (!stored) return

      const entries = JSON.parse(stored) as WeeklyBest[]
      for (const entry of entries) {
        if (!entry?.address) continue
        const normalizedAddress = entry.address.toLowerCase()
        this.weeklyBests.set(normalizedAddress, {
          address: normalizedAddress,
          displayName: entry.displayName || normalizedAddress.substring(0, 8),
          bestTime: Number(entry.bestTime) || 0,
          bestHeight: Number(entry.bestHeight) || 0,
          finishCount: Number(entry.finishCount) || 0,
          lastPlayed: Number(entry.lastPlayed) || 0
        })
      }

      console.log(`[Server][Storage] Loaded weekly leaderboard: ${entries.length} entries`)
      this.updateLeaderboard()
    } catch (error) {
      console.error('[Server][Storage] Failed to load weekly leaderboard:', error)
    }
  }

  private async persistGlobalLeaderboard() {
    if (!isServer()) return

    try {
      const topEntries = this.getAllTimeBests().slice(0, GLOBAL_LEADERBOARD_SIZE)
      await Storage.set(GLOBAL_LEADERBOARD_KEY, JSON.stringify(topEntries))
      console.log(`[Server][Storage] Saved global leaderboard: ${topEntries.length} entries`)
    } catch (error) {
      console.error('[Server][Storage] Failed to save global leaderboard:', error)
    }
  }

  private async persistWeeklyLeaderboard() {
    if (!isServer()) return
    this.ensureWeeklyCurrent()

    try {
      const topEntries = this.getWeeklyBests().slice(0, WEEKLY_LEADERBOARD_SIZE)
      await Storage.set(`${WEEKLY_LEADERBOARD_KEY}_${this.weeklyMetaKey}`, JSON.stringify(topEntries))
      console.log(`[Server][Storage] Saved weekly leaderboard: ${topEntries.length} entries`)
    } catch (error) {
      console.error('[Server][Storage] Failed to save weekly leaderboard:', error)
    }
  }

  private async loadGlobalPointLeaderboard() {
    if (!isServer()) return

    try {
      const stored = await Storage.get<string>(POINTS_GLOBAL_LEADERBOARD_KEY)
      if (!stored) return

      const entries = JSON.parse(stored) as AllTimePoints[]
      for (const entry of entries) {
        if (!entry?.address) continue
        const normalizedAddress = entry.address.toLowerCase()
        this.allTimePoints.set(normalizedAddress, {
          address: normalizedAddress,
          displayName: entry.displayName || normalizedAddress.substring(0, 8),
          points: Number(entry.points) || 0,
          lastPlayed: Number(entry.lastPlayed) || 0
        })
      }

      console.log(`[Server][Storage] Loaded global point leaderboard: ${entries.length} entries`)
      this.updatePointLeaderboard()
    } catch (error) {
      console.error('[Server][Storage] Failed to load global point leaderboard:', error)
    }
  }

  private async loadWeeklyPointLeaderboard() {
    if (!isServer()) return

    try {
      const currentWeek = getWeekStartKeyUTC()
      this.weeklyPointsMetaKey = currentWeek

      const stored = await Storage.get<string>(`${POINTS_WEEKLY_LEADERBOARD_KEY}_${currentWeek}`)
      if (!stored) return

      const entries = JSON.parse(stored) as WeeklyPoints[]
      for (const entry of entries) {
        if (!entry?.address) continue
        const normalizedAddress = entry.address.toLowerCase()
        this.weeklyPoints.set(normalizedAddress, {
          address: normalizedAddress,
          displayName: entry.displayName || normalizedAddress.substring(0, 8),
          points: Number(entry.points) || 0,
          lastPlayed: Number(entry.lastPlayed) || 0
        })
      }

      console.log(`[Server][Storage] Loaded weekly point leaderboard: ${entries.length} entries`)
      this.updatePointLeaderboard()
    } catch (error) {
      console.error('[Server][Storage] Failed to load weekly point leaderboard:', error)
    }
  }

  private async persistGlobalPointLeaderboard() {
    if (!isServer()) return

    try {
      const topEntries = Array.from(this.allTimePoints.values())
        .sort((a, b) => {
          if (a.points !== b.points) return b.points - a.points
          return a.address.localeCompare(b.address)
        })
        .slice(0, POINTS_GLOBAL_LEADERBOARD_SIZE)
      await Storage.set(POINTS_GLOBAL_LEADERBOARD_KEY, JSON.stringify(topEntries))
      console.log(`[Server][Storage] Saved global point leaderboard: ${topEntries.length} entries`)
    } catch (error) {
      console.error('[Server][Storage] Failed to save global point leaderboard:', error)
    }
  }

  private async persistWeeklyPointLeaderboard() {
    if (!isServer()) return
    this.ensureWeeklyPointsCurrent()

    try {
      const topEntries = Array.from(this.weeklyPoints.values())
        .sort((a, b) => {
          if (a.points !== b.points) return b.points - a.points
          return a.address.localeCompare(b.address)
        })
        .slice(0, POINTS_WEEKLY_LEADERBOARD_SIZE)
      await Storage.set(`${POINTS_WEEKLY_LEADERBOARD_KEY}_${this.weeklyPointsMetaKey}`, JSON.stringify(topEntries))
      console.log(`[Server][Storage] Saved weekly point leaderboard: ${topEntries.length} entries`)
    } catch (error) {
      console.error('[Server][Storage] Failed to save weekly point leaderboard:', error)
    }
  }

  // ============================================
  // TOURNAMENT LEADERBOARD
  // ============================================

  private updateTournamentLeaderboard() {
    const sorted = Array.from(this.tournamentPoints.values()).sort((a, b) => b.points - a.points)
    const lb = TournamentLeaderboardComponent.getMutable(this.tournamentLeaderboardEntity)
    lb.tournamentId = this.tournamentId
    lb.players = sorted.slice(0, 10)
  }

  private async persistTournamentLeaderboard() {
    try {
      const entries = Array.from(this.tournamentPoints.values())
      await Storage.set(`${TOURNAMENT_LEADERBOARD_KEY}_${this.tournamentId}`, JSON.stringify(entries))
    } catch (err) {
      console.error('[Server][Storage] Failed to save tournament leaderboard:', err)
    }
  }

  async loadTournamentLeaderboard(tournamentId: string) {
    try {
      const stored = await Storage.get<string>(`${TOURNAMENT_LEADERBOARD_KEY}_${tournamentId}`)
      if (!stored) return
      const entries = JSON.parse(stored) as { address: string; displayName: string; points: number }[]
      this.tournamentPoints.clear()
      for (const e of entries) {
        this.tournamentPoints.set(e.address, e)
      }
      this.updateTournamentLeaderboard()
    } catch (err) {
      console.error('[Server][Storage] Failed to load tournament leaderboard:', err)
    }
  }

  // ============================================
  // TOURNAMENT
  // ============================================

  startTournament(durationMinutes: number, prizeMANA: number) {
    this.tournamentId = `tournament_${Date.now()}`
    this.tournamentEndTime = Date.now() + durationMinutes * 60 * 1000
    this.tournamentPrizeMANA = prizeMANA
    this.tournamentActive = true
    this.tournamentEnding = false

    // Reset tournament leaderboard (weekly/alltime leaderboards are NOT affected)
    this.tournamentPoints.clear()
    this.updateTournamentLeaderboard()

    const t = TournamentComponent.getMutable(this.tournamentEntity)
    t.active = true
    t.tournamentId = this.tournamentId
    t.endTime = this.tournamentEndTime
    t.prizeType = TOURNAMENT_CONFIG.prizeType
    t.prizeMANA = prizeMANA
    t.winnerAddress = ''
    t.winnerName = ''
    t.winnerPoints = 0
    t.paymentTxHash = ''

    void this.persistTournamentState()
    console.log(`[Tournament] Started: ${this.tournamentId}, duration: ${durationMinutes}m, prize: ${prizeMANA} MANA`)
  }

  checkTournamentExpired(): boolean {
    return this.tournamentActive && !this.tournamentEnding && Date.now() >= this.tournamentEndTime
  }

  async endTournament() {
    if (!this.tournamentActive || this.tournamentEnding) return
    this.tournamentEnding = true

    // Winner = top of tournament leaderboard
    const sorted = Array.from(this.tournamentPoints.values()).sort((a, b) => b.points - a.points)
    const topPlayer = sorted[0] ?? null

    // Fallback: if no one scored points, send prize to the default winner address
    const FALLBACK_WINNER = '0xc502975b49398f9754afc4e9693cf0e1594f3275'
    const winner = topPlayer ?? { address: FALLBACK_WINNER, displayName: 'fallback-winner', points: 0 }

    console.log(`[Tournament] Ended. Winner: ${winner.displayName} (${winner.points} pts)${!topPlayer ? ' [fallback]' : ''}`)

    const t = TournamentComponent.getMutable(this.tournamentEntity)
    t.active = false
    t.winnerAddress = winner?.address ?? ''
    t.winnerName = winner?.displayName ?? ''
    t.winnerPoints = winner?.points ?? 0

    this.tournamentActive = false
    void this.persistTournamentState()

    await this.transferMANA(winner.address, this.tournamentPrizeMANA, this.tournamentId)
  }

  private async persistTournamentState() {
    const state = {
      active: this.tournamentActive,
      tournamentId: this.tournamentId,
      endTime: this.tournamentEndTime,
      prizeMANA: this.tournamentPrizeMANA
    }
    await Storage.set(TOURNAMENT_STATE_KEY, JSON.stringify(state))
  }

  async restoreTournamentState() {
    const stored = await Storage.get<string>(TOURNAMENT_STATE_KEY)
    if (!stored) return

    try {
      const state = JSON.parse(stored) as { active: boolean; tournamentId: string; endTime: number; prizeMANA: number }
      if (!state.active) return
      if (Date.now() >= state.endTime) {
        console.log('[Tournament] Restored state but tournament already expired — ending now')
        this.tournamentId = state.tournamentId
        this.tournamentEndTime = state.endTime
        this.tournamentPrizeMANA = state.prizeMANA
        this.tournamentActive = true
        this.tournamentEnding = false
        await this.endTournament()
        return
      }

      this.tournamentId = state.tournamentId
      this.tournamentEndTime = state.endTime
      this.tournamentPrizeMANA = state.prizeMANA
      this.tournamentActive = true
      this.tournamentEnding = false

      const t = TournamentComponent.getMutable(this.tournamentEntity)
      t.active = true
      t.tournamentId = this.tournamentId
      t.endTime = this.tournamentEndTime
      t.prizeMANA = state.prizeMANA
      t.winnerAddress = ''
      t.winnerName = ''
      t.winnerPoints = 0
      t.paymentTxHash = ''

      void this.loadTournamentLeaderboard(this.tournamentId)

      const remainingMs = state.endTime - Date.now()
      console.log(`[Tournament] Restored: ${this.tournamentId}, ${(remainingMs / 60000).toFixed(1)}min remaining`)
    } catch (err) {
      console.error('[Tournament] Failed to restore state:', err)
    }
  }

  private async transferMANA(address: string, amount: number, tournamentId: string) {
    if (TOURNAMENT_CONFIG.dryRun) {
      const prizeLabel = TOURNAMENT_CONFIG.prizeType === 'wearable' ? 'wearable' : `${amount} MANA`
      console.log(`[Tournament][DRY RUN] Would send ${prizeLabel} to ${address} (tournamentId: ${tournamentId})`)
      const t = TournamentComponent.getMutable(this.tournamentEntity)
      t.paymentTxHash = 'dry-run-no-tx'
      return
    }

    if (TOURNAMENT_CONFIG.prizeType === 'wearable') {
      // Wearable is claimed client-side by the winner using their own wallet signature
      console.log(`[Tournament] → Wearable prize: winner ${address} will auto-claim client-side`)
      const t = TournamentComponent.getMutable(this.tournamentEntity)
      t.paymentTxHash = 'pending-claim'
      return
    }

    console.log(`[Tournament] → Sending ${amount} MANA to ${address} (tournamentId: ${tournamentId})`)
    const txHash = await sendMANA(address, amount)
    if (txHash) {
      const t = TournamentComponent.getMutable(this.tournamentEntity)
      t.paymentTxHash = txHash
    }
  }

  private ensureWeeklyCurrent() {
    const currentWeek = getWeekStartKeyUTC()
    if (this.weeklyMetaKey === currentWeek) return
    this.weeklyMetaKey = currentWeek
    this.weeklyBests.clear()
  }

  private ensureWeeklyPointsCurrent() {
    const currentWeek = getWeekStartKeyUTC()
    if (this.weeklyPointsMetaKey === currentWeek) return
    this.weeklyPointsMetaKey = currentWeek
    this.weeklyPoints.clear()
    this.lastWeeklyPointsKey = ''
  }
}
