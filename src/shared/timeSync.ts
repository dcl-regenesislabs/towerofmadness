/**
 * NTP-Style Time Synchronization for Decentraland Scenes
 *
 * Provides synchronized server time for multiplayer games.
 * Uses session IDs to filter stale messages from previous sessions.
 *
 * Usage:
 *   import { initTimeSync, getServerTime, isTimeSyncReady } from './shared/timeSync'
 *
 *   // In setupClient():
 *   initTimeSync(room)
 *
 *   // Time sync starts automatically when room is connected
 *
 *   // To get synchronized server time:
 *   const serverNow = getServerTime()
 */

import { engine } from '@dcl/sdk/ecs'
import { RealmInfo } from '@dcl/sdk/ecs'

// Types
interface TimeSyncRoom {
  send: (type: 'timeSync', data: { id: string }) => void
  onMessage: (type: 'timeSyncResponse', handler: (data: { id: string; t2: number; t3: number }) => void) => void
}

// Configuration
const SAMPLES_NEEDED = 5
const SAMPLE_INTERVAL = 0.15 // seconds between samples
const RESYNC_INTERVAL = 60 // seconds between re-syncs

// State
let room: TimeSyncRoom | null = null
let sessionId: string = ''
let serverTimeOffset = 0
let timeSyncReady = false

// Sync state
let isSyncing = false
let samples: { offset: number; rtt: number }[] = []
let sampleTimer = 0
let resyncTimer = 0
let requestCounter = 0
let pendingRequestId: string | null = null
let pendingT1: number = 0

// ============================================
// PUBLIC API
// ============================================

export function initTimeSync(roomInstance: TimeSyncRoom) {
  room = roomInstance
  sessionId = generateSessionId()

  room.onMessage('timeSyncResponse', handleResponse)
  engine.addSystem(timeSyncSystem, undefined, 'ntp-time-sync')
}

export function getServerTime(): number {
  return Date.now() + serverTimeOffset
}

export function isTimeSyncReady(): boolean {
  return timeSyncReady
}

export function getTimeSyncOffset(): number {
  return serverTimeOffset
}

// ============================================
// INTERNAL
// ============================================

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function isRoomConnected(): boolean {
  const realmInfo = RealmInfo.getOrNull(engine.RootEntity)
  return realmInfo?.isConnectedSceneRoom ?? false
}

function sendRequest() {
  if (!room) return

  requestCounter++
  pendingRequestId = `${sessionId}:${requestCounter}`
  pendingT1 = Date.now()

  room.send('timeSync', { id: pendingRequestId })
}

function handleResponse(data: { id: string; t2: number; t3: number }) {
  // Ignore responses that don't match our pending request
  if (data.id !== pendingRequestId) {
    return
  }

  const t4 = Date.now()
  const t1 = pendingT1
  const t2 = data.t2
  const t3 = data.t3

  pendingRequestId = null

  const rtt = (t4 - t1) - (t3 - t2)
  const offset = ((t2 - t1) + (t3 - t4)) / 2

  samples.push({ offset, rtt })

  if (samples.length >= SAMPLES_NEEDED) {
    finalizeSamples()
  }
}

function finalizeSamples() {
  // Sort by RTT, remove outliers (best and worst)
  samples.sort((a, b) => a.rtt - b.rtt)
  const validSamples = samples.slice(1, -1)

  // Average the offsets
  serverTimeOffset = validSamples.reduce((sum, s) => sum + s.offset, 0) / validSamples.length

  samples = []
  isSyncing = false
  timeSyncReady = true
  resyncTimer = 0
}

function startSync() {
  isSyncing = true
  samples = []
  sampleTimer = SAMPLE_INTERVAL // Send immediately
  pendingRequestId = null
}

function timeSyncSystem(dt: number) {
  if (!room || !isRoomConnected()) return

  // Start initial sync when room connects
  if (!timeSyncReady && !isSyncing) {
    startSync()
    return
  }

  // Currently collecting samples
  if (isSyncing) {
    sampleTimer += dt

    // Timeout waiting for response
    if (pendingRequestId !== null && sampleTimer > 2) {
      pendingRequestId = null
      sampleTimer = 0
    }

    // Send next sample request
    if (pendingRequestId === null && sampleTimer >= SAMPLE_INTERVAL) {
      sampleTimer = 0
      sendRequest()
    }
    return
  }

  // Periodic re-sync (only when not currently syncing)
  resyncTimer += dt
  if (resyncTimer >= RESYNC_INTERVAL) {
    resyncTimer = 0
    startSync()
  }
}
