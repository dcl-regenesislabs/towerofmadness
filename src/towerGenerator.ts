import { engine, Transform, GltfContainer, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

/**
 * Tower Generation System
 * 
 * Manages the procedural generation of tower chunks with proper stacking,
 * rotation, and regeneration functionality.
 */

// Constants
const CHUNK_HEIGHT = 10.821
const TOWER_X = 40
const TOWER_Z = 40
const MIN_MIDDLE_CHUNKS = 3
const MAX_MIDDLE_CHUNKS = 6

// Available chunk files
const MIDDLE_CHUNKS = [
  'assets/chunks/Chunk01.glb',
  'assets/chunks/Chunk02.glb',
  'assets/chunks/Chunk03.glb'
]

const END_CHUNK = 'assets/chunks/ChunkEnd.glb'

// Store spawned entities for cleanup
let spawnedChunkEntities: Entity[] = []
let chunkEndEntity: Entity | null = null

// Export tower height for UI
export let currentTowerHeight = 0
export let currentMiddleChunkCount = 0

// Track which chunks are used in the current tower (from top to bottom)
export let currentTowerChunks: string[] = []

/**
 * Clears all spawned tower chunks (except ChunkStart which is permanent)
 */
function clearTower() {
  // Remove all spawned chunk entities
  for (const entity of spawnedChunkEntities) {
    // Check if entity still has components (exists) before removing
    if (Transform.has(entity)) {
      engine.removeEntity(entity)
    }
  }
  spawnedChunkEntities = []
  chunkEndEntity = null
  currentTowerHeight = 0
  currentMiddleChunkCount = 0
  currentTowerChunks = []
}

/**
 * Generates a random number of middle chunks between MIN and MAX
 */
function getRandomMiddleChunkCount(): number {
  return Math.floor(Math.random() * (MAX_MIDDLE_CHUNKS - MIN_MIDDLE_CHUNKS + 1)) + MIN_MIDDLE_CHUNKS
}

/**
 * Selects a random middle chunk file (can repeat)
 */
function getRandomMiddleChunk(): string {
  const randomIndex = Math.floor(Math.random() * MIDDLE_CHUNKS.length)
  return MIDDLE_CHUNKS[randomIndex]
}

/**
 * Extracts chunk name from file path
 * Example: "assets/chunks/Chunk01.glb" -> "Chunk01"
 */
function getChunkName(chunkPath: string): string {
  const fileName = chunkPath.split('/').pop() || chunkPath
  return fileName.replace('.glb', '')
}

/**
 * Creates a chunk entity at the specified position and rotation
 */
function createChunk(chunkPath: string, position: Vector3, rotationY: number): Entity {
  const entity = engine.addEntity()
  
  Transform.create(entity, {
    position: position,
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.One()
  })
  
  GltfContainer.create(entity, {
    src: chunkPath
  })
  
  return entity
}

/**
 * Generates the complete tower structure
 */
export function generateTower() {
  // Clear existing tower (except ChunkStart)
  clearTower()
  
  // Generate random number of middle chunks
  const middleChunkCount = getRandomMiddleChunkCount()
  currentMiddleChunkCount = middleChunkCount
  
  // Track chunks used (from top to bottom, so we'll build in reverse order)
  const chunksUsed: string[] = []
  
  // Spawn middle chunks with alternating rotations
  for (let i = 0; i < middleChunkCount; i++) {
    const yPosition = CHUNK_HEIGHT * (i + 1) // First chunk at Y=10.821, second at Y=21.642, etc.
    
    // Alternating rotation: even indices (0, 2, 4...) = 180°, odd indices (1, 3, 5...) = 0°
    const rotationY = i % 2 === 0 ? 180 : 0
    
    // Select random middle chunk
    const chunkPath = getRandomMiddleChunk()
    const chunkName = getChunkName(chunkPath)
    
    // Track chunk (we'll reverse the array later to show top-to-bottom)
    chunksUsed.push(chunkName)
    
    // Create chunk entity
    const entity = createChunk(
      chunkPath,
      Vector3.create(TOWER_X, yPosition, TOWER_Z),
      rotationY
    )
    
    spawnedChunkEntities.push(entity)
  }
  
  // Spawn ChunkEnd at the top
  const endChunkY = CHUNK_HEIGHT * (middleChunkCount + 1)
  
  // Determine ChunkEnd rotation to match the last middle chunk's rotation
  // Last middle chunk has index = middleChunkCount - 1
  // Even indices (0, 2, 4...) = 180°, odd indices (1, 3, 5...) = 0°
  const lastMiddleChunkIndex = middleChunkCount - 1
  const endChunkRotationY = lastMiddleChunkIndex % 2 === 0 ? 180 : 0
  
  console.log(`[Tower Generator] Creating ChunkEnd at Y=${endChunkY.toFixed(2)} with rotation ${endChunkRotationY}°`)
  console.log(`[Tower Generator] Middle chunk count: ${middleChunkCount}, last middle chunk index: ${lastMiddleChunkIndex} (${lastMiddleChunkIndex % 2 === 0 ? 'even→180°' : 'odd→0°'}), ChunkEnd rotation: ${endChunkRotationY}°`)
  
  const endEntity = createChunk(
    END_CHUNK,
    Vector3.create(TOWER_X, endChunkY, TOWER_Z),
    endChunkRotationY
  )
  
  chunkEndEntity = endEntity
  spawnedChunkEntities.push(endEntity)
  
  // Build the chunk list from top to bottom: ChunkEnd, then middle chunks (in reverse order), then ChunkStart
  currentTowerChunks = [
    getChunkName(END_CHUNK),  // Top
    ...chunksUsed.reverse(),  // Middle chunks (reversed to show top-to-bottom)
    'ChunkStart'              // Bottom (always present)
  ]
  
  // Verify ChunkEnd was created
  if (Transform.has(endEntity)) {
    const endTransform = Transform.get(endEntity)
    console.log(`[Tower Generator] ChunkEnd created successfully at position: (${endTransform.position.x.toFixed(2)}, ${endTransform.position.y.toFixed(2)}, ${endTransform.position.z.toFixed(2)})`)
    console.log(`[Tower Generator] ChunkEnd rotation: Y=${endChunkRotationY}°`)
  } else {
    console.error(`[Tower Generator] ERROR: ChunkEnd entity missing Transform component!`)
  }
  
  if (GltfContainer.has(endEntity)) {
    const gltf = GltfContainer.get(endEntity)
    console.log(`[Tower Generator] ChunkEnd GLTF loaded: ${gltf.src}`)
  } else {
    console.error(`[Tower Generator] ERROR: ChunkEnd entity missing GltfContainer component!`)
  }
  
  // Log total entities created
  console.log(`[Tower Generator] Total entities created: ${spawnedChunkEntities.length} (${middleChunkCount} middle + 1 end)`)
  
  // Calculate and update tower height
  // Height = (total middle chunks + 1) × 10.821
  // The +1 accounts for ChunkStart at the base
  currentTowerHeight = (middleChunkCount + 1) * CHUNK_HEIGHT
  
  console.log(`[Tower Generator] Generated tower with ${middleChunkCount} middle chunks + ChunkEnd. Total height: ${currentTowerHeight.toFixed(2)}m`)
  console.log(`[Tower Generator] ChunkEnd entity ID: ${chunkEndEntity}, stored in array: ${spawnedChunkEntities.includes(chunkEndEntity)}`)
}

/**
 * Verification function to check if ChunkEnd is visible
 * Can be called manually for debugging
 */
export function verifyChunkEnd(): boolean {
  if (!chunkEndEntity) {
    console.error('[Tower Generator] ChunkEnd entity is null')
    return false
  }
  
  if (!Transform.has(chunkEndEntity)) {
    console.error('[Tower Generator] ChunkEnd missing Transform component')
    return false
  }
  
  if (!GltfContainer.has(chunkEndEntity)) {
    console.error('[Tower Generator] ChunkEnd missing GltfContainer component')
    return false
  }
  
  const transform = Transform.get(chunkEndEntity)
  const gltf = GltfContainer.get(chunkEndEntity)
  
  console.log(`[Tower Generator] ChunkEnd verification:`)
  console.log(`  - Position: (${transform.position.x.toFixed(2)}, ${transform.position.y.toFixed(2)}, ${transform.position.z.toFixed(2)})`)
  console.log(`  - Rotation Y: ${transform.rotation.y}`)
  console.log(`  - GLTF Source: ${gltf.src}`)
  console.log(`  - Entity ID: ${chunkEndEntity}`)
  
  return true
}

