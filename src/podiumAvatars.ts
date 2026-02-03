import { engine, Entity, Transform, AvatarShape, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import type { WinnerEntry } from './multiplayer'

const PODIUM_POSITIONS: Vector3[] = [
  Vector3.create(8, 0, 8),
  Vector3.create(6.5, 0, 8),
  Vector3.create(9.5, 0, 8)
]

const PODIUM_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const SYNC_INTERVAL_SECONDS = 0.75

type PodiumSlot = {
  entity: Entity
  address: string | null
  lastSyncedAddress: string | null
  lastSyncTime: number
}

let initialized = false
let podiumActive = false
let elapsedSeconds = 0
const podiumSlots: PodiumSlot[] = []

export function initPodiumAvatars(): void {
  if (initialized) return
  initialized = true

  for (let i = 0; i < PODIUM_POSITIONS.length; i += 1) {
    const entity = engine.addEntity()
    AvatarShape.create(entity, { id: `podium-avatar-${i + 1}`, wearables: [], emotes: [] })
    Transform.create(entity, {
      position: PODIUM_POSITIONS[i],
      rotation: PODIUM_ROTATION,
      scale: Vector3.One()
    })
    VisibilityComponent.create(entity, { visible: false })

    podiumSlots.push({
      entity,
      address: null,
      lastSyncedAddress: null,
      lastSyncTime: 0
    })
  }

  engine.addSystem((dt: number) => {
    if (!podiumActive) return
    elapsedSeconds += dt

    for (const slot of podiumSlots) {
      if (!slot.address) continue

      const needsSync =
        slot.lastSyncedAddress !== slot.address ||
        elapsedSeconds - slot.lastSyncTime >= SYNC_INTERVAL_SECONDS

      if (!needsSync) continue

      const player = getPlayer({ userId: slot.address })
      if (!player || !player.wearables || !player.avatar) continue

      const avatar = AvatarShape.getMutable(slot.entity)
      avatar.wearables = player.wearables.slice()
      avatar.bodyShape = player.avatar.bodyShapeUrn
      avatar.eyeColor = player.avatar.eyesColor
      avatar.skinColor = player.avatar.skinColor
      avatar.hairColor = player.avatar.hairColor

      VisibilityComponent.getMutable(slot.entity).visible = true
      slot.lastSyncedAddress = slot.address
      slot.lastSyncTime = elapsedSeconds
    }
  }, undefined, 'podium-avatar-sync-system')
}

export function showPodiumWinners(winners: WinnerEntry[]): void {
  if (!initialized) initPodiumAvatars()
  podiumActive = true
  const sortedWinners = winners.slice().sort((a, b) => a.rank - b.rank)

  for (let i = 0; i < podiumSlots.length; i += 1) {
    const slot = podiumSlots[i]
    const winner = sortedWinners[i]
    slot.address = winner?.address ? winner.address.toLowerCase() : null
    slot.lastSyncedAddress = null
    slot.lastSyncTime = 0

    VisibilityComponent.getMutable(slot.entity).visible = !!slot.address
  }
}

export function hidePodiumWinners(): void {
  podiumActive = false
  for (const slot of podiumSlots) {
    slot.address = null
    slot.lastSyncedAddress = null
    slot.lastSyncTime = 0
    VisibilityComponent.getMutable(slot.entity).visible = false
  }
}
