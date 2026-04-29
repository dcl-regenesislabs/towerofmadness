/**
 * MANA Transfer from DCL Authoritative Server
 *
 * Sends ERC-20 MANA tokens on Polygon directly from the hammurabi server sandbox.
 *
 * Key insight: the sandbox has no native `fetch`, but DCL's `signedFetch` works.
 * We extend ethers.JsonRpcApiProvider to use `signedFetch` as the HTTP transport,
 * which lets ethers.js sign and broadcast transactions without any external service.
 *
 * Private key is read from the DCL dashboard ENV section (never bundled in code).
 *
 * Dependencies: ethers (^6), ~system/SignedFetch, @dcl/sdk/server (EnvVar)
 */

import { ethers } from 'ethers'
import { signedFetch } from '~system/SignedFetch'
import { EnvVar } from '@dcl/sdk/server'

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
export async function sendMANA(
  toAddress: string,
  amount: number
): Promise<string | null> {
  const privateKey = await EnvVar.get('prizeWalletKey')
  if (!privateKey) {
    console.error('[manaTransfer] No prizeWalletKey found in ENV — set it in the DCL dashboard')
    return null
  }

  try {
    const provider = new SignedFetchProvider()
    const wallet = new ethers.Wallet(privateKey, provider)
    const contract = new ethers.Contract(MANA_CONTRACT, MANA_ABI, wallet)
    const amountWei = ethers.parseEther(amount.toString())

    console.log(`[manaTransfer] Sending ${amount} MANA to ${toAddress}...`)
    const tx = await (contract.transfer as (to: string, amount: bigint) => Promise<ethers.TransactionResponse>)(
      toAddress,
      amountWei
    )
    console.log(`[manaTransfer] Tx submitted: ${tx.hash}`)

    await tx.wait()
    console.log(`[manaTransfer] ✓ Confirmed: ${tx.hash}`)

    return tx.hash
  } catch (err) {
    console.error('[manaTransfer] ✗ Transfer failed:', err)
    return null
  }
}
