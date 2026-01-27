# Decentraland Authoritative Server Pattern - Guide

This guide explains how to build multiplayer Decentraland scenes using the **Authoritative Server Pattern**. The same codebase runs on both server and client, with server having full authority over game state.

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Core Concepts](#core-concepts)
4. [Step-by-Step Implementation](#step-by-step-implementation)
5. [Best Practices](#best-practices)
6. [Common Patterns](#common-patterns)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### What is the Authoritative Server Pattern?

In this pattern:
- **Server** runs your scene code headlessly (no rendering)
- **Server** has access to all player positions via `PlayerIdentityData`
- **Server** creates and manages game state
- **Clients** receive synced state automatically via CRDT
- **Clients** send messages to server for actions (join, finish, etc.)

### Benefits

- **Anti-cheat**: Server validates all game logic, clients can't lie
- **Consistency**: All players see the same state
- **Simplicity**: Single codebase for server and client

### Requirements

```json
{
  "devDependencies": {
    "@dcl/sdk": "https://sdk-team-cdn.decentraland.org/@dcl/js-sdk-toolchain/branch/feat/authorative-server/dcl-sdk-7.17.1-20817812456.commit-4abc8ac.tgz"
  }
}
```

Run with: `npx @dcl/hammurabi-server@next`

---

## Project Structure

```
src/
├── index.ts              # Entry point - branches server/client
├── multiplayer.ts        # Client-side helpers and message sending
├── ui.tsx                # React ECS UI components
├── server/
│   ├── server.ts         # Server main logic and systems
│   └── gameState.ts      # Server state management
└── shared/
    ├── schemas.ts        # Component definitions (synced state)
    └── messages.ts       # Message definitions (client↔server)
```

### File Responsibilities

| File | Purpose |
|------|---------|
| `index.ts` | Entry point. Uses `isServer()` to branch logic |
| `shared/schemas.ts` | Define synced components with `validateBeforeChange()` |
| `shared/messages.ts` | Define messages with `registerMessages()` |
| `server/server.ts` | Server initialization, systems, message handlers |
| `server/gameState.ts` | Server state class, entity management |
| `multiplayer.ts` | Client helpers: `getRoundState()`, `sendPlayerJoined()` |
| `ui.tsx` | React ECS UI that reads exported state |

---

## Core Concepts

### 1. Server/Client Branching

```typescript
// index.ts
import { isServer } from '@dcl/sdk/network'

export async function main() {
  if (isServer()) {
    // Server-only code
    server()
    return
  }

  // Client-only code
  setupClient()
  setupUi()
}
```

### 2. Synced Components (schemas.ts)

Components that automatically sync from server to all clients:

```typescript
import { engine, Schemas } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Define a synced component
export const GameStateComponent = engine.defineComponent('game:State', {
  score: Schemas.Number,
  phase: Schemas.String,
  timeRemaining: Schemas.Number
})

// IMPORTANT: Restrict modification to server only (global for custom components)
GameStateComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})
```

**Note**: For built-in components like `Transform` and `GltfContainer`, use per-entity validation instead (see Best Practices).

**Schema Types Available:**
- `Schemas.String`
- `Schemas.Number`
- `Schemas.Boolean`
- `Schemas.EnumString<T>(enumType, defaultValue)`
- `Schemas.Array(innerSchema)`
- `Schemas.Map({ field: Schema, ... })`

### 3. Syncing Entities (syncEntity)

Server creates entities and syncs them to clients:

```typescript
import { syncEntity } from '@dcl/sdk/network'

// Server creates entity
const entity = engine.addEntity()
Transform.create(entity, { position: Vector3.create(10, 5, 10) })
GameStateComponent.create(entity, { score: 0, phase: 'ACTIVE', timeRemaining: 300 })

// Sync to all clients
syncEntity(entity, [Transform.componentId, GameStateComponent.componentId])
```

### 4. Messages (messages.ts)

For client-to-server and server-to-client communication:

```typescript
import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // Client -> Server
  playerJoin: Schemas.Map({
    displayName: Schemas.String
  }),

  playerAction: Schemas.Map({
    actionType: Schemas.String,
    data: Schemas.Number
  }),

  // Server -> Client (broadcast)
  gameEvent: Schemas.Map({
    eventType: Schemas.String,
    playerName: Schemas.String
  })
}

export const room = registerMessages(Messages)
```

**Sending Messages:**

```typescript
// Client sends to server
room.send('playerJoin', { displayName: 'Alice' })

// Server sends to all clients
room.send('gameEvent', { eventType: 'PLAYER_SCORED', playerName: 'Alice' })
```

**Receiving Messages:**

```typescript
// Server receives from client
room.onMessage('playerJoin', (data, context) => {
  if (!context) return
  const playerAddress = context.from  // Wallet address
  console.log(`Player joined: ${data.displayName}`)
})

// Client receives from server
room.onMessage('gameEvent', (data) => {
  console.log(`Event: ${data.eventType} by ${data.playerName}`)
})
```

### 5. Reading Player Positions (Server-Side)

The server can read actual player positions - key for anti-cheat:

```typescript
import { PlayerIdentityData, Transform } from '@dcl/sdk/ecs'

// Server system to track player heights
engine.addSystem((dt) => {
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const transform = Transform.getOrNull(entity)
    if (!transform) continue

    const playerAddress = identity.address
    const playerHeight = transform.position.y

    // Use actual position, not client-reported
    updatePlayerHeight(playerAddress, playerHeight)
  }
})
```

---

## Step-by-Step Implementation

### Step 1: Define Your Game State (schemas.ts)

```typescript
import { engine, Schemas } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

export enum GamePhase {
  WAITING = 'WAITING',
  PLAYING = 'PLAYING',
  ENDED = 'ENDED'
}

export const RoundStateComponent = engine.defineComponent('game:RoundState', {
  roundId: Schemas.String,
  phase: Schemas.EnumString<GamePhase>(GamePhase, GamePhase.WAITING),
  timeRemaining: Schemas.Number,
  playerCount: Schemas.Number
})

RoundStateComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})
```

### Step 2: Define Messages (messages.ts)

```typescript
import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  playerJoin: Schemas.Map({ displayName: Schemas.String }),
  playerReady: Schemas.Map({}),
  playerFinished: Schemas.Map({ time: Schemas.Number }),

  announceWinner: Schemas.Map({
    playerName: Schemas.String,
    time: Schemas.Number
  })
}

export const room = registerMessages(Messages)
```

### Step 3: Create Server Logic (server/server.ts)

```typescript
import { engine } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import { GameState } from './gameState'

export function server() {
  console.log('[Server] Starting...')

  const gameState = GameState.getInstance()
  gameState.init()

  // Handle messages
  room.onMessage('playerJoin', (data, context) => {
    if (!context) return
    gameState.addPlayer(context.from, data.displayName)
  })

  room.onMessage('playerFinished', (data, context) => {
    if (!context) return
    gameState.playerFinished(context.from, data.time)
  })

  // Game loop system
  engine.addSystem((dt) => {
    gameState.update(dt)
  })

  console.log('[Server] Ready')
}
```

### Step 4: Create Server State (server/gameState.ts)

```typescript
import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { RoundStateComponent, GamePhase } from '../shared/schemas'

export class GameState {
  private static instance: GameState
  private stateEntity!: Entity

  static getInstance(): GameState {
    if (!GameState.instance) {
      GameState.instance = new GameState()
    }
    return GameState.instance
  }

  init() {
    // Create synced state entity
    this.stateEntity = engine.addEntity()
    RoundStateComponent.create(this.stateEntity, {
      roundId: '',
      phase: GamePhase.WAITING,
      timeRemaining: 0,
      playerCount: 0
    })
    syncEntity(this.stateEntity, [RoundStateComponent.componentId])
  }

  update(dt: number) {
    const state = RoundStateComponent.getMutable(this.stateEntity)
    if (state.phase === GamePhase.PLAYING) {
      state.timeRemaining -= dt
      if (state.timeRemaining <= 0) {
        state.phase = GamePhase.ENDED
      }
    }
  }
}
```

### Step 5: Create Client Logic (multiplayer.ts)

```typescript
import { engine } from '@dcl/sdk/ecs'
import { room } from './shared/messages'
import { RoundStateComponent, GamePhase } from './shared/schemas'

export { isServer } from '@dcl/sdk/network'

export function setupClient() {
  room.onMessage('announceWinner', (data) => {
    console.log(`Winner: ${data.playerName} in ${data.time}s!`)
  })
}

export function sendPlayerJoined(name: string) {
  room.send('playerJoin', { displayName: name })
}

export function getRoundState() {
  for (const [entity] of engine.getEntitiesWith(RoundStateComponent)) {
    return RoundStateComponent.get(entity)
  }
  return null
}
```

### Step 6: Wire It Up (index.ts)

```typescript
import { isServer } from '@dcl/sdk/network'
import { server } from './server/server'
import { setupClient, sendPlayerJoined, getRoundState } from './multiplayer'
import { setupUi } from './ui'

export async function main() {
  if (isServer()) {
    server()
    return
  }

  // Client setup
  setupClient()

  // Wait for connection, then join
  let joined = false
  engine.addSystem(() => {
    if (!joined && getRoundState()) {
      joined = true
      sendPlayerJoined('Player')
    }
  })

  setupUi()
}
```

---

## Best Practices

### 1. Always Use validateBeforeChange

For **custom components** (global validation):
```typescript
// ALWAYS add this to server-authoritative components
MyComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})
```

For **built-in components** (per-entity validation):
```typescript
// Use entity-specific validation for built-in components like Transform, GltfContainer
// This protects only server-synced entities, not all entities
function protectServerEntity(entity: Entity, components: ComponentWithValidation[]) {
  for (const component of components) {
    component.validateBeforeChange(entity, (value) => {
      return value.senderAddress === AUTH_SERVER_PEER_ID
    })
  }
}

// Usage
protectServerEntity(entity, [Transform, GltfContainer])
```

**Important**:
- Custom components use global `validateBeforeChange((value) => ...)`
- Built-in components use per-entity `validateBeforeChange(entity, (value) => ...)` so you don't block client-side transforms

### 2. Server Tracks Player Positions

Don't trust client-reported positions:

```typescript
// BAD - Client can lie
room.onMessage('updatePosition', (data) => {
  player.position = data.position  // Never trust this!
})

// GOOD - Server reads actual position
for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
  const transform = Transform.get(entity)
  player.position = transform.position  // Actual position
}
```

### 3. Handle Connection State

```typescript
// Client should wait for server state before acting
export let isConnected = false

function syncState() {
  const state = getRoundState()
  if (!state) return

  if (!isConnected) {
    isConnected = true
    console.log('Connected to server!')
    sendPlayerJoined('Player')
  }
}

engine.addSystem(syncState)
```
---

## Common Patterns

### Timer with Speed Multiplier

```typescript
// Server
updateTimer(): boolean {
  const elapsed = (Date.now() - this.startTime) / 1000
  const adjustedElapsed = elapsed * this.speedMultiplier
  const remaining = Math.max(0, TOTAL_TIME - adjustedElapsed)

  state.timeRemaining = remaining
  return remaining <= 0
}

// Speed up when player finishes
playerFinished() {
  this.speedMultiplier++
}
```

### Round Lifecycle

```typescript
enum RoundPhase {
  ACTIVE = 'ACTIVE',    // Game in progress
  ENDING = 'ENDING',    // Show results (3s)
  BREAK = 'BREAK'       // Wait before next round (10s)
}

// Server system
if (phase === RoundPhase.ACTIVE && timerExpired) {
  setPhase(RoundPhase.ENDING)
} else if (phase === RoundPhase.ENDING && elapsed > 3) {
  setPhase(RoundPhase.BREAK)
} else if (phase === RoundPhase.BREAK && elapsed > 10) {
  startNewRound()
}
```

### Leaderboard with Complex Data

```typescript
export const LeaderboardComponent = engine.defineComponent('game:Leaderboard', {
  players: Schemas.Array(
    Schemas.Map({
      address: Schemas.String,
      displayName: Schemas.String,
      score: Schemas.Number,
      isFinished: Schemas.Boolean
    })
  )
})
```

---

## Time Synchronization (NTP-Style)

When calculating timers or synchronized events, server and client clocks may differ. Use NTP-style time synchronization to calculate the offset between client and server time.

### Why Time Sync is Needed

- Server's `Date.now()` and client's `Date.now()` can be seconds apart
- Timer displays will be inconsistent without synchronization
- Speed multipliers and time-based calculations require accurate server time

### Implementation

Create a reusable time sync module (`shared/timeSync.ts`):

```typescript
import { engine } from '@dcl/sdk/ecs'
import { RealmInfo } from '@dcl/sdk/ecs'

interface TimeSyncRoom {
  send: (type: string, data: any) => void
  onMessage: (type: string, handler: (data: any) => void) => void
}

const SAMPLES_NEEDED = 5
const SAMPLE_INTERVAL = 0.15 // seconds
const RESYNC_INTERVAL = 60   // seconds

let room: TimeSyncRoom | null = null
let sessionId: string = ''
let serverTimeOffset = 0
let timeSyncReady = false
let isSyncing = false
let samples: { offset: number; rtt: number }[] = []
let pendingRequestId: string | null = null
let pendingT1: number = 0

export function initTimeSync(roomInstance: TimeSyncRoom) {
  room = roomInstance
  sessionId = Math.random().toString(36).substring(2, 10)
  room.onMessage('timeSyncResponse', handleResponse)
  engine.addSystem(timeSyncSystem, undefined, 'ntp-time-sync')
}

export function getServerTime(): number {
  return Date.now() + serverTimeOffset
}

export function isTimeSyncReady(): boolean {
  return timeSyncReady
}

function handleResponse(data: { id: string; t2: number; t3: number }) {
  if (data.id !== pendingRequestId) return

  const t4 = Date.now()
  const t1 = pendingT1
  pendingRequestId = null

  const rtt = (t4 - t1) - (data.t3 - data.t2)
  const offset = ((data.t2 - t1) + (data.t3 - t4)) / 2
  samples.push({ offset, rtt })

  if (samples.length >= SAMPLES_NEEDED) {
    finalizeSamples()
  }
}

function finalizeSamples() {
  samples.sort((a, b) => a.rtt - b.rtt)
  const validSamples = samples.slice(1, -1) // Remove outliers
  serverTimeOffset = validSamples.reduce((sum, s) => sum + s.offset, 0) / validSamples.length
  samples = []
  isSyncing = false
  timeSyncReady = true
}
```

### Message Schema (Critical: Use Int64)

**Important**: Use `Schemas.Int64` for timestamps, not `Schemas.Number`. Large timestamp values (13+ digits) get corrupted with `Schemas.Number`.

```typescript
// messages.ts
export const Messages = {
  timeSync: Schemas.Map({
    id: Schemas.String  // Session ID + counter
  }),

  timeSyncResponse: Schemas.Map({
    id: Schemas.String,
    t2: Schemas.Int64,  // Server receive time - MUST be Int64!
    t3: Schemas.Int64   // Server send time - MUST be Int64!
  })
}
```

### Server Handler

Send response only to the requesting client:

```typescript
// server.ts
room.onMessage('timeSync', (data, context) => {
  if (!context) return
  const t2 = Date.now()
  const t3 = Date.now()
  room.send('timeSyncResponse', {
    id: data.id,
    t2: t2,
    t3: t3
  }, { to: [context.from] })  // Send only to requester!
})
```

### Key Learnings

1. **No setTimeout/setInterval**: DCL doesn't support these. Use `engine.addSystem()` with a timer variable instead.

2. **Wait for room connection**: Check `RealmInfo.get(engine.RootEntity).isConnectedSceneRoom` before sending sync requests.

3. **Session IDs filter stale messages**: Generate a unique session ID per client session. Include it in requests and only accept responses matching your pending request ID.

4. **Schemas.Int64 for timestamps**: `Schemas.Number` corrupts large numbers. Timestamps like `1767979970778` will be received incorrectly. Always use `Schemas.Int64`.

5. **Periodic re-sync**: Re-sync every 60 seconds to account for clock drift.

---

## Reading Local Player Data

Each client can see all players' positions via `PlayerIdentityData` components. Use this for real-time UI updates instead of relying on server-synced state.

### Getting All Player Heights Locally

```typescript
import { engine, Transform, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'

export type LocalPlayerHeight = {
  address: string
  displayName: string
  height: number
}

export function getLocalPlayerHeights(): LocalPlayerHeight[] {
  const players: LocalPlayerHeight[] = []

  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
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

  players.sort((a, b) => b.height - a.height)
  return players
}
```

### When to Use Local vs Server Data

| Data Type | Use Local | Use Server |
|-----------|-----------|------------|
| Real-time player positions | ✅ | ❌ |
| Current player heights | ✅ | ❌ |
| Finish times/status | ❌ | ✅ |
| Leaderboard rankings | ❌ | ✅ |
| Game phase/timer | ❌ | ✅ |

**Note**: The server should still track heights for final results and anti-cheat validation, but clients can use local data for smoother real-time UI updates.

---

## Troubleshooting

### "Outside of the bounds of written data" Error

**Cause**: Stale `.crdt` files with old schema data.

**Fix**: Delete `main.crdt` and `main1.crdt` files and restart.

### Entities Not Syncing to Clients

**Check**:
1. Are you calling `syncEntity(entity, [componentIds])`?
2. Is the component ID correct? Use `MyComponent.componentId`
3. Is the server actually creating the entities?

### Messages Not Received

**Check**:
1. Is `registerMessages()` called before use?
2. Server: Does `context` exist in handler?
3. Client: Is `room.onMessage()` set up before messages arrive?

### Component Validation Fails

**Check**:
1. Is `AUTH_SERVER_PEER_ID` imported correctly?
2. Is `validateBeforeChange` returning `true` for server?

```typescript
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

MyComponent.validateBeforeChange((value) => {
  console.log('Sender:', value.senderAddress)
  console.log('Expected:', AUTH_SERVER_PEER_ID)
  return value.senderAddress === AUTH_SERVER_PEER_ID
})
```

---

## Quick Reference

### Imports

```typescript
// ECS
import { engine, Entity, Transform, GltfContainer, Schemas } from '@dcl/sdk/ecs'

// Network
import { isServer, syncEntity } from '@dcl/sdk/network'
import { registerMessages } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Player data (server)
import { PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
```

### Protecting Server-Synced Entities

```typescript
// For built-in components, use per-entity validation
import { Entity, Transform, GltfContainer } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Helper type for components with validateBeforeChange
type ComponentWithValidation = {
  validateBeforeChange: (entity: Entity, cb: (value: { senderAddress: string }) => boolean) => void
}

// Call after creating each server entity
function protectServerEntity(entity: Entity, components: ComponentWithValidation[]) {
  for (const component of components) {
    component.validateBeforeChange(entity, (value) => {
      return value.senderAddress === AUTH_SERVER_PEER_ID
    })
  }
}

// Usage
const entity = engine.addEntity()
Transform.create(entity, { position: Vector3.create(10, 5, 10) })
GltfContainer.create(entity, { src: 'assets/model.glb' })
protectServerEntity(entity, [Transform, GltfContainer])
syncEntity(entity, [Transform.componentId, GltfContainer.componentId])
```

### Commands

```bash
npm run build                      # Build scene
npx @dcl/hammurabi-server@next     # Run with authoritative server
npm run start                      # Standard dev server (no auth server)
```

---

## Example: Tower of Madness

This project demonstrates:
- Server-generated tower entities synced to clients
- Server-side player height tracking (anti-cheat)
- Timer with speed multiplier
- Round lifecycle (ACTIVE -> ENDING -> BREAK)
- Leaderboard and winners display
- Client UI reading synced state

See the source code for a complete implementation example.
