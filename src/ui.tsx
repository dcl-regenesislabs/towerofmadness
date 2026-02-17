import ReactEcs, { UiEntity, ReactEcsRenderer } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { engine, UiCanvasInformation, PlayerIdentityData } from "@dcl/sdk/ecs"

// UI Scaling based on screen resolution (reference: 1920x1080)
function getScaleUIFactor(): number {
  const uiCanvasInfo = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!uiCanvasInfo) return 1

  return Math.min(uiCanvasInfo.width / 1920, uiCanvasInfo.height / 1080)
}

function isMobileScreen(): boolean {
  const uiCanvasInfo = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!uiCanvasInfo) return false

  return Math.min(uiCanvasInfo.width, uiCanvasInfo.height) <= 800
}
import {
  playerHeight,
  playerMaxHeight,
  attemptState,
  AttemptState,
  attemptTimer,
  bestAttemptTime,
  bestAttemptHeight,
  attemptResult,
  resultMessage,
  resultTimestamp,
  startMessageTimestamp,
  roundPhase,
  roundTimer,
  roundSpeedMultiplier,
  leaderboard,
  roundWinners,
  isConnectedToServer,
  isSynced,
  towerConfig
} from "./index"
import {
  RoundPhase,
  WinnerEntry,
  getTimeSyncOffset,
  isTimeSyncReady,
  getLocalPlayerHeights,
  formatTime,
  getTowerChunksFromEntities
} from "./multiplayer"
import { getSnapshots } from "./snapshots"
import { OutlinedText, OUTLINE_OFFSETS_16, OUTLINE_OFFSETS_8 } from "./outlinedTextComponent"

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(GameUI)
}

// Chunk colors for tower progress bar
const CHUNK_COLORS: Record<string, Color4> = {
  'ChunkStart': Color4.create(0.7, 0.5, 0.8, 1),  // Purple (base)
  'Chunk01': Color4.create(0.2, 0.8, 0.2, 1),  // Green
  'Chunk02': Color4.create(0.85, 0.75, 0.4, 1),  // Yellow/Tan
  'Chunk03': Color4.create(0.9, 0.9, 0.9, 1),  // White
  'ChunkEnd': Color4.create(1.0, 0.84, 0.0, 1) // Gold (finish) 
}

function getTrophyUvsByRank(index: number): number[] {
  // UV order: bottom-left, top-left, top-right, bottom-right
  if (index === 0) return [0.0, 0.0, 0.0, 1.0, 0.31, 1.0, 0.31, 0.0] // Gold
  if (index === 1) return [0.335, 0.0, 0.335, 1.0, 0.665, 1.0, 0.665, 0.0] // Silver
  return [0.69, 0.0, 0.69, 1.0, 1.0, 1.0, 1.0, 0.0] // Bronze
}

function getWinnerFontSize(index: number): number {
  if (index === 0) return 25
  if (index === 1) return 23
  return 22
}

function getWinnerTextColor(index: number, hasEntry: boolean, fallbackColor: Color4): Color4 {
  if (!hasEntry) return Color4.create(0.72, 0.76, 0.85, 1)
  if (index === 0) return Color4.create(1, 0.84, 0, 1) // Gold
  if (index === 1) return Color4.create(0.85, 0.88, 0.94, 1) // Silver
  if (index === 2) return Color4.create(0.8, 0.55, 0.35, 1) // Bronze
  return fallbackColor
}

