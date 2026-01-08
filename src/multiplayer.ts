/**
 * Tower of Madness - Multiplayer System (Colyseus Client)
 * 
 * Connects to Colyseus server for:
 * - Synchronized tower generation
 * - Shared timer with speed multiplier
 * - Leaderboard updates
 * - Round lifecycle management
 * 
 * Server URL Configuration:
 * - Development: ws://localhost:2567
 * - Production: wss://your-railway-url.up.railway.app
 */

// @ts-ignore - colyseus.js types may not be available at compile time
import * as Colyseus from 'colyseus.js'

// Declare global window for URL parameter parsing (may not exist in all environments)
declare const window: { location?: { search: string } } | undefined

// ============================================
// TYPE DEFINITIONS
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

// ============================================
// CONFIGURATION
// ============================================

// Server URL - Change this for production!
// Development: ws://localhost:2567
// Production: wss://your-app.up.railway.app
const DEFAULT_SERVER_URL = 'ws://localhost:2567'

function getServerUrl(): string {
  // In browser/Decentraland, we can check URL params or use default
  // For production, you'll want to hardcode your Railway URL here
  
  // Try to get from URL params (for testing)
  try {
    if (typeof window !== 'undefined' && window && window.location) {
      // Use globalThis.URLSearchParams if available
      const URLSearchParamsClass = (globalThis as any).URLSearchParams
      if (URLSearchParamsClass) {
        const params = new URLSearchParamsClass(window.location.search)
        const serverUrl = params.get('server')
        if (serverUrl) {
          console.log(`[Multiplayer] Using server from URL param: ${serverUrl}`)
          return serverUrl
        }
      }
    }
  } catch (e) {
    // Ignore - not in browser
  }
  
  // === PRODUCTION URL ===
  // Your Railway server
  return 'wss://towerofmadness-production.up.railway.app'
  
  // For local testing, comment above and use:
  // return DEFAULT_SERVER_URL
}

// ============================================
// STATE
// ============================================

let client: Colyseus.Client | null = null
let room: Colyseus.Room | null = null
let multiplayerInitialized = false
let connectionFailed = false

// Callbacks (set by index.ts)
let onServerTowerReadyCallback: ((chunks: string[]) => void) | null = null
let onTimerUpdateCallback: ((remaining: number, multiplier: number) => void) | null = null
let onLeaderboardUpdateCallback: ((players: LeaderboardEntry[]) => void) | null = null
let onGameEndedCallback: ((winners: WinnerEntry[]) => void) | null = null

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize multiplayer connection to Colyseus server
 * Returns true if connected, false if failed
 */
export async function initMultiplayer(): Promise<boolean> {
  if (multiplayerInitialized) {
    return room !== null
  }
  
  multiplayerInitialized = true
  const serverUrl = getServerUrl()
  
  console.log('[Multiplayer] ═══════════════════════════════════')
  console.log('[Multiplayer] 🔌 Connecting to Colyseus server...')
  console.log(`[Multiplayer] URL: ${serverUrl}`)
  console.log('[Multiplayer] ═══════════════════════════════════')
  
  try {
    // Create Colyseus client
    client = new Colyseus.Client(serverUrl)
    
    // Join or create the tower room
    room = await client.joinOrCreate('tower_room', {
      displayName: 'Player', // Will be updated later
    })
    
    console.log('[Multiplayer] ✅ Connected!')
    console.log(`[Multiplayer] Session ID: ${room.sessionId}`)
    console.log(`[Multiplayer] Room ID: ${room.roomId}`)
    
    // Set up state change listeners
    setupStateListeners()
    
    return true
  } catch (error) {
    connectionFailed = true
    console.error('[Multiplayer] ❌ Connection failed:', error)
    console.log('[Multiplayer] Falling back to SINGLE-PLAYER mode')
    return false
  }
}

/**
 * Set up listeners for Colyseus state changes
 */
