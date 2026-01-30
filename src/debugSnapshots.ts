export type DebugSnapshotEntry = {
  wallet: string
  displayName: string
  snapshotUrl: string | null
  status: 'loading' | 'ok' | 'missing' | 'error'
  lastUpdated: number
}

const debugSnapshots: DebugSnapshotEntry[] = []
const snapshotByWallet = new Map<string, DebugSnapshotEntry>()

export function requestPlayerSnapshot(wallet: string, displayName?: string) {
  if (!wallet) return

  const normalized = wallet.toLowerCase()
  let entry = snapshotByWallet.get(normalized)
  const isNew = !entry

  if (!entry) {
    entry = {
      wallet: normalized,
      displayName: displayName || `${normalized.slice(0, 6)}...${normalized.slice(-4)}`,
      snapshotUrl: null,
      status: 'loading',
      lastUpdated: Date.now()
    }
    snapshotByWallet.set(normalized, entry)
    debugSnapshots.unshift(entry)

    if (debugSnapshots.length > 12) {
      debugSnapshots.length = 12
    }
  } else if (displayName && entry.displayName.startsWith('0x')) {
    entry.displayName = displayName
  }

  if (!isNew && entry.status === 'loading') return

  entry.status = 'loading'
  entry.lastUpdated = Date.now()

  void (async () => {
    try {
      const snapshotUrl = await getPlayerSnapshot(normalized)
      entry.snapshotUrl = snapshotUrl
      entry.status = snapshotUrl ? 'ok' : 'missing'
      entry.lastUpdated = Date.now()
    } catch (err) {
      entry.status = 'error'
      entry.lastUpdated = Date.now()
      console.log('[DebugSnapshots] Failed to fetch snapshot', err)
    }
  })()
}

export function getDebugSnapshots(): DebugSnapshotEntry[] {
  return debugSnapshots
}

async function getPlayerSnapshot(wallet: string): Promise<string | null> {
  const res = await fetch(`https://peer.decentraland.org/lambdas/profile/${wallet}`)
  if (!res.ok) return null
  const data = await res.json()
  const avatar = data?.avatars?.[0]?.avatar
  const snapshots = avatar?.snapshots ?? {}
  const rawFace256 = snapshots?.face256 ?? null
  const normalizedFace256 = normalizeSnapshotUrl(rawFace256)
  const chosen = normalizedFace256 ?? null

  console.log(
    '[DebugSnapshots] snapshot details',
    wallet,
    JSON.stringify({
      raw: { face256: rawFace256 },
      normalized: { face256: normalizedFace256 },
      chosen
    })
  )

  return chosen
}

function normalizeSnapshotUrl(url: string | null): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('ipfs://')) {
    const cid = trimmed.replace('ipfs://', '')
    return cid ? `https://peer.decentraland.org/content/contents/${cid}` : null
  }

  if (trimmed.startsWith('baf') || trimmed.startsWith('Qm')) {
    return `https://peer.decentraland.org/content/contents/${trimmed}`
  }

  if (!/^https?:\/\//i.test(trimmed)) return null

  return trimmed
}
