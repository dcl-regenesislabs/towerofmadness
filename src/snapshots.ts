export type SnapshotEntry = {
  wallet: string
  displayName: string
  snapshotUrl: string | null
  status: 'loading' | 'ok' | 'missing' | 'error'
  lastUpdated: number
}

const snapshots: SnapshotEntry[] = []
const snapshotByWallet = new Map<string, SnapshotEntry>()

const CATALYST_URL = 'https://peer.decentraland.org'
const CATALYST_FALLBACKS = [
  'https://peer-ec2.decentraland.org',
  'https://interconnected.online',
  'https://peer.decentral.io'
]
const DEFAULT_AVATAR_IMAGE = 'https://decentraland.org/images/male.png'

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
    snapshots.unshift(entry)

    if (snapshots.length > 12) {
      snapshots.length = 12
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
      console.log('[Snapshots] Failed to fetch snapshot', err)
    }
  })()
}

export function getSnapshots(): SnapshotEntry[] {
  return snapshots
}

async function getPlayerSnapshot(wallet: string): Promise<string | null> {
  const profile = await fetchProfileWithFallback(wallet)
  const avatar = profile?.avatars?.[0]?.avatar
  const snapshots = avatar?.snapshots ?? {}
  const rawFace256 = snapshots?.face256 ?? null
  const rawFace = snapshots?.face ?? null
  const normalizedFace256 = normalizeSnapshotUrl(rawFace256)
  const normalizedFace = normalizeSnapshotUrl(rawFace)
  const chosen = normalizedFace256 ?? normalizedFace ?? DEFAULT_AVATAR_IMAGE
  const chosenCid = chosen ? extractCidFromUrl(chosen) : null

  console.log(
    '[Snapshots] snapshot details',
    wallet,
    JSON.stringify({
      raw: { face256: rawFace256, face: rawFace },
      normalized: { face256: normalizedFace256, face: normalizedFace },
      chosen,
      cid: chosenCid
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

function extractCidFromUrl(url: string): string | null {
  const match = url.match(/\/content\/contents\/([^/?#]+)/i)
  return match?.[1] ?? null
}

async function fetchProfilesFrom(base: string, wallet: string) {
  const url = `${base}/lambdas/profiles/${wallet}`
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json()
}

async function fetchProfileWithFallback(wallet: string) {
  const primary = await fetchProfilesFrom(CATALYST_URL, wallet)
  if (primary?.avatars?.length) return primary

  for (const base of CATALYST_FALLBACKS) {
    const data = await fetchProfilesFrom(base, wallet)
    if (data?.avatars?.length) return data
  }

  return null
}
