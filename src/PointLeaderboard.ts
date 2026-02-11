import {
  engine,
  Entity,
  GltfContainer,
  Transform,
  TextShape,
  TextAlignMode,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math'
import { PointLeaderboardEntry } from './multiplayer'
import { createPointLeaderboardPanel, setPointTabData } from './PointLeaderboardPanel'

const POINT_LEADERBOARD_TEXT_OFFSET = Vector3.create(1.6, 5.5, 0.8)
const POINT_LEADERBOARD_TEXT_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const POINT_LEADERBOARD_TEXT_SCALE = Vector3.create(1.2, 1.2, 1)
const POINT_LEADERBOARD_NAME_WIDTH = 10
const POINT_LEADERBOARD_HEADER_GAP = 3
const POINT_LEADERBOARD_HEADER_BODY_GAP = 0.65

export function setupWorldPointLeaderboard(
  getEntries: () => PointLeaderboardEntry[],
  getWeeklyEntries?: () => PointLeaderboardEntry[]
) {
  let worldLeaderboardTextEntity: Entity | null = null
  let worldLeaderboardHeaderEntity: Entity | null = null
  let worldLeaderboardSetupDone = false
  let lastWorldLeaderboardText = ''
  let leaderboardPanel: ReturnType<typeof createPointLeaderboardPanel> | null = null
  let lastHistoricKey = ''
  let lastWeeklyKey = ''

  function findLeaderboardEntity(): Entity | null {
    const byName = engine.getEntityOrNullByName('LeaderBoard02.glb')
    if (byName) return byName

    const byNameDuplicate = engine.getEntityOrNullByName('LeaderBoard01.glb_2')
    if (byNameDuplicate) return byNameDuplicate

    for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
      const src = GltfContainer.get(entity).src
      if (src && src.includes('LeaderBoard02')) return entity
    }
    return null
  }

  function formatLeaderboardHeader(): string {
    const gap = ' '.repeat(POINT_LEADERBOARD_HEADER_GAP)
    return `   ${'Player'.padEnd(POINT_LEADERBOARD_NAME_WIDTH)}${gap}Pts`
  }

  function formatLeaderboardText(entries: PointLeaderboardEntry[]): string {
    const topEntries = entries
      .filter((player) => player.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)

    if (topEntries.length === 0) {
      return 'No entries yet'
    }

    const lines = topEntries.map((player, index) => {
      const rank = `${index + 1}.`.padEnd(3)
      const name = player.displayName.length > POINT_LEADERBOARD_NAME_WIDTH
        ? player.displayName.substring(0, POINT_LEADERBOARD_NAME_WIDTH) + '..'
        : player.displayName

      const namePadded = name.padEnd(POINT_LEADERBOARD_NAME_WIDTH)
      return `${rank} ${namePadded}  ${Math.floor(player.points)}`
    })

    return lines.join('\n')
  }

  function setupWorldLeaderboardText(entity: Entity) {
    worldLeaderboardSetupDone = true
    worldLeaderboardHeaderEntity = engine.addEntity()
    worldLeaderboardTextEntity = engine.addEntity()

    Transform.create(worldLeaderboardHeaderEntity, {
      parent: entity,
      position: POINT_LEADERBOARD_TEXT_OFFSET,
      rotation: POINT_LEADERBOARD_TEXT_ROTATION,
      scale: POINT_LEADERBOARD_TEXT_SCALE
    })

    Transform.create(worldLeaderboardTextEntity, {
      parent: entity,
      position: Vector3.create(
        POINT_LEADERBOARD_TEXT_OFFSET.x,
        POINT_LEADERBOARD_TEXT_OFFSET.y - POINT_LEADERBOARD_HEADER_BODY_GAP,
        POINT_LEADERBOARD_TEXT_OFFSET.z
      ),
      rotation: POINT_LEADERBOARD_TEXT_ROTATION,
      scale: POINT_LEADERBOARD_TEXT_SCALE
    })

    TextShape.create(worldLeaderboardHeaderEntity, {
      text: formatLeaderboardHeader(),
      fontSize: 2.6,
      textColor: Color4.White(),
      outlineColor: Color4.Black(),
      outlineWidth: 0.1,
      textAlign: TextAlignMode.TAM_TOP_LEFT
    })
    VisibilityComponent.createOrReplace(worldLeaderboardHeaderEntity, { visible: false })

    const entries = getEntries()
    TextShape.create(worldLeaderboardTextEntity, {
      text: formatLeaderboardText(entries),
      fontSize: 2.2,
      textColor: Color4.White(),
      outlineColor: Color4.Black(),
      outlineWidth: 0.1,
      textAlign: TextAlignMode.TAM_TOP_LEFT
    })
    VisibilityComponent.createOrReplace(worldLeaderboardTextEntity, { visible: false })

    leaderboardPanel = createPointLeaderboardPanel({
      parent: entity,
      transform: {
        position: Vector3.create(0, 3.1, 0.7),
        rotation: POINT_LEADERBOARD_TEXT_ROTATION,
        scale: Vector3.create(1, 1, 1)
      }
    })
  }

  function buildHistoricTabData(entries: PointLeaderboardEntry[]) {
    const topEntries = entries
      .filter((player) => player.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)

    return topEntries.map((player) => ({
      name: player.displayName,
      points: `${Math.floor(player.points)}`
    }))
  }

  function buildWeeklyTabData(entries: PointLeaderboardEntry[]) {
    const topEntries = entries
      .filter((player) => player.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)

    return topEntries.map((player) => ({
      name: player.displayName,
      points: `${Math.floor(player.points)}`
    }))
  }

  engine.addSystem(() => {
    if (!worldLeaderboardSetupDone) {
      const entity = findLeaderboardEntity()
      if (entity) setupWorldLeaderboardText(entity)
      return
    }

    if (!worldLeaderboardTextEntity || !worldLeaderboardHeaderEntity) return

    const entries = getEntries()
    const bodyText = formatLeaderboardText(entries)
    if (bodyText !== lastWorldLeaderboardText) {
      lastWorldLeaderboardText = bodyText
      TextShape.getMutable(worldLeaderboardHeaderEntity).text = formatLeaderboardHeader()
      TextShape.getMutable(worldLeaderboardTextEntity).text = bodyText
    }

    if (leaderboardPanel) {
      const historicData = buildHistoricTabData(entries)
      const historicKey = historicData.map((e) => `${e.name}:${e.points}`).join('|')
      if (historicKey !== lastHistoricKey) {
        lastHistoricKey = historicKey
        setPointTabData(leaderboardPanel, 0, historicData)
      }

      const weeklyEntries = getWeeklyEntries ? getWeeklyEntries() : []
      const weeklyData = buildWeeklyTabData(weeklyEntries)
      const weeklyKey = weeklyData.map((e) => `${e.name}:${e.points}`).join('|')
      if (weeklyKey !== lastWeeklyKey) {
        lastWeeklyKey = weeklyKey
        setPointTabData(leaderboardPanel, 1, weeklyData)
      }
    }
  }, undefined, 'world-point-leaderboard-system')
}
