import {
  engine,
  Transform,
  MainCamera,
  VirtualCamera,
  InputAction,
  inputSystem,
  Entity
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { EntityNames } from '../assets/scene/entity-names'
import { ChunkEndComponent } from './shared/schemas'

// ============================================
// CINEMATIC CAMERA SYSTEM
// ============================================

export type CinematicState = 'idle' | 'playing' | 'skipping'

type CameraKeyframe = {
  position: Vector3
  lookAt: Vector3
  duration: number
}

// Original camera path: start at the ramp and rise to the top.
const CAMERA_KEYFRAMES: CameraKeyframe[] = [
  {
    position: Vector3.create(40, 5, 28),
    lookAt: Vector3.create(40, 25, 35),
    duration: 1500
  },
  {
    position: Vector3.create(41, 30, 32),
    lookAt: Vector3.create(40, 45, 38),
    duration: 2000
  },
  {
    position: Vector3.create(42, 50, 34),
    lookAt: Vector3.create(40, 65, 38),
    duration: 2000
  },
  {
    position: Vector3.create(41, 70, 35),
    lookAt: Vector3.create(40, 80, 38),
    duration: 1500
  },
  {
    position: Vector3.create(39, 85, 37),
    lookAt: Vector3.create(40, 88, 38),
    duration: 2000
  }
]

let activeCameraKeyframes: CameraKeyframe[] = CAMERA_KEYFRAMES
let totalDuration = CAMERA_KEYFRAMES.reduce((sum, kf) => sum + kf.duration, 0)
const SKIP_HOLD_DURATION_MS = 500 // Hold E for 500ms to skip

let cinematicState: CinematicState = 'idle'
let cinematicStartTime: number = 0
let skipKeyPressStartTime: number = 0
let skipKeyCurrentlyPressed: boolean = false
let cameraEntity: Entity | null = null
let hasPlayedOnce: boolean = false

// Public API
export function getCinematicState(): CinematicState {
  return cinematicState
}

export function isCinematicPlaying(): boolean {
  return cinematicState === 'playing'
}

function cloneKeyframe(keyframe: CameraKeyframe): CameraKeyframe {
  return {
    position: Vector3.clone(keyframe.position),
    lookAt: Vector3.clone(keyframe.lookAt),
    duration: keyframe.duration
  }
}

function findChunkEndTransform(): { position: Vector3; rotation: Quaternion } | null {
  for (const [entity] of engine.getEntitiesWith(ChunkEndComponent)) {
    if (Transform.has(entity)) {
      const transform = Transform.get(entity)
      return {
        position: Vector3.clone(transform.position),
        rotation: transform.rotation
      }
    }
  }

  return null
}

function findChunkStartTransform(): { position: Vector3; rotation: Quaternion } | null {
  const entity = engine.getEntityOrNullByName(EntityNames.ChunkStart_glb)
  if (!entity || !Transform.has(entity)) {
    return null
  }

  const transform = Transform.get(entity)
  return {
    position: Vector3.clone(transform.position),
    rotation: transform.rotation
  }
}

export function playCinematic() {
  if (cinematicState === 'playing') return

  console.log('[Cinematic] Starting cinematic camera sequence')
  cinematicState = 'playing'
  cinematicStartTime = Date.now()
  skipKeyPressStartTime = 0
  skipKeyCurrentlyPressed = false
  activeCameraKeyframes = CAMERA_KEYFRAMES.map(cloneKeyframe)

  const chunkStartTransform = findChunkStartTransform()
  if (chunkStartTransform) {
    const openingFrame = activeCameraKeyframes[0]
    const departureFrame = activeCameraKeyframes[1]
    const openingOffset = Vector3.rotate(Vector3.create(0, 8, 18), chunkStartTransform.rotation)
    const departureOffset = Vector3.rotate(Vector3.create(0, 12, 22), chunkStartTransform.rotation)
    const openingFocusOffset = Vector3.rotate(Vector3.create(0, 4, 0), chunkStartTransform.rotation)
    const departureFocusOffset = Vector3.rotate(Vector3.create(0, 6, 0), chunkStartTransform.rotation)

    openingFrame.position = Vector3.create(
      chunkStartTransform.position.x + openingOffset.x,
      chunkStartTransform.position.y + openingOffset.y,
      chunkStartTransform.position.z + openingOffset.z
    )
    openingFrame.lookAt = Vector3.create(
      chunkStartTransform.position.x + openingFocusOffset.x,
      chunkStartTransform.position.y + openingFocusOffset.y,
      chunkStartTransform.position.z + openingFocusOffset.z
    )
    openingFrame.duration = 2200

    departureFrame.position = Vector3.create(
      chunkStartTransform.position.x + departureOffset.x,
      chunkStartTransform.position.y + departureOffset.y,
      chunkStartTransform.position.z + departureOffset.z
    )
    departureFrame.lookAt = Vector3.create(
      chunkStartTransform.position.x + departureFocusOffset.x,
      chunkStartTransform.position.y + departureFocusOffset.y,
      chunkStartTransform.position.z + departureFocusOffset.z
    )
    departureFrame.duration = 1600
  }

  const chunkEndTransform = findChunkEndTransform()
  if (chunkEndTransform) {
    const approachFrame = activeCameraKeyframes[activeCameraKeyframes.length - 2]
    const finalFrame = activeCameraKeyframes[activeCameraKeyframes.length - 1]
    const approachOffset = Vector3.rotate(Vector3.create(0, 10, 18), chunkEndTransform.rotation)
    const frontalOffset = Vector3.rotate(Vector3.create(0, 16, 24), chunkEndTransform.rotation)
    const approachFocusOffset = Vector3.rotate(Vector3.create(0, 5, 0), chunkEndTransform.rotation)
    const focusOffset = Vector3.rotate(Vector3.create(0, 7, 0), chunkEndTransform.rotation)

    approachFrame.position = Vector3.create(
      chunkEndTransform.position.x + approachOffset.x,
      chunkEndTransform.position.y + approachOffset.y,
      chunkEndTransform.position.z + approachOffset.z
    )
    approachFrame.lookAt = Vector3.create(
      chunkEndTransform.position.x + approachFocusOffset.x,
      chunkEndTransform.position.y + approachFocusOffset.y,
      chunkEndTransform.position.z + approachFocusOffset.z
    )
    approachFrame.duration = 1200

    finalFrame.position = Vector3.create(
      chunkEndTransform.position.x + frontalOffset.x,
      chunkEndTransform.position.y + frontalOffset.y,
      chunkEndTransform.position.z + frontalOffset.z
    )
    finalFrame.lookAt = Vector3.create(
      chunkEndTransform.position.x + focusOffset.x,
      chunkEndTransform.position.y + focusOffset.y,
      chunkEndTransform.position.z + focusOffset.z
    )
    finalFrame.duration = 1400
  }

  totalDuration = activeCameraKeyframes.reduce((sum, kf) => sum + kf.duration, 0)

  // Create camera entity if it doesn't exist
  if (!cameraEntity) {
    cameraEntity = engine.addEntity()
    Transform.create(cameraEntity, {
      position: activeCameraKeyframes[0].position,
      rotation: lookAtRotation(activeCameraKeyframes[0].position, activeCameraKeyframes[0].lookAt)
    })
    VirtualCamera.create(cameraEntity, {
      defaultTransition: {
        transitionMode: VirtualCamera.Transition.Time(0)
      }
    })
  } else {
    const transform = Transform.getMutable(cameraEntity)
    transform.position = activeCameraKeyframes[0].position
    transform.rotation = lookAtRotation(activeCameraKeyframes[0].position, activeCameraKeyframes[0].lookAt)
  }

  // Take control of the player's view with a real virtual camera.
  MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = cameraEntity

  hasPlayedOnce = true
}

export function skipCinematic() {
  if (cinematicState !== 'playing') return

  console.log('[Cinematic] Skipping cinematic')
  cinematicState = 'skipping'

  // Return control to the normal player camera.
  if (MainCamera.has(engine.CameraEntity)) {
    MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity = undefined
  }

  // Small delay before returning to idle
  setTimeout(() => {
    cinematicState = 'idle'
  }, 100)
}

export function shouldAutoPlayCinematic(): boolean {
  return !hasPlayedOnce
}

// Linear interpolation helper
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVector3(a: Vector3, b: Vector3, t: number): Vector3 {
  return Vector3.create(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}

// Get current keyframe and interpolation factor based on elapsed time
function getCurrentFrame(elapsed: number): { from: number; to: number; t: number } {
  let accumulatedTime = 0

  for (let i = 0; i < activeCameraKeyframes.length - 1; i++) {
    const frameDuration = activeCameraKeyframes[i].duration

    if (elapsed < accumulatedTime + frameDuration) {
      const frameElapsed = elapsed - accumulatedTime
      const t = frameElapsed / frameDuration
      return { from: i, to: i + 1, t }
    }

    accumulatedTime += frameDuration
  }

  // Last frame
  return { from: activeCameraKeyframes.length - 1, to: activeCameraKeyframes.length - 1, t: 1 }
}

// Calculate look-at rotation
function lookAtRotation(from: Vector3, to: Vector3): Quaternion {
  const direction = Vector3.subtract(to, from)
  const length = Vector3.length(direction)

  if (length < 0.0001) {
    return Quaternion.Identity()
  }

  const normalized = Vector3.scale(direction, 1 / length)

  // Calculate pitch (rotation around X axis)
  const pitch = Math.atan2(normalized.y, Math.sqrt(normalized.x * normalized.x + normalized.z * normalized.z))

  // Calculate yaw (rotation around Y axis)
  const yaw = Math.atan2(normalized.x, normalized.z)

  // Create quaternion from Euler angles (yaw, pitch, 0)
  return Quaternion.fromEulerDegrees(-(pitch * 180) / Math.PI, (yaw * 180) / Math.PI, 0)
}

// Main cinematic update system
export function setupCinematicSystem() {
  engine.addSystem(
    () => {
      if (cinematicState !== 'playing') return
      if (!cameraEntity) return

      const elapsed = Date.now() - cinematicStartTime

      // Check for skip input (E key)
      const ePressed = inputSystem.isPressed(InputAction.IA_SECONDARY)

      if (ePressed && !skipKeyCurrentlyPressed) {
        // Key just pressed
        skipKeyCurrentlyPressed = true
        skipKeyPressStartTime = Date.now()
      } else if (!ePressed && skipKeyCurrentlyPressed) {
        // Key released
        skipKeyCurrentlyPressed = false
        skipKeyPressStartTime = 0
      }

      // Check if skip hold duration reached
      if (skipKeyCurrentlyPressed && Date.now() - skipKeyPressStartTime >= SKIP_HOLD_DURATION_MS) {
        skipCinematic()
        return
      }

      // Check if cinematic finished naturally
      if (elapsed >= totalDuration) {
        skipCinematic()
        return
      }

      // Update camera position and rotation
      const { from, to, t } = getCurrentFrame(elapsed)
      const fromFrame = activeCameraKeyframes[from]
      const toFrame = activeCameraKeyframes[to]

      const currentPos = lerpVector3(fromFrame.position, toFrame.position, t)
      const currentLookAt = lerpVector3(fromFrame.lookAt, toFrame.lookAt, t)

      const transform = Transform.getMutable(cameraEntity)
      transform.position = currentPos
      transform.rotation = lookAtRotation(currentPos, currentLookAt)
    },
    undefined,
    'cinematic-camera-system'
  )
}
