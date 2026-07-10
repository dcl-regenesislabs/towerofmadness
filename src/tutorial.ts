import {
  engine,
  Transform,
  GltfContainer,
  AvatarBase,
  InputModifier,
  InputAction,
  PointerEventType,
  inputSystem,
  pointerEventsSystem,
  MeshCollider,
  ColliderLayer,
  PlayerIdentityData,
  Entity
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { isMobile, getPlatform } from '@dcl/sdk/platform'
import { movePlayerTo } from '~system/RestrictedActions'
import { signedFetch } from '~system/SignedFetch'
import { isCinematicPlaying, skipCinematic } from './cinematicCamera'
import { onTutorialStatus, sendTutorialCompleted } from './multiplayer'
import { PIGEON_WEARABLE_CONFIG } from './shared/wearableConfig'
import {
  REAL_TOWER_BASE_POSITION,
  TUTORIAL_CLIMB_REACHED_Y,
  TUTORIAL_TOWER_BASE_POSITION,
  TUTORIAL_TOWER_TOP_Y,
  TUTORIAL_TOWER_X,
  TUTORIAL_TOWER_Z,
  TUTORIAL_TROPHY_POSITION
} from './shared/tutorialTower'

// ============================================
// PIGEON TUTORIAL — guided onboarding
// ============================================
// Mobile-only. Mandatory on a player's first-ever visit (server has never seen
// their wallet complete/skip it), skippable on every visit after that. Spawns
// right after the one-time intro cinematic (not the per-round replay cinematic)
// and walks the player through movement -> jump/double-jump -> glide, gating
// their avatar controls with InputModifier along the way. Desktop players never
// see it — isMobile() comes from the explorer, not just screen size.

export enum TutorialStep {
  INACTIVE = 'INACTIVE',
  WELCOME = 'WELCOME',
  LEARN_MOVE = 'LEARN_MOVE',
  JUMP_INTRO = 'JUMP_INTRO',
  GLIDE_TIP = 'GLIDE_TIP',
  CLIMB = 'CLIMB',
  REWARD = 'REWARD',
  DONE = 'DONE'
}

// Reactive state read by ui.tsx (same pattern as the exported `let`s in index.ts)
export let tutorialStep: TutorialStep = TutorialStep.INACTIVE
export let tutorialDialogText: string = ''
export let tutorialHintText: string = ''
export let tutorialShowTryButton = false
export let tutorialShowGotItButton = false
export let tutorialShowSkipButton = false
// Timestamp the current dialog text was set — drives the typewriter effect and,
// for the CLIMB step, the hold+fade timing in the UI.
export let tutorialStepChangedAt = 0
// Set to Date.now() when the pigeon wearable is successfully claimed at the top
// of the tutorial tower; the UI shows a "Claimed" banner for a few seconds after.
export let pigeonClaimTimestamp: number = 0

export const TUTORIAL_REWARD_HOLD_MS = 6000
export const TUTORIAL_REWARD_FADE_MS = 1500

const MOVE_THRESHOLD_M = 0.6
const MOVE_HOLD_MS = 5000
const HINT_DELAY_MS = 20000
const SERVER_STATUS_TIMEOUT_MS = 5000
const PLATFORM_TIMEOUT_MS = 3000
const PIGEON_SPAWN_OFFSET_M = 1.8

const LEARN_MOVE_TEXT =
  'Great! Touch the left side of the screen to activate the joystick, and drag the right side to look around.'
const JUMP_INTRO_TEXT = "Now let's jump!\nTap once to jump, or twice quickly to double-jump."
const GLIDE_TIP_TEXT = 'Nice! Double-jump, then tap the parachute icon in the air to glide.'
const CLIMB_TEXT = "You're ready! Climb to the top — I'll be waiting there with a gift. Good luck!"
const REWARD_TEXT = "Awesome, you made it! Welcome to Tower of Madness — good luck out there!"
const LEARN_MOVE_HINT = 'Tip: touch the left side of the screen to walk, drag the right side to look around.'
const JUMP_HINT = 'Tip: tap the jump button on screen to jump.'
const CLIMB_HINT = 'Tip: jump from platform to platform — glide if you need a bit more distance.'

function welcomeText(name: string): string {
  return `Hi ${name}! I'm your guide pigeon.\nPress TRY to unlock your controls and take a few steps.`
}

let pigeonEntity: Entity | null = null
let pendingIntroSpawn = false
let introWaitStartedAt = 0
let platformWaitStartedAt = 0
let hasSeenTutorialFromServer: boolean | null = null
let welcomeSkipAllowed = false

let moveBaselinePos: Vector3 | null = null
let moveConfirmedAt = 0
let phaseEnteredAt = 0
let hintShownForPhase = false
let tutorialCompletedSent = false

function setInputMode(standard: Parameters<typeof InputModifier.Mode.Standard>[0]) {
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard(standard) })
}

