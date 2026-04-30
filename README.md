# Tower of Madness

A procedurally generated tower climbing game for Decentraland SDK7. Climb randomly generated towers, track your progress, and compete for the best time and height! Features multiplayer support with server-authoritative anti-cheat.

## Features

### Multiplayer with Authoritative Server

- **Server-Side Game Logic**: Uses DCL's authoritative server pattern where same codebase runs on server and client
- **Anti-Cheat System**: Server validates player positions and calculates times - clients cannot cheat
- **Synchronized State**: All players see the same tower and timer via synced ECS components
- **All-Time Leaderboard**: Persistent leaderboard tracking best times and heights across all rounds
- **NTP Time Synchronization**: Accurate timer display across all clients

### Anti-Cheat System

The server implements multiple layers of anti-cheat protection:

- **Server-Side Height Tracking**: Server reads player positions directly from LiveKit via `getPlayer()`, not from client messages
- **Server-Authoritative Timing**: Server tracks when players start and finish - client-sent times are ignored
- **Start Validation**: Players must be below 20m height to start an attempt (prevents false starts)
- **Finish Validation**: Players must be at tower top (within 5m of total height) to finish (prevents early finish exploits)

### Procedural Tower Generation

- **Random Tower Creation**: Each round generates a tower with 3-8 random middle chunks
- **Server-Controlled**: Tower is generated on server and synced to all clients via entity pooling
- **Entity Pooling**: Tower chunks use a pool of reusable entities for efficient memory usage
- **Smart Stacking**: Chunks are stacked with alternating 180 degree rotations for visual variety

### Game Mechanics

- **Round-Based Play**: 7-minute rounds with automatic restarts
- **Speed Multiplier**: Timer speeds up each time a player finishes (x2, x3, etc.)
- **Height Tracking**: Real-time player height monitoring via server-side LiveKit integration
- **Win Condition**: Reach the top (ChunkEnd) to finish - validated server-side
- **Death System**: Fall detection with restart capability
- **Dynamic TriggerEnd**: Finish trigger position updates automatically with tower height

### User Interface

- **Round Timer**: Large central timer with speed multiplier indicator
- **Tower Progress Bar**: Vertical bar showing all players' positions on the tower
- **All-Time Leaderboard**: Left-side panel showing top 10 players with best times/heights
- **Personal Stats**: Top-right display of best time and height
- **Winners Display**: End-of-round podium showing top 3 players
- **NTP Sync Status**: Bottom-left indicator showing time sync offset

## Architecture

### Server/Client Branching

The same codebase runs on both server and client, branched by `isServer()`:

```typescript
if (isServer()) {
  server()  // Server-only logic
  return
}
// Client-only code
```

### Directory Structure

```
src/
├── index.ts              # Entry point - branches server/client via isServer()
├── multiplayer.ts        # Client-side state sync helpers and message sending
├── ui.tsx                # React ECS UI components
├── server/
│   ├── server.ts         # Server main logic, timer system, message handlers
│   └── gameState.ts      # Server state management, tower entity creation, leaderboard
└── shared/
    ├── schemas.ts        # Synced component definitions with validateBeforeChange()
    ├── messages.ts       # Message definitions via registerMessages()
    └── timeSync.ts       # NTP-style time synchronization
```

### Synced Components

Components use `validateBeforeChange()` to ensure only the server can modify them:

- **RoundStateComponent**: Round phase, timer, speed multiplier
- **LeaderboardComponent**: All-time player rankings with best times and heights
- **WinnersComponent**: Top 3 winners of current round
- **TowerConfigComponent**: Tower chunk configuration
- **ChunkComponent**: Tag for tower chunk entities

### Messages

Client-to-Server:
- `playerJoin`: Player joins the game
- `playerStarted`: Player entered start trigger (server validates height)
- `playerFinished`: Player claims to have finished (server validates and calculates time)

Server-to-Client:
- `playerFinishedBroadcast`: Announces a player finish with server-authoritative time
- `timeSyncResponse`: NTP-style time sync response

## Tower Structure

### Chunk Types

- **ChunkStart**: Base chunk (permanently placed at Y=0, position 40, 0, 40)
- **Middle Chunks**: Randomly selected from Chunk01, Chunk02, Chunk03
- **ChunkEnd**: Top chunk that triggers win condition

### Stacking Logic

- Each chunk has a height of **10.821 units**
- Chunks stack vertically with alternating rotations:
  - Even indices (0, 2, 4...): 180 degree Y rotation
  - Odd indices (1, 3, 5...): 0 degree Y rotation
- ChunkEnd rotation matches the last middle chunk's rotation pattern

### Generation Rules

- **Middle Chunks**: 3-8 chunks randomly selected (can repeat)
- **Position**: All chunks spawn at X=40, Z=40 (same as ChunkStart)
- **Height Calculation**: `(total chunks + 2) * 10.821` (includes ChunkStart and ChunkEnd)

## Game Flow

### Round Phases

```
ACTIVE  -> Players climb, timer counts down
ENDING  -> 3 seconds, show top 3 winners
BREAK   -> 10 seconds pause, then start new round
```

### Player Flow


1. **Scene Load**: Tower automatically generates, player connects to server
2. **Game Start**: Player enters TriggerStart area (server validates height < 20m)
3. **Climbing**: Player climbs the procedurally generated tower (server tracks height via LiveKit)
4. **Win**: Player reaches TriggerEnd - server validates height and calculates time
5. **Death**: Player falls and hits TriggerDeath area - can restart
6. **Next Round**: After timer expires, winners shown, brief break, new tower generated

## Installation and Setup

### Prerequisites

- Node.js >= 20.0.0
- npm >= 6.0.0

### Installation

```bash
npm install
```

### Development (with Authoritative Server)

```bash
npx @dcl/hammurabi-server@next
```

### Development (Standard - no multiplayer)

```bash
npm run start
```

### Build

```bash
npm run build
```

### Deploy

```bash
npm run deploy
```

## Configuration

### Tower Generation

Edit `src/server/gameState.ts` to modify:
- `MIN_CHUNKS`: Minimum middle chunks (default: 3)
- `MAX_CHUNKS`: Maximum middle chunks (default: 8)
- `CHUNK_HEIGHT`: Height of each chunk (default: 10.821)
- `BASE_TIMER`: Round duration in seconds (default: 420 / 7 minutes)
- `TOWER_X`, `TOWER_Z`: Tower base position (default: 40, 40)

### Anti-Cheat Settings

Edit `src/server/server.ts` to modify:
- `maxStartHeight`: Maximum height to start an attempt (default: 20m)
- Finish validation: Must be within 5m of tower top

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

### Timer Desync

The game uses NTP-style time synchronization. Check the sync offset indicator in the bottom-left of the UI. A well-synced client should show offset under 100ms.

## Code Style

Prettier configured: single quotes, no semicolons, 120 char width, no trailing commas.

## License

This project is open source and available for use in Decentraland scenes.

## Contributing

Contributions are welcome! Feel free to [submit issues or pull requests](https://github.com/dcl-regenesislabs/towerofmadness/issues).

---

**Built for Decentraland**
