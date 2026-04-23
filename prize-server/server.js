import express from 'express'
import { ethers } from 'ethers'

const app = express()
app.use(express.json())

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
const SECRET_TOKEN = process.env.SECRET_TOKEN // Must match DCL scene config
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'
const PRIZE_WALLET_PRIVATE_KEY = process.env.PRIZE_WALLET_PRIVATE_KEY
const MANA_CONTRACT_ADDRESS = process.env.MANA_CONTRACT_ADDRESS || '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942'
const MANA_ABI = ['function transfer(address to, uint256 amount) returns (bool)']
// ─────────────────────────────────────────────────────────────────────────────

// Auth middleware
function requireAuth(req, res, next) {
  const auth = req.headers['authorization']
  if (!auth || auth !== `Bearer ${SECRET_TOKEN}`) {
    console.warn(`[Auth] Unauthorized request from ${req.ip}`)
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Transfer endpoint
app.post('/transfer', requireAuth, async (req, res) => {
  const { address, amount, tournamentId } = req.body

  if (!address || !amount || !tournamentId) {
    return res.status(400).json({ error: 'Missing address, amount or tournamentId' })
  }

  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' })
  }

  if (!PRIZE_WALLET_PRIVATE_KEY) {
    console.error('[Transfer] PRIZE_WALLET_PRIVATE_KEY not set')
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  console.log(`[Transfer] ${amount} MANA → ${address} (tournamentId: ${tournamentId})`)

  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL)
    const wallet = new ethers.Wallet(PRIZE_WALLET_PRIVATE_KEY, provider)
    const contract = new ethers.Contract(MANA_CONTRACT_ADDRESS, MANA_ABI, wallet)
    const amountWei = ethers.parseEther(amount.toString())

    const tx = await contract.transfer(address, amountWei)
    console.log(`[Transfer] Tx submitted: ${tx.hash}`)

    await tx.wait()
    console.log(`[Transfer] Tx confirmed: ${tx.hash}`)

    return res.json({ success: true, txHash: tx.hash })
  } catch (err) {
    console.error(`[Transfer] Failed:`, err.message)
    return res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`[PrizeServer] Running on port ${PORT}`)
})
