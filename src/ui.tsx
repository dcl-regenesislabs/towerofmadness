import ReactEcs, { UiEntity, ReactEcsRenderer } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { 
  playerHeight, 
  gameState, 
  GameState, 
  gameTimer, 
  currentGameHeight, 
  bestTime, 
  bestHeight, 
  gameResult, 
  resultMessage,
  resultTimestamp
} from "./index"
import { currentTowerHeight, currentTowerChunks } from "./towerGenerator"

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(GameUI)
}

const GameUI = () => {
  // React ECS re-renders every frame, so we can read the values directly
  
  // Format time as MM:SS.ms
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }
  
  const isGameActive = gameState === GameState.IN_PROGRESS
  // Show result for 10 seconds, then hide it
  const timeSinceResult = resultTimestamp > 0 ? (Date.now() - resultTimestamp) / 1000 : 0
  const showResult = gameState === GameState.ENDED && gameResult && timeSinceResult < 10
  
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute'
      }}
    >
      {/* Player Height & Game Timer - Top Center (Single Box) */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: isGameActive ? 120 : 80,
          positionType: 'absolute',
          position: { top: '20px', left: '0px' },
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{
            width: 300,
            height: isGameActive ? 100 : 60,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.7)
          }}
        >
          {/* Player Height */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 50,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `Player Height: ${playerHeight.toFixed(2)}m`,
              fontSize: 24,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
          
          {/* Game Timer - Only show when game is active */}
          {isGameActive && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 50,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `Time: ${formatTime(gameTimer)}`,
                fontSize: 24,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
          )}
        </UiEntity>
      </UiEntity>

      {/* Best Scores - Top Right */}
      <UiEntity
        uiTransform={{
          width: 280,
          height: 120,
          positionType: 'absolute',
          position: { top: '20px', right: '20px' },
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column'
        }}
        uiBackground={{
          color: Color4.create(0, 0, 0, 0.7)
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
            value: `Best Time: ${bestTime > 0 ? formatTime(bestTime) : '--:--.--'}`,
            fontSize: 18,
            color: Color4.Yellow(),
            textAlign: 'middle-center'
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 50,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: `Best Height: ${bestHeight > 0 ? bestHeight.toFixed(2) + 'm' : '--'}`,
            fontSize: 18,
            color: Color4.Yellow(),
            textAlign: 'middle-center'
          }}
        />
      </UiEntity>

      {/* Tower Chunks List - Below Best Scores */}
      {currentTowerChunks.length > 0 && (
        <UiEntity
          uiTransform={{
            width: 280,
            height: Math.max(150, 30 + (currentTowerChunks.length * 18)),
            positionType: 'absolute',
            position: { top: '150px', right: '20px' },
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            flexDirection: 'column'
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.7)
          }}
        >
          {/* Chunk Count Header */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
              margin: { top: 5, bottom: 5 }
            }}
            uiText={{
              value: `${currentTowerChunks.length - 1} chunks`,
              fontSize: 16,
              color: Color4.White(),
              textAlign: 'middle-center'
            }}
          />
          
          {/* Chunk List - Render each chunk as separate text element */}
          {currentTowerChunks.map((chunkName, index) => (
            <UiEntity
              key={`chunk-${index}`}
              uiTransform={{
                width: '100%',
                height: 18,
                alignItems: 'flex-start',
                justifyContent: 'center',
                margin: { left: 10, right: 10 }
              }}
              uiText={{
                value: chunkName,
                fontSize: 14,
                color: Color4.White(),
                textAlign: 'middle-left'
              }}
            />
          ))}
        </UiEntity>
      )}

      {/* Game Result Message - Center (bigger for DEATH, auto-hides after 10 seconds) */}
      {showResult && (
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
              width: gameResult === 'DEATH' ? 600 : 400,
              height: gameResult === 'DEATH' ? 250 : 150,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column'
            }}
            uiBackground={{
              color: gameResult === 'WIN' 
                ? Color4.create(0, 0.8, 0, 0.9) 
                : Color4.create(0.8, 0, 0, 0.9)
            }}
          >
            <UiEntity
              uiTransform={{
                width: '100%',
                height: gameResult === 'DEATH' ? 80 : 60,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: gameResult === 'WIN' ? 'WIN!' : 'DEATH',
                fontSize: gameResult === 'DEATH' ? 48 : 36,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
            <UiEntity
              uiTransform={{
                width: '100%',
                height: gameResult === 'DEATH' ? 50 : 40,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `Time: ${formatTime(gameTimer)} | Height: ${currentGameHeight.toFixed(2)}m`,
                fontSize: gameResult === 'DEATH' ? 20 : 16,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
            {gameResult === 'DEATH' && (
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 40,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: 'Go to TriggerStart to restart',
                  fontSize: 18,
                  color: Color4.White(),
                  textAlign: 'middle-center'
                }}
              />
            )}
          </UiEntity>
        </UiEntity>
      )}

      {/* Game Status - Bottom Center */}
      {gameState === GameState.NOT_STARTED && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 60,
            positionType: 'absolute',
            position: { bottom: '50px', left: '0px' },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 350,
              height: 50,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiBackground={{
              color: Color4.create(0, 0, 0, 0.7)
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
                value: 'Go to TriggerStart to begin',
                fontSize: 20,
                color: Color4.White(),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
        </UiEntity>
      )}
    </UiEntity>
  )
}
