// ============================================
// STANDALONE TUTORIAL TOWER
// ============================================
// A tiny, static, never-regenerated tower used only by the pigeon tutorial —
// no round timer, no leaderboard, no anti-cheat. Built once by the server
// (see server/gameState.ts createTutorialTower()) in a far corner of the
// parcels, away from the real tower. Since it never changes, both the server
// (building it) and the client (teleport targets, "reached the top" check)
// can just share these compile-time constants instead of syncing anything.

// Must match CHUNK_HEIGHT in server/gameState.ts.
export const TUTORIAL_CHUNK_HEIGHT = 10.821

// The real tower sits at (40, 40). scene.json now claims parcel columns 9-20
// on top of the original 0-8 (see the parcels array), so there's a whole new
// block of land east of the real tower — put the tutorial tower deep inside
// it, 240m away, so there's zero chance of the two overlapping.
export const TUTORIAL_TOWER_X = 280
export const TUTORIAL_TOWER_Z = 40

// "La parte de abajo, el primer chunk y el ultimo" — shortest possible climb.
export const TUTORIAL_MIDDLE_CHUNK_ID = 'Chunk01'

export const TUTORIAL_TOWER_TOP_Y = TUTORIAL_CHUNK_HEIGHT * 2
// Player doesn't need to stand exactly on the platform to count as "arrived".
export const TUTORIAL_CLIMB_REACHED_Y = TUTORIAL_TOWER_TOP_Y - 3

// Real tower's base — where the player is sent when they click Skip.
export const REAL_TOWER_BASE_POSITION = { x: 40.38, y: 11.5, z: 10.5 }

// Landing spot next to ChunkStart when the tutorial begins. Ground level (y≈0,
// same convention gameState.ts uses to stack the middle chunk on top of
// ChunkStart) plus a small clearance — NOT the real tower's y=11.5, which only
// makes sense there because of an elevated entrance bridge/platform that's
// part of the hub composite and doesn't exist out here.
// Offset diagonally (not straight along one axis) and generously far (~20m)
// from the tower's center: ChunkStart's rotation here doesn't necessarily match
// the real tower's (ours is code-placed, not hand-placed in Creator Hub), so a
// straight-line offset in front of where we'd *guess* the ramp faces can still
// land the player underneath it if that guess is wrong. A diagonal offset well
// past the model's footprint avoids depending on that guess entirely.
export const TUTORIAL_TOWER_BASE_POSITION = { x: TUTORIAL_TOWER_X + 14, y: 1, z: TUTORIAL_TOWER_Z + 14 }

// Where the wearable-claim trophy stands, right on top of ChunkEnd.
export const TUTORIAL_TROPHY_POSITION = { x: TUTORIAL_TOWER_X, y: TUTORIAL_TOWER_TOP_Y, z: TUTORIAL_TOWER_Z }
