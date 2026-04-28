import {
  engine,
  Transform,
  CameraMode,
  CameraType,
  InputAction,
  inputSystem,
  Entity
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

// ============================================
// CINEMATIC CAMERA SYSTEM
// ============================================

export type CinematicState = 'idle' | 'playing' | 'skipping'

// Camera path keyframes - smooth ascent to the top
const CAMERA_KEYFRAMES = [
  // Start: at the ramp/start area, looking at the tower base
  {
    position: Vector3.create(40, 15, 28),
    lookAt: Vector3.create(40, 25, 35),
    duration: 1500
  },
  // Lower section - begin ascent
  {
    position: Vector3.create(41, 30, 32),
    lookAt: Vector3.create(40, 45, 38),
    duration: 2000
  },
  // Mid tower - smooth upward movement
  {
    position: Vector3.create(42, 50, 34),
    lookAt: Vector3.create(40, 65, 38),
    duration: 2000
  },
  // Upper section - approaching top
  {
    position: Vector3.create(41, 70, 35),
    lookAt: Vector3.create(40, 80, 38),
    duration: 1500
  },
  // Top - showing the win zone
  {
    position: Vector3.create(39, 85, 37),
    lookAt: Vector3.create(40, 88, 38),
    duration: 2000
  }
]

const TOTAL_DURATION = CAMERA_KEYFRAMES.reduce((sum, kf) => sum + kf.duration, 0)
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

export function playCinematic() {
  if (cinematicState === 'playing') return

  console.log('[Cinematic] Starting cinematic camera sequence')
  cinematicState = 'playing'
  cinematicStartTime = Date.now()
  skipKeyPressStartTime = 0
  skipKeyCurrentlyPressed = false

  // Create camera entity if it doesn't exist
  if (!cameraEntity) {
    cameraEntity = engine.addEntity()
    Transform.create(cameraEntity, {
      position: CAMERA_KEYFRAMES[0].position
    })
  }

  // Set camera to cinematic mode
  CameraMode.create(cameraEntity, {
    mode: CameraType.CT_THIRD_PERSON
  })

  hasPlayedOnce = true
}

export function skipCinematic() {
  if (cinematicState !== 'playing') return

  console.log('[Cinematic] Skipping cinematic')
  cinematicState = 'skipping'

  // Reset to normal camera mode
  if (cameraEntity && CameraMode.has(cameraEntity)) {
    CameraMode.deleteFrom(cameraEntity)
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

  for (let i = 0; i < CAMERA_KEYFRAMES.length - 1; i++) {
    const frameDuration = CAMERA_KEYFRAMES[i].duration

    if (elapsed < accumulatedTime + frameDuration) {
      const frameElapsed = elapsed - accumulatedTime
      const t = frameElapsed / frameDuration
      return { from: i, to: i + 1, t }
    }

    accumulatedTime += frameDuration
  }

  // Last frame
  return { from: CAMERA_KEYFRAMES.length - 1, to: CAMERA_KEYFRAMES.length - 1, t: 1 }
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
      if (elapsed >= TOTAL_DURATION) {
        skipCinematic()
        return
      }

      // Update camera position and rotation
      const { from, to, t } = getCurrentFrame(elapsed)
      const fromFrame = CAMERA_KEYFRAMES[from]
      const toFrame = CAMERA_KEYFRAMES[to]

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
