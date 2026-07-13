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
  InputAction,
  InputModifier,
  inputSystem,
  PointerEventType,
  pointerEventsSystem
} from '@dcl/sdk/ecs'
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math'
import { isServer, isStateSyncronized } from '@dcl/sdk/network'
import { onEnterScene, onLeaveScene } from '@dcl/sdk/players'
import { movePlayerTo, changeRealm } from '~system/RestrictedActions'
import { Portal } from './portal'
import { EntityNames } from '../assets/scene/entity-names'
import { setupUi } from './ui'
import { setupWorldLeaderboard } from './Leaderboard'
import { setupWorldPointLeaderboard } from './PointLeaderboard'
import { setupWorldTournamentLeaderboard } from './TournamentLeaderboard'
import { server } from './server/server'
import {
  setupClient,
  sendPlayerStarted,
  sendPlayerFinished,
  sendPlayerJoined,
  onPlayerFinished,
  onAttemptRejected,
  onTeleportToBase,
  getRoundState,
  getLeaderboard,
  getWeeklyLeaderboard,
  getPointLeaderboard,
  getWeeklyPointLeaderboard,
  getWinners,
  getTowerConfig,
  getTournament,
  getTournamentLeaderboard,
  RoundPhase,
  LeaderboardEntry,
  PointLeaderboardEntry,
  WinnerEntry,
  TowerConfig
} from './multiplayer'
import { requestPlayerSnapshot, setSnapshotHidden } from './snapshots'
import { TriggerEndComponent } from './shared/schemas'
import { WEARABLE_CONFIG, PIGEON_WEARABLE_CONFIG } from './shared/wearableConfig'
import { signedFetch } from '~system/SignedFetch'
import { room } from './shared/messages'
import { setupCinematicSystem, playCinematic, shouldAutoPlayCinematic, isCinematicPlaying } from './cinematicCamera'
import { setupTutorial, armPendingIntroTutorial, tutorialStep, TutorialStep } from './tutorial'

// ============================================
// GAME STATE
// ============================================
import { initTimeSync } from './shared/timeSync'
;(globalThis as any).DEBUG_NETWORK_MESSAGES = true

// Player tracking
export let playerHeight = 0
export let playerMaxHeight = 0

// Player attempt state
export enum AttemptState {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  VALIDATING = 'VALIDATING',
  FINISHED = 'FINISHED',
  DIED = 'DIED'
}

export let attemptState: AttemptState = AttemptState.NOT_STARTED
export let attemptStartTime: number = 0
export let attemptTimer: number = 0
export let attemptFinishTime: number = 0
export let roundFinishOrder: number = 0
export let roundFinishTime: number = 0

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
export function resetRoundPlacement() {
  roundFinishOrder = 0
  roundFinishTime = 0
}

// Result display
export let attemptResult: 'WIN' | 'DEATH' | 'ERROR' | 'PENDING' | null = null
export let resultTitle: string = ''
export let resultMessage: string = ''
export let resultTimestamp: number = 0
export let startMessageTimestamp: number = 0
export let suppressStartUntil: number = 0
// While Date.now() < this, the TriggerEnd finish trigger is ignored (used by the
// teleport-to-top so landing in the win zone doesn't count as a finish attempt).
export let suppressEndTriggerUntil: number = 0
// Pigeon dialog shown right after the wearable claim succeeds — first a
// congrats message, then a "how to equip it" message after NEXT is pressed.
export enum PigeonClaimDialogStep {
  HIDDEN = 'HIDDEN',
  CLAIMING = 'CLAIMING',
  CLAIMED = 'CLAIMED',
  EQUIP_INFO = 'EQUIP_INFO'
}
export let pigeonClaimDialogStep: PigeonClaimDialogStep = PigeonClaimDialogStep.HIDDEN
export let pigeonClaimDialogChangedAt: number = 0

