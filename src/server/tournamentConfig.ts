/**
 * Tournament configuration — bundled as TypeScript constants.
 * Edit this file to change tournament settings before deploying.
 * The hammurabi-server sandbox has no access to process.env, so all
 * configuration must live here as plain values.
 */

type Network = 'mainnet' | 'amoy'

const NETWORK_CONFIG: Record<Network, { rpcUrl: string; manaContract: string }> = {
  mainnet: {
    rpcUrl: 'https://polygon-rpc.com',
    manaContract: '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942'
  },
  amoy: {
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    manaContract: '0x882Da5967c435eA5cC6b09150d55E8304B838f45' // testnet MANA on Amoy
  }
}

// ─── EDIT THESE VALUES ───────────────────────────────────────────────────────

// 'mainnet' for production, 'amoy' for testing
const NETWORK: Network = 'amoy'

// Set to true to skip the actual blockchain tx and only log what would happen
const DRY_RUN = false

// Private key of the wallet that holds MANA and pays the prize
const PRIZE_WALLET_PRIVATE_KEY = '0xdb5d0af2213d92978e7934eba08f1ae116081f55536e10e3c040cff6b3405c29'

// ─────────────────────────────────────────────────────────────────────────────

export const TOURNAMENT_CONFIG = {
  dryRun: DRY_RUN,
  network: NETWORK,
  polygonRpcUrl: NETWORK_CONFIG[NETWORK].rpcUrl,
  manaContract: NETWORK_CONFIG[NETWORK].manaContract,
  prizeWalletPrivateKey: PRIZE_WALLET_PRIVATE_KEY,

  // Set to true to auto-start a tournament when the server boots
  autoStart: true,

  // Duration of the tournament in minutes
  durationMinutes: 1,

  // Prize amount in MANA
  prizeMANA: 100,
  
  // Wallets authorized to send the adminStartTournament message (lowercase)
  adminWallets: ['0x62bd11099260b3861c2da1418566c354e0cdfa65']
}