function spawnPigeon(position: Vector3, rotation: Quaternion) {
  if (pigeonEntity) return
  pigeonEntity = engine.addEntity()
  GltfContainer.create(pigeonEntity, { src: 'assets/scene/Models/pigeon.glb' })
  Transform.create(pigeonEntity, { position, rotation, scale: Vector3.One() })
}

function movePigeonTo(position: Vector3, rotation: Quaternion) {
  if (!pigeonEntity) return
  const transform = Transform.getMutable(pigeonEntity)
  transform.position = position
  transform.rotation = rotation
}

function despawnPigeon() {
  if (!pigeonEntity) return
  engine.removeEntity(pigeonEntity)
  pigeonEntity = null
}

// ============================================
// WEARABLE CLAIM TROPHY — only available on the tutorial tower's top platform
// ============================================

let trophySpawned = false

// Claims the pigeon wearable for the local player via the DCL Rewards API.
// Uses PIGEON_WEARABLE_CONFIG (separate from the tournament prize campaign).
async function claimPigeonWearable() {
  const address = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase()
  if (!address) {
    console.log('[Tutorial] Cannot claim — no local player address')
    return
  }
  console.log(`[Tutorial] Claiming wearable for ${address}...`)
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
      console.log(`[Tutorial] ✓ Claimed! token: ${data.data[0].token ?? 'claimed'}`)
      pigeonClaimTimestamp = Date.now()
    } else {
      console.error(`[Tutorial] ✗ Claim failed: ${data.error ?? response.body}`)
    }
  } catch (err) {
    console.error('[Tutorial] ✗ Claim error:', err)
  }
}

function spawnWearableTrophy() {
  if (trophySpawned) return
  trophySpawned = true

  const trophy = engine.addEntity()
  GltfContainer.create(trophy, { src: 'assets/wearables/PartyPigeon.glb' })
  Transform.create(trophy, {
    position: Vector3.create(TUTORIAL_TROPHY_POSITION.x, TUTORIAL_TROPHY_POSITION.y, TUTORIAL_TROPHY_POSITION.z),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0),
    scale: Vector3.One()
  })

  // Invisible click target covering the trophy — "Claim" on left click.
  const trophyClick = engine.addEntity()
  Transform.create(trophyClick, {
    position: Vector3.create(TUTORIAL_TROPHY_POSITION.x, TUTORIAL_TROPHY_POSITION.y + 1, TUTORIAL_TROPHY_POSITION.z),
    scale: Vector3.create(1.2, 2.2, 1.2)
  })
  MeshCollider.setBox(trophyClick, ColliderLayer.CL_POINTER)

  pointerEventsSystem.onPointerDown(
    {
      entity: trophyClick,
      opts: {
        button: InputAction.IA_POINTER,
        hoverText: 'Claim',
        showFeedback: true,
        showHighlight: true,
        maxDistance: 8
      }
    },
    () => { void claimPigeonWearable() }
  )
}

