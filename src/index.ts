import {
  engine,
  Transform,
  TriggerArea,
  ColliderLayer,
  AudioSource,
  Entity,
  GltfContainer
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isServer, isStateSyncronized } from '@dcl/sdk/network'
import { EntityNames } from '../assets/scene/entity-names'
import { setupUi } from './ui'
import { server } from './server/server'
import {
  setupClient,
  sendPlayerFinished,
  sendPlayerJoined,
  getRoundState,
  getLeaderboard,
  getWinners,
  getTowerConfig,
  formatTime,
  isTimeSyncReady,
  RoundPhase,
  LeaderboardEntry,
  WinnerEntry,
  TowerConfig
} from './multiplayer'

// ============================================
// GAME STATE
// ============================================

// Player tracking
export let playerHeight = 0
export let playerMaxHeight = 0

// Player attempt state
export enum AttemptState {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  FINISHED = 'FINISHED',
  DIED = 'DIED'
}

;(globalThis as any).DEBUG_NETWORK_MESSAGES = true

export let attemptState: AttemptState = AttemptState.NOT_STARTED
export let attemptStartTime: number = 0
export let attemptTimer: number = 0
export let attemptFinishTime: number = 0

// Personal best
export let bestAttemptTime: number = 0
export let bestAttemptHeight: number = 0

// Result display
export let attemptResult: 'WIN' | 'DEATH' | null = null
export let resultMessage: string = ''
export let resultTimestamp: number = 0

// Connection state
export let isConnectedToServer: boolean = false
export function isSynced(): boolean {
  return isStateSyncronized()
}

// Round state (synced from server)
export let roundTimer: number = 420
export let roundSpeedMultiplier: number = 1.0
export let roundPhase: RoundPhase = RoundPhase.ACTIVE
export let leaderboard: LeaderboardEntry[] = []
export let roundWinners: WinnerEntry[] = []
export let towerConfig: TowerConfig | null = null

// ============================================
// HELPER FUNCTIONS
// ============================================

function getWorldPosition(entity: Entity): Vector3 {
  if (!Transform.has(entity)) return Vector3.Zero()

  const transform = Transform.get(entity)
  let localPos = transform.position

  if (transform.parent !== undefined && transform.parent !== engine.RootEntity && Transform.has(transform.parent)) {
    const parentTransform = Transform.get(transform.parent)
    const parentRot = parentTransform.rotation
    const parentScale = parentTransform.scale
    const rotatedPos = Vector3.rotate(localPos, parentRot)
    const scaledPos = Vector3.create(
      rotatedPos.x * parentScale.x,
      rotatedPos.y * parentScale.y,
      rotatedPos.z * parentScale.z
    )
    const parentWorldPos = getWorldPosition(transform.parent)
    return Vector3.add(scaledPos, parentWorldPos)
  }

  return localPos
}

// ============================================
// PLAYER TRACKING SYSTEM
// ============================================

function trackPlayerHeight() {
  if (!Transform.has(engine.PlayerEntity)) return

  const playerTransform = Transform.get(engine.PlayerEntity)
  playerHeight = playerTransform.position.y

  // Track max height during active attempt
  if (attemptState === AttemptState.IN_PROGRESS) {
    if (playerHeight > playerMaxHeight) {
      playerMaxHeight = playerHeight
    }
    attemptTimer = (Date.now() - attemptStartTime) / 1000
  }
}

// ============================================
// SYNC ROUND STATE FROM SERVER
// ============================================

let lastPhase: RoundPhase | null = null
let hasJoinedServer: boolean = false

