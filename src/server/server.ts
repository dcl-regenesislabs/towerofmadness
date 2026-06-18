import { engine, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { GameState } from './gameState'
import { room } from '../shared/messages'
import { RoundPhase, TournamentComponent } from '../shared/schemas'
import { TOURNAMENT_CONFIG } from './tournamentConfig'

const ROUND_END_DISPLAY_TIME = 3 // seconds
const NEW_ROUND_DELAY = 10 // seconds
const MAX_UP_SPEED = 12 // m/s allowed upward speed before considering teleport
const HEIGHT_TOLERANCE = 0.5 // m of extra leeway per sample
const HARD_MAX_DELTA = 20 // m allowed upward jump regardless of sample time
const TELEPORT_BASE = { x: 45, y: 2.5, z: 59 }
const END_TRIGGER_OFFSET = 11
const ROUND_TIMER_CHECK_INTERVAL = 0.25 // seconds

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
  // Auto-start deferred: wait ~2s after boot so restoreTournamentState() can complete first
  let autoStartDelay = (TOURNAMENT_CONFIG.tournamentMode && TOURNAMENT_CONFIG.autoStart) ? 2 : -1

  engine.addSystem((dt: number) => {
    lastUpdate += dt
    if (lastUpdate < ROUND_TIMER_CHECK_INTERVAL) return
    const elapsed = lastUpdate
    lastUpdate = 0

    // Auto-start tournament after boot delay (setTimeout not available in sandbox)
    if (autoStartDelay > 0) {
      autoStartDelay -= elapsed
      if (autoStartDelay <= 0) {
        autoStartDelay = -1
        if (!gameState.tournamentActive) {
          console.log(`[Tournament] Auto-starting: ${TOURNAMENT_CONFIG.durationMinutes}m, prize: ${TOURNAMENT_CONFIG.prizeMANA} MANA`)
          gameState.startTournament(TOURNAMENT_CONFIG.durationMinutes, TOURNAMENT_CONFIG.prizeMANA)
        } else {
          console.log('[Tournament] Skipping auto-start — tournament already active (restored from storage)')
        }
      }
    }

    const phase = gameState.getPhase()

    // Tournament expiry check
    if (TOURNAMENT_CONFIG.tournamentMode && gameState.checkTournamentExpired()) {
      void gameState.endTournament()
    }

    if (phase === RoundPhase.ACTIVE) {
      if (gameState.checkTimerExpired()) {
        gameState.endRound()
        room.send('teleportToBase', TELEPORT_BASE)
        roundEndTime = Date.now()
      }
    } else if (phase === RoundPhase.ENDING) {
      const endingElapsed = (Date.now() - roundEndTime) / 1000
      if (endingElapsed >= ROUND_END_DISPLAY_TIME) {
        // Destroy tower NOW so clients get src='' / visible=false 10 s before the new round.
        // That gap lets them fully unload the GLTFs and destroy physics bodies, so they
        // recreate colliders cleanly when the new assets arrive in startNewRound().
        console.log(`[Server] ENDING phase done after ${endingElapsed.toFixed(1)}s, destroying tower and starting BREAK`)
        gameState.destroyTowerForTransition()
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
      const now = Date.now()
      if (playerData.lastHeightTime === 0) {
        playerData.lastHeight = height
        playerData.lastHeightTime = now
        continue
      }

      const rawDtSeconds = (now - playerData.lastHeightTime) / 1000
      const dtSeconds = Math.min(rawDtSeconds, 0.5)
      const deltaY = height - playerData.lastHeight
      const maxAllowedDelta = MAX_UP_SPEED * dtSeconds + HEIGHT_TOLERANCE

      if (dtSeconds > 0 && (deltaY > maxAllowedDelta || deltaY > HARD_MAX_DELTA)) {
        playerData.teleportStrikes += 1
        console.log(
          `[Server] Teleport suspicious: ${playerData.displayName} deltaY=${deltaY.toFixed(2)}m dt=${rawDtSeconds.toFixed(2)}s strikes=${playerData.teleportStrikes}`
        )
        if (playerData.teleportStrikes === 1) {
          room.send('teleportWarning', {
            address: identityData.address,
            strikes: playerData.teleportStrikes
          })
        }
        playerData.lastHeight = height
        playerData.lastHeightTime = now
        continue
      }

      playerData.lastHeight = height
      playerData.lastHeightTime = now

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
      finishOrder: 0,
      attemptStartTime: 0,
      lastHeight: 0,
      lastHeightTime: 0,
      teleportStrikes: 0
    })
  })

  // Player started attempt (entered start trigger)
  room.onMessage('playerStarted', (_data, context) => {
    if (!context) return
    if (gameState.getPhase() !== RoundPhase.ACTIVE) return

    const player = gameState.getPlayer(context.from)
    if (!player) return

    // Don't restart if already finished
    if (player.isFinished) return

    // Validate: player must be at start area (low height)
    const liveKitPlayer = getPlayer({ userId: player.address })
    const currentHeight = liveKitPlayer?.position?.y || 0
    const maxStartHeight = 20 // Must be below 20m to start (ground level + tolerance)

    if (currentHeight > maxStartHeight) {
      console.log(`[Server] Rejected start from ${player.displayName}: height ${currentHeight.toFixed(1)}m > max ${maxStartHeight}m`)
      room.send('attemptRejected', {
        address: player.address,
        stage: 'start',
        reason: `Start trigger missed. Server detected height ${currentHeight.toFixed(1)}m, so the attempt was not registered.`
      })
      return
    }

    // Record attempt start time (server-authoritative)
    player.attemptStartTime = Date.now()
    player.maxHeight = 0 // Reset height for new attempt
    player.lastHeight = currentHeight
    player.lastHeightTime = Date.now()
    player.teleportStrikes = 0
    gameState.setPlayer(context.from, player)

    console.log(`[Server] Player started attempt: ${player.displayName} at height ${currentHeight.toFixed(1)}m`)
  })

  // Player finished (entered end trigger) - server validates and calculates time
  room.onMessage('playerFinished', (_data, context) => {
    if (!context) return
    if (gameState.getPhase() !== RoundPhase.ACTIVE) return

    const player = gameState.getPlayer(context.from)
    if (!player || player.isFinished) return

    // Validate: player must have started an attempt
    if (player.attemptStartTime === 0) {
      console.log(`[Server] Rejected finish from ${player.displayName}: no active attempt`)
      room.send('attemptRejected', {
        address: player.address,
        stage: 'finish',
        reason: 'No active attempt on server. You likely skipped or missed the start trigger.'
      })
      return
    }

    // Validate: no teleporting detected during attempt
    if (player.teleportStrikes > 1) {
      console.log(`[Server] Rejected finish from ${player.displayName}: teleport detected (${player.teleportStrikes})`)
      room.send('attemptRejected', {
        address: player.address,
        stage: 'finish',
        reason: `Attempt invalidated by movement validation (${player.teleportStrikes} teleport flags).`
      })
      return
    }

    // Validate: player height must be near the top of tower
    const liveKitPlayer = getPlayer({ userId: player.address })
    const currentHeight = liveKitPlayer?.position?.y || player.maxHeight
    const towerConfig = gameState.getTowerConfig()
    const minFinishHeight = towerConfig ? towerConfig.totalHeight - END_TRIGGER_OFFSET : 80

    console.log(`[Server] Finish attempt: height=${currentHeight.toFixed(1)}m, towerHeight=${towerConfig?.totalHeight.toFixed(1)}m, minRequired=${minFinishHeight.toFixed(1)}m`)

    if (currentHeight < minFinishHeight) {
      console.log(`[Server] Rejected finish from ${player.displayName}: height ${currentHeight.toFixed(1)}m < required ${minFinishHeight.toFixed(1)}m`)
      room.send('attemptRejected', {
        address: player.address,
        stage: 'finish',
        reason: `Finish trigger reached too low at ${currentHeight.toFixed(1)}m.`
      })
      return
    }

    // Calculate time server-side (ignore client-sent time)
    const serverTime = (Date.now() - player.attemptStartTime) / 1000

    console.log(`[Server] Player finished: ${player.displayName} in ${serverTime.toFixed(2)}s (height: ${currentHeight.toFixed(1)}m)`)

    player.isFinished = true
    player.bestTime = serverTime
    player.finishOrder = gameState.incrementFinisherCount()
    gameState.setPlayer(context.from, player)

    room.send('playerFinishedBroadcast', {
      displayName: player.displayName,
      finishOrder: player.finishOrder,
      speedMultiplier: gameState.getSpeedMultiplier(),
      time: serverTime
    })
  })

  room.onMessage('adminStartTournament', (data, context) => {
    if (!context) return
    if (!TOURNAMENT_CONFIG.adminWallets.includes(context.from.toLowerCase())) {
      console.log(`[Tournament] Unauthorized start attempt from ${context.from}`)
      return
    }
    const { durationMinutes, prizeMANA } = data
    if (!durationMinutes || !prizeMANA) {
      console.log('[Tournament] Invalid adminStartTournament params:', data)
      return
    }
    gameState.startTournament(durationMinutes, prizeMANA)
    const t = TournamentComponent.get(gameState.tournamentEntity)
    room.send('tournamentStarted', {
      tournamentId: t.tournamentId,
      endTime: t.endTime,
      prizeMANA: t.prizeMANA
    })
  })

  room.onMessage('wearableClaimedByClient', (data, context) => {
    if (!context) return
    const t = TournamentComponent.getMutable(gameState.tournamentEntity)
    if (t.winnerAddress.toLowerCase() !== context.from.toLowerCase()) return
    if (t.paymentTxHash !== 'pending-claim') return
    t.paymentTxHash = data.rewardId || 'claimed'
    console.log(`[Tournament] Wearable claim confirmed by client: ${data.rewardId}`)
  })
}
