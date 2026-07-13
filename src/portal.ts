import {
  ColliderLayer,
  EasingFunction,
  engine,
  Entity,
  GltfContainer,
  GltfNodeModifiers,
  InputAction,
  LightSource,
  Material,
  MeshCollider,
  Schemas,
  TextShape,
  Transform,
  Tween,
  VisibilityComponent,
  pointerEventsSystem
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

// ============================================
// PORTAL — ported from a fuller reference implementation (parallax vortex,
// title/thumbnail info card, proximity door animation), simplified for this
// project:
// - Door open/close is a plain proximity check with hysteresis (world-cup
//   style), not the 3-state TriggerArea + multi-avatar tracking version —
//   triggerAreaEventsSystem isn't exported by the @dcl/ecs version pinned
//   here, and this project already favors manual position polling over
//   trigger events elsewhere (see index.ts's TriggerEnd handling).
// - Activation is a click on an invisible box (like the world-cup dispenser
//   pattern), not a walk-through trigger, for the same reason.
// - No audio (no door sound assets available) and no connected-users badge
//   (no live data source for it here).
// ============================================

export type PortalOptions = {
  position: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  size?: number
  name?: string
  thumbnail?: string
  hoverText?: string
  onActivate?: () => void
}

const FRAME_SRC = 'assets/scene/Models/portals/portalFrame.glb'
const FRAME_ARROWS_SRC = 'assets/scene/Models/portals/portalFrameArrows.glb'
const DOOR_SRC = 'assets/scene/Models/portals/door.glb'
const LAYER_SRC = 'assets/scene/Models/portals/portalLayer2.glb'
const INFO_BG_SRC = 'assets/scene/Models/portals/event_card_bottom_tall.glb'
const INFO_THUMB_SRC = 'assets/scene/Models/portals/event_card_thumbnail.glb'

// Concentric "vortex" layers — i=0 outermost/largest, i=LAYER_COUNT-1 innermost/smallest.
const LAYER_COUNT = 18
const LAYER_SCALE = 0.35
const LAYER_GAP = 0.001
const LAYER_Z_OFFSET = -0.05
const LAYER_Y_STEP = 0.07
const SCALE_MIN = 0.2
const SCALE_CURVE = 0.9

// Parallax — inner layers drift opposite the camera (window effect) and lag behind (trailing).
const MAX_PARALLAX = 0.5
const MAX_LIMIT = 1
const LERP_SPEED_OUTER = 80
const LERP_SPEED_INNER = 15
const DIST_REFERENCE = 4
const DIST_SCALE_OUTER = 0
const DIST_SCALE_INNER = 0.04

// Doors
const DOOR_OFFSET_X = 0
const DOOR_OFFSET_Y = -1.6
const DOOR_OFFSET_Z = -0.05
const DOOR_SEPARATION = 1
const DOOR_SCALE = 1.0
const DOOR_OPEN_DIST = 5 // player distance (m) at which doors open
const DOOR_CLOSE_DIST = 6.5 // player distance (m) at which doors close (hysteresis gap vs. open)
const DOOR_OPEN_ANGLE = 145
const DOOR_TWEEN_MS = 1200

// Layers/frame share this offset so they align with the arch opening.
const FRAME_OFFSET = { x: 0, y: -1.6, z: 0.16 }
// Approximate world-space Y of the arch opening midpoint above the portal root.
const PORTAL_CENTER_Y_OFFSET = 2.5

// Info card — title + thumbnail panel floating above the portal.
const INFO_CARD_POS = { x: 0, y: 4.55, z: -0.4 }
const INFO_CARD_SCALE = { x: 0.85, y: 0.85, z: 1 }
const INFO_CARD_TILT = -12 // X-rotation degrees — top leans toward the player

// Clicker — invisible box over the doorway that activates the portal.
const CLICK_POS = { x: 0, y: 1.7, z: 0.2 }
const CLICK_SCALE = { x: 2.5, y: 3.5, z: 0.8 }
const CLICK_MAX_DISTANCE = 16

// ============================================
// Proximity door system — shared across all portals
// ============================================

const activePortals = new Set<Portal>()
let proximitySystemRegistered = false

function ensureProximitySystem() {
  if (proximitySystemRegistered) return
  engine.addSystem(() => {
    const playerTransform = Transform.getOrNull(engine.PlayerEntity)
    if (!playerTransform) return
    for (const portal of activePortals) {
      portal.updateProximity(playerTransform.position)
    }
  })
  proximitySystemRegistered = true
}

// ============================================
// Parallax vortex system — shared across all portals, only runs while at
// least one portal has its doors open (cheap no-op otherwise).
// ============================================

let parallaxActive = false
const parallaxLayers = new Set<Entity>()

// Rotates world-space vector (vx,vy,vz) into the local space of an entity
// with rotation (qx,qy,qz,qw) — i.e. by the inverse/conjugate of that quaternion.
function rotateByInverseQuat(
  vx: number,
  vy: number,
  vz: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number
): { x: number; y: number; z: number } {
  const cx = -qx,
    cy = -qy,
    cz = -qz
  const tx = 2 * (cy * vz - cz * vy)
  const ty = 2 * (cz * vx - cx * vz)
  const tz = 2 * (cx * vy - cy * vx)
  return {
    x: vx + qw * tx + cy * tz - cz * ty,
    y: vy + qw * ty + cz * tx - cx * tz,
    z: vz + qw * tz + cx * ty - cy * tx
  }
}

function portalParallaxSystem(dt: number) {
  if (parallaxLayers.size === 0) {
    engine.removeSystem(portalParallaxSystem)
    parallaxActive = false
    return
  }

  const cam = Transform.getOrNull(engine.CameraEntity)
  const clamp = (v: number, limit: number) => (limit > 0 ? Math.max(-limit, Math.min(limit, v)) : v)

  for (const entity of parallaxLayers) {
    if (!PortalLayerData.has(entity)) continue
    const layer = PortalLayerData.getMutable(entity)

    let targetX = 0
    let targetY = 0
    if (cam) {
      const local = rotateByInverseQuat(
        layer.baseWorldX - cam.position.x,
        layer.baseWorldY - cam.position.y,
        layer.baseWorldZ - cam.position.z,
        layer.portalRotX,
        layer.portalRotY,
        layer.portalRotZ,
        layer.portalRotW
      )
      targetX = clamp(local.x * layer.parallaxStrength, layer.parallaxLimit)
      targetY = clamp(local.y * layer.parallaxStrength, layer.parallaxLimit * 1.3)
    }

    const factor = Math.min(layer.lerpSpeed * dt, 1)
    layer.currentOffsetX += (targetX - layer.currentOffsetX) * factor
    layer.currentOffsetY += (targetY - layer.currentOffsetY) * factor

    Transform.getMutable(entity).position = Vector3.create(
      layer.baseLocalX + layer.currentOffsetX,
      layer.baseLocalY + layer.currentOffsetY,
      layer.localZ
    )

    if (cam && layer.distanceScaleFactor > 0) {
      const dx = cam.position.x - layer.baseWorldX
      const dy = cam.position.y - layer.baseWorldY
      const dz = cam.position.z - layer.baseWorldZ
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const scaleMod = (DIST_REFERENCE - dist) * layer.distanceScaleFactor
      const newScale = Math.max(0.01, layer.baseScale * (1 + scaleMod))
      Transform.getMutable(entity).scale = Vector3.create(newScale, newScale, newScale)
    }
  }
}

function activateParallax() {
  if (parallaxActive) return
  engine.addSystem(portalParallaxSystem)
  parallaxActive = true
}

// Plain (non-synced) component just to carry per-layer parallax state — this
// project's other components use validateBeforeChange()/syncEntity() for
// server-authoritative state, but portals are a client-only decorative
// feature with nothing to keep consistent across peers, so this is local.
const PortalLayerData = engine.defineComponent('portal-layer-data', {
  baseWorldX: Schemas.Number,
  baseWorldY: Schemas.Number,
  baseWorldZ: Schemas.Number,
  baseLocalX: Schemas.Number,
  baseLocalY: Schemas.Number,
  localZ: Schemas.Number,
  parallaxStrength: Schemas.Number,
  parallaxLimit: Schemas.Number,
  lerpSpeed: Schemas.Number,
  currentOffsetX: Schemas.Number,
  currentOffsetY: Schemas.Number,
  baseScale: Schemas.Number,
  distanceScaleFactor: Schemas.Number,
  portalRotX: Schemas.Number,
  portalRotY: Schemas.Number,
  portalRotZ: Schemas.Number,
  portalRotW: Schemas.Number
})

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ============================================
// Portal class
// ============================================

export class Portal {
  private readonly root: Entity
  private readonly portalBody: Entity
  private readonly frame: Entity
  private readonly frameArrows: Entity
  private readonly doorLeft: Entity
  private readonly doorRight: Entity
  private readonly clicker: Entity
  private readonly layers: Entity[] = []
  private readonly infoCard: Entity
  private readonly infoLabel: Entity
  private readonly thumbPlane: Entity
  private isOpen = false
  private options: PortalOptions

  constructor(options: PortalOptions) {
    this.options = options
    this.root = engine.addEntity()
    this.portalBody = engine.addEntity()
    this.frame = engine.addEntity()
    this.frameArrows = engine.addEntity()
    this.clicker = engine.addEntity()
    this.infoCard = engine.addEntity()
    this.infoLabel = engine.addEntity()
    this.thumbPlane = engine.addEntity()

    Transform.create(this.frame, {
      position: Vector3.create(FRAME_OFFSET.x, FRAME_OFFSET.y, FRAME_OFFSET.z),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
      parent: this.portalBody
    })
    // Visible mesh doubles as a physics collider so players can't walk through the arch.
    GltfContainer.create(this.frame, {
      src: FRAME_SRC,
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
      invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
    })

    Transform.create(this.frameArrows, {
      position: Vector3.create(FRAME_OFFSET.x, FRAME_OFFSET.y, FRAME_OFFSET.z),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
      parent: this.portalBody
    })
    GltfContainer.create(this.frameArrows, { src: FRAME_ARROWS_SRC })

    this.doorLeft = this.createDoor(-DOOR_SEPARATION, DOOR_SCALE, DOOR_SCALE)
    this.doorRight = this.createDoor(DOOR_SEPARATION, -DOOR_SCALE, DOOR_SCALE)

    // Orange point light between the doors and the first vortex layer.
    const portalLight = engine.addEntity()
    Transform.create(portalLight, { position: Vector3.create(0, 0, 0.2), parent: this.portalBody })
    LightSource.create(portalLight, {
      type: LightSource.Type.Point({}),
      color: Color3.create(1, 0.4, 0.05),
      intensity: 10000
    })

    // Concentric vortex layers.
    const rot = options.rotation ?? { x: 0, y: 0, z: 0 }
    const rotQ = Quaternion.fromEulerDegrees(rot.x, rot.y, rot.z)
    const size = options.size ?? 1
    for (let i = 0; i < LAYER_COUNT; i++) {
      const entity = engine.addEntity()
      const t = i / (LAYER_COUNT - 1) // 0 (outer) -> 1 (inner)
      const tC = Math.pow(t, SCALE_CURVE)
      const scale = 3 * LAYER_SCALE * (1 - tC * (1 - SCALE_MIN))
      const localZ = FRAME_OFFSET.z + LAYER_Z_OFFSET + i * LAYER_GAP
      const localY = FRAME_OFFSET.y + i * LAYER_Y_STEP

      Transform.create(entity, {
        position: Vector3.create(FRAME_OFFSET.x, localY, localZ),
        rotation: Quaternion.Identity(),
        scale: Vector3.create(scale, scale, scale),
        parent: this.portalBody
      })
      GltfContainer.create(entity, { src: LAYER_SRC })
      PortalLayerData.create(entity, {
        baseWorldX: options.position.x,
        baseWorldY: options.position.y + PORTAL_CENTER_Y_OFFSET * size,
        baseWorldZ: options.position.z,
        baseLocalX: FRAME_OFFSET.x,
        baseLocalY: localY,
        localZ,
        parallaxStrength: -t * MAX_PARALLAX,
        parallaxLimit: t * MAX_LIMIT,
        lerpSpeed: LERP_SPEED_OUTER + t * (LERP_SPEED_INNER - LERP_SPEED_OUTER),
        currentOffsetX: 0,
        currentOffsetY: 0,
        baseScale: scale,
        distanceScaleFactor: DIST_SCALE_OUTER + t * (DIST_SCALE_INNER - DIST_SCALE_OUTER),
        portalRotX: rotQ.x,
        portalRotY: rotQ.y,
        portalRotZ: rotQ.z,
        portalRotW: rotQ.w
      })
      this.layers.push(entity)
    }

    // Info card — title + thumbnail, floating above the portal.
    Transform.create(this.infoCard, {
      position: INFO_CARD_POS,
      rotation: Quaternion.fromEulerDegrees(INFO_CARD_TILT, 0, 0),
      scale: INFO_CARD_SCALE,
      parent: this.root
    })
    const infoBg = engine.addEntity()
    Transform.create(infoBg, {
      position: Vector3.create(0, -0.35, 0.02),
      rotation: Quaternion.Identity(),
      scale: Vector3.One(),
      parent: this.infoCard
    })
    GltfContainer.create(infoBg, { src: INFO_BG_SRC })

    Transform.create(this.thumbPlane, {
      position: Vector3.create(0, 0.55, 0.01),
      scale: Vector3.create(1.5, 1.5, 1),
      parent: this.infoCard
    })

    Transform.create(this.infoLabel, { position: Vector3.create(0, -0.55, 0.01), parent: this.infoCard })

    // Clicker — invisible box over the doorway, activates the portal.
    Transform.create(this.clicker, {
      position: Vector3.create(CLICK_POS.x, CLICK_POS.y, CLICK_POS.z),
      scale: Vector3.create(CLICK_SCALE.x, CLICK_SCALE.y, CLICK_SCALE.z),
      parent: this.portalBody
    })
    MeshCollider.setBox(this.clicker, ColliderLayer.CL_POINTER)
    if (options.onActivate) {
      pointerEventsSystem.onPointerDown(
        {
          entity: this.clicker,
          opts: {
            button: InputAction.IA_POINTER,
            hoverText: options.hoverText ?? 'Enter portal',
            maxDistance: CLICK_MAX_DISTANCE
          }
        },
        () => options.onActivate?.()
      )
    }

    activePortals.add(this)
    ensureProximitySystem()

    this.applyTransform()
    this.applyInfo()
  }

  private createDoor(x: number, scaleX: number, scaleYZ: number): Entity {
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(x, DOOR_OFFSET_Y, DOOR_OFFSET_Z),
      rotation: Quaternion.Identity(),
      scale: Vector3.create(scaleX, scaleYZ, scaleYZ),
      parent: this.portalBody
    })
    GltfContainer.create(entity, {
      src: DOOR_SRC,
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
      invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
    })
    return entity
  }

  // Repositions the portal in place (e.g. it needs to follow a moving
  // platform) without recreating any entities. Cheap enough to call every
  // frame — unlike updateInfo(), it doesn't touch TextShape/GltfContainer.
  update(position: PortalOptions['position'], rotation?: PortalOptions['rotation'], size?: number) {
    this.options = { ...this.options, position, rotation, size: size ?? this.options.size }
    this.applyTransform()
  }

  // Changes name/thumbnail. Not called per-frame in this project (both
  // portals have fixed titles), but kept separate from update() since it
  // touches TextShape/GltfContainer — unnecessary churn if called every tick.
  updateInfo(name?: string, thumbnail?: string) {
    this.options = { ...this.options, name: name ?? this.options.name, thumbnail: thumbnail ?? this.options.thumbnail }
    this.applyInfo()
  }

  // Hides/shows the whole portal. Used to keep it out of sight at its
  // placeholder constructor position until the caller has repositioned it
  // to the real (tower-height-dependent) win-zone spot via update().
  setVisible(visible: boolean) {
    VisibilityComponent.createOrReplace(this.root, { visible })
  }

  private applyTransform() {
    const { position, rotation, size } = this.options
    const s = size ?? 1
    const rotQ = rotation ? Quaternion.fromEulerDegrees(rotation.x, rotation.y, rotation.z) : Quaternion.Identity()

    Transform.createOrReplace(this.root, {
      position: Vector3.create(position.x, position.y, position.z),
      rotation: rotQ,
      scale: Vector3.One()
    })
    Transform.createOrReplace(this.portalBody, {
      position: Vector3.create(0, -FRAME_OFFSET.y * s, 0),
      rotation: Quaternion.Identity(),
      scale: Vector3.create(s, s, s),
      parent: this.root
    })

    for (const entity of this.layers) {
      if (!PortalLayerData.has(entity)) continue
      const layer = PortalLayerData.getMutable(entity)
      layer.baseWorldX = position.x
      layer.baseWorldY = position.y + PORTAL_CENTER_Y_OFFSET * s
      layer.baseWorldZ = position.z
      layer.portalRotX = rotQ.x
      layer.portalRotY = rotQ.y
      layer.portalRotZ = rotQ.z
      layer.portalRotW = rotQ.w
    }
  }

  private applyInfo() {
    const name = this.options.name ?? ''
    const chunks = name.match(/.{1,25}(\s|$)|.{1,25}/g) ?? []
    const wrapped =
      chunks.length > 2 ? chunks[0]!.trimEnd() + '\n' + chunks[1]!.trimEnd().slice(0, 22) + '...' : chunks.join('\n').trimEnd()

    TextShape.createOrReplace(this.infoLabel, {
      text: wrapped,
      fontSize: 2.2,
      textColor: Color4.Black()
    })

    if (this.options.thumbnail) {
      GltfContainer.createOrReplace(this.thumbPlane, { src: INFO_THUMB_SRC })
      GltfNodeModifiers.createOrReplace(this.thumbPlane, {
        modifiers: [
          {
            path: '',
            material: {
              material: {
                $case: 'unlit',
                unlit: { texture: Material.Texture.Common({ src: this.options.thumbnail }), castShadows: false }
              }
            }
          }
        ]
      })
    } else {
      GltfContainer.deleteFrom(this.thumbPlane)
    }
  }

  updateProximity(playerPosition: { x: number; y: number; z: number }) {
    const dist = distance(playerPosition, Transform.get(this.root).position)
    if (!this.isOpen && dist <= DOOR_OPEN_DIST) {
      this.setOpen(true)
    } else if (this.isOpen && dist >= DOOR_CLOSE_DIST) {
      this.setOpen(false)
    }
  }

  private setOpen(open: boolean) {
    if (this.isOpen === open) return
    this.isOpen = open

    const leftTarget = Quaternion.fromEulerDegrees(0, open ? DOOR_OPEN_ANGLE : 0, 0)
    const rightTarget = Quaternion.fromEulerDegrees(0, open ? -DOOR_OPEN_ANGLE : 0, 0)
    Tween.createOrReplace(this.doorLeft, {
      mode: Tween.Mode.Rotate({ start: Transform.get(this.doorLeft).rotation, end: leftTarget }),
      duration: DOOR_TWEEN_MS,
      easingFunction: EasingFunction.EF_EASEOUTQUAD
    })
    Tween.createOrReplace(this.doorRight, {
      mode: Tween.Mode.Rotate({ start: Transform.get(this.doorRight).rotation, end: rightTarget }),
      duration: DOOR_TWEEN_MS,
      easingFunction: EasingFunction.EF_EASEOUTQUAD
    })

    if (open) {
      for (const entity of this.layers) parallaxLayers.add(entity)
      activateParallax()
    } else {
      for (const entity of this.layers) parallaxLayers.delete(entity)
    }
  }
}
