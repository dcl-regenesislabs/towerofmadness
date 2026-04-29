// // import { CONFIG } from "../config"

// export type ClaimConfigInstType = {
//     refId: string
//     campaign: string
//     campaignKeys: Record<string, string>
// }

// export const USE_CAPTCHA: boolean = false
// export const CONFIG_CLAIM_TESTING_ENABLED = false

// const TEST_CAMPAIGN_ID = '7a7c87db-801a-4427-bf2b-2fab3d518b58'
// //non captcha
// const TEST_CAMPAIGN_KEY = 'eyJpZCI6IjY2NThmOGRiLWZjNGItNDQyMC05NTUzLWYyZDQxODRjZDY3YiIsImNhbXBhaWduX2lkIjoiN2E3Yzg3ZGItODAxYS00NDI3LWJmMmItMmZhYjNkNTE4YjU4In0=.lu0GNQ/5Tjl4QvAvJuFJ5hhjIPfyaeqVcWluMX/3WyY='
// //const TEST_CAMPAIGN_KEY = 'eyJpZCI6IjY2NThmOGRiLWZjNGItNDQyMC05NTUzLWYyZDQxODRjZDY3YiIsImNhbXBhaWduX2lkIjoiN2E3Yzg3ZGItODAxYS00NDI3LWJmMmItMmZhYjNkNTE4YjU4In0=.lu0GNQ/5Tjl4QvAvJuFJ5hhjIPfyaeqVcWluMX/3WyY='

// export const ClaimConfig = {
//     // for production: 'https://rewards.decentraland.org'
//     // for testing: 'https://rewards.decentraland.zone'
//     rewardsServer: CONFIG_CLAIM_TESTING_ENABLED ? 'https://rewards.decentraland.zone' : 'https://rewards.decentraland.org',
//     campaign: {

        
//         San_Holo_Holocap: {
//             refId: 'San_Holo_Holocap',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'PsnHITqDQweWejzYT4ALgGVfZ87cikT6gHgL+IpMQik=.Uf4uj3mWRqxtuhx8tqo/DvK58Gpv6HYsWghcMC56ppA='
//             }
//         },
//         Whipped_Cream_Jacket: {
//             refId: 'Whipped_Cream_Jacket',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'gOZkaFaUR4+AKNMczwJtCWVfZ87cikT6gHgL+IpMQik=.4HuUy+iTk214CcAjsAs3K9QpAHjY0Mw3VWgefSbeKb0='
//             }
//         },
//         NGHTMRE_Puffer_Jacket: {
//             refId: 'NGHTMRE_Puffer_Jacket',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'ncYUKcvMQgyHe2da8ra8QmVfZ87cikT6gHgL+IpMQik=.CfVbuuKAHuZFZ4TgjYuf90u0vswqrrC4LLfSyIuyUlM='
//             }
//         },
//         Mat_Zo_Hat: {
//             refId: 'Mat_Zo_Hat',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'ph8Il434SwahZz2UYjtrnWVfZ87cikT6gHgL+IpMQik=.6ewaNHRD+ixgbQJwSpQ+TI3adeuBqtAN5JzB23Z/N4U='
//             }
//         },


//         Alien_Touch: {
//             refId: 'Alien_Touch',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'JxwKeYsZRs6Q2yDPnIhgfmVfZ87cikT6gHgL+IpMQik=.chZsHOSi1PhQOukZfQJEd0vMsKmYF8V3NCFlU0OrSdA='
//             }
//         },
//         Sneakers_Viva_La_Calaca: {
//             refId: 'Sneakers_Viva_La_Calaca',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'myqvxVL9QC2SUoKp0PcdhmVfZ87cikT6gHgL+IpMQik=.5zndLfrTc+ifAM2B2KXzcSo0zTyDJJwRyhQFbKbnMgw='
//             }
//         },
//         EDM_DANCE_FX: {
//             refId: 'EDM_DANCE_FX',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : '2MKC6sotRhC+DzqI+t3OvmVfZ87cikT6gHgL+IpMQik=.oCvi5NK6ZpwadHorykFLjbD9MgaC5Ak0O4GTU9zE+Pc='
//             }
//         },
//         EDM_SHAPE_CUTTING: {
//             refId: 'EDM_SHAPE_CUTTING',
//             campaign: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_ID : '655f67ce-dc8a-44fa-8078-0bf88a4c4229',
//             campaignKeys: {
//                 key: CONFIG_CLAIM_TESTING_ENABLED ? TEST_CAMPAIGN_KEY : 'KciN0N2aS7CUaTrijq+2mmVfZ87cikT6gHgL+IpMQik=.D3d3t4fD0yuNtKqjN+Fy38XDYnfJp5JoZzjUo/m7Maw='
//             }
//         },
//     }
// }
