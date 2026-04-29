// import { Animator, AudioSource, GltfContainer, InputAction, PBGltfContainer, Transform, TransformTypeWithOptionals, engine, pointerEventsSystem } from '@dcl/sdk/ecs'
// import { ClaimConfigInstType, CONFIG_CLAIM_TESTING_ENABLED } from './claimConfig'
// // import resources from '../resources'
// import { claimToken } from './claim'
// import * as utils from '@dcl-sdk/utils'
// import { btnAnimName, btnModel } from '../giftshopDispenser'
// // import { CONFIG } from '../config'


// export function createDispenser(campaign: ClaimConfigInstType, campaign_key: string, dispTransform: TransformTypeWithOptionals) {
//     const dispenserBase = engine.addEntity()
//     GltfContainer.create(dispenserBase, {
//         src: 'models/dispenser/lost_in_space_dispenser.glb'
//     })
//     Transform.create(dispenserBase, {
//         ...dispTransform
//     })

//     const dispenserButton = engine.addEntity()
//     GltfContainer.create(dispenserButton, {
//         src: btnModel
//     })
//     Transform.create(dispenserButton, {
//         ...dispTransform
//     })

//     Animator.create(dispenserButton, {
//         states: [
//             {
//                 clip: btnAnimName,
//                 loop: false,
//                 playing: false
//             }
//         ]
//     })

//     // const wewarable = engine.addEntity()
//     // GltfContainer.create(wewarable, wearableModel)
//     // Transform.create(wewarable, wearableTransform)
//     // Transform.getMutable(wewarable).parent = dispenserBase

//     const clickSound = engine.addEntity()
//     Transform.create(clickSound, {parent: engine.CameraEntity})
//     AudioSource.create(clickSound, {
//         audioClipUrl: 'sounds/dispenser/click.mp3',
//         playing: false,
//         loop: false
//     })

//     const clickFailSound = engine.addEntity()
//     Transform.create(clickFailSound, {parent: engine.CameraEntity})
//     AudioSource.create(clickFailSound, {
//         audioClipUrl: 'sounds/dispenser/click_fail.mp3',
//         playing: false,
//         loop: false
//     })
    
//     let canClick = true
//     const clickDelayMs = 4000
//     pointerEventsSystem.onPointerDown(
//         {
//             entity: dispenserButton,
//             opts: {
//                 button: InputAction.IA_POINTER,
//                 hoverText: CONFIG_CLAIM_TESTING_ENABLED ? 'Claim ' + campaign.refId : 'Claim',
//                 maxDistance: 5
//             }
//         },
//         function () {
//             if(!canClick) {
//                 AudioSource.getMutable(clickFailSound).playing = true
//                 return
//             }
//             AudioSource.getMutable(clickSound).playing = true

//             canClick = false
//             utils.timers.setTimeout(() => {
//                 canClick = true
//             }, clickDelayMs)
            
//             Animator.playSingleAnimation(dispenserButton, btnAnimName, true)

//             utils.timers.setTimeout(() => {
//                 claimToken(campaign, campaign_key, campaign.refId)
//             }, 500)
//         }
//     )


// }