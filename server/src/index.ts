/**
 * Tower of Madness - Colyseus Server (Clock-Based Sync)
 * 
 * Uses real-world UTC time for round synchronization:
 * - Rounds are 7 minutes long
 * - 10 second break between rounds
 * - All players worldwide are in the same round
 * - Tower is generated deterministically from round number
 */

import express from 'express'
import cors from 'cors'
import http from 'http'
import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { TowerRoom } from './rooms/TowerRoom'

// Constants (must match TowerRoom.ts)
const ROUND_DURATION = 420 // 7 minutes
const BREAK_DURATION = 10  // 10 seconds
const TOTAL_CYCLE = ROUND_DURATION + BREAK_DURATION

console.log('═══════════════════════════════════════════════════════')
console.log('🎮 TOWER OF MADNESS - Colyseus Server')
console.log('═══════════════════════════════════════════════════════')
console.log(`Node.js version: ${process.version}`)
console.log(`⏰ Clock-Based Synchronization: ${ROUND_DURATION/60} min rounds`)
console.log('')

// Calculate current round info
function getCurrentRoundInfo() {
  const now = Math.floor(Date.now() / 1000)
  const roundNumber = Math.floor(now / TOTAL_CYCLE)
  const cycleProgress = now % TOTAL_CYCLE
  const isBreak = cycleProgress >= ROUND_DURATION
  const remainingTime = isBreak 
    ? TOTAL_CYCLE - cycleProgress 
    : ROUND_DURATION - cycleProgress
  
  return { roundNumber, isBreak, remainingTime }
}

// Create Express app with CORS enabled for ALL origins and methods
const app = express()

// CRITICAL: CORS must allow POST for matchmaking
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}))

// Handle preflight requests explicitly
app.options('*', cors())

app.use(express.json())

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`)
  next()
})

// Health check endpoints
app.get('/', (req, res) => {
  const info = getCurrentRoundInfo()
  const mins = Math.floor(info.remainingTime / 60)
  const secs = info.remainingTime % 60
  
  res.json({
    name: 'Tower of Madness Server',
    status: 'running',
    timestamp: new Date().toISOString(),
    currentRound: info.roundNumber,
    roundState: info.isBreak ? 'BREAK' : 'ACTIVE',
    timeRemaining: `${mins}:${secs.toString().padStart(2, '0')}`
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Create HTTP server from Express
const httpServer = http.createServer(app)

// Get port from environment
const PORT = parseInt(process.env.PORT || '2567', 10)

// Create Colyseus game server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 3000,
    pingMaxRetries: 3
  })
})

// Register the tower room
gameServer.define('tower_room', TowerRoom)
  .enableRealtimeListing()

console.log('📦 Room "tower_room" defined')

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('[ERROR] Uncaught Exception:', error)
})

// Start the server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`✅ Server listening on 0.0.0.0:${PORT}`)
  console.log(`📡 External URL: wss://towerofmadness-production.up.railway.app`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')
  
  const info = getCurrentRoundInfo()
  console.log(`⏰ Current round: #${info.roundNumber}`)
  console.log(`📍 State: ${info.isBreak ? 'BREAK' : 'ACTIVE'} (${info.remainingTime}s remaining)`)
  console.log('')
  console.log('🌍 All players worldwide sync to UTC clock!')
  console.log('🎯 Server ready! Waiting for players...')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Shutting down...')
  gameServer.gracefullyShutdown()
})

process.on('SIGINT', () => {
  console.log('📴 Shutting down...')
  gameServer.gracefullyShutdown()
})