// Tower Progress Bar Component
const TowerProgressBar = () => { 
  const s = getScaleUIFactor()
  const uiCanvasInfo = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screenWidth = uiCanvasInfo?.width ?? 1920 * s
  const snapshots = getSnapshots()
  const snapshotByWallet = new Map(
    snapshots.map((entry) => [entry.wallet.toLowerCase(), entry.snapshotUrl])
  )
  const localWallet = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase() ?? ''

  // Get chunks directly from synced entities for accurate colors
  const chunkIds = getTowerChunksFromEntities()

  if (chunkIds.length <= 1) {
    // Only ChunkStart or empty - no tower visible yet
    return null
  }

  const BAR_WIDTH = 980 * s
  const BAR_HEIGHT = 52 * s
  const PLAYER_MARKER_SIZE = 44 * s

  // Use towerConfig for total height, fall back to calculation
  const totalHeight = towerConfig?.totalHeight || (chunkIds.length * 10.821)

  // Calculate segment height for each chunk
  const segmentWidth = (BAR_WIDTH - 4 * s) / chunkIds.length

  // Calculate player position as percentage of tower
  const getPlayerXPosition = (height: number): number => {
    const clampedHeight = Math.max(0, Math.min(height, totalHeight))
    return (clampedHeight / totalHeight) * BAR_WIDTH
  }

  return (
    <UiEntity
      uiTransform={{
        width: BAR_WIDTH,
        height: BAR_HEIGHT,
        positionType: 'absolute',
        position: { top: 130 * s, left: (screenWidth - BAR_WIDTH) / 2 },
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start'
      }}
    >
      {/* Tower bar */}
      <UiEntity
        uiTransform={{ 
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          padding: { left: 1 * s, right: 1 * s, top: 2 * s, bottom: 2 * s }
        }}
        uiBackground={{
          color: Color4.create(0, 0, 0, 0) 
        }}
      >
        <UiEntity
          uiTransform={{
            width: BAR_WIDTH - 4 * s,
            height: BAR_HEIGHT - 4 * s,
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: (BAR_HEIGHT - 4 * s) / 2,
            overflow: 'hidden'
          }}
          uiBackground={{
            color: Color4.create(0.1, 0.1, 0.1, 0.9)
          }}
        >
          {/* Chunk segments */}
          {[...chunkIds].map((chunkId, index) => {
            const color = CHUNK_COLORS[chunkId] || Color4.Gray()
            return (
            <UiEntity
              key={`chunk-${index}`}
              uiTransform={{
                width: segmentWidth,
                height: BAR_HEIGHT - 4 * s
              }}
              uiBackground={{
                color: color
              }}
            />
            )
          })}
        </UiEntity>
      </UiEntity>

      {/* Border overlay */}
      <UiEntity
        uiTransform={{
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          borderColor: Color4.Black(),
          borderWidth: 3 * s,
          borderRadius: BAR_HEIGHT / 2
        }}
        uiBackground={{
          color: Color4.create(0, 0, 0, 0)
        }}
      />

      {/* Player indicators inside bar */}
      {getLocalPlayerHeights(false).slice(0, 12).map((player, index) => {
        const xPos = getPlayerXPosition(player.height)
        const wallet = player.address?.toLowerCase() ?? ''
        const snapshotUrl = snapshotByWallet.get(wallet) ?? null
        const isLocal = wallet && wallet === localWallet

        return (
          <UiEntity
            key={`player-${index}`}
            uiTransform={{
              width: PLAYER_MARKER_SIZE,
              height: PLAYER_MARKER_SIZE,
              positionType: 'absolute',
              position: {
                left: Math.max(0, Math.min(BAR_WIDTH - PLAYER_MARKER_SIZE, xPos)),
                top: (BAR_HEIGHT - PLAYER_MARKER_SIZE) / 2
              }
            }}
            uiBackground={{
              color: Color4.create(1, 1, 1, 0)
            }}
          >
            <UiEntity
              uiTransform={{
                width: PLAYER_MARKER_SIZE - 4 * s,
                height: PLAYER_MARKER_SIZE - 4 * s,
                positionType: 'absolute',
                position: { left: 2 * s, top: 2 * s }
              }}
              uiBackground={
                snapshotUrl
                  ? {
                      color: Color4.White(),
                      texture: { src: snapshotUrl },
                      textureMode: 'stretch'
                    }
                  : { color: Color4.create(0.2, 0.2, 0.2, 0.9) }
              }
            />

            {isLocal && (
              <UiEntity
                uiTransform={{
                  width: 4 * s,
                  height: BAR_HEIGHT + 8 * s,
                  positionType: 'absolute',
                  position: { left: PLAYER_MARKER_SIZE + 2 * s, top: -(BAR_HEIGHT / 2) + (PLAYER_MARKER_SIZE / 2) - 4 * s }
                }}
                uiBackground={{
                  color: Color4.White()
                }}
              >
                <UiEntity
                  uiTransform={{
                    width: 4 * s,
                    height: BAR_HEIGHT + 8 * s,
                    positionType: 'absolute',
                    position: { left: 0, top: 0 },
                    borderColor: Color4.Black(),
                    borderWidth: 1 * s
                  }}
                  uiBackground={{
                    color: Color4.create(0, 0, 0, 0)
                  }}
                />
              </UiEntity>
            )}
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

const GameUI = () => {
  const s = getScaleUIFactor()
  const isMobile = isMobileScreen()
  const mobileBoostScale = s * (isMobile ? 3 : 1)
  const startMessageScale = isMobile ? 3 : 1
  const uiCanvasInfo = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screenWidth = uiCanvasInfo?.width ?? 1920 * s
  const localPlayerAddress = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase() ?? ''
  const playerInfoWidth = 260 * s
  const startMessageWidth = 260 * s
  const startMessageGap = 96 * s

  // Format time with milliseconds
  const formatTimeMs = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  const isAttemptActive = attemptState === AttemptState.IN_PROGRESS
  const isRoundActive = roundPhase === RoundPhase.ACTIVE
  const showPlayerHeightUi = false
  const showPersonalBestUi = false
  const showLeaderboardUi = false

  // Show result for 5 seconds
  const timeSinceResult = resultTimestamp > 0 ? (Date.now() - resultTimestamp) / 1000 : 999
  const showResult = attemptResult && timeSinceResult < 5
  const isDeathResult = attemptResult === 'DEATH'
  const deathShakeActive = isDeathResult && timeSinceResult < 5
  const deathShakeX = deathShakeActive ? Math.sin(timeSinceResult * 24) * 6 * mobileBoostScale : 0
  const deathShakeY = deathShakeActive ? Math.cos(timeSinceResult * 28) * 6 * mobileBoostScale : 0
  const timeSinceStartMessage = startMessageTimestamp > 0 ? (Date.now() - startMessageTimestamp) / 1000 : 999
  const showStartMessage = attemptState === AttemptState.IN_PROGRESS && timeSinceStartMessage < 4

  const winnersToDisplay = roundWinners

  // Show winners display
  const showWinners = (roundPhase === RoundPhase.ENDING || roundPhase === RoundPhase.BREAK) && winnersToDisplay.length > 0
  const topWinnerSlots: Array<WinnerEntry | null> = [0, 1, 2].map((index) => winnersToDisplay[index] ?? null)
  const localWinner = winnersToDisplay.find((winner) => winner.address?.toLowerCase() === localPlayerAddress)
  const localBoardEntry = leaderboard.find((entry) => entry.address?.toLowerCase() === localPlayerAddress)
  const localPlacementText = localWinner
    ? `You placed #${localWinner.rank > 0 ? localWinner.rank : winnersToDisplay.findIndex((w) => w.address === localWinner.address) + 1} - ${localWinner.time > 0 ? formatTimeMs(localWinner.time) : `${localWinner.height.toFixed(2)}m`}`
    : localBoardEntry && localBoardEntry.finishOrder > 0
      ? `You placed #${localBoardEntry.finishOrder} - ${localBoardEntry.bestTime > 0 ? formatTimeMs(localBoardEntry.bestTime) : `${localBoardEntry.maxHeight.toFixed(2)}m`}`
      : 'You did not finish this round'
  const nextRoundSeconds = Math.max(0, Math.ceil(roundTimer))

  // Show loading screen while connecting
  if (!isConnectedToServer) {
    const syncStatus = isSynced()
    const statusText = !syncStatus
      ? 'Synchronizing state...'
      : 'Waiting for server...'

    return (
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{
            width: 400 * s,
            height: 150 * s,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0.1, 0.1, 0.15, 0.95)
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 50 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'TOWER OF MADNESS',
              fontSize: 32 * s,
              color: Color4.Yellow(),
              textAlign: 'middle-center'
            }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 40 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: statusText,
              fontSize: 20 * s,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      </UiEntity>
    )
  }

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute'
      }}
    >
      {/* ROUND TIMER - Top Center */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 100 * s,
          positionType: 'absolute',
          position: { top: 15 * s, left: 0 },
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{
            width: 360 * s,
            height: 90 * s,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            positionType: 'relative'
          }}
        >
          {/* Round Timer - BIG */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 80 * s,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row'
            }}
          >
            <UiEntity
              uiTransform={{
                width: 280 * s,
                height: 80 * s,
                alignItems: 'center',
                justifyContent: 'center',
                positionType: 'relative'
              }}
            >
              <OutlinedText
                outlineKeyPrefix="timer-outline"
                outlineOffsets={OUTLINE_OFFSETS_16}
                outlineScale={s}
                uiTransform={{
                  width: '100%',
                  height: '100%',
                  positionType: 'absolute',
                  position: { left: 0, top: 0 },
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: `${formatTime(roundTimer)}`,
                  fontSize: 80 * s,
                  color: roundTimer <= 60
                    ? Color4.create(0.6, 0.0, 0.15, 1)
                    : Color4.White(),
                  textAlign: 'middle-center'
                }}
              />
            </UiEntity>

            {/* Speed Multiplier (if active) */}
            {roundSpeedMultiplier > 1 && (
              <UiEntity
                uiTransform={{
                  width: 80 * s,
                  height: 25 * s,
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: { left: 8 * s }
                }}
                uiText={{
                  value: `x${roundSpeedMultiplier.toFixed(0)} SPEED!`,
                  fontSize: 18 * s,
                  color: Color4.Yellow(),
                  textAlign: 'middle-center'
                }}
              />
            )}
          </UiEntity>

          {/* Round Status */}
          {!isRoundActive && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 25 * s,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: roundPhase === RoundPhase.ENDING ? 'ROUND ENDED' : 'NEXT ROUND SOON',
                fontSize: 14 * s,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
          )}
        </UiEntity>
      </UiEntity>

      {/* PLAYER INFO - Below Round Timer */}
      {showPlayerHeightUi && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 120 * s,
            positionType: 'absolute',
            position: { top: 185 * s, left: 0 },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 260 * s,
              height: isAttemptActive ? 110 * s : 70 * s,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column'
            }}
            uiBackground={{
              color: Color4.create(0, 0, 0, 0.8)
            }}
          >
            {/* Current Height */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 35 * s,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `Height: ${playerHeight.toFixed(1)}m`,
                fontSize: 22 * s,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />

            {/* Attempt Timer (only during attempt) */}
            {isAttemptActive && (
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 35 * s,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: `Attempt: ${formatTimeMs(attemptTimer)}`,
                  fontSize: 20 * s,
                  color: Color4.create(0.5, 0.8, 1, 1),
                  textAlign: 'middle-center'
                }}
              />
            )}

            {/* Max Height (only during attempt) */}
            {isAttemptActive && (
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 30 * s,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: `Max: ${playerMaxHeight.toFixed(1)}m`,
                  fontSize: 16 * s,
                  color: Color4.Yellow(),
                  textAlign: 'middle-center'
                }}
              />
            )}
          </UiEntity>
        </UiEntity>
      )}

      {/* PERSONAL BEST - Top Right */}
      {showPersonalBestUi && (
        <UiEntity
          uiTransform={{
            width: 220 * s,
            height: 100 * s,
            positionType: 'absolute',
            position: { top: 15 * s, right: 15 * s },
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.8)
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 30 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'PERSONAL BEST',
              fontSize: 14 * s,
              color: Color4.Yellow(),
              textAlign: 'middle-center'
            }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 30 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `Time: ${bestAttemptTime > 0 ? formatTimeMs(bestAttemptTime) : '--:--.--'}`,
              fontSize: 16 * s,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 30 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `Height: ${bestAttemptHeight > 0 ? bestAttemptHeight.toFixed(1) + 'm' : '--'}`,
              fontSize: 16 * s,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      )}

      {/* LEADERBOARD - Left Side */}
      {showLeaderboardUi && leaderboard.length > 0 && (
        <UiEntity
          uiTransform={{
            width: 230 * s,
            height: Math.min(350 * s, (45 + leaderboard.length * 28) * s),
            positionType: 'absolute',
            position: { top: '35%', left: 120 * s },
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.85)
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 35 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `LEADERBOARD`,
              fontSize: 16 * s,
              color: Color4.Yellow(),
              textAlign: 'middle-center'
            }}
          />

          {leaderboard.slice(0, 10).map((player, index) => {
            const medal = index === 0 ? '1.' : index === 1 ? '2.' : index === 2 ? '3.' : `${index + 1}.`
            const name = player.displayName.length > 10
              ? player.displayName.substring(0, 10) + '..'
              : player.displayName

            // Always show all-time bests
            const hasFinished = player.allTimeFinishCount > 0
            const statsDisplay = hasFinished
              ? `${player.allTimeBestTime.toFixed(1)}s (${player.allTimeBestHeight.toFixed(0)}m)`
              : `${player.allTimeBestHeight.toFixed(0)}m`

            return (
              <UiEntity
                key={`lb-${index}`}
                uiTransform={{
                  width: '100%',
                  height: 26 * s,
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  margin: { left: 8 * s }
                }}
                uiText={{
                  value: `${medal} ${name} ${statsDisplay}`,
                  fontSize: 13 * s,
                  color: hasFinished ? Color4.Green() : Color4.White(),
                  textAlign: 'middle-left'
                }}
              />
            )
          })}
        </UiEntity>
      )}

      {/* ALL TIME HIGH - Right Side */}
      {false && leaderboard.length > 0 && (
        <UiEntity
          uiTransform={{
            width: 230 * s,
            height: Math.min(200 * s, (45 + Math.min(3, leaderboard.length) * 28) * s),
            positionType: 'absolute',
            position: { top: '35%', right: 120 * s },
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.85)
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 35 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'ALL TIME HIGH',
              fontSize: 16 * s,
              color: Color4.Yellow(),
              textAlign: 'middle-center'
            }}
          />

          {leaderboard
            .filter((player) => player.allTimeFinishCount > 0 && player.allTimeBestTime > 0)
            .sort((a, b) => a.allTimeBestTime - b.allTimeBestTime)
            .slice(0, 3)
            .map((player, index) => {
            const medal = index === 0 ? '1.' : index === 1 ? '2.' : '3.'
            const name = player.displayName.length > 10
              ? player.displayName.substring(0, 10) + '..'
              : player.displayName

            const statsDisplay = `${player.allTimeBestTime.toFixed(2)}s`

            return (
              <UiEntity
                key={`alltime-${index}`}
                uiTransform={{
                  width: '100%',
                  height: 26 * s,
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  margin: { left: 8 * s }
                }}
                uiText={{
                  value: `${medal} ${name} ${statsDisplay}`,
                  fontSize: 13 * s,
                  color: Color4.Green(),
                  textAlign: 'middle-left'
                }}
              />
            )
          })}
        </UiEntity>
      )}

      {/* WINNERS DISPLAY - Left/top aligned near progress bar */}
      {showWinners && (
        <UiEntity
          uiTransform={{
            width: 360 * s,
            height: 430 * s,
            positionType: 'absolute',
            position: { top: 206 * s, left: ((screenWidth - 980 * s) / 2) - 12 * s },
            alignItems: 'center',
            justifyContent: 'flex-start',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.White(),
            texture: { src: 'assets/images/ui_vertical_background.png' },
            textureMode: 'stretch'
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 50 * s,
              alignItems: 'center',
              justifyContent: 'center',
              margin: { top: 20 * s }
            }}
            uiText={{
              value: 'Results',
              fontSize: 34 * s,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />

          {topWinnerSlots.map((winner, i) => {
            const hasEntry = winner !== null
            const display = hasEntry
              ? (winner.time > 0 ? formatTimeMs(winner.time) : `${winner.height.toFixed(2)}m`)
              : '--:--.--'
            const name = hasEntry ? winner.displayName : 'No entries'

            return (
              <UiEntity
                key={`winner-${i}`}
                uiBackground={{
                  color: Color4.create(0.03, 0.05, 0.18, 0.68),
                  textureMode: 'stretch'
                }}
                uiTransform={{
                  width: 300 * s,
                  height: 62 * s,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  margin: { top: i === 0 ? 10 * s : 6 * s },
                  borderRadius: 8 * s,
                  borderWidth: i === 0 && hasEntry ? 2 * s : 0,
                  borderColor: i === 0 && hasEntry ? Color4.create(1, 0.84, 0, 1) : Color4.create(0, 0, 0, 0)
                }}
              >
                <UiEntity
                  uiTransform={{
                    width: 30 * s,
                    height: 52 * s,
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: { left: 2 * s, right: 4 * s }
                  }}
                  uiBackground={{
                    color: hasEntry ? Color4.White() : Color4.create(1, 1, 1, 0.35),
                    texture: { src: 'assets/images/trophys.png' },
                    textureMode: 'stretch',
                    uvs: getTrophyUvsByRank(i)
                  }}
                />
                <UiEntity
                  uiTransform={{
                    width: 162 * s,
                    height: '100%',
                    alignItems: 'flex-start',
                    justifyContent: 'center'
                  }}
                  uiText={{
                    value: name,
                    fontSize: getWinnerFontSize(i) * s,
                    color: getWinnerTextColor(i, hasEntry, Color4.White()),
                    textAlign: 'middle-left'
                  }}
                />
                <UiEntity
                  uiTransform={{
                    width: 98 * s,
                    height: '100%',
                    alignItems: 'flex-end',
                    justifyContent: 'center'
                  }}
                  uiText={{
                    value: display,
                    fontSize: getWinnerFontSize(i) * s,
                    color: getWinnerTextColor(i, hasEntry, Color4.create(0.92, 0.94, 1, 1)),
                    textAlign: 'middle-right'
                  }}
                />
              </UiEntity>
            )
          })}

          <UiEntity
            uiTransform={{
              width: 318 * s,
              height: 52 * s,
              alignItems: 'center',
              justifyContent: 'center',
              margin: { top: 16 * s }
            }}
            uiBackground={{
              color: Color4.create(0.05, 0.07, 0.24, 0.75)
            }}
            uiText={{
              value: localPlacementText,
              fontSize: 21 * s,
              color: Color4.create(0.86, 0.91, 1, 1),
              textAlign: 'middle-center'
            }}
          />

          <UiEntity
            uiTransform={{
              width: 330 * s,
              height: 42 * s,
              alignItems: 'center',
              justifyContent: 'center',
              margin: { top: 8 * s }
            }}
            uiText={{
              value: `Next round in ${nextRoundSeconds}s`,
              fontSize: 15 * s,
              color: Color4.create(0.86, 0.91, 1, 1),
              textAlign: 'middle-center'
            }}
          />

        </UiEntity>
      )}

      {/* RESULT MESSAGE (WIN/DEATH) - Center */}
      {showResult && !showWinners && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            position: { top: 0, left: 0 },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {attemptResult === 'WIN' && (
            <UiEntity
              uiTransform={{
                width: 320 * mobileBoostScale,
                height: 180 * mobileBoostScale,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column'
              }}
            >
              <UiEntity
                uiTransform={{
                  width: 100 * mobileBoostScale,
                  height: 100 * mobileBoostScale,
                  positionType: 'absolute',
                  position: { left: 110 * mobileBoostScale, top: 0 }
                }}
                uiBackground={{
                  color: Color4.create(1, 1, 1, 1),
                  texture: { src: 'assets/images/emoji_win.png' },
                  textureMode: 'stretch'
                }}
              />
              <UiEntity
                uiTransform={{
                  width: 100 * mobileBoostScale,
                  height: 100 * mobileBoostScale
                }}
                uiBackground={{
                  color: Color4.create(0, 0, 0, 0)
                }}
              />

              {/* CONGRATS text with black stroke */}
              <OutlinedText
                outlineKeyPrefix="win-text-stroke"
                outlineOffsets={OUTLINE_OFFSETS_8}
                outlineScale={mobileBoostScale}
                uiTransform={{
                  width: 300 * mobileBoostScale,
                  height: 60 * mobileBoostScale,
                  positionType: 'absolute',
                  position: { top: 110 * mobileBoostScale, left: 10 * mobileBoostScale },
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: 'CONGRATS\nYOU MADE IT!',
                  fontSize: 26 * mobileBoostScale,
                  color: Color4.White(),
                  textAlign: 'middle-center',
                  font: 'sans-serif'
                }}
              />
            </UiEntity>
          )}

          {attemptResult === 'DEATH' && (
            <UiEntity
              uiTransform={{
                width: 320 * mobileBoostScale,
                height: 180 * mobileBoostScale,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column'
              }}
            >
              <UiEntity
                uiTransform={{
                  width: 100 * mobileBoostScale,
                  height: 100 * mobileBoostScale,
                  positionType: 'absolute',
                  position: { left: 110 * mobileBoostScale + deathShakeX, top: deathShakeY }
                }}
                uiBackground={{
                  color: Color4.create(1, 1, 1, 1),
                  texture: { src: 'assets/images/emoji_try.png' },
                  textureMode: 'stretch'
                }}
              />
              <UiEntity
                uiTransform={{
                  width: 100 * mobileBoostScale,
                  height: 100 * mobileBoostScale
                }}
                uiBackground={{
                  color: Color4.create(0, 0, 0, 0)
                }}
              />

              {/* OOPS TRY AGAIN text with black stroke */}
              <OutlinedText
                outlineKeyPrefix="death-text-stroke"
                outlineOffsets={OUTLINE_OFFSETS_8}
                outlineScale={mobileBoostScale}
                uiTransform={{
                  width: 300 * mobileBoostScale,
                  height: 40 * mobileBoostScale,
                  positionType: 'absolute',
                  position: { top: 110 * mobileBoostScale, left: 10 * mobileBoostScale },
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: 'OOPS TRY AGAIN',
                  fontSize: 28 * mobileBoostScale,
                  color: Color4.White(),
                  textAlign: 'middle-center',
                  font: 'sans-serif'
                }}
              />
              <UiEntity
                uiTransform={{
                  width: 320 * mobileBoostScale,
                  height: 32 * mobileBoostScale,
                  positionType: 'absolute',
                  position: { top: 150 * mobileBoostScale, left: 0 },
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <UiEntity
                  uiTransform={{
                    width: 26 * mobileBoostScale,
                    height: 26 * mobileBoostScale
                  }}
                  uiBackground={{
                    color: Color4.White(),
                    texture: { src: 'assets/images/dead.png' },
                    textureMode: 'stretch'
                  }}
                />
                <UiEntity
                  uiTransform={{
                    width: 2 * mobileBoostScale,
                    height: 1
                  }}
                  uiBackground={{
                    color: Color4.create(0, 0, 0, 0)
                  }}
                />
                <UiEntity
                  uiTransform={{
                    width: 140 * mobileBoostScale,
                    height: 28 * mobileBoostScale,
                    alignItems: 'center',
                    justifyContent: 'center',
                    positionType: 'relative'
                  }}
                >
                  <OutlinedText
                    outlineKeyPrefix="death-at-stroke"
                    outlineOffsets={OUTLINE_OFFSETS_8}
                    outlineScale={mobileBoostScale}
                    uiTransform={{
                      width: '100%',
                      height: '100%',
                      positionType: 'absolute',
                      position: { left: 0, top: 0 },
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    uiText={{
                      value: `DEATH AT ${playerMaxHeight.toFixed(1)}m`,
                      fontSize: 15 * mobileBoostScale,
                      color: Color4.White(),
                      textAlign: 'middle-center',
                      font: 'sans-serif'
                    }}
                  />
                </UiEntity>
              </UiEntity>
            </UiEntity>
          )}
        </UiEntity>
      )}
      {/* STATUS MESSAGE - Bottom Center (hidden) */}
      {/*
      {attemptState === AttemptState.NOT_STARTED && isRoundActive && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 60 * s,
            positionType: 'absolute',
            position: { bottom: 40 * s, left: 0 },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 380 * s,
              height: 50 * s,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiBackground={{
              color: Color4.create(0.1, 0.4, 0.1, 0.9)
            }}
          >
            <UiEntity
              uiTransform={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: 'Go to TriggerStart to begin your attempt!',
                fontSize: 18 * s,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
        </UiEntity>
      )}
      */}
      {/* Tower Progress Bar - Top Center */}
      <TowerProgressBar />
      {/* START MESSAGE - Below Progress Bar Left */}
      {showStartMessage && (
        <UiEntity
          uiTransform={{
            width: startMessageWidth * startMessageScale,
            height: 140 * mobileBoostScale,
            positionType: 'absolute',
            position: {
              top: (isMobile ? 80 : 205) * s,
              left: screenWidth / 2 - playerInfoWidth / 2 - startMessageGap - startMessageWidth * startMessageScale
            },
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 85 * mobileBoostScale,
              height: 85 * mobileBoostScale
            }}
            uiBackground={{
              color: Color4.White(),
              texture: { src: 'assets/images/emoji_start.png' },
              textureMode: 'stretch'
            }}
          />

          {/* Good Luck text with black stroke */}
          <OutlinedText
            outlineKeyPrefix="start-text-stroke"
            outlineOffsets={OUTLINE_OFFSETS_8}
            outlineScale={mobileBoostScale}
            uiTransform={{
              width: 240 * mobileBoostScale,
              height: 36 * mobileBoostScale,
              positionType: 'absolute',
              position: { top: 108 * mobileBoostScale, left: 10 * mobileBoostScale },
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'Good Luck!',
              fontSize: 24 * mobileBoostScale,
              color: Color4.White(),
              textAlign: 'middle-center',
              font: 'sans-serif'
            }}
          />
        </UiEntity>
      )}

      {/* NTP Time Sync Debug - Bottom Left *
      <UiEntity
        uiTransform={{
          width: 200 * s,
          height: 50 * s,
          positionType: 'absolute',
          position: { bottom: 15 * s, left: 120 * s },
          alignItems: 'flex-start',
          justifyContent: 'center',
          flexDirection: 'column'
        }}
        uiBackground={{
          color: Color4.create(0.1, 0.1, 0.2, 0.9)
        }}
      >
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 20 * s,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: 'NTP SYNC',
            fontSize: 10 * s,
            color: Color4.create(0.6, 0.6, 0.8, 1),
            textAlign: 'middle-center'
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 25 * s,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: isTimeSyncReady()
              ? `Offset: ${getTimeSyncOffset().toFixed(0)}ms`
              : 'Syncing...',
            fontSize: 14 * s,
            color: isTimeSyncReady()
              ? (Math.abs(getTimeSyncOffset()) > 5000 ? Color4.Red() : Color4.Green())
              : Color4.Yellow(),
            textAlign: 'middle-center'
          }}
        />
      </UiEntity>
      */}

      {/* Multiplayer Indicator - Bottom Right (hidden) */}
      {/*
      <UiEntity
        uiTransform={{
          width: 140 * s,
          height: 30 * s,
          positionType: 'absolute',
          position: { bottom: 15 * s, right: 15 * s },
          alignItems: 'center',
          justifyContent: 'center'
        }}
        uiBackground={{
          color: Color4.create(0.2, 0.5, 0.2, 0.9)
        }}
      >
        <UiEntity
          uiTransform={{
            width: '100%', 
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: 'MULTIPLAYER',
            fontSize: 14 * s,
            color: Color4.White(),
            textAlign: 'middle-center'
          }}
        />
      </UiEntity>
      */}
    </UiEntity>
  )
}
