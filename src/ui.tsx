import ReactEcs, { UiEntity, ReactEcsRenderer } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
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
  roundState,
  RoundState,
  roundTimer,
  roundSpeedMultiplier,
  leaderboard,
  roundWinners,
  isMultiplayerMode
} from "./index"
import { currentTowerChunks } from "./towerGenerator"

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(GameUI)
}

const GameUI = () => {
  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Format time with milliseconds
  const formatTimeMs = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }
  
  const isAttemptActive = attemptState === AttemptState.IN_PROGRESS
  const isRoundActive = roundState === RoundState.ACTIVE
  
  // Show result for 5 seconds
  const timeSinceResult = resultTimestamp > 0 ? (Date.now() - resultTimestamp) / 1000 : 999
  const showResult = attemptResult && timeSinceResult < 5
  
  // Show winners display
  const showWinners = (roundState === RoundState.ENDING || roundState === RoundState.BREAK) && roundWinners.length > 0
  
  // Timer color based on time remaining
  const getTimerColor = () => {
    if (roundTimer <= 30) return Color4.create(1, 0.2, 0.2, 1) // Red when < 30s
    if (roundTimer <= 60) return Color4.create(1, 0.8, 0, 1)   // Orange when < 1 min
    return Color4.create(0.3, 1, 0.3, 1) // Green otherwise
  }
  
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute'
      }}
    >
      {/* ═══════════════════════════════════════════════════════════════
          ROUND TIMER - ALWAYS VISIBLE - Top Center (Most Important!)
          ═══════════════════════════════════════════════════════════════ */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 100,
          positionType: 'absolute',
          position: { top: '15px', left: '0px' },
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{
            width: 280,
            height: 90,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: roundSpeedMultiplier > 1 
              ? Color4.create(0.6, 0.2, 0, 0.95)  // Orange/red when sped up
              : Color4.create(0.1, 0.1, 0.15, 0.95)
          }}
        >
          {/* Round Timer - BIG */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 55,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `⏱️ ${formatTime(roundTimer)}`,
              fontSize: 42,
              color: getTimerColor(),
              textAlign: 'middle-center'
            }}
          />
          
          {/* Speed Multiplier (if active) */}
          {roundSpeedMultiplier > 1 && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 25,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `⚡ x${roundSpeedMultiplier.toFixed(0)} SPEED!`,
                fontSize: 18,
                color: Color4.Yellow(),
                textAlign: 'middle-center'
              }}
            />
          )}
          
          {/* Round Status */}
          {!isRoundActive && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 25,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: roundState === RoundState.ENDING ? '🏁 ROUND ENDED' : '⏳ NEXT ROUND SOON',
                fontSize: 14,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
          )}
        </UiEntity>
      </UiEntity>

      {/* ═══════════════════════════════════════════════════════════════
          PLAYER INFO - Below Round Timer
          ═══════════════════════════════════════════════════════════════ */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 120,
          positionType: 'absolute',
          position: { top: '115px', left: '0px' },
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{
            width: 260,
            height: isAttemptActive ? 110 : 70,
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
              height: 35,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `📍 Height: ${playerHeight.toFixed(1)}m`,
              fontSize: 22,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
          
          {/* Attempt Timer (only during attempt) */}
          {isAttemptActive && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 35,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `🏃 Attempt: ${formatTimeMs(attemptTimer)}`,
                fontSize: 20,
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
                height: 30,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `🏔️ Max: ${playerMaxHeight.toFixed(1)}m`,
                fontSize: 16,
                color: Color4.Yellow(),
                textAlign: 'middle-center'
              }}
            />
          )}
        </UiEntity>
      </UiEntity>

      {/* ═══════════════════════════════════════════════════════════════
          PERSONAL BEST - Top Right
          ═══════════════════════════════════════════════════════════════ */}
      <UiEntity
        uiTransform={{
          width: 220,
          height: 100,
          positionType: 'absolute',
          position: { top: '15px', right: '15px' },
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
            height: 30,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: '🏆 PERSONAL BEST',
            fontSize: 14,
            color: Color4.Yellow(),
            textAlign: 'middle-center'
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 30,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: `Time: ${bestAttemptTime > 0 ? formatTimeMs(bestAttemptTime) : '--:--.--'}`,
            fontSize: 16,
            color: Color4.White(),
            textAlign: 'middle-center'
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 30,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: `Height: ${bestAttemptHeight > 0 ? bestAttemptHeight.toFixed(1) + 'm' : '--'}`,
            fontSize: 16,
            color: Color4.White(),
            textAlign: 'middle-center'
          }}
        />
      </UiEntity>

      {/* ═══════════════════════════════════════════════════════════════
          LEADERBOARD - Left Side (Multiplayer only)
          ═══════════════════════════════════════════════════════════════ */}
      {isMultiplayerMode && leaderboard.length > 0 && (
        <UiEntity
          uiTransform={{
            width: 230,
            height: Math.min(350, 45 + leaderboard.length * 28),
            positionType: 'absolute',
            position: { top: '15px', left: '15px' },
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
              height: 35,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `🏆 LEADERBOARD`,
              fontSize: 16,
              color: Color4.Yellow(),
              textAlign: 'middle-center'
            }}
          />
          
          {leaderboard.slice(0, 10).map((player, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`
            const name = player.displayName.length > 10 
              ? player.displayName.substring(0, 10) + '..' 
              : player.displayName
            const status = player.isFinished ? '✅' : ''
            
            return (
              <UiEntity
                key={`lb-${index}`}
                uiTransform={{
                  width: '100%',
                  height: 26,
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  margin: { left: 8 }
                }}
                uiText={{
                  value: `${medal} ${name} ${status} ${player.maxHeight.toFixed(0)}m`,
                  fontSize: 13,
                  color: player.isFinished ? Color4.Green() : Color4.White(),
                  textAlign: 'middle-left'
                }}
              />
            )
          })}
        </UiEntity>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          TOWER CHUNKS - Right Side (Below Personal Best)
          ═══════════════════════════════════════════════════════════════ */}
      {currentTowerChunks.length > 0 && (
        <UiEntity
          uiTransform={{
            width: 220,
            height: Math.min(200, 35 + currentTowerChunks.length * 16),
            positionType: 'absolute',
            position: { top: '125px', right: '15px' },
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.7)
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 28,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `🗼 Tower (${currentTowerChunks.length - 1} chunks)`,
              fontSize: 14,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
          
          {currentTowerChunks.slice(0, 8).map((chunk, i) => (
            <UiEntity
              key={`chunk-${i}`}
              uiTransform={{
                width: '100%',
                height: 16,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: chunk,
                fontSize: 12,
                color: Color4.create(0.7, 0.7, 0.7, 1),
                textAlign: 'middle-center'
              }}
            />
          ))}
        </UiEntity>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          WINNERS DISPLAY - Center (When round ends)
          ═══════════════════════════════════════════════════════════════ */}
      {showWinners && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            position: { top: '0px', left: '0px' },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 400,
              height: 60 + roundWinners.length * 45 + 50,
              alignItems: 'center',
              justifyContent: 'flex-start',
              flexDirection: 'column'
            }}
            uiBackground={{
              color: Color4.create(0.05, 0.05, 0.2, 0.95)
            }}
          >
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 50,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: '🏁 ROUND COMPLETE!',
                fontSize: 32,
                color: Color4.Yellow(),
                textAlign: 'middle-center'
              }}
            />
            
            {roundWinners.map((winner, i) => {
              const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`
              const display = winner.time > 0 
                ? `${winner.time.toFixed(2)}s`
                : `${winner.height.toFixed(0)}m`
              
              return (
                <UiEntity
                  key={`winner-${i}`}
                  uiTransform={{
                    width: '100%',
                    height: 40,
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  uiText={{
                    value: `${medal} ${winner.displayName} - ${display}`,
                    fontSize: 22,
                    color: i === 0 ? Color4.create(1, 0.84, 0, 1) : Color4.White(),
                    textAlign: 'middle-center'
                  }}
                />
              )
            })}
            
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                margin: { top: 10 }
              }}
              uiText={{
                value: '⏳ Next round starting soon...',
                fontSize: 16,
                color: Color4.create(0.6, 0.6, 0.6, 1),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
        </UiEntity>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          RESULT MESSAGE (WIN/DEATH) - Center
          ═══════════════════════════════════════════════════════════════ */}
      {showResult && !showWinners && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            position: { top: '0px', left: '0px' },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: attemptResult === 'DEATH' ? 500 : 400,
              height: attemptResult === 'DEATH' ? 180 : 120,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column'
            }}
            uiBackground={{
              color: attemptResult === 'WIN' 
                ? Color4.create(0, 0.6, 0, 0.95)
                : Color4.create(0.7, 0, 0, 0.95)
            }}
          >
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 60,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: attemptResult === 'WIN' ? '🏆 FINISHED!' : '☠️ DEATH!',
                fontSize: 40,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 40,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: resultMessage,
                fontSize: 18,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
            {attemptResult === 'DEATH' && (
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 35,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: '↩️ Go to TriggerStart to retry!',
                  fontSize: 16,
                  color: Color4.Yellow(),
                  textAlign: 'middle-center'
                }}
              />
            )}
          </UiEntity>
        </UiEntity>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          STATUS MESSAGE - Bottom Center
          ═══════════════════════════════════════════════════════════════ */}
      {attemptState === AttemptState.NOT_STARTED && isRoundActive && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 60,
            positionType: 'absolute',
            position: { bottom: '40px', left: '0px' },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 380,
              height: 50,
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
                value: '🎮 Go to TriggerStart to begin your attempt!',
                fontSize: 18,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
        </UiEntity>
      )}

      {/* Multiplayer Indicator - Top Left Corner */}
      {isMultiplayerMode && (
        <UiEntity
          uiTransform={{
            width: 140,
            height: 30,
            positionType: 'absolute',
            position: { bottom: '15px', right: '15px' },
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
              value: '🌐 MULTIPLAYER',
              fontSize: 14,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      )}
    </UiEntity>
  )
}
