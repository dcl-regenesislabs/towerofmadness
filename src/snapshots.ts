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
const CATALYSTS = [CATALYST_URL, ...CATALYST_FALLBACKS]
const DEFAULT_AVATAR_IMAGE = 'https://decentraland.org/images/male.png'
const MIN_SNAPSHOT_IMAGE_BYTES = 512

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
  const profile = await fetchProfileWithFallback(wallet)
  const avatar = profile?.avatars?.[0]?.avatar
  const snapshots = avatar?.snapshots ?? {}
  const rawFace256 = snapshots?.face256 ?? null
  const rawFace = snapshots?.face ?? null
  const faceCandidates = buildSnapshotCandidates(rawFace)
  const face256Candidates = buildSnapshotCandidates(rawFace256)
  const chosen =
    (await resolveReachableSnapshotUrl([...faceCandidates, ...face256Candidates])) ?? DEFAULT_AVATAR_IMAGE
  const chosenCid = extractCidFromUrl(chosen)

  console.log(
    '[Snapshots] snapshot details',
    wallet,
    JSON.stringify({
      raw: { face256: rawFace256, face: rawFace },
      candidates: { face: faceCandidates, face256: face256Candidates },
      chosen,
      cid: chosenCid,
      usedDefault: chosen === DEFAULT_AVATAR_IMAGE
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
    return cid ? `${CATALYST_URL}/content/contents/${cid}` : null
  }

  if (trimmed.startsWith('baf') || trimmed.startsWith('Qm')) {
    return `${CATALYST_URL}/content/contents/${trimmed}`
  }

  if (!/^https?:\/\//i.test(trimmed)) return null

  return trimmed
}

function extractCidFromUrl(url: string): string | null {
  const match = url.match(/\/content\/contents\/([^/?#]+)/i)
  return match?.[1] ?? null
}

function buildSnapshotCandidates(url: string | null): string[] {
  const normalized = normalizeSnapshotUrl(url)
  if (!normalized) return []

  const cid = extractCidFromUrl(normalized)
  if (!cid) return [normalized]

  return CATALYSTS.map((base) => `${base}/content/contents/${cid}`)
}

async function resolveReachableSnapshotUrl(urls: string[]): Promise<string | null> {
  const seen = new Set<string>()

  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)

    if (await isReachableSnapshotUrl(url)) {
      return url
    }
  }

  return null
}

async function isReachableSnapshotUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.log('[Snapshots] Snapshot probe failed', url, res.status)
      return false
    }

    const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType && !contentType.startsWith('image/')) {
      console.log('[Snapshots] Snapshot probe returned non-image content', url, contentType)
      return false
    }

    const contentLengthHeader = res.headers.get('content-length')
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN
    if (Number.isFinite(contentLength) && contentLength > 0 && contentLength < MIN_SNAPSHOT_IMAGE_BYTES) {
      console.log('[Snapshots] Snapshot probe returned tiny image', url, contentLength)
      return false
    }

    return true
  } catch (err) {
    console.log('[Snapshots] Snapshot probe error', url, err)
    return false
  }
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
