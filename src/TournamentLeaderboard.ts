import {
  engine,
  Entity,
  GltfContainer,
  Transform,
  TextShape,
  TextAlignMode,
  VisibilityComponent,
  Billboard,
  BillboardMode,
  MeshRenderer,
  Material,
  MaterialTransparencyMode
} from '@dcl/sdk/ecs'
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math'

const GOLD = Color4.create(1, 0.84, 0, 1)
import { EntityNames } from '../assets/scene/entity-names'
import { createPointLeaderboardPanel, setPointTabData } from './PointLeaderboardPanel'
import { formatPlayerNameWithWallet } from './playerNames'

const TEXT_OFFSET = Vector3.create(1.6, 5.5, 0.8)
const TEXT_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const TEXT_SCALE = Vector3.create(1.2, 1.2, 1)
const NAME_WIDTH = 12
const HEADER_GAP = 3
const HEADER_BODY_GAP = 0.65

export function setupWorldTournamentLeaderboard(
  getEntries: () => { address: string; displayName: string; points: number }[]
) {
  let textEntity: Entity | null = null
  let headerEntity: Entity | null = null
  let setupDone = false
  let lastText = ''
  let leaderboardPanel: ReturnType<typeof createPointLeaderboardPanel> | null = null
  let lastTabKey = ''

  function findLeaderboardEntity(): Entity | null {
    return engine.getEntityOrNullByName(EntityNames.LeaderBoard01_glb_3) ?? null
  }

  function formatHeader(): string {
    const gap = ' '.repeat(HEADER_GAP)
    return `   ${'Player'.padEnd(NAME_WIDTH)}${gap}Pts`
  }

  function formatText(entries: { address: string; displayName: string; points: number }[]): string {
    const top = entries
      .filter((p) => p.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)

    if (top.length === 0) return 'No entries yet'

    return top
      .map((p, i) => {
        const rank = `${i + 1}.`.padEnd(3)
        const name = formatPlayerNameWithWallet(p.displayName, p.address, NAME_WIDTH).padEnd(NAME_WIDTH)
        return `${rank} ${name}  ${Math.floor(p.points)}`
      })
      .join('\n')
  }

  function buildTabData(entries: { address: string; displayName: string; points: number }[]) {
    return entries
      .filter((p) => p.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
      .map((p) => ({
        name: formatPlayerNameWithWallet(p.displayName, p.address, NAME_WIDTH),
        points: `${Math.floor(p.points)}`
      }))
  }

  function setup(entity: Entity) {
    setupDone = true
    headerEntity = engine.addEntity()
    textEntity = engine.addEntity()

    Transform.create(headerEntity, {
      parent: entity,
      position: TEXT_OFFSET,
      rotation: TEXT_ROTATION,
      scale: TEXT_SCALE
    })

    Transform.create(textEntity, {
      parent: entity,
      position: Vector3.create(TEXT_OFFSET.x, TEXT_OFFSET.y - HEADER_BODY_GAP, TEXT_OFFSET.z),
      rotation: TEXT_ROTATION,
      scale: TEXT_SCALE
    })

    TextShape.create(headerEntity, {
      text: formatHeader(),
      fontSize: 2.6,
      textColor: Color4.create(1, 0.84, 0, 1),
      outlineColor: Color4.Black(),
      outlineWidth: 0.1,
      textAlign: TextAlignMode.TAM_TOP_LEFT
    })
    VisibilityComponent.createOrReplace(headerEntity, { visible: false })

    TextShape.create(textEntity, {
      text: formatText(getEntries()),
      fontSize: 2.2,
      textColor: Color4.White(),
      outlineColor: Color4.Black(),
      outlineWidth: 0.1,
      textAlign: TextAlignMode.TAM_TOP_LEFT
    })
    VisibilityComponent.createOrReplace(textEntity, { visible: false })

    leaderboardPanel = createPointLeaderboardPanel({
      parent: entity,
      transform: {
        position: Vector3.create(0, 3.1, 0.7),
        rotation: TEXT_ROTATION,
        scale: Vector3.create(1, 1, 1)
      },
      tabs: ['TOURNAMENT'],
      accentColor: GOLD
    })

    const trophy = engine.addEntity()
    Transform.create(trophy, {
      parent: entity,
      position: Vector3.create(0, 8.8, 0.7),
      scale: Vector3.create(2.2, 2.2, 1)
    })
    MeshRenderer.setPlane(trophy)
    Material.setBasicMaterial(trophy, {
      texture: Material.Texture.Common({ src: 'assets/images/trophy.png' }),
      alphaTexture: Material.Texture.Common({ src: 'assets/images/trophy.png' }),
      diffuseColor: Color4.White(),
      alphaTest: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    Billboard.create(trophy, { billboardMode: BillboardMode.BM_Y })
  }

  engine.addSystem(() => {
    if (!setupDone) {
      const entity = findLeaderboardEntity()
      if (entity) setup(entity)
      return
    }

    if (!textEntity || !headerEntity) return

    const entries = getEntries()
    const body = formatText(entries)
    if (body !== lastText) {
      lastText = body
      TextShape.getMutable(headerEntity).text = formatHeader()
      TextShape.getMutable(textEntity).text = body
    }

    if (leaderboardPanel) {
      const tabData = buildTabData(entries)
      const tabKey = tabData.map((e) => `${e.name}:${e.points}`).join('|')
      if (tabKey !== lastTabKey) {
        lastTabKey = tabKey
        setPointTabData(leaderboardPanel, 0, tabData)
      }
    }
  }, undefined, 'world-tournament-leaderboard-system')
}
