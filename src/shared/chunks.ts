export const CHUNK_ASSET_DIR = 'assets/chunks'

export const CHUNK_START_ID = 'ChunkStart'
export const CHUNK_END_ID = 'ChunkEnd'

export const MIDDLE_CHUNK_IDS = [
  'Chunk01',
  'Chunk02',
  'Chunk03',
  'Chunk04',
  'Chunk05',
  'Chunk06',
  'Chunk07',
  'Chunk08',
  'Chunk09',
  'Chunk10'
] as const

export const ALL_CHUNK_IDS = [CHUNK_START_ID, ...MIDDLE_CHUNK_IDS, CHUNK_END_ID] as const

export const MIN_TOWER_MIDDLE_CHUNKS = 3
export const MAX_TOWER_MIDDLE_CHUNKS = 8

export type ChunkId = (typeof ALL_CHUNK_IDS)[number]
export type MiddleChunkId = (typeof MIDDLE_CHUNK_IDS)[number]

export function getChunkAssetPath(chunkId: ChunkId | string): string {
  return `${CHUNK_ASSET_DIR}/${chunkId}.glb`
}

export function getChunkIdFromAssetPath(assetPath: string): string | null {
  const match = assetPath.match(/^assets\/chunks\/(\w+)\.glb$/)
  return match ? match[1] : null
}
