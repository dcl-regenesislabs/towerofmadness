import { engine, Schemas } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// ============================================
// ROUND PHASE ENUM
// ============================================
export enum RoundPhase {
  ACTIVE = 'ACTIVE',
  ENDING = 'ENDING',
  BREAK = 'BREAK'
}

// ============================================
// ROUND STATE COMPONENT (Server-authoritative)
// ============================================
// Uses NTP-style time sync - clients calculate remaining time locally
export const RoundStateComponent = engine.defineComponent('tower:RoundState', {
  roundId: Schemas.String,
  phase: Schemas.EnumString<RoundPhase>(RoundPhase, RoundPhase.ACTIVE),
  baseTimer: Schemas.Number,              // Total round time (420 seconds)
  speedMultiplier: Schemas.Number,
  lastSpeedChangeTime: Schemas.Number,    // Server timestamp when multiplier changed
  remainingAtSpeedChange: Schemas.Number, // Remaining seconds at that moment
  finisherCount: Schemas.Number
})
RoundStateComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})

// ============================================
// LEADERBOARD COMPONENT (Server-authoritative)
// ============================================
export const LeaderboardComponent = engine.defineComponent('tower:Leaderboard', {
  players: Schemas.Array(
    Schemas.Map({
      address: Schemas.String,
      displayName: Schemas.String,
      maxHeight: Schemas.Number,
      bestTime: Schemas.Number,
      isFinished: Schemas.Boolean,
      finishOrder: Schemas.Number
    })
  )
})
LeaderboardComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})

// ============================================
// WINNERS COMPONENT (Server-authoritative)
// ============================================
export const WinnersComponent = engine.defineComponent('tower:Winners', {
  winners: Schemas.Array(
    Schemas.Map({
      address: Schemas.String,
      displayName: Schemas.String,
      time: Schemas.Number,
      height: Schemas.Number,
      rank: Schemas.Number
    })
  )
})
WinnersComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})

// ============================================
// TOWER CONFIG COMPONENT (Server-authoritative)
// ============================================
export const TowerConfigComponent = engine.defineComponent('tower:Config', {
  chunkIds: Schemas.Array(Schemas.String),
  chunkHeight: Schemas.Number,
  totalHeight: Schemas.Number
})
TowerConfigComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})

// ============================================
// CHUNK COMPONENT (Empty tag for tower chunk entities)
// ChunkId is derived from GltfContainer.src
// ============================================
export const ChunkComponent = engine.defineComponent('tower:Chunk', {})
ChunkComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})

// ============================================
// TYPE EXPORTS
// ============================================
export type LeaderboardEntry = {
  address: string
  displayName: string
  maxHeight: number
  bestTime: number
  isFinished: boolean
  finishOrder: number
}

export type WinnerEntry = {
  address: string
  displayName: string
  time: number
  height: number
  rank: number
}

export type TowerConfig = {
  chunkIds: string[]
  chunkHeight: number
  totalHeight: number
}
