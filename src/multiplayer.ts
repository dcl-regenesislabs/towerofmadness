/**
 * Tower of Madness - Multiplayer System (DCL Authoritative Server)
 *
 * Uses Decentraland's built-in authoritative server pattern.
 * State is synchronized via ECS components (schemas.ts).
 * Messages are sent via registerMessages() (messages.ts).
 */

import { engine, Transform, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { room } from './shared/messages'
import {
  RoundStateComponent,
  LeaderboardComponent,
  WinnersComponent,
  TowerConfigComponent,
  RoundPhase,
  LeaderboardEntry,
  WinnerEntry,
  TowerConfig
} from './shared/schemas'
import {
  initTimeSync,
  getServerTime,
  isTimeSyncReady,
  getTimeSyncOffset
} from './shared/timeSync'

// Re-export types for compatibility
export type { LeaderboardEntry, WinnerEntry, TowerConfig }
export { RoundPhase }

// Re-export time sync functions
export { getServerTime, isTimeSyncReady, getTimeSyncOffset }

// Re-export isServer from DCL SDK
export { isServer } from '@dcl/sdk/network'

// ============================================
// CLIENT SETUP
// ============================================

export function setupClient() {
  // Initialize time sync with the room
  initTimeSync(room)

  // Listen for player finished broadcasts
  room.onMessage('playerFinishedBroadcast', (data) => {
    console.log(`[Game] ${data.displayName} finished #${data.finishOrder}`)
  })
}


// ============================================
// SEND MESSAGES TO SERVER
// ============================================

export function sendPlayerJoined(displayName: string) {
  room.send('playerJoin', { displayName })
}

export function sendPlayerFinished(time: number) {
  room.send('playerFinished', { time })
}

// ============================================
// LOCAL PLAYER DATA (from avatar entities)
// ============================================

export type LocalPlayerHeight = {
  address: string
  displayName: string
  height: number
}

export function getLocalPlayerHeights(excludeSelf: boolean = false): LocalPlayerHeight[] {
  const players: LocalPlayerHeight[] = []

  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    // Skip current player if excludeSelf is true
    if (excludeSelf && entity === engine.PlayerEntity) continue

    const transform = Transform.getOrNull(entity)
    if (!transform) continue

    const avatarBase = AvatarBase.getOrNull(entity)
    const displayName = avatarBase?.name || identity.address.substring(0, 8)

    players.push({
      address: identity.address,
      displayName: displayName,
      height: transform.position.y
    })
  }

  // Sort by height descending
  players.sort((a, b) => b.height - a.height)

  return players
}

// ============================================
// COMPONENT ACCESS HELPERS
// ============================================

export function getRoundState(): { phase: RoundPhase; remainingTime: number; speedMultiplier: number } | null {
  for (const [entity] of engine.getEntitiesWith(RoundStateComponent)) {
    const state = RoundStateComponent.get(entity)

    // Calculate remaining time locally using synchronized server time
    const serverNow = getServerTime()
    const elapsed = (serverNow - state.lastSpeedChangeTime) / 1000
    const adjustedElapsed = elapsed * state.speedMultiplier
    const remainingTime = Math.max(0, state.remainingAtSpeedChange - adjustedElapsed)

    return {
      phase: state.phase,
      remainingTime: remainingTime,
      speedMultiplier: state.speedMultiplier
    }
  }
  return null
}

export function getLeaderboard(): LeaderboardEntry[] {
  for (const [entity] of engine.getEntitiesWith(LeaderboardComponent)) {
    return LeaderboardComponent.get(entity).players as LeaderboardEntry[]
  }
  return []
}

export function getWinners(): WinnerEntry[] {
  for (const [entity] of engine.getEntitiesWith(WinnersComponent)) {
    return WinnersComponent.get(entity).winners as WinnerEntry[]
  }
  return []
}

export function getTowerConfig(): TowerConfig | null {
  for (const [entity] of engine.getEntitiesWith(TowerConfigComponent)) {
    const config = TowerConfigComponent.get(entity)
    return {
      chunkIds: config.chunkIds as string[],
      chunkHeight: config.chunkHeight,
      totalHeight: config.totalHeight
    }
  }
  return null
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
