import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // Client -> Server: Player joins game (name is looked up server-side from PlayerIdentityData)
  playerJoin: Schemas.Map({}),

  // Client -> Server: Player started attempt (entered start trigger)
  playerStarted: Schemas.Map({}),

  // Client -> Server: Player finished the tower (entered end trigger)
  playerFinished: Schemas.Map({
    time: Schemas.Number
  }),

  // Server -> Client: Broadcast when a player finishes
  playerFinishedBroadcast: Schemas.Map({
    displayName: Schemas.String,
    finishOrder: Schemas.Number,
    speedMultiplier: Schemas.Number,
    time: Schemas.Number // Server-calculated finish time
  }),

  // Server -> Client: Attempt was rejected by server validation
  attemptRejected: Schemas.Map({
    address: Schemas.String,
    stage: Schemas.String,
    reason: Schemas.String
  }),

  // Server -> Client: Teleport warning (client filters by address)
  teleportWarning: Schemas.Map({
    address: Schemas.String,
    strikes: Schemas.Number
  }),

  // Server -> Client: Podium debug (server-side avatar data)
  podiumDebug: Schemas.Map({
    address: Schemas.String,
    info: Schemas.String
  }),

  // Server -> Client: Teleport everyone to base (end of round)
  teleportToBase: Schemas.Map({
    x: Schemas.Number,
    y: Schemas.Number,
    z: Schemas.Number
  }),

  // Admin -> Server: Start a tournament (only accepted from authorized wallets)
  adminStartTournament: Schemas.Map({
    durationMinutes: Schemas.Number,
    prizeMANA: Schemas.Number
  }),

  // Server -> All clients: Tournament started
  tournamentStarted: Schemas.Map({
    tournamentId: Schemas.String,
    endTime: Schemas.Int64,
    prizeMANA: Schemas.Number
  }),

  // Server -> All clients: Tournament ended
  tournamentEnded: Schemas.Map({
    winnerAddress: Schemas.String,
    winnerName: Schemas.String,
    winnerPoints: Schemas.Number,
    prizeMANA: Schemas.Number
  }),

  // Client -> Server: Winner successfully claimed their wearable
  wearableClaimedByClient: Schemas.Map({
    rewardId: Schemas.String
  }),

  // Client -> Server: Player finished (or skipped) the pigeon tutorial
  tutorialCompleted: Schemas.Map({}),

  // Server -> All clients: Whether this player has completed the tutorial before
  // (client filters by own address, same pattern as attemptRejected/teleportWarning)
  tutorialStatus: Schemas.Map({
    address: Schemas.String,
    hasSeenTutorial: Schemas.Boolean
  })
}

export const room = registerMessages(Messages)