function setStep(step: TutorialStep, text: string) {
  tutorialStep = step
  tutorialDialogText = text
  tutorialStepChangedAt = Date.now()
  phaseEnteredAt = Date.now()
  hintShownForPhase = false
  tutorialHintText = ''
  tutorialShowTryButton = false
  tutorialShowGotItButton = false
  tutorialShowSkipButton = false
}

function beginTutorial(allowSkip: boolean) {
  welcomeSkipAllowed = allowSkip

  console.log('[Tutorial] Teleporting to tutorial tower:', TUTORIAL_TOWER_BASE_POSITION)
  movePlayerTo({
    newRelativePosition: TUTORIAL_TOWER_BASE_POSITION,
    cameraTarget: {
      x: TUTORIAL_TOWER_X,
      y: TUTORIAL_TOWER_BASE_POSITION.y + 1,
      z: TUTORIAL_TOWER_Z
    }
  })

  spawnPigeon(
    Vector3.create(
      TUTORIAL_TOWER_BASE_POSITION.x + PIGEON_SPAWN_OFFSET_M,
      TUTORIAL_TOWER_BASE_POSITION.y,
      TUTORIAL_TOWER_BASE_POSITION.z
    ),
    Quaternion.fromEulerDegrees(0, -90, 0)
  )
  setInputMode({ disableAll: true })

  const name = AvatarBase.getOrNull(engine.PlayerEntity)?.name || 'friend'
  setStep(TutorialStep.WELCOME, welcomeText(name))
  tutorialShowTryButton = true
  tutorialShowSkipButton = allowSkip
}

// Player always lands on the tutorial tower by default, every visit — the
// only way to reach the real tower/round is explicitly clicking Skip
// (`teleportToReal`). Finishing the climb normally just ends the tutorial UI
// and leaves the player up there next to the wearable trophy.
function finishTutorial(teleportToReal: boolean) {
  setInputMode({ disableDoubleJump: false, disableGliding: false })
  despawnPigeon()

  if (teleportToReal) {
    console.log('[Tutorial] Skip — teleporting to real tower:', REAL_TOWER_BASE_POSITION)
    movePlayerTo({
      newRelativePosition: REAL_TOWER_BASE_POSITION,
      cameraTarget: {
        x: REAL_TOWER_BASE_POSITION.x,
        y: REAL_TOWER_BASE_POSITION.y + 1,
        z: REAL_TOWER_BASE_POSITION.z
      }
    })
  }

  tutorialStep = TutorialStep.DONE
  tutorialDialogText = ''
  tutorialHintText = ''
  tutorialShowTryButton = false
  tutorialShowGotItButton = false
  tutorialShowSkipButton = false

  if (!tutorialCompletedSent) {
    tutorialCompletedSent = true
    sendTutorialCompleted()
  }
}

function maybeShowHint(text: string, condition: boolean) {
  if (!condition || hintShownForPhase) return
  if (Date.now() - phaseEnteredAt < HINT_DELAY_MS) return
  hintShownForPhase = true
  tutorialHintText = text
}

// ============================================
// PUBLIC ACTIONS — called from the UI's button handlers
// ============================================

export function onTryClicked() {
  if (tutorialStep !== TutorialStep.WELCOME) return

  setInputMode({ disableJump: true, disableDoubleJump: true, disableGliding: true })
  moveBaselinePos = Transform.getOrNull(engine.PlayerEntity)?.position ?? null
  moveConfirmedAt = 0
  setStep(TutorialStep.LEARN_MOVE, LEARN_MOVE_TEXT)
}

export function onGotItClicked() {
  if (tutorialStep !== TutorialStep.GLIDE_TIP) return

  setInputMode({ disableDoubleJump: false, disableGliding: false })
  movePigeonTo(
    Vector3.create(TUTORIAL_TOWER_X, TUTORIAL_TOWER_TOP_Y + 1, TUTORIAL_TOWER_Z),
    Quaternion.fromEulerDegrees(0, 180, 0)
  )
  setStep(TutorialStep.CLIMB, CLIMB_TEXT)
}

