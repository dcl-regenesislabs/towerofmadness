/**
 * Tournament configuration — bundled as TypeScript constants.
 * Edit this file to change tournament settings before deploying.
 * The hammurabi-server sandbox has no access to process.env, so all
 * configuration must live here as plain values.
 */

// ─── EDIT THESE VALUES ───────────────────────────────────────────────────────

// Set to true to skip the actual blockchain tx and only log what would happen
const DRY_RUN = true

// URL of the prize server (deployed on Render/Railway)
const PRIZE_SERVER_URL = 'https://your-prize-server.onrender.com'

// Secret token — must match SECRET_TOKEN env var in the prize server
const PRIZE_SERVER_SECRET = 'change-this-to-a-random-secret'

// ─────────────────────────────────────────────────────────────────────────────

export const TOURNAMENT_CONFIG = {
  dryRun: DRY_RUN,
  prizeServerUrl: PRIZE_SERVER_URL,
  prizeServerSecret: PRIZE_SERVER_SECRET,

  // Set to true to auto-start a tournament when the server boots
  autoStart: true,

  // Duration of the tournament in minutes
  durationMinutes: 1,

  // Prize amount in MANA
  prizeMANA: 100,

  // Wallets authorized to send the adminStartTournament message (lowercase)
  adminWallets: ['0x62bd11099260b3861c2da1418566c354e0cdfa65']
}
