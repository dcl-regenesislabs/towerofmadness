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
import { EntityNames } from '../assets/scene/entity-names'
import { LeaderboardEntry } from './multiplayer'
import { createLeaderboardPanel, setTabData } from './LeaderboardPanel'

const LEADERBOARD_TEXT_OFFSET = Vector3.create(1.6, 5.5, 0.8)
const LEADERBOARD_TEXT_ROTATION = Quaternion.fromEulerDegrees(0, 180, 0)
const LEADERBOARD_TEXT_SCALE = Vector3.create(1.2, 1.2, 1)
const LEADERBOARD_NAME_WIDTH = 10
const LEADERBOARD_HEADER_GAP = 4
const LEADERBOARD_HEADER_BODY_GAP = 0.65

export function setupWorldLeaderboard(
  getEntries: () => LeaderboardEntry[],
  getWeeklyEntries?: () => LeaderboardEntry[]
) {
  let worldLeaderboardTextEntity: Entity | null = null
  let worldLeaderboardHeaderEntity: Entity | null = null
  let worldLeaderboardSetupDone = false
  let lastWorldLeaderboardText = ''
  let leaderboardPanel: ReturnType<typeof createLeaderboardPanel> | null = null
  let lastHistoricKey = ''
  let lastWeeklyKey = ''

  function findLeaderboardEntity(): Entity | null {
    const byName = engine.getEntityOrNullByName(EntityNames.LeaderBoard01_glb)
    if (byName) return byName
    for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
      const src = GltfContainer.get(entity).src
      if (src && src.includes('LeaderBoard01')) return entity
    }
    return null
  }

  function formatLeaderboardHeader(): string {
    const gap = ' '.repeat(LEADERBOARD_HEADER_GAP)
    return `   ${'Player'.padEnd(LEADERBOARD_NAME_WIDTH)}${gap}Time`
  }

  function formatLeaderboardText(entries: LeaderboardEntry[]): string {
    const finishedEntries = entries
      .filter((player) => player.allTimeFinishCount > 0 && player.allTimeBestTime > 0)
      .sort((a, b) => a.allTimeBestTime - b.allTimeBestTime)
      .slice(0, 10)

    if (finishedEntries.length === 0) {
      return `No entries yet`
    }

    const lines = finishedEntries.map((player, index) => {
      const rank = `${index + 1}.`.padEnd(3)
      const name = player.displayName.length > LEADERBOARD_NAME_WIDTH
        ? player.displayName.substring(0, LEADERBOARD_NAME_WIDTH) + '..'
        : player.displayName

      const namePadded = name.padEnd(LEADERBOARD_NAME_WIDTH)

      const hasFinished = player.allTimeFinishCount > 0
      const statsDisplay = hasFinished
        ? `${player.allTimeBestTime.toFixed(2)}s`
        : `--`

      return `${rank} ${namePadded}  ${statsDisplay}`
    })

    return lines.join('\n')
  }

  function setupWorldLeaderboardText(entity: Entity) {
    worldLeaderboardSetupDone = true
    worldLeaderboardHeaderEntity = engine.addEntity()
    worldLeaderboardTextEntity = engine.addEntity()

    Transform.create(worldLeaderboardHeaderEntity, {
      parent: entity,
      position: LEADERBOARD_TEXT_OFFSET,
      rotation: LEADERBOARD_TEXT_ROTATION,
      scale: LEADERBOARD_TEXT_SCALE
    })

    Transform.create(worldLeaderboardTextEntity, {
      parent: entity,
      position: Vector3.create(
        LEADERBOARD_TEXT_OFFSET.x,
        LEADERBOARD_TEXT_OFFSET.y - LEADERBOARD_HEADER_BODY_GAP,
        LEADERBOARD_TEXT_OFFSET.z
      ),
      rotation: LEADERBOARD_TEXT_ROTATION,
      scale: LEADERBOARD_TEXT_SCALE
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

    leaderboardPanel = createLeaderboardPanel({
      parent: entity,
      transform: {
        position: Vector3.create(0, 3.1, 0.7),
        rotation: LEADERBOARD_TEXT_ROTATION,
        scale: Vector3.create(1, 1, 1)
      }
    })
  }

  function buildHistoricTabData(entries: LeaderboardEntry[]) {
    const finishedEntries = entries
      .filter((player) => player.allTimeFinishCount > 0 && player.allTimeBestTime > 0)
      .sort((a, b) => a.allTimeBestTime - b.allTimeBestTime)
      .slice(0, 10)

    return finishedEntries.map((player) => ({
      name: player.displayName,
      time: `${player.allTimeBestTime.toFixed(2)}s`
    }))
  }

  function buildWeeklyTabData(entries: LeaderboardEntry[]) {
    const finishedEntries = entries
      .filter((player) => player.weeklyFinishCount > 0 && player.weeklyBestTime > 0)
      .sort((a, b) => a.weeklyBestTime - b.weeklyBestTime)
      .slice(0, 10)

    return finishedEntries.map((player) => ({
      name: player.displayName,
      time: `${player.weeklyBestTime.toFixed(2)}s`
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
      const historicKey = historicData.map((e) => `${e.name}:${e.time}`).join('|')
      if (historicKey !== lastHistoricKey) {
        lastHistoricKey = historicKey
        setTabData(leaderboardPanel, 0, historicData)
      }

      const weeklyEntries = getWeeklyEntries ? getWeeklyEntries() : []
      const weeklyData = buildWeeklyTabData(weeklyEntries)
      const weeklyKey = weeklyData.map((e) => `${e.name}:${e.time}`).join('|')
      if (weeklyKey !== lastWeeklyKey) {
        lastWeeklyKey = weeklyKey
        setTabData(leaderboardPanel, 1, weeklyData)
      }
    }
  }, undefined, 'world-leaderboard-text-system')
}
