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

  // Server -> Client: Teleport warning (client filters by address)
  teleportWarning: Schemas.Map({
    address: Schemas.String,
    strikes: Schemas.Number
  }),

  // Client -> Server: Avatar appearance (for podium sync)
  avatarAppearance: Schemas.Map({
    bodyShape: Schemas.String,
    wearables: Schemas.Array(Schemas.String),
    eyeColor: Schemas.Map({ r: Schemas.Number, g: Schemas.Number, b: Schemas.Number }),
    skinColor: Schemas.Map({ r: Schemas.Number, g: Schemas.Number, b: Schemas.Number }),
    hairColor: Schemas.Map({ r: Schemas.Number, g: Schemas.Number, b: Schemas.Number })
  }),

  // Server -> Client: Podium debug (server-side avatar data)
  podiumDebug: Schemas.Map({
    address: Schemas.String,
    info: Schemas.String
  })
}

export const room = registerMessages(Messages)
