// import { getRealm } from '~system/Runtime'
// import { signedFetch } from '~system/SignedFetch'
// import { ClaimConfig, ClaimConfigInstType, USE_CAPTCHA } from './claimConfig'
// import { getUserData } from '~system/UserIdentity'
// import { confirmationUI, alreadyClaimedUI, errorUI, breakLines, captchaUI, showWaitingUI } from './ui'
// import * as utils from '@dcl-sdk/utils'

// let inTimeOut: boolean = false

// let alreadyClaimed: string[] = []

// let userData: any
// export async function setUserData() {
//   userData = await getUserData({})
//   console.log('user data is', userData)
//   if (!userData || !userData.data || !userData.data.publicKey) {
//     errorUI('You must be\nconnected with an Ethereum wallet\nto claim rewards.')
//     return false
//   }
//   return true
// }

// export async function claimToken(campaign: ClaimConfigInstType, campaign_key: string, _refId: string | null) {
//   // prevent more than 1 request per second
//   if (inTimeOut) return

//   inTimeOut = true
//   utils.timers.setTimeout(() => {
//     inTimeOut = false
//   }, 3000)

//   // check if this same wearable was already claimed in this session
//   const isClaimed = alreadyClaimed.find((item) => item === campaign_key)

//   if (isClaimed) {
//     alreadyClaimedUI()
//     console.log('already claimed')
//     return
//   }

//   await setUserData()
//   showWaitingUI(true)

//   if (USE_CAPTCHA) {
//     const request = await fetch(`https://rewards.decentraland.org/api/captcha`, { method: 'POST' })
//     const captcha = await request.json()
//     console.log('CAPTCHA DATA: ', captcha)
//     captchaUI(captcha.data.image, captcha.data.id, campaign, campaign_key)
//   } else {
//     let result = await requestToken(campaign, campaign_key)
//     return result
//   }
// }

// async function requestToken(campaign: ClaimConfigInstType, campaign_key: string) {
//   let METHOD_NAME = 'claimToken'

//   const url = ClaimConfig.rewardsServer + '/api/campaigns/' + campaign.campaign + '/rewards'
//   console.log(METHOD_NAME, 'sending req to: ', url)

//   let realm = await getRealm({})
//   console.log('realm is', realm.realmInfo?.baseUrl)

//   let body = JSON.stringify({
//     campaign_key: campaign_key,
//     // catalyst: realm.realmInfo ? realm.realmInfo.baseUrl : '',
//     // catalyst: 'https://realm-provider.decentraland.org',
//     catalyst: 'https://realm-provider-ea.decentraland.org',
//     // catalyst: 'https://archipelago-ea-stats.decentraland.org/',
//     beneficiary: userData.data.hasConnectedWeb3 ? userData.data.userId : ''
//   })

//   try {
//     let response: any = null
//     console.log(METHOD_NAME, 'signedFetch')
//     response = await signedFetch({
//       url: url,
//       init: {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: body
//       }
//     })

//     console.log(METHOD_NAME, 'Reward received resp body: ', response)

//     let result = await processResponse(response, campaign_key)
//     return result
//   } catch (error) {
//     console.log(METHOD_NAME, 'error fetching from token server ', url)
//     console.log(METHOD_NAME, 'error', error)
//     showWaitingUI(false)
//     // errorUI('\nError fetching from token server')
//   }
// }

// async function processResponse(response: any, campaign_key: string) {
//   if (!response || !response.body) {
//     throw new Error('Invalid response')
//   }
//   console.log('Reward response: ', JSON.stringify(response))
//   let json = await JSON.parse(response.body)
//   console.log('Reward received json: ', json)

//   if (json.ok === false) {
//     console.log('ERROR:' + json.error)
//     showWaitingUI(false)
//     errorUI(json.code ? breakLines(json.code, 20) : 'Invalid response')
//   }
//   //result ok but out of stock
//   else if(json && json.ok && json.data && !json.data[0] && !json.error){
//     showWaitingUI(false)
//     errorUI('Item is out of stock.\nPlease try again later.')
//   }
  

//   alreadyClaimed.push(campaign_key)
//   showWaitingUI(false)
//   confirmationUI(json.data[0].image, json.data[0].token)
//   return true

//   // test
//   //openUI('images/scene-thumbnail.png', 'Wearable Name')
// }

// export async function validateCaptcha(
//   captcha: string,
//   captcha_id: string,
//   campaign: ClaimConfigInstType,
//   campaign_key: string
// ) {
//   const user = await getUserData({})
//   let realm = await getRealm({})
//   console.log('realm is', realm.realmInfo)
//   if (!user || !user.data || !user.data.publicKey || !realm) {
//     errorUI('You must be\nconnected with an Ethereum wallet\nto claim rewards.')
//     return
//   }

//   const response = await signedFetch({
//     url: 'https://rewards.decentraland.org/api/rewards',
//     init: {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({
//         campaign_key: campaign_key,
//         catalyst: realm.realmInfo ? realm.realmInfo.baseUrl : '',
//         beneficiary: userData.data.hasConnectedWeb3 ? userData.data.userId : '',
//         captcha_id: captcha_id,
//         captcha_value: captcha
//       })
//     }
//   })

//   if (!response || !response.body) {
//     return false
//   }
//   let json = await JSON.parse(response.body)
//   console.log(json)

//   if (json.ok === false) {
//     console.log('ERROR:' + json.code)
//     errorUI(json.code ? breakLines(json.code, 20) : 'Invalid response')
//     return false
//   }

//   alreadyClaimed.push(campaign_key)

//   confirmationUI(json.data[0].image, json.data[0].token)
// }