function syncRoundState() {
  // Wait for CRDT state to be synchronized first
  if (!isStateSyncronized()) return

  const state = getRoundState()
  if (!state) return

  // First time we receive server state - we're connected
  if (!isConnectedToServer) {
    isConnectedToServer = true
    console.log('[Game] Connected to server')
  }

  // Send playerJoin once connected
  if (!hasJoinedServer) {
    hasJoinedServer = true
    sendPlayerJoined('Player')
  }

  roundTimer = state.remainingTime
  roundSpeedMultiplier = state.speedMultiplier

  // Detect phase changes
  if (state.phase !== lastPhase) {
    lastPhase = state.phase
    roundPhase = state.phase

    if (state.phase === RoundPhase.ACTIVE && lastPhase !== null) {
      // New round started - reset attempt
      attemptState = AttemptState.NOT_STARTED
      attemptTimer = 0
      playerMaxHeight = 0
      attemptResult = null
      resultMessage = '🎮 New round! Go to TriggerStart to begin'
      resultTimestamp = Date.now()
    } else if (state.phase === RoundPhase.ENDING) {
      roundWinners = getWinners()
      resultMessage = '🏁 Round Complete!'
      resultTimestamp = Date.now()
    } else if (state.phase === RoundPhase.BREAK) {
      resultMessage = '⏳ Next round in 10 seconds...'
      resultTimestamp = Date.now()
    }
  }

  // Update leaderboard
  leaderboard = getLeaderboard()

  // Update tower config
  towerConfig = getTowerConfig()
}

// ============================================
// PLAYER ATTEMPT FUNCTIONS
// ============================================

function startAttempt() {
  if (!isConnectedToServer) return

  if (roundPhase !== RoundPhase.ACTIVE) {
    return
  }

  if (attemptState === AttemptState.FINISHED) {
    resultMessage = '✅ You already finished! Wait for next round.'
    resultTimestamp = Date.now()
    return
  }

  console.log('[Game] Attempt started')
  attemptState = AttemptState.IN_PROGRESS
  attemptStartTime = Date.now()
  attemptTimer = 0
  playerMaxHeight = playerHeight
  attemptResult = null
  resultMessage = '🏃 GO! Climb to the top!'
  resultTimestamp = Date.now()
}

function finishAttempt() {
  if (!isConnectedToServer) return
  if (attemptState !== AttemptState.IN_PROGRESS) return
  if (roundPhase !== RoundPhase.ACTIVE) return

  console.log('[Game] Attempt finished')
  attemptState = AttemptState.FINISHED
  attemptFinishTime = attemptTimer
  attemptResult = 'WIN'
  resultMessage = `🏆 FINISHED! Time: ${attemptTimer.toFixed(2)}s`
  resultTimestamp = Date.now()

  // Update personal best
  if (attemptFinishTime < bestAttemptTime || bestAttemptTime === 0) {
    bestAttemptTime = attemptFinishTime
  }
  if (playerMaxHeight > bestAttemptHeight) {
    bestAttemptHeight = playerMaxHeight
  }

  // Send to server
  sendPlayerFinished(attemptFinishTime)
}

