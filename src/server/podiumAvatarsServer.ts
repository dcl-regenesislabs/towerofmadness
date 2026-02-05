import { engine, Entity, Transform, AvatarShape, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
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
  private appearanceByAddress = new Map<string, AvatarAppearance>()
  private missingAppearanceLogged = new Set<string>()

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

        const appearance = this.appearanceByAddress.get(slot.address)
        const hasAppearance = !!(appearance?.wearables?.length || appearance?.bodyShape)
        if (!hasAppearance) {
          if (!this.missingAppearanceLogged.has(slot.address)) {
            this.missingAppearanceLogged.add(slot.address)
            room.send('podiumDebug', {
              address: slot.address,
              info: 'No appearance data yet from client.'
            })
          }
          continue
        }

        const avatar = AvatarShape.getMutable(slot.entity)
        if (appearance.wearables?.length) avatar.wearables = appearance.wearables.slice()
        if (appearance.bodyShape) avatar.bodyShape = appearance.bodyShape
        if (appearance.eyeColor) avatar.eyeColor = appearance.eyeColor
        if (appearance.skinColor) avatar.skinColor = appearance.skinColor
        if (appearance.hairColor) avatar.hairColor = appearance.hairColor

        VisibilityComponent.getMutable(slot.entity).visible = true
        Transform.getMutable(slot.entity).scale = Vector3.One()

        if (this.elapsedSeconds - slot.lastEmoteTime >= PODIUM_EMOTE_REPLAY_SECONDS) {
          slot.emoteTriggerCounter += 1
          avatar.expressionTriggerId = DEFAULT_EXPRESSION_IDS[slot.index] || 'clap'
          avatar.expressionTriggerTimestamp = slot.emoteTriggerCounter
          slot.lastEmoteTime = this.elapsedSeconds
        }

        slot.lastSyncedAddress = slot.address
        slot.lastSyncTime = this.elapsedSeconds
      }
    }, undefined, 'server-podium-avatar-sync-system')
  }

  private bindMessages() {
    room.onMessage('avatarAppearance', (data, context) => {
      if (!context) return
      const address = context.from.toLowerCase()
      this.appearanceByAddress.set(address, {
        bodyShape: data.bodyShape,
        wearables: data.wearables,
        eyeColor: data.eyeColor,
        skinColor: data.skinColor,
        hairColor: data.hairColor
      })
      this.missingAppearanceLogged.delete(address)
    })
  }
}
