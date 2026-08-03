import { signedFetch } from '~system/SignedFetch'
import { ANALYTICS_CONFIG } from './analyticsConfig'

/**
 * The single choke point for ALL analytics. Nothing else in the codebase talks
 * to PostHog directly — swap this file to change providers.
 *
 * - Fire-and-forget: never awaited on the gameplay path, never throws.
 * - Provider-agnostic to callers: they only pass a name, the player's wallet,
 *   and optional properties.
 * - Works from both client and server (both have `signedFetch`; PostHog ignores
 *   the DCL auth headers it adds).
 *
 * Adding a new event = one more `trackEvent(...)` call. No new plumbing.
 *
 * @param name        Event name, PostHog "[object] [verb]" lowercase style
 *                    (e.g. 'session started', 'tutorial step reached').
 * @param distinctId  The player's wallet address — the identity that ties
 *                    multiple sessions to one person (required for retention).
 * @param properties  Extra event properties. `game` + `$lib` are added here.
 */
export function trackEvent(name: string, distinctId: string, properties: Record<string, unknown> = {}): void {
  if (!ANALYTICS_CONFIG.enabled) return
  if (!distinctId) return // no wallet → no identity; skip rather than send anonymous

  try {
    let timestamp: string | undefined
    try {
      timestamp = new Date(Date.now()).toISOString()
    } catch {
      timestamp = undefined // PostHog falls back to receive time
    }

    const body = {
      api_key: ANALYTICS_CONFIG.projectApiKey,
      event: name,
      distinct_id: distinctId.toLowerCase(),
      timestamp,
      properties: {
        game: ANALYTICS_CONFIG.gameId,
        $lib: 'dcl-sdk7-custom',
        ...properties
      }
    }

    // Fire-and-forget — do NOT await; analytics must never sit on the gameplay
    // path. Any failure (network down, bad key) is swallowed silently.
    void signedFetch({
      url: `https://${ANALYTICS_CONFIG.host}/i/v0/e/`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    }).catch(() => {
      // swallow — analytics must never break the game
    })
  } catch {
    // swallow — analytics must never break the game
  }
}
