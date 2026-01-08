import { engine, Transform, GltfContainer, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { EntityNames } from '../assets/scene/entity-names'

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
const MAX_MIDDLE_CHUNKS = 8

// Available chunk files
const MIDDLE_CHUNKS = [
  'assets/chunks/Chunk01.glb',
  'assets/chunks/Chunk02.glb',
  'assets/chunks/Chunk03.glb'
]

// Reference to ChunkEnd01 entity from the scene (we'll move it, not clone it)
let chunkEnd01Entity: Entity | null = null

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
  // Remove all spawned chunk entities (but NOT ChunkEnd01, we'll just move it)
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
  // Note: chunkEnd01Entity is NOT cleared - we keep it to move it
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
 * Initializes the ChunkEnd01 entity reference from the scene
 * This should be called once before generating towers
 */
function initializeEndChunk() {
  if (chunkEnd01Entity !== null) return // Already initialized
  
  // Try to get ChunkEnd01 entity by name
  const foundEntity = engine.getEntityOrNullByName('ChunkEnd01')
  
  if (foundEntity) {
    chunkEnd01Entity = foundEntity
    console.log(`[Tower Generator] Found ChunkEnd01 in scene, will move it to tower top`)
  } else {
    console.log(`[Tower Generator] WARNING: ChunkEnd01 not found in scene`)
  }
}

/**
 * Generates the complete tower structure
 * Returns the ChunkEnd entity so trigger listeners can be set up
 */
export function generateTower(): Entity | null {
  // Initialize END_CHUNK from ChunkEnd01 if not already done
  initializeEndChunk()
  
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
  
  // Ensure ChunkEnd01 entity is initialized
  if (chunkEnd01Entity === null) {
    initializeEndChunk()
  }
  
  let endEntity: Entity
  
  // If ChunkEnd01 exists in scene, move it to the tower top
  if (chunkEnd01Entity !== null) {
    // Move and rotate the existing ChunkEnd01 entity
    if (Transform.has(chunkEnd01Entity)) {
      const transform = Transform.getMutable(chunkEnd01Entity)
      transform.position = Vector3.create(TOWER_X, endChunkY, TOWER_Z)
      transform.rotation = Quaternion.fromEulerDegrees(0, endChunkRotationY, 0)
      console.log(`[Tower Generator] Moved ChunkEnd01 to position (${TOWER_X}, ${endChunkY.toFixed(2)}, ${TOWER_Z}) with rotation ${endChunkRotationY}°`)
    } else {
      // If it doesn't have a transform, create one
      Transform.create(chunkEnd01Entity, {
        position: Vector3.create(TOWER_X, endChunkY, TOWER_Z),
        rotation: Quaternion.fromEulerDegrees(0, endChunkRotationY, 0),
        scale: Vector3.One()
      })
      console.log(`[Tower Generator] Created Transform for ChunkEnd01`)
    }
    endEntity = chunkEnd01Entity
  } else {
    // Fallback: create simple chunk with GLTF
    endEntity = createChunk(
      'assets/chunks/ChunkEnd.glb',
      Vector3.create(TOWER_X, endChunkY, TOWER_Z),
      endChunkRotationY
    )
    spawnedChunkEntities.push(endEntity)
    console.log(`[Tower Generator] Using fallback ChunkEnd.glb`)
  }
  
  chunkEndEntity = endEntity
  
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
  
  // Build the chunk list from top to bottom: ChunkEnd, then middle chunks (in reverse order), then ChunkStart
  const endChunkName = chunkEnd01Entity !== null ? 'ChunkEnd01' : 'ChunkEnd'
  currentTowerChunks = [
    endChunkName,              // Top
    ...chunksUsed.reverse(),  // Middle chunks (reversed to show top-to-bottom)
    'ChunkStart'              // Bottom (always present)
  ]
  
  // Return the end entity so caller can set up trigger listeners if needed
  return endEntity
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

/**
 * Generates a tower using specific chunk IDs from the server
 * This ensures all players see the exact same tower
 * 
 * @param chunkIds Array of chunk names like ["Chunk01", "Chunk02", "Chunk03"]
 * @returns The ChunkEnd entity for trigger setup
 */
export function generateTowerFromServer(chunkIds: string[]): Entity | null {
  console.log('[Tower Generator] ═══════════════════════════════════')
  console.log('[Tower Generator] Building tower from SERVER data')
  console.log(`[Tower Generator] Chunks: ${chunkIds.join(' → ')}`)
  console.log('[Tower Generator] ═══════════════════════════════════')

  // Initialize END_CHUNK from ChunkEnd01 if not already done
  initializeEndChunk()

  // Clear existing tower (except ChunkStart)
  clearTower()

  // Use the server's chunk count
  const middleChunkCount = chunkIds.length
  currentMiddleChunkCount = middleChunkCount

  // Track chunks used (from top to bottom, so we'll build in reverse order)
  const chunksUsed: string[] = []

  // Spawn middle chunks with alternating rotations
  for (let i = 0; i < middleChunkCount; i++) {
    const yPosition = CHUNK_HEIGHT * (i + 1) // First chunk at Y=10.821, second at Y=21.642, etc.

    // Alternating rotation: even indices (0, 2, 4...) = 180°, odd indices (1, 3, 5...) = 0°
    const rotationY = i % 2 === 0 ? 180 : 0

    // Use the chunk ID from server
    const chunkName = chunkIds[i]
    const chunkPath = `assets/chunks/${chunkName}.glb`

    // Track chunk (we'll reverse the array later to show top-to-bottom)
    chunksUsed.push(chunkName)

    // Create chunk entity
    const entity = createChunk(
      chunkPath,
      Vector3.create(TOWER_X, yPosition, TOWER_Z),
      rotationY
    )

    spawnedChunkEntities.push(entity)
    console.log(`[Tower Generator] Spawned ${chunkName} at Y=${yPosition.toFixed(2)} rot=${rotationY}°`)
  }

  // Spawn ChunkEnd at the top
  const endChunkY = CHUNK_HEIGHT * (middleChunkCount + 1)

  // Determine ChunkEnd rotation to match the last middle chunk's rotation
  const lastMiddleChunkIndex = middleChunkCount - 1
  const endChunkRotationY = lastMiddleChunkIndex % 2 === 0 ? 180 : 0

  console.log(`[Tower Generator] Placing ChunkEnd at Y=${endChunkY.toFixed(2)} rot=${endChunkRotationY}°`)

  // Ensure ChunkEnd01 entity is initialized
  if (chunkEnd01Entity === null) {
    initializeEndChunk()
  }

  let endEntity: Entity

  // If ChunkEnd01 exists in scene, move it to the tower top
  if (chunkEnd01Entity !== null) {
    if (Transform.has(chunkEnd01Entity)) {
      const transform = Transform.getMutable(chunkEnd01Entity)
      transform.position = Vector3.create(TOWER_X, endChunkY, TOWER_Z)
      transform.rotation = Quaternion.fromEulerDegrees(0, endChunkRotationY, 0)
    } else {
      Transform.create(chunkEnd01Entity, {
        position: Vector3.create(TOWER_X, endChunkY, TOWER_Z),
        rotation: Quaternion.fromEulerDegrees(0, endChunkRotationY, 0),
        scale: Vector3.One()
      })
    }
    endEntity = chunkEnd01Entity
  } else {
    // Fallback: create simple chunk with GLTF
    endEntity = createChunk(
      'assets/chunks/ChunkEnd.glb',
      Vector3.create(TOWER_X, endChunkY, TOWER_Z),
      endChunkRotationY
    )
    spawnedChunkEntities.push(endEntity)
  }

  chunkEndEntity = endEntity

  // Calculate and update tower height
  currentTowerHeight = (middleChunkCount + 1) * CHUNK_HEIGHT

  // Build the chunk list from top to bottom
  const endChunkName = chunkEnd01Entity !== null ? 'ChunkEnd01' : 'ChunkEnd'
  currentTowerChunks = [
    endChunkName,
    ...chunksUsed.reverse(),
    'ChunkStart'
  ]

  console.log('[Tower Generator] ═══════════════════════════════════')
  console.log(`[Tower Generator] ✅ Tower built! Height: ${currentTowerHeight.toFixed(2)}m`)
  console.log('[Tower Generator] ═══════════════════════════════════')

  return endEntity
}

/**
 * Clear the tower (exported for multiplayer use)
 */
export function clearCurrentTower() {
  clearTower()
}

