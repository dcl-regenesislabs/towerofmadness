import { engine, Transform, GltfContainer, GltfContainerLoadingState, LoadingState, Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { ALL_CHUNK_IDS, getChunkAssetPath } from './shared/chunks'

// ============================================================================
// CHUNK ASSET PRELOAD (client-only)
// ----------------------------------------------------------------------------
// Root cause of the "fall through renewed chunks" bug: the FIRST time a chunk
// GLB is loaded it must be downloaded (cold cache). The renderer shows the
// visible mesh as soon as it can, but the physics collider (from the GLB's
// `*_collider` mesh) only becomes active once the GLB reaches FINISHED. On a
// cold load that window is seconds long, so a player climbing the freshly
// renewed tower reaches the lower chunks before their colliders exist → falls.
// Once a GLB is cached, reloads are sub-second and the window disappears.
//
// Fix: warm the cache for EVERY chunk GLB once, at scene start (while the player
// is still at the base), so no tower renewal ever hits a cold download again.
// We spawn a tiny, tucked-away entity per distinct GLB just to force the
// download, then remove it as soon as it finishes — the asset stays cached.
// ============================================================================

export function setupChunkPreload(): void {
  const srcs = Array.from(new Set(ALL_CHUNK_IDS.map((id) => getChunkAssetPath(id))))
  const pending = new Set<Entity>()

  for (const src of srcs) {
    const e = engine.addEntity()
    // Tiny (1mm) and off in a corner so it's effectively invisible; it exists
    // only to make the renderer download + cache the GLB.
    Transform.create(e, {
      position: Vector3.create(0.5, 0.5, 0.5),
      scale: Vector3.create(0.001, 0.001, 0.001)
    })
    GltfContainer.create(e, { src })
    pending.add(e)
  }

  const startedAt = Date.now()
  console.log(`[ChunkPreload] warming ${pending.size} chunk GLBs at startup...`)

  function preloadSystem(): void {
    for (const e of pending) {
      const state = GltfContainerLoadingState.getOrNull(e)?.currentState
      // Done (or failed) → drop the temp entity; the downloaded asset stays cached.
      if (
        state === LoadingState.FINISHED ||
        state === LoadingState.FINISHED_WITH_ERROR ||
        state === LoadingState.NOT_FOUND
      ) {
        pending.delete(e)
        engine.removeEntity(e)
      }
    }
    if (pending.size === 0) {
      console.log(`[ChunkPreload] ✓ all chunk GLBs cached after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
      engine.removeSystem(preloadSystem)
    }
  }

  engine.addSystem(preloadSystem, undefined, 'chunk-preload-system')
}
