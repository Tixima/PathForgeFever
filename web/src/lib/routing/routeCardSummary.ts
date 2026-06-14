import type { RouteLeg, RouteResult } from './types'
import type { ScaleSettings } from '../scale'
import { formatDistance, formatRouteDelta } from '../format'
import { getScaledRouteValues } from '../scale'

export interface LegSegmentShare {
  leg: RouteLeg
  share: number
}

export function getRouteTransferHubs(route: RouteResult): string[] {
  return route.legs.slice(0, -1).map((leg) => leg.toStationName)
}

export function getLegSegmentShares(route: RouteResult): LegSegmentShare[] {
  const total = route.totalDurationSeconds || 1
  return route.legs.map((leg) => ({
    leg,
    share: leg.durationSeconds / total,
  }))
}

export function lineShortName(name: string): string {
  return name.replace(/^Linie\s*/i, '').trim() || name
}

export function formatDistanceDelta(
  route: RouteResult,
  primary: RouteResult | null,
  scale: ScaleSettings,
): string | null {
  if (!primary) return null

  const routeM = getScaledRouteValues(
    route.totalDurationSeconds,
    route.totalDistanceMeters,
    scale,
  ).distanceMeters
  const primaryM = getScaledRouteValues(
    primary.totalDurationSeconds,
    primary.totalDistanceMeters,
    scale,
  ).distanceMeters
  const delta = routeM - primaryM

  if (Math.abs(delta) < 400) return null

  const sign = delta > 0 ? '+' : '−'
  return `${sign}${formatDistance(Math.abs(delta))}`
}

/** Differenz zur Empfehlung — mit Realzeit-Multiplikator, falls aktiv. */
export function computeRouteDeltaSeconds(
  route: RouteResult,
  primary: RouteResult | null,
  scale: ScaleSettings,
): number {
  if (!primary) return 0
  const routeScaled = getScaledRouteValues(route.totalDurationSeconds, 0, scale).durationSeconds
  const primaryScaled = getScaledRouteValues(
    primary.totalDurationSeconds,
    0,
    scale,
  ).durationSeconds
  return routeScaled - primaryScaled
}

export function formatGameTimeDelta(
  route: RouteResult,
  primary: RouteResult | null,
): string | null {
  if (!primary) return null
  const raw = route.totalDurationSeconds - primary.totalDurationSeconds
  if (raw <= 0) return null
  return formatRouteDelta(raw)
}

export function routeDeltaPercent(
  route: RouteResult,
  primary: RouteResult | null,
  scale: ScaleSettings,
): number | null {
  if (!primary) return null
  const delta = computeRouteDeltaSeconds(route, primary, scale)
  if (delta <= 0) return null
  const primaryScaled = getScaledRouteValues(
    primary.totalDurationSeconds,
    0,
    scale,
  ).durationSeconds
  if (primaryScaled <= 0) return null
  return Math.round((delta / primaryScaled) * 100)
}
