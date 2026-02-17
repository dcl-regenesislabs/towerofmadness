import { engine, Entity, Transform, AvatarShape, VisibilityComponent, TextShape, PlayerIdentityData } from '@dcl/sdk/ecs'
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
const PODIUM_TEXT_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const PODIUM_SYNC_INTERVAL_SECONDS = 0.75
const DEFAULT_EXPRESSION_IDS = ['dance', 'clap', 'clap']
const PODIUM_EMOTE_REPLAY_SECONDS = 4
const PODIUM_TEXT_OFFSET = Vector3.create(0, 2.2, 0)
const PODIUM_TEXT_SCALE = Vector3.create(-1, 1, 1)
const DEFAULT_BODY_SHAPE = 'urn:decentraland:off-chain:base-avatars:BaseMale'
const APPEARANCE_CACHE_SYNC_SECONDS = 1
const PROFILE_ENDPOINT = 'https://asset-bundle-registry.decentraland.org/profiles'
const PROFILE_RETRY_SECONDS = 8
type PodiumSlot = {
  index: number
  entity: Entity
  textEntity: Entity
  address: string | null
  lastSyncedAddress: string | null
  lastSyncTime: number
  lastEmoteTime: number
  emoteTriggerCounter: number
}

type AvatarColor = { r: number; g: number; b: number; a?: number }
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
  private cacheElapsedSeconds: number = 0
  private debugLogged = new Set<string>()
  private appearanceCache = new Map<string, AvatarAppearance>()
  private profileRequestsInFlight = new Set<string>()
  private profileLastAttempt = new Map<string, number>()

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
      VisibilityComponent.getMutable(slot.textEntity).visible = false
      Transform.getMutable(slot.textEntity).scale = Vector3.Zero()
      TextShape.getMutable(slot.textEntity).text = winner ? `${winner.height.toFixed(1)}m` : ''

      if (slot.address) {
        this.getAvatar(slot.address)
      }
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
      VisibilityComponent.getMutable(slot.textEntity).visible = false
      Transform.getMutable(slot.textEntity).scale = Vector3.Zero()
      TextShape.getMutable(slot.textEntity).text = ''
    }
  }

  private initEntities() {
    for (let i = 0; i < PODIUM_POSITIONS.length; i += 1) {
      const entity = engine.addEntity()
      const textEntity = engine.addEntity()
      AvatarShape.create(entity, { id: `podium-avatar-${i + 1}`, wearables: [], emotes: [] })
      Transform.create(entity, {
        position: PODIUM_POSITIONS[i],
        rotation: PODIUM_ROTATION,
        scale: Vector3.Zero()
      })
      VisibilityComponent.create(entity, { visible: false })
      syncEntity(entity, [Transform.componentId, VisibilityComponent.componentId, AvatarShape.componentId])

      TextShape.create(textEntity, {
        text: '',
        fontSize: 2,
        textColor: { r: 1, g: 0.9, b: 0.1, a: 1 },
        outlineWidth: 0.12,
        outlineColor: { r: 0, g: 0, b: 0 }
      })
      Transform.create(textEntity, {
        position: Vector3.add(PODIUM_POSITIONS[i], PODIUM_TEXT_OFFSET),
        rotation: PODIUM_TEXT_ROTATION,
        scale: Vector3.Zero()
      })
      VisibilityComponent.create(textEntity, { visible: false })
      syncEntity(textEntity, [Transform.componentId, VisibilityComponent.componentId, TextShape.componentId])

      this.slots.push({
        index: i,
        entity,
        textEntity,
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

        const appearance = this.getAvatar(slot.address)

        if (!this.debugLogged.has(slot.address)) {
          this.debugLogged.add(slot.address)
          let payload = ''
          try {
            payload = JSON.stringify(
              getPlayer({ userId: slot.address }),
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

        if (!appearance) continue

        const avatarShape = AvatarShape.getMutable(slot.entity)
        avatarShape.wearables = appearance.wearables.slice()
        avatarShape.bodyShape = appearance.bodyShape
        if (appearance.eyeColor) avatarShape.eyeColor = appearance.eyeColor
        if (appearance.skinColor) avatarShape.skinColor = appearance.skinColor
        if (appearance.hairColor) avatarShape.hairColor = appearance.hairColor

        VisibilityComponent.getMutable(slot.entity).visible = true
        Transform.getMutable(slot.entity).scale = Vector3.One()
        VisibilityComponent.getMutable(slot.textEntity).visible = true
        Transform.getMutable(slot.textEntity).scale = PODIUM_TEXT_SCALE

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

    engine.addSystem((dt: number) => {
      this.cacheElapsedSeconds += dt
      if (this.cacheElapsedSeconds < APPEARANCE_CACHE_SYNC_SECONDS) return
      this.cacheElapsedSeconds = 0

      for (const [_entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
        const address = identity.address.toLowerCase()
        const appearance = this.getLiveAppearance(address)
        if (appearance) {
          this.appearanceCache.set(address, appearance)
        }
      }
    }, undefined, 'server-podium-appearance-cache-system')
  }

  private bindMessages() {
    // no-op: server-side getPlayer is the source of truth
  }

  private getLiveAppearance(address: string): AvatarAppearance | null {
    const player = getPlayer({ userId: address })
    const wearables = player?.wearables ?? []
    const avatar = player?.avatar
    if (!avatar && wearables.length === 0) return null

    const appearance: AvatarAppearance = {
      wearables,
      bodyShape: avatar?.bodyShapeUrn || DEFAULT_BODY_SHAPE,
      eyeColor: avatar?.eyesColor ?? { r: 0, g: 0, b: 0 },
      skinColor: avatar?.skinColor ?? { r: 0, g: 0, b: 0 },
      hairColor: avatar?.hairColor ?? { r: 0, g: 0, b: 0 }
    }

    this.appearanceCache.set(address, appearance)
    return appearance
  }

  private getAvatar(address: string): AvatarAppearance | null {
    const liveAppearance = this.getLiveAppearance(address)
    if (liveAppearance) return liveAppearance

    const cachedAppearance = this.appearanceCache.get(address)
    if (cachedAppearance) return cachedAppearance

    void this.maybeFetchAppearanceFromProfiles(address)
    return null
  }

  private async maybeFetchAppearanceFromProfiles(address: string): Promise<void> {
    if (this.appearanceCache.has(address)) return

    const lastAttempt = this.profileLastAttempt.get(address) ?? -Infinity
    if (this.elapsedSeconds - lastAttempt < PROFILE_RETRY_SECONDS) return

    this.profileLastAttempt.set(address, this.elapsedSeconds)
    await this.fetchAppearanceFromProfiles(address)
  }

  private async fetchAppearanceFromProfiles(address: string): Promise<void> {
    if (this.appearanceCache.has(address)) return
    if (this.profileRequestsInFlight.has(address)) return

    this.profileRequestsInFlight.add(address)
    try {
      const fetchFn = (globalThis as unknown as {
        fetch?: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>
      }).fetch

      if (!fetchFn) return

      const response = await fetchFn(PROFILE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [address] })
      })
      if (!response?.ok) return

      const payload = await response.json()
      const profileList = this.extractProfiles(payload)
      const match = profileList.find((entry) => this.getProfileAddress(entry) === address)
      const avatar = match?.avatar ?? match?.avatars?.[0]?.avatar
      if (!avatar) return

      const wearables = Array.isArray(avatar.wearables)
        ? avatar.wearables.filter((urn: unknown) => typeof urn === 'string')
        : []

      const parsedAppearance: AvatarAppearance = {
        wearables,
        bodyShape:
          (typeof avatar.bodyShape === 'string' && avatar.bodyShape) ||
          (typeof avatar.bodyShapeUrn === 'string' && avatar.bodyShapeUrn) ||
          DEFAULT_BODY_SHAPE,
        eyeColor: this.parseColor(avatar.eyes?.color ?? avatar.eyeColor) ?? { r: 0, g: 0, b: 0 },
        skinColor: this.parseColor(avatar.skin?.color ?? avatar.skinColor) ?? { r: 0, g: 0, b: 0 },
        hairColor: this.parseColor(avatar.hair?.color ?? avatar.hairColor) ?? { r: 0, g: 0, b: 0 }
      }

      this.appearanceCache.set(address, parsedAppearance)
    } catch (_err) {
      // Keep podium system resilient; live data/cache remain primary path.
    } finally {
      this.profileRequestsInFlight.delete(address)
    }
  }

  private extractProfiles(payload: any): any[] {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.avatars)) return payload.avatars
    if (Array.isArray(payload?.profiles)) return payload.profiles
    return []
  }

  private getProfileAddress(entry: any): string {
    const fromUserId = typeof entry?.userId === 'string' ? entry.userId : ''
    const fromEthAddress = typeof entry?.ethAddress === 'string' ? entry.ethAddress : ''
    const fromId = typeof entry?.id === 'string' ? entry.id : ''
    const value = fromUserId || fromEthAddress || fromId
    return value.toLowerCase()
  }

  private parseColor(value: unknown): AvatarColor | null {
    if (!value) return null

    if (typeof value === 'string') {
      const hex = value.startsWith('#') ? value.slice(1) : value
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      return { r, g, b }
    }

    if (typeof value === 'object') {
      const candidate = value as { r?: unknown; g?: unknown; b?: unknown; a?: unknown }
      if (typeof candidate.r === 'number' && typeof candidate.g === 'number' && typeof candidate.b === 'number') {
        return {
          r: candidate.r,
          g: candidate.g,
          b: candidate.b,
          a: typeof candidate.a === 'number' ? candidate.a : undefined
        }
      }
    }

    return null
  }
}