function setupStateListeners() {
  if (!room) return
  
  // Track previous chunk IDs to detect tower changes
  let previousChunkIds: string[] = []
  
  // Main state change listener
  room.onStateChange((state: any) => {
    // Check if tower changed (new round)
    const currentChunkIds = Array.from(state.chunkIds || []) as string[]
    const chunksChanged = JSON.stringify(currentChunkIds) !== JSON.stringify(previousChunkIds)
    
    if (chunksChanged && currentChunkIds.length > 0) {
      previousChunkIds = currentChunkIds
      console.log(`[Multiplayer] 🗼 New tower received: [${currentChunkIds.join(' → ')}]`)
      
      if (onServerTowerReadyCallback) {
        onServerTowerReadyCallback(currentChunkIds)
      }
    }
    
    // Update timer
    if (onTimerUpdateCallback) {
      onTimerUpdateCallback(state.remainingTime || 0, state.speedMultiplier || 1)
    }
    
    // Update leaderboard
    if (onLeaderboardUpdateCallback && state.players) {
      const players: LeaderboardEntry[] = []
      state.players.forEach((player: any) => {
        players.push({
          address: player.address || '',
          displayName: player.displayName || '',
          maxHeight: player.maxHeight || 0,
          bestTime: player.bestTime || 0,
          isFinished: player.isFinished || false,
          finishOrder: player.finishOrder || 0
        })
      })
      
      // Sort by finish order (if finished) or height
      players.sort((a, b) => {
        if (a.isFinished && b.isFinished) {
          return a.finishOrder - b.finishOrder
        }
        if (a.isFinished) return -1
        if (b.isFinished) return 1
        return b.maxHeight - a.maxHeight
      })
      
      onLeaderboardUpdateCallback(players)
    }
  })
  
  // Listen for round ended message
  room.onMessage('roundEnded', (data: { winners: WinnerEntry[] }) => {
    console.log('[Multiplayer] 🏁 Round ended!')
    if (onGameEndedCallback) {
      onGameEndedCallback(data.winners)
    }
  })
  
  // Listen for new round message
  room.onMessage('newRound', (data: { roundId: string; chunkIds: string[] }) => {
    console.log(`[Multiplayer] 🎮 New round: ${data.roundId}`)
    console.log(`[Multiplayer] Tower: [${data.chunkIds.join(' → ')}]`)
    
    if (onServerTowerReadyCallback) {
      onServerTowerReadyCallback(data.chunkIds)
    }
  })
  
  // Listen for player finished
  room.onMessage('playerFinished', (data: any) => {
    console.log(`[Multiplayer] 🏆 ${data.displayName} finished! (${data.finishOrder}${getOrdinalSuffix(data.finishOrder)}) - Timer x${data.speedMultiplier}`)
  })
  
  // Connection error handling
  room.onError((code: number, message?: string) => {
    console.error(`[Multiplayer] ❌ Room error (${code}): ${message}`)
  })
  
  room.onLeave((code: number) => {
    console.log(`[Multiplayer] 👋 Left room (code: ${code})`)
    room = null
  })
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0]
}

// ============================================
// PUBLIC API - Callbacks
// ============================================

export function setOnServerTowerReady(callback: ((chunks: string[]) => void) | null) {
  onServerTowerReadyCallback = callback
}

export function setOnTimerUpdate(callback: ((remaining: number, multiplier: number) => void) | null) {
  onTimerUpdateCallback = callback
}

export function setOnLeaderboardUpdate(callback: ((players: LeaderboardEntry[]) => void) | null) {
  onLeaderboardUpdateCallback = callback
}

export function setOnGameEnded(callback: ((winners: WinnerEntry[]) => void) | null) {
  onGameEndedCallback = callback
}

// ============================================
// PUBLIC API - State Checks
// ============================================

export function isServer(): boolean {
  // Colyseus uses a separate server - client is never the server
  return false
}

export function isMultiplayerAvailable(): boolean {
  return room !== null && !connectionFailed
}

// ============================================
// PUBLIC API - Setup (compatibility with existing code)
// ============================================

export function setupServer() {
  // No-op for Colyseus - server is separate process
  console.log('[Multiplayer] setupServer() called - Colyseus server is separate process')
}

export function setupClient() {
  // State listeners already set up in initMultiplayer
  console.log('[Multiplayer] setupClient() called - listeners already configured')
}

// ============================================
// PUBLIC API - Send Messages to Server
// ============================================

/**
 * Send current height to server (throttled by caller)
 */
export function sendHeightUpdate(height: number) {
  if (!room) return
  
  room.send('playerHeight', { height })
}

/**
 * Send player finished event
 */
export function sendPlayerFinished(time: number, height: number) {
  if (!room) return
  
  console.log(`[Multiplayer] 📤 Sending finish: ${time.toFixed(2)}s, ${height.toFixed(1)}m`)
  room.send('playerFinished', { time, height })
}

/**
 * Send player death event
 */
export function sendPlayerDied(height: number) {
  if (!room) return
  
  console.log(`[Multiplayer] 📤 Sending death at ${height.toFixed(1)}m`)
  room.send('playerDied', { height })
}

/**
 * Send player joined with display name
 */
export function sendPlayerJoined(displayName: string, address?: string) {
  if (!room) return
  
  console.log(`[Multiplayer] 📤 Sending player info: ${displayName}`)
  room.send('playerJoined', { displayName, address })
}

// ============================================
// UTILITIES
// ============================================

/**
 * Format seconds as M:SS
 */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Disconnect from server
 */
export function disconnect() {
  if (room) {
    room.leave()
    room = null
  }
  console.log('[Multiplayer] Disconnected')
}

/**
 * Get current room session ID (for debugging)
 */
export function getSessionId(): string | null {
  return room?.sessionId || null
}
