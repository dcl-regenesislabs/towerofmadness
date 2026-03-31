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

export async function requestPlayerSnapshot(wallet: string, displayName?: string): Promise<boolean> {
  if (!wallet) return false

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

  if (!isNew && entry.status === 'loading') return false

  entry.status = 'loading'
  entry.lastUpdated = Date.now()

  try {
    const snapshotUrl = await getPlayerSnapshot(normalized)
    entry.snapshotUrl = snapshotUrl
    entry.status = snapshotUrl ? 'ok' : 'missing'
    entry.lastUpdated = Date.now()
    return true
  } catch (err) {
    entry.status = 'error'
    entry.lastUpdated = Date.now()
    console.log('[Snapshots] Failed to fetch snapshot', err)
    return false
  }
}

export function getSnapshots(): SnapshotEntry[] {
  return snapshots
}

async function getPlayerSnapshot(wallet: string): Promise<string | null> {
  // Try to get a direct content URL (bypasses Cloudflare CDN - avoids 525 errors)
  const contentUrl = await getContentFaceUrl(wallet)
  if (contentUrl) {
    console.log('[Snapshots] OK direct content URL for', wallet, contentUrl)
    return contentUrl
  }

  console.log('[Snapshots] WARN getContentFaceUrl failed for', wallet, '- falling back to lambdas/profiles')

  // Fallback: lambdas/profiles (may return profile-images.decentraland.org CDN URLs)
  const profile = await fetchProfileWithFallback(wallet)
  if (!profile) {
    console.log('[Snapshots] FAIL all peers failed for', wallet, '- showing placeholder')
    return null
  }

  const avatar = profile?.avatars?.[0]?.avatar
  const snapshotData = avatar?.snapshots ?? {}
  const rawFace256 = snapshotData?.face256 ?? null
  const rawFace = snapshotData?.face ?? null
  const normalizedFace256 = normalizeSnapshotUrl(rawFace256)
  const normalizedFace = normalizeSnapshotUrl(rawFace)

  if (!normalizedFace256 && rawFace256) {
    console.log('[Snapshots] WARN face256 URL rejected (CDN):', rawFace256)
  }
  if (!normalizedFace && rawFace) {
    console.log('[Snapshots] WARN face URL rejected (CDN):', rawFace)
  }

  const chosen = normalizedFace256 ?? normalizedFace ?? null
  if (chosen) {
    console.log('[Snapshots] OK fallback peer URL for', wallet, chosen)
  } else {
    console.log('[Snapshots] FAIL no valid URL found for', wallet, '- showing placeholder')
  }
  return chosen
}

async function getContentFaceUrl(wallet: string): Promise<string | null> {
  const peers = [CATALYST_URL, ...CATALYST_FALLBACKS]
  for (const base of peers) {
    try {
      const res = await fetch(`${base}/content/entities/profile?pointer=${wallet}`)
      if (!res.ok) {
        console.log('[Snapshots] WARN', base, 'returned', res.status, 'for profile', wallet)
        continue
      }
      const entities = await res.json()
      const content: Array<{ file: string; hash: string }> = entities?.[0]?.content
      if (!Array.isArray(content)) {
        console.log('[Snapshots] WARN', base, 'returned no content files for', wallet)
        continue
      }
      const face256 = content.find((f) => f.file === 'face256.png')
      const face128 = content.find((f) => f.file === 'face128.png')
      const face = content.find((f) => f.file === 'face.png')
      const hash = face256?.hash ?? face128?.hash ?? face?.hash
      if (hash) return `${base}/content/contents/${hash}`
      console.log('[Snapshots] WARN', base, 'entity has no face file for', wallet, '- files:', content.map((f) => f.file).join(', '))
    } catch (err) {
      console.log('[Snapshots] WARN', base, 'fetch error for', wallet, String(err))
      continue
    }
  }
  return null
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
