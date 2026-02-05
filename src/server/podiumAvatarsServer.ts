import { engine, Entity, Transform, AvatarShape, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { room } from '../shared/messages'
import type { WinnerEntry } from '../shared/schemas'

const PODIUM_POSITIONS: Vector3[] = [
  Vector3.create(47.0, 2.4, 61.0), // 1st place
  Vector3.create(46.0, 1.8, 61.5), // 2nd place
  Vector3.create(47.75, 1.4, 60.25) // 3rd place
]

const PODIUM_ROTATION = Quaternion.fromEulerDegrees(0, 225, 0)
const PODIUM_SYNC_INTERVAL_SECONDS = 0.75
const DEFAULT_EXPRESSION_IDS = ['dance', 'clap', 'clap']
const PODIUM_EMOTE_REPLAY_SECONDS = 4
type PodiumSlot = {
  index: number
  entity: Entity
  address: string | null
  lastSyncedAddress: string | null
  lastSyncTime: number
  lastEmoteTime: number
  emoteTriggerCounter: number
}

type AvatarColor = { r: number; g: number; b: number }
type AvatarAppearance = {
  wearables: string[]
  bodyShape: string
  eyeColor: AvatarColor
  skinColor: AvatarColor
  hairColor: AvatarColor
}

export class PodiumAvatarsServer {
  private slots: PodiumSlot[] = []
  private active: boolean = false
  private elapsedSeconds: number = 0
  private debugLogged = new Set<string>()

  constructor() {
    this.initEntities()
    this.bindMessages()
  }

  showWinners(winners: WinnerEntry[]) {
    this.active = true
    const sortedWinners = winners.slice().sort((a, b) => a.rank - b.rank)

    for (const slot of this.slots) {
      const winner = sortedWinners[slot.index]
      slot.address = winner?.address ? winner.address.toLowerCase() : null
      slot.lastSyncedAddress = null
      slot.lastSyncTime = 0
      slot.lastEmoteTime = -PODIUM_EMOTE_REPLAY_SECONDS
      slot.emoteTriggerCounter = 0

      VisibilityComponent.getMutable(slot.entity).visible = false
      Transform.getMutable(slot.entity).scale = Vector3.Zero()
    }
  }

  clear() {
    this.active = false
    for (const slot of this.slots) {
      slot.address = null
      slot.lastSyncedAddress = null
      slot.lastSyncTime = 0
      slot.lastEmoteTime = 0
      slot.emoteTriggerCounter = 0
      VisibilityComponent.getMutable(slot.entity).visible = false
      Transform.getMutable(slot.entity).scale = Vector3.Zero()
    }
  }

  private initEntities() {
    for (let i = 0; i < PODIUM_POSITIONS.length; i += 1) {
      const entity = engine.addEntity()
      AvatarShape.create(entity, { id: `podium-avatar-${i + 1}`, wearables: [], emotes: [] })
      Transform.create(entity, {
        position: PODIUM_POSITIONS[i],
        rotation: PODIUM_ROTATION,
        scale: Vector3.Zero()
      })
      VisibilityComponent.create(entity, { visible: false })
      syncEntity(entity, [Transform.componentId, VisibilityComponent.componentId, AvatarShape.componentId])

      this.slots.push({
        index: i,
        entity,
        address: null,
        lastSyncedAddress: null,
        lastSyncTime: 0,
        lastEmoteTime: 0,
        emoteTriggerCounter: 0
      })
    }

    engine.addSystem((dt: number) => {
      if (!this.active) return
      this.elapsedSeconds += dt

      for (const slot of this.slots) {
        if (!slot.address) continue

        const needsSync =
          slot.lastSyncedAddress !== slot.address ||
          this.elapsedSeconds - slot.lastSyncTime >= PODIUM_SYNC_INTERVAL_SECONDS

        if (!needsSync) continue

        const player = getPlayer({ userId: slot.address })
        const wearables = player?.wearables ?? []
        const avatar = player?.avatar
        const hasServerAppearance = !!(wearables.length || avatar?.bodyShapeUrn)

        if (!this.debugLogged.has(slot.address)) {
          this.debugLogged.add(slot.address)
          let payload = ''
          try {
            payload = JSON.stringify(
              player,
              (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
              2
            )
          } catch (_err) {
            payload = '[unserializable getPlayer payload]'
          }
          if (payload.length > 1500) {
            payload = `${payload.slice(0, 1500)}...<truncated>`
          }
          room.send('podiumDebug', {
            address: slot.address,
            info: `getPlayer server-side payload:\n${payload}`
          })
        }

        if (!hasServerAppearance) {
          continue
        }

        const appearance: AvatarAppearance = {
          wearables,
          bodyShape: avatar?.bodyShapeUrn || '',
          eyeColor: avatar?.eyesColor ?? { r: 0, g: 0, b: 0 },
          skinColor: avatar?.skinColor ?? { r: 0, g: 0, b: 0 },
          hairColor: avatar?.hairColor ?? { r: 0, g: 0, b: 0 }
        }

        const avatarShape = AvatarShape.getMutable(slot.entity)
        if (appearance.wearables?.length) avatarShape.wearables = appearance.wearables.slice()
        if (appearance.bodyShape) avatarShape.bodyShape = appearance.bodyShape
        if (appearance.eyeColor) avatarShape.eyeColor = appearance.eyeColor
        if (appearance.skinColor) avatarShape.skinColor = appearance.skinColor
        if (appearance.hairColor) avatarShape.hairColor = appearance.hairColor

        VisibilityComponent.getMutable(slot.entity).visible = true
        Transform.getMutable(slot.entity).scale = Vector3.One()

         if (this.elapsedSeconds - slot.lastEmoteTime >= PODIUM_EMOTE_REPLAY_SECONDS) {
          slot.emoteTriggerCounter += 1
           avatarShape.expressionTriggerId = DEFAULT_EXPRESSION_IDS[slot.index] || 'clap'
          avatarShape.expressionTriggerTimestamp = slot.emoteTriggerCounter
          slot.lastEmoteTime = this.elapsedSeconds
        }

        slot.lastSyncedAddress = slot.address
        slot.lastSyncTime = this.elapsedSeconds
      }
    }, undefined, 'server-podium-avatar-sync-system')
  }

  private bindMessages() {
    // no-op: server-side getPlayer is the source of truth
  }
}
