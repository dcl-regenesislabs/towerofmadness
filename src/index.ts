import {
  engine,
  Transform,
  TriggerArea,
  ColliderLayer,
  AudioSource,
  Entity,
  AvatarBase,
  PlayerIdentityData,
  Animator,
  GltfContainer,
  VisibilityComponent,
  MeshCollider,
  MeshRenderer,
  Material,
  PointerEvents,
  PointerEventType,
  InputAction,
  pointerEventsSystem,
  inputSystem
} from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'
import { isServer, isStateSyncronized } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { EntityNames } from '../assets/scene/entity-names'
import { setupUi } from './ui'
import { server } from './server/server'
import {
  setupClient,
  sendPlayerStarted,
  sendPlayerFinished,
  sendPlayerJoined,
  onPlayerFinished,
  getRoundState,
  getLeaderboard,
  getWinners,
  getTowerConfig,
  RoundPhase,
  LeaderboardEntry,
  WinnerEntry,
  TowerConfig
} from './multiplayer'
import { requestPlayerSnapshot } from './snapshots'

// ============================================
// GAME STATE
// ============================================

;import { initTimeSync } from './shared/timeSync'
(globalThis as any).DEBUG_NETWORK_MESSAGES = true

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

export let attemptState: AttemptState = AttemptState.NOT_STARTED
export let attemptStartTime: number = 0
export let attemptTimer: number = 0
export let attemptFinishTime: number = 0

// Personal best
export let bestAttemptTime: number = 0
export let bestAttemptHeight: number = 0

// Local player tracking
export let localPlayerName: string = ''
export function setLocalPlayerName(name: string) {
  localPlayerName = name
}
export function updateBestTime(time: number) {
  if (time > 0 && (bestAttemptTime === 0 || time < bestAttemptTime)) {
    bestAttemptTime = time
  }
}

// Result display
export let attemptResult: 'WIN' | 'DEATH' | null = null
export let resultMessage: string = ''
export let resultTimestamp: number = 0
export let startMessageTimestamp: number = 0

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

  // Send playerJoin once connected (server gets name from PlayerIdentityData)
  if (!hasJoinedServer) {
    hasJoinedServer = true
    sendPlayerJoined()

    // Get our local player name from AvatarBase
    const avatarBase = AvatarBase.getOrNull(engine.PlayerEntity)
    if (avatarBase?.name) {
      setLocalPlayerName(avatarBase.name)
      console.log(`[Game] Local player name: ${avatarBase.name}`)
    }
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
  startMessageTimestamp = Date.now()

  // Notify server (server tracks authoritative start time)
  sendPlayerStarted()
}

