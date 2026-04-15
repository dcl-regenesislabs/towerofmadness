const FALLBACK_PLAYER_NAME = 'Player'

function truncateName(value: string, maxLength?: number): string {
  if (!maxLength || value.length <= maxLength) return value
  if (maxLength <= 2) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 2)}..`
}

export function formatPlayerNameWithWallet(
  displayName: string | undefined,
  wallet: string | undefined,
  maxLength?: number
): string {
  const name = displayName?.trim() || FALLBACK_PLAYER_NAME
  const walletSuffix = wallet?.trim().slice(-4)

  if (!walletSuffix) {
    return truncateName(name, maxLength)
  }

  const suffix = `#${walletSuffix}`
  const fullName = `${name}${suffix}`
  if (!maxLength || fullName.length <= maxLength) return fullName

  const availableNameLength = maxLength - suffix.length - 2
  if (availableNameLength <= 0) return suffix.length <= maxLength ? suffix : suffix.slice(-maxLength)

  return `${name.slice(0, availableNameLength)}..${suffix}`
}
