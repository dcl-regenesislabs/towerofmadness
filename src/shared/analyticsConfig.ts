/**
 * PostHog analytics config — shared by client and server.
 *
 * `projectApiKey` is a PUBLIC, write-only capture token (starts with `phc_`),
 * safe to ship in the build. Do NOT put a personal API key here.
 *
 * Single source of truth for all analytics config (see shared/analytics.ts).
 */
export const ANALYTICS_CONFIG = {
  // Kill switch — set to false to disable ALL tracking (no other code changes).
  enabled: true,

  // PostHog Cloud host: 'us.i.posthog.com' (US) or 'eu.i.posthog.com' (EU).
  // This project is EU Cloud.
  host: 'eu.i.posthog.com',

  // PostHog project API key (phc_...) — public write-only capture token (project 237538).
  projectApiKey: 'phc_CpcmxwsHB5HGTscBrk7pDv7Z5BKiMzD7TFA65Xj7UKaR',

  // The `game` property stamped on every event so the games are comparable in
  // one PostHog project. Confirm the slug you want for this game.
  gameId: 'towerofmadness'
}