export function onSkipClicked() {
  if (tutorialStep !== TutorialStep.WELCOME) return
  if (!welcomeSkipAllowed) return
  finishTutorial(true)
}

// Called once, right when the one-time intro cinematic starts playing.
export function armPendingIntroTutorial() {
  pendingIntroSpawn = true
}

// ============================================
// SYSTEM
// ============================================

function updateIntroSpawnWaiting() {
  if (!pendingIntroSpawn) return

  // Mobile-only feature — desktop/web players skip it entirely and are never
  // marked as having seen it, so it still triggers if they later join on mobile.
  // getPlatform() resolves asynchronously on scene load; give it a short grace
  // window here in case it hasn't landed yet.
  if (getPlatform() === null) {
    if (platformWaitStartedAt === 0) platformWaitStartedAt = Date.now()
    if (Date.now() - platformWaitStartedAt < PLATFORM_TIMEOUT_MS) return
  }

  if (!isMobile()) {
    // Desktop/web: let the tower flythrough play out normally, tutorial never starts.
    if (isCinematicPlaying()) return
    pendingIntroSpawn = false
    return
  }

  // Mobile: skip the real tower's flythrough entirely and drop straight into the tutorial.
  if (isCinematicPlaying()) {
    skipCinematic()
    return
  }

  if (hasSeenTutorialFromServer === null) {
    if (introWaitStartedAt === 0) introWaitStartedAt = Date.now()
    if (Date.now() - introWaitStartedAt < SERVER_STATUS_TIMEOUT_MS) return
    console.log('[Tutorial] No tutorialStatus from server yet, defaulting to mandatory')
    hasSeenTutorialFromServer = false
  }

  pendingIntroSpawn = false
  beginTutorial(hasSeenTutorialFromServer)
}

function updateTutorialProgress() {
  if (tutorialStep === TutorialStep.LEARN_MOVE) {
    const pos = Transform.getOrNull(engine.PlayerEntity)?.position
    if (pos && moveBaselinePos && moveConfirmedAt === 0 && Vector3.distance(pos, moveBaselinePos) > MOVE_THRESHOLD_M) {
      moveConfirmedAt = Date.now()
    }

    if (moveConfirmedAt > 0 && Date.now() - moveConfirmedAt >= MOVE_HOLD_MS) {
      setInputMode({ disableWalk: true, disableJog: true, disableRun: true })
      setStep(TutorialStep.JUMP_INTRO, JUMP_INTRO_TEXT)
      return
    }

    maybeShowHint(LEARN_MOVE_HINT, moveConfirmedAt === 0)
  } else if (tutorialStep === TutorialStep.JUMP_INTRO) {
    if (inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN)) {
      setStep(TutorialStep.GLIDE_TIP, GLIDE_TIP_TEXT)
      tutorialShowGotItButton = true
      return
    }

    maybeShowHint(JUMP_HINT, true)
  } else if (tutorialStep === TutorialStep.CLIMB) {
    const pos = Transform.getOrNull(engine.PlayerEntity)?.position
    if (pos && pos.y >= TUTORIAL_CLIMB_REACHED_Y) {
      setStep(TutorialStep.REWARD, REWARD_TEXT)
      return
    }

    maybeShowHint(CLIMB_HINT, true)
  } else if (tutorialStep === TutorialStep.REWARD) {
    if (Date.now() - tutorialStepChangedAt >= TUTORIAL_REWARD_HOLD_MS + TUTORIAL_REWARD_FADE_MS) {
      finishTutorial(false)
    }
  }
}

export function setupTutorial() {
  onTutorialStatus((seen) => {
    hasSeenTutorialFromServer = seen
  })

  spawnWearableTrophy()

  engine.addSystem(
    () => {
      updateIntroSpawnWaiting()
      updateTutorialProgress()
    },
    undefined,
    'pigeon-tutorial-system'
  )
}
