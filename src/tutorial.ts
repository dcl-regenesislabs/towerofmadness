import {
  engine,
  Transform,
  GltfContainer,
  Billboard,
  BillboardMode,
  AvatarBase,
  InputModifier,
  InputAction,
  PointerEventType,
  inputSystem,
  Entity
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { isMobile, getPlatform } from '@dcl/sdk/platform'
import { isCinematicPlaying } from './cinematicCamera'
import { onTutorialStatus, sendTutorialCompleted } from './multiplayer'

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

export const TUTORIAL_CLIMB_HOLD_MS = 6000
export const TUTORIAL_CLIMB_FADE_MS = 1500

const MOVE_THRESHOLD_M = 0.6
const MOVE_HOLD_MS = 5000
const HINT_DELAY_MS = 20000
const SERVER_STATUS_TIMEOUT_MS = 5000
const PLATFORM_TIMEOUT_MS = 3000
const PIGEON_SPAWN_OFFSET_M = 2.6

const LEARN_MOVE_TEXT =
  'Great! Touch the left side of the screen to activate the joystick, and drag the right side to look around.'
const JUMP_INTRO_TEXT = "Now let's jump!\nTap once to jump, or twice quickly to double-jump."
const GLIDE_TIP_TEXT = 'Nice! Double-jump, then tap the parachute icon in the air to glide.'
const CLIMB_TEXT = "You're ready! Climb to the top — I'll be waiting there with a gift. Good luck!"
const LEARN_MOVE_HINT = 'Tip: touch the left side of the screen to walk, drag the right side to look around.'
const JUMP_HINT = 'Tip: tap the jump button on screen to jump.'

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

function spawnPigeon() {
  if (pigeonEntity) return
  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  const playerPos = playerTransform?.position ?? Vector3.Zero()
  const playerRot = playerTransform?.rotation ?? Quaternion.Identity()
  const right = Vector3.rotate(Vector3.Right(), playerRot)

  // Billboard overwrites this entity's rotation every frame to face the
  // camera, so the model can't just be spawned with a fixed offset rotation.
  // Instead it's a plain rig entity, with the .glb parented to it on a child
  // that carries a static 180° turn — the pigeon's model faces -Z, so without
  // this the camera would end up looking at the back of its neck.
  pigeonEntity = engine.addEntity()
  Transform.create(pigeonEntity, {
    position: Vector3.create(
      playerPos.x + right.x * PIGEON_SPAWN_OFFSET_M,
      playerPos.y,
      playerPos.z + right.z * PIGEON_SPAWN_OFFSET_M
    ),
    rotation: playerRot,
    scale: Vector3.One()
  })
  // Keeps the pigeon facing the player as they move around, rotating only on
  // the Y axis so it doesn't tilt up/down or lean sideways.
  Billboard.create(pigeonEntity, { billboardMode: BillboardMode.BM_Y })

  const pigeonModel = engine.addEntity()
  GltfContainer.create(pigeonModel, { src: 'assets/scene/Models/pigeon.glb' })
  Transform.create(pigeonModel, {
    parent: pigeonEntity,
    position: Vector3.Zero(),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0),
    scale: Vector3.One()
  })
}

function despawnPigeon() {
  if (!pigeonEntity) return
  engine.removeEntityWithChildren(pigeonEntity)
  pigeonEntity = null
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
  spawnPigeon()
  setInputMode({ disableAll: true })

  const name = AvatarBase.getOrNull(engine.PlayerEntity)?.name || 'friend'
  setStep(TutorialStep.WELCOME, welcomeText(name))
  tutorialShowTryButton = true
  tutorialShowSkipButton = allowSkip
}

function finishTutorial() {
  setInputMode({ disableDoubleJump: false, disableGliding: false })
  despawnPigeon()

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
  setStep(TutorialStep.CLIMB, CLIMB_TEXT)
}

export function onSkipClicked() {
  if (tutorialStep !== TutorialStep.WELCOME) return
  if (!welcomeSkipAllowed) return
  finishTutorial()
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
  if (isCinematicPlaying()) return

  // Mobile-only feature — desktop/web players skip it entirely and are never
  // marked as having seen it, so it still triggers if they later join on mobile.
  // getPlatform() resolves asynchronously on scene load; give it a short grace
  // window here in case it hasn't landed yet by the time the cinematic ends.
  if (getPlatform() === null) {
    if (platformWaitStartedAt === 0) platformWaitStartedAt = Date.now()
    if (Date.now() - platformWaitStartedAt < PLATFORM_TIMEOUT_MS) return
  }

  if (!isMobile()) {
    pendingIntroSpawn = false
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
    if (Date.now() - tutorialStepChangedAt >= TUTORIAL_CLIMB_HOLD_MS + TUTORIAL_CLIMB_FADE_MS) {
      finishTutorial()
    }
  }
}

export function setupTutorial() {
  onTutorialStatus((seen) => {
    hasSeenTutorialFromServer = seen
  })

  engine.addSystem(
    () => {
      updateIntroSpawnWaiting()
      updateTutorialProgress()
    },
    undefined,
    'pigeon-tutorial-system'
  )
}