function dieAttempt() {
  if (attemptState !== AttemptState.IN_PROGRESS) return

  console.log('[Game] Player died')
  attemptState = AttemptState.DIED
  attemptResult = 'DEATH'
  resultMessage = `☠️ DEATH at ${playerMaxHeight.toFixed(1)}m - Go to TriggerStart to retry!`
  resultTimestamp = Date.now()

  // Update personal best height even on death
  if (playerMaxHeight > bestAttemptHeight) {
    bestAttemptHeight = playerMaxHeight
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

export async function main() {
  console.log('[Game] Starting...')

  // ============================================
  // SERVER/CLIENT BRANCHING
  // ============================================

  if (isServer()) {
    console.log('[Game] Running as SERVER')
    server()
    return
  }

  console.log('[Game] Running as CLIENT')

  // ============================================
  // CLIENT SETUP
  // ============================================

  setupClient()

  // ============================================
  // TRIGGER SETUP
  // ============================================

  const triggerStart = engine.getEntityOrNullByName(EntityNames.TriggerStart)
  const triggerEnd = engine.getEntityOrNullByName(EntityNames.TriggerEnd)
  const triggerDeath = engine.getEntityOrNullByName(EntityNames.TriggerDeath)


  // Setup TriggerStart
  if (triggerStart) {
    if (Transform.has(triggerStart)) {
      const transform = Transform.getMutable(triggerStart)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(triggerStart, ColliderLayer.CL_PLAYER)
  }

  // Setup TriggerEnd
  if (triggerEnd) {
    if (Transform.has(triggerEnd)) {
      const transform = Transform.getMutable(triggerEnd)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(triggerEnd, ColliderLayer.CL_PLAYER)
  }

  // Setup TriggerDeath
  if (triggerDeath) {
    if (Transform.has(triggerDeath)) {
      const transform = Transform.getMutable(triggerDeath)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(triggerDeath, ColliderLayer.CL_PLAYER)
  }

  // ============================================
  // TRIGGER DETECTION SYSTEM
  // ============================================

  let inTriggerStart = false
  let inTriggerEnd = false
  let inTriggerDeath = false

  engine.addSystem(() => {
    if (!Transform.has(engine.PlayerEntity)) return
    const playerPos = Transform.get(engine.PlayerEntity).position

    // Check TriggerStart
    if (triggerStart && Transform.has(triggerStart)) {
      const t = Transform.get(triggerStart)
      const inside = isInsideBox(playerPos, t.position, t.scale)

      if (inside && !inTriggerStart) {
        inTriggerStart = true
        startAttempt()
      } else if (!inside && inTriggerStart) {
        inTriggerStart = false
      }
    }

    // Check TriggerEnd
    if (triggerEnd && Transform.has(triggerEnd)) {
      const t = Transform.get(triggerEnd)
      const worldPos = getWorldPosition(triggerEnd)
      const inside = isInsideBox(playerPos, worldPos, t.scale)

      if (inside && !inTriggerEnd) {
        inTriggerEnd = true
        finishAttempt()
      } else if (!inside && inTriggerEnd) {
        inTriggerEnd = false
      }
    }

    // Check TriggerDeath
    if (triggerDeath && Transform.has(triggerDeath)) {
      const t = Transform.get(triggerDeath)
      const inside = isInsideBox(playerPos, t.position, t.scale)

      if (inside && !inTriggerDeath) {
        inTriggerDeath = true
        dieAttempt()
      } else if (!inside && inTriggerDeath) {
        inTriggerDeath = false
      }
    }
  }, undefined, 'trigger-detection-system')

  function isInsideBox(pos: Vector3, center: Vector3, scale: Vector3): boolean {
    const dx = Math.abs(pos.x - center.x)
    const dy = Math.abs(pos.y - center.y)
    const dz = Math.abs(pos.z - center.z)
    return dx <= scale.x / 2 && dy <= scale.y / 2 && dz <= scale.z / 2
  }

  // ============================================
  // ADD SYSTEMS
  // ============================================

  engine.addSystem(trackPlayerHeight, undefined, 'player-height-system')
  engine.addSystem(syncRoundState, undefined, 'round-sync-system')

  // ============================================
  // INITIALIZE UI
  // ============================================

  setupUi()

  // ============================================
  // BACKGROUND MUSIC
  // ============================================

  setupBackgroundMusic('sounds/PixelSodaBar.mp3')

  console.log('[Game] Setup complete')
}

// ============================================
// BACKGROUND MUSIC
// ============================================

let backgroundMusicEntity: Entity | null = null
let audioStarted = false

function setupBackgroundMusic(audioPath: string) {
  backgroundMusicEntity = engine.addEntity()

  Transform.create(backgroundMusicEntity, {
    position: Vector3.create(40, 0, 40),
    scale: Vector3.One()
  })

  AudioSource.create(backgroundMusicEntity, {
    audioClipUrl: audioPath,
    playing: true,
    loop: true,
    volume: 1.0
  })

  engine.addSystem(() => {
    if (backgroundMusicEntity && AudioSource.has(backgroundMusicEntity)) {
      const audio = AudioSource.get(backgroundMusicEntity)
      if (!audio.playing && !audioStarted) {
        AudioSource.getMutable(backgroundMusicEntity).playing = true
      } else if (audio.playing && !audioStarted) {
        audioStarted = true
      }
    }
  }, undefined, 'background-music-system')

  return backgroundMusicEntity
}

export function playSoundEffect(audioPath: string, volume: number = 1.0) {
  const soundEntity = engine.addEntity()
  AudioSource.create(soundEntity, {
    audioClipUrl: audioPath,
    playing: true,
    loop: false,
    volume: volume
  })
  return soundEntity
}