function finishAttempt() {
  if (!isConnectedToServer) return
  if (attemptState !== AttemptState.IN_PROGRESS) return
  if (roundPhase !== RoundPhase.ACTIVE) return

  console.log('[Game] Attempt finished')
  attemptState = AttemptState.FINISHED
  attemptFinishTime = attemptTimer
  attemptResult = 'WIN'
  resultMessage = `🏆 FINISHED! Waiting for server...`
  resultTimestamp = Date.now()

  // Update personal best height (time will come from server)
  if (playerMaxHeight > bestAttemptHeight) {
    bestAttemptHeight = playerMaxHeight
  }

  // Send to server (server calculates authoritative time and broadcasts it back)
  sendPlayerFinished()
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
  initTimeSync({ isServer: isServer() })

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

  // Set up callback for when players finish - update our best time if it's us
  onPlayerFinished((displayName, time, _finishOrder) => {
    if (localPlayerName && displayName === localPlayerName) {
      console.log(`[Game] Our finish confirmed by server: ${time.toFixed(2)}s`)
      updateBestTime(time)
      // Update result message with server-authoritative time
      resultMessage = `🏆 FINISHED! Time: ${time.toFixed(2)}s`
      resultTimestamp = Date.now()
    }
  })

  const knownPlayerWallets = new Set<string>()
  engine.addSystem(() => {
    for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const wallet = identity.address?.toLowerCase()
      if (!wallet || knownPlayerWallets.has(wallet)) continue

      knownPlayerWallets.add(wallet)
      const avatarBase = AvatarBase.getOrNull(entity)
      requestPlayerSnapshot(wallet, avatarBase?.name).then((ok) => {
        if (!ok) knownPlayerWallets.delete(wallet)
      })
    }
  }, undefined, 'snapshot-player-enter-system')

  // ============================================
  // TRIGGER SETUP
  // ============================================

  function setupTrigger(entity: Entity | null): void {
    if (!entity) return
    if (Transform.has(entity)) {
      const transform = Transform.getMutable(entity)
      transform.scale = Vector3.create(
        Math.max(transform.scale.x, 2),
        Math.max(transform.scale.y, 2),
        Math.max(transform.scale.z, 2)
      )
    }
    TriggerArea.setBox(entity, ColliderLayer.CL_PLAYER)
  }

  const triggerStart = engine.getEntityOrNullByName(EntityNames.TriggerStart)
  const triggerEnd = engine.addEntity()
  const triggerDeath = engine.getEntityOrNullByName(EntityNames.TriggerDeath)

  const TRIGGER_END_OFFSET = Vector3.create(0, 0, -37.25)
  const TRIGGER_END_SCALE = Vector3.create(23.6, 10.9, 19.6)
  Transform.create(triggerEnd, {
    position: Vector3.create(40 + TRIGGER_END_OFFSET.x, 0 + TRIGGER_END_OFFSET.y, 40 + TRIGGER_END_OFFSET.z),
    scale: TRIGGER_END_SCALE
  })
  MeshRenderer.setBox(triggerEnd)
  Material.setPbrMaterial(triggerEnd, {
    albedoColor: Color4.create(1, 0, 0, 0.4),
    metallic: 0,
    roughness: 1
  })
  VisibilityComponent.create(triggerEnd, { visible: true })
  console.log('[Game] TriggerEnd created by code')

  setupTrigger(triggerStart)
  setupTrigger(triggerEnd)
  setupTrigger(triggerDeath)

  // ============================================
  // TEMP TELEPORT (CLICKABLE BOX)
  // ============================================

  const teleportEntity = engine.addEntity()
  const teleportPos = triggerStart && Transform.has(triggerStart)
    ? Vector3.add(Transform.get(triggerStart).position, Vector3.create(2, 0.6, 0))
    : Vector3.create(40, 0.6, 40)
  Transform.create(teleportEntity, {
    position: teleportPos,
    scale: Vector3.create(2, 2, 2)
  })
  MeshRenderer.setBox(teleportEntity)
  Material.setPbrMaterial(teleportEntity, {
    albedoColor: Color4.fromInts(40, 160, 255, 200),
    metallic: 0,
    roughness: 0.6
  })
  MeshCollider.setBox(teleportEntity, ColliderLayer.CL_POINTER)
  PointerEvents.create(teleportEntity, {
    pointerEvents: [
      {
        eventType: PointerEventType.PET_DOWN,
        eventInfo: {
          button: InputAction.IA_POINTER,
          hoverText: 'TP 95m',
          showFeedback: true,
          maxDistance: 10
        }
      }
    ]
  })
  pointerEventsSystem.onPointerDown(
    { entity: teleportEntity, opts: { button: InputAction.IA_POINTER } },
    () => {
      movePlayerTo({
        newRelativePosition: { x: 40, y: 95, z: 40 },
        cameraTarget: { x: 40, y: 95, z: 41 }
      })
    }
  )

  // Update TriggerEnd position when tower config changes
  let lastTowerHeight = 0
  function updateTriggerEndPosition() {
    if (!triggerEnd || !towerConfig) return
    if (towerConfig.totalHeight === lastTowerHeight) return

    lastTowerHeight = towerConfig.totalHeight
    const transform = Transform.getMutable(triggerEnd)
    // Position at top of tower (totalHeight includes ChunkEnd)
    transform.position = Vector3.create(
      40 + TRIGGER_END_OFFSET.x,
      towerConfig.totalHeight - 5 + TRIGGER_END_OFFSET.y,
      40 + TRIGGER_END_OFFSET.z
    ) // Tower is at X=40, Z=40
    transform.scale = TRIGGER_END_SCALE
    console.log(`[Game] Updated TriggerEnd position to height ${transform.position.y.toFixed(1)}m`)
  }

  // Check for tower config changes periodically
  engine.addSystem(() => {
    updateTriggerEndPosition()
  }, undefined, 'trigger-end-update-system')

  // ============================================
  // COOLBED CHARACTER: CLICK TO TALK (2x speed) + SMOOTH BLEND (Breath loop set in Creator Hub)
  // ============================================

  const TALK_SPEED = 2
  const BLEND_DURATION_MS = 250
  const TALK_ANIMATION_DURATION_MS = 3000
  let coolBedEntity: Entity | null = null
  let coolBedSetupDone = false
  type CoolBedPhase = 'idle' | 'blendToTalk' | 'talking' | 'blendToBreath'
  let coolBedPhase: CoolBedPhase = 'idle'
  let coolBedPhaseStartTime = 0

  function setupCoolBed(entity: Entity) {
    if (coolBedSetupDone) return
    coolBedSetupDone = true
    coolBedEntity = entity
    console.log('[Game] CoolBed found, adding click-to-Talk (MeshCollider + PointerEvents)')

    MeshCollider.setBox(entity, ColliderLayer.CL_POINTER)

    PointerEvents.create(entity, {
      pointerEvents: [
        {
          eventType: PointerEventType.PET_DOWN,
          eventInfo: {
            button: InputAction.IA_POINTER,
            hoverText: 'Talk',
            showFeedback: true,
            maxDistance: 10
          }
        }
      ]
    })

    pointerEventsSystem.onPointerDown(
      { entity, opts: { button: InputAction.IA_POINTER } },
      () => {
        if (!Animator.has(entity)) return
        const breathClip = Animator.getClipOrNull(entity, 'Breath')
        const talkClip = Animator.getClipOrNull(entity, 'Talk')
        if (!breathClip || !talkClip) return
        if (coolBedPhase !== 'idle' && coolBedPhase !== 'talking') return
        talkClip.playing = true
        talkClip.speed = TALK_SPEED
        talkClip.weight = 0
        if (breathClip) breathClip.weight = 1
        coolBedPhase = 'blendToTalk'
        coolBedPhaseStartTime = Date.now()
      }
    )
  }

  function findCoolBedEntity(): Entity | null {
    const byName = engine.getEntityOrNullByName(EntityNames.CoolBed_glb)
    if (byName) return byName
    for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
      const src = GltfContainer.get(entity).src
      if (src && src.includes('CoolBed')) return entity
    }
    return null
  }

  engine.addSystem(() => {
    if (!coolBedSetupDone) {
      const entity = findCoolBedEntity()
      if (entity) setupCoolBed(entity)
      return
    }

    const entity = coolBedEntity
    if (!entity || !Animator.has(entity)) return

    const breathClip = Animator.getClipOrNull(entity, 'Breath')
    const talkClip = Animator.getClipOrNull(entity, 'Talk')
    if (!breathClip || !talkClip) return

    const now = Date.now()
    const elapsed = now - coolBedPhaseStartTime

    if (coolBedPhase === 'blendToTalk') {
      const t = Math.min(1, elapsed / BLEND_DURATION_MS)
      talkClip.weight = t
      breathClip.weight = 1 - t
      if (t >= 1) {
        coolBedPhase = 'talking'
        coolBedPhaseStartTime = now
      }
    } else if (coolBedPhase === 'talking') {
      if (elapsed >= TALK_ANIMATION_DURATION_MS) {
        coolBedPhase = 'blendToBreath'
        coolBedPhaseStartTime = now
      }
    } else if (coolBedPhase === 'blendToBreath') {
      const t = Math.min(1, elapsed / BLEND_DURATION_MS)
      talkClip.weight = 1 - t
      breathClip.weight = t
      if (t >= 1) {
        coolBedPhase = 'idle'
        talkClip.playing = false
        breathClip.weight = 1
        talkClip.weight = 0
      }
    } else if (coolBedPhase === 'idle') {
      breathClip.weight = 1
      talkClip.weight = 0
    }
  }, undefined, 'coolbed-animation-system')

  // ============================================
  // TRIGGER DETECTION SYSTEM
  // ============================================

  function isInsideBox(pos: Vector3, center: Vector3, scale: Vector3): boolean {
    const dx = Math.abs(pos.x - center.x)
    const dy = Math.abs(pos.y - center.y)
    const dz = Math.abs(pos.z - center.z)
    return dx <= scale.x / 2 && dy <= scale.y / 2 && dz <= scale.z / 2
  }

  const triggers = [
    { entity: triggerStart, wasInside: false, useWorldPos: false, onEnter: startAttempt },
    { entity: triggerEnd, wasInside: false, useWorldPos: true, onEnter: finishAttempt },
    { entity: triggerDeath, wasInside: false, useWorldPos: false, onEnter: dieAttempt }
  ]

  engine.addSystem(() => {
    if (!Transform.has(engine.PlayerEntity)) return
    const playerPos = Transform.get(engine.PlayerEntity).position
 
    for (const trigger of triggers) {
      if (!trigger.entity || !Transform.has(trigger.entity)) continue

      const t = Transform.get(trigger.entity)
      const pos = trigger.useWorldPos ? getWorldPosition(trigger.entity) : t.position
      const inside = isInsideBox(playerPos, pos, t.scale)

      if (inside && !trigger.wasInside) {
        trigger.wasInside = true
        trigger.onEnter()
      } else if (!inside && trigger.wasInside) {
        trigger.wasInside = false
      }
    }
  }, undefined, 'trigger-detection-system')

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
