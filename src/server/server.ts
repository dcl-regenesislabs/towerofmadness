import { engine, Transform, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { GameState } from './gameState'
import { room } from '../shared/messages'
import { RoundPhase } from '../shared/schemas'

const ROUND_END_DISPLAY_TIME = 3 // seconds
const NEW_ROUND_DELAY = 10 // seconds
const HEIGHT_UPDATE_INTERVAL = 0.5 // seconds

export function server() {
  console.log('[Server] Tower of Madness starting...')

  const gameState = GameState.getInstance()
  gameState.init()
  gameState.startNewRound()

  setupMessageHandlers(gameState)

  // Timer system
  let lastUpdate = 0
  let roundEndTime = 0
  let breakStartTime = 0

  engine.addSystem((dt: number) => {
    lastUpdate += dt
    if (lastUpdate < 1) return
    lastUpdate = 0

    const phase = gameState.getPhase()

    if (phase === RoundPhase.ACTIVE) {
      if (gameState.checkTimerExpired()) {
        gameState.endRound()
        roundEndTime = Date.now()
      }
    } else if (phase === RoundPhase.ENDING) {
      if ((Date.now() - roundEndTime) / 1000 >= ROUND_END_DISPLAY_TIME) {
        gameState.setPhase(RoundPhase.BREAK)
        breakStartTime = Date.now()
      }
    } else if (phase === RoundPhase.BREAK) {
      if ((Date.now() - breakStartTime) / 1000 >= NEW_ROUND_DELAY) {
        gameState.startNewRound()
      }
    }
  }, undefined, 'tower-timer-system')

  // Height tracking from avatar positions
  let heightUpdateTimer = 0
  engine.addSystem((dt: number) => {
    heightUpdateTimer += dt
    if (heightUpdateTimer < HEIGHT_UPDATE_INTERVAL) return
    heightUpdateTimer = 0

    if (gameState.getPhase() !== RoundPhase.ACTIVE) return

    for (const [avatarEntity, identityData] of engine.getEntitiesWith(PlayerIdentityData)) {
      const player = gameState.getPlayer(identityData.address)
      if (!player) continue

      const transform = Transform.getOrNull(avatarEntity)
      if (!transform) continue

      if (transform.position.y > player.maxHeight) {
        player.maxHeight = transform.position.y
        gameState.setPlayer(identityData.address, player)
      }
    }
  }, undefined, 'tower-height-system')

  console.log('[Server] Ready')
}

function getPlayerName(playerAddress: string): string {
  for (const [_, identity, avatarBase] of engine.getEntitiesWith(PlayerIdentityData, AvatarBase)) {
    if (identity.address.toLowerCase() === playerAddress.toLowerCase()) {
      return avatarBase.name || playerAddress.substring(0, 8)
    }
  }
  return playerAddress.substring(0, 8)
}

function setupMessageHandlers(gameState: GameState) {
  room.onMessage('playerJoin', (data, context) => {
    if (!context) return

    const displayName = data.displayName || getPlayerName(context.from)
    console.log(`[Server] Player joined: ${displayName}`)

    gameState.setPlayer(context.from, {
      address: context.from,
      displayName: displayName,
      maxHeight: 0,
      bestTime: 0,
      isFinished: false,
      finishOrder: 0
    })
  })

  room.onMessage('playerFinished', (data, context) => {
    if (!context) return
    const player = gameState.getPlayer(context.from)
    if (!player || player.isFinished) return

    console.log(`[Server] Player finished: ${player.displayName} in ${data.time.toFixed(2)}s`)

    player.isFinished = true
    player.bestTime = data.time
    player.finishOrder = gameState.incrementFinisherCount()
    gameState.setPlayer(context.from, player)

    room.send('playerFinishedBroadcast', {
      displayName: player.displayName,
      finishOrder: player.finishOrder,
      speedMultiplier: gameState.getSpeedMultiplier()
    })
  })

  // NTP-style time sync - respond only to the requesting client
  room.onMessage('timeSync', (data, context) => {
    if (!context) return
    const t2 = Date.now()
    const t3 = Date.now()
    room.send('timeSyncResponse', {
      id: data.id,
      t2: t2,
      t3: t3
    }, { to: [context.from] })
  })
}
