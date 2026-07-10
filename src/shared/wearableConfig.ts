/**
 * Wearable prize configuration — accessible from both server and client.
 * The campaign_key is not sensitive for non-captcha campaigns.
 */

export const WEARABLE_CONFIG = {
  campaignId: 'fbe2c783-f181-4ac9-abb6-f18f1e7cd3ad',
  campaignKey: 'EKWMg2g6Q8uqt47G6jmmePvix4PxgUrJq7bxjx58060=.Umlk1fZuvkdmPBpLOoWFk7Y9NL13ZrmvPvD6Iu4pvUA=',
  rewardsApi: 'https://rewards.decentraland.org/api/campaigns',
  catalyst: 'https://realm-provider-ea.decentraland.org'
}

/**
 * Pigeon trophy campaign — the wearable dispensed by clicking the pigeon at the
 * top of the tower. Kept separate from the tournament prize (WEARABLE_CONFIG).
 */
export const PIGEON_WEARABLE_CONFIG = {
  campaignId: 'b3e8f1c6-1afb-4c32-8c7a-e76e16ad9e69',
  campaignKey: '3jIRZ1EmTQqmx6gvU6h3L7Po8cYa+0wyjHrnbhatnmk=.5c/KbsblJP7QzEQGYxAneymIzMPzAFFQllqWwVOzZeg=',
  rewardsApi: 'https://rewards.decentraland.org/api/campaigns',
  catalyst: 'https://realm-provider-ea.decentraland.org'
}