export function onPigeonClaimNextClicked() {
  if (pigeonClaimDialogStep !== PigeonClaimDialogStep.CLAIMED) return
  pigeonClaimDialogStep = PigeonClaimDialogStep.EQUIP_INFO
  pigeonClaimDialogChangedAt = Date.now()
}

export function onPigeonClaimDismissClicked() {
  pigeonClaimDialogStep = PigeonClaimDialogStep.HIDDEN
}
export let finishValidationStartedAt: number = 0
export let coolBedDialogTimestamp: number = 0
export const coolBedDialogText = `YO SUP welcome to Tower of madness
JUMP to the top to become to Tower master and beat you friends
You dont have friends? don't worry I can be your friend, just start jumping to the top I will catch you, after I take a nap`

export function triggerCoolBedDialog() {
  coolBedDialogTimestamp = Date.now()
}

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
export let weeklyLeaderboard: LeaderboardEntry[] = []
export let pointLeaderboard: PointLeaderboardEntry[] = []
export let weeklyPointLeaderboard: PointLeaderboardEntry[] = []
export let roundWinners: WinnerEntry[] = []
export let towerConfig: TowerConfig | null = null

const BASE_TELEPORT_POSITION = { x: 40.38, y: 11.5, z: 10.5 }
const START_TRIGGER_SUPPRESS_MS = 2000
const FINISH_VALIDATION_TIMEOUT_MS = 4000

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
    const previousPhase = lastPhase
    lastPhase = state.phase
    roundPhase = state.phase

    // Only treat transitions into ACTIVE as a new round after the initial sync.
    if (state.phase === RoundPhase.ACTIVE && previousPhase !== null) {
      // New round started - reset attempt
      attemptState = AttemptState.NOT_STARTED
      attemptTimer = 0
      attemptFinishTime = 0
      playerMaxHeight = 0
      resetRoundPlacement()
      attemptResult = null
      resultMessage = '🎮 New round! Go to TriggerStart to begin'
      resultTimestamp = Date.now()
      
      // Play cinematic for new tower (state is already synced here)
      console.log('[Cinematic] New round detected, playing cinematic')
      playCinematic()
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
  weeklyLeaderboard = getWeeklyLeaderboard()
  pointLeaderboard = getPointLeaderboard()
  weeklyPointLeaderboard = getWeeklyPointLeaderboard()

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

  if (Date.now() < suppressStartUntil) {
    return
  }

  // Don't allow starting attempt during cinematic
  if (isCinematicPlaying()) {
    return
  }

  if (attemptState === AttemptState.FINISHED) {
    resultMessage = '✅ You already finished! Wait for next round.'
    resultTimestamp = Date.now()
    return
  }

  console.log(`[Game] Attempt started at height=${playerHeight.toFixed(2)}m`)
  attemptState = AttemptState.IN_PROGRESS
  attemptStartTime = Date.now()
  attemptTimer = 0
  playerMaxHeight = playerHeight
  attemptResult = null
  resultTitle = ''
  resultMessage = '🏃 GO! Climb to the top!'
  resultTimestamp = Date.now()
  startMessageTimestamp = Date.now()
  finishValidationStartedAt = 0

  // Notify server (server tracks authoritative start time)
  sendPlayerStarted()
}

function finishAttempt() {
  if (!isConnectedToServer) return
  if (roundPhase !== RoundPhase.ACTIVE) return

  if (attemptState !== AttemptState.IN_PROGRESS) {
    rejectAttempt('No active attempt detected. You likely skipped or missed the start trigger.')
    return
  }

  console.log(`[Game] Finish trigger reached: currentHeight=${playerHeight.toFixed(2)}m, maxHeight=${playerMaxHeight.toFixed(2)}m`)
  attemptState = AttemptState.VALIDATING
  attemptFinishTime = attemptTimer
  attemptResult = 'PENDING'
  resultTitle = 'VALIDATING ATTEMPT'
  resultMessage = 'Please wait while the server confirms your finish.'
  resultTimestamp = Date.now()
  finishValidationStartedAt = Date.now()

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
  resultTitle = 'OOPS TRY AGAIN'
  resultMessage = `☠️ DEATH at ${playerMaxHeight.toFixed(1)}m - Go to TriggerStart to retry!`
  resultTimestamp = Date.now()
  finishValidationStartedAt = 0

  // Update personal best height even on death
  if (playerMaxHeight > bestAttemptHeight) {
    bestAttemptHeight = playerMaxHeight
  }
}

