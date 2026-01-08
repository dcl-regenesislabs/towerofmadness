# Tower of Madness - Colyseus Server

Multiplayer game server for Tower of Madness using Colyseus.

## Features

- **Synchronized Tower Generation**: All players see the same random tower
- **Shared Timer**: 7-minute countdown with speed multiplier
- **Leaderboard**: Real-time player height and completion tracking
- **Winner System**: Top 3 players displayed at round end
- **Auto Restart**: New round every 10 seconds after game ends

## Local Development

```bash
# Install dependencies
npm install

# Start development server (auto-restart on changes)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Server runs on `ws://localhost:2567` by default.

## Room: `tower_room`

### State Schema

```typescript
{
  roundId: string           // Unique round identifier
  chunkIds: string[]        // Tower chunks: ["Chunk01", "Chunk02", ...]
  remainingTime: number     // Seconds left in round
  speedMultiplier: number   // Timer speed (1, 2, 3...)
  roundState: string        // "ACTIVE" | "ENDING" | "BREAK"
  gameEnded: boolean        // True when round ends
  finisherCount: number     // Players who finished
  players: Map<PlayerState> // All connected players
  winners: WinnerState[]    // Top 3 at round end
}
```

### Client Messages (send to server)

| Message | Payload | Description |
|---------|---------|-------------|
| `playerHeight` | `{ height: number }` | Update player's current height |
| `playerFinished` | `{ time: number, height: number }` | Player reached the end |
| `playerDied` | `{ height: number }` | Player hit death trigger |
| `playerJoined` | `{ displayName: string }` | Set player display name |

### Server Messages (sent to clients)

| Message | Payload | Description |
|---------|---------|-------------|
| `newRound` | `{ roundId, chunkIds }` | New round started |
| `roundEnded` | `{ winners[] }` | Round finished |
| `playerFinished` | `{ displayName, time, finishOrder, speedMultiplier }` | Another player finished |

## Deploy to Railway

### Option 1: Deploy from GitHub

1. Push your code to GitHub
2. Create new project on [Railway](https://railway.app)
3. Connect your GitHub repo
4. Set root directory to `server/`
5. Railway auto-detects Node.js and deploys

### Option 2: Deploy from CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `2567` | Server port (Railway sets this automatically) |
| `NODE_ENV` | `development` | Set to `production` for deployed server |

### Get Your Server URL

After deploying, Railway provides a URL like:
```
tower-of-madness-server.up.railway.app
```

Update your Decentraland scene's `multiplayer.ts`:
```typescript
// In getServerUrl() function:
return 'wss://tower-of-madness-server.up.railway.app'
```

## Admin Monitor

In development mode, visit `http://localhost:2567/colyseus` for the Colyseus admin panel.

## Architecture

```
server/
├── src/
│   ├── index.ts          # Server entry point (Express + Colyseus)
│   └── rooms/
│       └── TowerRoom.ts  # Game room with state management
├── package.json
├── tsconfig.json
└── README.md
```

## Game Flow

1. **Round Start**: Server generates random tower (3-8 chunks)
2. **Active Phase**: 7-minute countdown, players climb
3. **Speed Up**: Timer accelerates when players finish (x2, x3, etc.)
4. **Round End**: Timer hits 0, top 3 winners displayed
5. **Break**: 10-second pause
6. **Repeat**: New round starts automatically
