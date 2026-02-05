import ReactEcs, { UiEntity, type UiTransformProps } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"

export type OutlineOffset = { x: number; y: number }

export const OUTLINE_OFFSETS_8: OutlineOffset[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 }
]

export const OUTLINE_OFFSETS_16: OutlineOffset[] = [
  { x: -3, y: 0 },
  { x: 3, y: 0 },
  { x: 0, y: -3 },
  { x: 0, y: 3 },
  { x: -3, y: -1 },
  { x: -3, y: 1 },
  { x: 3, y: -1 },
  { x: 3, y: 1 },
  { x: -1, y: -3 },
  { x: 1, y: -3 },
  { x: -1, y: 3 },
  { x: 1, y: 3 },
  { x: -2, y: -2 },
  { x: 2, y: -2 },
  { x: -2, y: 2 },
  { x: 2, y: 2 }
]

export type OutlinedTextProps = {
  uiTransform: UiTransformProps
  uiText: any
  outlineColor?: Color4
  outlineOffsets?: OutlineOffset[]
  outlineScale?: number
  outlineKeyPrefix?: string
}

const getOffsetPosition = (
  offset: OutlineOffset,
  scale: number
) => {
  return {
    left: offset.x * scale,
    top: offset.y * scale
  }
}

export const OutlinedText = ({
  uiTransform,
  uiText,
  outlineColor = Color4.Black(),
  outlineOffsets = OUTLINE_OFFSETS_8,
  outlineScale = 1,
  outlineKeyPrefix = "outlined-text"
}: OutlinedTextProps) => {
  const childTransformBase: UiTransformProps = {
    width: "100%",
    height: "100%",
    positionType: "absolute",
    position: { left: 0, top: 0 },
    alignItems: uiTransform?.alignItems as UiTransformProps["alignItems"],
    justifyContent: uiTransform?.justifyContent as UiTransformProps["justifyContent"]
  }

  return (
    <UiEntity uiTransform={uiTransform}>
      {outlineOffsets.map((offset, index) => (
        <UiEntity
          key={`${outlineKeyPrefix}-${index}`}
          uiTransform={{
            ...childTransformBase,
            position: getOffsetPosition(offset, outlineScale)
          }}
          uiText={{
            ...uiText,
            color: outlineColor
          }}
        />
      ))}
      <UiEntity
        key={`${outlineKeyPrefix}-base`}
        uiTransform={childTransformBase}
        uiText={uiText}
      />
    </UiEntity>
  )
}
