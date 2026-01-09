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
│   └── gameState.ts      # Server state management, tower entity creation
└── shared/
    ├── schemas.ts        # Synced component definitions with validateBeforeChange()
    └── messages.ts       # Message definitions via registerMessages()

assets/chunks/            # GLB tower chunk models (Chunk01-03, ChunkEnd, ChunkStart)
```

### Key Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point. Uses `isServer()` to branch to server or client code |
| `shared/schemas.ts` | `RoundStateComponent`, `LeaderboardComponent`, `WinnersComponent` |
| `shared/messages.ts` | `playerJoin`, `playerFinished`, `playerFinishedBroadcast` |
| `server/server.ts` | Timer system, height tracking, message handlers |
| `server/gameState.ts` | GameState singleton, tower creation with `syncEntity()` |
| `multiplayer.ts` | `getRoundState()`, `getLeaderboard()`, `sendPlayerJoined()` |
| `ui.tsx` | Game HUD - timer, leaderboard, personal stats, winners display |

### Authoritative Server Pattern

**Key Concept**: Server runs the scene code headlessly and has access to player positions via `PlayerIdentityData`. This enables server-side validation without trusting client data.

**Server-authoritative components** (defined in `shared/schemas.ts`):
- `RoundStateComponent` - roundId, phase, remainingTime, speedMultiplier, finisherCount
- `LeaderboardComponent` - players array with heights and times
- `WinnersComponent` - top 3 winners

Components use `validateBeforeChange()` to ensure only the server can modify them.

**Messages** (defined in `shared/messages.ts`):
- Client→Server: `playerJoin`, `playerFinished`
- Server→Client: `playerFinishedBroadcast`

**Tower Entities**: Server creates tower chunks with `Transform` + `GltfContainer` and syncs them via `syncEntity()`. Clients automatically receive and render these entities.

**Anti-cheat**: Server reads actual player heights from `Transform` of `PlayerIdentityData` entities instead of trusting client-reported heights.

### Game Flow

1. Server generates random tower (3-8 chunks) at round start
2. Tower entities synced to clients via `syncEntity()`
3. 7-minute countdown with speed multiplier (increases when players finish)
4. Server tracks player heights from their avatar positions (every 0.5s)
5. When timer hits 0: ENDING phase (3s) → BREAK phase (10s) → new round

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

### Synced Components

```typescript
export const MyComponent = engine.defineComponent('namespace:Name', {
  field: Schemas.Number
})
MyComponent.validateBeforeChange((value) => {
  return value.senderAddress === AUTH_SERVER_PEER_ID
})
```

### Syncing Entities

```typescript
const entity = engine.addEntity()
Transform.create(entity, { position: Vector3.create(x, y, z) })
GltfContainer.create(entity, { src: 'assets/model.glb' })
syncEntity(entity, [Transform.componentId, GltfContainer.componentId])
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
3. Check client debug logs for received entities

## Requirements

- Node.js >= 20.0.0
- SDK: Special authoritative server build (see package.json)
- Run with: `npx @dcl/hammurabi-server@next`
