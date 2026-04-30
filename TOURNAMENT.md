# Tournament Mode

Tower of Madness supports a tournament mode where the winner automatically receives a prize (MANA or a Wearable) at the end of the tournament period.

## How it works

1. When the server boots, the tournament auto-starts with the configured duration.
2. Players accumulate points across rounds during the tournament window.
3. When the timer expires, the server picks the winner (most points) and delivers the prize.
4. The tournament state persists in DCL Storage — if the server sleeps and wakes up, it restores the exact remaining time.

## Configuration

All tournament settings live in **`src/server/tournamentConfig.ts`**. Edit this file before deploying.

```ts
// Master switch — false disables ALL tournament UI and logic
const TOURNAMENT_MODE = true

// Skip the actual prize delivery and only log what would happen
const DRY_RUN = false

// 'mana' or 'wearable'
const PRIZE_TYPE: 'mana' | 'wearable' = 'wearable'

// Duration of the tournament in minutes
durationMinutes: 60
```

## Prize type: MANA

Set `PRIZE_TYPE = 'mana'` and load the prize wallet private key in the DCL dashboard:

| Where | Key | Value |
|-------|-----|-------|
| DCL Dashboard → Scene → ENV | `prizeWalletKey` | `0x...private_key...` |

The prize wallet must hold MANA and MATIC (for gas) on **Polygon mainnet**.

- MANA contract on Polygon: `0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4`
- RPC: `https://polygon-bor-rpc.publicnode.com`
- The transfer is executed directly from the auth-server sandbox using `SignedFetchProvider` (custom ethers.js provider that uses `signedFetch` instead of native `fetch`).

## Prize type: Wearable

Set `PRIZE_TYPE = 'wearable'`. The wearable campaign config lives in **`src/shared/wearableConfig.ts`** (single source of truth for both server and client):

```ts
export const WEARABLE_CONFIG = {
  campaignId: 'your-campaign-uuid',
  campaignKey: 'your-dispenser-key',
  rewardsApi: 'https://rewards.decentraland.org/api/campaigns',
  catalyst: 'https://realm-provider-ea.decentraland.org'
}
```

**How the claim works (client-side):**
1. Server ends tournament → sets `paymentTxHash = 'pending-claim'` on `TournamentComponent`
2. Winner's client detects it's the winner → auto-calls DCL Rewards API via `signedFetch` (signed with player's wallet — no Metamask popup)
3. On success → client sends `wearableClaimedByClient` message to server
4. Server updates `paymentTxHash` to the real reward ID → claim guard stops triggering

**DCL Rewards campaign requirements:**
- Status: **ACTIVE**
- Gas limit: set higher than current Polygon gas price
- MATIC funded at the campaign minting address
- Stock of wearables available

## Fallback winner

If no player accumulates points during the tournament, the prize goes to the fallback address configured in `gameState.ts`:

```ts
const FALLBACK_WINNER = '0xc502975b49398f9754afc4e9693cf0e1594f3275'
```

Change this address before production events.

## Tournament leaderboard (in-world)

A third in-world leaderboard (`LeaderBoard01.glb_3`) shows tournament points in real time. It only appears when `TOURNAMENT_MODE = true`. The 3D model must be placed in the Creator Hub — the code attaches text/panel to it automatically via `EntityNames.LeaderBoard01_glb_3`.

## Key files

| File | Purpose |
|------|---------|
| `src/server/tournamentConfig.ts` | All tournament settings (edit before deploy) |
| `src/shared/wearableConfig.ts` | Wearable campaign ID and key |
| `src/server/prizeTransfer.ts` | `sendMANA()` — transfers ERC-20 MANA via ethers.js + SignedFetchProvider |
| `src/server/gameState.ts` | `startTournament()`, `endTournament()`, `transferMANA()` |
| `src/shared/schemas.ts` | `TournamentComponent`, `TournamentLeaderboardComponent` |
| `src/TournamentLeaderboard.ts` | In-world tournament leaderboard setup |

## Resetting tournament state

Tournament state is persisted in DCL Storage under the key `tournamentState`. To force a fresh tournament (e.g. after changing duration), delete this key from the DCL dashboard **Scene** storage section before deploying.
