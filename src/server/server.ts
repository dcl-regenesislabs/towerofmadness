import { engine, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { GameState } from './gameState'
import { room } from '../shared/messages'
import { RoundPhase } from '../shared/schemas'

const ROUND_END_DISPLAY_TIME = 3 // seconds
const NEW_ROUND_DELAY = 10 // seconds

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
      const endingElapsed = (Date.now() - roundEndTime) / 1000
      if (endingElapsed >= ROUND_END_DISPLAY_TIME) {
        console.log(`[Server] ENDING phase done after ${endingElapsed.toFixed(1)}s, starting BREAK`)
        gameState.setPhase(RoundPhase.BREAK)
        breakStartTime = Date.now()
      }
    } else if (phase === RoundPhase.BREAK) {
      const breakElapsed = (Date.now() - breakStartTime) / 1000
      if (breakElapsed >= NEW_ROUND_DELAY) {
        console.log(`[Server] BREAK phase done after ${breakElapsed.toFixed(1)}s, starting new round`)
        gameState.startNewRound()
      }
    }
  }, undefined, 'tower-timer-system')

  // Player name update system (checks for name changes from AvatarBase)
  let nameUpdateTimer = 0
  engine.addSystem((dt: number) => {
    nameUpdateTimer += dt
    if (nameUpdateTimer < 2) return // Check every 2 seconds
    nameUpdateTimer = 0

    for (const [avatarEntity, identityData] of engine.getEntitiesWith(PlayerIdentityData)) {
      const player = gameState.getPlayer(identityData.address)
      if (!player) continue

      // Update name if AvatarBase is now available
      const avatarBase = AvatarBase.getOrNull(avatarEntity)
      if (avatarBase?.name && player.displayName !== avatarBase.name) {
        player.displayName = avatarBase.name
        gameState.setPlayer(identityData.address, player)
      }
    }
  }, undefined, 'player-name-system')

  // Height tracking system - reads player positions from LiveKit
  let heightUpdateTimer = 0
  engine.addSystem((dt: number) => {
    heightUpdateTimer += dt
    if (heightUpdateTimer < 0.5) return // Check every 0.5 seconds
    heightUpdateTimer = 0

    if (gameState.getPhase() !== RoundPhase.ACTIVE) return

    for (const [_, identityData] of engine.getEntitiesWith(PlayerIdentityData)) {
      const playerData = gameState.getPlayer(identityData.address)
      if (!playerData) continue

      const player = getPlayer({ userId: identityData.address })
      if (!player?.position) continue

      const height = player.position.y
      if (height > playerData.maxHeight) {
        playerData.maxHeight = height
        gameState.setPlayer(identityData.address, playerData)
      }
    }
  }, undefined, 'player-height-system')

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
  room.onMessage('playerJoin', (_data, context) => {
    if (!context) return

    // Always get name from PlayerIdentityData/AvatarBase (server-authoritative)
    const displayName = getPlayerName(context.from)

    // Check if player already exists in current round - don't reset their progress
    const existingPlayer = gameState.getPlayer(context.from)
    if (existingPlayer) {
      console.log(`[Server] Player rejoined: ${displayName}`)
      // Just update their display name in case it changed
      existingPlayer.displayName = displayName
      gameState.setPlayer(context.from, existingPlayer)
      return
    }

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
