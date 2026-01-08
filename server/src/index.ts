/**
 * Tower of Madness - Colyseus Multiplayer Server
 * 
 * This server manages:
 * - Tower generation (same chunks for all players)
 * - 7-minute round timer with speed multiplier
 * - Player leaderboard and height tracking
 * - Winner determination and new round scheduling
 * 
 * Deploy to Railway:
 * 1. Push to GitHub
 * 2. Connect Railway to repo
 * 3. Set root directory to /server
 * 4. Railway auto-deploys and provides wss:// URL
 */

import express from 'express'
import cors from 'cors'
import { Server, matchMaker } from 'colyseus'
import { createServer } from 'http'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { monitor } from '@colyseus/monitor'
import { TowerRoom } from './rooms/TowerRoom'

console.log('═══════════════════════════════════════════════════════')
console.log('🎮 TOWER OF MADNESS - Colyseus Server')
console.log('═══════════════════════════════════════════════════════')
console.log(`Node.js version: ${process.version}`)
console.log('')

// Create Express app
const app = express()
app.use(cors())
app.use(express.json())

// Health check endpoint (for Railway/monitoring)
app.get('/', (req, res) => {
  res.json({
    name: 'Tower of Madness Server',
    status: 'running',
    timestamp: new Date().toISOString()
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Create HTTP server
const httpServer = createServer(app)

// Create Colyseus server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer
  })
})

// Register the tower room
gameServer.define('tower_room', TowerRoom)
  .enableRealtimeListing()

// Colyseus Monitor (admin panel) - only in dev
if (process.env.NODE_ENV !== 'production') {
  app.use('/colyseus', monitor())
  console.log('📊 Colyseus Monitor available at /colyseus')
}

// Get port from environment (Railway sets this) or use default
const PORT = parseInt(process.env.PORT || '2567', 10)

// Start the server - bind to 0.0.0.0 for external access
const HOST = '0.0.0.0'
httpServer.listen(PORT, HOST, () => {
  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`✅ Server listening on ${HOST}:${PORT}`)
  console.log(`📡 External URL: wss://towerofmadness-production.up.railway.app`)
  console.log('═══════════════════════════════════════════════════════')
  console.log('')
  
  // Create the persistent game room after a short delay
  // This ensures Colyseus is fully initialized
  setTimeout(async () => {
    console.log('🔧 Creating persistent room...')
    try {
      const room = await matchMaker.createRoom('tower_room', {})
      console.log(`🎮 Persistent room created: ${room.roomId}`)
      console.log('⏱️  Timer running independently of players!')
      console.log('')
      console.log('🎯 Game server ready! Rounds run 24/7.')
    } catch (error: any) {
      console.error('❌ Failed to create room:', error?.message || error)
      console.log('⚠️  Room will be created when first player joins')
    }
  }, 1000)
  
  console.log('Waiting for players to connect...')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('')
  console.log('📴 Received SIGTERM, shutting down gracefully...')
  gameServer.gracefullyShutdown()
})

process.on('SIGINT', () => {
  console.log('')
  console.log('📴 Received SIGINT, shutting down gracefully...')
  gameServer.gracefullyShutdown()
})
