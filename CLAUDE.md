# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tower of Madness is a multiplayer tower climbing game for Decentraland built with SDK7. Uses the **Decentraland Authoritative Server pattern** where the same codebase runs on both server and client, branched by `isServer()`.

For a comprehensive guide on the authoritative server pattern, see `AUTHORITATIVE_SERVER_GUIDE.md`.

## Commands

```bash
npm run build                      # Build for production
npx @dcl/hammurabi-server@next     # Run with authoritative server (required for multiplayer)
npm run start                      # Standard dev server (no auth server)
npm run deploy                     # Deploy to Decentraland
```

## Architecture

### Directory Structure

```
src/
├── index.ts              # Entry point - branches server/client via isServer()
├── multiplayer.ts        # Client-side state sync helpers and message sending
├── ui.tsx                # React ECS UI components
├── server/
│   ├── server.ts         # Server main logic, timer system, message handlers
│   └── gameState.ts      # Server state management, tower entity creation, all-time leaderboard
└── shared/
    ├── schemas.ts        # Synced component definitions with validateBeforeChange()
    ├── messages.ts       # Message definitions via registerMessages()
    └── timeSync.ts       # NTP-style time synchronization

assets/chunks/            # GLB tower chunk models (Chunk01-03, ChunkEnd, ChunkStart)
```

### Key Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point. Uses `isServer()` to branch to server or client code |
| `shared/schemas.ts` | `RoundStateComponent`, `LeaderboardComponent`, `WinnersComponent`, `ChunkComponent` |
| `shared/messages.ts` | `playerJoin`, `playerStarted`, `playerFinished`, `playerFinishedBroadcast`, `timeSync` |
| `server/server.ts` | Timer system, height tracking via LiveKit, message handlers, anti-cheat validation |
| `server/gameState.ts` | GameState singleton, tower creation, all-time leaderboard persistence |
| `multiplayer.ts` | `getRoundState()`, `getLeaderboard()`, `sendPlayerJoined()`, `sendPlayerStarted()` |
| `ui.tsx` | Game HUD - timer, leaderboard (all-time bests), personal stats, winners display |

### Authoritative Server Pattern

**Key Concept**: Server runs the scene code headlessly and has access to player positions via `getPlayer()` from `@dcl/sdk/players` (LiveKit). This enables server-side validation without trusting client data.

**Server-authoritative components** (defined in `shared/schemas.ts`):
- `RoundStateComponent` - roundId, phase, baseTimer, speedMultiplier, lastSpeedChangeTime, remainingAtSpeedChange, finisherCount
- `LeaderboardComponent` - players array with all-time bests (allTimeBestTime, allTimeBestHeight, allTimeFinishCount)
- `WinnersComponent` - top 3 winners per round
- `TowerConfigComponent` - chunkIds, chunkHeight, totalHeight
- `ChunkComponent` - empty tag component to identify tower chunk entities

Components use `validateBeforeChange()` to ensure only the server can modify them.

**Messages** (defined in `shared/messages.ts`):
- Client→Server: `playerJoin`, `playerStarted`, `playerFinished`, `timeSync`
- Server→Client: `playerFinishedBroadcast` (includes server-calculated time), `timeSyncResponse`

**Tower Entities**: Server creates tower chunks with `Transform` + `GltfContainer` + `VisibilityComponent` + `ChunkComponent` and syncs them via `syncEntity()`. Entity pooling is used - chunks are shown/hidden via `VisibilityComponent`.

### Anti-Cheat System

Server-authoritative timing and position validation:

1. **Height tracking**: Server reads player positions via `getPlayer({ userId })` from `@dcl/sdk/players` (LiveKit) every 0.5s
2. **Start validation**: Player must be below 20m to start an attempt (prevents starting mid-tower)
3. **Finish validation**: Player must be within 5m of tower top to finish (prevents early finish claims)
4. **Time calculation**: Server calculates finish time from `attemptStartTime` timestamp (ignores client-sent time)

```typescript
// Server validates start position
const maxStartHeight = 20
if (currentHeight > maxStartHeight) {
  // Reject - player too high to start
}

// Server validates finish position
const minFinishHeight = towerConfig.totalHeight - 5
if (currentHeight < minFinishHeight) {
  // Reject - player not high enough to finish
}

// Server calculates authoritative time
const serverTime = (Date.now() - player.attemptStartTime) / 1000
```

### Leaderboard System

**All-time persistence** (memory-only, resets on server restart):
- `allTimeBests` Map stores best time, best height, and finish count per player address
- Leaderboard always shows all-time bests, sorted by: finishers first (by best time), then by best height
- Data persists across rounds but not server restarts

### Game Flow

1. Server generates random tower (3-8 chunks) at round start
2. Tower entities synced to clients via `syncEntity()`
3. Client updates `TriggerEnd` position based on `towerConfig.totalHeight`
4. 7-minute countdown with speed multiplier (increases when players finish)
5. Server tracks player heights from LiveKit positions (every 0.5s)
6. When timer hits 0: ENDING phase (3s) → BREAK phase (10s) → new round

### Round Phases

```
ACTIVE  → Players climb, timer counts down
ENDING  → 3 seconds, show top 3 winners
BREAK   → 10 seconds pause, then start new round
```

## Code Patterns

### Server/Client Branching

```typescript
if (isServer()) {
  server()  // Server-only
  return
}
// Client-only code below
```

### Getting Player Position (Server)

```typescript
import { getPlayer } from '@dcl/sdk/players'

const liveKitPlayer = getPlayer({ userId: playerAddress })
const height = liveKitPlayer?.position?.y || 0
```

### Synced Components

```typescript
export const MyComponent = engine.defineComponent('namespace:Name', {
  field: Schemas.Number
})
MyComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})
```

### Entity Pooling with Visibility

```typescript
// Create pooled entities once
const entity = engine.addEntity()
VisibilityComponent.create(entity, { visible: false })
syncEntity(entity, [Transform.componentId, GltfContainer.componentId, VisibilityComponent.componentId])

// Show/hide as needed
VisibilityComponent.getMutable(entity).visible = true
```

### Reading Synced State (Client)

```typescript
export function getRoundState() {
  for (const [entity] of engine.getEntitiesWith(RoundStateComponent)) {
    return RoundStateComponent.get(entity)
  }
  return null
}
```

## Code Style

Prettier configured: single quotes, no semicolons, 120 char width, no trailing commas.

## Troubleshooting

### "Outside of bounds" CRDT Error

Delete `.crdt` files when changing schemas:
```bash
rm *.crdt
```

### Entities Not Rendering on Client

1. Check server logs show entity creation
2. Verify `syncEntity()` is called with correct component IDs
3. Check `VisibilityComponent.visible` is true
4. Check client debug logs for received entities

### Finish Not Registering

1. Check server logs for height validation: `[Server] Finish attempt: height=X, towerHeight=Y, minRequired=Z`
2. Verify `TriggerEnd` position updated: `[Game] Updated TriggerEnd position to height Xm`
3. Ensure player started attempt first (check for `[Server] Rejected finish: no active attempt`)

## Requirements

- Node.js >= 20.0.0
- SDK: Special authoritative server build (see package.json)
- Run with: `npx @dcl/hammurabi-server@next`
