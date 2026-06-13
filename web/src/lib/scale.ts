export interface ScaleSettings {
  distanceMultiplier: number
  timeMultiplier: number
  showGameValues: boolean
}

export const DEFAULT_SCALE: ScaleSettings = {
  distanceMultiplier: 30,
  timeMultiplier: 40,
  showGameValues: false,
}

export function scaleDistance(meters: number, settings: ScaleSettings): number {
  return meters * settings.distanceMultiplier
}

export function scaleDuration(seconds: number, settings: ScaleSettings): number {
  return seconds * settings.timeMultiplier
}

export function scaleDistanceKm(km: number, settings: ScaleSettings): number {
  return km * settings.distanceMultiplier
}

export interface ScaledRouteValues {
  durationSeconds: number
  distanceMeters: number
  isScaled: boolean
}

export function getScaledRouteValues(
  durationSeconds: number,
  distanceMeters: number,
  settings: ScaleSettings,
): ScaledRouteValues {
  if (settings.showGameValues) {
    return { durationSeconds, distanceMeters, isScaled: false }
  }
  return {
    durationSeconds: scaleDuration(durationSeconds, settings),
    distanceMeters: scaleDistance(distanceMeters, settings),
    isScaled: true,
  }
}

/** Umsteige-Fußweg: Export-Penalty ist bereits ~Minuten, nicht mit Fahrzeit-Multiplikator skalieren. */
export function getTransferDisplaySeconds(seconds: number): number {
  return seconds
}
