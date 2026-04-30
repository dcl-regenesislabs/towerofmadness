/**
 * Prize Transfer from DCL Authoritative Server
 *
 * Supports two prize types:
 *
 * 1. MANA — sends ERC-20 MANA tokens on Polygon using ethers.js + SignedFetchProvider.
 *    Requires prizeWalletKey set in the DCL dashboard ENV section.
 *
 * 2. Wearable — distributes a wearable via the DCL Rewards API.
 *    Requires a campaign created at rewards.decentraland.org and a dispenser key.
 *
 * Key insight: the DCL sandbox has no native `fetch`, but `signedFetch` works.
 * We use it both as the ethers.js HTTP transport (MANA) and for the Rewards API call (wearable).
 */

import { ethers } from 'ethers'
import { signedFetch } from '~system/SignedFetch'
import { EnvVar } from '@dcl/sdk/server'

// ─── MANA config ─────────────────────────────────────────────────────────────
const MANA_CONTRACT = '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4' // MANA on Polygon PoS
const POLYGON_RPC_URL = 'https://polygon-bor-rpc.publicnode.com'
const POLYGON_CHAIN_ID = 137
const MANA_ABI = ['function transfer(address to, uint256 amount) returns (bool)']


// Replaces ethers' default fetch-based transport with signedFetch (available in DCL sandbox)
class SignedFetchProvider extends ethers.JsonRpcApiProvider {
  constructor() {
    super({ chainId: POLYGON_CHAIN_ID, name: 'polygon' })
  }

  async _send(
    payload: ethers.JsonRpcPayload | ethers.JsonRpcPayload[]
  ): Promise<(ethers.JsonRpcResult | ethers.JsonRpcError)[]> {
    const response = await signedFetch({
      url: POLYGON_RPC_URL,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    })
    const result = JSON.parse(response.body ?? '[]')
    return Array.isArray(result) ? result : [result]
  }
}

/**
 * Sends MANA to a Polygon wallet from the prize wallet.
 * The prize wallet private key must be set in the DCL dashboard under ENV > prizeWalletKey.
 *
 * @returns the transaction hash, or null if the transfer failed
 */
export async function sendMANA(toAddress: string, amount: number): Promise<string | null> {
  const privateKey = await EnvVar.get('prizeWalletKey')
  if (!privateKey) {
    console.error('[prizeTransfer] No prizeWalletKey found in ENV — set it in the DCL dashboard')
    return null
  }

  try {
    const provider = new SignedFetchProvider()
    const wallet = new ethers.Wallet(privateKey, provider)
    const contract = new ethers.Contract(MANA_CONTRACT, MANA_ABI, wallet)
    const amountWei = ethers.parseEther(amount.toString())

    console.log(`[prizeTransfer] Sending ${amount} MANA to ${toAddress}...`)
    const tx = await (contract.transfer as (to: string, amount: bigint) => Promise<ethers.TransactionResponse>)(
      toAddress,
      amountWei
    )
    console.log(`[prizeTransfer] Tx submitted: ${tx.hash}`)
    await tx.wait()
    console.log(`[prizeTransfer] ✓ MANA confirmed: ${tx.hash}`)

    return tx.hash
  } catch (err) {
    console.error('[prizeTransfer] ✗ sendMANA failed:', err)
    return null
  }
}

