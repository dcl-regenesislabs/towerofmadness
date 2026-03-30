import { engine } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'

export type SnapshotEntry = {
  wallet: string
  displayName: string
  snapshotUrl: string | null
  status: 'loading' | 'ok' | 'missing' | 'error'
  lastUpdated: number
}

type SnapshotStatus = SnapshotEntry['status']
type SnapshotMeta = {
  attempts: number
  inFlight: boolean
  queued: boolean
  nextRetryAt: number
}

type SnapshotFetchResult = {
  snapshotUrl: string
  status: Extract<SnapshotStatus, 'ok' | 'missing'>
  shouldRetry: boolean
  reason: string
}

const snapshots: SnapshotEntry[] = []
const snapshotByWallet = new Map<string, SnapshotEntry>()
const snapshotMetaByWallet = new Map<string, SnapshotMeta>()
const snapshotQueue: string[] = []

const CATALYST_URL = 'https://peer.decentraland.org'
const CATALYST_FALLBACKS = [
  'https://peer-ec2.decentraland.org',
  'https://interconnected.online',
  'https://peer.decentral.io'
]
const CATALYSTS = [CATALYST_URL, ...CATALYST_FALLBACKS]
const DEFAULT_AVATAR_IMAGE = 'https://decentraland.org/images/male.png'
const MIN_SNAPSHOT_IMAGE_BYTES = 512
const SNAPSHOT_QUEUE_TICK_SECONDS = 0.2
const SNAPSHOT_MAX_CONCURRENCY = 2
const SNAPSHOT_ERROR_RETRY_BASE_MS = 2_000
const SNAPSHOT_ERROR_RETRY_MAX_MS = 30_000
const SNAPSHOT_MISSING_RETRY_BASE_MS = 5_000
const SNAPSHOT_MISSING_RETRY_MAX_MS = 60_000

let queueSystemInitialized = false
let queueTickElapsed = 0
let activeSnapshotRequests = 0

export function initSnapshotQueue() {
  if (queueSystemInitialized || isServer()) return

  queueSystemInitialized = true
  engine.addSystem(
    (dt) => {
      queueTickElapsed += dt
      if (queueTickElapsed < SNAPSHOT_QUEUE_TICK_SECONDS) return
      queueTickElapsed = 0
      pumpSnapshotQueue()
    },
    undefined,
    'snapshot-fetch-queue-system'
  )
}

export async function requestPlayerSnapshot(wallet: string, displayName?: string): Promise<boolean> {
  if (!wallet) return false
  initSnapshotQueue()

  const normalized = wallet.toLowerCase()
  let entry = snapshotByWallet.get(normalized)

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

  const meta = getSnapshotMeta(normalized)
  if (entry.status === 'ok' && entry.snapshotUrl && entry.snapshotUrl !== DEFAULT_AVATAR_IMAGE) return true
  if (meta.inFlight || meta.queued) return true

  enqueueSnapshotFetch(normalized)
  return true
}

export function getSnapshots(): SnapshotEntry[] {
  return snapshots
}

function getSnapshotMeta(wallet: string): SnapshotMeta {
  let meta = snapshotMetaByWallet.get(wallet)
  if (!meta) {
    meta = {
      attempts: 0,
      inFlight: false,
      queued: false,
      nextRetryAt: 0
    }
    snapshotMetaByWallet.set(wallet, meta)
  }
  return meta
}

function enqueueSnapshotFetch(wallet: string, delayMs: number = 0) {
  const meta = getSnapshotMeta(wallet)
  const scheduledAt = Date.now() + Math.max(0, delayMs)

  if (meta.nextRetryAt === 0 || scheduledAt < meta.nextRetryAt) {
    meta.nextRetryAt = scheduledAt
  }

  if (!meta.inFlight && !meta.queued) {
    meta.queued = true
    snapshotQueue.push(wallet)
  }

  pumpSnapshotQueue()
}

function pumpSnapshotQueue() {
  if (!queueSystemInitialized || activeSnapshotRequests >= SNAPSHOT_MAX_CONCURRENCY || snapshotQueue.length === 0) return

  const now = Date.now()
  let scansRemaining = snapshotQueue.length

  while (activeSnapshotRequests < SNAPSHOT_MAX_CONCURRENCY && scansRemaining > 0 && snapshotQueue.length > 0) {
    const wallet = snapshotQueue.shift()
    if (!wallet) break

    const meta = getSnapshotMeta(wallet)
    meta.queued = false

    if (meta.inFlight) {
      scansRemaining -= 1
      continue
    }

    if (meta.nextRetryAt > now) {
      meta.queued = true
      snapshotQueue.push(wallet)
      scansRemaining -= 1
      continue
    }

    activeSnapshotRequests += 1
    void processSnapshotFetch(wallet)
    scansRemaining -= 1
  }
}