function rejectAttempt(reason: string, title: string = 'OOPS TRY AGAIN') {
  console.log(`[Game] Attempt rejected: ${reason}`)

  attemptState = AttemptState.NOT_STARTED
  attemptStartTime = 0
  attemptTimer = 0
  attemptFinishTime = 0
  attemptResult = 'ERROR'
  resultTitle = title
  resultMessage = reason
  resultTimestamp = Date.now()
  finishValidationStartedAt = 0
  startMessageTimestamp = 0
  suppressStartUntil = Date.now() + START_TRIGGER_SUPPRESS_MS

  movePlayerTo({
    newRelativePosition: BASE_TELEPORT_POSITION,
    cameraTarget: {
      x: BASE_TELEPORT_POSITION.x,
      y: BASE_TELEPORT_POSITION.y + 1,
      z: BASE_TELEPORT_POSITION.z
    }
  })
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

  InputModifier.create(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({
      disableDoubleJump: false,
      disableGliding: false
    })
  })

  setupClient()
  setupCinematicSystem()
  setupTutorial()

  // Wait for state sync before playing cinematic on first arrival
  const initialCinematicSystemName = 'initial-cinematic-trigger'
  engine.addSystem(
    () => {
      if (isStateSyncronized() && shouldAutoPlayCinematic()) {
        console.log('[Cinematic] State synced, playing initial cinematic')
        playCinematic()
        // The pigeon tutorial spawns once this (one-time, intro-only) cinematic ends —
        // round-transition cinematics call playCinematic() too, but this system only
        // fires once per client session, so they never re-arm the tutorial.
        armPendingIntroTutorial()
        engine.removeSystem(initialCinematicSystemName)
      }
    },
    undefined,
    initialCinematicSystemName
  )

  // Set up callback for when players finish - update our best time if it's us
  onPlayerFinished((displayName, time, finishOrder) => {
    if (localPlayerName && displayName === localPlayerName) {
      console.log(`[Game] Our finish confirmed by server: ${time.toFixed(2)}s`)
      updateBestTime(time)
      attemptState = AttemptState.FINISHED
      attemptResult = 'WIN'
      resultTitle = 'CONGRATS'
      finishValidationStartedAt = 0
      roundFinishOrder = finishOrder
      roundFinishTime = time
      // Update result message with server-authoritative time
      resultMessage = `🏆 FINISHED! Time: ${time.toFixed(2)}s`
      resultTimestamp = Date.now()
    }
  })

  onAttemptRejected((stage, reason) => {
    const title = stage === 'finish' ? 'ATTEMPT NOT COUNTED' : 'OOPS TRY AGAIN'
    const message = stage === 'finish' ? `Your attempt did not count. ${reason}` : reason
    rejectAttempt(message, title)
  })

  // Server broadcasts this to everyone when a round's timer runs out. Skip it
  // (and the winners UI, see showWinners in ui.tsx) for a player still mid-
  // conversation with the guide pigeon — the tutorial isn't a real attempt, so
  // there's nothing to interrupt them for. The tower still changes for everyone;
  // this only holds off this one player's own teleport/camera cut.
  onTeleportToBase((pos) => {
    if (tutorialStep !== TutorialStep.INACTIVE && tutorialStep !== TutorialStep.DONE) {
      console.log('[Tutorial] Skipping round-end teleport, still talking to the pigeon')
      return
    }
    movePlayerTo({
      newRelativePosition: pos,
      cameraTarget: { x: pos.x, y: pos.y + 1, z: pos.z }
    })
  })

  onEnterScene((player) => {
    const wallet = player.userId?.toLowerCase()
    if (!wallet) return
    setSnapshotHidden(wallet, false)
  })

  onLeaveScene((userId) => {
    const wallet = userId?.toLowerCase()
    if (!wallet) return
    setSnapshotHidden(wallet, true)
  })

  const knownPlayerWallets = new Set<string>()
  engine.addSystem(
    () => {
      for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
        const wallet = identity.address?.toLowerCase()
        if (!wallet || knownPlayerWallets.has(wallet)) continue

        knownPlayerWallets.add(wallet)
        setSnapshotHidden(wallet, false)
        const avatarBase = AvatarBase.getOrNull(entity)
        requestPlayerSnapshot(wallet, avatarBase?.name).then((ok) => {
          if (!ok) knownPlayerWallets.delete(wallet)
        })
      }
    },
    undefined,
    'snapshot-player-enter-system'
  )

  setupWorldLeaderboard(() => leaderboard, () => weeklyLeaderboard)
  setupWorldPointLeaderboard(() => pointLeaderboard, () => weeklyPointLeaderboard)
  setupWorldTournamentLeaderboard(() => getTournamentLeaderboard(), () => getTournament()?.tournamentMode ?? false)

  // Auto-claim wearable if local player is the tournament winner
  let wearableClaimed = false
  engine.addSystem(() => {
    if (wearableClaimed) return
    const tournament = getTournament()
    if (!tournament || tournament.active) return
    if (tournament.prizeType !== 'wearable') return
    if (tournament.paymentTxHash !== 'pending-claim') return

    const localAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (!localAddress) return
    if (tournament.winnerAddress.toLowerCase() !== localAddress) return

    wearableClaimed = true
    console.log('[Wearable] Local player is the winner — claiming wearable...')

    void (async () => {
      try {
        const url = `${WEARABLE_CONFIG.rewardsApi}/${WEARABLE_CONFIG.campaignId}/rewards`
        const response = await signedFetch({
          url,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_key: WEARABLE_CONFIG.campaignKey,
              beneficiary: localAddress,
              catalyst: WEARABLE_CONFIG.catalyst
            })
          }
        })

        console.log(`[Wearable] <- HTTP ${response.status}: ${response.body?.substring(0, 100)}`)

        let data: { ok?: boolean; data?: { token?: string; image?: string }[]; error?: string } = {}
        try { data = JSON.parse(response.body ?? '{}') } catch { /* plain text response */ }

        if (data.ok && data.data?.[0]) {
          const rewardId = data.data[0].token ?? 'claimed'
          console.log(`[Wearable] ✓ Claimed! token: ${rewardId}`)
          room.send('wearableClaimedByClient', { rewardId })
        } else {
          console.error(`[Wearable] ✗ Claim failed: ${data.error ?? response.body}`)
          wearableClaimed = false // allow retry on actual failure
        }
      } catch (err) {
        console.error('[Wearable] ✗ Claim error:', err)
      }
    })()
  }, undefined, 'wearable-claim-system')

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

  const triggerStart = engine.addEntity()
  Transform.create(triggerStart, { position: Vector3.create(40.38, 11.10, 21.6), scale: Vector3.create(23.6, 4, 15) })
  const triggerDeath = engine.addEntity()
  Transform.create(triggerDeath, {
    position: Vector3.create(40.35, 6.99, 38.44),
    scale: Vector3.create(73.8, 0.8, 73.8)
  })

  setupTrigger(triggerStart)
  setupTrigger(triggerDeath)

  let cachedTriggerEndEntity: Entity | null = null
  let loggedTriggerEnd = false
  function findTriggerEndEntity(): Entity | null {
    if (cachedTriggerEndEntity && TriggerEndComponent.has(cachedTriggerEndEntity)) {
      return cachedTriggerEndEntity
    }
    for (const [entity] of engine.getEntitiesWith(TriggerEndComponent)) {
      cachedTriggerEndEntity = entity
      if (!loggedTriggerEnd && Transform.has(entity)) {
        const pos = getWorldPosition(entity)
        console.log(`[Debug] TriggerEnd found at ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`)
        loggedTriggerEnd = true
      }
      return entity
    }
    cachedTriggerEndEntity = null
    return null
  }

  // ============================================
  // PIGEON TROPHY (win zone) + TELEPORT TO TOP
  // ============================================

  // Same structure as the dispenser built in world-cup-prediction-game's
  // Creator Hub: a parent entity carrying the cylinder MeshCollider
  // (physics + pointer), and the glTF model as its CHILD, with the model's
  // own visible mesh also flagged as a pointer collider. That's what makes
  // the hover highlight trace the pigeon's real silhouette instead of the
  // (invisible) cylinder's — the highlight follows whatever geometry the
  // raycast actually hits, and visibleMeshesCollisionMask makes that the
  // rendered mesh itself.
  //
  // pigeonClick is the parent — position + rotation updated by the system
  // below, the pigeon model rides along as its child.
  //
  // Collider is sized from PartyPigeon.glb's real bounding box (measured via
  // its glTF scene graph): ~2.2m diameter (radiusBottom/radiusTop below),
  // ~4.9m tall (scale.y). A MeshCollider primitive is always centered on its
  // own entity's Transform, so pigeonClick sits 2.45m (half the height)
  // above the platform floor to center the cylinder on the model — and the
  // pigeon child compensates with an inverse offset/scale on Y so it still
  // renders at floor level, at its normal (unscaled) size, despite hanging
  // off a parent that's shifted up and stretched.
  const PIGEON_HITBOX_HEIGHT = 4.9
  const PIGEON_HITBOX_RADIUS = 1.1
  const pigeonClick = engine.addEntity()
  Transform.create(pigeonClick, {
    position: Vector3.create(40, 5, 40),
    scale: Vector3.create(1, PIGEON_HITBOX_HEIGHT, 1)
  })
  MeshCollider.setCylinder(pigeonClick, PIGEON_HITBOX_RADIUS, PIGEON_HITBOX_RADIUS, [
    ColliderLayer.CL_PHYSICS,
    ColliderLayer.CL_POINTER
  ])

  // Pigeon skin — always visible. Its own visible mesh doubles as the
  // precise pointer collider (visibleMeshesCollisionMask); any invisible
  // collider meshes baked into the GLB act as physics + pointer too.
  const pigeon = engine.addEntity()
  GltfContainer.create(pigeon, {
    src: 'assets/wearables/PartyPigeon.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  Transform.create(pigeon, {
    parent: pigeonClick,
    position: Vector3.create(0, -0.5, 0),
    scale: Vector3.create(1, 1 / PIGEON_HITBOX_HEIGHT, 1)
  })

  // ============================================
  // WIN-ZONE PORTALS — behind the pigeon, on the win platform
  // ============================================
  // Positioned/rotated every round by the same system that places the
  // pigeon (below), since the win platform's world position changes with
  // tower height. "Behind the pigeon" = further along the direction the
  // platform faces away from the tower center (the pigeon faces the climb;
  // the portals face outward, back toward whoever just arrived).
  const cozyfarmPortal = new Portal({
    position: { x: 40, y: 5, z: 40 },
    size: 1.4,
    name: 'Cozy Farm',
    thumbnail: 'assets/images/CozyFarm.png',
    hoverText: 'Go to Cozy Farm',
    onActivate: () => {
      void changeRealm({ realm: 'cozyfarm.dcl.eth', message: 'Jump to cozyfarm.dcl.eth?' })
    }
  })
  const flagtagPortal = new Portal({
    position: { x: 40, y: 5, z: 40 },
    size: 1.4,
    name: 'Flag Tag',
    thumbnail: 'assets/images/flagtag.png',
    hoverText: 'Go to Flag Tag',
    onActivate: () => {
      void changeRealm({ realm: 'flagtag.dcl.eth', message: 'Jump to flagtag.dcl.eth?' })
    }
  })

  // Claims the pigeon wearable for the local player via the DCL Rewards API.
  // Uses PIGEON_WEARABLE_CONFIG (separate from the tournament prize campaign).
  async function claimPigeonWearable() {
    if (pigeonClaimDialogStep !== PigeonClaimDialogStep.HIDDEN) return // already claiming/claimed
    const address = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
    if (!address) {
      console.log('[Pigeon] Cannot claim — no local player address')
      return
    }
    // Open the dialog immediately so the click has instant feedback — the
    // network round-trip to the Rewards API below can take a couple seconds.
    pigeonClaimDialogStep = PigeonClaimDialogStep.CLAIMING
    pigeonClaimDialogChangedAt = Date.now()
    console.log(`[Pigeon] Claiming wearable for ${address}...`)
    try {
      const url = `${PIGEON_WEARABLE_CONFIG.rewardsApi}/${PIGEON_WEARABLE_CONFIG.campaignId}/rewards`
      const response = await signedFetch({
        url,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_key: PIGEON_WEARABLE_CONFIG.campaignKey,
            beneficiary: address,
            catalyst: PIGEON_WEARABLE_CONFIG.catalyst
          })
        }
      })
      let data: { ok?: boolean; data?: { token?: string }[]; error?: string } = {}
      try { data = JSON.parse(response.body ?? '{}') } catch { /* plain text response */ }
      if (data.ok && data.data?.[0]) {
        console.log(`[Pigeon] ✓ Claimed! token: ${data.data[0].token ?? 'claimed'}`)
        pigeonClaimDialogStep = PigeonClaimDialogStep.CLAIMED
        pigeonClaimDialogChangedAt = Date.now()
      } else {
        console.error(`[Pigeon] ✗ Claim failed: ${data.error ?? response.body}`)
        pigeonClaimDialogStep = PigeonClaimDialogStep.HIDDEN
      }
    } catch (err) {
      console.error('[Pigeon] ✗ Claim error:', err)
      pigeonClaimDialogStep = PigeonClaimDialogStep.HIDDEN
    }
  }

  pointerEventsSystem.onPointerDown(
    {
      entity: pigeonClick,
      opts: {
        button: InputAction.IA_POINTER, // left click
        hoverText: 'Claim',
        showFeedback: true,
        showHighlight: true,
        maxDistance: 8
      }
    },
    () => { void claimPigeonWearable() }
  )

  // --- TELEPORT TO TOP --------------------------------------------------------
  // Press "1" (IA_ACTION_3) anywhere to jump up to the win zone where the pigeon
  // is — keyboard-only, no entity/pointer involved.
  let winZoneTarget: Vector3 | null = null

  function teleportToWinZone() {
    if (!winZoneTarget) {
      console.log('[Teleport] No win zone yet (tower not ready)')
      return
    }
    // Landing in the win zone would otherwise fire the finish trigger and bounce
    // the player back to base. Suppress it briefly so the teleport sticks.
    suppressEndTriggerUntil = Date.now() + 3000
    const pigeonPos = getWorldPosition(pigeon)
    movePlayerTo({
      newRelativePosition: winZoneTarget,
      cameraTarget: {
        x: pigeonPos.x,
        y: pigeonPos.y + 1.2,
        z: pigeonPos.z
      }
    })
  }

  engine.addSystem(
    () => {
      if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) {
        teleportToWinZone()
      }
    },
    undefined,
    'debug-teleport-key-system'
  )
  // ---------------------------------------------------------------------------

  // Keep the pigeon (and its click box) glued to the current tower top.
  // Pigeon stays visible regardless.
  engine.addSystem(
    () => {
      const triggerEnd = findTriggerEndEntity()
      if (!triggerEnd || !Transform.has(triggerEnd)) {
        return
      }

      const center = getWorldPosition(triggerEnd)
      // The meta platform sits at the TriggerEnd center height (server finish check
      // requires height >= endY, which equals center.y). Anchor everything there.
      const floorY = center.y

      // The win platform alternates 0deg/180deg each round, so a fixed rotation would
      // face backwards half the time. Instead, aim the pigeon at the tower center
      // (where the climbing player arrives). Flip FACE_TOWER if it ends up reversed.
      const FACE_TOWER = true
      const TOWER_CENTER_X = 40
      const TOWER_CENTER_Z = 40
      let yaw = Math.atan2(TOWER_CENTER_X - center.x, TOWER_CENTER_Z - center.z) * (180 / Math.PI)
      if (!FACE_TOWER) yaw += 180

      // faceDir points toward the tower center (the side the climbing player
      // arrives from); perpDir is the sideways axis along the platform.
      const yawRad = yaw * (Math.PI / 180)
      const faceDir = Vector3.create(Math.sin(yawRad), 0, Math.cos(yawRad))
      const perpDir = Vector3.create(faceDir.z, 0, -faceDir.x)

      // Pigeon/claim sits IN FRONT of the portals — pushed toward the tower (the
      // arriving side) so the player reads the claim first, with the portals
      // behind it. The pigeon model (a child of pigeonClick) rides along, and
      // its own Y offset/scale cancel out this parent's height offset/stretch.
      const PIGEON_FORWARD_OFFSET = 3 // toward the tower/player, in front of the portals
      const pct = Transform.getMutable(pigeonClick)
      pct.position = Vector3.create(
        center.x + faceDir.x * PIGEON_FORWARD_OFFSET,
        floorY + PIGEON_HITBOX_HEIGHT / 2,
        center.z + faceDir.z * PIGEON_FORWARD_OFFSET
      )
      pct.rotation = Quaternion.fromEulerDegrees(0, yaw, 0)

      // Portals flank the win-zone center (behind the pigeon, still inside scene
      // bounds — the platform is at the very edge of the scene, so we can't push
      // them further out), facing the arriving player.
      const PORTAL_FORWARD_OFFSET = 0 // at the win-zone center, behind the pigeon
      const PORTAL_SIDE_OFFSET = 4.5 // one portal to each side of the pigeon
      const portalBase = Vector3.create(
        center.x + faceDir.x * PORTAL_FORWARD_OFFSET,
        floorY,
        center.z + faceDir.z * PORTAL_FORWARD_OFFSET
      )
      const portalYaw = yaw + 180 // portal front faces the arriving player
      cozyfarmPortal.update(
        {
          x: portalBase.x + perpDir.x * PORTAL_SIDE_OFFSET,
          y: portalBase.y,
          z: portalBase.z + perpDir.z * PORTAL_SIDE_OFFSET
        },
        { x: 0, y: portalYaw, z: 0 }
      )
      flagtagPortal.update(
        {
          x: portalBase.x - perpDir.x * PORTAL_SIDE_OFFSET,
          y: portalBase.y,
          z: portalBase.z - perpDir.z * PORTAL_SIDE_OFFSET
        },
        { x: 0, y: portalYaw, z: 0 }
      )

      // Teleport-to-win-zone target — where the player lands when pressing "1".
      const PIGEON_TELEPORT_DISTANCE_M = 4.5
      winZoneTarget = Vector3.create(
        center.x + faceDir.x * PIGEON_TELEPORT_DISTANCE_M,
        floorY + 1,
        center.z + faceDir.z * PIGEON_TELEPORT_DISTANCE_M
      )
    },
    undefined,
    'pigeon-teleport-system'
  )

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
    console.log('[Game] CoolBed found, adding click-to-Talk')

    MeshCollider.setBox(entity, ColliderLayer.CL_POINTER)

    pointerEventsSystem.onPointerDown(
      {
        entity,
        opts: {
          button: InputAction.IA_POINTER,
          hoverText: 'Talk',
          showFeedback: true,
          showHighlight: true,
          maxDistance: 10
        }
      },
      () => {
        if (tutorialStep !== TutorialStep.INACTIVE && tutorialStep !== TutorialStep.DONE) return
        if (!Animator.has(entity)) return
        const breathClip = Animator.getClipOrNull(entity, 'Breath')
        const talkClip = Animator.getClipOrNull(entity, 'Talk')
        if (!breathClip || !talkClip) return
        if (coolBedPhase !== 'idle' && coolBedPhase !== 'talking') return
        triggerCoolBedDialog()
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

  engine.addSystem(
    () => {
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
    },
    undefined,
    'coolbed-animation-system'
  )

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
    { entity: triggerDeath, wasInside: false, useWorldPos: false, onEnter: dieAttempt }
  ]

  let triggerEndWasInside = false
  engine.addSystem(
    () => {
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

      const triggerEnd = findTriggerEndEntity()
      if (triggerEnd && Transform.has(triggerEnd)) {
        if (!TriggerArea.has(triggerEnd)) {
          setupTrigger(triggerEnd)
        }
        const t = Transform.get(triggerEnd)
        const pos = getWorldPosition(triggerEnd)
        const inside = isInsideBox(playerPos, pos, t.scale)

        if (inside && !triggerEndWasInside) {
          // Mark as inside regardless, but skip the finish when suppressed (teleport landing).
          triggerEndWasInside = true
          if (Date.now() >= suppressEndTriggerUntil) {
            finishAttempt()
          }
        } else if (!inside && triggerEndWasInside) {
          triggerEndWasInside = false
        }
      } else {
        triggerEndWasInside = false
      }
    },
    undefined,
    'trigger-detection-system'
  )

  // ============================================
  // ADD SYSTEMS
  // ============================================

  engine.addSystem(trackPlayerHeight, undefined, 'player-height-system')
  engine.addSystem(syncRoundState, undefined, 'round-sync-system')
  engine.addSystem(
    () => {
      if (attemptState !== AttemptState.VALIDATING) return
      if (finishValidationStartedAt === 0) return
      if (Date.now() - finishValidationStartedAt < FINISH_VALIDATION_TIMEOUT_MS) return

      rejectAttempt(
        'Your attempt did not count. The server could not validate your finish.',
        'ATTEMPT NOT COUNTED'
      )
    },
    undefined,
    'finish-validation-timeout-system'
  )

  // ============================================
  // INITIALIZE UI
  // ============================================

  setupUi()

  // ============================================
  // BACKGROUND MUSIC
  // ============================================

  setupBackgroundMusic('assets/sounds/Lobby Drift.mp3')

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
    position: Vector3.create(28, 1, 53),
    scale: Vector3.One()
  })

  AudioSource.create(backgroundMusicEntity, {
    audioClipUrl: audioPath,
    playing: true,
    loop: true,
    volume: 1,
    pitch: 1,
    currentTime: 0,
    global: true
  })

  engine.addSystem(
    () => {
      if (backgroundMusicEntity && AudioSource.has(backgroundMusicEntity)) {
        const audio = AudioSource.get(backgroundMusicEntity)

        if (!audio.playing) {
          AudioSource.getMutable(backgroundMusicEntity).playing = true
          console.log(`[Audio] Retrying background music playback: ${audio.audioClipUrl}`)
        }

        if (audio.playing && !audioStarted) {
          audioStarted = true
          console.log(`[Audio] Background music started: ${audio.audioClipUrl}`)
        }
      }
    },
    undefined,
    'background-music-system'
  )

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
