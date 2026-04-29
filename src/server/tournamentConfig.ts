/**
 * Tournament configuration — bundled as TypeScript constants.
 * Edit this file to change tournament settings before deploying.
 * The hammurabi-server sandbox has no access to process.env, so all
 * configuration must live here as plain values.
 */

// ─── EDIT THESE VALUES ───────────────────────────────────────────────────────

// Master switch — set to false to disable ALL tournament functionality
const TOURNAMENT_MODE = true

// Set to true to skip the actual prize delivery and only log what would happen
const DRY_RUN = true

// 'mana'     — sends MANA to the winner's wallet (requires prizeWalletKey in ENV)
// 'wearable' — distributes a wearable via DCL Rewards API
const PRIZE_TYPE: 'mana' | 'wearable' = 'wearable'

// ── MANA prize config (only used when PRIZE_TYPE = 'mana') ───────────────────
const PRIZE_MANA_AMOUNT = 10

// ── Wearable prize config (only used when PRIZE_TYPE = 'wearable') ────────────
const WEARABLE_CAMPAIGN_ID = '7a7c87db-801a-4427-bf2b-2fab3d518b58'
const WEARABLE_DISPENSER_KEY = 'eyJpZCI6IjY2NThmOGRiLWZjNGItNDQyMC05NTUzLWYyZDQxODRjZDY3YiIsImNhbXBhaWduX2lkIjoiN2E3Yzg3ZGItODAxYS00NDI3LWJmMmItMmZhYjNkNTE4YjU4In0=.lu0GNQ/5Tjl4QvAvJuFJ5hhjIPfyaeqVcWluMX/3WyY='

// ─────────────────────────────────────────────────────────────────────────────

export const TOURNAMENT_CONFIG = {
  tournamentMode: TOURNAMENT_MODE,
  dryRun: DRY_RUN,
  prizeType: PRIZE_TYPE,

  // MANA
  prizeMANA: PRIZE_MANA_AMOUNT,

  // Wearable
  wearableCampaignId: WEARABLE_CAMPAIGN_ID,
  wearableDispenserKey: WEARABLE_DISPENSER_KEY,

  // Set to true to auto-start a tournament when the server boots
  autoStart: true,

  // Duration of the tournament in minutes
  durationMinutes: 1,

  // Wallets authorized to send the adminStartTournament message (lowercase)
  adminWallets: ['0x62bd11099260b3861c2da1418566c354e0cdfa65']
}
