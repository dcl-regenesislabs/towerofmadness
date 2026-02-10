import { engine, Entity, Transform, GltfContainer, VisibilityComponent, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { Storage } from '@dcl/sdk/server'
import {
  RoundStateComponent,
  LeaderboardComponent,
  WinnersComponent,
  TowerConfigComponent,
  ChunkComponent,
  ChunkEndComponent,
  TriggerEndComponent,
  RoundPhase
} from '../shared/schemas'
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
const CHUNK_OPTIONS = ['Chunk01', 'Chunk02', 'Chunk03']
const MIN_CHUNKS = 3
const MAX_CHUNKS = 8
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


export class GameState {
  private static instance: GameState

  // Synced state entities
  public roundStateEntity!: Entity
  public leaderboardEntity!: Entity
  public winnersEntity!: Entity
  public towerConfigEntity!: Entity
  public triggerEndEntity!: Entity

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

    // Create entity pool for tower chunks (MAX_CHUNKS + 1 for ChunkEnd)
    for (let i = 0; i < MAX_CHUNKS + 1; i++) {
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
    const didUpdateAllTime = this.updateAllTimeBest(
      normalizedAddress,
      data.displayName,
      data.bestTime,
      data.maxHeight,
      data.isFinished
    )
    if (didUpdateAllTime) {
      this.maybePersistGlobalLeaderboard()
    }

    // Update weekly bests in real-time
    const didUpdateWeekly = this.updateWeeklyBest(
      normalizedAddress,
      data.displayName,
      data.bestTime,
      data.maxHeight,
      data.isFinished
    )
    if (didUpdateWeekly) {
      this.maybePersistWeeklyLeaderboard()
    }

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
    return Array.from(this.allTimeBests.values()).sort((a, b) => {
      if (a.finishCount > 0 && b.finishCount > 0) return a.bestTime - b.bestTime
      if (a.finishCount > 0) return -1
      if (b.finishCount > 0) return 1
      return b.bestHeight - a.bestHeight
    })
  }

  getWeeklyBests(): WeeklyBest[] {
    return Array.from(this.weeklyBests.values()).sort((a, b) => {
      if (a.finishCount > 0 && b.finishCount > 0) return a.bestTime - b.bestTime
      if (a.finishCount > 0) return -1
      if (b.finishCount > 0) return 1
      return b.bestHeight - a.bestHeight
    })
  }

  // Tower management
  private destroyTower() {
    // Hide all pooled entities using VisibilityComponent
    for (const entity of this.towerEntityPool) {
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

      GltfContainer.getMutable(entity).src = `assets/chunks/${chunkIds[i]}.glb`
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

    GltfContainer.getMutable(endEntity).src = 'assets/custom/chunkend01.glb/ChunkEnd.glb'
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
    const chunkIds = Array.from({ length: numChunks }, () =>
      CHUNK_OPTIONS[Math.floor(Math.random() * CHUNK_OPTIONS.length)]
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

    this.podiumServer?.showWinners(winners.winners)

    console.log('[Server] Winners:', top3.map((p) => p.displayName).join(', '))

    this.calculateRoundPoints(playerArray)

    void this.persistGlobalLeaderboard()
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

  // TODO: Replace these logs with persistent points storage and leaderboard updates. (NEXT PR)
  private calculateRoundPoints(players: PlayerData[]) {
    if (players.length === 0) {
      console.log('[Server][Points] No players this round')
      return
    }

    const finishers = players.filter((player) => player.isFinished)
    if (finishers.length > 0) {
      console.log('[Server][Points] Winners detected. Awarding finish points.')
      const sortedFinishers = [...finishers].sort((a, b) => {
        if (a.bestTime !== b.bestTime) return a.bestTime - b.bestTime
        if (a.finishOrder !== b.finishOrder) return a.finishOrder - b.finishOrder
        return a.address.localeCompare(b.address)
      })

      sortedFinishers.forEach((player, index) => {
        const points = index < 3 ? WINNER_POINTS[index] : ADDITIONAL_WINNER_POINTS
        const label = index < 3 ? `winner #${index + 1}` : 'additional winner'
        console.log(
          `[Server][Points] ${player.displayName} (${player.address}) +${points} pts (${label})`
        )
      })
      return
    }

    console.log(
      `[Server][Points] No winners this round. Awarding points to highest climbers (${NOWIN_START_POINTS}..${NOWIN_MIN_POINTS}).`
    )
    const sortedByHeight = [...players].sort((a, b) => {
      if (a.maxHeight !== b.maxHeight) return b.maxHeight - a.maxHeight
      if (a.lastHeightTime !== b.lastHeightTime) return a.lastHeightTime - b.lastHeightTime
      return a.address.localeCompare(b.address)
    })

    let points = NOWIN_START_POINTS
    let rank = 1
    for (const player of sortedByHeight) {
      if (points < NOWIN_MIN_POINTS) break
      console.log(
        `[Server][Points] ${player.displayName} (${player.address}) +${points} pts (highest #${rank})`
      )
      points--
      rank++
    }
  }

  private updateLeaderboard() {
    this.ensureWeeklyCurrent()

    const allTimeSorted = Array.from(this.allTimeBests.values()).sort((a, b) => {
      if (a.finishCount > 0 && b.finishCount > 0) return a.bestTime - b.bestTime
      if (a.finishCount > 0) return -1
      if (b.finishCount > 0) return 1
      return b.bestHeight - a.bestHeight
    })

    const weeklySorted = Array.from(this.weeklyBests.values()).sort((a, b) => {
      if (a.finishCount > 0 && b.finishCount > 0) return a.bestTime - b.bestTime
      if (a.finishCount > 0) return -1
      if (b.finishCount > 0) return 1
      return b.bestHeight - a.bestHeight
    })

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

  private maybePersistGlobalLeaderboard() {
    if (!isServer()) return
    void this.persistGlobalLeaderboard()
  }

  private maybePersistWeeklyLeaderboard() {
    if (!isServer()) return
    void this.persistWeeklyLeaderboard()
  }

  private ensureWeeklyCurrent() {
    const currentWeek = getWeekStartKeyUTC()
    if (this.weeklyMetaKey === currentWeek) return
    this.weeklyMetaKey = currentWeek
    this.weeklyBests.clear()
  }
}