async function processSnapshotFetch(wallet: string): Promise<void> {
  const entry = snapshotByWallet.get(wallet)
  if (!entry) {
    activeSnapshotRequests = Math.max(0, activeSnapshotRequests - 1)
    return
  }

  const meta = getSnapshotMeta(wallet)
  meta.inFlight = true
  meta.nextRetryAt = 0
  entry.status = 'loading'
  entry.lastUpdated = Date.now()

  let retryStatus: Extract<SnapshotStatus, 'missing' | 'error'> | null = null

  try {
    const result = await getPlayerSnapshot(wallet)
    entry.snapshotUrl = result.snapshotUrl
    entry.status = result.status
    entry.lastUpdated = Date.now()

    if (result.shouldRetry && result.status !== 'ok') {
      retryStatus = result.status
      console.log('[Snapshots] Scheduling retry', wallet, result.reason)
    } else {
      meta.attempts = 0
    }
  } catch (err) {
    entry.snapshotUrl = entry.snapshotUrl || DEFAULT_AVATAR_IMAGE
    entry.status = 'error'
    entry.lastUpdated = Date.now()
    retryStatus = 'error'
    console.log('[Snapshots] Failed to fetch snapshot', wallet, err)
  } finally {
    meta.inFlight = false
    activeSnapshotRequests = Math.max(0, activeSnapshotRequests - 1)

    if (retryStatus) {
      meta.attempts += 1
      enqueueSnapshotFetch(wallet, getRetryDelayMs(meta.attempts, retryStatus))
    }

    pumpSnapshotQueue()
  }
}

function getRetryDelayMs(attempt: number, status: Extract<SnapshotStatus, 'missing' | 'error'>): number {
  const base = status === 'missing' ? SNAPSHOT_MISSING_RETRY_BASE_MS : SNAPSHOT_ERROR_RETRY_BASE_MS
  const max = status === 'missing' ? SNAPSHOT_MISSING_RETRY_MAX_MS : SNAPSHOT_ERROR_RETRY_MAX_MS
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  const jitter = Math.floor(exponential * 0.2 * Math.random())
  return Math.min(max, exponential + jitter)
}

async function getPlayerSnapshot(wallet: string): Promise<SnapshotFetchResult> {
  const profile = await fetchProfileWithFallback(wallet)
  if (!profile?.avatars?.length) {
    return {
      snapshotUrl: DEFAULT_AVATAR_IMAGE,
      status: 'missing',
      shouldRetry: true,
      reason: 'profile not available on catalysts'
    }
  }

  const avatar = profile?.avatars?.[0]?.avatar
  if (!avatar) {
    return {
      snapshotUrl: DEFAULT_AVATAR_IMAGE,
      status: 'missing',
      shouldRetry: true,
      reason: 'profile payload missing avatar data'
    }
  }

  const snapshots = avatar?.snapshots ?? {}
  const rawFace256 = snapshots?.face256 ?? null
  const rawFace = snapshots?.face ?? null
  const faceCandidates = buildSnapshotCandidates(rawFace)
  const face256Candidates = buildSnapshotCandidates(rawFace256)
  const chosen = await resolveReachableSnapshotUrl([...faceCandidates, ...face256Candidates])
  const finalUrl = chosen ?? DEFAULT_AVATAR_IMAGE
  const chosenCid = chosen ? extractCidFromUrl(chosen) : null

  console.log(
    '[Snapshots] snapshot details',
    wallet,
    JSON.stringify({
      raw: { face256: rawFace256, face: rawFace },
      candidates: { face: faceCandidates, face256: face256Candidates },
      chosen: finalUrl,
      cid: chosenCid,
      usedDefault: !chosen
    })
  )

  if (chosen) {
    return {
      snapshotUrl: chosen,
      status: 'ok',
      shouldRetry: false,
      reason: 'snapshot resolved'
    }
  }

  return {
    snapshotUrl: DEFAULT_AVATAR_IMAGE,
    status: 'missing',
    shouldRetry: true,
    reason: 'no reachable snapshot candidate'
  }
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
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.log('[Snapshots] Profile request failed', url, res.status)
      return null
    }
    return await res.json()
  } catch (err) {
    console.log('[Snapshots] Profile request error', url, err)
    return null
  }
}

async function fetchProfileWithFallback(wallet: string) {
  for (const base of CATALYSTS) {
    const data = await fetchProfilesFrom(base, wallet)
    if (data?.avatars?.length) return data
  }

  return null
}
